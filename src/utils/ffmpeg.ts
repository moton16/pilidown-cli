/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# source: src/DownKyi.Core/FFmpeg/FFmpegHelper.cs
 *
 * Simplifications (ponytail):
 *   - Probes PATH for ffmpeg binary instead of hard-coding ./ffmpeg.exe.
 *   - Returns Promise-based APIs instead of callback-based.
 *   - Drops Delogo/ExtractFrame (not needed by M5 download pipeline).
 */

import { execFile } from 'node:child_process';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let cachedFfmpegPath: string | null | undefined;

/** Find ffmpeg binary on PATH (cached). Returns null if not found. */
export function findFfmpeg(): string | null {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;
  // ponytail: spawn `ffmpeg -version` and check exit code; cross-platform.
  try {
    const result = require('node:child_process').spawnSync('ffmpeg', ['-version'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    cachedFfmpegPath = result.status === 0 ? 'ffmpeg' : null;
  } catch {
    cachedFfmpegPath = null;
  }
  return cachedFfmpegPath;
}

export interface FFmpegOptions {
  ffmpegPath?: string;
  cwd?: string;
}

function resolveFfmpeg(opts: FFmpegOptions = {}): string {
  const path = opts.ffmpegPath ?? findFfmpeg();
  if (!path) throw new Error('ffmpeg not found on PATH. Install ffmpeg or pass --ffmpeg-path.');
  return path;
}

/** Merge one video + one audio stream into a single mp4 (or mkv) using -c copy. */
export async function mergeVideoAudio(
  videoPath: string | null,
  audioPath: string | null,
  destPath: string,
  opts: FFmpegOptions = {},
): Promise<void> {
  if (!videoPath && !audioPath) throw new Error('mergeVideoAudio: at least one input is required');
  const ffmpeg = resolveFfmpeg(opts);
  const args: string[] = ['-y'];
  if (videoPath && existsSync(videoPath)) args.push('-i', videoPath);
  if (audioPath && existsSync(audioPath)) args.push('-i', audioPath);
  args.push('-strict', '-2', '-acodec', 'copy', '-vcodec', 'copy', '-f', 'mp4', destPath);
  await execFileAsync(ffmpeg, args, { cwd: opts.cwd, windowsHide: true });
  // Cleanup sources
  for (const p of [videoPath, audioPath]) {
    if (p) try { rmSync(p, { force: true }); } catch { /* ignore */ }
  }
}

/** Concatenate multiple video files using ffmpeg concat demuxer. */
export async function concatVideos(
  videoPaths: string[],
  destPath: string,
  opts: FFmpegOptions = {},
): Promise<void> {
  if (videoPaths.length === 0) throw new Error('concatVideos: no input files');
  if (videoPaths.length === 1) {
    renameSyncSafe(videoPaths[0], destPath);
    return;
  }
  const ffmpeg = resolveFfmpeg(opts);
  const cwd = opts.cwd ?? dirnameOf(destPath);
  const listFile = join(cwd, `pilidown-concat-${Date.now()}.txt`);
  const listContent = videoPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  writeFileSync(listFile, listContent, 'utf8');
  try {
    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', destPath];
    await execFileAsync(ffmpeg, args, { cwd, windowsHide: true });
    for (const p of videoPaths) {
      try { rmSync(p, { force: true }); } catch { /* ignore */ }
    }
  } finally {
    try { rmSync(listFile, { force: true }); } catch { /* ignore */ }
  }
}

/** Extract audio from a video file (-vn -acodec copy). */
export async function extractAudio(
  videoPath: string,
  audioPath: string,
  opts: FFmpegOptions = {},
): Promise<void> {
  const ffmpeg = resolveFfmpeg(opts);
  const args = ['-i', videoPath, '-vn', '-y', '-acodec', 'copy', audioPath, '-hide_banner'];
  await execFileAsync(ffmpeg, args, { cwd: opts.cwd, windowsHide: true });
}

/** Extract video only from a media file (-vcodec copy -an). */
export async function extractVideo(
  videoPath: string,
  destVideoPath: string,
  opts: FFmpegOptions = {},
): Promise<void> {
  const ffmpeg = resolveFfmpeg(opts);
  const args = ['-i', videoPath, '-y', '-vcodec', 'copy', '-an', destVideoPath, '-hide_banner'];
  await execFileAsync(ffmpeg, args, { cwd: opts.cwd, windowsHide: true });
}

function dirnameOf(p: string): string {
  // Avoid extra import cost for a single use.
  const idx = p.lastIndexOf(process.platform === 'win32' ? '\\' : '/');
  return idx >= 0 ? p.slice(0, idx) : '.';
}

function renameSyncSafe(from: string, to: string): void {
  try {
    if (existsSync(to)) rmSync(to, { force: true });
    require('node:fs').renameSync(from, to);
  } catch {
    /* ignore */
  }
}
