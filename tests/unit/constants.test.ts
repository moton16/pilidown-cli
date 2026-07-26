import {
  QUALITY,
  AUDIO_QUALITY,
  CODEC,
  FNVAL,
  FNVAL_DEFAULT,
} from '../../src/core/constants';

describe('Bilibili constants', () => {
  describe('QUALITY (画质 ID 表)', () => {
    test('contains known video quality IDs', () => {
      expect(QUALITY[127]).toBe('8K 超高清');
      expect(QUALITY[126]).toBe('杜比视界');
      expect(QUALITY[125]).toBe('HDR 真彩');
      expect(QUALITY[120]).toBe('4K 超清');
      expect(QUALITY[116]).toBe('1080P 60帧');
      expect(QUALITY[112]).toBe('1080P 高码率');
      expect(QUALITY[80]).toBe('1080P 高清');
      expect(QUALITY[64]).toBe('720P 高清');
      expect(QUALITY[32]).toBe('480P 清晰');
      expect(QUALITY[16]).toBe('360P 流畅');
    });

    test('default quality 80 exists', () => {
      expect(QUALITY[80]).toBeDefined();
    });
  });

  describe('AUDIO_QUALITY (音质 ID 表)', () => {
    test('contains known audio quality IDs', () => {
      expect(AUDIO_QUALITY[30216]).toBe('64K');
      expect(AUDIO_QUALITY[30232]).toBe('132K');
      expect(AUDIO_QUALITY[30280]).toBe('192K');
      expect(AUDIO_QUALITY[30250]).toBe('杜比全景声');
      expect(AUDIO_QUALITY[30251]).toBe('Hi-Res 无损');
    });
  });

  describe('CODEC (编码 ID 表)', () => {
    test('maps codec IDs to names', () => {
      expect(CODEC[7]).toBe('AV1');
      expect(CODEC[12]).toBe('HEVC');
      expect(CODEC[13]).toBe('AVC');
    });
  });

  describe('FNVAL (位掩码枚举)', () => {
    test('defines bitwise flags', () => {
      expect(FNVAL.DASH).toBe(16);
      expect(FNVAL.HDR).toBe(64);
      expect(FNVAL.FOUR_K).toBe(128);
      expect(FNVAL.DOLBY_AUDIO).toBe(256);
      expect(FNVAL.DOLBY_VISION).toBe(512);
      expect(FNVAL.EIGHT_K).toBe(1024);
      expect(FNVAL.AV1).toBe(2048);
    });

    test('each flag is a distinct power of two', () => {
      const flags = [
        FNVAL.DASH,
        FNVAL.HDR,
        FNVAL.FOUR_K,
        FNVAL.DOLBY_AUDIO,
        FNVAL.DOLBY_VISION,
        FNVAL.EIGHT_K,
        FNVAL.AV1,
      ];
      for (const f of flags) {
        expect(f > 0 && (f & (f - 1)) === 0).toBe(true);
      }
      expect(new Set(flags).size).toBe(flags.length);
    });
  });

  describe('FNVAL_DEFAULT', () => {
    test('equals 4048 (all known flags OR-ed together)', () => {
      expect(FNVAL_DEFAULT).toBe(4048);
    });

    test('is the union of all FNVAL flags', () => {
      const expected =
        FNVAL.DASH |
        FNVAL.HDR |
        FNVAL.FOUR_K |
        FNVAL.DOLBY_AUDIO |
        FNVAL.DOLBY_VISION |
        FNVAL.EIGHT_K |
        FNVAL.AV1;
      expect(FNVAL_DEFAULT).toBe(expected);
    });
  });
});