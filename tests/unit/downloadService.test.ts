import * as VideoApi from '../../src/api/VideoApi';
import * as CookieService from '../../src/services/CookieService';
import * as StreamService from '../../src/services/StreamService';
import * as downloader from '../../src/utils/downloader';
import * as media from '../../src/utils/media';
import {
  downloadVideo,
  downloadAllPages,
  downloadCollection,
  classifyError,
} from '../../src/services/DownloadService';

jest.mock('../../src/api/VideoApi');
jest.mock('../../src/services/CookieService');
jest.mock('../../src/services/StreamService');
jest.mock('../../src/utils/downloader');
jest.mock('../../src/utils/media');

describe('DownloadService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CookieService.loadCookies as jest.Mock).mockReturnValue({ cookies: {} });
  });

  describe('classifyError', () => {
    test('classifies various error messages', () => {
      expect(classifyError(new Error('Network HTTP 500'))).toBe('E_HTTP');
      expect(classifyError(new Error('fMP4 merge error'))).toBe('E_MERGE');
      expect(classifyError(new Error('playurl URL expired'))).toBe('E_EXPIRED_URL');
      expect(classifyError(new Error('ENOSPC: no space on disk'))).toBe('E_DISK');
      expect(classifyError(new Error('format not supported'))).toBe('E_UNSUPPORTED');
      expect(classifyError(new Error('random unknown failure'))).toBe('E_HTTP');
    });
  });

  describe('downloadVideo', () => {
    test('throws when page not found', async () => {
      (VideoApi.getVideoInfo as jest.Mock).mockResolvedValue({
        bvid: 'BV1test',
        title: 'Test Video',
        pages: [],
      });

      await expect(
        downloadVideo({ bvid: 'BV1test', page: 1, outputDir: '/tmp' }),
      ).rejects.toThrow('Page 1 not found in BV1test');
    });

    test('re-throws when mergeDashStreams fails', async () => {
      (VideoApi.getVideoInfo as jest.Mock).mockResolvedValue({
        bvid: 'BV1test',
        title: 'Test Video',
        pages: [{ page: 1, cid: 1001, part: 'P1' }],
      });
      (VideoApi.getPlayUrl as jest.Mock).mockResolvedValue({});
      (StreamService.selectStreams as jest.Mock).mockReturnValue({
        quality: 80,
        video: { id: 80, baseUrl: 'http://v', codecid: 7 },
        audio: { id: 30280, baseUrl: 'http://a' },
      });
      (downloader.downloadMultiThread as jest.Mock).mockResolvedValue({
        totalBytes: 1000,
      });
      (media.mergeDashStreams as jest.Mock).mockRejectedValue(
        new Error('Box parse failure during merge'),
      );

      await expect(
        downloadVideo({ bvid: 'BV1test', page: 1, outputDir: '/tmp' }),
      ).rejects.toThrow('Box parse failure during merge');
    });
  });

  describe('downloadAllPages', () => {
    const mockInfo = {
      bvid: 'BV1multi',
      title: 'Multi Page Video',
      pages: [
        { page: 1, cid: 101, part: 'Part 1' },
        { page: 2, cid: 102, part: 'Part 2' },
        { page: 3, cid: 103, part: 'Part 3' },
        { page: 4, cid: 104, part: 'Part 4' },
      ],
    };

    test('all pages succeed and return in correct page index order', async () => {
      (VideoApi.getVideoInfo as jest.Mock).mockResolvedValue(mockInfo);
      (VideoApi.getPlayUrl as jest.Mock).mockResolvedValue({});
      (StreamService.selectStreams as jest.Mock).mockReturnValue({
        quality: 80,
        video: { id: 80, baseUrl: 'http://v', codecid: 7 },
        audio: { id: 30280, baseUrl: 'http://a' },
      });
      (downloader.downloadMultiThread as jest.Mock).mockImplementation(async (url) => {
        // simulate variable latency to test order stability
        const delay = url.includes('102') ? 20 : 5;
        await new Promise((r) => setTimeout(r, delay));
        return { totalBytes: 500 };
      });
      (media.mergeDashStreams as jest.Mock).mockResolvedValue(undefined);

      const res = await downloadAllPages({ bvid: 'BV1multi', outputDir: '/tmp' });

      expect(res.failures).toHaveLength(0);
      expect(res.results).toHaveLength(4);
      expect(res.results.map((r) => r.page)).toEqual([1, 2, 3, 4]);
    });

    test('partial failure: failures recorded with code, results preserve order', async () => {
      (VideoApi.getVideoInfo as jest.Mock).mockResolvedValue(mockInfo);
      (VideoApi.getPlayUrl as jest.Mock).mockImplementation(async ({ cid }) => {
        if (cid === 102) throw new Error('HTTP 502 Bad Gateway');
        return {};
      });
      (StreamService.selectStreams as jest.Mock).mockReturnValue({
        quality: 80,
        video: { id: 80, baseUrl: 'http://v', codecid: 7 },
        audio: { id: 30280, baseUrl: 'http://a' },
      });
      (downloader.downloadMultiThread as jest.Mock).mockResolvedValue({ totalBytes: 500 });
      (media.mergeDashStreams as jest.Mock).mockResolvedValue(undefined);

      const res = await downloadAllPages({ bvid: 'BV1multi', outputDir: '/tmp' });

      expect(res.failures).toHaveLength(1);
      expect(res.failures[0]).toMatchObject({
        page: 2,
        bvid: 'BV1multi',
        stage: 'download',
        code: 'E_HTTP',
      });
      expect(res.results).toHaveLength(3);
      expect(res.results.map((r) => r.page)).toEqual([1, 3, 4]);
    });

    test('all pages fail', async () => {
      (VideoApi.getVideoInfo as jest.Mock).mockResolvedValue(mockInfo);
      (VideoApi.getPlayUrl as jest.Mock).mockRejectedValue(new Error('Network timeout'));

      const res = await downloadAllPages({ bvid: 'BV1multi', outputDir: '/tmp' });

      expect(res.results).toHaveLength(0);
      expect(res.failures).toHaveLength(4);
      expect(res.failures.map((f) => f.page)).toEqual([1, 2, 3, 4]);
      expect(res.failures.every((f) => f.code === 'E_HTTP')).toBe(true);
    });
  });

  describe('downloadCollection', () => {
    test('throws if ugc_season is missing', async () => {
      (VideoApi.getVideoInfo as jest.Mock).mockResolvedValue({
        bvid: 'BV1notugc',
        title: 'Single Video',
        pages: [{ page: 1, cid: 1, part: 'P1' }],
      });

      await expect(
        downloadCollection({ bvid: 'BV1notugc', outputDir: '/tmp' }),
      ).rejects.toThrow('does not belong to a UGC collection');
    });

    test('downloads episodes and preserves ordering', async () => {
      (VideoApi.getVideoInfo as jest.Mock).mockResolvedValue({
        bvid: 'BV1col',
        title: 'Collection Season',
        ugc_season: {
          title: 'My UGC Season',
          sections: [
            {
              episodes: [
                { bvid: 'BV1ep1', aid: 101, cid: 201, title: 'Ep 1' },
                { bvid: 'BV1ep2', aid: 102, cid: 202, title: 'Ep 2' },
              ],
            },
          ],
        },
        pages: [{ page: 1, cid: 201, part: 'Ep 1' }],
      });
      (VideoApi.getPlayUrl as jest.Mock).mockResolvedValue({});
      (StreamService.selectStreams as jest.Mock).mockReturnValue({
        quality: 80,
        video: { id: 80, baseUrl: 'http://v', codecid: 7 },
        audio: { id: 30280, baseUrl: 'http://a' },
      });
      (downloader.downloadMultiThread as jest.Mock).mockResolvedValue({ totalBytes: 500 });
      (media.mergeDashStreams as jest.Mock).mockResolvedValue(undefined);

      const res = await downloadCollection({ bvid: 'BV1col', outputDir: '/tmp' });

      expect(res.failures).toHaveLength(0);
      expect(res.results).toHaveLength(2);
    });
  });
});
