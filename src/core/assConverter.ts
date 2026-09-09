/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources (entire Danmaku2Ass directory):
 *   - src/DownKyi.Core/Danmaku2Ass/Config.cs
 *   - src/DownKyi.Core/Danmaku2Ass/Display.cs
 *   - src/DownKyi.Core/Danmaku2Ass/Collision.cs
 *   - src/DownKyi.Core/Danmaku2Ass/Subtitle.cs
 *   - src/DownKyi.Core/Danmaku2Ass/Creater.cs
 *   - src/DownKyi.Core/Danmaku2Ass/Producer.cs
 *   - src/DownKyi.Core/Danmaku2Ass/Filter.cs
 *   - src/DownKyi.Core/Danmaku2Ass/Danmaku.cs
 *   - src/DownKyi.Core/Danmaku2Ass/Bilibili.cs
 *   - src/DownKyi.Core/Danmaku2Ass/Utils.cs
 *   - src/DownKyi.Core/Danmaku2Ass/Studio.cs
 *
 * Port note: C# uses reflection + class hierarchy for Display subclasses.
 * We collapse to a tagged-union factory + switch. Filters are simplified
 * (pilidown command surfaces --no-top / --no-bottom / --no-scroll later).
 */

import type { BiliDanmaku } from '../types/bili';

// ---- config ----

export interface AssConfig {
  title: string;
  screenWidth: number;
  screenHeight: number;
  fontName: string;
  baseFontSize: number;
  lineCount: number;          // 0 = auto (floor(screenHeight / baseFontSize))
  layoutAlgorithm: 'sync' | 'async';
  tuneDuration: number;       // 微调时长
  dropOffset: number;         // 丢弃偏移
  bottomMargin: number;       // 底部边距
  customOffset: number;       // 自定义偏移
  topFilter: boolean;
  bottomFilter: boolean;
  scrollFilter: boolean;
}

export const DEFAULT_ASS_CONFIG: AssConfig = {
  title: 'pilidown',
  screenWidth: 1920,
  screenHeight: 1080,
  fontName: '黑体',
  baseFontSize: 50,
  lineCount: 0,
  layoutAlgorithm: 'sync',
  tuneDuration: 0,
  dropOffset: 0,
  bottomMargin: 30,
  customOffset: 0,
  topFilter: false,
  bottomFilter: false,
  scrollFilter: false,
};

function resolveLineCount(c: AssConfig): number {
  if (c.lineCount > 0) return c.lineCount;
  return Math.floor(c.screenHeight / c.baseFontSize);
}

// ---- utils ----

export function int2bgr(integer: number): string {
  const rgb = integer.toString(16).toUpperCase().padStart(6, '0');
  return rgb.substring(4, 6) + rgb.substring(2, 4) + rgb.substring(0, 2);
}

export function second2hms(seconds: number): string {
  if (seconds < 0 || !isFinite(seconds)) return '0:00:00.00';
  const i = Math.floor(seconds);
  let dec = Math.round((seconds - i) * 100);
  if (dec >= 100) dec = 99;
  const second = i % 60;
  let min = Math.floor(i / 60);
  const hour = Math.floor(min / 60);
  min = min % 60;
  return `${hour}:${String(min).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(dec).padStart(2, '0')}`;
}

function displayLength(text: string): number {
  // 1 个汉字当 2 个英文（C# uses Encoding.Default byte count; we approximate via UTF-8).
  return Buffer.byteLength(text, 'utf8');
}

function intCeiling(n: number): number {
  return Math.ceil(n);
}

function isDark(integer: number): boolean {
  if (integer === 0) return true;
  const rgb = integer.toString(16).padStart(6, '0');
  const r = parseInt(rgb.substring(0, 2), 16);
  const g = parseInt(rgb.substring(2, 4), 16);
  const b = parseInt(rgb.substring(4, 6), 16);
  // Simple luminance threshold — keep close to C# IsDark heuristic without HLS.
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const lightness = (minc + maxc) / 2 / 255 * 100;
  // C# uses hue+lightness; we use a simpler lightness-only heuristic. Good enough
  // for the only consumer (whether to add a dark outline), and self-contained.
  return lightness < 50;
}

