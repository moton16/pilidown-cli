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
 *   - No FFmpeg: fallback to separate .m4v + .m4a files.
 */

import { getVideoInfo, getPlayUrl } from '../api/VideoApi';
import { selectStreams } from './StreamService';
import { downloadMultiThread } from '../utils/downloader';
import { mergeVideoAudio, findFfmpeg } from '../utils/ffmpeg';
import { loadCookies, toCookieHeader } from './CookieService';
import { info as logInfo, warn as logWarn, error as logError, progress as logProgress } from '../utils/logger';
import type { VideoInfo, DashVideo, DashAudio } from '../types/bili';

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

async function downloadStream(
  url: string,
  destPath: string,
  cookies: Record<string, string>,
  threads: number,
  qualityLabel: string,
): Promise<{ bytes: number; durationMs: number }> {
  const start = Date.now();
  const result = await downloadMultiThread(url, destPath, {
    cookies,
    headers: { Referer: 'https://www.bilibili.com/' },
    threads,
    onProgress: (cur, total, speedBps) => {
      logProgress(cur, total, { label: qualityLabel, speedBps });
    },
  });
  return { bytes: result.totalBytes, durationMs: Date.now() - start };
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

  const videoPath = selected.video
    ? `${opts.outputDir}/${baseName}-${selected.video.id}.${videoExt}`
    : undefined;
  const audioPath = selected.audio
    ? `${opts.outputDir}/${baseName}-${selected.audio.id}.${audioExt}`
    : undefined;

  if (videoPath) {
    if (!opts.overwrite && existsSafe(videoPath)) {
      logInfo('skip existing video file', { path: videoPath });
    } else {
      logInfo('downloading video', { url: selected.video!.baseUrl.slice(0, 80), quality: selected.video!.id });
      await downloadStream(selected.video!.baseUrl, videoPath, cookies, opts.threads ?? 8, `video qn=${selected.video!.id}`);
    }
  }
  if (audioPath) {
    if (!opts.overwrite && existsSafe(audioPath)) {
      logInfo('skip existing audio file', { path: audioPath });
    } else {
      logInfo('downloading audio', { url: selected.audio!.baseUrl.slice(0, 80), id: selected.audio!.id });
      await downloadStream(selected.audio!.baseUrl, audioPath, cookies, opts.threads ?? 8, `audio id=${selected.audio!.id}`);
    }
  }

  let mergedPath: string | undefined;
  if (!opts.noMerge && videoPath && audioPath) {
    const ffmpeg = findFfmpeg();
    if (ffmpeg) {
      mergedPath = `${opts.outputDir}/${baseName}.mp4`;
      logInfo('merging video + audio', { output: mergedPath });
      try {
        await mergeVideoAudio(videoPath, audioPath, mergedPath);
        logInfo('merge complete', { path: mergedPath });
      } catch (err) {
        logError('merge failed, keeping separate streams', { error: (err as Error).message });
        mergedPath = undefined;
      }
    } else {
      logWarn('ffmpeg not found on PATH, keeping separate video + audio files');
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

function existsSafe(p: string): boolean {
  try { return require('node:fs').existsSync(p); } catch { return false; }
}
