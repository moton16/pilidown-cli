/**
 * pilidown - info command (M3.3)
 * Original: CLI-only, original to pilidown (DownKyi uses WPF window).
 *
 * Usage: pilidown info <url-or-id> [--json]
 */

import type { Command } from 'commander';
import { getVideoInfo } from '../api/VideoApi';
import { parseEntrance } from '../core/parseEntrance';
import { setJsonMode, error as logError } from '../utils/logger';
import type { VideoInfo } from '../types/bili';

export function registerInfoCommand(program: Command): void {
  program
    .command('info <url-or-id>')
    .description('Fetch video metadata for a Bilibili URL or ID')
    .option('--json', 'Output as JSON Lines (for agent use)')
    .action(async (arg: string, opts: { json?: boolean }) => {
      if (opts.json) setJsonMode(true);
      try {
        const parsed = parseEntrance(arg);
        if (parsed.type !== 'video') {
          throw new Error(`info command supports video only, got "${parsed.type}"`);
        }
        const info = await getVideoInfo({ bvid: parsed.bvid, aid: parsed.aid });
        if (opts.json) {
          process.stdout.write(JSON.stringify({ event: 'info', data: info }) + '\n');
        } else {
          printHuman(info);
        }
      } catch (err) {
        logError('info failed', { error: (err as Error).message });
        process.exitCode = 1;
      }
    });
}

function printHuman(info: VideoInfo): void {
  console.log(`标题: ${info.title}`);
  console.log(`UP主: ${info.owner.name} (mid=${info.owner.mid})`);
  console.log(`BV号: ${info.bvid}  AV号: av${info.aid}`);
  console.log(`cid: ${info.cid}`);
  console.log(`分P数: ${info.videos}`);
  console.log(`时长: ${formatDuration(info.duration)}`);
  console.log(`分区: ${info.tname} (tid=${info.tid})`);
  console.log(`封面: ${info.pic}`);
  console.log(
    `统计: 播放 ${info.stat.view}  弹幕 ${info.stat.danmaku}  评论 ${info.stat.reply}  收藏 ${info.stat.favorite}  投币 ${info.stat.coin}  分享 ${info.stat.share}  点赞 ${info.stat.like}`,
  );
  console.log(`简介: ${info.desc || '(无)'}`);
  if (info.pages.length > 1) {
    console.log('分P列表:');
    for (const p of info.pages) {
      console.log(`  P${p.page}: ${p.part} (cid=${p.cid}, ${formatDuration(p.duration)})`);
    }
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
