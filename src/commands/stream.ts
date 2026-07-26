/**
 * pilidown - stream command (M4.3)
 * Original: CLI-only, original to pilidown (DownKyi uses WPF window).
 *
 * Usage: pilidown stream <url-or-id> [--quality 127] [--codec 7] [--page 1] [--json]
 */

import type { Command } from 'commander';
import { getVideoInfo, getPlayUrl } from '../api/VideoApi';
import { selectStreams, type SelectedStreams } from '../services/StreamService';
import { parseEntrance } from '../core/parseEntrance';
import { setJsonMode, error as logError } from '../utils/logger';

export function registerStreamCommand(program: Command): void {
  program
    .command('stream <url-or-id>')
    .description('Fetch and select stream URLs for a Bilibili video')
    .option('--quality <qn>', 'Preferred video quality (qn), e.g. 127=8K, 120=4K, 116=1080P60, 80=1080P', '127')
    .option('--codec <id>', 'Preferred video codec id (7=AVC, 12=HEVC, 13=AV1)', parseInt)
    .option('--page <n>', 'Page number (1-based)', parseInt, 1)
    .option('--no-hires', 'Disable Hi-Res FLAC audio preference')
    .option('--dolby', 'Prefer Dolby Atmos audio if available')
    .option('--json', 'Output as JSON Lines (for agent use)')
    .action(
      async (
        arg: string,
        opts: {
          quality: string;
          codec?: number;
          page: number;
          hires: boolean;
          dolby?: boolean;
          json?: boolean;
        },
      ) => {
        if (opts.json) setJsonMode(true);
        try {
          const parsed = parseEntrance(arg);
          if (parsed.type !== 'video') {
            throw new Error(`stream command supports video only, got "${parsed.type}"`);
          }
          const info = await getVideoInfo({ bvid: parsed.bvid, aid: parsed.aid });
          const pageIdx = Math.max(1, opts.page) - 1;
          const page = info.pages[pageIdx] ?? info.pages[0];
          if (!page) throw new Error('No pages found for this video');

          const qn = parseInt(opts.quality, 10);
          const playUrl = await getPlayUrl({
            bvid: parsed.bvid,
            aid: parsed.aid,
            cid: page.cid,
            qn: qn,
          });
          const selected: SelectedStreams = selectStreams(playUrl, {
            preferQn: qn,
            preferCodec: opts.codec,
            preferHiRes: opts.hires,
            preferDolby: opts.dolby,
          });

          const result = {
            bvid: info.bvid,
            aid: info.aid,
            title: info.title,
            page: { index: page.page, part: page.part, cid: page.cid, duration: page.duration },
            video: selected.video
              ? {
                  quality: selected.video.id,
                  codec: selected.video.codecid,
                  width: selected.video.width,
                  height: selected.video.height,
                  bandwidth: selected.video.bandwidth,
                  mimeType: selected.video.mimeType,
                  codecs: selected.video.codecs,
                  baseUrl: selected.video.baseUrl,
                  backupUrls: selected.video.baseBackupUrl,
                }
              : null,
            audio: selected.audio
              ? {
                  id: selected.audio.id,
                  bandwidth: selected.audio.bandwidth,
                  mimeType: selected.audio.mimeType,
                  codecs: selected.audio.codecs,
                  baseUrl: selected.audio.baseUrl,
                  backupUrls: selected.audio.baseBackupUrl,
                }
              : null,
            quality: selected.quality,
            acceptQuality: selected.acceptQuality,
            acceptDescription: selected.acceptDescription,
            supportFormats: selected.supportFormats,
          };

          if (opts.json) {
            process.stdout.write(JSON.stringify({ event: 'stream', data: result }) + '\n');
          } else {
            printHuman(result);
          }
        } catch (err) {
          logError('stream failed', { error: (err as Error).message });
          process.exitCode = 1;
        }
      },
    );
}

function printHuman(r: {
  title: string;
  bvid: string;
  aid: number;
  page: { index: number; part: string; cid: number; duration: number };
  video: { quality: number; width: number; height: number; codecs: string; bandwidth: number; baseUrl: string } | null;
  audio: { id: number; bandwidth: number; codecs: string; baseUrl: string } | null;
  acceptQuality: number[];
  acceptDescription: string[];
}): void {
  console.log(`标题: ${r.title}`);
  console.log(`BV: ${r.bvid}  AV: av${r.aid}`);
  console.log(`分P: P${r.page.index} ${r.page.part} (cid=${r.page.cid})`);
  console.log(`可获取画质: ${r.acceptDescription.join(', ')}`);
  console.log(`qn 列表: ${r.acceptQuality.join(', ')}`);
  if (r.video) {
    console.log(
      `视频流: qn=${r.video.quality}  ${r.video.width}x${r.video.height}  codec=${r.video.codecs}  bw=${r.video.bandwidth}`,
    );
    console.log(`  URL: ${r.video.baseUrl}`);
  } else {
    console.log('视频流: (无)');
  }
  if (r.audio) {
    console.log(`音频流: id=${r.audio.id}  codec=${r.audio.codecs}  bw=${r.audio.bandwidth}`);
    console.log(`  URL: ${r.audio.baseUrl}`);
  } else {
    console.log('音频流: (无)');
  }
}
