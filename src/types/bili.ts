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
  ugc_season?: UgcSeason;
}

/**
 * UGC 合集（用户创建的视频集合）。
 * Ported from DownKyi.Core/BiliApi/Video/Models/UgcSeason.cs
 * B 站 view API 在视频属于合集时返回此字段，包含完整视频列表。
 */
export interface UgcSeason {
  id: number;
  title: string;
  cover: string;
  mid: number;
  intro: string;
  ep_count: number;
  season_type: number;
  sections: UgcSection[];
}

export interface UgcSection {
  season_id: number;
  id: number;
  title: string;
  type: number;
  episodes: UgcEpisode[];
}

export interface UgcEpisode {
  season_id: number;
  section_id: number;
  id: number;
  aid: number;
  cid: number;
  title: string;
  bvid: string;
  page?: number;
  duration?: number;
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

export interface PlayUrlDurl {
  order: number;
  length: number;
  size: number;
  url: string;
  backup_url?: string[];
}

export interface PlayUrlResponse {
  quality: number;
  format: number;
  timelength: number;
  accept_quality: number[];
  accept_description: string[];
  support_formats: { quality: number; format: string; new_description: string; codecs: string[] }[];
  dash?: PlayUrlDash;
  durl?: PlayUrlDurl[];
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

/**
 * 番剧单集信息。
 * Ported from DownKyi.Core/BiliApi/Bangumi/Models/BangumiEpisode.cs
 * (字段精简：仅保留 pilidown 命令所需。)
 */
export interface BangumiEpisode {
  aid: number;
  bvid?: string;
  cid: number;
  id: number;          // 即 ep_id（剧集 ID）
  epid?: number;       // 部分接口会重复返回 epid
  title: string;
  long_title: string;
  duration: number;
  status: number;
  cover: string;
  pub_time?: number;
  share_url?: string;
  short_link?: string;
}

/**
 * 番剧（季）信息。
 * Ported from DownKyi.Core/BiliApi/Bangumi/Models/BangumiSeason.cs
 * + BangumiStat.cs + BangumiUpInfo.cs + BangumiArea.cs
 * (字段精简：仅保留 pilidown 命令所需。)
 */
export interface BangumiSeasonInfo {
  season_id: number;
  media_id: number;
  title: string;
  season_title?: string;
  cover: string;
  evaluate: string;
  areas: { id?: number; name: string }[];
  episodes: BangumiEpisode[];
  up_info?: { mid: number; uname: string; avatar?: string };
  stat: {
    views: number;
    danmakus: number;
    coins: number;
    favorites: number;
    likes?: number;
    reply?: number;
    share?: number;
  };
  type?: number;
  total?: number;
  share_url?: string;
}

/**
 * 课程单集信息。
 * Ported from DownKyi.Core/BiliApi/Cheese/Models/CheeseEpisode.cs
 * (字段精简：仅保留 pilidown 命令所需。)
 */
export interface CheeseEpisode {
  id: number;          // 即 ep_id（剧集 ID）
  epid?: number;
  aid: number;
  cid: number;
  title: string;
  long_title?: string;
  duration: number;
  status: number;
  cover: string;
  index?: number;
  page?: number;
  release_date?: number;
}

/**
 * 课程（季）信息。
 * Ported from DownKyi.Core/BiliApi/Cheese/Models/CheeseView.cs
 * + CheeseStat.cs + CheeseUpInfo.cs
 * (字段精简：仅保留 pilidown 命令所需。)
 */
export interface CheeseSeasonInfo {
  season_id: number;
  title: string;
  cover: string;
  evaluate?: string;
  subtitle?: string;
  episodes: CheeseEpisode[];
  up_info: { mid: number; uname: string; avatar?: string; brief?: string; follower?: number };
  stat: {
    views: number;
    play_desc?: string;
  };
  share_url?: string;
}

/**
 * /pgc/review/user 返回的 media 摘要。
 * Ported from DownKyi.Core/BiliApi/Bangumi/Models/BangumiMedia.cs
 */
export interface BangumiMediaInfo {
  media_id: number;
  season_id: number;
  title: string;
  cover: string;
  type_name?: string;
  share_url?: string;
  areas?: { id?: number; name: string }[];
}

/**
 * 收藏夹元信息。
 * Ported from DownKyi.Core/BiliApi/Favorites/Models/FavoritesMetaInfo.cs
 * API: GET /x/v3/fav/folder/created/list?up_mid=<mid>
 */
export interface FavoritesFolder {
  id: number;
  fid: number;
  mid: number;
  uid: number;
  title: string;
  media_count: number;
  cover: string;
  intro: string;
  ctime: number;
  mtime: number;
  fav_state: number;
  like_state: number;
  upper: { mid: number; name: string; face: string; followed?: boolean };
  cnt_info: { collect: number; play: number; thumb_up?: number; share?: number };
}

/**
 * 收藏夹内的视频资源条目。
 * Ported from DownKyi.Core/BiliApi/Favorites/Models/FavoritesMedia.cs
 * API: GET /x/v3/fav/resource/list?media_id=<id>
 */
export interface FavoritesResource {
  id: number;
  type: number;
  title: string;
  cover: string;
  intro: string;
  page: number;
  duration: number;
  upper: { mid: number; name: string; face: string };
  cnt_info: { collect: number; play: number; danmaku: number };
  link: string;
  ctime: number;
  pubdate: number;
  fav_time: number;
  bvid: string;
}

/**
 * 历史记录单条。
 * Ported from DownKyi.Core/BiliApi/History/Models/HistoryList.cs
 * API: GET /x/v2/history?pn=<pn>
 */
export interface HistoryItem {
  aid: number;
  bvid: string;
  videos: number;
  title: string;
  cover: string;
  uri: string;
  duration: number;
  pubdate: number;
  view_at: number;
  progress: number;
  badge: string;
  show_title: string;
  cid: number;
  owner: { mid: number; name: string; face: string };
  history: {
    oid: number;
    epid?: number;
    bvid: string;
    page: number;
    cid: number;
    part: string;
    business: string;
    dt: number;
  };
}

/**
 * 稍后再看视频条目。
 * Ported from DownKyi.Core/BiliApi/History/Models/ToViewList.cs
 * API: GET /x/v2/history/toview/web
 */
export interface ToViewVideo {
  aid: number;
  bvid: string;
  title: string;
  pic: string;
  cover?: string;
  duration: number;
  pubdate: number;
  cid: number;
  add_at: number;
  owner: { mid: number; name: string; face: string };
}

/**
 * 用户空间基本信息。
 * Ported from DownKyi.Core/BiliApi/Users/Models/UserInfoForSpace.cs
 * API: GET /x/space/wbi/acc/info?mid=<mid> (WBI signed)
 */
export interface UserInfo {
  mid: number;
  name: string;
  sex: string;
  face: string;
  sign: string;
  level: number;
  top_photo?: string;
  is_followed?: boolean;
  vip: {
    type: number;
    status: number;
    due_date?: number;
    label: { text: string; label_theme?: string; text_color?: string };
    avatar_subscript?: number;
    nickname_color?: string;
  };
}

/**
 * 用户投稿视频条目。
 * Ported from DownKyi.Core/BiliApi/Users/Models/SpacePublicationListVideo.cs
 * API: GET /x/space/wbi/arc/search?mid=<mid> (WBI signed)
 */
export interface UserPublicationVideo {
  aid: number;
  bvid: string;
  title: string;
  pic: string;
  cover?: string;
  typeid: number;
  play: number;
  mid: number;
  created: number;
  length: string;
  duration?: number;
  pubdate?: number;
  danmaku?: number;
  reply?: number;
  owner?: { mid: number; name: string; face: string };
}

/**
 * 用户频道条目。
 * Ported from DownKyi.Core/BiliApi/Users/Models/SpaceChannelList.cs
 * API: GET /x/space/channel/list?mid=<mid>
 */
export interface UserChannel {
  cid: number;
  mid: number;
  name: string;
  intro: string;
  mtime: number;
  count: number;
  cover: string;
}
