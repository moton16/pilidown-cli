/**
 * pilidown - Unit tests for LoginApi (mocked fetch)
 * Original: tests are original to pilidown.
 */

import { generateQrCode, pollLoginStatus, QR_STATUS } from '../../src/api/LoginApi';

let fetchMock: jest.SpyInstance;

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchMock.mockRestore();
  jest.restoreAllMocks();
});

function makeResp(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
  });
}

/** Attach a getSetCookie() mock to a Headers object (Node Headers lacks it in tests). */
function withSetCookies(resp: Response, setCookies: string[]): Response {
  (resp.headers as unknown as { getSetCookie: () => string[] }).getSetCookie = () => setCookies;
  return resp;
}

describe('generateQrCode', () => {
  test('parses url + qrcode_key from generate response', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResp({
        code: 0,
        message: '0',
        data: { url: 'https://passport.bilibili.com/x/passport-login/web/key/qrcode?login_session_key=abc', qrcode_key: 'key-123' },
      }, 200),
    );
    const r = await generateQrCode();
    expect(r.url).toContain('login_session_key=abc');
    expect(r.qrcodeKey).toBe('key-123');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('https://passport.bilibili.com/x/passport-login/web/qrcode/generate');
  });

  test('throws when outer code !== 0', async () => {
    fetchMock.mockResolvedValueOnce(makeResp({ code: -509, message: 'rate limit' }, 200));
    await expect(generateQrCode()).rejects.toThrow(/generate QR code failed/);
  });

  test('throws when data missing', async () => {
    fetchMock.mockResolvedValueOnce(makeResp({ code: 0, message: '0' }, 200));
    await expect(generateQrCode()).rejects.toThrow(/generate QR code failed/);
  });
});

describe('pollLoginStatus', () => {
  test('sends qrcode_key in query and returns NOT_SCANNED status', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResp({ code: 0, message: '0', data: { url: '', refresh_token: '', code: QR_STATUS.NOT_SCANNED, message: '未扫码' } }, 200),
    );
    const r = await pollLoginStatus('key-123');
    expect(r.code).toBe(QR_STATUS.NOT_SCANNED);
    expect(r.message).toBe('未扫码');
    expect(r.cookies).toBeUndefined();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('qrcode_key=key-123');
  });

  test('returns WAITING_CONFIRM (86090) status without cookies', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResp({ code: 0, message: '0', data: { url: '', refresh_token: '', code: QR_STATUS.WAITING_CONFIRM, message: '已扫码' } }, 200),
    );
    const r = await pollLoginStatus('k');
    expect(r.code).toBe(QR_STATUS.WAITING_CONFIRM);
    expect(r.cookies).toBeUndefined();
  });

  test('returns EXPIRED (86038) status without cookies', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResp({ code: 0, message: '0', data: { url: '', refresh_token: '', code: QR_STATUS.EXPIRED, message: '二维码已失效' } }, 200),
    );
    const r = await pollLoginStatus('k');
    expect(r.code).toBe(QR_STATUS.EXPIRED);
    expect(r.cookies).toBeUndefined();
  });

  test('SUCCESS (0) parses Set-Cookie into cookies dict and forwards refresh_token', async () => {
    const resp = withSetCookies(
      makeResp({
        code: 0,
        message: '0',
        data: {
          url: 'https://passport.bilibili.com/crossDomain?DedeUserID=42',
          refresh_token: 'rt-xyz',
          code: QR_STATUS.SUCCESS,
          message: '登录成功',
        },
      }, 200),
      [
        'SESSDATA=sess-abc; Path=/; Domain=.bilibili.com; HttpOnly',
        'bili_jct=jct-def; Path=/; Domain=.bilibili.com',
        'DedeUserID=42; Path=/; Domain=.bilibili.com',
        'DedeUserID__ckMd5=md5hash; Path=/; Domain=.bilibili.com',
        'sid=sid-1; Path=/; Domain=.bilibili.com',
      ],
    );
    fetchMock.mockResolvedValueOnce(resp);

    const r = await pollLoginStatus('k');
    expect(r.code).toBe(QR_STATUS.SUCCESS);
    expect(r.refresh_token).toBe('rt-xyz');
    expect(r.url).toContain('DedeUserID=42');
    expect(r.cookies).toEqual({
      SESSDATA: 'sess-abc',
      bili_jct: 'jct-def',
      DedeUserID: '42',
      DedeUserID__ckMd5: 'md5hash',
      sid: 'sid-1',
    });
  });

  test('SUCCESS with no Set-Cookie returns empty cookies dict', async () => {
    const resp = makeResp({
      code: 0,
      message: '0',
      data: { url: '', refresh_token: 'rt', code: QR_STATUS.SUCCESS, message: 'ok' },
    }, 200);
    fetchMock.mockResolvedValueOnce(resp);

    const r = await pollLoginStatus('k');
    expect(r.code).toBe(QR_STATUS.SUCCESS);
    expect(r.cookies).toEqual({});
  });

  test('url-encodes qrcode_key when it contains special chars', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResp({ code: 0, message: '0', data: { url: '', refresh_token: '', code: QR_STATUS.NOT_SCANNED, message: '' } }, 200),
    );
    await pollLoginStatus('a&b c');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('qrcode_key=' + encodeURIComponent('a&b c'));
  });

  test('throws when outer code !== 0', async () => {
    fetchMock.mockResolvedValueOnce(makeResp({ code: -509, message: 'rate limit' }, 200));
    await expect(pollLoginStatus('k')).rejects.toThrow(/poll login status failed/);
  });

  test('throws when data missing', async () => {
    fetchMock.mockResolvedValueOnce(makeResp({ code: 0, message: '0' }, 200));
    await expect(pollLoginStatus('k')).rejects.toThrow(/poll login status failed/);
  });
});
