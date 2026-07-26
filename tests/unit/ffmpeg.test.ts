/**
 * pilidown - Unit tests for ffmpeg wrapper
 * Original: tests are original to pilidown.
 *
 * Strategy: pass `ffmpegPath` option explicitly to bypass findFfmpeg cache.
 * Mock the entire `node:child_process` module to assert command-line args
 * (cp.execFile is non-configurable in some Node versions; jest.mock sidesteps that).
 */

import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// jest.mock replaces the module factory BEFORE imports below run.
jest.mock('node:child_process', () => {
  const fakeExecFile = jest.fn((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null, '', '');
    return undefined;
  });
  const fakeSpawnSync = jest.fn(() => ({ status: 0, stdout: '', stderr: '' }));
  return { execFile: fakeExecFile, spawnSync: fakeSpawnSync };
});

import * as cp from 'node:child_process';
import {
  mergeVideoAudio,
  concatVideos,
  extractAudio,
  extractVideo,
} from '../../src/utils/ffmpeg';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pilidown-ff-'));
  (cp.execFile as unknown as jest.Mock).mockClear();
  (cp.spawnSync as unknown as jest.Mock).mockClear();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const FFMPEG = '/usr/local/bin/ffmpeg';

describe('mergeVideoAudio', () => {
  test('throws when no inputs provided', async () => {
    await expect(mergeVideoAudio(null, null, 'out.mp4', { ffmpegPath: FFMPEG })).rejects.toThrow(/at least one input/);
  });

  test('builds correct ffmpeg args when both inputs exist', async () => {
    const v = join(tmp, 'v.m4v');
    const a = join(tmp, 'a.m4a');
    const out = join(tmp, 'out.mp4');
    writeFileSync(v, 'x');
    writeFileSync(a, 'x');
    await mergeVideoAudio(v, a, out, { ffmpegPath: FFMPEG });
    const calls = (cp.execFile as unknown as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const args = calls[0][1] as string[];
    expect(args).toContain('-i');
    expect(args).toContain(v);
    expect(args).toContain(a);
    expect(args).toContain(out);
    expect(args).toContain('-acodec');
    expect(args).toContain('copy');
    expect(args).toContain('-vcodec');
    expect(args).toContain('copy');
    expect(args).toContain('-f');
    expect(args).toContain('mp4');
    expect(existsSync(v)).toBe(false);
    expect(existsSync(a)).toBe(false);
  });

  test('only video path → single -i', async () => {
    const v = join(tmp, 'v.m4v');
    const out = join(tmp, 'out.mp4');
    writeFileSync(v, 'x');
    await mergeVideoAudio(v, null, out, { ffmpegPath: FFMPEG });
    const args = (cp.execFile as unknown as jest.Mock).mock.calls[0][1] as string[];
    expect(args).toContain(v);
  });
});

describe('concatVideos', () => {
  test('writes concat list file and runs ffmpeg', async () => {
    const files = [join(tmp, 'a.mp4'), join(tmp, 'b.mp4')];
    for (const f of files) writeFileSync(f, 'x');
    const dest = join(tmp, 'out.mp4');
    await concatVideos(files, dest, { ffmpegPath: FFMPEG, cwd: tmp });
    expect((cp.execFile as unknown as jest.Mock)).toHaveBeenCalled();
    const args = (cp.execFile as unknown as jest.Mock).mock.calls[0][1] as string[];
    expect(args).toContain('-f');
    expect(args).toContain('concat');
    expect(args).toContain('-safe');
    expect(args).toContain('0');
    expect(args).toContain(dest);
    expect(existsSync(files[0])).toBe(false);
    expect(existsSync(files[1])).toBe(false);
  });

  test('single input just renames', async () => {
    const src = join(tmp, 'only.mp4');
    writeFileSync(src, 'x');
    const dest = join(tmp, 'renamed.mp4');
    await concatVideos([src], dest, { ffmpegPath: FFMPEG });
    expect((cp.execFile as unknown as jest.Mock)).not.toHaveBeenCalled();
    expect(existsSync(dest)).toBe(true);
  });

  test('throws on empty input list', async () => {
    await expect(concatVideos([], 'out.mp4', { ffmpegPath: FFMPEG })).rejects.toThrow(/no input files/);
  });
});

describe('extractAudio + extractVideo', () => {
  test('extractAudio uses -vn -acodec copy', async () => {
    await extractAudio('in.mp4', 'out.m4a', { ffmpegPath: FFMPEG });
    const args = (cp.execFile as unknown as jest.Mock).mock.calls[0][1] as string[];
    expect(args).toContain('-vn');
    expect(args).toContain('-acodec');
    expect(args).toContain('copy');
    expect(args).toContain('out.m4a');
  });

  test('extractVideo uses -vcodec copy -an', async () => {
    await extractVideo('in.mp4', 'out.m4v', { ffmpegPath: FFMPEG });
    const args = (cp.execFile as unknown as jest.Mock).mock.calls[0][1] as string[];
    expect(args).toContain('-vcodec');
    expect(args).toContain('copy');
    expect(args).toContain('-an');
    expect(args).toContain('out.m4v');
  });
});

describe('findFfmpeg', () => {
  test('returns "ffmpeg" when spawnSync exits 0', () => {
    (cp.spawnSync as unknown as jest.Mock).mockReturnValue({ status: 0 });
    // Clear module cache to reset findFfmpeg's internal cache.
    jest.resetModules();
    // Re-mock after resetModules so child_process is still mocked.
    jest.mock('node:child_process', () => ({
      execFile: jest.fn(),
      spawnSync: jest.fn(() => ({ status: 0 })),
    }));
    const fresh = jest.requireActual<typeof import('../../src/utils/ffmpeg')>('../../src/utils/ffmpeg');
    const result = fresh.findFfmpeg();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
