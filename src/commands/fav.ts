/**
 * pilidown - fav command (M9.2.5)
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/Favorites/FavoritesInfo.cs (folder listing)
 *   - src/DownKyi.Core/BiliApi/Favorites/FavoritesResource.cs (resource listing)
 *
 * Usage:
 *   pilidown fav <mid>                  列出用户的所有收藏夹
 *   pilidown fav <mid> --media <id>     列出某收藏夹内的视频
 *   pilidown fav --user <mid>           等价于 pilidown fav <mid>
 *   pilidown fav --user <mid> --media <id> --page 2 --json
 *
 * 行为：
 *   - 不传 --media：调用 getFavFolders(mid) 列出收藏夹
 *   - 传 --media：调用 getFavResources(mediaId, page) 分页列出该收藏夹视频
 */

import type { Command } from 'commander';
import { getFavFolders, getFavResources } from '../api/FavoritesApi';
import { setJsonMode, error as logError } from '../utils/logger';
import type { FavoritesFolder, FavoritesResource } from '../types/bili';

export function registerFavCommand(program: Command): void {
  program
    .command('fav [mid]')
    .description('List a user\'s favorite folders, or videos inside a specific folder')
    .option('--user <mid>', 'Target user UID (alternative to positional <mid>)', parseMid)
    .option('--media <media_id>', 'Folder media_id; when set, list videos inside this folder', parseMid)
    .option('--page <n>', 'Page number (1-based) for --media listing', parseInt, 1)
    .option('--json', 'Output as JSON Lines (for agent use)')
    .action(
      async (
        midArg: number | undefined,
        opts: {
          user?: number;
          media?: number;
          page: number;
          json?: boolean;
        },
      ) => {
        if (opts.json) setJsonMode(true);
        try {
          const mid = resolveMid(midArg, opts.user);
          if (opts.media !== undefined) {
            const page = Math.max(1, opts.page);
            const { resources, hasMore } = await getFavResources(opts.media, page);
            const result = {
              media_id: opts.media,
              page,
              has_more: hasMore,
              count: resources.length,
              videos: resources.map(toVideoSummary),
            };
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'fav.videos', data: result }) + '\n');
            } else {
              printResources(result.media_id, result.page, result.has_more, resources);
            }
          } else {
            const { folders, total } = await getFavFolders(mid);
            const result = {
              mid,
              total,
              folders: folders.map(toFolderSummary),
            };
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'fav.folders', data: result }) + '\n');
            } else {
              printFolders(mid, folders, total);
            }
          }
        } catch (err) {
          logError('fav failed', { error: (err as Error).message });
          process.exitCode = 1;
        }
      },
    );
}

function parseMid(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid mid/media_id: "${v}"`);
  return n;
}

function resolveMid(positional: number | undefined, fromOpt?: number): number {
  if (fromOpt !== undefined) return fromOpt;
  if (positional !== undefined) return positional;
  throw new Error('fav command requires <mid> positional arg or --user <mid>');
}

function toFolderSummary(f: FavoritesFolder): {
  id: number;
  fid: number;
  title: string;
  media_count: number;
  fav_time?: number;
  ctime: number;
} {
  return {
    id: f.id,
    fid: f.fid,
    title: f.title,
    media_count: f.media_count,
    ctime: f.ctime,
  };
}

function toVideoSummary(r: FavoritesResource): {
  id: number;
  bvid: string;
  title: string;
  upper: { mid: number; name: string };
  duration: number;
  pubdate: number;
  cnt_info: { collect: number; play: number; danmaku: number };
} {
  return {
    id: r.id,
    bvid: r.bvid,
    title: r.title,
    upper: { mid: r.upper.mid, name: r.upper.name },
    duration: r.duration,
    pubdate: r.pubdate,
    cnt_info: r.cnt_info,
  };
}

function printFolders(mid: number, folders: FavoritesFolder[], total: number): void {
  console.log(`用户 ${mid} 的收藏夹 (共 ${total} 个)：`);
  if (!folders.length) {
    console.log('  (空)');
    return;
  }
  for (const f of folders) {
    console.log(`  [${f.id}] ${f.title}  (${f.media_count} 个视频)  fid=${f.fid}`);
  }
  console.log('');
  console.log('提示：使用 `pilidown fav ' + mid + ' --media <id>` 查看某收藏夹内的视频。');
}

function printResources(mediaId: number, page: number, hasMore: boolean, resources: FavoritesResource[]): void {
  console.log(`收藏夹 ${mediaId} 第 ${page} 页 (本页 ${resources.length} 条${hasMore ? '，还有更多' : '，已到末尾'})：`);
  if (!resources.length) {
    console.log('  (空)');
    return;
  }
  for (const r of resources) {
    console.log(`  ${r.bvid}  ${r.title}`);
    console.log(`    UP: ${r.upper.name} (mid=${r.upper.mid})  时长: ${formatDuration(r.duration)}`);
    console.log(`    播放 ${r.cnt_info.play}  收藏 ${r.cnt_info.collect}  弹幕 ${r.cnt_info.danmaku}`);
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`
    : `${m}m${String(s).padStart(2, '0')}s`;
}
