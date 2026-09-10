/**
 * pilidown - Zero-FFmpeg media processing utilities
 *
 * - DASH merge (fMP4 video + fMP4 audio → dual-track fMP4):
 *     src/utils/fmp4.ts passthrough merge — O(1) memory, codec-agnostic.
 * - Audio-only export (fMP4 audio stream → standard m4a):
 *     @invintusmedia/tomp4 convertFmp4ToMp4 (single step, no re-encode).
 * - ts → mp4 container: @invintusmedia/tomp4 convertTsToMp4.
 *
 * MP3 transcoding was removed by design decision (T2): Bilibili audio is
 * native AAC; transcoding to mp3 is lossy→lossy quality loss and was the sole
 * reason the GPL-2.0 FAAD2 decoder (@audio/decode-aac) was pulled in.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { info as logInfo } from './logger';
import { mergeFmp4 } from './fmp4';

export { mergeFmp4 };

// tomp4's ambient .d.ts doesn't declare these functions; keep dynamic import + any
// (matches the pattern used across the codebase for this package)
async function tomp4(): Promise<any> {
  return await import('@invintusmedia/tomp4');
}

/**
 * Merge DASH video (fMP4) and audio (fMP4) streams into a single dual-track
 * fMP4 (.mp4). No re-encoding — pure container passthrough.
 * Throws on failure (caller must not swallow).
 */
export async function mergeDashStreams(
  videoPath: string,
  audioPath: string,
  destPath: string,
): Promise<void> {
  logInfo('merging dash streams (fMP4 passthrough)', { video: videoPath, audio: audioPath, output: destPath });
  await mergeFmp4(videoPath, audioPath, destPath);
  logInfo('merge complete', { path: destPath, size: statSize(destPath) });
}

/**
 * Convert a DASH audio stream (single-track fMP4) into a standard, directly
 * playable .m4a. Audio streams are small (tens of MB), so the in-memory
 * conversion is fine here — it is NOT used for video (that's what the
 * passthrough merge avoids).
 * Throws on failure.
 */
export async function audioStreamToM4a(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  logInfo('converting audio stream to m4a', { input: inputPath, output: outputPath });
  const buf = await readFile(inputPath);
  const mod = await tomp4();
  const data = mod.isFmp4(new Uint8Array(buf))
    ? mod.convertFmp4ToMp4(new Uint8Array(buf))
    : new Uint8Array(buf); // already a standard mp4 container
  await writeFile(outputPath, data);
  logInfo('audio conversion complete', { path: outputPath, size: data.byteLength });
}

/**
 * Convert MPEG-TS file to MP4 container without re-encoding (durl fallback).
 */
export async function convertTsToMp4(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  logInfo('converting ts to mp4', { input: inputPath, output: outputPath });
  const mod = await tomp4();
  const buffer = await readFile(inputPath);
  const result = await mod.convertTsToMp4(new Uint8Array(buffer));
  const data = result?.data ?? result;
  await writeFile(outputPath, data);
  logInfo('ts→mp4 conversion complete', { path: outputPath, size: data.byteLength });
}

function statSize(p: string): number {
  try { return statSync(p).size; } catch { return -1; }
}
