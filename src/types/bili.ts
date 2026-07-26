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

/**
 * Subtitle entry inside PlayerV2.subtitle.subtitles[].
 * Ported from DownKyi.Core/BiliApi/VideoStream/Models/Subtitle.cs
 */
export interface BiliSubtitle {
  id: number;
  lan: string;
  lan_doc: string;
  is_lock: boolean;
  author_mid: number;
  subtitle_url: string;
  type: number;
  id_str?: string;
}

/**
 * Subtitle info wrapper.
 * Ported from DownKyi.Core/BiliApi/VideoStream/Models/SubtitleInfo.cs
 */
export interface SubtitleInfo {
  allow_submit: boolean;
  lan?: string;
  lan_doc?: string;
  subtitles: BiliSubtitle[];
}

/**
 * Player info from /x/player/wbi/v2.
 * Ported from DownKyi.Core/BiliApi/VideoStream/Models/PlayerV2.cs
 * Only fields used by pilidown (aid/bvid/cid/subtitle) — others omitted (YAGNI).
 */
export interface PlayerV2Info {
  aid: number;
  bvid: string;
  cid: number;
  subtitle: SubtitleInfo;
}
