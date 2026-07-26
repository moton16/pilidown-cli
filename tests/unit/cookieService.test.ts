/**
 * pilidown - Unit tests for CookieService
 * Original: tests are original to pilidown.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadCookies,
  saveCookies,
  clearCookies,
  mergeCookies,
  toCookieHeader,
  parseSetCookie,
  type CookieData,
} from '../../src/services/CookieService';
import { FileSystemError } from '../../src/types/errors';

let tmpDir: string;
let cookiePath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pilidown-cookies-'));
  cookiePath = join(tmpDir, 'cookies.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadCookies', () => {
  test('returns empty when file missing', () => {
    expect(loadCookies(cookiePath)).toEqual({ cookies: {} });
  });

  test('loads valid JSON with cookies + refresh_token + savedAt', () => {
    const data: CookieData = { cookies: { SESSDATA: 'abc' }, refresh_token: 'rt', savedAt: '2026-01-01T00:00:00Z' };
    writeFileSync(cookiePath, JSON.stringify(data));
    const loaded = loadCookies(cookiePath);
    expect(loaded.cookies).toEqual({ SESSDATA: 'abc' });
    expect(loaded.refresh_token).toBe('rt');
    expect(loaded.savedAt).toBe('2026-01-01T00:00:00Z');
  });

  test('normalizes missing cookies to {}', () => {
    writeFileSync(cookiePath, JSON.stringify({ refresh_token: 'rt' }));
    expect(loadCookies(cookiePath).cookies).toEqual({});
  });

  test('throws FileSystemError on invalid JSON', () => {
    writeFileSync(cookiePath, '{ not valid json');
    expect(() => loadCookies(cookiePath)).toThrow(FileSystemError);
  });
});

describe('saveCookies', () => {
  test('writes file with savedAt timestamp', () => {
    saveCookies({ cookies: { SESSDATA: 'x' } }, cookiePath);
    expect(existsSync(cookiePath)).toBe(true);
    const raw = JSON.parse(readFileSync(cookiePath, 'utf8'));
    expect(raw.cookies).toEqual({ SESSDATA: 'x' });
    expect(raw.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('creates parent directory if missing', () => {
    const nested = join(tmpDir, 'a', 'b', 'c.json');
    saveCookies({ cookies: { k: 'v' } }, nested);
    expect(existsSync(nested)).toBe(true);
  });

  test('overwrite existing file', () => {
    saveCookies({ cookies: { k1: 'v1' } }, cookiePath);
    saveCookies({ cookies: { k2: 'v2' } }, cookiePath);
    expect(loadCookies(cookiePath).cookies).toEqual({ k2: 'v2' });
  });
});

describe('clearCookies', () => {
  test('saves empty cookies', () => {
    saveCookies({ cookies: { SESSDATA: 'abc' } }, cookiePath);
    clearCookies(cookiePath);
    expect(loadCookies(cookiePath).cookies).toEqual({});
  });
});

describe('mergeCookies', () => {
  test('incoming overrides existing keys', () => {
    expect(mergeCookies({ a: '1', b: '2' }, { b: '3', c: '4' })).toEqual({ a: '1', b: '3', c: '4' });
  });
});

describe('toCookieHeader', () => {
  test('joins entries with semicolon', () => {
    expect(toCookieHeader({ a: '1', b: '2' })).toBe('a=1; b=2');
  });

  test('returns empty string for empty object', () => {
    expect(toCookieHeader({})).toBe('');
  });
});

describe('parseSetCookie', () => {
  test('extracts name=value pairs from Set-Cookie list', () => {
    const headers = new Headers();
    // ponytail: rely on Headers internal set-cookie via append then getSetCookie mock
    (headers as unknown as { getSetCookie: () => string[] }).getSetCookie = () => [
      'SESSDATA=abc; Path=/; HttpOnly',
      'bili_jct=def; Path=/',
    ];
    expect(parseSetCookie(headers)).toEqual({ SESSDATA: 'abc', bili_jct: 'def' });
  });

  test('returns empty for no Set-Cookie', () => {
    const headers = new Headers();
    expect(parseSetCookie(headers)).toEqual({});
  });

  test('handles value containing =', () => {
    const headers = new Headers();
    (headers as unknown as { getSetCookie: () => string[] }).getSetCookie = () => ['k=v=1=2; Path=/'];
    expect(parseSetCookie(headers)).toEqual({ k: 'v=1=2' });
  });
});
