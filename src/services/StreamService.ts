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

import type { PlayUrlResponse, DashVideo, DashAudio } from '../types/bili';

export interface SelectedStreams {
  video?: DashVideo;
  audio?: DashAudio;
  quality: number;
  acceptQuality: number[];
  acceptDescription: string[];
  supportFormats: PlayUrlResponse['support_formats'];
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
  opts: { preferHiRes?: boolean; preferDolby?: boolean } = {},
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
  return dash.audio.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0];
}

export function selectStreams(
  playUrl: PlayUrlResponse,
  opts: { preferQn?: number; preferCodec?: number; preferHiRes?: boolean; preferDolby?: boolean } = {},
): SelectedStreams {
  return {
    video: selectVideoStream(playUrl, opts.preferQn, opts.preferCodec),
    audio: selectAudioStream(playUrl, opts),
    quality: playUrl.quality,
    acceptQuality: playUrl.accept_quality,
    acceptDescription: playUrl.accept_description,
    supportFormats: playUrl.support_formats,
  };
}
