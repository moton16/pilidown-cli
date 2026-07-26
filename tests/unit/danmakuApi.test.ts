/**
 * pilidown - Unit tests for DanmakuApi (mocked downloadBuffer)
 * Original: tests are original to pilidown.
 */

import { getDanmakuList } from '../../src/api/DanmakuApi';
import { parseDanmaku } from '../../src/core/danmakuReader';
import * as httpClient from '../../src/utils/httpClient';
import type { BiliDanmaku } from '../../src/types/bili';

// Build a real protobuf segment so the API exercises the real parser end-to-end.
function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v & 0x7f);
  return out;
}

function buildElemBytes(fields: { id?: number; progress?: number; mode?: number; content?: string }): number[] {
  const out: number[] = [];
  if (fields.id !== undefined) out.push(0x08, ...encodeVarint(fields.id));
  if (fields.progress !== undefined) out.push(0x10, ...encodeVarint(fields.progress));
  if (fields.mode !== undefined) out.push(0x18, ...encodeVarint(fields.mode));
  if (fields.content !== undefined) {
    const bytes = Array.from(Buffer.from(fields.content, 'utf8'));
    out.push(0x3a, ...encodeVarint(bytes.length), ...bytes);
  }
  return out;
}

function buildSegBuffer(elems: Array<ReturnType<typeof buildElemBytes>>): Buffer {
  // ponytail: DmSegMobileReply schema — field 1 = repeated DanmakuElem.
  // tag byte = (1 << 3) | 2 = 0x0a (NOT 0x12 which would be field 2).
  const out: number[] = [];
  for (const e of elems) {
    out.push(0x0a, ...encodeVarint(e.length), ...e);
  }
  return Buffer.from(out);
}

let downloadBufferSpy: jest.SpyInstance;

beforeEach(() => {
  downloadBufferSpy = jest.spyOn(httpClient, 'downloadBuffer');
});

afterEach(() => {
  downloadBufferSpy.mockRestore();
  jest.restoreAllMocks();
});

describe('getDanmakuList', () => {
  test('single segment with fewer than 1000 danmaku stops after one fetch', async () => {
    const seg = buildSegBuffer([
      buildElemBytes({ id: 1, progress: 100, mode: 1, content: 'hello' }),
      buildElemBytes({ id: 2, progress: 200, mode: 4, content: 'bottom' }),
    ]);
    downloadBufferSpy.mockResolvedValueOnce(seg);

    const list = await getDanmakuList({ aid: 12345, cid: 67890 });
    expect(list).toHaveLength(2);
    expect(list[0].content).toBe('hello');
    expect(list[1].content).toBe('bottom');
    expect(downloadBufferSpy).toHaveBeenCalledTimes(1);
    const url = downloadBufferSpy.mock.calls[0][0] as string;
    expect(url).toContain('https://api.bilibili.com/x/v2/dm/web/seg.so');
    expect(url).toContain('oid=67890');
    expect(url).toContain('segment_index=1');
    expect(url).toContain('type=1');
  });

  test('stops when a segment returns empty buffer', async () => {
    downloadBufferSpy.mockResolvedValueOnce(Buffer.alloc(0));
    const list = await getDanmakuList({ aid: 1, cid: 2 });
    expect(list).toEqual([]);
    expect(downloadBufferSpy).toHaveBeenCalledTimes(1);
  });

  test('stops when a segment parses to 0 danmaku (non-empty buffer)', async () => {
    // A buffer with only an unknown top-level field, no elems.
    downloadBufferSpy.mockResolvedValueOnce(Buffer.from([0x08, 0x01]));
    const list = await getDanmakuList({ aid: 1, cid: 2 });
    expect(list).toEqual([]);
    expect(downloadBufferSpy).toHaveBeenCalledTimes(1);
  });

  test('fetches multiple segments while count == 1000, stops at <1000', async () => {
    // Segment 1: 1000 danmakus → continue.
    const many1: BiliDanmaku[] = [];
    const elems1: number[][] = [];
    for (let i = 0; i < 1000; i++) {
      const id = i + 1;
      many1.push({ id, progress: 0, mode: 1, fontsize: 0, color: 0, midHash: '', content: '', ctime: 0, weight: 0, action: '', pool: 0 });
      elems1.push(buildElemBytes({ id, progress: i, mode: 1, content: `d${i}` }));
    }
    // Segment 2: 500 danmakus → stop after this.
    const elems2: number[][] = [];
    for (let i = 0; i < 500; i++) {
      const id = 1000 + i + 1;
      elems2.push(buildElemBytes({ id, progress: i, mode: 1, content: `e${i}` }));
    }
    downloadBufferSpy.mockResolvedValueOnce(buildSegBuffer(elems1));
    downloadBufferSpy.mockResolvedValueOnce(buildSegBuffer(elems2));

    const list = await getDanmakuList({ aid: 1, cid: 2 });
    expect(list).toHaveLength(1500);
    expect(list[0].content).toBe('d0');
    expect(list[999].content).toBe('d999');
    expect(list[1000].content).toBe('e0');
    expect(list[1499].content).toBe('e499');
    expect(downloadBufferSpy).toHaveBeenCalledTimes(2);

    const url1 = downloadBufferSpy.mock.calls[0][0] as string;
    const url2 = downloadBufferSpy.mock.calls[1][0] as string;
    expect(url1).toContain('segment_index=1');
    expect(url2).toContain('segment_index=2');
  });

  test('accepts bvid instead of aid (bvid does not appear in seg.so URL)', async () => {
    downloadBufferSpy.mockResolvedValueOnce(Buffer.alloc(0));
    await getDanmakuList({ bvid: 'BV1xx411c7mD', cid: 99 });
    expect(downloadBufferSpy).toHaveBeenCalledTimes(1);
    const url = downloadBufferSpy.mock.calls[0][0] as string;
    expect(url).toContain('oid=99');
    // seg.so does not require pid; bvid alone is sufficient
    expect(url).not.toContain('bvid');
  });

  test('parses real-shape parser output (cross-check with parseDanmaku)', async () => {
    const seg = buildSegBuffer([
      buildElemBytes({ id: 42, progress: 1234, mode: 5, content: 'TOP' }),
    ]);
    downloadBufferSpy.mockResolvedValueOnce(seg);
    const list = await getDanmakuList({ aid: 1, cid: 2 });
    const expected = parseDanmaku(seg);
    expect(list).toEqual(expected);
  });

  test('attaches cookies to the request when provided', async () => {
    const cookieData = { SESSDATA: 'abc' };
    downloadBufferSpy.mockResolvedValueOnce(Buffer.alloc(0));
    await getDanmakuList({ aid: 1, cid: 2 }, { cookies: cookieData });
    expect(downloadBufferSpy).toHaveBeenCalledTimes(1);
    const opts = downloadBufferSpy.mock.calls[0][1] ?? {};
    expect(opts.cookies).toEqual(cookieData);
  });
});
