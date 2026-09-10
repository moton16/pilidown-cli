/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi/Services/Download/BuiltinDownloadService.cs (orchestration)
 *   - src/DownKyi.Core/FileName/FileName.cs (file naming — heavily simplified)
 *
 * Failure policy (P0-3 fix): merge/transcode failures THROW — the caller (and
 * therefore the exit code) must reflect reality. Batch downloads collect
 * failures in a `failures` array instead of silently dropping them.
 */

import { getVideoInfo, getPlayUrl } from '../api/VideoApi';
import { selectStreams } from './StreamService';
import { downloadMultiThread } from '../utils/downloader';
import { mergeDashStreams, audioStreamToM4a } from '../utils/media';
import { loadCookies } from './CookieService';
import { info as logInfo, warn as logWarn, error as logError, progress as logProgress } from '../utils/logger';
import type { VideoInfo, DashVideo, DashAudio, PlayUrlDurl } from '../types/bili';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export interface DownloadVideoOptions {
  bvid?: string;
  aid?: number;
  page: number; // 1-based
  preferQn?: number;
  preferCodec?: number;
  preferHiRes?: boolean;
  preferDolby?: boolean;
  preferAudioId?: number;
  outputDir: string;
  filename?: string; // override base name (no extension)
  threads?: number;
  noMerge?: boolean; // skip merge, save separate .m4v/.m4a
  overwrite?: boolean;
  audioOnly?: boolean; // only download audio, skip video stream
  format?: string; // audio format: m4a (only supported value; mp3 removed — see T2)
  container?: 'fmp4' | 'mp4'; // default: fmp4 (progressive mp4 available via mp4)
  noResume?: boolean;
  maxMediaMemMb?: number;
}

export interface DownloadResult {
  page: number;
  cid: number;
  part: string;
  videoPath?: string;
  audioPath?: string;
  mergedPath?: string;
  quality: number;
  durationMs: number;
}

export interface DownloadFailure {
  page?: number;
  episode?: number;
  bvid?: string;
  part?: string;
  stage: string;
  error: string;
  code?: 'E_HTTP' | 'E_MERGE' | 'E_EXPIRED_URL' | 'E_DISK' | 'E_UNSUPPORTED' | string;
}

export function classifyError(e: Error): 'E_HTTP' | 'E_MERGE' | 'E_EXPIRED_URL' | 'E_DISK' | 'E_UNSUPPORTED' {
  const msg = (e.message || '').toLowerCase();
  if (msg.includes('merge') || msg.includes('fmp4') || msg.includes('box') || msg.includes('corrupt')) {
    return 'E_MERGE';
  }
  if (msg.includes('expired') || msg.includes('url expired')) {
    return 'E_EXPIRED_URL';
  }
  if (msg.includes('enospc') || msg.includes('disk') || msg.includes('space') || msg.includes('eperm') || msg.includes('eacces')) {
    return 'E_DISK';
  }
  if (msg.includes('unsupported') || msg.includes('not supported')) {
    return 'E_UNSUPPORTED';
  }
  return 'E_HTTP';
}

function sanitizeFilename(s: string): string {
  return s.replace(ILLEGAL_FILENAME_CHARS, '_').trim() || 'untitled';
}

function extForVideo(_v?: DashVideo): string {
  return 'm4v'; // DASH video streams are always fMP4 regardless of codec
}

function extForAudio(_a?: DashAudio): string {
  return 'm4a';
}

function extForDurl(d?: PlayUrlDurl): string {
  if (!d) return 'mp4';
  const u = d.url.toLowerCase();
  if (u.includes('.flv')) return 'flv';
  if (u.includes('.mp4')) return 'mp4';
  return 'mp4';
}

async function downloadStream(
  urls: string[],
  destPath: string,
  cookies: Record<string, string>,
  threads: number,
  qualityLabel: string,
  extra: { resume?: boolean; key?: string } = {},
): Promise<{ bytes: number; durationMs: number }> {
  const start = Date.now();
  let lastErr: Error | undefined;
  for (const [idx, url] of urls.entries()) {
    try {
      const result = await downloadMultiThread(url, destPath, {
        cookies,
        headers: { Referer: 'https://www.bilibili.com/' },
        threads,
        resume: extra.resume,
        key: extra.key,
        onProgress: (cur, total, speedBps) => {
          logProgress(cur, total, { label: qualityLabel, speedBps });
        },
      });
      return { bytes: result.totalBytes, durationMs: Date.now() - start };
    } catch (err) {
      lastErr = err as Error;
      logWarn('stream download attempt failed', { attempt: idx + 1, url: url.slice(0, 80), error: lastErr.message });
    }
  }
  throw lastErr ?? new Error(`All ${urls.length} stream URLs failed for ${qualityLabel}`);
}

