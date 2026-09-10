/**
 * pilidown - Zero-FFmpeg media processing utilities
 *
 * - DASH merge (fMP4 video + fMP4 audio → dual-track fMP4):
 *     src/utils/fmp4.ts passthrough merge — O(1) memory, codec-agnostic.
 * - DASH progressive merge (--container mp4):
 *     tomp4 convertFmp4ToMp4 + src/utils/mp4.ts box-level merge.
 * - Audio-only export (fMP4 audio stream → standard m4a):
 *     @invintusmedia/tomp4 convertFmp4ToMp4 (single step, no re-encode).
 * - ts → mp4 container: @invintusmedia/tomp4 convertTsToMp4.
 *
 * MP3 transcoding was removed by design decision (T2): Bilibili audio is
 * native AAC; transcoding to mp3 is lossy→lossy quality loss and was the sole
 * reason the GPL-2.0 FAAD2 decoder (@audio/decode-aac) was pulled in.
 */

import { readFile, writeFile, rm } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { info as logInfo } from './logger';
import { mergeFmp4 } from './fmp4';
import { mergeProgressiveMp4 } from './mp4';

export { mergeFmp4, mergeProgressiveMp4 };

export interface MergeOptions {
  container?: 'fmp4' | 'mp4';
  maxMediaMemMb?: number;
}

// tomp4's ambient .d.ts doesn't declare these functions; keep dynamic import + any
// (matches the pattern used across the codebase for this package)
async function tomp4(): Promise<any> {
  return await import('@invintusmedia/tomp4');
}

/**
 * Merge DASH video and audio streams into a single dual-track file.
 * Defaults to fMP4 passthrough merge (O(1) memory).
 * When container === 'mp4', uses progressive MP4 conversion + box merge.
 * Throws on failure (caller must not swallow).
 */
export async function mergeDashStreams(
  videoPath: string,
  audioPath: string,
  destPath: string,
  options?: MergeOptions,
): Promise<void> {
  const container = options?.container ?? 'fmp4';
  if (container === 'mp4') {
    await mergeDashStreamsProgressive(videoPath, audioPath, destPath, options);
  } else {
    logInfo('merging dash streams (fMP4 passthrough)', { video: videoPath, audio: audioPath, output: destPath });
    await mergeFmp4(videoPath, audioPath, destPath);
    logInfo('merge complete', { path: destPath, size: statSize(destPath) });
  }
}

/**
 * Progressive MP4 compatibility merge:
 * convertFmp4ToMp4(video) + convertFmp4ToMp4(audio) -> mergeProgressiveMp4
 * Includes memory preflight guard.
 */
export async function mergeDashStreamsProgressive(
  videoPath: string,
  audioPath: string,
  destPath: string,
  options?: MergeOptions,
): Promise<void> {
  const vSize = statSize(videoPath);
  const aSize = statSize(audioPath);
  const inputSize = Math.max(0, vSize) + Math.max(0, aSize);
  const estimatedPeak = inputSize * 5;
  const maxMem = (options?.maxMediaMemMb ?? 4096) * 1024 * 1024;

  if (estimatedPeak > maxMem) {
    const estMb = Math.round(estimatedPeak / (1024 * 1024));
    const maxMb = Math.round(maxMem / (1024 * 1024));
    const inMb = Math.round(inputSize / (1024 * 1024));
    throw new Error(
      `--container mp4 memory guard exceeded: estimated peak memory ${estMb}MB exceeds limit ${maxMb}MB ` +
        `for input files (${inMb}MB).\n` +
        `  → 出路 1: 改用默认容器 (不带 --container mp4，走零内存消耗的 fMP4 直通合并)\n` +
        `  → 出路 2: 使用 --no-merge 保留分离流，后续使用系统 ffmpeg (ffmpeg -i v.m4v -i a.m4a -c copy out.mp4) 合并\n` +
        `  → 出路 3: 增大内存阈值 --max-media-mem ${estMb + 512}`,
    );
  }

  logInfo('converting fmp4 streams to progressive mp4 before merge', { video: videoPath, audio: audioPath });
  const mod = await tomp4();

  const tempV = `${destPath}.tmp-v-${Date.now()}.mp4`;
  const tempA = `${destPath}.tmp-a-${Date.now()}.mp4`;

  try {
    const vBuf = await readFile(videoPath);
    const vData = mod.isFmp4(new Uint8Array(vBuf))
      ? mod.convertFmp4ToMp4(new Uint8Array(vBuf))
      : new Uint8Array(vBuf);
    await writeFile(tempV, vData);

    const aBuf = await readFile(audioPath);
    const aData = mod.isFmp4(new Uint8Array(aBuf))
      ? mod.convertFmp4ToMp4(new Uint8Array(aBuf))
      : new Uint8Array(aBuf);
    await writeFile(tempA, aData);

    logInfo('merging progressive mp4 tracks', { output: destPath });
    await mergeProgressiveMp4(tempV, tempA, destPath);
    logInfo('progressive merge complete', { path: destPath, size: statSize(destPath) });
  } finally {
    await rm(tempV, { force: true }).catch(() => {});
    await rm(tempA, { force: true }).catch(() => {});
  }
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
  try {
    return statSync(p).size;
  } catch {
    return -1;
  }
}
