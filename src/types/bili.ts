/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/Models/BaseModel.cs
 *   - src/DownKyi.Core/BiliApi/Video/Models/VideoView.cs
 *   - src/DownKyi.Core/BiliApi/Video/Models/VideoPage.cs
 *   - src/DownKyi.Core/BiliApi/Video/Models/VideoStat.cs
 *   - src/DownKyi.Core/BiliApi/Video/Models/VideoOwner.cs
 *   - src/DownKyi.Core/BiliApi/VideoStream/Models/PlayUrl*.cs
 *   - src/DownKyi.Core/BiliApi/VideoStream/Models/PlayerV2.cs
 */

export interface BiliResponse<T = unknown> {
  code: number;
  message: string;
  ttl?: number;
  data?: T;
}

export interface BiliBangumiResponse<T = unknown> {
  code: number;
  message: string;
  ttl?: number;
  result?: T;
}

export interface VideoPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
  dimension?: { width: number; height: number; rotate: number };
}

export interface VideoInfo {
  bvid: string;
  aid: number;
  videos: number;
  tid: number;
  tname: string;
  pic: string;
  title: string;
  pubdate: number;
  ctime: number;
  desc: string;
  duration: number;
  cid: number;
  owner: { mid: number; name: string; face: string };
  stat: {
    view: number;
    danmaku: number;
    reply: number;
    favorite: number;
    coin: number;
    share: number;
    like: number;
  };
  pages: VideoPage[];
}

export interface BiliNavData {
  isLogin: boolean;
  mid: number;
  uname: string;
  wbi_img: { img_url: string; sub_url: string };
}

export interface DashVideo {
  id: number;
  baseUrl: string;
  baseBackupUrl: string[];
  bandwidth: number;
  mimeType: string;
  codecs: string;
  width: number;
  height: number;
  frameRate: string;
  sar: string;
  startWithSap: number;
  SegmentBase?: { Initialization: string; indexRange: string };
  codecid: number;
}

export interface DashAudio {
  id: number;
  baseUrl: string;
  baseBackupUrl: string[];
  bandwidth: number;
  mimeType: string;
  codecs: string;
  SegmentBase?: { Initialization: string; indexRange: string };
}

export interface PlayUrlDash {
  duration: number;
  minBufferTime: number;
  video: DashVideo[];
  audio: DashAudio[];
  dolby?: { type: number; audio: DashAudio[] };
  flac?: { display: boolean; audio: DashAudio };
}

export interface PlayUrlResponse {
  quality: number;
  format: number;
  timelength: number;
  accept_quality: number[];
  accept_description: string[];
  support_formats: { quality: number; format: string; new_description: string; codecs: string[] }[];
  dash: PlayUrlDash;
  durl?: unknown[];
}