/** Download a single video page (video + audio streams, passthrough merge). */
export async function downloadVideo(opts: DownloadVideoOptions): Promise<DownloadResult> {
  const start = Date.now();
  const info = await getVideoInfo({ bvid: opts.bvid, aid: opts.aid });
  const pageIdx = Math.max(1, opts.page) - 1;
  const page = info.pages[pageIdx] ?? info.pages[0];
  if (!page) throw new Error(`Page ${opts.page} not found in ${info.bvid}`);

  const format = normalizeAudioFormat(opts.format, opts.audioOnly);
  const cookies = loadCookies().cookies;
  const playUrl = await getPlayUrl({
    bvid: opts.bvid,
    aid: opts.aid,
    cid: page.cid,
    qn: opts.preferQn,
  });
  const selected = selectStreams(playUrl, {
    preferQn: opts.preferQn,
    preferCodec: opts.preferCodec,
    preferAudioId: opts.preferAudioId,
    preferHiRes: opts.preferHiRes,
    preferDolby: opts.preferDolby,
  });

  const baseName = sanitizeFilename(opts.filename ?? `${info.title}-P${page.page}-${page.part}`);
  const videoExt = extForVideo(selected.video);
  const audioExt = extForAudio(selected.audio);

  logInfo('download start', {
    title: info.title,
    page: page.page,
    part: page.part,
    cid: page.cid,
    bvid: info.bvid,
    quality: selected.quality,
    video: selected.video ? { id: selected.video.id, codec: selected.video.codecid, w: selected.video.width, h: selected.video.height } : null,
    audio: selected.audio ? { id: selected.audio.id } : null,
  });

  let videoPath: string | undefined;
  let audioPath: string | undefined;
  let mergedPath: string | undefined;

  if (selected.durl) {
    // Legacy FLV/MP4 single-file fallback (no separate audio stream).
    const durlExt = extForDurl(selected.durl);
    const durlPath = join(opts.outputDir, `${baseName}.${durlExt}`);
    if (!opts.overwrite && existsSafe(durlPath)) {
      logInfo('skip existing durl file', { path: durlPath });
      mergedPath = durlPath;
    } else {
      const urls = [selected.durl.url, ...(selected.durl.backup_url ?? [])];
      logInfo('downloading durl (single-file)', { url: urls[0].slice(0, 80), size: selected.durl.size, fallbacks: urls.length - 1 });
      await downloadStream(urls, durlPath, cookies, opts.threads ?? 8, `durl qn=${selected.quality}`, {
        resume: !opts.noResume,
        key: `${info.bvid}-${page.cid}-durl`,
      });
      mergedPath = durlPath;
    }

    if (opts.audioOnly) {
      // durl containers have no separate audio track to extract cleanly in
      // pure JS — fail loudly instead of silently returning the wrong file.
      throw new Error(
        `--audio-only is not supported for durl (legacy FLV/MP4) streams; got ${durlExt.toUpperCase()} at ${durlPath}`,
      );
    }
  } else {
    // audio-only: skip video download entirely
    if (!opts.audioOnly && selected.video) {
      videoPath = join(opts.outputDir, `${baseName}-${selected.video.id}.${videoExt}`);
      if (!opts.overwrite && existsSafe(videoPath)) {
        logInfo('skip existing video file', { path: videoPath });
      } else {
        const videoUrls = [selected.video.baseUrl, ...(selected.video.baseBackupUrl ?? [])];
        logInfo('downloading video', { url: videoUrls[0].slice(0, 80), quality: selected.video.id, fallbacks: videoUrls.length - 1 });
        await downloadStream(videoUrls, videoPath, cookies, opts.threads ?? 8, `video qn=${selected.video.id}`, {
          resume: !opts.noResume,
          key: `${info.bvid}-${page.cid}-v${selected.video.id}`,
        });
      }
    }

    audioPath = selected.audio
      ? join(opts.outputDir, `${baseName}-${selected.audio.id}.${audioExt}`)
      : undefined;
    if (audioPath && selected.audio) {
      if (!opts.overwrite && existsSafe(audioPath)) {
        logInfo('skip existing audio file', { path: audioPath });
      } else {
        const audioUrls = [selected.audio.baseUrl, ...(selected.audio.baseBackupUrl ?? [])];
        logInfo('downloading audio', { url: audioUrls[0].slice(0, 80), id: selected.audio.id, fallbacks: audioUrls.length - 1 });
        await downloadStream(audioUrls, audioPath, cookies, opts.threads ?? 8, `audio id=${selected.audio.id}`, {
          resume: !opts.noResume,
          key: `${info.bvid}-${page.cid}-a${selected.audio.id}`,
        });
      }
    }

    if (opts.audioOnly && audioPath) {
      // DASH audio is native AAC; one conversion step yields a playable .m4a.
      // format is already normalized ('m4a'); mp3 was rejected up front.
      const audioOut = join(opts.outputDir, `${baseName}.m4a`);
      await audioStreamToM4a(audioPath, audioOut);
      if (audioOut !== audioPath) safeUnlink(audioPath);
      audioPath = audioOut;
      mergedPath = audioOut;
    } else if (!opts.noMerge && videoPath && audioPath) {
      mergedPath = join(opts.outputDir, `${baseName}.mp4`);
      logInfo('merging video + audio', { output: mergedPath, container: opts.container ?? 'fmp4' });
      // No try/catch here: merge failure must fail the command (exit 1),
      // keeping the downloaded streams for inspection.
      await mergeDashStreams(videoPath, audioPath, mergedPath, {
        container: opts.container,
        maxMediaMemMb: opts.maxMediaMemMb,
      });
      safeUnlink(videoPath);
      safeUnlink(audioPath);
      videoPath = undefined;
      audioPath = undefined;
    }
  }

  return {
    page: page.page,
    cid: page.cid,
    part: page.part,
    videoPath,
    audioPath,
    mergedPath,
    quality: selected.quality,
    durationMs: Date.now() - start,
  };
}

