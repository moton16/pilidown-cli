import { bv2av, av2bv } from '../../src/core/bvid';

describe('BvId conversion', () => {
  test('bv2av converts known BV to av', () => {
    expect(bv2av('BV17x411w7KC')).toBe(170001);
  });

  test('av2bv converts known av to BV', () => {
    expect(av2bv(170001)).toBe('BV17x411w7KC');
  });

  test('round-trip: bv2av(av2bv(n)) === n', () => {
    for (const n of [1, 170001, 1000000, 99999999]) {
      expect(bv2av(av2bv(n))).toBe(n);
    }
  });

  test('av2bv produces 12-char string starting with BV', () => {
    const bv = av2bv(170001);
    expect(bv).toHaveLength(12);
    expect(bv.startsWith('BV')).toBe(true);
  });

  test('bv2av throws on invalid BV', () => {
    expect(() => bv2av('invalid')).toThrow();
    expect(() => bv2av('BV123')).toThrow(); // too short
  });
});