/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/Favorites/FavoritesInfo.cs (GetCreatedFavorites)
 *   - src/DownKyi.Core/BiliApi/Favorites/FavoritesResource.cs (GetFavoritesMedia)
 *
 * 收藏夹列表与资源 API。本接口无需 WBI 签名，仅靠普通 GET 请求即可。
 */

import { biliGet } from '../utils/httpClient';
import type { FavoritesFolder, FavoritesResource } from '../types/bili';

const FAV_FOLDER_LIST_URL = 'https://api.bilibili.com/x/v3/fav/folder/created/list';
const FAV_RESOURCE_LIST_URL = 'https://api.bilibili.com/x/v3/fav/resource/list';

interface FavoritesListData {
  count: number;
  list: FavoritesFolder[];
  has_more?: boolean;
}

interface FavoritesResourceData {
  info?: unknown;
  medias: FavoritesResource[] | null;
  has_more: boolean;
}

/**
 * 查询某用户创建的收藏夹列表（单页）。
 * 对应 C# FavoritesInfo.GetCreatedFavorites(mid, pn, ps)。
 */
export async function getFavFolders(
  mid: number,
  page: number = 1,
  pageSize: number = 20,
): Promise<{ folders: FavoritesFolder[]; total: number }> {
  const url = `${FAV_FOLDER_LIST_URL}?up_mid=${mid}&pn=${page}&ps=${pageSize}`;
  const data = await biliGet<FavoritesListData>(url);
  return {
    folders: data.list ?? [],
    total: data.count ?? data.list?.length ?? 0,
  };
}

/**
 * 查询用户创建的全部收藏夹（自动翻页直到耗尽）。
 * 对应 C# FavoritesInfo.GetAllCreatedFavorites(mid)。
 * 与 C# 行为一致：仅当某页返回空数组时停止翻页（API 在越界页必然返回空）。
 */
export async function getAllFavFolders(mid: number): Promise<FavoritesFolder[]> {
  const all: FavoritesFolder[] = [];
  let pn = 1;
  const ps = 50;
  // Safety cap: 单用户不会拥有上千个收藏夹，但保留 20 页上限以防 API 异常时无限循环。
  const MAX_PAGES = 20;
  while (pn <= MAX_PAGES) {
    const { folders } = await getFavFolders(mid, pn, ps);
    if (!folders.length) break;
    all.push(...folders);
    pn += 1;
  }
  return all;
}

/**
 * 查询某收藏夹内的视频资源（单页）。
 * 对应 C# FavoritesResource.GetFavoritesMedia(mediaId, pn, ps)。
 */
export async function getFavResources(
  mediaId: number,
  page: number = 1,
  pageSize: number = 20,
): Promise<{ resources: FavoritesResource[]; total: number; hasMore: boolean }> {
  const url = `${FAV_RESOURCE_LIST_URL}?media_id=${mediaId}&pn=${page}&ps=${pageSize}&platform=web`;
  const data = await biliGet<FavoritesResourceData>(url);
  return {
    resources: data.medias ?? [],
    total: data.medias?.length ?? 0,
    hasMore: !!data.has_more,
  };
}

/**
 * 查询某收藏夹的全部视频资源（自动翻页直到耗尽）。
 * 对应 C# FavoritesResource.GetAllFavoritesMedia(mediaId)。
 * 与 C# 行为一致：仅当某页返回空数组时停止翻页。
 */
export async function getAllFavResources(mediaId: number): Promise<FavoritesResource[]> {
  const all: FavoritesResource[] = [];
  let pn = 1;
  const ps = 20;
  const MAX_PAGES = 500; // 单收藏夹上限 1 万条
  while (pn <= MAX_PAGES) {
    const { resources } = await getFavResources(mediaId, pn, ps);
    if (!resources.length) break;
    all.push(...resources);
    pn += 1;
  }
  return all;
}
