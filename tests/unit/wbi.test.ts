import {
  MIXIN_KEY_ENC_TAB,
  getMixinKey,
  encWbi,
} from '../../src/core/wbi';

// Official test vector from SocialSisterYi/bilibili-API-collect wbi.md
const IMG_KEY = '653657f524a547ac981ded72ea172057';
const SUB_KEY = '6e4909c702f846728e64f6007736a338';
const EXPECTED_MIXIN_KEY = '72136226c6a73669787ee4fd02a74c27';
const EXPECTED_W_RID = '90efcab09403023875b8516f07e9f9de';

describe('WBI signature', () => {
  describe('MIXIN_KEY_ENC_TAB', () => {
    test('has 64 entries', () => {
      expect(MIXIN_KEY_ENC_TAB).toHaveLength(64);
    });

    test('is a permutation of 0..63', () => {
      const sorted = [...MIXIN_KEY_ENC_TAB].sort((a, b) => a - b);
      expect(sorted).toEqual(Array.from({ length: 64 }, (_, i) => i));
    });
  });

  describe('getMixinKey', () => {
    test('returns first 32 chars of permuted img+sub', () => {
      const mixinKey = getMixinKey(IMG_KEY + SUB_KEY);
      expect(mixinKey).toHaveLength(32);
      expect(mixinKey).toBe(EXPECTED_MIXIN_KEY);
    });
  });

  describe('encWbi (official test vector)', () => {
    test('produces the official w_rid', () => {
      const mixinKey = getMixinKey(IMG_KEY + SUB_KEY);
      // Note: official doc uses `zab` (not `baz`) — see wbi.md
      const params = { foo: '114', bar: '514', zab: '1919810' };
      const wts = 1684746387;
      const wRid = encWbi(params, mixinKey, wts);
      expect(wRid).toBe(EXPECTED_W_RID);
    });

    test('returns 32-char lowercase hex md5', () => {
      const mixinKey = getMixinKey(IMG_KEY + SUB_KEY);
      const wRid = encWbi({ foo: '1' }, mixinKey, 1684746387);
      expect(wRid).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('param sorting', () => {
    test('signing is independent of insertion order', () => {
      const mixinKey = getMixinKey(IMG_KEY + SUB_KEY);
      const wts = 1684746387;
      const a = encWbi({ bar: '1', foo: '2', baz: '3' }, mixinKey, wts);
      const b = encWbi({ baz: '3', foo: '2', bar: '1' }, mixinKey, wts);
      expect(a).toBe(b);
    });
  });

  describe('special char filtering', () => {
    test("strips !'()* from encoded query before hashing", () => {
      const mixinKey = getMixinKey(IMG_KEY + SUB_KEY);
      const wts = 1684746387;
      // These chars are NOT encoded by encodeURIComponent, so WBI removes them.
      // "a!'b()*c" -> "abc" after stripping !'()*
      const withSpecial = { v: "a!'b()*c" };
      const filtered = { v: 'abc' };
      expect(encWbi(withSpecial, mixinKey, wts)).toBe(
        encWbi(filtered, mixinKey, wts),
      );
    });

    test('does not mutate input params object', () => {
      const mixinKey = getMixinKey(IMG_KEY + SUB_KEY);
      const params = { foo: '114', bar: '514' };
      const snapshot = { ...params };
      encWbi(params, mixinKey, 1684746387);
      expect(params).toEqual(snapshot);
    });
  });
});