/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/Users/UserInfo.cs (GetUserInfoForSpace)
 *   - src/DownKyi.Core/BiliApi/Users/UserSpace.cs (GetPublication / GetChannelList)
 *
 * 用户空间信息 / 投稿 / 频道 API。空间信息和投稿接口需要 WBI 签名，
 * 频道接口不需要。投稿接口的 page.total 由 SpacePublicationPage.count 提供。
 */

import { biliGet } from '../utils/httpClient';
import { signWbiQuery } from '../utils/wbiSign';
import type { UserInfo, UserPublicationVideo, UserChannel } from '../types/bili';

const USER_INFO_URL = 'https://api.bilibili.com/x/space/wbi/acc/info';
const USER_PUBLICATION_URL = 'https://api.bilibili.com/x/space/wbi/arc/search';
const USER_CHANNEL_URL = 'https://api.bilibili.com/x/space/channel/list';

interface PublicationListData {
  list: { vlist: UserPublicationVideo[]; tlist?: unknown };
  page: { pn: number; ps: number; count: number };
}

interface ChannelListData {
  count?: number;
  list: UserChannel[];
}

/**
 * 查询用户空间基本信息（WBI 签名）。
 * 对应 C# UserInfo.GetUserInfoForSpace(mid)。
 */
export async function getUserInfo(mid: number): Promise<UserInfo> {
  const query = await signWbiQuery({ mid });
  return biliGet<UserInfo>(`${USER_INFO_URL}?${query}`);
}

/**
 * 查询用户投稿视频（WBI 签名，单页）。
 * 对应 C# UserSpace.GetPublication(mid, pn, ps, ...)。
 *
 * @param mid 用户 UID
 * @param page 1-based 页码
 * @param pageSize 每页条数（B 站上限 100）
 * @param order 排序：'pubdate' (默认最新) | 'click' (最多播放)
 */
export async function getPublications(
  mid: number,
  page: number = 1,
  pageSize: number = 30,
  order: 'pubdate' | 'click' = 'pubdate',
): Promise<{ videos: UserPublicationVideo[]; total: number }> {
  const params: Record<string, string | number> = {
    mid,
    pn: page,
    ps: pageSize,
    order,
    tid: 0,
    keyword: '',
  };
  const query = await signWbiQuery(params);
  const data = await biliGet<PublicationListData>(`${USER_PUBLICATION_URL}?${query}`);
  return {
    videos: data.list?.vlist ?? [],
    total: data.page?.count ?? 0,
  };
}

/**
 * 查询用户频道列表（无 WBI 签名）。
 * 对应 C# UserSpace.GetChannelList(mid)。
 */
export async function getChannels(mid: number): Promise<{
  channels: UserChannel[];
  total: number;
}> {
  const url = `${USER_CHANNEL_URL}?mid=${mid}`;
  const data = await biliGet<ChannelListData>(url);
  return {
    channels: data.list ?? [],
    total: data.count ?? data.list?.length ?? 0,
  };
}
