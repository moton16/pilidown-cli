/**
 * pilidown - subtitle command (M7.2)
 * Original: CLI-only, original to pilidown (DownKyi uses WPF window + ToSubRip only).
 *
 * Usage: pilidown subtitle <url-or-id> [--format srt|json|ass] [--output <path>]
 *                            [--page 1] [--lan <code>] [--json]
 *
 * Flow: parseEntrance → getVideoInfo (cid) → getPlayerInfo (subtitle list) →
 *       select lan → fetchSubtitle → convert to requested format → write to stdout/file.
 */

import type { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { getVideoInfo, getPlayerInfo } from '../api/VideoApi';
import { parseEntrance } from '../core/parseEntrance';
import {
  fetchSubtitle,
  subtitleToSrt,
  subtitleToJson,
  subtitleToAss,
} from '../core/subtitleConverter';
import { setJsonMode, error as logError, info as logInfo } from '../utils/logger';
import type { BiliSubtitle, SubtitleBody } from '../types/bili';

type SubtitleFormat = 'srt' | 'json' | 'ass';

function parseFormat(value: string): SubtitleFormat {
  const v = String(value).toLowerCase();
  if (v === 'srt' || v === 'json' || v === 'ass') return v;
  throw new Error(`Invalid --format value: ${value} (expected srt|json|ass)`);
}

function selectSubtitle(
  subtitles: BiliSubtitle[],
  preferLan?: string,
): BiliSubtitle | undefined {
  if (!subtitles.length) return undefined;
  if (preferLan) {
    const exact = subtitles.find(s => s.lan === preferLan);
    if (exact) return exact;
    // Fallback: case-insensitive prefix match (e.g. "zh" matches "zh-CN").
    const lower = preferLan.toLowerCase();
    const prefix = subtitles.find(s => s.lan.toLowerCase().startsWith(lower));
    if (prefix) return prefix;
  }
  return subtitles[0];
}

function convertBody(
  body: SubtitleBody[],
  format: SubtitleFormat,
  lan: string,
  lanDoc: string,
): string {
  switch (format) {
    case 'srt':
      return subtitleToSrt(body);
    case 'ass':
      return subtitleToAss(body);
    case 'json':
      return subtitleToJson(body, lan, lanDoc);
  }
}

export function registerSubtitleCommand(program: Command): void {
  program
    .command('subtitle <url-or-id>')
    .description('Fetch and convert Bilibili subtitles for a video')
    .option('--format <fmt>', 'Output format: srt | json | ass', 'srt')
    .option('--output <path>', 'Write to file instead of stdout')
    .option('--page <n>', 'Page number (1-based)', (v: string) => parseInt(v, 10), 1)
    .option('--lan <code>', 'Subtitle language code (e.g. zh-CN); default first available')
    .option('--json', 'Output as JSON Lines (for agent use)')
    .action(
      async (
        arg: string,
        opts: {
          format: string;
          output?: string;
          page: number;
          lan?: string;
          json?: boolean;
        },
      ) => {
        if (opts.json) setJsonMode(true);
        try {
          const format = parseFormat(opts.format);
          const parsed = parseEntrance(arg);
          if (parsed.type !== 'video') {
            throw new Error(`subtitle command supports video only, got "${parsed.type}"`);
          }
          const info = await getVideoInfo({ bvid: parsed.bvid, aid: parsed.aid });
          const pageIdx = Math.max(1, opts.page) - 1;
          const page = info.pages[pageIdx] ?? info.pages[0];
          if (!page) throw new Error('No pages found for this video');

          const player = await getPlayerInfo({
            bvid: parsed.bvid,
            aid: parsed.aid,
            cid: page.cid,
          });
          const subtitles = player.subtitle?.subtitles ?? [];
          if (!subtitles.length) {
            throw new Error('No subtitles available for this video');
          }

          const picked = selectSubtitle(subtitles, opts.lan);
          if (!picked) {
            throw new Error(
              `No subtitle matching --lan "${opts.lan}". Available: ${subtitles
                .map(s => `${s.lan} (${s.lan_doc})`)
                .join(', ')}`,
            );
          }

          const body = await fetchSubtitle(picked);
          const content = convertBody(body, format, picked.lan, picked.lan_doc);

          if (opts.output) {
            writeFileSync(opts.output, content, 'utf8');
          }

          const result = {
            bvid: info.bvid,
            aid: info.aid,
            title: info.title,
            page: { index: page.page, part: page.part, cid: page.cid, duration: page.duration },
            subtitle: {
              lan: picked.lan,
              lan_doc: picked.lan_doc,
              id: picked.id,
              format,
              lineCount: body.length,
              content,
              outputPath: opts.output ?? null,
            },
            available: subtitles.map(s => ({ lan: s.lan, lan_doc: s.lan_doc, id: s.id })),
          };

          if (opts.json) {
            process.stdout.write(JSON.stringify({ event: 'subtitle', data: result }) + '\n');
          } else if (opts.output) {
            logInfo('subtitle saved', {
              lan: picked.lan,
              lan_doc: picked.lan_doc,
              format,
              lineCount: body.length,
              path: opts.output,
            });
          } else {
            process.stdout.write(content);
            if (!content.endsWith('\n')) process.stdout.write('\n');
          }
        } catch (err) {
          logError('subtitle failed', { error: (err as Error).message });
          process.exitCode = 1;
        }
      },
    );
}