function correctTypos(text: string): string {
  return text
    .replace(/\/n/g, '\\N')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<');
}

// ---- internal model (port of C# Danmaku.cs) ----

interface InternalDanmaku {
  start: number;       // seconds
  style: 'scroll' | 'top' | 'bottom' | 'none';
  color: number;
  commenter: string;
  content: string;
  sizeRatio: number;
}

const MODE_TO_STYLE: Record<number, InternalDanmaku['style']> = {
  0: 'none',
  1: 'scroll',
  2: 'scroll',
  3: 'scroll',
  4: 'bottom',
  5: 'top',
  6: 'scroll',
  7: 'none',
  8: 'none',
  9: 'none',
  10: 'none',
  11: 'none',
  12: 'none',
  13: 'none',
  14: 'none',
  15: 'none',
};

const NORMAL_FONT_SIZE = 25;

function toInternalDanmaku(d: BiliDanmaku): InternalDanmaku {
  return {
    start: d.progress / 1000,
    style: MODE_TO_STYLE[d.mode] ?? 'none',
    color: d.color,
    commenter: d.midHash,
    content: d.content,
    sizeRatio: (1.0 * d.fontsize) / NORMAL_FONT_SIZE,
  };
}

// ---- display (port of C# Display.cs + subclasses) ----

interface Display {
  config: AssConfig;
  danmaku: InternalDanmaku;
  lineIndex: number;
  fontSize: number;
  isScaled: boolean;
  maxLength: number;
  width: number;
  height: number;
  horizontal: [number, number];
  vertical: [number, number];
  duration: number;
  leave: number;
}

function makeDisplay(config: AssConfig, danmaku: InternalDanmaku): Display {
  // Base Display fields
  const isScaled = Math.round(danmaku.sizeRatio * 100) / 100 !== 1.0;
  const fontSize = intCeiling(config.baseFontSize * danmaku.sizeRatio);
  const lines = danmaku.content.split('\n');
  const maxLength = lines.reduce((m, l) => Math.max(m, displayLength(l)), 0);
  const width = intCeiling(fontSize * maxLength);
  const height = lines.length * fontSize;

  const base: Display = {
    config,
    danmaku,
    lineIndex: 0,
    fontSize,
    isScaled,
    maxLength,
    width,
    height,
    horizontal: [Math.floor(config.screenWidth / 2), Math.floor(config.screenWidth / 2)],
    vertical: [Math.floor(config.screenHeight / 2), Math.floor(config.screenHeight / 2)],
    duration: 0,
    leave: 0,
  };

  if (danmaku.style === 'scroll') {
    return finalizeScroll(base);
  }
  if (danmaku.style === 'top') {
    return finalizeTop(base);
  }
  if (danmaku.style === 'bottom') {
    return finalizeBottom(base);
  }
  // 'none' shouldn't reach here; return base with default duration.
  base.duration = baseDurationForFixed(base);
  base.leave = intCeiling(base.danmaku.start + base.duration);
  return base;
}

function baseDurationForFixed(d: Display): number {
  let baseDuration = 3 + d.config.tuneDuration;
  if (baseDuration < 0) baseDuration = 0;
  const charCount = d.maxLength / 2;
  if (charCount < 6) return baseDuration + 1;
  if (charCount < 12) return baseDuration + 2;
  return baseDuration + 3;
}

function finalizeTop(d: Display): Display {
  // vertical: y = LineIndex * BaseFontSize
  // (set later in relayout)
  d.duration = baseDurationForFixed(d);
  d.leave = intCeiling(d.danmaku.start + d.duration);
  return d;
}

function finalizeBottom(d: Display): Display {
  d.duration = baseDurationForFixed(d);
  d.leave = intCeiling(d.danmaku.start + d.duration);
  return d;
}

