/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# source: src/DownKyi.Core/BiliApi/Sign/WbiSign.cs
 * WBI key fetching + caching logic.
 */

import { biliGet } from '../utils/httpClient';
import type { BiliNavData } from '../types/bili';
import { getMixinKey } from '../core/wbi';

const CACHE_TTL = 30 * 60 * 1000;

function extractKeyFromUrl(url: string): string {
  const m = url.match(/\/([0-9a-f]{32})\.\w+$/);
  if (!m) throw new Error(`Cannot extract WBI key from URL: ${url}`);
  return m[1];
}

class WbiKeyManager {
  private imgKey?: string;
  private subKey?: string;
  private expiresAt = 0;

  async getKeys(): Promise<{ imgKey: string; subKey: string }> {
    if (this.imgKey && this.subKey && Date.now() < this.expiresAt) {
      return { imgKey: this.imgKey, subKey: this.subKey };
    }
    const navData = await biliGet<BiliNavData>('https://api.bilibili.com/x/web-interface/nav');
    this.imgKey = extractKeyFromUrl(navData.wbi_img.img_url);
    this.subKey = extractKeyFromUrl(navData.wbi_img.sub_url);
    this.expiresAt = Date.now() + CACHE_TTL;
    return { imgKey: this.imgKey, subKey: this.subKey };
  }

  async getMixinKey(): Promise<string> {
    const { imgKey, subKey } = await this.getKeys();
    return getMixinKey(imgKey + subKey);
  }

  clearCache(): void { this.imgKey = undefined; this.subKey = undefined; this.expiresAt = 0; }
}

export const wbiKeyManager = new WbiKeyManager();
