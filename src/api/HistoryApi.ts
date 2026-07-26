/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/History/History.cs (历史记录)
 *   - src/DownKyi.Core/BiliApi/History/ToView.cs (稍后再看)
 *
 * 历史记录与"稍后再看" API。两个接口都需要登录态，调用方必须传入
 * 从 CookieService.loadCookies() 取得的 cookies。
 */

import { biliGet } from '../utils/httpClient';
import type { HistoryItem, ToViewVideo } from '../types/bili';

const HISTORY_URL = 'https://api.bilibili.com/x/v2/history';
const TOVIEW_URL = 'https://api.bilibili.com/x/v2/history/toview/web';

interface HistoryData {
  // 现代接口 /x/v2/history?pn=<n> 直接返回数组（无 cursor 包装）
  // 旧版 cursor 接口才会返回 { cursor, list }
  list?: HistoryItem[];
  cursor?: { max: number; view_at: number; business: string };
}

interface ToViewData {
  count: number;
  list: ToViewVideo[];
}

/**
 * 查询历史记录（视频、直播、专栏混合）。
 * 对应 C# History.GetHistory(...)，但使用现代分页接口 /x/v2/history?pn=<n>。
 *
 * @param page 1-based 页码
 * @param cookies 登录 cookies（必须含 SESSDATA）
 */
export async function getHistory(
  page: number = 1,
  cookies?: Record<string, string>,
): Promise<HistoryItem[]> {
  const url = `${HISTORY_URL}?pn=${page}`;
  const data = await biliGet<HistoryItem[] | HistoryData>(url, { cookies });
  // 接口可能直接返回数组，也可能返回 { list: [...] }
  if (Array.isArray(data)) return data;
  return data.list ?? [];
}

/**
 * 查询"稍后再看"视频列表。
 * 对应 C# ToView.GetToView()，但使用 web 接口 /x/v2/history/toview/web。
 */
export async function getToView(cookies?: Record<string, string>): Promise<{
  videos: ToViewVideo[];
  total: number;
}> {
  const data = await biliGet<ToViewData>(TOVIEW_URL, { cookies });
  return {
    videos: data.list ?? [],
    total: data.count ?? data.list?.length ?? 0,
  };
}
