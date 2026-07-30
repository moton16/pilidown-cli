/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi/Services/Download/BuiltinDownloadService.cs (orchestration)
 *   - src/DownKyi.Core/FileName/FileName.cs (file naming — heavily simplified)
 *
 * Simplifications (ponytail):
 *   - Filename: `{title}-P{page}-{qn}.{ext}` (no builder pattern, no config).
 *   - Sanitize Windows + Unix illegal chars.
 *   - Concurrency control: simple p-limit-style promise pool (no extra dep).
 *   - No FFmpeg: uses pure JS/WASM merge (mp4box + @invintusmedia/tomp4).
 */

import { getVideoInfo, getPlayUrl } from '../api/VideoApi';
import { selectStreams } from './StreamService';
import { downloadMultiThread } from '../utils/downloader';
import { mergeDashStreams, transcodeToMp3, extractAudioFromMp4 } from '../utils/media';
import { loadCookies, toCookieHeader } from './CookieService';
import { info as logInfo, warn as logWarn, error as logError, progress as logProgress } from '../utils/logger';
import type { VideoInfo, DashVideo, DashAudio, PlayUrlDurl } from '../types/bili';

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
  noMerge?: boolean; // skip ffmpeg merge, save separate .m4v/.m4a
  overwrite?: boolean;
  audioOnly?: boolean; // only download audio, skip video stream
  format?: string; // transcode audio to format: mp3/aac/flac/wav
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

function sanitizeFilename(s: string): string {
  return s.replace(ILLEGAL_FILENAME_CHARS, '_').trim() || 'untitled';
}

function extForVideo(v?: DashVideo): string {
  if (!v) return 'mp4';
  if (v.mimeType.includes('hevc') || v.codecs.startsWith('hev1')) return 'm4v';
  if (v.mimeType.includes('av01') || v.codecs.startsWith('av01')) return 'm4v';
  return 'm4v';
}

