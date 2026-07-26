/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# source: src/DownKyi.Core/BiliApi/LoginNew/LoginQR.cs
 *
 * Note: B 站扫码登录的 poll 接口外层 code===0 表示请求成功，
 * 但 data.code 才是真正的扫码状态码（86101/86090/86038/0）。
 * 因此不能用 biliGet（它要求 data.code===0 才返回 data），
 * 必须用 httpRequest 直接拿原始 Response 以读取 Set-Cookie 头。
 */

import { httpRequest } from '../utils/httpClient';
import { parseSetCookie } from '../services/CookieService';

const GENERATE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const POLL_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';

/** 扫码登录状态码 */
export const QR_STATUS = {
  SUCCESS: 0,
  NOT_SCANNED: 86101,
  WAITING_CONFIRM: 86090,
  EXPIRED: 86038,
} as const;

export interface QrCodeGenerateResult {
  /** 用于生成二维码的 URL（扫码后即登录） */
  url: string;
  /** 二维码密钥，用于轮询登录状态 */
  qrcodeKey: string;
}

export interface LoginPollResult {
  /** 0=成功 86101=未扫码 86090=已扫码等待确认 86038=二维码失效 */
  code: number;
  message: string;
  /** 仅 code===0 时存在：从 Set-Cookie 解析出的 cookies */
  cookies?: Record<string, string>;
  /** refresh_token，用于后续刷新登录态 */
  refresh_token?: string;
  /** data.url，登录成功时含跨域回跳 URL；其他状态可能为空字符串 */
  url?: string;
}

interface GenerateApiResponse {
  code: number;
  message: string;
  data?: { url: string; qrcode_key: string };
}

interface PollApiResponse {
  code: number;
  message: string;
  data?: { url: string; refresh_token: string; code: number; message: string };
}

/** GET /x/passport-login/web/qrcode/generate —— 申请二维码 URL 与 qrcode_key。 */
export async function generateQrCode(): Promise<QrCodeGenerateResult> {
  const resp = await httpRequest<GenerateApiResponse>(GENERATE_URL);
  const body = resp.data;
  if (body.code !== 0 || !body.data) {
    throw new Error(`generate QR code failed: code=${body.code} message=${body.message}`);
  }
  return {
    url: body.data.url,
    qrcodeKey: body.data.qrcode_key,
  };
}

/** GET /x/passport-login/web/qrcode/poll?qrcode_key=<key> —— 轮询扫码登录状态。 */
export async function pollLoginStatus(qrcodeKey: string): Promise<LoginPollResult> {
  const url = `${POLL_URL}?qrcode_key=${encodeURIComponent(qrcodeKey)}`;
  const resp = await httpRequest<PollApiResponse>(url);
  const body = resp.data;
  if (body.code !== 0 || !body.data) {
    throw new Error(`poll login status failed: code=${body.code} message=${body.message}`);
  }
  const data = body.data;
  const result: LoginPollResult = {
    code: data.code,
    message: data.message,
    url: data.url,
    refresh_token: data.refresh_token,
  };
  // 登录成功时从 Set-Cookie 头解析 cookies
  if (data.code === QR_STATUS.SUCCESS) {
    result.cookies = parseSetCookie(resp.headers);
  }
  return result;
}
