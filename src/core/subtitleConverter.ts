/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/Models/Json/Subtitle.cs
 *   - src/DownKyi.Core/BiliApi/Models/Json/SubtitleJson.cs
 *   - src/DownKyi.Core/BiliApi/Models/Json/SubRipText.cs
 *
 * Subtitle fetch + JSON/SRT/ASS conversion.
 * C# `VideoStream.GetSubtitle` requests `https:{subtitle_url}` (note: literal `https:` prefix
 * concatenated with a `//aisubtitle.hdslb.com/...` path), parses SubtitleJson, then ToSubRip().
 * pilidown ports that flow but exposes per-format converters for the CLI.
 */

import { httpRequest } from '../utils/httpClient';
import type { BiliSubtitle, SubtitleBody } from '../types/bili';

/** Raw shape returned by the subtitle_url endpoint (bilibili-API-collect). */
interface SubtitleJsonResponse {
  font_size?: number;
  font_color?: string;
  background_alpha?: number;
  background_color?: string;
  Stroke?: string;
  body?: SubtitleBody[];
}

/**
 * Fetch a single subtitle track and return its body lines.
 * `subtitle.subtitle_url` is usually a protocol-relative URL like `//aisubtitle.hdslb.com/...`,
 * mirroring C# `WebClient.RequestWeb($"https:{subtitle.SubtitleUrl}", ...)`.
 */
export async function fetchSubtitle(subtitle: BiliSubtitle): Promise<SubtitleBody[]> {
  const raw = subtitle.subtitle_url ?? '';
  if (!raw) {
    throw new Error(`Subtitle ${subtitle.lan} has empty subtitle_url`);
  }
  // C# concatenates "https:" + "//aisubtitle.hdslb.com/...".
  // If the URL already has a scheme, leave it; otherwise prepend "https:".
  const url = /^https?:\/\//i.test(raw) ? raw : `https:${raw}`;
  const resp = await httpRequest<SubtitleJsonResponse>(url);
  return resp.data?.body ?? [];
}

/**
 * Convert seconds -> SRT timestamp `HH:MM:SS,mmm` (3-digit milliseconds).
 * Ported from C# `SubtitleJson.Second2hms`, but uses milliseconds (not centiseconds)
 * so the output conforms to the SubRip spec — C# used `dec * 100` with `D3`, which
 * produced `050` for `.5s` instead of `500`. pilidown emits the spec-correct value.
 */
export function secondsToSrtTimestamp(seconds: number): string {
  if (seconds < 0 || !Number.isFinite(seconds)) {
    return '00:00:00,000';
  }
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hour = Math.floor(totalMin / 60);
  return (
    `${String(hour).padStart(2, '0')}:` +
    `${String(min).padStart(2, '0')}:` +
    `${String(sec).padStart(2, '0')},` +
    `${String(ms).padStart(3, '0')}`
  );
}

/**
 * Convert seconds -> ASS timestamp `H:MM:SS.cc` (centiseconds, 1-based hour, 2-digit cs).
 * ASS spec uses `H:MM:SS.cc` — single-digit hour, 2-digit centiseconds.
 */
export function secondsToAssTimestamp(seconds: number): string {
  if (seconds < 0 || !Number.isFinite(seconds)) {
    return '0:00:00.00';
  }
  const total = Math.floor(seconds);
  let cs = Math.round((seconds - total) * 100);
  if (cs >= 100) cs = 99;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  const hour = Math.floor(min / 60);
  const minRem = min % 60;
  return (
    `${hour}:` +
    `${String(minRem).padStart(2, '0')}:` +
    `${String(sec).padStart(2, '0')}.` +
    `${String(cs).padStart(2, '0')}`
  );
}

/**
 * Convert subtitle body to SRT (SubRip) text.
 * Ported from C# `SubtitleJson.ToSubRip`.
 */
export function subtitleToSrt(body: SubtitleBody[]): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const item = body[i];
    out += `${i + 1}\n`;
    out += `${secondsToSrtTimestamp(item.from)} --> ${secondsToSrtTimestamp(item.to)}\n`;
    out += `${item.content}\n`;
    out += '\n';
  }
  return out;
}

/**
 * Convert subtitle body to JSON text, embedding lan + lan_doc metadata.
 * Format mirrors bilibili-API-collect's body shape, wrapped with a `lan`/`lan_doc` envelope
 * so downstream consumers can identify the track without a separate sidecar file.
 */
export function subtitleToJson(body: SubtitleBody[], lan: string, lanDoc: string): string {
  const payload = {
    lan,
    lan_doc: lanDoc,
    body,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Convert subtitle body to ASS (Advanced SubStation Alpha) text.
 * Simple layout: bottom-center, font size 50, 1920x1080 canvas.
 * One Dialogue line per body item.
 */
export function subtitleToAss(body: SubtitleBody[]): string {
  const lines: string[] = [];
  lines.push('[Script Info]');
  lines.push('Title: pilidown subtitle');
  lines.push('ScriptType: v4.00+');
  lines.push('PlayResX: 1920');
  lines.push('PlayResY: 1080');
  lines.push('WrapStyle: 0');
  lines.push('ScaledBorderAndShadow: yes');
  lines.push('');
  lines.push('[V4+ Styles]');
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  lines.push('Style: Default,Arial,50,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,60,1');
  lines.push('');
  lines.push('[Events]');
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
  for (const item of body) {
    const start = secondsToAssTimestamp(item.from);
    const end = secondsToAssTimestamp(item.to);
    // ponytail: ASS Dialogue text — replace newlines with \N per ASS spec.
    const text = String(item.content ?? '').replace(/\r?\n/g, '\\N');
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }
  return lines.join('\n') + '\n';
}
