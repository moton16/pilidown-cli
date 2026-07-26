/**
 * pilidown - download command (M5.4)
 * Original: CLI-only, original to pilidown (DownKyi uses WPF window).
 *
 * Usage:
 *   pilidown download <url-or-id> [options]
 *   pilidown download <url-or-id> --page 1 --quality 80 --threads 8 --output ./out
 */

import type { Command } from 'commander';
import { mkdirSync } from 'node:fs';
import { parseEntrance } from '../core/parseEntrance';
import { downloadVideo, downloadAllPages } from '../services/DownloadService';
import { findFfmpeg } from '../utils/ffmpeg';
import { setJsonMode, info as logInfo, error as logError } from '../utils/logger';

export function registerDownloadCommand(program: Command): void {
  program
    .command('download <url-or-id>')
    .description('Download a Bilibili video (multi-thread + ffmpeg merge)')
    .option('--quality <qn>', 'Preferred video quality (qn), e.g. 127=8K, 120=4K, 116=1080P60, 80=1080P', '127')
    .option('--codec <id>', 'Preferred video codec id (7=AVC, 12=HEVC, 13=AV1)', parseInt)
    .option('--no-hires', 'Disable Hi-Res FLAC audio preference')
    .option('--dolby', 'Prefer Dolby Atmos audio if available')
    .option('--page <n>', 'Specific page number (1-based). Use --all to download all pages.', parseInt, 1)
    .option('--all', 'Download all pages (overrides --page)')
    .option('--output <dir>', 'Output directory', '.')
    .option('--filename <name>', 'Override base filename (no extension)')
    .option('--threads <n>', 'Number of download threads per stream', parseInt, 8)
    .option('--no-merge', 'Skip ffmpeg merge; keep separate .m4v + .m4a')
    .option('--overwrite', 'Overwrite existing files instead of skipping')
    .option('--json', 'Output as JSON Lines (for agent use)')
    .action(
      async (
        arg: string,
        opts: {
          quality: string;
          codec?: number;
          hires: boolean;
          dolby?: boolean;
          page: number;
          all?: boolean;
          output: string;
          filename?: string;
          threads: number;
          merge: boolean;
          overwrite?: boolean;
          json?: boolean;
        },
      ) => {
        if (opts.json) setJsonMode(true);
        try {
          const parsed = parseEntrance(arg);
          if (parsed.type !== 'video') {
            throw new Error(`download command supports video only, got "${parsed.type}"`);
          }
          mkdirSync(opts.output, { recursive: true });
          if (!findFfmpeg()) {
            logInfo('ffmpeg not found on PATH; will keep separate video/audio files if merging fails', {});
          }
          const baseOpts = {
            bvid: parsed.bvid,
            aid: parsed.aid,
            preferQn: parseInt(opts.quality, 10),
            preferCodec: opts.codec,
            preferHiRes: opts.hires,
            preferDolby: opts.dolby,
            outputDir: opts.output,
            filename: opts.filename,
            threads: opts.threads,
            noMerge: !opts.merge,
            overwrite: opts.overwrite,
          };
          if (opts.all) {
            const results = await downloadAllPages(baseOpts);
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'download-all', data: { results } }) + '\n');
            } else {
              console.log(`Downloaded ${results.length} pages:`);
              for (const r of results) {
                console.log(`  P${r.page}: ${r.mergedPath ?? r.videoPath ?? '(failed)'}`);
              }
            }
          } else {
            const result = await downloadVideo({ ...baseOpts, page: opts.page });
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'download', data: result }) + '\n');
            } else {
              console.log('Done.');
              if (result.mergedPath) console.log(`Merged: ${result.mergedPath}`);
              if (result.videoPath) console.log(`Video: ${result.videoPath}`);
              if (result.audioPath) console.log(`Audio: ${result.audioPath}`);
            }
          }
        } catch (err) {
          logError('download failed', { error: (err as Error).message });
          process.exitCode = 1;
        }
      },
    );
}
