/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/Downloader/MultiThreadDownloader.cs
 *   - src/DownKyi.Core/Downloader/PartialDownloader.cs
 *
 * Simplifications (ponytail):
 *   - Node 18 fetch + Promise.all replaces HttpWebRequest + events + threads.
 *   - Fixed partitions (no dynamic expand); adds YAGNI value without complexity.
 *   - Progress callback drives UI; no per-part event plumbing.
 */

import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, openSync, closeSync, writeSync, readSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { downloadBuffer } from './httpClient';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface DownloadOptions {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  timeout?: number;
  threads?: number;
  onProgress?: (current: number, total: number, speedBps: number) => void;
}

export interface Partition {
  index: number;
  from: number;
  to: number; // inclusive
}

/** Split [0, size-1] into N roughly-equal byte ranges. */
export function createPartitions(size: number, numParts: number): Partition[] {
  const n = Math.min(size > 0 ? size : 1, Math.max(1, numParts));
  if (size <= 0) return [];
  const partSize = Math.floor(size / n);
  const parts: Partition[] = [];
  for (let i = 0; i < n; i++) {
    const from = i * partSize;
    const to = i === n - 1 ? size - 1 : from + partSize - 1;
    parts.push({ index: i, from, to });
  }
  return parts;
}

/** HEAD-like probe: GET with Range: bytes=0-0 to detect size + range support without downloading body. */
export async function probeRangeSupport(
  url: string,
  opts: { headers?: Record<string, string>; cookies?: Record<string, string>; timeout?: number } = {},
): Promise<{ size: number; rangeAllowed: boolean; url: string }> {
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    'Referer': 'https://www.bilibili.com/',
    Range: 'bytes=0-0',
    ...opts.headers,
  };
  if (opts.cookies) headers['Cookie'] = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? 30000);
  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const acceptRanges = resp.status === 206 && (resp.headers.get('accept-ranges') ?? '').toLowerCase() === 'bytes';
    let size = Number(resp.headers.get('content-range')?.split('/')?.[1]);
    if (!Number.isFinite(size) || size < 0) {
      size = Number(resp.headers.get('content-length')) ?? 0;
    }
    // Drain the 1-byte body to free the connection.
    await resp.arrayBuffer().catch(() => {});
    return { size, rangeAllowed: acceptRanges, url: resp.url || url };
  } finally {
    clearTimeout(timer);
  }
}

/** Download a single byte range to a file path using stream pipeline. */
export async function downloadPart(
  url: string,
  part: Partition,
  destPath: string,
  opts: DownloadOptions = {},
): Promise<{ bytes: number }> {
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    'Referer': 'https://www.bilibili.com/',
    ...opts.headers,
  };
  if (opts.cookies) headers['Cookie'] = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  headers['Range'] = `bytes=${part.from}-${part.to}`;
  // ponytail: timeout proportional to part size — at least 60s, plus 30s per MB
  const partSize = part.to - part.from + 1;
  const timeout = opts.timeout ?? Math.max(60000, 30000 * Math.ceil(partSize / (1024 * 1024)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (resp.status !== 206) {
      throw new Error(`HTTP ${resp.status} on range ${part.from}-${part.to} for ${url}`);
    }
    if (!resp.body) throw new Error('No response body');
    // ponytail: stream body to file via node:stream/promises.pipeline (memory-efficient)
    const sink = createWriteStream(destPath);
    await pipeline(Readable.fromWeb(resp.body as unknown as Parameters<typeof Readable.fromWeb>[0]), sink);
    const bytes = statSync(destPath).size;
    return { bytes };
  } finally {
    clearTimeout(timer);
  }
}

/** Merge a list of part files in order into a single output file, then delete the parts. */
export function mergeParts(partPaths: string[], destPath: string, onDeleteTemp = true): void {
  const dir = dirname(destPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = openSync(destPath, 'w');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    for (const p of partPaths) {
      const fd = openSync(p, 'r');
      try {
        let read: number;
        while ((read = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
          writeSync(out, buffer, 0, read);
        }
      } finally {
        closeSync(fd);
      }
    }
  } finally {
    closeSync(out);
  }
  if (onDeleteTemp) {
    for (const p of partPaths) {
      try { rmSync(p, { force: true }); } catch { /* ignore */ }
    }
  }
}

export interface MultiThreadDownloadResult {
  totalBytes: number;
  durationMs: number;
  averageSpeedBps: number;
  partitions: number;
  destPath: string;
}

/** High-level: download `url` to `destPath` using N parallel range partitions. */
export async function downloadMultiThread(
  url: string,
  destPath: string,
  opts: DownloadOptions = {},
): Promise<MultiThreadDownloadResult> {
  const threads = Math.max(1, opts.threads ?? 8);
  const probe = await probeRangeSupport(url, opts);
  const { size, rangeAllowed } = probe;
  if (size <= 0) {
    // ponytail: empty / unknown-size → fallback to single-shot download
    const buf = await downloadBuffer(url, opts);
    const dir = dirname(destPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await import('node:fs/promises').then(fs => fs.writeFile(destPath, buf));
    return { totalBytes: buf.length, durationMs: 0, averageSpeedBps: 0, partitions: 1, destPath };
  }
  if (!rangeAllowed) {
    // Single stream download
    const dir = dirname(destPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const { bytes } = await downloadPart(url, { index: 0, from: 0, to: size - 1 }, destPath, opts);
    return { totalBytes: bytes, durationMs: 0, averageSpeedBps: 0, partitions: 1, destPath };
  }
  const parts = createPartitions(size, threads);
  const tempDir = join(dirname(destPath), `.pilidown-tmp-${Date.now()}`);
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  const partPaths = parts.map(p => join(tempDir, `part-${String(p.index).padStart(4, '0')}.bin`));
  const startTime = Date.now();
  let received = 0;
  let lastSpeedMark = startTime;
  let lastSpeedBytes = 0;

  try {
    await Promise.all(
      parts.map(async (part, idx) => {
        const result = await downloadPart(url, part, partPaths[idx], opts);
        received += result.bytes;
        if (opts.onProgress) {
          const now = Date.now();
          const dt = (now - lastSpeedMark) / 1000;
          const instantSpeed = dt > 0 ? (received - lastSpeedBytes) / dt : 0;
          opts.onProgress(received, size, instantSpeed);
          lastSpeedMark = now;
          lastSpeedBytes = received;
        }
      }),
    );
    mergeParts(partPaths, destPath);
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const durationMs = Date.now() - startTime;
  const averageSpeedBps = durationMs > 0 ? (size / (durationMs / 1000)) : 0;
  return { totalBytes: size, durationMs, averageSpeedBps, partitions: parts.length, destPath };
}