/** Download all pages of a video concurrently (max 3 at a time). */
export async function downloadAllPages(
  opts: Omit<DownloadVideoOptions, 'page'> & { pages?: number[] },
): Promise<{ results: DownloadResult[]; failures: DownloadFailure[] }> {
  const info = await getVideoInfo({ bvid: opts.bvid, aid: opts.aid });
  const pages = opts.pages ?? info.pages.map(p => p.page);
  const concurrency = 3;
  const results: (DownloadResult | undefined)[] = new Array(pages.length);
  const failures: DownloadFailure[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < pages.length) {
      const idx = cursor++;
      const pageNo = pages[idx];
      try {
        const r = await downloadVideo({ ...opts, page: pageNo });
        results[idx] = r;
      } catch (err) {
        const e = err as Error;
        logError('page download failed', { page: pageNo, error: e.message });
        failures.push({ page: pageNo, bvid: opts.bvid, stage: 'download', error: e.message, code: classifyError(e) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, () => worker()));
  failures.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  return { results: results.filter((r): r is DownloadResult => r !== undefined), failures };
}

/**
 * Download an entire UGC collection (合集).
 * Input any bvid belonging to the collection → fetch all episodes → download each.
 * Ported from DownKyi's "下载合集" workflow.
 */
export async function downloadCollection(
  opts: Omit<DownloadVideoOptions, 'page'>,
): Promise<{ results: DownloadResult[]; failures: DownloadFailure[] }> {
  const info = await getVideoInfo({ bvid: opts.bvid, aid: opts.aid });
  if (!info.ugc_season) {
    throw new Error(`${info.bvid} does not belong to a UGC collection (ugc_season missing)`);
  }
  const episodes: { bvid: string; aid: number; cid: number; title: string }[] = [];
  for (const section of info.ugc_season.sections ?? []) {
    for (const ep of section.episodes ?? []) {
      episodes.push({ bvid: ep.bvid, aid: ep.aid, cid: ep.cid, title: ep.title });
    }
  }
  const concurrency = 3;
  const results: (DownloadResult | undefined)[] = new Array(episodes.length);
  const failures: DownloadFailure[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < episodes.length) {
      const idx = cursor++;
      const ep = episodes[idx];
      try {
        const r = await downloadVideo({
          ...opts,
          bvid: ep.bvid,
          aid: ep.aid,
          page: 1,
          filename: opts.filename
            ? `${opts.filename}-ep${idx + 1}-${ep.title}`
            : `${info.ugc_season!.title}-ep${idx + 1}-${ep.title}`,
        });
        results[idx] = r;
      } catch (err) {
        const e = err as Error;
        logError('collection episode failed', { episode: idx + 1, bvid: ep.bvid, error: e.message });
        failures.push({ episode: idx + 1, bvid: ep.bvid, part: ep.title, stage: 'download', error: e.message, code: classifyError(e) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, episodes.length) }, () => worker()));
  failures.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  return { results: results.filter((r): r is DownloadResult => r !== undefined), failures };
}

/** Only m4a is supported (T2: mp3 removed — lossy→lossy + GPL entanglement). */
function normalizeAudioFormat(format: string | undefined, audioOnly?: boolean): 'm4a' {
  const fmt = (format ?? 'm4a').toLowerCase();
  if (fmt === 'm4a') return 'm4a';
  if (fmt === 'mp3') {
    throw new Error(
      "mp3 output has been removed: Bilibili audio is native AAC and mp3 transcode degraded quality " +
      "(also required a GPL-licensed decoder). Use the default m4a instead; " +
      "convert with a system ffmpeg if you truly need mp3.",
    );
  }
  throw new Error(`--format must be m4a (got "${format}")${audioOnly ? '' : ' (only relevant with --audio-only)'}`);
}

function existsSafe(p: string): boolean {
  try { return existsSync(p); } catch { return false; }
}

function safeUnlink(p: string): void {
  try { rmSync(p, { force: true }); } catch { /* ignore */ }
}
