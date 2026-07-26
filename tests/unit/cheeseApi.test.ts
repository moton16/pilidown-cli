/**
 * pilidown - Unit tests for CheeseApi (mocked fetch)
 * Original: tests are original to pilidown.
 *
 * Strategy:
 *   - 课程接口不需要 WBI 签名，直接 mock fetch 验证 URL 构造 + data 字段解析。
 *   - 课程流地址必须带 ep_id（按 C# 注释）。
 */

import { getSeasonInfo, getSeasonInfoByEpisode, getEpisodePlayUrl } from '../../src/api/CheeseApi';

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('CheeseApi.getSeasonInfo', () => {
  test('GETs /pugv/view/web/season with season_id and parses data', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({
        code: 0,
        message: '0',
        data: {
          season_id: 333,
          title: 'Linux 实战技能 100 讲',
          cover: 'https://example.com/cover.jpg',
          evaluate: '课程简介',
          episodes: [
            { id: 1234, aid: 100, cid: 200, title: '01', long_title: '开篇', duration: 600, status: 0, cover: '' },
          ],
          up_info: { mid: 1, uname: '讲师' },
          stat: { views: 9999 },
        },
      }),
    );
    const data = await getSeasonInfo(333);
    expect(data.season_id).toBe(333);
    expect(data.title).toBe('Linux 实战技能 100 讲');
    expect(data.episodes).toHaveLength(1);
    expect(data.episodes[0].id).toBe(1234);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/pugv/view/web/season');
    expect(url).toContain('season_id=333');
    // 课程接口不参与 WBI 签名
    expect(url).not.toMatch(/w_rid=/);
    expect(url).not.toMatch(/wts=/);
  });

  test('accepts string seasonId', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', data: { season_id: 1, title: 'T', cover: '', episodes: [], up_info: { mid: 1, uname: 'U' }, stat: { views: 0 } } }),
    );
    await getSeasonInfo('42');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('season_id=42');
  });

  test('throws when seasonId is empty', async () => {
    await expect(getSeasonInfo('')).rejects.toThrow(/seasonId/);
  });

  test('also handles result-fallback (cheese playurl-style)', async () => {
    // biliGet fallback：data 不存在时取 result
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', result: { season_id: 9, title: 'R', cover: '', episodes: [], up_info: { mid: 1, uname: 'U' }, stat: { views: 0 } } }),
    );
    const data = await getSeasonInfo(9);
    expect(data.season_id).toBe(9);
    expect(data.title).toBe('R');
  });
});

describe('CheeseApi.getSeasonInfoByEpisode', () => {
  test('GETs /pugv/view/web/season with ep_id', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', data: { season_id: 1, title: 'T', cover: '', episodes: [], up_info: { mid: 1, uname: 'U' }, stat: { views: 0 } } }),
    );
    await getSeasonInfoByEpisode(1234);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/pugv/view/web/season');
    expect(url).toContain('ep_id=1234');
    expect(url).not.toContain('season_id=');
  });

  test('throws when epId is 0', async () => {
    await expect(getSeasonInfoByEpisode(0)).rejects.toThrow(/epId/);
  });
});

describe('CheeseApi.getEpisodePlayUrl', () => {
  test('GETs /pugv/player/web/playurl with ep_id, cid, qn (no WBI)', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', result: { quality: 80, dash: { video: [], audio: [] } } }),
    );
    const data = await getEpisodePlayUrl(1234, 200, 80);
    expect(data.quality).toBe(80);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/pugv/player/web/playurl');
    expect(url).toContain('ep_id=1234');
    expect(url).toContain('cid=200');
    expect(url).toContain('qn=80');
    expect(url).toContain('fourk=1');
    expect(url).toContain('fnver=0');
    expect(url).toContain('fnval=4048');
    // 课程流地址不参与 WBI 签名
    expect(url).not.toMatch(/w_rid=/);
  });

  test('defaults qn to 127', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', result: { quality: 127, dash: { video: [], audio: [] } } }),
    );
    await getEpisodePlayUrl(1234, 200);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('qn=127');
  });

  test('throws when epId is missing (cheese requires ep_id)', async () => {
    await expect(getEpisodePlayUrl(0, 200)).rejects.toThrow(/epId/);
  });

  test('throws when cid is missing', async () => {
    await expect(getEpisodePlayUrl(1234, 0)).rejects.toThrow(/cid/);
  });
});
