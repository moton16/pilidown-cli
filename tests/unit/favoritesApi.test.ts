/**
 * pilidown - Unit tests for FavoritesApi (mocked fetch)
 * Original: tests are original to pilidown.
 */

import { getFavFolders, getAllFavFolders, getFavResources, getAllFavResources } from '../../src/api/FavoritesApi';
import { BiliApiError } from '../../src/types/errors';

let fetchMock: jest.SpyInstance;

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchMock.mockRestore();
  jest.restoreAllMocks();
});

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('getFavFolders', () => {
  test('GETs /x/v3/fav/folder/created/list with up_mid + pagination', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        code: 0,
        message: '0',
        data: {
          count: 1,
          list: [{ id: 100, fid: 200, mid: 42, uid: 42, title: '默认收藏夹', media_count: 5, cover: '', fav_state: 0, like_state: 0, ctime: 0, mtime: 0 }],
        },
      }),
    );
    const r = await getFavFolders(42, 1, 20);
    expect(r.total).toBe(1);
    expect(r.folders[0].title).toBe('默认收藏夹');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/x/v3/fav/folder/created/list');
    expect(url).toContain('up_mid=42');
    expect(url).toContain('pn=1');
    expect(url).toContain('ps=20');
    expect(url).not.toMatch(/w_rid=/);
  });

  test('returns empty list when data.list is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ code: 0, message: '0', data: { count: 0 } }),
    );
    const r = await getFavFolders(42);
    expect(r.folders).toEqual([]);
    expect(r.total).toBe(0);
  });

  test('throws BiliApiError with login hint when outer code = -352', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({ code: -352, message: '需要登录' }),
    );
    try {
      await getFavFolders(42);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BiliApiError);
      expect((err as BiliApiError).code).toBe(-352);
      expect((err as BiliApiError).hint).toContain('请先运行 `pilidown login`');
    }
  });

  test('uses default pagination values', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ code: 0, message: '0', data: { count: 0, list: [] } }),
    );
    await getFavFolders(42);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('pn=1');
    expect(url).toContain('ps=20');
  });
});

describe('getAllFavFolders', () => {
  test('paginates until an empty page is returned', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          code: 0,
          message: '0',
          data: { count: 3, list: [{ id: 1, fid: 1, mid: 42, uid: 42, title: 'a', media_count: 1, cover: '', fav_state: 0, like_state: 0, ctime: 0, mtime: 0 }] },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          code: 0,
          message: '0',
          data: { count: 3, list: [{ id: 2, fid: 2, mid: 42, uid: 42, title: 'b', media_count: 1, cover: '', fav_state: 0, like_state: 0, ctime: 0, mtime: 0 }] },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          code: 0,
          message: '0',
          data: { count: 3, list: [] },
        }),
      );
    const all = await getAllFavFolders(42);
    expect(all).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('stops paging when empty list returned', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ code: 0, message: '0', data: { count: 0, list: [] } }),
    );
    const all = await getAllFavFolders(42);
    expect(all).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getFavResources', () => {
  test('GETs /x/v3/fav/resource/list with media_id + pagination + platform=web', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        code: 0,
        message: '0',
        data: {
          medias: [{ id: 1, type: 2, title: 'v1', cover: '', intro: '', page: 1, duration: 60, upper: { mid: 1, name: 'u', face: '' }, cnt_info: { collect: 1, play: 1, danmaku: 0 }, link: '', ctime: 0, pubdate: 0, fav_time: 0, bvid: 'BV1xx411c7mD' }],
          has_more: false,
        },
      }),
    );
    const r = await getFavResources(1234, 1, 20);
    expect(r.resources).toHaveLength(1);
    expect(r.resources[0].bvid).toBe('BV1xx411c7mD');
    expect(r.hasMore).toBe(false);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/x/v3/fav/resource/list');
    expect(url).toContain('media_id=1234');
    expect(url).toContain('pn=1');
    expect(url).toContain('ps=20');
    expect(url).toContain('platform=web');
  });

  test('returns empty list when medias is null', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ code: 0, message: '0', data: { medias: null, has_more: false } }),
    );
    const r = await getFavResources(1);
    expect(r.resources).toEqual([]);
    expect(r.hasMore).toBe(false);
  });
});

describe('getAllFavResources', () => {
  test('paginates until an empty page is returned', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          code: 0,
          message: '0',
          data: {
            medias: Array.from({ length: 20 }, (_, i) => ({ id: i, type: 2, title: `v${i}`, cover: '', intro: '', page: 1, duration: 1, upper: { mid: 1, name: 'u', face: '' }, cnt_info: { collect: 0, play: 0, danmaku: 0 }, link: '', ctime: 0, pubdate: 0, fav_time: 0, bvid: `BV1xx411c7m${i}` })),
            has_more: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          code: 0,
          message: '0',
          data: {
            medias: [{ id: 100, type: 2, title: 'last', cover: '', intro: '', page: 1, duration: 1, upper: { mid: 1, name: 'u', face: '' }, cnt_info: { collect: 0, play: 0, danmaku: 0 }, link: '', ctime: 0, pubdate: 0, fav_time: 0, bvid: 'BV1xx411c7mZ' }],
            has_more: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ code: 0, message: '0', data: { medias: [], has_more: false } }),
      );
    const all = await getAllFavResources(1);
    expect(all).toHaveLength(21);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('stops on first empty page', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ code: 0, message: '0', data: { medias: [], has_more: false } }),
    );
    const all = await getAllFavResources(1);
    expect(all).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