function extForAudio(a?: DashAudio): string {
  if (!a) return 'm4a';
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
): Promise<{ bytes: number; durationMs: number }> {
  const start = Date.now();
  let lastErr: Error | undefined;
  for (const [idx, url] of urls.entries()) {
    try {
      const result = await downloadMultiThread(url, destPath, {
        cookies,
        headers: { Referer: 'https://www.bilibili.com/' },
        threads,
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

/** Download a single video page (video + audio streams, merge if ffmpeg available). */
export async function downloadVideo(opts: DownloadVideoOptions): Promise<DownloadResult> {
  const start = Date.now();
  const info = await getVideoInfo({ bvid: opts.bvid, aid: opts.aid });
  const pageIdx = Math.max(1, opts.page) - 1;
  const page = info.pages[pageIdx] ?? info.pages[0];
  if (!page) throw new Error(`Page ${opts.page} not found in ${info.bvid}`);

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

  // Legacy FLV/MP4 single-file fallback (no separate audio, no ffmpeg merge needed).
  if (selected.durl) {
    const durlExt = extForDurl(selected.durl);
    const durlPath = `${opts.outputDir}/${baseName}.${durlExt}`;
    if (!opts.overwrite && existsSafe(durlPath)) {
      logInfo('skip existing durl file', { path: durlPath });
      mergedPath = durlPath;
    } else {
      const urls = [selected.durl.url, ...(selected.durl.backup_url ?? [])];
      logInfo('downloading durl (single-file)', { url: urls[0].slice(0, 80), size: selected.durl.size, fallbacks: urls.length - 1 });
      await downloadStream(urls, durlPath, cookies, opts.threads ?? 8, `durl qn=${selected.quality}`);
      mergedPath = durlPath;
    }

    // audio-only: extract audio from durl, optionally transcode
    if (opts.audioOnly) {
      const fmt = opts.format ?? 'mp3';
      const audioOut = `${opts.outputDir}/${baseName}.${fmt}`;
      const durlLower = durlPath.toLowerCase();
      if (durlLower.endsWith('.mp4') || durlLower.endsWith('.m4v')) {
        // MP4/fMP4 container: extract audio with pure JS
        logInfo('extracting audio from durl (pure JS)', { format: fmt, output: audioOut });
        try {
          if (fmt === 'mp3') {
            // Extract to m4a first, then transcode to mp3
            const m4aPath = `${opts.outputDir}/${baseName}-temp.m4a`;
            await extractAudioFromMp4(durlPath, m4aPath);
            await transcodeToMp3(m4aPath, audioOut, 192);
          } else {
            // For m4a/aac: just extract audio track
            await extractAudioFromMp4(durlPath, audioOut);
          }
          if (durlPath !== audioOut) try { require('node:fs').rmSync(durlPath, { force: true }); } catch { /* ignore */ }
          mergedPath = audioOut;
          logInfo('audio extraction complete', { path: audioOut });
        } catch (err) {
          logError('audio extraction failed, keeping original durl', { error: (err as Error).message });
        }
      } else {
        // FLV or other: not supported in pure JS, keep original
        logWarn('FLV audio extraction not supported (no ffmpeg), keeping original file', { path: durlPath });
        mergedPath = durlPath;
      }
    }
  } else {
    // audio-only: skip video download entirely
    if (opts.audioOnly) {
      videoPath = undefined;
    } else {
      videoPath = selected.video
        ? `${opts.outputDir}/${baseName}-${selected.video.id}.${videoExt}`
        : undefined;
      if (videoPath) {
        if (!opts.overwrite && existsSafe(videoPath)) {
          logInfo('skip existing video file', { path: videoPath });
        } else {
          const videoUrls = [selected.video!.baseUrl, ...(selected.video!.baseBackupUrl ?? [])];
          logInfo('downloading video', { url: videoUrls[0].slice(0, 80), quality: selected.video!.id, fallbacks: videoUrls.length - 1 });
          await downloadStream(videoUrls, videoPath, cookies, opts.threads ?? 8, `video qn=${selected.video!.id}`);
        }
      }
    }

    audioPath = selected.audio
      ? `${opts.outputDir}/${baseName}-${selected.audio.id}.${audioExt}`
      : undefined;
    if (audioPath) {
      if (!opts.overwrite && existsSafe(audioPath)) {
        logInfo('skip existing audio file', { path: audioPath });
      } else {
        const audioUrls = [selected.audio!.baseUrl, ...(selected.audio!.baseBackupUrl ?? [])];
        logInfo('downloading audio', { url: audioUrls[0].slice(0, 80), id: selected.audio!.id, fallbacks: audioUrls.length - 1 });
        await downloadStream(audioUrls, audioPath, cookies, opts.threads ?? 8, `audio id=${selected.audio!.id}`);
      }
    }

    if (opts.audioOnly && audioPath) {
      // transcode audio to target format (default mp3)
      const fmt = opts.format ?? 'mp3';
      const audioOut = `${opts.outputDir}/${baseName}.${fmt}`;
      if (fmt === 'mp3') {
        logInfo('transcoding audio to mp3 (pure JS/WASM)', { from: audioExt, to: fmt, output: audioOut });
        try {
          await transcodeToMp3(audioPath, audioOut, 192);
          mergedPath = audioOut;
          audioPath = audioOut;
          logInfo('transcode complete', { path: audioOut });
        } catch (err) {
          logError('transcode failed, keeping original audio', { error: (err as Error).message });
          mergedPath = audioPath;
        }
      } else if (fmt === 'm4a') {
        // No transcoding needed — keep original m4a
        mergedPath = audioPath;
      } else {
        // aac/flac/wav not supported in pure JS yet
        logWarn('format not supported in pure JS mode, keeping original .m4a', { format: fmt });
        mergedPath = audioPath;
      }
    } else if (!opts.noMerge && videoPath && audioPath) {
      mergedPath = `${opts.outputDir}/${baseName}.mp4`;
      logInfo('merging video + audio (pure JS)', { output: mergedPath });
      try {
        await mergeDashStreams(videoPath, audioPath, mergedPath);
        logInfo('merge complete', { path: mergedPath });
      } catch (err) {
        logError('merge failed, keeping separate streams', { error: (err as Error).message });
        mergedPath = undefined;
      }
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
): Promise<DownloadResult[]> {
  const info = await getVideoInfo({ bvid: opts.bvid, aid: opts.aid });
  const pages = opts.pages ?? info.pages.map(p => p.page);
  const concurrency = 3;
  const results: DownloadResult[] = [];
  // ponytail: simple promise pool, no extra dep.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < pages.length) {
      const idx = cursor++;
      const pageNo = pages[idx];
      try {
        const r = await downloadVideo({ ...opts, page: pageNo });
        results.push(r);
      } catch (err) {
        logError('page download failed', { page: pageNo, error: (err as Error).message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, () => worker()));
  return results;
}

/**
 * Download an entire UGC collection (合集).
 * Input any bvid belonging to the collection → fetch all episodes → download each.
 * Ported from DownKyi's "下载合集" workflow.
 */
export async function downloadCollection(
  opts: Omit<DownloadVideoOptions, 'page'>,
): Promise<DownloadResult[]> {
  const info = await getVideoInfo({ bvid: opts.bvid, aid: opts.aid });
  if (!info.ugc_season) {
    throw new Error(`${info.bvid} does not belong to a UGC collection (ugc_season missing)`);
  }
  // ponytail: flatten sections → episode list → download each as its own video
  const episodes: { bvid: string; aid: number; cid: number; title: string }[] = [];
  for (const section of info.ugc_season.sections ?? []) {
    for (const ep of section.episodes ?? []) {
      episodes.push({ bvid: ep.bvid, aid: ep.aid, cid: ep.cid, title: ep.title });
    }
  }
  const concurrency = 3;
  const results: DownloadResult[] = [];
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
        results.push(r);
      } catch (err) {
        logError('collection episode failed', { episode: idx + 1, bvid: ep.bvid, error: (err as Error).message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, episodes.length) }, () => worker()));
  return results;
}

function existsSafe(p: string): boolean {
  try { return require('node:fs').existsSync(p); } catch { return false; }
}
