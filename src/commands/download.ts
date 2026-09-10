/**
 * pilidown - download command (M5.4)
 * Original: CLI-only, original to pilidown (DownKyi uses WPF window).
 *
 * Usage:
 *   pilidown download <url-or-id> [options]
 *   pilidown download <url-or-id> --page 1 --quality 80 --threads 8 --output ./out
 *
 * Exit code policy: any failure (single page, batch, merge) sets exit code 1.
 * Batch downloads report a `failures` array in both JSON and human output.
 */

import type { Command } from 'commander';
import { mkdirSync } from 'node:fs';
import { parseEntrance } from '../core/parseEntrance';
import { downloadVideo, downloadAllPages, downloadCollection } from '../services/DownloadService';
import { loadCookies } from '../services/CookieService';
import { setJsonMode, error as logError } from '../utils/logger';

export function registerDownloadCommand(program: Command): void {
  program
    .command('download <url-or-id>')
    .description('Download a Bilibili video (multi-thread + fMP4 passthrough merge)')
    .option('--quality <qn>', 'Preferred video quality; default is 80 when logged in, 16 anonymously')
    .option('--codec <id>', 'Preferred video codec id (7=AVC, 12=HEVC, 13=AV1)', (v: string) => parseInt(v, 10))
    .option('--audio-quality <id>', 'Preferred audio id; default is 30280 when logged in, 30216 anonymously', (v: string) => parseInt(v, 10))
    .option('--no-hires', 'Disable Hi-Res FLAC audio preference')
    .option('--dolby', 'Prefer Dolby Atmos audio if available')
    .option('--page <n>', 'Specific page number (1-based). Use --all to download all pages.', (v: string) => parseInt(v, 10), 1)
    .option('--all', 'Download all pages (overrides --page)')
    .option('--collection', 'Download entire UGC collection (合集) — input any bvid in the collection')
    .option('--output <dir>', 'Output directory', '.') // NOTE: a DIRECTORY for download/fav; a FILE path for danmaku/subtitle
    .option('--filename <name>', 'Override base filename (no extension)')
    .option('--threads <n>', 'Number of download threads per stream', (v: string) => parseInt(v, 10), 8)
    .option('--no-merge', 'Skip merge; keep separate .m4v + .m4a')
    .option('--audio-only', 'Download audio only (skip video stream), output .m4a')
    .option('--format <fmt>', 'Audio format: m4a only (mp3 removed — native AAC; transcode with system ffmpeg if needed)', 'm4a')
    .option('--overwrite', 'Overwrite existing files instead of skipping')
    .option('--json', 'Output as JSON Lines (for agent use)')
    .action(
      async (
        arg: string,
        opts: {
          quality?: string;
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
          const loggedIn = Boolean(loadCookies().cookies.SESSDATA);
          const baseOpts = {
            bvid: parsed.bvid,
            aid: parsed.aid,
            preferQn: opts.quality ? parseInt(opts.quality, 10) : loggedIn ? 80 : 16,
            preferCodec: opts.codec,
            preferAudioId: opts.audioQuality ?? (loggedIn ? 30280 : 30216),
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
            const { results, failures } = await downloadAllPages(baseOpts);
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'download-all', data: { results, failures } }) + '\n');
            } else {
              console.log(`Downloaded ${results.length}/${results.length + failures.length} pages:`);
              for (const r of results) {
                console.log(`  P${r.page}: ${r.mergedPath ?? r.videoPath ?? '(no output)'}`);
              }
              for (const f of failures) {
                console.log(`  P${f.page}: FAILED — ${f.error}`);
              }
            }
            if (failures.length > 0) process.exitCode = 1;
          } else if (opts.collection) {
            const { results, failures } = await downloadCollection(baseOpts);
            if (opts.json) {
              process.stdout.write(JSON.stringify({ event: 'download-collection', data: { results, failures } }) + '\n');
            } else {
              console.log(`Downloaded ${results.length}/${results.length + failures.length} collection episodes:`);
              for (let i = 0; i < results.length; i++) {
                const r = results[i];
                console.log(`  ep${i + 1}: ${r.mergedPath ?? r.videoPath ?? '(no output)'}`);
              }
              for (const f of failures) {
                console.log(`  ep${f.episode}: FAILED — ${f.error}`);
              }
            }
            if (failures.length > 0) process.exitCode = 1;
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
