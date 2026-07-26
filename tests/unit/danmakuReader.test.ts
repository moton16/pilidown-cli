/**
 * pilidown - Unit tests for danmakuReader (手写 protobuf 解码器)
 * Original: tests are original to pilidown.
 *
 * We construct protobuf bytes by hand to avoid pulling in a protobuf library.
 * Wire format reference:
 *   tag = (field_number << 3) | wire_type
 *   wire 0 = varint, wire 2 = length-delimited
 */

import { parseDanmaku, encodeVarint } from '../../src/core/danmakuReader';
import type { BiliDanmaku } from '../../src/types/bili';

// ---- helpers to build protobuf bytes by hand ----

function tag(field: number, wireType: number): number {
  return (field << 3) | wireType;
}

function varintField(field: number, value: number): number[] {
  return [...encodeVarint(tag(field, 0)), ...encodeVarint(value)];
}

function stringField(field: number, value: string): number[] {
  const bytes = Array.from(Buffer.from(value, 'utf8'));
  return [...encodeVarint(tag(field, 2)), ...encodeVarint(bytes.length), ...bytes];
}

/** Wrap a DanmakuElem body as a length-delimited field 2 of DmSegMobileReply. */
function wrapElem(elemBytes: number[]): number[] {
  return [...encodeVarint(tag(2, 2)), ...encodeVarint(elemBytes.length), ...elemBytes];
}

function buildSeg(elems: number[][]): Buffer {
  const out: number[] = [];
  for (const e of elems) out.push(...wrapElem(e));
  return Buffer.from(out);
}

function buildElem(fields: {
  id?: number;
  progress?: number;
  mode?: number;
  fontsize?: number;
  color?: number;
  midHash?: string;
  content?: string;
  ctime?: number;
  weight?: number;
  action?: string;
  pool?: number;
}): number[] {
  const out: number[] = [];
  if (fields.id !== undefined) out.push(...varintField(1, fields.id));
  if (fields.progress !== undefined) out.push(...varintField(2, fields.progress));
  if (fields.mode !== undefined) out.push(...varintField(3, fields.mode));
  if (fields.fontsize !== undefined) out.push(...varintField(4, fields.fontsize));
  if (fields.color !== undefined) out.push(...varintField(5, fields.color));
  if (fields.midHash !== undefined) out.push(...stringField(6, fields.midHash));
  if (fields.content !== undefined) out.push(...stringField(7, fields.content));
  if (fields.ctime !== undefined) out.push(...varintField(8, fields.ctime));
  if (fields.weight !== undefined) out.push(...varintField(9, fields.weight));
  if (fields.action !== undefined) out.push(...stringField(10, fields.action));
  if (fields.pool !== undefined) out.push(...varintField(11, fields.pool));
  return out;
}

// ---- tests ----

describe('encodeVarint', () => {
  test('encodes 0 as single byte', () => {
    expect(encodeVarint(0)).toEqual([0]);
  });

  test('encodes 127 as single byte', () => {
    expect(encodeVarint(127)).toEqual([0x7f]);
  });

  test('encodes 128 as two bytes', () => {
    expect(encodeVarint(128)).toEqual([0x80, 0x01]);
  });

  test('encodes 300 as two bytes (protobuf canonical example)', () => {
    expect(encodeVarint(300)).toEqual([0xac, 0x02]);
  });
});

