/**
 * pilidown - WBI 签名辅助函数
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# source: src/DownKyi.Core/BiliApi/Sign/WbiSign.cs
 *
 * 把任意业务参数签名成 B 站 WBI 协议所要求的 query string。
 * 在原 VideoApi.ts 中以私有函数的形式存在；M9.2 抽出到此处以便
 * FavoritesApi / UserApi 等模块复用。
 */

import { wbiKeyManager } from '../services/WbiKeyManager';
import { encWbi } from '../core/wbi';

/**
 * 对参数进行 WBI 签名，返回拼接好 wts + w_rid 的 query string。
 * 镜像 C# `WbiSign.ParametersToQuery(WbiSign.EncodeWbi(parameters))`。
 */
export async function signWbiQuery(params: Record<string, string | number>): Promise<string> {
  const mixinKey = await wbiKeyManager.getMixinKey();
  const wts = Math.floor(Date.now() / 1000);
  const w_rid = encWbi(params, mixinKey, wts);
  const all: Record<string, string | number> = { ...params, wts, w_rid };
  return Object.entries(all)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}
