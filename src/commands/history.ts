/**
 * pilidown - history command (M9.2.6)
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/History/History.cs (history records)
 *   - src/DownKyi.Core/BiliApi/History/ToView.cs (稍后再看)
 *
 * Usage:
 *   pilidown history                       查看历史记录（第 1 页）
 *   pilidown history --page 2              翻页
 *   pilidown history --toview              查看稍后再看列表
 *   pilidown history --json                JSON Lines 输出
 *
 * 该命令需要登录态；若未登录（cookies.json 不存在或 SESSDATA 缺失），
 * biliGet 会抛出 code=-352 BiliApiError，logger 会带提示。
 */

import type { Command } from 'commander';
import { getHistory, getToView } from '../api/HistoryApi';
import { loadCookies } from '../services/CookieService';
import { setJsonMode, error as logError } from '../utils/logger';
import type { HistoryItem, ToViewVideo } from '../types/bili';

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .description('View Bilibili watch history or "to-view" list (requires login)')
    .option('--toview', 'Show "稍后再看" (to-view) list instead of watch history')
    .option('--page <n>', 'Page number (1-based) for history records', (v: string) => parseInt(v, 10), 1)
    .option('--json', 'Output as JSON Lines (for agent use)')
    .action(
      async (opts: { toview?: boolean; page: number; json?: boolean }) => {
        if (opts.json) setJsonMode(true);
        try {
          const cookies = loadCookies().cookies;
          if (opts.toview) {
            const { videos, total } = await getToView(Object.keys(cookies).length ? cookies : undefined);
            const result = {
              kind: 'toview' as const,
              total,
              count: videos.length,
              videos: videos.map(toVideoSummary),
            };
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'history.toview', data: result }) + '\n');
            } else {
              printToView(videos, total);
            }
          } else {
            const page = Math.max(1, opts.page);
            const items = await getHistory(page, Object.keys(cookies).length ? cookies : undefined);
            const result = {
              kind: 'history' as const,
              page,
              count: items.length,
              items: items.map(toHistorySummary),
            };
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'history.records', data: result }) + '\n');
            } else {
              printHistory(items, page);
            }
          }
        } catch (err) {
          logError('history failed', { error: (err as Error).message });
          process.exitCode = 1;
        }
      },
    );
}

function toHistorySummary(h: HistoryItem): {
  aid: number;
  bvid: string;
  title: string;
  cid: number;
  duration: number;
  view_at: number;
  progress: number;
  owner: { mid: number; name: string };
  badge: string;
} {
  return {
    aid: h.aid,
    bvid: h.bvid,
    title: h.title,
    cid: h.cid,
    duration: h.duration,
    view_at: h.view_at,
    progress: h.progress,
    owner: { mid: h.owner.mid, name: h.owner.name },
    badge: h.badge,
  };
}

function toVideoSummary(v: ToViewVideo): {
  aid: number;
  bvid: string;
  title: string;
  cid: number;
  duration: number;
  add_at: number;
  owner: { mid: number; name: string };
} {
  return {
    aid: v.aid,
    bvid: v.bvid,
    title: v.title,
    cid: v.cid,
    duration: v.duration,
    add_at: v.add_at,
    owner: { mid: v.owner.mid, name: v.owner.name },
  };
}

function printHistory(items: HistoryItem[], page: number): void {
  console.log(`历史记录 第 ${page} 页 (本页 ${items.length} 条)：`);
  if (!items.length) {
    console.log('  (空)');
    return;
  }
  for (const h of items) {
    const watchedAt = new Date(h.view_at * 1000).toLocaleString('zh-CN');
    console.log(`  ${h.bvid}  ${h.title}`);
    console.log(`    UP: ${h.owner.name} (mid=${h.owner.mid})  时长: ${formatDuration(h.duration)}`);
    console.log(`    观看时间: ${watchedAt}  进度: ${formatProgress(h.progress, h.duration)}${h.badge ? '  徽章: ' + h.badge : ''}`);
  }
}

function printToView(videos: ToViewVideo[], total: number): void {
  console.log(`稍后再看列表 (共 ${total} 条，本次返回 ${videos.length} 条)：`);
  if (!videos.length) {
    console.log('  (空)');
    return;
  }
  for (const v of videos) {
    console.log(`  ${v.bvid}  ${v.title}`);
    console.log(`    UP: ${v.owner.name} (mid=${v.owner.mid})  时长: ${formatDuration(v.duration)}`);
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

function formatProgress(progress: number, duration: number): string {
  if (!duration) return formatDuration(progress);
  const pct = Math.floor((progress / duration) * 100);
  return `${formatDuration(progress)} / ${formatDuration(duration)} (${pct}%)`;
}
