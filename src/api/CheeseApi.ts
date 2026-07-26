/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/Cheese/CheeseInfo.cs (CheeseViewInfo)
 *   - src/DownKyi.Core/BiliApi/VideoStream/VideoStream.cs (GetCheesePlayUrl)
 *
 * 注意：课程接口走 /pugv/ 前缀。
 * - /pugv/view/web/season 返回 `data` 字段（参考 C# CheeseViewOrigin.Data）
 * - /pugv/player/web/playurl 返回 `result` 或 `data`（biliGet 已统一处理 fallback）
 * 课程流地址接口**不需要 WBI 签名**，但**必须带 ep_id**（C# 注释明确说明）。
 */

import { biliGet } from '../utils/httpClient';
import { FNVAL_DEFAULT } from '../core/constants';
import type { PlayUrlResponse, CheeseSeasonInfo } from '../types/bili';

const SEASON_URL = 'https://api.bilibili.com/pugv/view/web/season';
const PLAYURL_URL = 'https://api.bilibili.com/pugv/player/web/playurl';

/**
 * 获取课程（季）信息。
 * 调用 GET /pugv/view/web/season?season_id=<seasonId>。
 * 对应 C# CheeseInfo.CheeseViewInfo(seasonId)。
 */
export async function getSeasonInfo(seasonId: string | number): Promise<CheeseSeasonInfo> {
  if (seasonId === undefined || seasonId === null || seasonId === '') {
    throw new Error('getSeasonInfo requires seasonId');
  }
  const url = `${SEASON_URL}?season_id=${encodeURIComponent(String(seasonId))}`;
  return biliGet<CheeseSeasonInfo>(url);
}

/**
 * 通过 ep_id 获取课程（季）信息。
 * 调用 GET /pugv/view/web/season?ep_id=<epId>。
 * 对应 C# CheeseInfo.CheeseViewInfo(episodeId)。
 */
export async function getSeasonInfoByEpisode(epId: number): Promise<CheeseSeasonInfo> {
  if (!epId) throw new Error('getSeasonInfoByEpisode requires epId');
  const url = `${SEASON_URL}?ep_id=${encodeURIComponent(String(epId))}`;
  return biliGet<CheeseSeasonInfo>(url);
}

/**
 * 获取课程单集流地址。
 * 调用 GET /pugv/player/web/playurl?ep_id=<epId>&cid=<cid>&qn=<qn>&fourk=1&fnver=0&fnval=4048
 * 对应 C# VideoStream.GetCheesePlayUrl(avid, bvid, cid, episodeId, quality)。
 *
 * 注意：课程流地址接口**不带 WBI 签名**，**必须带 ep_id**（否则返回请求错误）。
 */
export async function getEpisodePlayUrl(
  epId: number,
  cid: number,
  qn: number = 127,
): Promise<PlayUrlResponse> {
  if (!epId) throw new Error('getEpisodePlayUrl requires epId (cheese playurl 无法仅靠 cid 工作)');
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
