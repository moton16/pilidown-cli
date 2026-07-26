/**
 * pilidown - Unit tests for assConverter
 * Original: tests are original to pilidown (assert on shape of ported C# logic).
 */

import {
  createAssFile,
  DEFAULT_ASS_CONFIG,
  int2bgr,
  second2hms,
  type AssConfig,
} from '../../src/core/assConverter';
import type { BiliDanmaku } from '../../src/types/bili';

function mk(over: Partial<BiliDanmaku>): BiliDanmaku {
  return {
    id: 1,
    progress: 0,
    mode: 1,
    fontsize: 25,
    color: 0xffffff,
    midHash: 'hash',
    content: 'hi',
    ctime: 0,
    weight: 0,
    action: '',
    pool: 0,
    ...over,
  };
}

describe('int2bgr', () => {
  test('white stays FFFFFF', () => {
    expect(int2bgr(0xffffff)).toBe('FFFFFF');
  });

  test('red FFFFFF -> BGR is 0000FF', () => {
    // RGB red = FF0000 → BGR = 0000FF
    expect(int2bgr(0xff0000)).toBe('0000FF');
  });

  test('blue 0000FF -> BGR is FF0000', () => {
    expect(int2bgr(0x0000ff)).toBe('FF0000');
  });

  test('zero pads to 6 hex chars', () => {
    expect(int2bgr(0)).toBe('000000');
  });
});

describe('second2hms', () => {
  test('zero -> 0:00:00.00', () => {
    expect(second2hms(0)).toBe('0:00:00.00');
  });

  test('1.5s -> 0:00:01.50', () => {
    expect(second2hms(1.5)).toBe('0:00:01.50');
  });

  test('65.25s -> 0:01:05.25', () => {
    expect(second2hms(65.25)).toBe('0:01:05.25');
  });

  test('3661.99s -> 1:01:01.99', () => {
    expect(second2hms(3661.99)).toBe('1:01:01.99');
  });

  test('negative clamps to 0:00:00.00', () => {
    expect(second2hms(-5)).toBe('0:00:00.00');
  });
});

describe('createAssFile', () => {
  test('header contains Script Info with configured width/height', () => {
    const ass = createAssFile([], { title: 'MyTitle', screenWidth: 1920, screenHeight: 1080 });
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('Title: MyTitle');
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('PlayResY: 1080');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
    expect(ass).toMatch(/Style: Default,/);
    expect(ass).toMatch(/Style: Danmaku,/);
  });

  test('empty danmaku list produces no Dialogue lines', () => {
    const ass = createAssFile([]);
    expect(ass).not.toMatch(/^Dialogue:/m);
  });

  test('single scroll danmaku produces a Dialogue line with \\move', () => {
    const d = mk({ mode: 1, progress: 1000, content: '前方高能' });
    const ass = createAssFile([d]);
    const lines = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('\\move(');
    // start at 1s (1000ms / 1000)
    expect(lines[0]).toContain('0:00:01.00');
  });

  test('top danmaku uses \\pos and layer -2', () => {
    const d = mk({ mode: 5, progress: 2000, content: 'TOP' });
    const ass = createAssFile([d]);
    const lines = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('\\pos(');
    expect(lines[0]).not.toContain('\\move(');
    expect(lines[0]).toMatch(/^Dialogue: -2,/); // layer markup right after "Dialogue: "
  });

  test('bottom danmaku uses \\pos and layer -2', () => {
    const d = mk({ mode: 4, progress: 500, content: 'BOT' });
    const ass = createAssFile([d]);
    const lines = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('\\pos(');
  });

  test('unknown mode (e.g. 7) is dropped (treated as none)', () => {
    const d = mk({ mode: 7, content: 'advanced' });
    const ass = createAssFile([d]);
    expect(ass).not.toMatch(/^Dialogue:/m);
  });

  test('two non-overlapping scroll danmakus fit on the same line', () => {
    // First danmaku starts at 0s, scroll ~12s. Second at 100s — definitely no collision.
    const d1 = mk({ id: 1, mode: 1, progress: 0, content: 'first' });
    const d2 = mk({ id: 2, mode: 1, progress: 100_000, content: 'second' });
    const ass = createAssFile([d1, d2]);
    const lines = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
    expect(lines).toHaveLength(2);
  });

  test('two overlapping scroll danmakus with same start time go to different lines (collision)', () => {
    // Same start time, same content length — second must move to a new line.
    const d1 = mk({ id: 1, mode: 1, progress: 0, content: 'same' });
    const d2 = mk({ id: 2, mode: 1, progress: 0, content: 'same' });
    const ass = createAssFile([d1, d2]);
    const lines = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
    expect(lines).toHaveLength(2);
    // The \move y coordinate (3rd arg of \move) should differ between the two,
    // indicating they are on different vertical lines.
    const moves = lines.map(l => l.match(/\\move\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/));
    expect(moves[0]).not.toBeNull();
    expect(moves[1]).not.toBeNull();
    const y1 = moves[0]![2];
    const y2 = moves[1]![2];
    expect(y1).not.toBe(y2);
  });

  test('default config has expected baseline values', () => {
    const c: AssConfig = DEFAULT_ASS_CONFIG;
    expect(c.screenWidth).toBe(1920);
    expect(c.screenHeight).toBe(1080);
    expect(c.baseFontSize).toBeGreaterThan(0);
    expect(c.bottomMargin).toBeGreaterThanOrEqual(0);
    // lineCount == 0 means "auto" in DEFAULT config (resolved at conversion time).
    expect(c.lineCount).toBeGreaterThanOrEqual(0);
  });

  test('respects custom screenWidth/screenHeight in header', () => {
    const ass = createAssFile([], { screenWidth: 3840, screenHeight: 2160 });
    expect(ass).toContain('PlayResX: 3840');
    expect(ass).toContain('PlayResY: 2160');
  });

  test('colored (non-white) danmaku gets \\c markup', () => {
    const d = mk({ mode: 1, color: 0xff0000, content: 'red' }); // red RGB
    const ass = createAssFile([d]);
    const lines = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
    expect(lines).toHaveLength(1);
    // red RGB = 0xff0000 → BGR = 0000FF
    expect(lines[0]).toContain('\\c&H0000FF');
  });

  test('progress is converted from ms to seconds for the start time', () => {
    const d = mk({ mode: 5, progress: 65_250, content: 'X' }); // 65.25s
    const ass = createAssFile([d]);
    expect(ass).toContain('0:01:05.25');
  });
});
