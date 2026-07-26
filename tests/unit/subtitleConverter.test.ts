/**
 * pilidown - Unit tests for subtitleConverter
 * Original: tests are original to pilidown.
 *
 * Covers SRT/ASS/JSON conversion + fetchSubtitle URL handling.
 * Uses the same fetch-mock pattern as videoApi.test.ts.
 */

import {
  fetchSubtitle,
  secondsToSrtTimestamp,
  secondsToAssTimestamp,
  subtitleToSrt,
  subtitleToJson,
  subtitleToAss,
} from '../../src/core/subtitleConverter';
import type { BiliSubtitle, SubtitleBody } from '../../src/types/bili';

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function biliSubtitle(over: Partial<BiliSubtitle> = {}): BiliSubtitle {
  return {
    id: 1,
    lan: 'zh-CN',
    lan_doc: '中文（简体）',
    is_lock: false,
    author_mid: 0,
    subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/sample.json',
    type: 1,
    ...over,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('secondsToSrtTimestamp', () => {
  test('zero -> 00:00:00,000', () => {
    expect(secondsToSrtTimestamp(0)).toBe('00:00:00,000');
  });

  test('5.5s -> 00:00:05,500', () => {
    expect(secondsToSrtTimestamp(5.5)).toBe('00:00:05,500');
  });

  test('1h2m3.4s -> 01:02:03,400', () => {
    expect(secondsToSrtTimestamp(3723.4)).toBe('01:02:03,400');
  });

  test('negative -> 00:00:00,000', () => {
    expect(secondsToSrtTimestamp(-1)).toBe('00:00:00,000');
  });

  test('NaN -> 00:00:00,000', () => {
    expect(secondsToSrtTimestamp(Number.NaN)).toBe('00:00:00,000');
  });

  test('5.999s -> 00:00:05,999 (full millisecond precision, no C# centisecond clamp)', () => {
    // C# Second2hms clamped dec at 99 and used D3, producing 00:00:05,099 for 5.999s.
    // pilidown emits spec-correct milliseconds, so 5.999s -> 999ms.
    expect(secondsToSrtTimestamp(5.999)).toBe('00:00:05,999');
  });
});

describe('secondsToAssTimestamp', () => {
  test('zero -> 0:00:00.00', () => {
    expect(secondsToAssTimestamp(0)).toBe('0:00:00.00');
  });

  test('5.5s -> 0:00:05.50', () => {
    expect(secondsToAssTimestamp(5.5)).toBe('0:00:05.50');
  });

  test('1h2m3.4s -> 1:02:03.40', () => {
    expect(secondsToAssTimestamp(3723.4)).toBe('1:02:03.40');
  });
});

describe('subtitleToSrt', () => {
  test('produces numbered SRT blocks with timestamps + content', () => {
    const body: SubtitleBody[] = [
      { from: 0, to: 5.5, content: '你好' },
      { from: 5.5, to: 10, content: '世界' },
    ];
    const srt = subtitleToSrt(body);
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:05,500\n你好\n\n' +
      '2\n00:00:05,500 --> 00:00:10,000\n世界\n\n',
    );
  });

  test('empty body -> empty string', () => {
    expect(subtitleToSrt([])).toBe('');
  });

  test('sequential numbering 1..N', () => {
    const body: SubtitleBody[] = [
      { from: 0, to: 1, content: 'a' },
      { from: 1, to: 2, content: 'b' },
      { from: 2, to: 3, content: 'c' },
    ];
    const srt = subtitleToSrt(body);
    expect(srt).toMatch(/^1\n/);
    expect(srt).toContain('\n2\n00:00:01,000');
    expect(srt).toContain('\n3\n00:00:02,000');
  });

  test('timestamp format uses HH:MM:SS,mmm with comma separator', () => {
    const srt = subtitleToSrt([{ from: 0, to: 1.5, content: 'x' }]);
    expect(srt).toMatch(/00:00:00,000 --> 00:00:01,500/);
  });
});

describe('subtitleToJson', () => {
  test('embeds lan/lan_doc and body array', () => {
    const body: SubtitleBody[] = [{ from: 0, to: 1, content: 'hi' }];
    const json = subtitleToJson(body, 'zh-CN', '中文（简体）');
    const parsed = JSON.parse(json);
    expect(parsed.lan).toBe('zh-CN');
    expect(parsed.lan_doc).toBe('中文（简体）');
    expect(Array.isArray(parsed.body)).toBe(true);
    expect(parsed.body[0]).toEqual({ from: 0, to: 1, content: 'hi' });
  });

  test('preserves multi-line content', () => {
    const body: SubtitleBody[] = [{ from: 0, to: 1, content: 'line1\nline2' }];
    const json = subtitleToJson(body, 'en', 'English');
    const parsed = JSON.parse(json);
    expect(parsed.body[0].content).toBe('line1\nline2');
  });
});

describe('subtitleToAss', () => {
  test('contains [Script Info], [V4+ Styles], [Events] sections', () => {
    const ass = subtitleToAss([{ from: 0, to: 1, content: 'hi' }]);
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
  });

  test('sets PlayResX 1920 and PlayResY 1080', () => {
    const ass = subtitleToAss([]);
    expect(ass).toMatch(/PlayResX: 1920/);
    expect(ass).toMatch(/PlayResY: 1080/);
  });

  test('Default style uses font size 50', () => {
    const ass = subtitleToAss([]);
    const styleLine = ass.split('\n').find(l => l.startsWith('Style: Default'));
    expect(styleLine).toBeDefined();
    // Style format: Name,Fontname,Fontsize,... -> split by comma, index 2 is Fontsize.
    const parts = styleLine!.split(',');
    expect(parts[0]).toBe('Style: Default');
    expect(parts[2]).toBe('50');
  });

  test('one Dialogue line per body item with ASS timestamps', () => {
    const body: SubtitleBody[] = [
      { from: 0, to: 5.5, content: '你好' },
      { from: 5.5, to: 10, content: '世界' },
    ];
    const ass = subtitleToAss(body);
    const dialogues = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
    expect(dialogues).toHaveLength(2);
    expect(dialogues[0]).toMatch(/^Dialogue: 0,0:00:00\.00,0:00:05\.50,Default,,0,0,0,,你好$/);
    expect(dialogues[1]).toMatch(/^Dialogue: 0,0:00:05\.50,0:00:10\.00,Default,,0,0,0,,世界$/);
  });

  test('multi-line content gets \\N separator per ASS spec', () => {
    const ass = subtitleToAss([{ from: 0, to: 1, content: 'a\nb' }]);
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,a\\Nb');
  });

  test('ends with trailing newline', () => {
    const ass = subtitleToAss([]);
    expect(ass.endsWith('\n')).toBe(true);
  });
});

describe('fetchSubtitle', () => {
  test('prepends "https:" to protocol-relative URL', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ body: [{ from: 0, to: 1, content: 'x' }] }),
    );
    const body = await fetchSubtitle(biliSubtitle({ subtitle_url: '//aisubtitle.hdslb.com/x.json' }));
    expect(body).toEqual([{ from: 0, to: 1, content: 'x' }]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('https://aisubtitle.hdslb.com/x.json');
  });

  test('leaves fully-qualified https URL unchanged', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockJsonResponse({ body: [] }),
    );
    await fetchSubtitle(biliSubtitle({ subtitle_url: 'https://example.com/sub.json' }));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('https://example.com/sub.json');
  });

  test('throws on empty subtitle_url', async () => {
    await expect(fetchSubtitle(biliSubtitle({ subtitle_url: '' }))).rejects.toThrow(/empty subtitle_url/);
  });

  test('returns [] when response.body is missing', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => mockJsonResponse({}));
    const body = await fetchSubtitle(biliSubtitle());
    expect(body).toEqual([]);
  });
});
