/**
 * 共享类型定义 - pilidown
 */

/**
 * 解析后的入口标识。
 * 表示用户输入的 B 站 URL / ID 被归类为哪种资源类型及其关键 ID。
 */
export type ParsedEntrance =
  | { type: 'video'; bvid?: string; aid?: number }
  | { type: 'bangumi'; seasonId?: number; episodeId?: number; mediaId?: number }
  | { type: 'cheese'; seasonId?: number; episodeId?: number }
  | { type: 'favorites'; mediaId: number }
  | { type: 'user'; mid: number };
