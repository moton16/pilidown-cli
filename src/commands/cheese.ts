/**
 * pilidown - cheese command (M9.1)
 * Original: CLI-only, original to pilidown (DownKyi uses WPF window).
 *
 * Usage:
 *   pilidown cheese <url-or-id> [--season <id>] [--ep <id>] [--quality 127] [--json]
 *
 * Flow:
 *   parseEntrance(<url-or-id>) -> 解析 seasonId / episodeId
 *   若提供 --season / --ep，覆盖解析结果
 *   若只有 episodeId -> getSeasonInfoByEpisode
 *   getSeasonInfo(seasonId) -> 输出课程信息 + 剧集列表
 *   若指定 --ep -> getEpisodePlayUrl -> 输出流信息
 *         (cheese 流地址必须带 ep_id)
 */

import type { Command } from 'commander';
import { getSeasonInfo, getSeasonInfoByEpisode, getEpisodePlayUrl } from '../api/CheeseApi';
import { selectStreams } from '../services/StreamService';
import { parseEntrance } from '../core/parseEntrance';
import { setJsonMode, error as logError } from '../utils/logger';
import type { CheeseSeasonInfo, CheeseEpisode } from '../types/bili';

interface CheeseCommandOptions {
  season?: string;
  ep?: string;
  quality: string;
  json?: boolean;
  showUrl?: boolean;
}

export function registerCheeseCommand(program: Command): void {
  program
    .command('cheese <url-or-id>')
    .description('Fetch cheese (课程) season info and optional stream URL')
    .option('--season <id>', 'Override season_id (ssXXX number)')
    .option('--ep <id>', 'Fetch stream URL for this episode id (epXXX number)', '')
    .option('--quality <qn>', 'Preferred video quality (qn), e.g. 127=8K, 120=4K, 116=1080P60, 80=1080P', '80')
    .option('--json', 'Output as JSON Lines (for agent use)')
    .option('--show-url', 'Include temporary stream URLs in output')
    .action(async (arg: string, opts: CheeseCommandOptions) => {
      if (opts.json) setJsonMode(true);
      try {
        const parsed = parseEntrance(arg);
        if (parsed.type !== 'cheese') {
          throw new Error(`cheese command supports cheese only, got "${parsed.type}"`);
        }

        // 优先级：命令行 --season > parseEntrance seasonId > 通过 episodeId 反查
        let seasonId: number | undefined = opts.season ? Number(opts.season) : parsed.seasonId;
        const epIdFromOpt = opts.ep ? Number(opts.ep) : undefined;
        const epId = epIdFromOpt ?? parsed.episodeId;

        if (!seasonId) {
          if (epId) {
            // 通过 epId 反查 seasonId
            const season = await getSeasonInfoByEpisode(epId);
            seasonId = season.season_id;
          } else {
            throw new Error('无法确定 season_id：请提供 --season 或包含 season_id/ep_id 的 URL');
          }
        }

        const info = await getSeasonInfo(seasonId);

        // 输出课程信息
        if (opts.json) {
          process.stdout.write(JSON.stringify({ event: 'cheese.info', data: info }) + '\n');
        } else {
          printSeasonHuman(info);
        }

        // 若指定 --ep，输出对应集流地址
        if (epId) {
          const episode = findEpisode(info, epId);
          if (!episode) {
            throw new Error(`episode ep_id=${epId} not found in season ${seasonId}`);
          }
          const qn = parseInt(opts.quality, 10);
          const playUrl = await getEpisodePlayUrl(episode.id, episode.cid, qn);
          const selected = selectStreams(playUrl, { preferQn: qn });

          const streamResult = {
            season_id: info.season_id,
            episode: {
              id: episode.id,
              aid: episode.aid,
              cid: episode.cid,
              title: episode.title,
              long_title: episode.long_title ?? '',
              duration: episode.duration,
            },
            video: selected.video
              ? {
                  quality: selected.video.id,
                  codec: selected.video.codecid,
                  width: selected.video.width,
                  height: selected.video.height,
                  bandwidth: selected.video.bandwidth,
                  mimeType: selected.video.mimeType,
                  codecs: selected.video.codecs,
                  ...(opts.showUrl ? { baseUrl: selected.video.baseUrl, backupUrls: selected.video.baseBackupUrl } : {}),
                }
              : null,
            audio: selected.audio
              ? {
                  id: selected.audio.id,
                  bandwidth: selected.audio.bandwidth,
                  mimeType: selected.audio.mimeType,
                  codecs: selected.audio.codecs,
                  ...(opts.showUrl ? { baseUrl: selected.audio.baseUrl, backupUrls: selected.audio.baseBackupUrl } : {}),
                }
              : null,
            quality: selected.quality,
            acceptQuality: selected.acceptQuality,
            acceptDescription: selected.acceptDescription,
            supportFormats: selected.supportFormats,
          };

          if (opts.json) {
            process.stdout.write(JSON.stringify({ event: 'cheese.stream', data: streamResult }) + '\n');
          } else {
            printStreamHuman(streamResult);
          }
        }
      } catch (err) {
        logError('cheese failed', { error: (err as Error).message });
        process.exitCode = 1;
      }
    });
}