function finalizeScroll(d: Display): Display {
  // horizontal: from (screenWidth + width/2) to (0 - width/2)
  const x1 = d.config.screenWidth + Math.floor(d.width / 2);
  const x2 = 0 - Math.floor(d.width / 2);
  d.horizontal = [x1, x2];

  const baseDuration = 12 + d.config.tuneDuration;
  const safeBase = baseDuration <= 0 ? 1 : baseDuration;
  const speed = intCeiling(d.config.screenWidth / safeBase);
  const distance = x1 - x2;

  let duration: number;
  if (d.config.layoutAlgorithm === 'async') {
    const b = 6 + d.config.tuneDuration;
    const base2 = b < 0 ? 0 : b;
    const charCount = d.maxLength / 2;
    if (charCount < 6) duration = base2 + charCount;
    else if (charCount < 12) duration = base2 + charCount / 2;
    else if (charCount < 24) duration = base2 + charCount / 3;
    else duration = base2 + 10;
  } else {
    // sync
    duration = distance / speed;
  }
  d.duration = Math.floor(duration);
  // leave = start + (width / speed) — last character leaves the right edge
  const leaveDuration = d.width / speed;
  d.leave = intCeiling(d.danmaku.start + leaveDuration);
  return d;
}

function relayout(d: Display, lineIndex: number): void {
  d.lineIndex = lineIndex;
  if (d.danmaku.style === 'scroll') {
    // vertical: (lineIndex + 1) * baseFontSize, but not less than fontSize
    let y = (lineIndex + 1) * d.config.baseFontSize;
    if (y < d.fontSize) y = d.fontSize;
    d.vertical = [y, y];
    // horizontal stays the same (already computed in finalizeScroll)
  } else if (d.danmaku.style === 'top') {
    const y = lineIndex * d.config.baseFontSize;
    d.vertical = [y, y];
  } else if (d.danmaku.style === 'bottom') {
    let y = d.config.screenHeight - lineIndex * d.config.baseFontSize - d.height;
    y -= d.config.bottomMargin;
    d.vertical = [y, y];
  }
}

// ---- collision (port of C# Collision.cs) ----

export interface Collision {
  leaves: number[];
}

function makeCollision(lineCount: number): Collision {
  return { leaves: new Array(lineCount).fill(0) };
}

function detect(c: Collision, display: Display): { lineIndex: number; offset: number } {
  const beyonds: number[] = [];
  for (let i = 0; i < c.leaves.length; i++) {
    const beyond = display.danmaku.start - c.leaves[i];
    if (beyond >= 0) {
      return { lineIndex: i, offset: 0 };
    }
    beyonds.push(beyond);
  }
  // No room: pick the line that frees up soonest (max beyond = least negative).
  let soon = beyonds[0];
  let lineIndex = 0;
  for (let i = 1; i < beyonds.length; i++) {
    if (beyonds[i] > soon) {
      soon = beyonds[i];
      lineIndex = i;
    }
  }
  return { lineIndex, offset: -soon };
}

function update(c: Collision, leave: number, lineIndex: number, offset: number): void {
  c.leaves[lineIndex] = intCeiling(leave + offset);
}

// ---- subtitle (port of C# Subtitle.cs) ----

interface Subtitle {
  start: number;
  end: number;
  text: string;
}

