/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/Video/VideoInfo.cs (VideoViewInfo)
 *   - src/DownKyi.Core/BiliApi/VideoStream/VideoStream.cs (GetVideoPlayUrl, PlayerV2)
 *   - src/DownKyi.Core/BiliApi/Sign/WbiSign.cs (EncodeWbi/ParametersToQuery)
 *
 * Note: nav-related WBI key fetch lives in services/WbiKeyManager.ts.
 * This file exposes the high-level video/player APIs used by commands.
 */

import { biliGet } from '../utils/httpClient';
import { signWbiQuery } from '../utils/wbiSign';
import { FNVAL_DEFAULT } from '../core/constants';
import type { BiliNavData, VideoInfo, PlayUrlResponse, PlayerV2Info } from '../types/bili';

/** GET /x/web-interface/nav — login state + WBI keys (anonymous OK). */
export async function getNavInfo(): Promise<BiliNavData> {
  return biliGet<BiliNavData>('https://api.bilibili.com/x/web-interface/nav');
}

/** GET /x/web-interface/wbi/view — video metadata (WBI signed). */
export async function getVideoInfo(opts: { bvid?: string; aid?: number }): Promise<VideoInfo> {
  const params: Record<string, string | number> = {};
  if (opts.bvid) params.bvid = opts.bvid;
  else if (opts.aid !== undefined) params.aid = opts.aid;
  else throw new Error('getVideoInfo requires bvid or aid');
  const query = await signWbiQuery(params);
  return biliGet<VideoInfo>(`https://api.bilibili.com/x/web-interface/wbi/view?${query}`);
}

/** GET /x/player/wbi/playurl — video stream URL (WBI signed). */
export async function getPlayUrl(opts: {
  bvid?: string;
  aid?: number;
  cid: number;
  qn?: number;
  fnval?: number;
}): Promise<PlayUrlResponse> {
  const params: Record<string, string | number> = {
    from_client: 'BROWSER',
    fourk: 1,
    fnver: 0,
    fnval: opts.fnval ?? FNVAL_DEFAULT,
    cid: opts.cid,
    qn: opts.qn ?? 127,
  };
  if (opts.bvid) params.bvid = opts.bvid;
  else if (opts.aid !== undefined) params.aid = opts.aid;
  else throw new Error('getPlayUrl requires bvid or aid');
  const query = await signWbiQuery(params);
  return biliGet<PlayUrlResponse>(`https://api.bilibili.com/x/player/wbi/playurl?${query}`);
}

/** GET /x/player/wbi/v2 — player info (subtitle list, etc.) (WBI signed). M7 uses this. */
export async function getPlayerInfo(opts: {
  bvid?: string;
  aid?: number;
  cid: number;
}): Promise<PlayerV2Info> {
  const params: Record<string, string | number> = { cid: opts.cid };
  if (opts.bvid) params.bvid = opts.bvid;
  else if (opts.aid !== undefined) params.aid = opts.aid;
  else throw new Error('getPlayerInfo requires bvid or aid');
  const query = await signWbiQuery(params);
  return biliGet<PlayerV2Info>(`https://api.bilibili.com/x/player/wbi/v2?${query}`);
}
