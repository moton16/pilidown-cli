import { parseEntrance } from '../../src/core/parseEntrance';

describe('parseEntrance', () => {
  describe('video', () => {
    test('parses BV url', () => {
      expect(parseEntrance('https://www.bilibili.com/video/BV17x411w7KC')).toEqual({
        type: 'video',
        bvid: 'BV17x411w7KC',
      });
    });

    test('parses bare BV id', () => {
      expect(parseEntrance('BV17x411w7KC')).toEqual({
        type: 'video',
        bvid: 'BV17x411w7KC',
      });
    });

    test('parses av id', () => {
      expect(parseEntrance('av170001')).toEqual({
        type: 'video',
        aid: 170001,
      });
    });

    test('parses av url', () => {
      expect(parseEntrance('https://www.bilibili.com/video/av170001')).toEqual({
        type: 'video',
        aid: 170001,
      });
    });

    test('parses b23.tv short link with BV', () => {
      expect(parseEntrance('https://b23.tv/BV17x411w7KC')).toEqual({
        type: 'video',
        bvid: 'BV17x411w7KC',
      });
    });

    test('strips query string from BV url', () => {
      expect(
        parseEntrance('https://www.bilibili.com/video/BV17x411w7KC?p=2&t=10'),
      ).toEqual({ type: 'video', bvid: 'BV17x411w7KC' });
    });
  });

  describe('bangumi', () => {
    test('parses ss url', () => {
      expect(
        parseEntrance('https://www.bilibili.com/bangumi/play/ss12345'),
      ).toEqual({ type: 'bangumi', seasonId: 12345 });
    });

    test('parses ep url', () => {
      expect(
        parseEntrance('https://www.bilibili.com/bangumi/play/ep67890'),
      ).toEqual({ type: 'bangumi', episodeId: 67890 });
    });

    test('parses md url', () => {
      expect(
        parseEntrance('https://www.bilibili.com/bangumi/media/md11111'),
      ).toEqual({ type: 'bangumi', mediaId: 11111 });
    });

    test('parses bare ss id', () => {
      expect(parseEntrance('ss12345')).toEqual({ type: 'bangumi', seasonId: 12345 });
    });

    test('parses bare ep id', () => {
      expect(parseEntrance('ep67890')).toEqual({ type: 'bangumi', episodeId: 67890 });
    });

    test('parses bare md id', () => {
      expect(parseEntrance('md11111')).toEqual({ type: 'bangumi', mediaId: 11111 });
    });
  });

  describe('cheese', () => {
    test('parses cheese ss url', () => {
      expect(
        parseEntrance('https://www.bilibili.com/cheese/play/ss222'),
      ).toEqual({ type: 'cheese', seasonId: 222 });
    });

    test('parses cheese ep url', () => {
      expect(
        parseEntrance('https://www.bilibili.com/cheese/play/ep333'),
      ).toEqual({ type: 'cheese', episodeId: 333 });
    });
  });

  describe('favorites', () => {
    test('parses favorites url', () => {
      expect(
        parseEntrance('https://www.bilibili.com/medialist/detail/ml9999'),
      ).toEqual({ type: 'favorites', mediaId: 9999 });
    });

    test('parses bare ml id', () => {
      expect(parseEntrance('ml9999')).toEqual({ type: 'favorites', mediaId: 9999 });
    });
  });

  describe('user', () => {
    test('parses space url', () => {
      expect(parseEntrance('https://space.bilibili.com/12345')).toEqual({
        type: 'user',
        mid: 12345,
      });
    });

    test('parses uid prefix', () => {
      expect(parseEntrance('uid12345')).toEqual({ type: 'user', mid: 12345 });
    });

    test('parses mid prefix', () => {
      expect(parseEntrance('mid12345')).toEqual({ type: 'user', mid: 12345 });
    });
  });

  describe('errors', () => {
    test('throws on empty input', () => {
      expect(() => parseEntrance('')).toThrow();
    });

    test('throws on unrecognized string', () => {
      expect(() => parseEntrance('not-a-valid-entrance')).toThrow();
    });

    test('throws on av without digits', () => {
      expect(() => parseEntrance('av')).toThrow();
    });
  });
});