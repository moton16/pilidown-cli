/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# sources:
 *   - src/DownKyi.Core/Downloader/MultiThreadDownloader.cs
 *   - src/DownKyi.Core/Downloader/PartialDownloader.cs
 *
 * P1 Batch 2 Enhancements:
 *   - Resumable download via direct pwrite + .partstate.json manifest.
 *   - Strict Content-Range offset verification (anti-corruption).
 *   - Single progress/speed aggregator (monotonic, periodic).
 *   - Async pipeline-based mergeParts with fsync and atomic rename.
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { open, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
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
  resume?: boolean;
  key?: string;
  maxTries?: number;
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
  const partSize = part.to - part.from + 1;
  const timeout = opts.timeout ?? Math.max(60000, 30000 * Math.ceil(partSize / (1024 * 1024)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (resp.status === 200 && part.from > 0) {
      throw new Error(`server ignored Range (200) for part ${part.index} range ${part.from}-${part.to}`);
    }
    if (resp.status !== 206 && resp.status !== 200) {
      throw new Error(`HTTP ${resp.status} on range ${part.from}-${part.to} for ${url}`);
    }
    if (resp.status === 206) {
      const cr = resp.headers.get('content-range');
      const cm = /bytes (\d+)-(\d+)\//.exec(cr ?? '');
      if (!cm || Number(cm[1]) !== part.from) {
        throw new Error(`Content-Range mismatch on part ${part.index}: requested ${part.from}, got ${cr}`);
      }
    }
    if (!resp.body) throw new Error('No response body');
    const dir = dirname(destPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const sink = createWriteStream(destPath);
    await pipeline(Readable.fromWeb(resp.body as unknown as Parameters<typeof Readable.fromWeb>[0]), sink);
    const bytes = statSync(destPath).size;
    return { bytes };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a partition directly into an open file descriptor at its absolute offset. */
async function fetchPartDirect(
  url: string,
  part: Partition,
  fh: FileHandle,
  done: number,
  onBytes: (n: number) => void,
  opts: DownloadOptions = {},
): Promise<number> {
  const start = part.from + done;
  if (start > part.to) return done;
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    'Referer': 'https://www.bilibili.com/',
    ...opts.headers,
    Range: `bytes=${start}-${part.to}`,
  };
  if (opts.cookies) headers['Cookie'] = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; ');

  const partSize = part.to - start + 1;
  const timeout = opts.timeout ?? Math.max(60000, 30000 * Math.ceil(partSize / (1024 * 1024)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (resp.status === 200) {
      throw new Error(`server ignored Range (200) for part ${part.index} — must restart part from 0`);
    }
    if (resp.status !== 206) {
      throw new Error(`HTTP ${resp.status} on part ${part.index} range ${start}-${part.to}`);
    }
    const cr = resp.headers.get('content-range');
    const cm = /bytes (\d+)-(\d+)\//.exec(cr ?? '');
    if (!cm || Number(cm[1]) !== start) {
      throw new Error(`Content-Range mismatch on part ${part.index}: requested ${start}, got ${cr}`);
    }
    if (!resp.body) throw new Error('No response body');
    let pos = start;
    for await (const chunk of Readable.fromWeb(resp.body as unknown as Parameters<typeof Readable.fromWeb>[0])) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (pos > part.to) break;
      const n = Math.min(buf.length, part.to - pos + 1);
      await fh.write(buf, 0, n, pos);
      pos += n;
      onBytes(n);
      if (pos > part.to) break;
    }
    return pos - part.from;
  } finally {
    clearTimeout(timer);
  }
}

/** Merge a list of part files asynchronously in order with backpressure and atomic rename. */
export async function mergeParts(partPaths: string[], destPath: string, onDeleteTemp = true): Promise<void> {
  const dir = dirname(destPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (partPaths.length === 0) {
    await writeFile(destPath, Buffer.alloc(0));
    return;
  }

  const tmpDest = `${destPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ws = createWriteStream(tmpDest);

  try {
    for (let i = 0; i < partPaths.length; i++) {
      const isLast = i === partPaths.length - 1;
      const rs = createReadStream(partPaths[i]);
      await pipeline(rs, ws, { end: isLast });
    }
    const fh = await open(tmpDest, 'r+');
    await fh.sync();
    await fh.close();
    await rename(tmpDest, destPath);
  } catch (err) {
    await rm(tmpDest, { force: true }).catch(() => {});
    throw err;
  }

  if (onDeleteTemp) {
    for (const p of partPaths) {
      await rm(p, { force: true }).catch(() => {});
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

interface PartState {
  v: number;
  size: number;
  key?: string;
  done: number[];
}

/** High-level: download `url` to `destPath` using parallel range partitions with direct pwrite & resume. */
export async function downloadMultiThread(
  url: string,
  destPath: string,
  opts: DownloadOptions = {},
): Promise<MultiThreadDownloadResult> {
  const threads = Math.max(1, opts.threads ?? 8);
  const probe = await probeRangeSupport(url, opts);
  const { size, rangeAllowed } = probe;
  const dir = dirname(destPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (size <= 0) {
    const buf = await downloadBuffer(url, opts);
    await writeFile(destPath, buf);
    return { totalBytes: buf.length, durationMs: 0, averageSpeedBps: 0, partitions: 1, destPath };
  }

  if (!rangeAllowed) {
    const { bytes } = await downloadPart(url, { index: 0, from: 0, to: size - 1 }, destPath, opts);
    return { totalBytes: bytes, durationMs: 0, averageSpeedBps: 0, partitions: 1, destPath };
  }

  const parts = createPartitions(size, threads);
  const partPath = `${destPath}.part`;
  const statePath = `${destPath}.partstate.json`;
  const lockPath = `${destPath}.part.lock`;
  const shouldResume = opts.resume !== false;

  let lockFh: FileHandle | undefined;
  if (!shouldResume) {
    await rm(lockPath, { force: true }).catch(() => {});
    await rm(partPath, { force: true }).catch(() => {});
    await rm(statePath, { force: true }).catch(() => {});
  }

  try {
    lockFh = await open(lockPath, 'wx');
    await lockFh.write(Buffer.from(JSON.stringify({ pid: process.pid, time: Date.now() })));
  } catch (e: any) {
    if (e.code === 'EEXIST') {
      let isAlive = false;
      let holdingPid: number | undefined;
      try {
        const raw = readFileSync(lockPath, 'utf8');
        const parsed = JSON.parse(raw);
        holdingPid = parsed.pid;
        if (holdingPid && typeof holdingPid === 'number') {
          process.kill(holdingPid, 0);
          isAlive = true;
        }
      } catch (checkErr: any) {
        if (checkErr?.code === 'ESRCH') {
          isAlive = false;
        } else if (checkErr?.code === 'EPERM') {
          isAlive = true;
        } else {
          isAlive = false;
        }
      }
      if (!isAlive) {
        await rm(lockPath, { force: true }).catch(() => {});
        lockFh = await open(lockPath, 'wx');
        await lockFh.write(Buffer.from(JSON.stringify({ pid: process.pid, time: Date.now() })));
      } else {
        throw new Error(
          `Another process (PID ${holdingPid ?? 'unknown'}) is currently downloading to ${destPath} (lock file ${lockPath} exists).\n` +
            `  → If stale, delete ${lockPath} or re-run with --no-resume.`,
        );
      }
    } else {
      throw e;
    }
  }

  let state: PartState = { v: 1, size, key: opts.key, done: parts.map(() => 0) };

  if (shouldResume && existsSync(statePath) && existsSync(partPath)) {
    try {
      const prev: PartState = JSON.parse(readFileSync(statePath, 'utf8'));
      if (
        prev.v === 1 &&
        prev.size === size &&
        Array.isArray(prev.done) &&
        prev.done.length === parts.length &&
        (!opts.key || prev.key === opts.key)
      ) {
        state = prev;
      } else {
        await rm(partPath, { force: true });
        await rm(statePath, { force: true });
      }
    } catch {
      await rm(partPath, { force: true });
      await rm(statePath, { force: true });
    }
  } else if (!shouldResume) {
    await rm(partPath, { force: true });
    await rm(statePath, { force: true });
  }

  let fh: FileHandle;
  try {
    fh = await open(partPath, 'r+');
  } catch (e: any) {
    if (e.code === 'ENOENT') fh = await open(partPath, 'w+');
    else throw e;
  }
  try {
    await fh.truncate(size);
  } catch {
    /* preallocation is an optimization */
  }

  let isSaving = false;
  let saveQueued = false;
  let lastSave = Date.now();
  const saveState = async (force = false) => {
    if (!force && Date.now() - lastSave < 300) return;
    lastSave = Date.now();
    if (isSaving) {
      saveQueued = true;
      return;
    }
    isSaving = true;
    try {
      do {
        saveQueued = false;
        const tmpState = `${statePath}.tmp-${process.pid}`;
        await writeFile(tmpState, JSON.stringify(state));
        await rename(tmpState, statePath).catch(async () => {
          await writeFile(statePath, JSON.stringify(state));
        });
      } while (saveQueued);
    } catch {
      /* ignore state write errors */
    } finally {
      isSaving = false;
    }
  };

  const startTime = Date.now();
  let lastProgressBytes = state.done.reduce((a, b) => a + b, 0);
  let lastProgressTime = startTime;
  let progressTimer: NodeJS.Timeout | undefined;

  if (opts.onProgress) {
    progressTimer = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastProgressTime) / 1000;
      const sumBytes = state.done.reduce((a, b) => a + b, 0);
      const instantSpeed = dt > 0 ? (sumBytes - lastProgressBytes) / dt : 0;
      opts.onProgress?.(sumBytes, size, Math.max(0, instantSpeed));
      lastProgressBytes = sumBytes;
      lastProgressTime = now;
    }, 250);
  }

  const maxTries = opts.maxTries ?? 4;

  try {
    await Promise.all(
      parts.map(async (p) => {
        let tries = 0;
        for (;;) {
          try {
            const at = state.done[p.index];
            const got = await fetchPartDirect(
              url,
              p,
              fh,
              at,
              (n) => {
                state.done[p.index] += n;
                void saveState(false);
              },
              opts,
            );
            state.done[p.index] = got;
            await saveState(true);
            return;
          } catch (err) {
            if (++tries >= maxTries) throw err;
            await new Promise((r) => setTimeout(r, 50 * tries));
          }
        }
      }),
    );

    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = undefined;
    }

    await fh.sync();
    await fh.close();

    const sum = state.done.reduce((a, b) => a + b, 0);
    if (sum !== size) {
      throw new Error(`Incomplete download: received ${sum}/${size} bytes`);
    }

    await rename(partPath, destPath);
    await rm(statePath, { force: true });
  } catch (err) {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = undefined;
    }
    await fh.close().catch(() => {});
    await saveState(true);
    const msg = (err as Error).message;
    throw new Error(`${msg}\n  → 已保留 ${partPath} 与 ${statePath}，重跑同一条命令会从断点继续`);
  } finally {
    if (lockFh) {
      await lockFh.close().catch(() => {});
      await rm(lockPath, { force: true }).catch(() => {});
    }
  }

  const durationMs = Date.now() - startTime;
  const averageSpeedBps = durationMs > 0 ? size / (durationMs / 1000) : 0;
  if (opts.onProgress) {
    opts.onProgress(size, size, averageSpeedBps);
  }
  return { totalBytes: size, durationMs, averageSpeedBps, partitions: parts.length, destPath };
}