describe('parseDanmaku', () => {
  test('returns empty array for empty buffer', () => {
    expect(parseDanmaku(Buffer.alloc(0))).toEqual([]);
  });

  test('parses a single scroll danmaku with all fields', () => {
    const elem = buildElem({
      id: 1234567890,
      progress: 1500,
      mode: 1,
      fontsize: 25,
      color: 0xffffff,
      midHash: 'abc123def',
      content: '前方高能',
      ctime: 1700000000,
      weight: 8,
      action: '',
      pool: 0,
    });
    const buf = buildSeg([elem]);
    const list = parseDanmaku(buf);
    expect(list).toHaveLength(1);
    const d = list[0];
    expect(d.id).toBe(1234567890);
    expect(d.progress).toBe(1500);
    expect(d.mode).toBe(1);
    expect(d.fontsize).toBe(25);
    expect(d.color).toBe(0xffffff);
    expect(d.midHash).toBe('abc123def');
    expect(d.content).toBe('前方高能');
    expect(d.ctime).toBe(1700000000);
    expect(d.weight).toBe(8);
    expect(d.action).toBe('');
    expect(d.pool).toBe(0);
  });

  test('parses a single danmaku with only required fields (defaults for missing)', () => {
    // Only id + content provided.
    const elem = buildElem({ id: 42, content: 'hi' });
    const buf = buildSeg([elem]);
    const list = parseDanmaku(buf);
    expect(list).toHaveLength(1);
    const d = list[0];
    expect(d.id).toBe(42);
    expect(d.content).toBe('hi');
    // Missing fields default to zero / empty.
    expect(d.progress).toBe(0);
    expect(d.mode).toBe(0);
    expect(d.fontsize).toBe(0);
    expect(d.color).toBe(0);
    expect(d.midHash).toBe('');
    expect(d.ctime).toBe(0);
    expect(d.weight).toBe(0);
    expect(d.action).toBe('');
    expect(d.pool).toBe(0);
  });

  test('parses multiple danmaku in order', () => {
    const e1 = buildElem({ id: 1, content: 'first', progress: 100 });
    const e2 = buildElem({ id: 2, content: 'second', progress: 200 });
    const e3 = buildElem({ id: 3, content: 'third', progress: 300 });
    const buf = buildSeg([e1, e2, e3]);
    const list = parseDanmaku(buf);
    expect(list.map(d => d.id)).toEqual([1, 2, 3]);
    expect(list.map(d => d.content)).toEqual(['first', 'second', 'third']);
    expect(list.map(d => d.progress)).toEqual([100, 200, 300]);
  });

  test('parses top/bottom mode danmaku (mode 4 and 5)', () => {
    const top = buildElem({ id: 1, mode: 5, content: 'TOP' });
    const bot = buildElem({ id: 2, mode: 4, content: 'BOT' });
    const buf = buildSeg([top, bot]);
    const list = parseDanmaku(buf);
    expect(list[0].mode).toBe(5);
    expect(list[1].mode).toBe(4);
  });

  test('skips unknown fields gracefully (forward-compatible)', () => {
    // Add an unknown varint field 99 and an unknown length-delimited field 100.
    const elem = [
      ...varintField(1, 999),
      ...varintField(99, 7),                          // unknown varint
      ...stringField(100, 'unknown-bytes-payload'),  // unknown length-delimited
      ...stringField(7, 'content-with-extras'),
    ];
    const buf = buildSeg([elem]);
    const list = parseDanmaku(buf);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(999);
    expect(list[0].content).toBe('content-with-extras');
  });

  test('parses chinese content (utf-8 multibyte)', () => {
    const elem = buildElem({ id: 1, content: '23333 哈哈哈哈 🎉' });
    const buf = buildSeg([elem]);
    const list = parseDanmaku(buf);
    expect(list[0].content).toBe('23333 哈哈哈哈 🎉');
  });

  test('parses large varint (id near 2^31)', () => {
    const bigId = 2_000_000_000; // fits in int32, but exercises multi-byte varint
    const elem = buildElem({ id: bigId, content: 'big' });
    const buf = buildSeg([elem]);
    const list = parseDanmaku(buf);
    expect(list[0].id).toBe(bigId);
  });

  test('returns empty array when seg has no elems (only unknown top-level fields)', () => {
    // Top-level field 1 (closed bool) but no field 2 (elems).
    const buf = Buffer.from(varintField(1, 1));
    expect(parseDanmaku(buf)).toEqual([]);
  });

  test('handles BiliDanmaku type shape (compile-time check)', () => {
    const d: BiliDanmaku = {
      id: 1, progress: 0, mode: 1, fontsize: 25, color: 0xffffff,
      midHash: '', content: '', ctime: 0, weight: 0, action: '', pool: 0,
    };
    expect(d.id).toBe(1);
  });
});
