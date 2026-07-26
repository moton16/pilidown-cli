/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# source: src/DownKyi.Core/Settings/ (cookie persistence patterns)
 * Adapted to JSON file storage for CLI use.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import { FileSystemError } from '../types/errors';

export interface CookieData {
  cookies: Record<string, string>;
  refresh_token?: string;
  savedAt?: string;
}

const DEFAULT_COOKIE_DIR = join(homedir(), '.pilidown');
const DEFAULT_COOKIE_PATH = join(DEFAULT_COOKIE_DIR, 'cookies.json');

export function loadCookies(filePath?: string): CookieData {
  const path = filePath ?? DEFAULT_COOKIE_PATH;
  if (!existsSync(path)) return { cookies: {} };
  try {
    const content = readFileSync(path, 'utf8');
    const data = JSON.parse(content) as CookieData;
    return { cookies: data.cookies ?? {}, refresh_token: data.refresh_token, savedAt: data.savedAt };
  } catch (err) {
    throw new FileSystemError(`Failed to load cookies from ${path}`, path, err as Error);
  }
}

export function saveCookies(data: CookieData, filePath?: string): void {
  const path = filePath ?? DEFAULT_COOKIE_PATH;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload = { ...data, savedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
  if (platform() !== 'win32') { try { chmodSync(path, 0o600); } catch { /* ignore */ } }
}

export function clearCookies(filePath?: string): void { saveCookies({ cookies: {} }, filePath); }
export function mergeCookies(existing: Record<string, string>, incoming: Record<string, string>): Record<string, string> { return { ...existing, ...incoming }; }
export function toCookieHeader(cookies: Record<string, string>): string { return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '); }

export function parseSetCookie(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const setCookies = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const parts = sc.split(';')[0].split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      if (name) result[name] = value;
    }
  }
  return result;
}
