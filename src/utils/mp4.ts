/**
 * pilidown - Progressive MP4 dual-track lossless merger
 * Ported from merge-mp4.mjs prototype (verified with AVC/HEVC/AV1)
 *
 * Merges two single-track progressive MP4 files (video-only + audio-only)
 * by relocating trak boxes, updating chunk offsets (stco/co64), adjusting mvhd duration,
 * and concatenating mdat payloads.
 */

import { readFile, open, rename, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname } from 'node:path';
import {
  readU32,
  readU64,
  writeU32,
  writeU64,
  ascii,
  topBoxes,
  childBoxes,
  find,
  findAll,
  createBox,
  type BoxEntry,
} from './box';

export interface ParsedTrak extends BoxEntry {
  tkhd: BoxEntry;
  mdhd: BoxEntry;
  stbl: BoxEntry;
  trackId: number;
  timescale: number;
  duration: number;
  handler: string;
}

export interface ParsedMp4 {
  buf: Uint8Array;
  ftyp: BoxEntry;
  moov: BoxEntry;
  kids: BoxEntry[];
  mvhd: BoxEntry;
  traks: ParsedTrak[];
  mdatStart: number;
  mdatPayloadLen: number;
}

export function parseMp4(buf: Uint8Array, filename = 'input'): ParsedMp4 {
  const tops = topBoxes(buf);
  const ftyp = find(tops, 'ftyp');
  const moov = find(tops, 'moov');
  const mdats = findAll(tops, 'mdat');
  if (!ftyp || !moov || mdats.length === 0) {
    throw new Error(`${filename}: not a standard progressive MP4 (missing ftyp/moov/mdat)`);
  }
  const mdatStart = mdats[0].ps;
  let contiguous = true;
  let cursor = mdats[0].pe;
  for (let i = 1; i < mdats.length; i++) {
    if (mdats[i].start !== cursor) contiguous = false;
    cursor = mdats[i].pe;
  }
  if (!contiguous) {
    throw new Error(`${filename}: non-contiguous mdat boxes`);
  }
  const mdatPayloadLen = cursor - mdatStart;
  const kids = childBoxes(buf, moov.ps, moov.pe);
  const mvhd = find(kids, 'mvhd');
  if (!mvhd) throw new Error(`${filename}: moov missing mvhd`);

  const traks: ParsedTrak[] = findAll(kids, 'trak').map((t) => {
    const tk = childBoxes(buf, t.ps, t.pe);
    const tkhd = find(tk, 'tkhd');
    const mdia = find(tk, 'mdia');
    if (!tkhd || !mdia) throw new Error(`${filename}: trak missing tkhd or mdia`);
    const mk = childBoxes(buf, mdia.ps, mdia.pe);
    const mdhd = find(mk, 'mdhd');
    const hdlr = find(mk, 'hdlr');
    const minf = find(mk, 'minf');
    if (!mdhd || !hdlr || !minf) throw new Error(`${filename}: mdia missing mdhd, hdlr, or minf`);
    const stbl = find(childBoxes(buf, minf.ps, minf.pe), 'stbl');
    if (!stbl) throw new Error(`${filename}: minf missing stbl`);
    const ver = buf[tkhd.ps];
    const trackId = readU32(buf, tkhd.ps + 4 + (ver === 1 ? 16 : 8));
    const mver = buf[mdhd.ps];
    const timescale = readU32(buf, mdhd.ps + 4 + (mver === 1 ? 16 : 8));
    const duration = mver === 1 ? Number(readU64(buf, mdhd.ps + 4 + 20)) : readU32(buf, mdhd.ps + 4 + 12);
    const handler = ascii(buf, hdlr.ps + 8, 4);
    return { ...t, tkhd, mdhd, stbl, trackId, timescale, duration, handler };
  });

  return { buf, ftyp, moov, kids, mvhd, traks, mdatStart, mdatPayloadLen };
}

function retagTrackId(src: Uint8Array, trak: ParsedTrak, newId: number): Buffer {
  const out = Buffer.from(src.subarray(trak.start, trak.pe));
  const ver = src[trak.tkhd.ps];
  const off = (trak.tkhd.start - trak.start) + 8 + 4 + (ver === 1 ? 16 : 8);
  writeU32(out, off, newId);
  return out;
}

function shiftChunkOffsets(src: Uint8Array, trak: ParsedTrak, delta: number): Buffer {
  const out = Buffer.from(src.subarray(trak.start, trak.pe));
  const stbl = trak.stbl;
  for (const kind of ['stco', 'co64']) {
    const b = find(childBoxes(src, stbl.ps, stbl.pe), kind);
    if (!b) continue;
    const n = readU32(src, b.ps + 4);
    const base = b.start - trak.start;
    for (let i = 0; i < n; i++) {
      const p = base + 16 + i * (kind === 'stco' ? 4 : 8);
      if (kind === 'stco') {
        writeU32(out, p, (readU32(out, p) + delta) >>> 0);
      } else {
        const v = readU64(out, p);
        const nv = v + BigInt(delta);
        writeU64(out, p, nv);
      }
    }
  }
  return out;
}

/**
 * Merge two single-track progressive MP4 files (video + audio) into a single dual-track progressive MP4.
 * Writes to a temporary file before atomically renaming to destFile.
 */
