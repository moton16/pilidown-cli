/**
 * pilidown - Shared MP4 / fMP4 box parsing and manipulation utilities
 * Zero external dependencies, pure byte-level box surgery.
 */

export function readU16(b: Buffer | Uint8Array, o: number): number {
  return ((b[o] << 8) | b[o + 1]) >>> 0;
}

export function readU32(b: Buffer | Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function readU64(b: Buffer | Uint8Array, o: number): bigint {
  return (BigInt(readU32(b, o)) << 32n) | BigInt(readU32(b, o + 4));
}

export function writeU32(b: Buffer | Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 255;
  b[o + 1] = (v >>> 16) & 255;
  b[o + 2] = (v >>> 8) & 255;
  b[o + 3] = v & 255;
}

export function writeU64(b: Buffer | Uint8Array, o: number, v: bigint): void {
  writeU32(b, o, Number(v >> 32n) >>> 0);
  writeU32(b, o + 4, Number(v & 0xffffffffn) >>> 0);
}

export function ascii(b: Buffer | Uint8Array, o: number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]);
  return s;
}

export function boxType(b: Buffer | Uint8Array, o: number): string {
  return ascii(b, o + 4, 4);
}

export function boxSize(b: Buffer | Uint8Array, o: number): number {
  let sz = readU32(b, o);
  if (sz === 1) sz = Number(readU64(b, o + 8));
  return sz;
}

export interface BoxEntry {
  type: string;
  start: number;
  size: number;
  hdr: number;
  ps: number; // payload start
  pe: number; // payload end
}

export function topBoxes(buf: Buffer | Uint8Array): BoxEntry[] {
  const out: BoxEntry[] = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    let size = readU32(buf, off);
    let hdr = 8;
    if (size === 1) {
      if (off + 16 > buf.length) break;
      size = Number(readU64(buf, off + 8));
      hdr = 16;
    } else if (size === 0) {
      size = buf.length - off;
    }
    if (size < hdr || off + size > buf.length) break;
    out.push({
      type: ascii(buf, off + 4, 4),
      start: off,
      size,
      hdr,
      ps: off + hdr,
      pe: off + size,
    });
    off += size;
  }
  return out;
}

export function childBoxes(buf: Buffer | Uint8Array, start: number, end: number): BoxEntry[] {
  const out: BoxEntry[] = [];
  let off = start;
  while (off + 8 <= end) {
    let size = readU32(buf, off);
    let hdr = 8;
    if (size === 1) {
      if (off + 16 > end) break;
      size = Number(readU64(buf, off + 8));
      hdr = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < hdr || off + size > end) break;
    out.push({
      type: ascii(buf, off + 4, 4),
      start: off,
      size,
      hdr,
      ps: off + hdr,
      pe: off + size,
    });
    off += size;
  }
  return out;
}

export function find(boxes: BoxEntry[], type: string): BoxEntry | undefined {
  return boxes.find((b) => b.type === type);
}

export function findAll(boxes: BoxEntry[], type: string): BoxEntry[] {
  return boxes.filter((b) => b.type === type);
}

export function createBox(type: string, ...payloads: (Buffer | Uint8Array)[]): Buffer {
  const payloadLen = payloads.reduce((acc, p) => acc + p.length, 0);
  const out = Buffer.alloc(8 + payloadLen);
  writeU32(out, 0, 8 + payloadLen);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let off = 8;
  for (const p of payloads) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
