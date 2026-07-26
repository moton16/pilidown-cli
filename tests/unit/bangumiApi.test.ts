/**
 * pilidown - Unit tests for BangumiApi (mocked fetch)
 * Original: tests are original to pilidown.
 *
 * Strategy:
 *   - 番剧接口不需要 WBI 签名，直接 mock fetch 验证 URL 构造 + result 字段解析。
 *   - biliGet 内层已经处理 code===0 + data/result fallback。
 */

import { getSeasonInfo, getSeasonInfoByEpisode, getEpisodePlayUrl, getSeasonByMediaId } from '../../src/api/BangumiApi';

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

describe('BangumiApi.getSeasonInfo', () => {
  test('GETs /pgc/view/web/season with season_id and parses result', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({
        code: 0,
        message: '0',
        result: {
          season_id: 28285,
          media_id: 28285,
          title: '孤独摇滚！',
          cover: 'https://example.com/cover.jpg',
          evaluate: '后藤一里…',
          areas: [{ name: '日本' }],
          episodes: [
            { aid: 1, cid: 100, id: 364001, title: '1', long_title: '孤独摇滚', duration: 1420, status: 0, cover: '', epid: 364001 },
          ],
          stat: { views: 1000, danmakus: 100, coins: 50, favorites: 200 },
        },
      }),
    );
    const data = await getSeasonInfo(28285);
    expect(data.season_id).toBe(28285);
    expect(data.title).toBe('孤独摇滚！');
    expect(data.episodes).toHaveLength(1);
    expect(data.episodes[0].id).toBe(364001);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/pgc/view/web/season');
    expect(url).toContain('season_id=28285');
    // 番剧接口不参与 WBI 签名
    expect(url).not.toMatch(/w_rid=/);
    expect(url).not.toMatch(/wts=/);
  });

  test('accepts string seasonId', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', result: { season_id: 1, media_id: 1, title: 'T', cover: '', evaluate: '', areas: [], episodes: [], stat: { views: 0, danmakus: 0, coins: 0, favorites: 0 } } }),
    );
    await getSeasonInfo('42');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('season_id=42');
  });

  test('throws when seasonId is empty', async () => {
    await expect(getSeasonInfo('')).rejects.toThrow(/seasonId/);
  });
});

describe('BangumiApi.getSeasonInfoByEpisode', () => {
  test('GETs /pgc/view/web/season with ep_id', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', result: { season_id: 1, media_id: 1, title: 'T', cover: '', evaluate: '', areas: [], episodes: [], stat: { views: 0, danmakus: 0, coins: 0, favorites: 0 } } }),
    );
    await getSeasonInfoByEpisode(364001);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/pgc/view/web/season');
    expect(url).toContain('ep_id=364001');
    expect(url).not.toContain('season_id=');
  });

  test('throws when epId is 0', async () => {
    await expect(getSeasonInfoByEpisode(0)).rejects.toThrow(/epId/);
  });
});

describe('BangumiApi.getEpisodePlayUrl', () => {
  test('GETs /pgc/player/web/playurl with ep_id, cid, qn (no WBI)', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', result: { quality: 127, dash: { video: [], audio: [] } } }),
    );
    const data = await getEpisodePlayUrl(364001, 100, 80);
    expect(data.quality).toBe(127);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/pgc/player/web/playurl');
    expect(url).toContain('ep_id=364001');
    expect(url).toContain('cid=100');
    expect(url).toContain('qn=80');
    expect(url).toContain('fourk=1');
    expect(url).toContain('fnver=0');
    expect(url).toContain('fnval=4048');
    // 番剧流地址不参与 WBI 签名
    expect(url).not.toMatch(/w_rid=/);
  });

  test('defaults qn to 127', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', result: { quality: 127, dash: { video: [], audio: [] } } }),
    );
    await getEpisodePlayUrl(364001, 100);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('qn=127');
  });

  test('throws when epId is missing', async () => {
    await expect(getEpisodePlayUrl(0, 100)).rejects.toThrow(/epId/);
  });

  test('throws when cid is missing', async () => {
    await expect(getEpisodePlayUrl(364001, 0)).rejects.toThrow(/cid/);
  });
});

describe('BangumiApi.getSeasonByMediaId', () => {
  test('GETs /pgc/review/user and unwraps result.media', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({
        code: 0,
        message: '0',
        result: {
          media: {
            media_id: 28285,
            season_id: 36400,
            title: '孤独摇滚！',
            cover: 'https://example.com/cover.jpg',
            type_name: '番剧',
            share_url: 'https://www.bilibili.com/bangumi/media/md28285',
          },
        },
      }),
    );
    const data = await getSeasonByMediaId(28285);
    expect(data.season_id).toBe(36400);
    expect(data.media_id).toBe(28285);
    expect(data.title).toBe('孤独摇滚！');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/pgc/review/user');
    expect(url).toContain('media_id=28285');
    expect(url).not.toMatch(/w_rid=/);
  });

  test('throws when media not found in result', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ code: 0, message: '0', result: {} }),
    );
    await expect(getSeasonByMediaId(28285)).rejects.toThrow(/media not found/);
  });

  test('throws when mediaId is 0', async () => {
    await expect(getSeasonByMediaId(0)).rejects.toThrow(/mediaId/);
  });
});
