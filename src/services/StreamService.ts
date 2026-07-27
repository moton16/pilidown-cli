/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/VideoStream/Models/PlayUrlDashVideo.cs (codec/quality selection)
 *   - src/DownKyi.Core/BiliApi/VideoStream/Models/PlayUrlDashDolby.cs
 *   - src/DownKyi.Core/BiliApi/VideoStream/Models/PlayUrlDashFlac.cs
 *
 * Stream selection: prefer user-specified qn/codec, then highest bandwidth.
 * Dolby Atmos > Hi-Res FLAC > regular audio when enabled.
 */

import type { PlayUrlResponse, DashVideo, DashAudio, PlayUrlDurl } from '../types/bili';

export interface SelectedStreams {
  video?: DashVideo;
  audio?: DashAudio;
  durl?: PlayUrlDurl; // legacy FLV/MP4 single-file fallback
  quality: number;
  acceptQuality: number[];
  acceptDescription: string[];
  supportFormats: PlayUrlResponse['support_formats'];
}

export function selectDurlStream(playUrl: PlayUrlResponse, preferQn?: number): PlayUrlDurl | undefined {
  const durls = playUrl.durl;
  if (!durls?.length) return undefined;
  // ponytail: durl has only one item in practice; if multiple, prefer the one matching qn.
  if (preferQn !== undefined) {
    const fmt = playUrl.support_formats?.find(f => f.quality === preferQn);
    const matched = durls.find(d => fmt?.format && d.url.includes(`-${fmt.format}.`));
    if (matched) return matched;
  }
  return durls.slice().sort((a, b) => b.size - a.size)[0];
}

export function selectVideoStream(
  playUrl: PlayUrlResponse,
  preferQn?: number,
  preferCodec?: number,
): DashVideo | undefined {
  let videos = playUrl.dash?.video ?? [];
  if (!videos.length) return undefined;
  if (preferQn !== undefined) {
    const filtered = videos.filter(v => v.id === preferQn);
    if (filtered.length) videos = filtered;
  }
  if (preferCodec !== undefined) {
    const filtered = videos.filter(v => v.codecid === preferCodec);
    if (filtered.length) videos = filtered;
  }
  // ponytail: pick by bandwidth — bigger = better, stable across codecs.
  return videos.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0];
}

export function selectAudioStream(
  playUrl: PlayUrlResponse,
  opts: { preferAudioId?: number; preferHiRes?: boolean; preferDolby?: boolean } = {},
): DashAudio | undefined {
  const dash = playUrl.dash;
  if (!dash) return undefined;
  if (opts.preferDolby && dash.dolby?.audio?.length) {
    return dash.dolby.audio.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0];
  }
  if (opts.preferHiRes && dash.flac?.audio) {
    return dash.flac.audio;
  }
  if (!dash.audio?.length) return undefined;
  // ponytail: user-specified audio id takes priority over bandwidth ranking
  if (opts.preferAudioId !== undefined) {
    const matched = dash.audio.filter(a => a.id === opts.preferAudioId);
    if (matched.length) return matched[0];
  }
  return dash.audio.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0];
}

export function selectStreams(
  playUrl: PlayUrlResponse,
  opts: { preferQn?: number; preferCodec?: number; preferAudioId?: number; preferHiRes?: boolean; preferDolby?: boolean } = {},
): SelectedStreams {
  const video = selectVideoStream(playUrl, opts.preferQn, opts.preferCodec);
  const audio = selectAudioStream(playUrl, opts);
  const durl = !video && !audio ? selectDurlStream(playUrl, opts.preferQn) : undefined;
  return {
    video,
    audio,
    durl,
    quality: playUrl.quality,
    acceptQuality: playUrl.accept_quality,
    acceptDescription: playUrl.accept_description,
    supportFormats: playUrl.support_formats,
  };
}
