/**
 * pilidown - Unit tests for httpClient
 * Original: tests are original to pilidown (not ported from DownKyi).
 */

import { httpRequest, biliGet, downloadBuffer, __setBuvid3ForTest } from '../../src/utils/httpClient';
import { BiliApiError, NetworkError, BILI_CODE_NEED_LOGIN } from '../../src/types/errors';

jest.mock('../../src/services/CookieService', () => ({
  loadCookies: jest.fn(() => ({ cookies: {} })),
  saveCookies: jest.fn(),
  mergeCookies: jest.fn((a: Record<string, string>, b: Record<string, string>) => ({ ...a, ...b })),
  clearCookies: jest.fn(),
  toCookieHeader: jest.fn((cookies: Record<string, string>) => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')),
}));

type FetchMock = typeof fetch;
let fetchMock: jest.SpyInstance;

beforeEach(() => {
  __setBuvid3ForTest('TEST-BUVID3');
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchMock.mockRestore();
  jest.restoreAllMocks();
});

describe('httpRequest', () => {
  test('returns parsed JSON data and headers on 200', async () => {
    const body = { code: 0, message: 'ok', data: { x: 1 } };
    fetchMock.mockResolvedValueOnce(makeResp(body, 200));
    const r = await httpRequest('https://api.test/x');
    expect(r.status).toBe(200);
    expect(r.data).toEqual(body);
  });

  test('sets default UA, Referer, and Cookie header when cookies provided', async () => {
    fetchMock.mockResolvedValueOnce(makeResp({ ok: true }, 200));
    await httpRequest('https://api.test/x', { cookies: { SESSDATA: 'abc', bili_jct: 'def' } });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/Mozilla/);
    expect(headers['Referer']).toBe('https://www.bilibili.com/');
    expect(headers['Cookie']).toBe('SESSDATA=abc; bili_jct=def');
  });

  test('retries on 5xx then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResp({}, 503))
      .mockResolvedValueOnce(makeResp({ ok: true }, 200));
    const r = await httpRequest('https://api.test/x', { retries: 2, timeout: 50 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('throws NetworkError when all retries exhausted on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(httpRequest('https://api.test/x', { retries: 1, timeout: 50 })).rejects.toThrow(NetworkError);
  });

  test('respects custom method POST + body', async () => {
    fetchMock.mockResolvedValueOnce(makeResp({ ok: true }, 200));
    await httpRequest('https://api.test/x', { method: 'POST', body: 'k=v' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('k=v');
  });
});

describe('biliGet', () => {
  test('returns data when code===0', async () => {
    fetchMock.mockResolvedValueOnce(makeResp({ code: 0, message: '0', data: { mid: 1 } }, 200));
    const data = await biliGet<{ mid: number }>('https://api.bilibili.com/x/web-interface/nav');
    expect(data).toEqual({ mid: 1 });
  });

  test('returns result when code===0 (bangumi shape)', async () => {
    fetchMock.mockResolvedValueOnce(makeResp({ code: 0, message: '0', result: { season_id: 42 } }, 200));
    const data = await biliGet<{ season_id: number }>('https://api.bilibili.com/pgc/view/web/season');
    expect(data).toEqual({ season_id: 42 });
  });

  test('throws BiliApiError with NEED_LOGIN hint when code=-352', async () => {
    // ponytail: biliGet 在 -352 时会尝试 ensureBuvid3()，需要 mock 多次 fetch
    // (1) view 接口首次返回 -352
    // (2) ensureBuvid3 访问 bilibili.com 拿 buvid3
    // (3) view 接口重试仍然返回 -352（buvid3 也救不了 anonymous 测试场景）
    fetchMock
      .mockResolvedValueOnce(makeResp({ code: BILI_CODE_NEED_LOGIN, message: 'need login' }, 200))
      .mockResolvedValueOnce(makeRespBuvid3())
      .mockResolvedValueOnce(makeResp({ code: BILI_CODE_NEED_LOGIN, message: 'need login' }, 200));
    await expect(biliGet('https://api.bilibili.com/x/web-interface/wbi/view')).rejects.toMatchObject({
      name: 'BiliApiError',
      code: BILI_CODE_NEED_LOGIN,
      hint: expect.stringContaining('pilidown login'),
    });
  });

  test('throws BiliApiError without hint for other codes', async () => {
    fetchMock.mockResolvedValueOnce(makeResp({ code: 62002, message: 'not found' }, 200));
    await expect(biliGet('https://api.bilibili.com/x/web-interface/wbi/view')).rejects.toMatchObject({
      name: 'BiliApiError',
      code: 62002,
      hint: undefined,
    });
  });
});

describe('downloadBuffer', () => {
  test('returns Buffer on 2xx', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    fetchMock.mockResolvedValueOnce(makeRespBinary(payload, 200));
    const buf = await downloadBuffer('https://api.test/x');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(5);
  });

  test('throws NetworkError on 4xx', async () => {
    fetchMock.mockResolvedValueOnce(makeRespBinary(new Uint8Array(), 404));
    await expect(downloadBuffer('https://api.test/x')).rejects.toThrow(NetworkError);
  });
});

function makeResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeRespBinary(bytes: Uint8Array, status: number): Response {
  return new Response(bytes, { status });
}

// ponytail: 模拟访问 bilibili.com 返回带 buvid3 的 Set-Cookie
function makeRespBuvid3(): Response {
  return new Response('<html>ok</html>', {
    status: 200,
    headers: {
      'content-type': 'text/html',
      'set-cookie': 'buvid3=TEST-BUVID3-1234567890; Path=/; Domain=.bilibili.com',
    },
  });
}
