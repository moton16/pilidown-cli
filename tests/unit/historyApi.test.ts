/**
 * pilidown - Unit tests for HistoryApi (mocked fetch)
 * Original: tests are original to pilidown.
 */

import { getHistory, getToView } from '../../src/api/HistoryApi';
import { BiliApiError } from '../../src/types/errors';
import { __setBuvid3ForTest } from '../../src/utils/httpClient';

let fetchMock: jest.SpyInstance;

beforeEach(() => {
  __setBuvid3ForTest('TEST-BUVID3');
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

describe('getHistory', () => {
  test('GETs /x/v2/history with pn query and forwards cookies', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        code: 0,
        message: '0',
        data: [
          {
            aid: 1,
            bvid: 'BV1xx411c7mD',
            videos: 1,
            title: 't1',
            cover: '',
            uri: '',
            duration: 60,
            pubdate: 0,
            view_at: 123,
            progress: 30,
            badge: '',
            show_title: '',
            cid: 100,
            owner: { mid: 1, name: 'up', face: '' },
            history: { oid: 1, bvid: 'BV1xx411c7mD', page: 1, cid: 100, part: 'p1', business: 'archive', dt: 0 },
          },
        ],
      }),
    );
    const cookies = { SESSDATA: 'sess-abc' };
    const items = await getHistory(1, cookies);
    expect(items).toHaveLength(1);
    expect(items[0].bvid).toBe('BV1xx411c7mD');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/x/v2/history');
    expect(url).toContain('pn=1');
    // cookie forwarding via httpRequest options; biliGet auto-appends buvid3
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const cookie = (init.headers as Record<string, string>)['Cookie'];
    expect(cookie).toContain('SESSDATA=sess-abc');
    expect(cookie).toContain('buvid3=TEST-BUVID3');
  });

  test('accepts { list: [...] } response shape (legacy/cursor wrapper)', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        code: 0,
        message: '0',
        data: {
          cursor: { max: 0, view_at: 0, business: 'archive' },
          list: [
            {
              aid: 2,
              bvid: 'BV1xx411c7mE',
              videos: 1,
              title: 't2',
              cover: '',
              uri: '',
              duration: 30,
              pubdate: 0,
              view_at: 456,
              progress: 0,
              badge: '',
              show_title: '',
              cid: 200,
              owner: { mid: 2, name: 'up2', face: '' },
              history: { oid: 2, bvid: 'BV1xx411c7mE', page: 1, cid: 200, part: 'p1', business: 'archive', dt: 0 },
            },
          ],
        },
      }),
    );
    const items = await getHistory(1);
    expect(items).toHaveLength(1);
    expect(items[0].aid).toBe(2);
  });

  test('returns empty list when data.list missing', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ code: 0, message: '0', data: { cursor: { max: 0, view_at: 0, business: '' } } }),
    );
    const items = await getHistory(1);
    expect(items).toEqual([]);
  });

  test('throws BiliApiError with login hint when code is -352', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({ code: -352, message: '请先登录' }),
    );
    try {
      await getHistory(1);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BiliApiError);
      expect((err as BiliApiError).code).toBe(-352);
      expect((err as BiliApiError).hint).toContain('请先运行 `pilidown login`');
    }
  });

  test('defaults page to 1', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ code: 0, message: '0', data: [] }),
    );
    await getHistory();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('pn=1');
  });
});

describe('getToView', () => {
  test('GETs /x/v2/history/toview/web and returns count + videos', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        code: 0,
        message: '0',
        data: {
          count: 2,
          list: [
            { aid: 1, bvid: 'BV1a', title: 't1', pic: '', duration: 30, pubdate: 0, cid: 10, add_at: 1, owner: { mid: 1, name: 'u', face: '' } },
            { aid: 2, bvid: 'BV1b', title: 't2', pic: '', duration: 60, pubdate: 0, cid: 20, add_at: 2, owner: { mid: 2, name: 'u2', face: '' } },
          ],
        },
      }),
    );
    const r = await getToView({ SESSDATA: 's' });
    expect(r.total).toBe(2);
    expect(r.videos).toHaveLength(2);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/x/v2/history/toview/web');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const cookie = (init.headers as Record<string, string>)['Cookie'];
    expect(cookie).toContain('SESSDATA=s');
    expect(cookie).toContain('buvid3=TEST-BUVID3');
  });

  test('returns empty when data.list missing', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ code: 0, message: '0', data: { count: 0 } }),
    );
    const r = await getToView();
    expect(r.videos).toEqual([]);
    expect(r.total).toBe(0);
  });

  test('throws BiliApiError with login hint on -352', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({ code: -352, message: '请先登录' }),
    );
    try {
      await getToView();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BiliApiError);
      expect((err as BiliApiError).code).toBe(-352);
      expect((err as BiliApiError).hint).toContain('请先运行 `pilidown login`');
    }
  });
});
