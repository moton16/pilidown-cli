/**
 * pilidown - Unit tests for downloader
 * Original: tests are original to pilidown.
 */

import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPartitions,
  probeRangeSupport,
  downloadPart,
  mergeParts,
  downloadMultiThread,
} from '../../src/utils/downloader';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pilidown-dl-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe('createPartitions', () => {
  test('splits evenly with last part absorbing remainder', () => {
    const parts = createPartitions(1000, 3);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ index: 0, from: 0, to: 332 });
    expect(parts[1]).toEqual({ index: 1, from: 333, to: 665 });
    expect(parts[2]).toEqual({ index: 2, from: 666, to: 999 });
    // total coverage
    expect(parts[0].from).toBe(0);
    expect(parts[2].to).toBe(999);
  });

  test('single part covers whole range', () => {
    const parts = createPartitions(500, 1);
    expect(parts).toEqual([{ index: 0, from: 0, to: 499 }]);
  });

  test('empty size returns empty', () => {
    expect(createPartitions(0, 4)).toEqual([]);
  });

  test('numParts <= 0 is treated as 1', () => {
    const parts = createPartitions(100, 0);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ index: 0, from: 0, to: 99 });
  });

  test('more parts than bytes — produces tiny parts but covers whole range', () => {
    const parts = createPartitions(3, 5);
    expect(parts).toHaveLength(5);
    expect(parts[0].from).toBe(0);
    expect(parts[4].to).toBe(2);
  });
});

describe('probeRangeSupport', () => {
  test('parses Content-Range + Accept-Ranges', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(new Uint8Array([0]), {
        status: 206,
        headers: {
          'content-range': 'bytes 0-0/12345',
          'accept-ranges': 'bytes',
        },
      }),
    );
    const probe = await probeRangeSupport('https://test/x');
    expect(probe.size).toBe(12345);
    expect(probe.rangeAllowed).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.headers as Record<string, string>).toMatchObject({
      Range: 'bytes=0-0',
    });
  });

  test('falls back to content-length when content-range missing', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(new Uint8Array([0]), {
        status: 200,
        headers: { 'content-length': '9999' },
      }),
    );
    const probe = await probeRangeSupport('https://test/x');
    expect(probe.size).toBe(9999);
    expect(probe.rangeAllowed).toBe(false);
  });
});

describe('downloadPart + mergeParts', () => {
  test('downloads a byte range to a file and merges in order', async () => {
    const payload = Buffer.from('0123456789ABCDEF', 'utf8'); // 16 bytes
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const range = init.headers.Range as string;
      const m = /bytes=(\d+)-(\d+)/.exec(range);
      const from = Number(m![1]);
      const to = Number(m![2]);
      const slice = payload.subarray(from, to + 1);
      return new Response(slice, { status: 206 });
    });

    const partA = join(tmp, 'a.bin');
    const partB = join(tmp, 'b.bin');
    await downloadPart('https://test/x', { index: 0, from: 0, to: 7 }, partA, {});
    await downloadPart('https://test/x', { index: 1, from: 8, to: 15 }, partB, {});

    expect(statSync(partA).size).toBe(8);
    expect(statSync(partB).size).toBe(8);

    const dest = join(tmp, 'merged.bin');
    mergeParts([partA, partB], dest);
    expect(readFileSync(dest, 'utf8')).toBe('0123456789ABCDEF');
    // Temp files deleted after merge
    expect(existsSync(partA)).toBe(false);
    expect(existsSync(partB)).toBe(false);
  });

  test('mergeParts honors onDeleteTemp=false', () => {
    const a = join(tmp, 'a.bin');
    const b = join(tmp, 'b.bin');
    writeFileSync(a, 'AAA');
    writeFileSync(b, 'BBB');
    const dest = join(tmp, 'out.bin');
    mergeParts([a, b], dest, false);
    expect(readFileSync(dest, 'utf8')).toBe('AAABBB');
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
  });
});

describe('downloadMultiThread', () => {
  test('parallel partitions + merge yields full file', async () => {
    const payload = Buffer.from('0123456789ABCDEFGHIJ', 'utf8'); // 20 bytes
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      const range = init.headers.Range as string;
      const m = /bytes=(\d+)-(\d+)/.exec(range);
      const from = Number(m![1]);
      const to = Number(m![2]);
      return new Response(payload.subarray(from, to + 1), { status: 206 });
    });
    // Probe call returns content-range + accept-ranges
    // ponytail: first call is probe (Range bytes=0-0), returns content-range with full size
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      const range = init.headers.Range as string;
      if (range === 'bytes=0-0') {
        return new Response(new Uint8Array([0]), {
          status: 206,
          headers: { 'content-range': 'bytes 0-0/20', 'accept-ranges': 'bytes' },
        });
      }
      const m = /bytes=(\d+)-(\d+)/.exec(range);
      const from = Number(m![1]);
      const to = Number(m![2]);
      return new Response(payload.subarray(from, to + 1), { status: 206 });
    });

    const dest = join(tmp, 'out.bin');
    const result = await downloadMultiThread('https://test/x', dest, { threads: 4 });
    expect(result.totalBytes).toBe(20);
    expect(result.partitions).toBe(4);
    expect(readFileSync(dest, 'utf8')).toBe('0123456789ABCDEFGHIJ');
  });

  test('onProgress callback fires during download', async () => {
    const payload = Buffer.from('0123456789', 'utf8');
    let progressCalls = 0;
    let lastCurrent = 0;
    let lastTotal = 0;
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      const range = init.headers.Range as string;
      if (range === 'bytes=0-0') {
        return new Response(new Uint8Array([0]), {
          status: 206,
          headers: { 'content-range': 'bytes 0-0/10', 'accept-ranges': 'bytes' },
        });
      }
      const m = /bytes=(\d+)-(\d+)/.exec(range);
      const from = Number(m![1]);
      const to = Number(m![2]);
      return new Response(payload.subarray(from, to + 1), { status: 206 });
    });
    const dest = join(tmp, 'out.bin');
    await downloadMultiThread('https://test/x', dest, {
      threads: 2,
      onProgress: (cur, total) => {
        progressCalls++;
        lastCurrent = cur;
        lastTotal = total;
      },
    });
    expect(progressCalls).toBeGreaterThan(0);
    expect(lastTotal).toBe(10);
    expect(lastCurrent).toBe(10);
  });
});