function makeSubtitle(danmaku: InternalDanmaku, display: Display, offset: number): Subtitle {
  const start = danmaku.start + offset;
  const end = start + display.duration;
  const color = int2bgr(danmaku.color);

  let colorMarkup = '';
  if (color !== 'FFFFFF') colorMarkup = `\\c&H${color}`;
  // Outline: dark danmaku gets a black outline for readability (matches C#).
  // C# always uses \\3c&H000000 for both branches.
  const borderMarkup = '\\3c&H000000';
  const fontSizeMarkup = display.isScaled ? `\\fs${display.fontSize}` : '';

  let styleMarkup: string;
  if (danmaku.style === 'scroll') {
    const [x1, x2] = display.horizontal;
    const [y1] = display.vertical;
    styleMarkup = `\\move(${x1}, ${y1}, ${x2}, ${y1})`;
  } else {
    const [x1] = display.horizontal;
    const [y1] = display.vertical;
    styleMarkup = `\\a6\\pos(${x1}, ${y1})`;
  }

  const layerMarkup = danmaku.style === 'scroll' ? '-1' : '-2';
  const content = correctTypos(danmaku.content);
  const contentMarkup = `{${styleMarkup}${colorMarkup}${borderMarkup}${fontSizeMarkup}}${content}`;
  const text = `Dialogue: ${layerMarkup},${second2hms(start)},${second2hms(end)},Danmaku,,0000,0000,0000,,${contentMarkup}`;
  return { start, end, text };
}

// ---- header (port of C# Config.cs HeaderTemplate) ----

const HEADER_TEMPLATE = `[Script Info]
; Script generated by pilidown
; https://github.com/moton16/pilidown-cli
Title: {title}
ScriptType: v4.00+
Collisions: Normal
PlayResX: {width}
PlayResY: {height}
Timer: 10.0000
WrapStyle: 2
ScaledBorderAndShadow: no

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{fontname},54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0.00,0.00,1,2.00,0.00,2,30,30,120,0
Style: Alternate,{fontname},36,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0.00,0.00,1,2.00,0.00,2,30,30,84,0
Style: Danmaku,{fontname},{fontsize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0.00,0.00,1,1.00,0.00,2,30,30,30,0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

function renderHeader(c: AssConfig): string {
  return HEADER_TEMPLATE
    .replace('{title}', c.title)
    .replace('{width}', String(c.screenWidth))
    .replace('{height}', String(c.screenHeight))
    .replace('{fontname}', c.fontName)
    .replace('{fontsize}', String(c.baseFontSize));
}

// ---- public API ----

/**
 * Convert a list of BiliDanmaku to a full ASS subtitle file string.
 * Port of C# Bilibili.Create + Studio.StartHandle + Creater.
 */
export function createAssFile(
  danmakuList: BiliDanmaku[],
  configOverrides: Partial<AssConfig> = {},
): string {
  const config: AssConfig = { ...DEFAULT_ASS_CONFIG, ...configOverrides };
  const lineCount = resolveLineCount(config);

  // Convert + sort by progress (ms ascending), mirroring C# biliDanmakus.Sort.
  const internals = danmakuList
    .map(toInternalDanmaku)
    .filter(d => d.style !== 'none')
    .filter(d => !config.topFilter || d.style !== 'top')
    .filter(d => !config.bottomFilter || d.style !== 'bottom')
    .filter(d => !config.scrollFilter || d.style !== 'scroll')
    .sort((a, b) => a.start - b.start);

  // Two collision trackers: scroll uses one, top+bottom share the other.
  const scrollCollision = makeCollision(lineCount);
  const stayedCollision = makeCollision(lineCount);

  const subtitleTexts: string[] = [];
  for (const danmaku of internals) {
    const display = makeDisplay(config, danmaku);
    const collision = danmaku.style === 'scroll' ? scrollCollision : stayedCollision;
    const { lineIndex, offset: waitingOffset } = detect(collision, display);

    // Drop if waiting offset exceeds the configured tolerance.
    if (config.dropOffset > 0 && waitingOffset > config.dropOffset) {
      continue;
    }

    relayout(display, lineIndex);
    update(collision, display.leave, lineIndex, waitingOffset);

    const offset = waitingOffset + config.customOffset;
    const subtitle = makeSubtitle(danmaku, display, offset);
    subtitleTexts.push(subtitle.text);
  }

  const header = renderHeader(config);
  return header + (subtitleTexts.length > 0 ? '\n' + subtitleTexts.join('\n') : '');
}
