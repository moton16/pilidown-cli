import type { ParsedEntrance } from '../types';

/**
 * 解析用户输入的 B 站入口标识。
 *
 * 支持：
 * - 视频 URL（含 /video/BVxxx、/video/avxxx、b23.tv 短链）
 * - 番剧 URL（/bangumi/play/ss|ep、/bangumi/media/md）
 * - 课程 URL（/cheese/play/ss|ep）
 * - 收藏夹 URL（/medialist/detail/ml）
 * - 用户空间 URL（space.bilibili.com/{mid}）
 * - 裸 ID（BV、av、ss、ep、md、ml、uid、mid、纯数字）
 *
 * @param input URL 或裸 ID 字符串
 * @returns ParsedEntrance 联合类型
 * @throws Error 当输入无法识别时抛出
 */
export function parseEntrance(input: string): ParsedEntrance {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('Empty entrance: cannot parse empty string');
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return parseUrl(trimmed);
  }
  return parseId(trimmed);
}

function parseUrl(url: string): ParsedEntrance {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  if (host === 'b23.tv') {
    const seg = firstPathSegment(path);
    if (seg) return parseId(seg);
    throw new Error(`Unrecognized b23.tv short link: ${url}`);
  }

  if (host === 'space.bilibili.com') {
    const m = path.match(/^\/(\d+)/);
    if (m) return { type: 'user', mid: Number(m[1]) };
    throw new Error(`Unrecognized space url: ${url}`);
  }

  if (host.endsWith('bilibili.com')) {
    if (path.startsWith('/video/')) {
      return parseVideoSeg(firstPathSegment(path.slice('/video/'.length)));
    }
    if (path.startsWith('/bangumi/play/')) {
      return parseBangumiPlaySeg(
        firstPathSegment(path.slice('/bangumi/play/'.length)),
      );
    }
    if (path.startsWith('/bangumi/media/')) {
      return parseBangumiMediaSeg(
        firstPathSegment(path.slice('/bangumi/media/'.length)),
      );
    }
    if (path.startsWith('/cheese/play/')) {
      return parseCheeseSeg(firstPathSegment(path.slice('/cheese/play/'.length)));
    }
    if (path.startsWith('/medialist/detail/')) {
      return parseFavSeg(firstPathSegment(path.slice('/medialist/detail/'.length)));
    }
  }

  throw new Error(`Unrecognized bilibili URL: ${url}`);
}

function firstPathSegment(s: string): string {
  return s.replace(/^\//, '').split('/')[0].split('?')[0].split('#')[0];
}

function parseVideoSeg(seg: string): ParsedEntrance {
  if (/^BV[0-9A-Za-z]{10}$/.test(seg)) return { type: 'video', bvid: seg };
  const m = seg.match(/^av(\d+)$/i);
  if (m) return { type: 'video', aid: Number(m[1]) };
  throw new Error(`Unrecognized video segment: ${seg}`);
}

function parseBangumiPlaySeg(seg: string): ParsedEntrance {
  const ss = seg.match(/^ss(\d+)$/);
  if (ss) return { type: 'bangumi', seasonId: Number(ss[1]) };
  const ep = seg.match(/^ep(\d+)$/);
  if (ep) return { type: 'bangumi', episodeId: Number(ep[1]) };
  throw new Error(`Unrecognized bangumi segment: ${seg}`);
}

function parseBangumiMediaSeg(seg: string): ParsedEntrance {
  const m = seg.match(/^md(\d+)$/);
  if (m) return { type: 'bangumi', mediaId: Number(m[1]) };
  throw new Error(`Unrecognized bangumi media segment: ${seg}`);
}

function parseCheeseSeg(seg: string): ParsedEntrance {
  const ss = seg.match(/^ss(\d+)$/);
  if (ss) return { type: 'cheese', seasonId: Number(ss[1]) };
  const ep = seg.match(/^ep(\d+)$/);
  if (ep) return { type: 'cheese', episodeId: Number(ep[1]) };
  throw new Error(`Unrecognized cheese segment: ${seg}`);
}

function parseFavSeg(seg: string): ParsedEntrance {
  const m = seg.match(/^ml(\d+)$/);
  if (m) return { type: 'favorites', mediaId: Number(m[1]) };
  throw new Error(`Unrecognized favorites segment: ${seg}`);
}

function parseId(id: string): ParsedEntrance {
  if (/^BV[0-9A-Za-z]{10}$/.test(id)) return { type: 'video', bvid: id };
  {
    const m = id.match(/^av(\d+)$/i);
    if (m) return { type: 'video', aid: Number(m[1]) };
  }
  {
    const m = id.match(/^ss(\d+)$/);
    if (m) return { type: 'bangumi', seasonId: Number(m[1]) };
  }
  {
    const m = id.match(/^ep(\d+)$/);
    if (m) return { type: 'bangumi', episodeId: Number(m[1]) };
  }
  {
    const m = id.match(/^md(\d+)$/);
    if (m) return { type: 'bangumi', mediaId: Number(m[1]) };
  }
  {
    const m = id.match(/^ml(\d+)$/);
    if (m) return { type: 'favorites', mediaId: Number(m[1]) };
  }
  {
    const m = id.match(/^(?:uid|mid)(\d+)$/i);
    if (m) return { type: 'user', mid: Number(m[1]) };
  }
  {
    const m = id.match(/^(\d+)$/);
    if (m) return { type: 'user', mid: Number(m[1]) };
  }
  throw new Error(`Unrecognized entrance: ${id}`);
}