function findEpisode(info: CheeseSeasonInfo, epId: number): CheeseEpisode | undefined {
  // 优先按 id/epid 精确匹配
  const byId = info.episodes.find(e => e.id === epId || e.epid === epId);
  if (byId) return byId;
  // 兜底：尝试 aid 匹配
  return info.episodes.find(e => e.aid === epId);
}

function printSeasonHuman(info: CheeseSeasonInfo): void {
  console.log(`标题: ${info.title}`);
  console.log(`season_id: ${info.season_id}`);
  if (info.up_info) {
    console.log(`UP主: ${info.up_info.uname} (mid=${info.up_info.mid})`);
  }
  console.log(`封面: ${info.cover}`);
  if (info.evaluate) {
    console.log(`简介: ${info.evaluate}`);
  }
  console.log(`统计: 播放 ${info.stat.views}`);
  console.log(`剧集数: ${info.episodes.length}`);
  if (info.episodes.length > 0) {
    console.log('剧集列表:');
    for (const ep of info.episodes) {
      const label = ep.long_title ? `${ep.title} ${ep.long_title}` : ep.title;
      console.log(`  ep${ep.id} (aid=${ep.aid}, cid=${ep.cid}): ${label}  [${formatDuration(ep.duration)}]`);
    }
  }
}

function printStreamHuman(r: {
  season_id: number;
  episode: { id: number; aid: number; cid: number; title: string; long_title: string; duration: number };
  video: { quality: number; width: number; height: number; codecs: string; bandwidth: number; baseUrl?: string } | null;
  audio: { id: number; bandwidth: number; codecs: string; baseUrl?: string } | null;
  acceptQuality: number[];
  acceptDescription: string[];
}): void {
  console.log('--- 流地址 ---');
  console.log(`season_id: ${r.season_id}`);
  console.log(`剧集: ep${r.episode.id} ${r.episode.title} ${r.episode.long_title} (aid=${r.episode.aid}, cid=${r.episode.cid})`);
  console.log(`可获取画质: ${r.acceptDescription.join(', ')}`);
  console.log(`qn 列表: ${r.acceptQuality.join(', ')}`);
  if (r.video) {
    console.log(
      `视频流: qn=${r.video.quality}  ${r.video.width}x${r.video.height}  codec=${r.video.codecs}  bw=${r.video.bandwidth}`,
    );
    if (r.video.baseUrl) console.log(`  URL: ${r.video.baseUrl}`);
  } else {
    console.log('视频流: (无)');
  }
  if (r.audio) {
    console.log(`音频流: id=${r.audio.id}  codec=${r.audio.codecs}  bw=${r.audio.bandwidth}`);
    if (r.audio.baseUrl) console.log(`  URL: ${r.audio.baseUrl}`);
  } else {
    console.log('音频流: (无)');
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
