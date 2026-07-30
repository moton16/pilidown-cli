/**
 * pilidown - Zero-FFmpeg media processing utilities
 *
 * Replaces src/utils/ffmpeg.ts with pure JS/WASM npm packages.
 *
 * - DASH merge (fMP4+fMP4 → MP4): @invintusmedia/tomp4 MP4Parser + MP4Muxer
 * - m4a → mp3 transcode: @audio/decode-aac (FAAD2 WASM) + @breezystack/lamejs
 * - ts → mp4 container: @invintusmedia/tomp4 convertTsToMp4
 */

import { readFile, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { warn as logWarn, info as logInfo } from './logger';

// ---------------------------------------------------------------------------
// Lazy loaders (ESM packages need dynamic import)
// ---------------------------------------------------------------------------

async function tomp4(): Promise<any> {
  return await import('@invintusmedia/tomp4');
}

let _decodeAac: ((data: Uint8Array) => Promise<{ channelData: Float32Array[]; sampleRate: number }>) | null;
async function decodeAac() {
  if (!_decodeAac) {
    const mod = await import('@audio/decode-aac');
    _decodeAac = mod.default;
  }
  return _decodeAac!;
}

let _lame: { Mp3Encoder: new (channels: number, sampleRate: number, bitrate: number) => any } | null;
async function lame() {
  if (!_lame) _lame = await import('@breezystack/lamejs');
  return _lame;
}

// ---------------------------------------------------------------------------
// DASH merge: fMP4 video + fMP4 audio → standard MP4
// ---------------------------------------------------------------------------

/**
 * Parse an fMP4 file and extract video access units (H.264 NAL units per frame).
 */
async function extractVideoAccessUnits(buffer: Uint8Array): Promise<{ units: any[]; width: number; height: number }> {
  const { MP4Parser } = await tomp4();
  const parser = new MP4Parser(buffer);
  const samples = parser.getVideoSamples();
  const sampleData = parser.getSampleData(samples);

  const width = parser.width || 1920;
  const height = parser.height || 1080;

  const units: any[] = [];
  for (const sample of sampleData) {
    const nalUnits = splitAvccNalus(sample.data!);
    // pts/dts in MP4Sample are in seconds; convert to 90kHz ticks for MP4Muxer
    const pts = Math.round((sample.pts ?? sample.dts ?? 0) * 90000);
    const dts = Math.round((sample.dts ?? 0) * 90000);
    units.push({ nalUnits, pts, dts });
  }
  return { units, width, height };
}

/**
 * Parse an fMP4 file and extract audio access units (AAC frames).
 */
async function extractAudioAccessUnits(buffer: Uint8Array): Promise<{ units: any[]; sampleRate: number; channels: number }> {
  const { MP4Parser } = await tomp4();
  const parser = new MP4Parser(buffer);
  const samples = parser.getAudioSamples();
  const sampleData = parser.getSampleData(samples);

  const config = parser.audioCodecConfig;
  const sampleRate = config?.sampleRate || 48000;
  const channels = config?.channels || 2;

  const units: any[] = [];
  for (const sample of sampleData) {
    // pts in seconds; convert to audio timescale
    const pts = Math.round((sample.pts ?? sample.dts ?? 0) * sampleRate);
    units.push({ data: sample.data!, pts });
  }
  return { units, sampleRate, channels };
}

/**
 * Split AVCC-format H.264 data into individual NAL units.
 * AVCC format: [4-byte length][NAL unit] repeated.
 */
function splitAvccNalus(data: Uint8Array): Uint8Array[] {
  const nalus: Uint8Array[] = [];
  let offset = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  while (offset + 4 <= data.length) {
    const len = view.getUint32(offset);
    offset += 4;
    if (offset + len > data.length) break;
    nalus.push(data.slice(offset, offset + len));
    offset += len;
  }
  return nalus;
}

/**
 * Merge DASH video (fMP4) and audio (fMP4) streams into a single MP4.
 * No re-encoding — pure container remux.
 */
export async function mergeDashStreams(
  videoPath: string,
  audioPath: string,
  destPath: string,
): Promise<void> {
  logInfo('merging dash streams (pure JS)', { video: videoPath, audio: audioPath, output: destPath });

  const videoBuf = await readFile(videoPath);
  const audioBuf = await readFile(audioPath);

  const videoData = await extractVideoAccessUnits(new Uint8Array(videoBuf));
  const audioData = await extractAudioAccessUnits(new Uint8Array(audioBuf));

  if (videoData.units.length === 0) {
    throw new Error('No video frames found in fMP4');
  }

  const mod = await tomp4();
  const MP4Muxer = mod.MP4Muxer;

  // Build a combined "parser" object that MP4Muxer expects
  const combinedParser = {
    videoAccessUnits: videoData.units,
    audioAccessUnits: audioData.units,
    audioSampleRate: audioData.sampleRate,
    audioChannels: audioData.channels,
  };

  const muxer = new MP4Muxer(combinedParser);
  const mp4Data = muxer.build();

  await writeFile(destPath, mp4Data);
  logInfo('merge complete', { path: destPath, size: mp4Data.byteLength });

  // Cleanup source files
  for (const p of [videoPath, audioPath]) {
    try { rmSync(p, { force: true }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// m4a → mp3 transcode (FAAD2 WASM decode + lamejs encode)
// ---------------------------------------------------------------------------

/**
 * Transcode an AAC/M4A audio file to MP3.
 * Pipeline: AAC → PCM (FAAD2 WASM) → MP3 (lamejs pure JS).
 */
export async function transcodeToMp3(
  inputPath: string,
  outputPath: string,
  bitrate = 192,
): Promise<void> {
  logInfo('transcoding audio to mp3 (pure JS/WASM)', { input: inputPath, output: outputPath, bitrate });

  const buffer = await readFile(inputPath);
  const decode = await decodeAac();
  const { channelData, sampleRate } = await decode(new Uint8Array(buffer));

  if (!channelData || channelData.length === 0) {
    throw new Error('AAC decode returned no audio data');
  }

  const channels = channelData.length;
  const lameMod = await lame();
  const encoder = new lameMod.Mp3Encoder(channels, sampleRate, bitrate);

  // Convert Float32Array → Int16Array (lamejs expects 16-bit PCM)
  const int16Channels = channelData.map(ch => floatToInt16(ch));

  const mp3Chunks: Buffer[] = [];
  const blockSize = 1152; // lamejs internal block size

  if (channels === 1) {
    const left = int16Channels[0];
    for (let i = 0; i < left.length; i += blockSize) {
      const chunk = left.subarray(i, i + blockSize);
      const mp3buf = encoder.encodeBuffer(chunk);
      if (mp3buf.length > 0) mp3Chunks.push(Buffer.from(mp3buf));
    }
  } else {
    const left = int16Channels[0];
    const right = int16Channels[1] ?? int16Channels[0];
    for (let i = 0; i < left.length; i += blockSize) {
      const l = left.subarray(i, i + blockSize);
      const r = right.subarray(i, i + blockSize);
      const mp3buf = encoder.encodeBuffer(l, r);
      if (mp3buf.length > 0) mp3Chunks.push(Buffer.from(mp3buf));
    }
  }

  const flushBuf = encoder.flush();
  if (flushBuf.length > 0) mp3Chunks.push(Buffer.from(flushBuf));

  const mp3Data = Buffer.concat(mp3Chunks);
  await writeFile(outputPath, mp3Data);
  logInfo('transcode complete', { path: outputPath, size: mp3Data.length });

  // Cleanup input
  if (inputPath !== outputPath) {
    try { rmSync(inputPath, { force: true }); } catch { /* ignore */ }
  }
}

/**
 * Extract audio from an MP4/fMP4 file and save as M4A.
 * (FLV files are not supported — caller should check format.)
 */
export async function extractAudioFromMp4(
  videoPath: string,
  outputPath: string,
): Promise<void> {
  logInfo('extracting audio from mp4', { input: videoPath, output: outputPath });

  const buffer = await readFile(videoPath);
  const audioData = await extractAudioAccessUnits(new Uint8Array(buffer));

  if (audioData.units.length === 0) {
    throw new Error('No audio track found in MP4 file');
  }

  const mod = await tomp4();
  const MP4Muxer = mod.MP4Muxer;

  // Create a parser with only audio (no video)
  const audioOnlyParser = {
    videoAccessUnits: [],
    audioAccessUnits: audioData.units,
    audioSampleRate: audioData.sampleRate,
    audioChannels: audioData.channels,
  };

  const muxer = new MP4Muxer(audioOnlyParser);
  const mp4Data = muxer.build();

  await writeFile(outputPath, mp4Data);
  logInfo('audio extraction complete', { path: outputPath, size: mp4Data.byteLength });
}

// ---------------------------------------------------------------------------
// ts → mp4 container conversion
// ---------------------------------------------------------------------------

/**
 * Convert MPEG-TS file to MP4 container without re-encoding.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function floatToInt16(float: Float32Array): Int16Array {
  const int16 = new Int16Array(float.length);
  for (let i = 0; i < float.length; i++) {
    const s = Math.max(-1, Math.min(1, float[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}
