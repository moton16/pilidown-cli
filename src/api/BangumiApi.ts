/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/Bangumi/BangumiInfo.cs (season info + media lookup)
 *   - src/DownKyi.Core/BiliApi/VideoStream/VideoStream.cs (GetBangumiPlayUrl)
 *
 * 注意：番剧接口走 /pgc/ 前缀，返回 `result` 字段（而非 `data`），
 * 由 biliGet 统一处理 code===0 + result/data fallback。
 * 番剧流地址接口**不需要 WBI 签名**，直接拼接 query 即可。
 */

import { biliGet } from '../utils/httpClient';
import { FNVAL_DEFAULT } from '../core/constants';
import type { PlayUrlResponse, BangumiSeasonInfo, BangumiMediaInfo } from '../types/bili';

const SEASON_URL = 'https://api.bilibili.com/pgc/view/web/season';
const PLAYURL_URL = 'https://api.bilibili.com/pgc/player/web/playurl';
const MEDIA_REVIEW_URL = 'https://api.bilibili.com/pgc/review/user';

/**
 * 获取番剧（季）信息。
 * 调用 GET /pgc/view/web/season?season_id=<seasonId>。
 * 对应 C# BangumiInfo.BangumiSeasonInfo(seasonId)。
 */
export async function getSeasonInfo(seasonId: string | number): Promise<BangumiSeasonInfo> {
  if (seasonId === undefined || seasonId === null || seasonId === '') {
    throw new Error('getSeasonInfo requires seasonId');
  }
  const url = `${SEASON_URL}?season_id=${encodeURIComponent(String(seasonId))}`;
  return biliGet<BangumiSeasonInfo>(url);
}

/**
 * 通过 ep_id 获取番剧（季）信息。
 * 调用 GET /pgc/view/web/season?ep_id=<epId>。
 * 对应 C# BangumiInfo.BangumiSeasonInfo(episodeId)。
 */
export async function getSeasonInfoByEpisode(epId: number): Promise<BangumiSeasonInfo> {
  if (!epId) throw new Error('getSeasonInfoByEpisode requires epId');
  const url = `${SEASON_URL}?ep_id=${encodeURIComponent(String(epId))}`;
  return biliGet<BangumiSeasonInfo>(url);
}

/**
 * 获取番剧单集流地址。
 * 调用 GET /pgc/player/web/playurl?ep_id=<epId>&cid=<cid>&qn=<qn>&fourk=1&fnver=0&fnval=4048
 * 对应 C# VideoStream.GetBangumiPlayUrl(avid, bvid, cid, quality)。
 *
 * 注意：番剧流地址接口**不带 WBI 签名**，必须带 ep_id（剧集 ID）。
 */
export async function getEpisodePlayUrl(
  epId: number,
  cid: number,
  qn: number = 127,
): Promise<PlayUrlResponse> {
  if (!epId) throw new Error('getEpisodePlayUrl requires epId');
  if (!cid) throw new Error('getEpisodePlayUrl requires cid');
  const params = new URLSearchParams({
    ep_id: String(epId),
    cid: String(cid),
    qn: String(qn),
    fourk: '1',
    fnver: '0',
    fnval: String(FNVAL_DEFAULT),
  });
  const url = `${PLAYURL_URL}?${params.toString()}`;
  return biliGet<PlayUrlResponse>(url);
}

/**
 * 通过 media_id（md 号）查询番剧 season_id 与基础信息。
 * 调用 GET /pgc/review/user?media_id=<mediaId>。
 * 对应 C# BangumiInfo.BangumiMediaInfo(mediaId)。
 *
 * 返回 result.media 子对象。
 */
export async function getSeasonByMediaId(
  mediaId: number,
): Promise<BangumiMediaInfo> {
  if (!mediaId) throw new Error('getSeasonByMediaId requires mediaId');
  const url = `${MEDIA_REVIEW_URL}?media_id=${encodeURIComponent(String(mediaId))}`;
  // /pgc/review/user 返回 { code, message, result: { media: {...} } }
  const wrapped = await biliGet<{ media: BangumiMediaInfo }>(url);
  if (!wrapped || !wrapped.media) {
    throw new Error(`media not found in /pgc/review/user response for media_id=${mediaId}`);
  }
  return wrapped.media;
}
