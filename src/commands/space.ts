/**
 * pilidown - space command (M9.2.7)
 * Original C# sources:
 *   - src/DownKyi.Core/BiliApi/Users/UserInfo.cs (GetUserInfoForSpace)
 *   - src/DownKyi.Core/BiliApi/Users/UserSpace.cs (GetPublication / GetChannelList)
 *
 * Usage:
 *   pilidown space <mid>                   查看用户基本信息
 *   pilidown space <mid> --pub             查看用户投稿列表（第 1 页）
 *   pilidown space <mid> --pub --page 2    翻页
 *   pilidown space <mid> --json            JSON Lines 输出
 *
 * 用户信息与投稿接口走 WBI 签名；频道接口不需要签名（M9.2 暂未暴露到 CLI）。
 */

import type { Command } from 'commander';
import { getUserInfo, getPublications } from '../api/UserApi';
import { setJsonMode, error as logError } from '../utils/logger';
import type { UserInfo, UserPublicationVideo } from '../types/bili';

export function registerSpaceCommand(program: Command): void {
  program
    .command('space <mid>')
    .description('View a Bilibili user\'s basic info or their publication list')
    .option('--pub', 'List user\'s uploaded videos instead of basic info')
    .option('--page <n>', 'Page number (1-based) for --pub listing', (v: string) => parseInt(v, 10), 1)
    .option('--json', 'Output as JSON Lines (for agent use)')
    .action(
      async (
        midArg: string,
        opts: { pub?: boolean; page: number; json?: boolean },
      ) => {
        if (opts.json) setJsonMode(true);
        try {
          const mid = parseMid(midArg);
          if (opts.pub) {
            const page = Math.max(1, opts.page);
            const { videos, total } = await getPublications(mid, page);
            const result = {
              mid,
              page,
              total,
              count: videos.length,
              videos: videos.map(toVideoSummary),
            };
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'space.publications', data: result }) + '\n');
            } else {
              printPublications(mid, page, videos, total);
            }
          } else {
            const info = await getUserInfo(mid);
            const result = {
              mid: info.mid,
              name: info.name,
              sex: info.sex,
              face: info.face,
              sign: info.sign,
              level: info.level,
              vip: {
                type: info.vip.type,
                status: info.vip.status,
                label: info.vip.label.text,
              },
            };
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'space.info', data: result }) + '\n');
            } else {
              printUserInfo(info);
            }
          }
        } catch (err) {
          logError('space failed', { error: (err as Error).message });
          process.exitCode = 1;
        }
      },
    );
}

function parseMid(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid mid: "${v}"`);
  return n;
}

function toVideoSummary(v: UserPublicationVideo): {
  aid: number;
  bvid: string;
  title: string;
  pic: string;
  play: number;
  created: number;
  length: string;
} {
  return {
    aid: v.aid,
    bvid: v.bvid,
    title: v.title,
    pic: v.pic,
    play: v.play,
    created: v.created,
    length: v.length,
  };
}

function printUserInfo(info: UserInfo): void {
  console.log(`UID: ${info.mid}`);
  console.log(`昵称: ${info.name}`);
  console.log(`性别: ${formatSex(info.sex)}`);
  console.log(`等级: Lv${info.level}`);
  console.log(`签名: ${info.sign || '(无)'}`);
  console.log(`头像: ${info.face}`);
  console.log(`会员: ${formatVip(info.vip.type, info.vip.status, info.vip.label.text)}`);
  if (info.top_photo) console.log(`顶部图: ${info.top_photo}`);
  if (info.is_followed !== undefined) console.log(`已关注: ${info.is_followed ? '是' : '否'}`);
  console.log('');
  console.log('提示：使用 `pilidown space ' + info.mid + ' --pub` 查看该用户的投稿列表。');
}

function printPublications(mid: number, page: number, videos: UserPublicationVideo[], total: number): void {
  console.log(`用户 ${mid} 的投稿 第 ${page} 页 (共 ${total} 条，本页 ${videos.length} 条)：`);
  if (!videos.length) {
    console.log('  (空)');
    return;
  }
  for (const v of videos) {
    console.log(`  ${v.bvid}  ${v.title}`);
    console.log(`    播放 ${v.play}  投稿于 ${new Date(v.created * 1000).toLocaleString('zh-CN')}  时长 ${v.length}`);
  }
}

function formatSex(s: string): string {
  if (s === '男') return '男';
  if (s === '女') return '女';
  if (s === '保密') return '保密';
  return s || '保密';
}

function formatVip(type: number, status: number, label: string): string {
  if (status !== 1) return '无';
  if (type === 2) return `年度大会员 (${label})`;
  if (type === 1) return `月度会员 (${label})`;
  return label || '会员';
}
