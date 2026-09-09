/**
 * pilidown - fav command (M9.2.5)
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/Favorites/FavoritesInfo.cs (folder listing)
 *   - src/DownKyi.Core/BiliApi/Favorites/FavoritesResource.cs (resource listing)
 *
 * Usage:
 *   pilidown fav <mid>                  列出用户的所有收藏夹
 *   pilidown fav <mid> --media <id>     列出某收藏夹内的视频
 *   pilidown fav <mid> --media <id> --download  下载整个收藏夹的视频
 *   pilidown fav --user <mid>           等价于 pilidown fav <mid>
 *   pilidown fav --user <mid> --media <id> --download --audio-only --format mp3
 *
 * 行为：
 *   - 不传 --media：调用 getFavFolders(mid) 列出收藏夹
 *   - 传 --media 不传 --download：调用 getFavResources(mediaId, page) 分页列出视频
 *   - 传 --media + --download：自动翻页获取全部视频，逐个下载
 */

import type { Command } from 'commander';
import { mkdirSync } from 'node:fs';
import { getFavFolders, getFavResources, getAllFavResources } from '../api/FavoritesApi';
import { downloadVideo } from '../services/DownloadService';
import { setJsonMode, info as logInfo, warn as logWarn, error as logError } from '../utils/logger';
import { loadCookies } from '../services/CookieService';
import type { FavoritesFolder, FavoritesResource } from '../types/bili';

export function registerFavCommand(program: Command): void {
  program
    .command('fav [mid]')
    .description('List a user\'s favorite folders, or videos inside a specific folder')
    .option('--user <mid>', 'Target user UID (alternative to positional <mid>)', parseMid)
    .option('--media <media_id>', 'Folder media_id; when set, list videos inside this folder', parseMid)
    .option('--page <n>', 'Page number (1-based) for --media listing (no --download)', (v: string) => parseInt(v, 10), 1)
    .option('--download', 'Download all videos in the folder (requires --media)')
    .option('--quality <qn>', 'Preferred video quality; defaults to 80 when logged in and 16 anonymously')
    .option('--codec <id>', 'Preferred video codec id (7=AVC, 12=HEVC, 13=AV1)', parseInt)
    .option('--audio-quality <id>', 'Preferred audio id; defaults to 30280 when logged in and 30216 anonymously', (v: string) => parseInt(v, 10))
    .option('--no-hires', 'Disable Hi-Res FLAC audio preference')
    .option('--dolby', 'Prefer Dolby Atmos audio if available')
    .option('--output <dir>', 'Output directory', '.')
    .option('--threads <n>', 'Number of download threads per stream', (v: string) => parseInt(v, 10), 8)
    .option('--no-merge', 'Skip merge; keep separate .m4v + .m4a')
    .option('--audio-only', 'Download audio only (skip video stream), default output mp3')
    .option('--format <fmt>', 'Audio format: mp3 (transcode) or m4a (original)', 'mp3')
    .option('--overwrite', 'Overwrite existing files instead of skipping')
    .option('--json', 'Output as JSON Lines (for agent use)')
    .action(
      async (
        midArg: number | undefined,
        opts: {
          user?: number;
          media?: number;
          page: number;
          download?: boolean;
          quality?: string;
          codec?: number;
          audioQuality?: number;
          hires: boolean;
          dolby?: boolean;
          output: string;
          threads: number;
          merge: boolean;
          audioOnly?: boolean;
          format?: string;
          overwrite?: boolean;
          json?: boolean;
        },
      ) => {
        if (opts.json) setJsonMode(true);
        try {
          const mid = resolveMid(midArg, opts.user);
          if (opts.media !== undefined) {
            if (opts.download) {
              await downloadFavFolder(opts.media, opts);
            } else {
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

async function downloadFavFolder(mediaId: number, opts: {
  output: string;
  quality?: string;
  codec?: number;
  audioQuality?: number;
  hires: boolean;
  dolby?: boolean;
  threads: number;
  merge: boolean;
  audioOnly?: boolean;
  format?: string;
  overwrite?: boolean;
  json?: boolean;
}): Promise<void> {
  mkdirSync(opts.output, { recursive: true });

  logInfo('fetching all videos from fav folder', { media_id: mediaId });
  const resources = await getAllFavResources(mediaId);
  logInfo('fetched videos', { count: resources.length });

  if (!resources.length) {
    logWarn('no videos found in this fav folder', { media_id: mediaId });
    return;
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < resources.length; i++) {
    const r = resources[i];
    if (!r.bvid) {
      logWarn('skipping resource without bvid', { index: i + 1 });
      skipped++;
      continue;
    }
    logInfo('downloading fav video', {
      index: i + 1,
      total: resources.length,
      bvid: r.bvid,
      title: r.title,
    });
    try {
      const result = await downloadVideo({
        bvid: r.bvid,
        page: 1,
        preferQn: opts.quality ? parseInt(opts.quality, 10) : loadCookies().cookies.SESSDATA ? 80 : 16,
        preferCodec: opts.codec,
        preferAudioId: opts.audioQuality ?? (loadCookies().cookies.SESSDATA ? 30280 : 30216),
        preferHiRes: opts.hires,
        preferDolby: opts.dolby,
        outputDir: opts.output,
        threads: opts.threads,
        noMerge: !opts.merge,
        audioOnly: opts.audioOnly,
        format: opts.format,
        overwrite: opts.overwrite,
      });
      if (opts.json) {
        process.stdout.write(JSON.stringify({
          event: 'fav.download',
          data: {
            index: i + 1,
            total: resources.length,
            bvid: r.bvid,
            title: r.title,
            path: result.mergedPath ?? result.videoPath ?? result.audioPath,
          },
        }) + '\n');
      } else {
        console.log(`  [${i + 1}/${resources.length}] ${r.bvid} ${r.title} -> ${result.mergedPath ?? result.videoPath ?? '(failed)'}`);
      }
      succeeded++;
    } catch (err) {
      logError('fav video download failed', { index: i + 1, bvid: r.bvid, error: (err as Error).message });
      failed++;
    }
  }

  logInfo('fav download complete', { total: resources.length, succeeded, failed, skipped });
  if (!opts.json) {
    console.log(`\n收藏夹下载完成：共 ${resources.length} 个视频，成功 ${succeeded}，失败 ${failed}，跳过 ${skipped}`);
  }
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
  console.log('提示：');
  console.log(`  查看收藏夹视频：pilidown fav ${mid} --media <id>`);
  console.log(`  下载整个收藏夹：pilidown fav ${mid} --media <id> --download --output ./downloads`);
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
  if (hasMore) {
    console.log('');
    console.log(`提示：还有更多视频，使用 --page ${page + 1} 查看下一页，或加 --download 下载全部。`);
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
