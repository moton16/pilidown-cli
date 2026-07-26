/**
 * pilidown - Unit tests for UserApi (mocked fetch, WBI signed)
 * Original: tests are original to pilidown.
 *
 * Strategy:
 *   - Seed WbiKeyManager cache via one mocked nav fetch (mirrors videoApi.test.ts).
 *   - Verify WBI-signed endpoints carry w_rid + wts in the URL.
 */

import { getUserInfo, getPublications, getChannels } from '../../src/api/UserApi';
import { wbiKeyManager } from '../../src/services/WbiKeyManager';
import { BiliApiError } from '../../src/types/errors';

const IMG_KEY = '653657f524a547ac981ded72ea172057';
const SUB_KEY = '6e4909c702f846728e64f6007736a338';

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Seed WBI keys so signWbiQuery won't trigger nav fetch during the test itself. */
async function seedWbiKeys(): Promise<void> {
  const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    mockJsonResponse({
      code: 0,
      message: '0',
      data: {
        isLogin: false,
        mid: 0,
        uname: '',
        wbi_img: {
          img_url: `https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`,
          sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`,
        },
      },
    }),
  );
  wbiKeyManager.clearCache();
  await wbiKeyManager.getKeys();
  spy.mockClear();
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await seedWbiKeys();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getUserInfo', () => {
  test('GETs /x/space/wbi/acc/info with mid + WBI signature', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({
        code: 0,
        message: '0',
        data: {
          mid: 42,
          name: 'tester',
          sex: '男',
          face: 'https://example.com/face.png',
          sign: 'hello',
          level: 6,
          vip: { type: 2, status: 1, label: { text: '年度大会员' } },
        },
      }),
    );
    const info = await getUserInfo(42);
    expect(info.mid).toBe(42);
    expect(info.name).toBe('tester');
    expect(info.vip.label.text).toBe('年度大会员');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/x/space/wbi/acc/info');
    expect(url).toContain('mid=42');
    expect(url).toMatch(/w_rid=[0-9a-f]{32}/);
    expect(url).toMatch(/wts=\d+/);
  });

  test('throws BiliApiError with hint when code=-352', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: -352, message: '请先登录' }),
    );
    try {
      await getUserInfo(42);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BiliApiError);
      expect((err as BiliApiError).code).toBe(-352);
      expect((err as BiliApiError).hint).toContain('请先运行 `pilidown login`');
    }
  });
});

describe('getPublications', () => {
  test('GETs /x/space/wbi/arc/search with mid + pagination + WBI signature', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({
        code: 0,
        message: '0',
        data: {
          list: {
            vlist: [
              { aid: 1, bvid: 'BV1a', title: 'v1', pic: '', typeid: 1, play: 100, mid: 42, created: 0, length: '10:00' },
            ],
            tlist: {},
          },
          page: { pn: 1, ps: 30, count: 1 },
        },
      }),
    );
    const r = await getPublications(42, 1, 30);
    expect(r.total).toBe(1);
    expect(r.videos[0].bvid).toBe('BV1a');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/x/space/wbi/arc/search');
    expect(url).toContain('mid=42');
    expect(url).toContain('pn=1');
    expect(url).toContain('ps=30');
    expect(url).toContain('order=pubdate');
    expect(url).toMatch(/w_rid=[0-9a-f]{32}/);
    expect(url).toMatch(/wts=\d+/);
  });

  test('uses order=click when requested', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({
        code: 0,
        message: '0',
        data: { list: { vlist: [], tlist: {} }, page: { pn: 1, ps: 30, count: 0 } },
      }),
    );
    await getPublications(42, 1, 30, 'click');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('order=click');
  });

  test('defaults page=1 pageSize=30', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({
        code: 0,
        message: '0',
        data: { list: { vlist: [], tlist: {} }, page: { pn: 1, ps: 30, count: 0 } },
      }),
    );
    await getPublications(42);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('pn=1');
    expect(url).toContain('ps=30');
  });

  test('returns empty list when vlist missing', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({
        code: 0,
        message: '0',
        data: { list: {}, page: { pn: 1, ps: 30, count: 0 } },
      }),
    );
    const r = await getPublications(42);
    expect(r.videos).toEqual([]);
    expect(r.total).toBe(0);
  });
});

describe('getChannels', () => {
  test('GETs /x/space/channel/list with mid (no WBI signature)', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({
        code: 0,
        message: '0',
        data: {
          count: 1,
          list: [{ cid: 100, mid: 42, name: 'ch1', intro: '', mtime: 0, count: 5, cover: '' }],
        },
      }),
    );
    const r = await getChannels(42);
    expect(r.channels).toHaveLength(1);
    expect(r.channels[0].cid).toBe(100);
    expect(r.total).toBe(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/x/space/channel/list');
    expect(url).toContain('mid=42');
    expect(url).not.toMatch(/w_rid=/);
  });

  test('returns empty list when data.list missing', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', data: { count: 0 } }),
    );
    const r = await getChannels(42);
    expect(r.channels).toEqual([]);
    expect(r.total).toBe(0);
  });
});
