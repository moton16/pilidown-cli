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

/**
 * Single subtitle line item from a fetched subtitle JSON body.
 * Ported from DownKyi.Core/BiliApi/Models/Json/Subtitle.cs
 * (location field dropped — pilidown uses fixed bottom-center layout.)
 */
export interface SubtitleBody {
  from: number;
  to: number;
  content: string;
}

/**
 * Bilibili 弹幕条目。
 * Ported from DownKyi.Core/BiliApi/Danmaku/Models/BiliDanmaku.cs
 * Field numbers correspond to DanmakuElem in bilibili/community/service/dm/v1/dm.proto.
 */
export interface BiliDanmaku {
  id: number;          // field 1, int64  弹幕 dmID
  progress: number;    // field 2, int32  出现时间(ms)
  mode: number;        // field 3, int32  弹幕类型(1=滚动 4=底部 5=顶部 6=逆向滚动 7=高级 8=代码 9=BAS)
  fontsize: number;    // field 4, int32  字体大小
  color: number;       // field 5, uint32 颜色
  midHash: string;     // field 6, string 发送者 UID 的 HASH
  content: string;     // field 7, string 弹幕内容
  ctime: number;       // field 8, int64  发送时间
  weight: number;      // field 9, int32  权重
  action: string;      // field 10, string 动作
  pool: number;        // field 11, int32 弹幕池
}
