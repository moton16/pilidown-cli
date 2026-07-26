/**
 * pilidown - Lightweight Bilibili downloader CLI (MIT)
 * Inspired by DownKyi (https://github.com/leiurayer/downkyi)
 * Original C# source: src/DownKyi.Core/BiliApi/WebClient.cs (error handling patterns)
 */

export class BiliApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly apiUrl?: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'BiliApiError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class FileSystemError extends Error {
  constructor(message: string, public readonly path?: string, public readonly cause?: Error) {
    super(message);
    this.name = 'FileSystemError';
  }
}

// ponytail: B 站 -352 是反爬风控（要求 buvid3 / 登录态），不是字面意义的"未登录"。
// httpClient 检测到该码时会自动尝试注入 buvid3 重试；仍未通过则提示用户 login。
export const BILI_CODE_NEED_LOGIN = -352;
