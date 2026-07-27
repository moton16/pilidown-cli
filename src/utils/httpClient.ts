/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# source: src/DownKyi.Core/BiliApi/WebClient.cs
 * Ported WebClient.Get/Post -> httpRequest/biliGet using Node 18 fetch.
 */

import { BiliApiError, BILI_CODE_NEED_LOGIN, NetworkError } from '../types/errors';
import { loadCookies } from '../services/CookieService';
import type { BiliResponse, BiliBangumiResponse } from '../types/bili';

export interface HttpRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  timeout?: number;
  retries?: number;
  rawResponse?: boolean;
  body?: string | Uint8Array;
  wbi?: boolean;
  wbiKeys?: { imgKey: string; subKey: string };
}

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 3;

// ponytail: -352 反爬风控时 B 站要求 buvid3 cookie。未登录用户首次访问 API 时
// 自动获取并缓存，所有调用方共用一份。升级路径：若 B 站改要求 buvid4，可改用
// /x/frontend/finger/spid 接口拿全套。
let cachedBuvid3: string | undefined;

// Testing hooks: reset/seed the buvid3 cache so unit tests don't hit bilibili.com.
export function __resetHttpClientState(): void { cachedBuvid3 = undefined; }
export function __setBuvid3ForTest(value: string | undefined): void { cachedBuvid3 = value; }

async function ensureBuvid3(): Promise<string> {
  if (cachedBuvid3) return cachedBuvid3;
  // ponytail: in test environments don't hit the real bilibili.com homepage.
  if (process.env.NODE_ENV === 'test') {
    cachedBuvid3 = 'TEST-BUVID3';
    return cachedBuvid3;
  }
  // 访问 B 站首页拿 Set-Cookie 中的 buvid3
  const resp = await fetch('https://www.bilibili.com/', {
    headers: { 'User-Agent': DEFAULT_UA },
    redirect: 'manual',
  });
  const setCookies = (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const m = sc.match(/^buvid3=([^;]+)/);
    if (m) {
      cachedBuvid3 = m[1];
      return cachedBuvid3;
    }
  }
  throw new NetworkError('Failed to obtain buvid3 from bilibili.com');
}

function mergeBuvid3(cookies?: Record<string, string>): Record<string, string> | undefined {
  if (!cachedBuvid3) return cookies;
  if (!cookies) return { buvid3: cachedBuvid3 };
  if (cookies.buvid3) return cookies;
  return { ...cookies, buvid3: cachedBuvid3 };
}

export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {},
): Promise<{ data: T; headers: Headers; status: number }> {
  const { method = 'GET', headers = {}, cookies, timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES, body } = options;
  const finalHeaders: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    'Referer': 'https://www.bilibili.com/',
    ...headers,
  };
  if (cookies && Object.keys(cookies).length > 0) {
    finalHeaders['Cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(url, { method, headers: finalHeaders, body, signal: controller.signal });
      clearTimeout(timer);
      if (resp.status >= 500 && attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      const data = (await resp.json()) as T;
      return { data, headers: resp.headers, status: resp.status };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err as Error;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    }
  }
  throw new NetworkError(`HTTP ${method} ${url} failed after ${retries + 1} attempts`, lastErr);
}

export async function downloadBuffer(url: string, options: Omit<HttpRequestOptions, 'rawResponse'> = {}): Promise<Buffer> {
  const { method = 'GET', headers = {}, cookies, timeout = DEFAULT_TIMEOUT } = options;
  const finalHeaders: Record<string, string> = { 'User-Agent': DEFAULT_UA, 'Referer': 'https://www.bilibili.com/', ...headers };
  if (cookies) finalHeaders['Cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { method, headers: finalHeaders, signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new NetworkError(`HTTP ${resp.status} ${url}`);
    return Buffer.from(await resp.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export async function biliGet<T = unknown>(url: string, options?: Omit<HttpRequestOptions, 'method' | 'rawResponse'>): Promise<T> {
  let mergedOptions = { ...options, method: 'GET' as const };

  // ponytail: 如果调用方没显式传 cookies，自动加载持久化登录态；所有需要登录的 API 自动受益。
  if (!mergedOptions.cookies) {
    const { cookies } = loadCookies();
    if (Object.keys(cookies).length > 0) {
      mergedOptions.cookies = cookies;
    }
  }

  // 匿名访问时补充 buvid3；已登录时若缺 buvid3 也补上，避免 -352 风控。
  if (!mergedOptions.cookies?.buvid3) {
    if (!cachedBuvid3) {
      try { await ensureBuvid3(); } catch { /* 取不到就继续，让后端决定 */ }
    }
    if (cachedBuvid3) {
      mergedOptions.cookies = { ...mergedOptions.cookies, buvid3: cachedBuvid3 };
    }
  }

  let resp = await httpRequest<BiliResponse<T> | BiliBangumiResponse<T>>(url, mergedOptions);
  let body = resp.data;
  // ponytail: -352 风控时自动注入 buvid3 并重试一次
  if (body.code === BILI_CODE_NEED_LOGIN && !cachedBuvid3 && !mergedOptions.cookies?.buvid3) {
    try {
      await ensureBuvid3();
      mergedOptions.cookies = mergeBuvid3(mergedOptions.cookies);
      resp = await httpRequest<BiliResponse<T> | BiliBangumiResponse<T>>(url, mergedOptions);
      body = resp.data;
    } catch {
      // 获取 buvid3 失败时降级走原始错误路径
    }
  }
  if (body.code !== 0) {
    const hint = body.code === BILI_CODE_NEED_LOGIN ? '请先运行 `pilidown login` 完成扫码登录' : undefined;
    throw new BiliApiError(body.code, body.message, url, hint);
  }
  return (body as BiliResponse<T>).data ?? (body as BiliBangumiResponse<T>).result ?? (undefined as unknown as T);
}
