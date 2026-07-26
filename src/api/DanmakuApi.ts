/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# source: src/DownKyi.Core/BiliApi/Danmaku/DanmakuProtobuf.cs
 *
 * Fetches danmaku segments from /x/v2/dm/web/seg.so and decodes the protobuf
 * body using the hand-written parser in core/danmakuReader.ts.
 *
 * The seg.so endpoint returns raw protobuf bytes (NOT JSON), so we use
 * downloadBuffer instead of biliGet. Each segment covers ~6 minutes of video.
 * We loop segment_index=1..N until a segment returns 0 danmaku or fewer than
 * 1000 (the per-segment cap), matching the C# GetAllDanmakuProto behavior.
 */

import { downloadBuffer } from '../utils/httpClient';
import { parseDanmaku } from '../core/danmakuReader';
import type { BiliDanmaku } from '../types/bili';

const SEG_URL = 'https://api.bilibili.com/x/v2/dm/web/seg.so';
const SEGMENT_CAP = 1000;

export interface GetDanmakuListOptions {
  aid?: number;
  bvid?: string;
  cid: number;
  cookies?: Record<string, string>;
}

export interface DanmakuFetchResult {
  /** All parsed danmaku across fetched segments. */
  danmaku: BiliDanmaku[];
  /** Concatenated raw protobuf bytes of all fetched segments (for --format raw). */
  rawBuffer: Buffer;
}

/**
 * Low-level: loop segments and return both parsed danmaku and concatenated raw bytes.
 * Used by `danmaku` command for `--format raw` (preserves the original seg.so bytes).
 */
export async function fetchDanmakuSegments(
  opts: GetDanmakuListOptions,
  httpOpts: { cookies?: Record<string, string> } = {},
): Promise<DanmakuFetchResult> {
  if (!opts.cid) throw new Error('fetchDanmakuSegments requires cid');
  const cookies = httpOpts.cookies ?? opts.cookies;
  const all: BiliDanmaku[] = [];
  const rawChunks: Buffer[] = [];
  let segmentIndex = 0;
  // Safety cap: B站单视频分片实际远小于此值（每片6分钟，足够 100 小时视频）。
  const MAX_SEGMENTS = 1000;
  while (segmentIndex < MAX_SEGMENTS) {
    segmentIndex += 1;
    const url = buildSegUrl(opts.cid, opts.aid, segmentIndex);
    const buf = await downloadBuffer(url, { cookies });
    if (buf.length === 0) break;
    const segment = parseDanmaku(buf);
    if (segment.length === 0) break;
    rawChunks.push(buf);
    all.push(...segment);
    if (segment.length < SEGMENT_CAP) break;
  }
  return { danmaku: all, rawBuffer: Buffer.concat(rawChunks) };
}

/**
 * Fetch all danmaku for a video cid by looping segments until exhausted.
 * Returns the concatenated list (sorted by progress ms as a side effect of
 * the segment ordering, mirroring C# behavior).
 */
export async function getDanmakuList(
  opts: GetDanmakuListOptions,
  httpOpts: { cookies?: Record<string, string> } = {},
): Promise<BiliDanmaku[]> {
  const result = await fetchDanmakuSegments(opts, httpOpts);
  return result.danmaku;
}

function buildSegUrl(cid: number, aid: number | undefined, segmentIndex: number): string {
  const params = new URLSearchParams();
  params.set('type', '1');
  params.set('oid', String(cid));
  if (aid !== undefined) params.set('pid', String(aid));
  params.set('segment_index', String(segmentIndex));
  return `${SEG_URL}?${params.toString()}`;
}
