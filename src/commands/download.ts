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
import { downloadVideo, downloadAllPages, downloadCollection } from '../services/DownloadService';
import { setJsonMode, info as logInfo, error as logError } from '../utils/logger';

export function registerDownloadCommand(program: Command): void {
  program
    .command('download <url-or-id>')
    .description('Download a Bilibili video (multi-thread + pure JS merge)')
    .option('--quality <qn>', 'Preferred video quality (qn), e.g. 127=8K, 120=4K, 116=1080P60, 80=1080P', '127')
    .option('--codec <id>', 'Preferred video codec id (7=AVC, 12=HEVC, 13=AV1)', parseInt)
    .option('--audio-quality <id>', 'Preferred audio id (30216=64k, 30232=132k, 30280=192k, 30250=Dolby, 30251=Hi-Res)', (v: string) => parseInt(v, 10))
    .option('--no-hires', 'Disable Hi-Res FLAC audio preference')
    .option('--dolby', 'Prefer Dolby Atmos audio if available')
    .option('--page <n>', 'Specific page number (1-based). Use --all to download all pages.', (v: string) => parseInt(v, 10), 1)
    .option('--all', 'Download all pages (overrides --page)')
    .option('--collection', 'Download entire UGC collection (合集) — input any bvid in the collection')
    .option('--output <dir>', 'Output directory', '.')
    .option('--filename <name>', 'Override base filename (no extension)')
    .option('--threads <n>', 'Number of download threads per stream', (v: string) => parseInt(v, 10), 8)
    .option('--no-merge', 'Skip merge; keep separate .m4v + .m4a')
    .option('--audio-only', 'Download audio only (skip video stream), default output mp3')
    .option('--format <fmt>', 'Audio format for transcoding: mp3, aac, flac, wav, m4a', 'mp3')
    .option('--overwrite', 'Overwrite existing files instead of skipping')
    .option('--json', 'Output as JSON Lines (for agent use)')
    .action(
      async (
        arg: string,
        opts: {
          quality: string;
          codec?: number;
          audioQuality?: number;
          hires: boolean;
          dolby?: boolean;
          page: number;
          all?: boolean;
          collection?: boolean;
          output: string;
          filename?: string;
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
          const parsed = parseEntrance(arg);
          if (parsed.type !== 'video') {
            throw new Error(`download command supports video only, got "${parsed.type}"`);
          }
          mkdirSync(opts.output, { recursive: true });
          const baseOpts = {
            bvid: parsed.bvid,
            aid: parsed.aid,
            preferQn: parseInt(opts.quality, 10),
            preferCodec: opts.codec,
            preferAudioId: opts.audioQuality,
            preferHiRes: opts.hires,
            preferDolby: opts.dolby,
            outputDir: opts.output,
            filename: opts.filename,
            threads: opts.threads,
            noMerge: !opts.merge,
            audioOnly: opts.audioOnly,
            format: opts.format,
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
          } else if (opts.collection) {
            const results = await downloadCollection(baseOpts);
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'download-collection', data: { results } }) + '\n');
            } else {
              console.log(`Downloaded ${results.length} collection episodes:`);
              for (let i = 0; i < results.length; i++) {
                const r = results[i];
                console.log(`  ep${i + 1}: ${r.mergedPath ?? r.videoPath ?? '(failed)'}`);
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
