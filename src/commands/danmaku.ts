/**
 * pilidown - danmaku command (M6.4)
 * Original: CLI-only, original to pilidown (DownKyi drives conversion from WPF).
 *
 * Usage: pilidown danmaku <url-or-id> [--format ass|xml|raw] [--output <path>] [--page 1] [--json]
 *
 * Pipeline:
 *   parseEntrance -> getVideoInfo -> fetchDanmakuSegments -> format-specific output
 */

import type { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { getVideoInfo } from '../api/VideoApi';
import { fetchDanmakuSegments } from '../api/DanmakuApi';
import { createAssFile, type AssConfig } from '../core/assConverter';
import { parseEntrance } from '../core/parseEntrance';
import { loadCookies } from '../services/CookieService';
import { setJsonMode, info as logInfo, error as logError } from '../utils/logger';
import type { BiliDanmaku } from '../types/bili';

export type DanmakuFormat = 'ass' | 'xml' | 'raw';

export function registerDanmakuCommand(program: Command): void {
  program
    .command('danmaku <url-or-id>')
    .description('Fetch and convert danmaku for a Bilibili video (ass/xml/raw)')
    .option('--format <fmt>', 'Output format: ass (default), xml (Bilibili XML), raw (protobuf bytes)', 'ass')
    .option('--output <path>', 'Write to file instead of stdout')
    .option('--page <n>', 'Page number (1-based)', parseInt, 1)
    .option('--json', 'Emit JSON Lines progress events (for agent use)')
    .action(
      async (
        arg: string,
        opts: {
          format: DanmakuFormat;
          output?: string;
          page: number;
          json?: boolean;
        },
      ) => {
        if (opts.json) setJsonMode(true);
        try {
          const format = normalizeFormat(opts.format);
          const parsed = parseEntrance(arg);
          if (parsed.type !== 'video') {
            throw new Error(`danmaku command supports video only, got "${parsed.type}"`);
          }
          const cookieData = loadCookies();
          const info = await getVideoInfo({ bvid: parsed.bvid, aid: parsed.aid });

          const pageIdx = Math.max(1, opts.page) - 1;
          const page = info.pages[pageIdx] ?? info.pages[0];
          if (!page) throw new Error('No pages found for this video');

          logInfo('danmaku.fetch.start', {
            bvid: info.bvid,
            aid: info.aid,
            cid: page.cid,
            page: page.page,
            part: page.part,
          });

          const { danmaku, rawBuffer } = await fetchDanmakuSegments(
            { aid: info.aid, bvid: info.bvid, cid: page.cid },
            { cookies: cookieData.cookies },
          );

          logInfo('danmaku.fetch.done', { count: danmaku.length });

          const output = formatOutput(format, danmaku, rawBuffer, info.title);
          writeOutput(opts.output, output, format);

          if (opts.json) {
            process.stdout.write(
              JSON.stringify({
                event: 'danmaku',
                data: {
                  bvid: info.bvid,
                  aid: info.aid,
                  title: info.title,
                  page: { index: page.page, part: page.part, cid: page.cid },
                  format,
                  count: danmaku.length,
                  output: opts.output ?? '<stdout>',
                },
              }) + '\n',
            );
          } else if (!opts.output) {
            // Already wrote to stdout via writeOutput.
          } else {
            logInfo('danmaku.wrote', { path: opts.output, count: danmaku.length, format });
          }
        } catch (err) {
          logError('danmaku failed', { error: (err as Error).message });
          process.exitCode = 1;
        }
      },
    );
}

function normalizeFormat(fmt: string): DanmakuFormat {
  const f = fmt.toLowerCase();
  if (f === 'ass' || f === 'xml' || f === 'raw') return f;
  throw new Error(`--format must be one of: ass, xml, raw (got "${fmt}")`);
}

function formatOutput(format: DanmakuFormat, danmaku: BiliDanmaku[], rawBuffer: Buffer, title: string): Buffer {
  if (format === 'raw') {
    return rawBuffer;
  }
  if (format === 'xml') {
    return Buffer.from(toBilibiliXml(danmaku), 'utf8');
  }
  // ass
  const config: Partial<AssConfig> = { title };
  return Buffer.from(createAssFile(danmaku, config), 'utf8');
}

/**
 * Convert to B站 XML 弹幕格式:
 *   <?xml version="1.0" encoding="UTF-8"?><i><d p="progress,mode,fontsize,color,ctime,pool,midHash,id">content</d>...</i>
 * Field order matches the canonical Bilibili XML danmaku schema.
 */
function toBilibiliXml(danmaku: BiliDanmaku[]): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<i>'];
  for (const d of danmaku) {
    const p = [d.progress, d.mode, d.fontsize, d.color, d.ctime, d.pool, d.midHash, d.id].join(',');
    lines.push(`  <d p="${p}">${esc(d.content)}</d>`);
  }
  lines.push('</i>');
  return lines.join('\n');
}

function writeOutput(path: string | undefined, data: Buffer, format: DanmakuFormat): void {
  if (!path) {
    if (format === 'raw') {
      // Binary: write to stdout directly.
      process.stdout.write(data);
    } else {
      process.stdout.write(data.toString('utf8'));
      if (!data.toString('utf8').endsWith('\n')) process.stdout.write('\n');
    }
    return;
  }
  writeFileSync(path, data);
}
