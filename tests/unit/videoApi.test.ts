/**
 * pilidown - Unit tests for VideoApi (mocked fetch)
 * Original: tests are original to pilidown.
 *
 * Strategy:
 *   - Seed WbiKeyManager cache via one mocked nav fetch, then clear mock call history.
 *   - For each test, re-mock fetch with the response we want the API method to see.
 *   - Assert the URL the API method actually requested.
 */

import { getNavInfo, getVideoInfo, getPlayUrl, getPlayerInfo } from '../../src/api/VideoApi';
import { wbiKeyManager } from '../../src/services/WbiKeyManager';

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
  // ponytail: mockImplementation so each fetch call returns a fresh Response (Response body can only be consumed once).
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
  // Clear nav call history so test assertions only see their own fetches.
  spy.mockClear();
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await seedWbiKeys();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getNavInfo', () => {
  test('GETs /x/web-interface/nav and returns data', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', data: { isLogin: true, mid: 42, uname: 'test', wbi_img: { img_url: '', sub_url: '' } } }),
    );
    const data = await getNavInfo();
    expect(data.mid).toBe(42);
    expect(data.isLogin).toBe(true);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('https://api.bilibili.com/x/web-interface/nav');
  });
});

describe('getVideoInfo', () => {
  test('throws when neither bvid nor aid provided', async () => {
    await expect(getVideoInfo({})).rejects.toThrow(/bvid or aid/);
  });

  test('GETs /x/web-interface/wbi/view with bvid + WBI signature', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', data: { bvid: 'BV1xx411c7mD', aid: 1, cid: 100, title: 'T' } }),
    );
    const data = await getVideoInfo({ bvid: 'BV1xx411c7mD' });
    expect(data.bvid).toBe('BV1xx411c7mD');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/x/web-interface/wbi/view');
    expect(url).toContain('bvid=BV1xx411c7mD');
    expect(url).toMatch(/w_rid=[0-9a-f]{32}/);
    expect(url).toMatch(/wts=\d+/);
  });

  test('uses aid when bvid omitted', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', data: { aid: 999, cid: 1 } }),
    );
    await getVideoInfo({ aid: 999 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('aid=999');
    expect(url).not.toContain('bvid=');
  });
});

describe('getPlayUrl', () => {
  test('GETs /x/player/wbi/playurl with required params', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', data: { quality: 127, dash: { video: [], audio: [] } } }),
    );
    await getPlayUrl({ bvid: 'BV1xx411c7mD', cid: 100, qn: 80 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/x/player/wbi/playurl');
    expect(url).toContain('bvid=BV1xx411c7mD');
    expect(url).toContain('cid=100');
    expect(url).toContain('qn=80');
    expect(url).toContain('fnval=4048');
    expect(url).toContain('fourk=1');
    expect(url).toMatch(/w_rid=[0-9a-f]{32}/);
  });

  test('defaults qn to 127', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', data: { quality: 127, dash: { video: [], audio: [] } } }),
    );
    await getPlayUrl({ bvid: 'BV1xx411c7mD', cid: 1 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('qn=127');
  });
});

describe('getPlayerInfo', () => {
  test('GETs /x/player/wbi/v2 with cid + bvid', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', data: { aid: 1, bvid: 'BV1xx411c7mD', cid: 100, subtitle: { subtitles: [] } } }),
    );
    await getPlayerInfo({ bvid: 'BV1xx411c7mD', cid: 100 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/x/player/wbi/v2');
    expect(url).toContain('cid=100');
    expect(url).toContain('bvid=BV1xx411c7mD');
    expect(url).toMatch(/w_rid=[0-9a-f]{32}/);
  });
});