export async function mergeProgressiveMp4(
  videoFile: string,
  audioFile: string,
  destFile: string,
): Promise<void> {
  const [vBuf, aBuf] = await Promise.all([readFile(videoFile), readFile(audioFile)]);
  const V = parseMp4(new Uint8Array(vBuf), videoFile);
  const A = parseMp4(new Uint8Array(aBuf), audioFile);

  const vTrak = V.traks.find((t) => t.handler === 'vide') ?? V.traks[0];
  const aTrak = A.traks.find((t) => t.handler === 'soun') ?? A.traks[0];
  if (!vTrak || !aTrak) {
    throw new Error('Missing video or audio track for progressive MP4 merge');
  }

  const newTracks: Buffer[] = [];
  newTracks.push(retagTrackId(V.buf, vTrak, 1));
  const audioId = vTrak.trackId === 2 ? 3 : 2;
  newTracks.push(retagTrackId(A.buf, aTrak, audioId));

  // Calculate new mvhd: timescale from video, duration is max in seconds
  const vMvhdVer = V.buf[V.mvhd.ps];
  const aMvhdVer = A.buf[A.mvhd.ps];
  const vMvhdTs = readU32(V.buf, V.mvhd.ps + 4 + (vMvhdVer === 1 ? 16 : 8));
  const aMvhdTs = readU32(A.buf, A.mvhd.ps + 4 + (aMvhdVer === 1 ? 16 : 8));
  const vMvhdDur =
    vMvhdVer === 1 ? Number(readU64(V.buf, V.mvhd.ps + 4 + 20)) : readU32(V.buf, V.mvhd.ps + 4 + 12);
  const aMvhdDur =
    aMvhdVer === 1 ? Number(readU64(A.buf, A.mvhd.ps + 4 + 20)) : readU32(A.buf, A.mvhd.ps + 4 + 12);
  const durSec = Math.max(vMvhdDur / vMvhdTs, aMvhdDur / aMvhdTs);

  const mvhd = Buffer.from(V.buf.subarray(V.mvhd.start, V.mvhd.pe));
  const dOff = 4 + (vMvhdVer === 1 ? 16 : 8) + 4;
  if (vMvhdVer === 1) {
    const nv = BigInt(Math.round(durSec * vMvhdTs));
    writeU64(mvhd, 8 + dOff, nv);
  } else {
    writeU32(mvhd, 8 + dOff, Math.round(durSec * vMvhdTs));
  }

  const others = V.kids
    .filter((k) => k.type !== 'mvhd' && k.type !== 'trak' && k.type !== 'mvex')
    .map((k) => Buffer.from(V.buf.subarray(k.start, k.pe)));

  const mdatPayloadLen = V.mdatPayloadLen + A.mdatPayloadLen;
  const mdatHdr = mdatPayloadLen + 8 > 0xffffffff ? 16 : 8;

  let moov = createBox('moov', mvhd, ...newTracks, ...others);
  let mdatPayloadStart = V.ftyp.size + moov.length + mdatHdr;
  const deltaV = mdatPayloadStart - V.mdatStart;
  const deltaA = mdatPayloadStart + V.mdatPayloadLen - A.mdatStart;

  const fixed = [shiftChunkOffsets(V.buf, vTrak, deltaV), shiftChunkOffsets(A.buf, aTrak, deltaA)];
  const vVer = V.buf[vTrak.tkhd.ps];
  const vOff = (vTrak.tkhd.start - vTrak.start) + 8 + 4 + (vVer === 1 ? 16 : 8);
  writeU32(fixed[0], vOff, 1);

  const aVer = A.buf[aTrak.tkhd.ps];
  const aOff = (aTrak.tkhd.start - aTrak.start) + 8 + 4 + (aVer === 1 ? 16 : 8);
  writeU32(fixed[1], aOff, audioId);

  moov = createBox('moov', mvhd, ...fixed, ...others);
  mdatPayloadStart = V.ftyp.size + moov.length + mdatHdr;

  const dir = dirname(destFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpDest = `${destFile}.tmp-${Date.now()}`;

  const ws = createWriteStream(tmpDest);
  try {
    // Write ftyp
    const ftypBuf = Buffer.from(V.buf.subarray(V.ftyp.start, V.ftyp.pe));
    if (!ws.write(ftypBuf)) await new Promise<void>((r) => ws.once('drain', () => r()));

    // Write moov
    if (!ws.write(moov)) await new Promise<void>((r) => ws.once('drain', () => r()));

    // Write mdat header
    const hdrBuf = Buffer.alloc(mdatHdr);
    if (mdatHdr === 16) {
      writeU32(hdrBuf, 0, 1);
      hdrBuf.write('mdat', 4, 'latin1');
      writeU64(hdrBuf, 8, BigInt(16 + mdatPayloadLen));
    } else {
      writeU32(hdrBuf, 0, 8 + mdatPayloadLen);
      hdrBuf.write('mdat', 4, 'latin1');
    }
    if (!ws.write(hdrBuf)) await new Promise<void>((r) => ws.once('drain', () => r()));

    // Stream video mdat payload
    const vStream = createReadStream(videoFile, {
      start: V.mdatStart,
      end: V.mdatStart + V.mdatPayloadLen - 1,
    });
    await pipeline(vStream, ws, { end: false });

    // Stream audio mdat payload
    const aStream = createReadStream(audioFile, {
      start: A.mdatStart,
      end: A.mdatStart + A.mdatPayloadLen - 1,
    });
    await pipeline(aStream, ws, { end: true });

    // Sync and rename
    const fh = await open(tmpDest, 'r+');
    await fh.sync();
    await fh.close();
    await rename(tmpDest, destFile);
  } catch (err) {
    ws.destroy();
    await rm(tmpDest, { force: true }).catch(() => {});
    throw err;
  }
}
