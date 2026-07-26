/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# source: src/DownKyi.Core/BiliApi/Danmaku/DanmakuProtobuf.cs
 *
 * Hand-written protobuf reader for DmSegMobileReply / DanmakuElem.
 * Why hand-written? The protobuf schema is tiny (1 wrapper + 1 elem message,
 * 11 scalar fields) and pulling in protobufjs would add ~150KB to the bundle
 * for no real benefit. YAGNI.
 *
 * Wire format cheat sheet:
 *   tag byte = (field_number << 3) | wire_type
 *   wire 0 = varint     (int32/int64/uint32/bool)
 *   wire 2 = length-delimited (string/bytes/embedded message)
 *   wire 1 = 64-bit fixed (unused here)
 *   wire 5 = 32-bit fixed (unused here)
 *
 * DmSegMobileReply { bool closed = 1; repeated DanmakuElem elems = 2; }
 * DanmakuElem { int64 id=1; int32 progress=2; int32 mode=3; int32 fontsize=4;
 *               uint32 color=5; string midHash=6; string content=7;
 *               int64 ctime=8; int32 weight=9; string action=10; int32 pool=11; }
 */

import type { BiliDanmaku } from '../types/bili';

/** Encode an unsigned integer as a protobuf varint. Exported for tests. */
export function encodeVarint(value: number): number[] {
  if (value < 0) {
    // Negative numbers in protobuf varints are encoded as 10-byte int64.
    // We don't emit those in tests, but guard against infinite loops.
    throw new Error('encodeVarint only supports non-negative values');
  }
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v & 0x7f);
  return out;
}

/** Decode a varint starting at offset; returns [value, nextOffset]. */
function readVarint(buf: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let i = offset;
  // protobuf varints are at most 10 bytes (64-bit). Cap to avoid runaway.
  for (let step = 0; step < 10; step++) {
    if (i >= buf.length) {
      throw new Error('readVarint: unexpected end of buffer');
    }
    const byte = buf[i];
    i += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [result >>> 0, i];
    }
    shift += 7;
  }
  throw new Error('readVarint: varint too long');
}

/** Read a length-delimited field; returns [payloadBuffer, nextOffset]. */
function readLengthDelimited(buf: Buffer, offset: number): [Buffer, number] {
  const [len, afterLen] = readVarint(buf, offset);
  const start = afterLen;
  const end = start + len;
  if (end > buf.length) {
    throw new Error('readLengthDelimited: length exceeds buffer');
  }
  return [buf.subarray(start, end), end];
}

/** Skip a single protobuf field given its tag, return next offset. */
function skipField(buf: Buffer, offset: number, wireType: number): number {
  switch (wireType) {
    case 0: { // varint
      const [, next] = readVarint(buf, offset);
      return next;
    }
    case 1: { // 64-bit fixed
      return offset + 8;
    }
    case 2: { // length-delimited
      const [, next] = readLengthDelimited(buf, offset);
      return next;
    }
    case 5: { // 32-bit fixed
      return offset + 4;
    }
    default:
      throw new Error(`skipField: unsupported wire type ${wireType}`);
  }
}

/** Parse a DanmakuElem body (without the outer length-delimited wrapper). */
function parseDanmakuElem(body: Buffer): BiliDanmaku {
  const d: BiliDanmaku = {
    id: 0,
    progress: 0,
    mode: 0,
    fontsize: 0,
    color: 0,
    midHash: '',
    content: '',
    ctime: 0,
    weight: 0,
    action: '',
    pool: 0,
  };
  let offset = 0;
  while (offset < body.length) {
    const [tag, afterTag] = readVarint(body, offset);
    offset = afterTag;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    switch (fieldNumber) {
      case 1: { // id, int64
        const [v, next] = readVarint(body, offset);
        d.id = v;
        offset = next;
        break;
      }
      case 2: { // progress, int32
        const [v, next] = readVarint(body, offset);
        d.progress = v;
        offset = next;
        break;
      }
      case 3: { // mode, int32
        const [v, next] = readVarint(body, offset);
        d.mode = v;
        offset = next;
        break;
      }
      case 4: { // fontsize, int32
        const [v, next] = readVarint(body, offset);
        d.fontsize = v;
        offset = next;
        break;
      }
      case 5: { // color, uint32
        const [v, next] = readVarint(body, offset);
        d.color = v;
        offset = next;
        break;
      }
      case 6: { // midHash, string
        const [payload, next] = readLengthDelimited(body, offset);
        d.midHash = payload.toString('utf8');
        offset = next;
        break;
      }
      case 7: { // content, string
        const [payload, next] = readLengthDelimited(body, offset);
        d.content = payload.toString('utf8');
        offset = next;
        break;
      }
      case 8: { // ctime, int64
        const [v, next] = readVarint(body, offset);
        d.ctime = v;
        offset = next;
        break;
      }
      case 9: { // weight, int32
        const [v, next] = readVarint(body, offset);
        d.weight = v;
        offset = next;
        break;
      }
      case 10: { // action, string
        const [payload, next] = readLengthDelimited(body, offset);
        d.action = payload.toString('utf8');
        offset = next;
        break;
      }
      case 11: { // pool, int32
        const [v, next] = readVarint(body, offset);
        d.pool = v;
        offset = next;
        break;
      }
      default:
        // Forward compatibility: skip unknown fields.
        offset = skipField(body, offset, wireType);
        break;
    }
  }
  return d;
}

/**
 * Parse a DmSegMobileReply buffer (the body returned by /x/v2/dm/web/seg.so)
 * into a list of BiliDanmaku. Returns an empty array for empty/invalid input.
 */
export function parseDanmaku(buffer: Buffer): BiliDanmaku[] {
  const out: BiliDanmaku[] = [];
  if (!buffer || buffer.length === 0) return out;
  let offset = 0;
  while (offset < buffer.length) {
    let tag: number;
    let afterTag: number;
    try {
      [tag, afterTag] = readVarint(buffer, offset);
    } catch {
      // Truncated trailing bytes — bail out gracefully.
      return out;
    }
    offset = afterTag;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    if (fieldNumber === 2 && wireType === 2) {
      // elems (repeated DanmakuElem)
      const [payload, next] = readLengthDelimited(buffer, offset);
      offset = next;
      try {
        out.push(parseDanmakuElem(payload));
      } catch {
        // Skip malformed elem rather than failing the whole segment.
      }
    } else {
      // Skip any other top-level field (e.g. closed=1) gracefully.
      try {
        offset = skipField(buffer, offset, wireType);
      } catch {
        return out;
      }
    }
  }
  return out;
}
