/**
 * Unit tests for src/utils/mp4.ts and progressive MP4 merger
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMp4, mergeProgressiveMp4 } from '../../src/utils/mp4';
import { mergeDashStreamsProgressive } from '../../src/utils/media';
import { createBox, topBoxes, childBoxes, find, findAll, readU32 } from '../../src/utils/box';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pilidown-mp4-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// Helper to construct synthetic progressive MP4 files for testing
function buildMockMp4(trackType: 'vide' | 'soun', trackId: number, duration: number, mdatData: Buffer): Buffer {
  const ftyp = createBox('ftyp', Buffer.from('isomiso2mp41', 'latin1'));

  // mvhd (v0: size 108)
  const mvhdPayload = Buffer.alloc(100);
  mvhdPayload.writeUInt32BE(1000, 12); // timescale = 1000
  mvhdPayload.writeUInt32BE(duration, 16); // duration
  const mvhd = createBox('mvhd', mvhdPayload);

  // tkhd (v0: size 84)
  const tkhdPayload = Buffer.alloc(84);
  tkhdPayload.writeUInt32BE(trackId, 12); // trackId at offset 12 in payload (after 4-byte version/flags + 8-byte ctime/mtime)
  const tkhd = createBox('tkhd', tkhdPayload);

  // mdhd (v0: size 24)
  const mdhdPayload = Buffer.alloc(24);
  mdhdPayload.writeUInt32BE(1000, 12); // timescale = 1000
  mdhdPayload.writeUInt32BE(duration, 16); // duration
  const mdhd = createBox('mdhd', mdhdPayload);

  // hdlr
  const hdlrPayload = Buffer.alloc(25);
  hdlrPayload.write(trackType, 8, 'latin1');
  const hdlr = createBox('hdlr', hdlrPayload);

  // stco (1 entry: version/flags(4) + count(4) + offset(4))
  const stcoPayload = Buffer.alloc(12);
  stcoPayload.writeUInt32BE(1, 4); // 1 entry
  stcoPayload.writeUInt32BE(100, 8); // chunk offset = 100
  const stco = createBox('stco', stcoPayload);

  const stbl = createBox('stbl', stco);
  const minf = createBox('minf', stbl);
  const mdia = createBox('mdia', mdhd, hdlr, minf);
  const trak = createBox('trak', tkhd, mdia);

  const moov = createBox('moov', mvhd, trak);
  const mdat = createBox('mdat', mdatData);

  return Buffer.concat([ftyp, moov, mdat]);
}

describe('parseMp4', () => {
  test('correctly parses ftyp, moov, tracks, and mdat', () => {
    const data = buildMockMp4('vide', 1, 5000, Buffer.from('VIDEO_PAYLOAD'));
    const parsed = parseMp4(data, 'test.mp4');

    expect(parsed.ftyp.type).toBe('ftyp');
    expect(parsed.moov.type).toBe('moov');
    expect(parsed.traks).toHaveLength(1);
    expect(parsed.traks[0].handler).toBe('vide');
    expect(parsed.traks[0].trackId).toBe(1);
    expect(parsed.traks[0].duration).toBe(5000);
    expect(parsed.mdatPayloadLen).toBe(Buffer.from('VIDEO_PAYLOAD').length);
  });
});

describe('mergeProgressiveMp4', () => {
  test('merges video and audio tracks with renumbering and offset adjustments', async () => {
    const vBuf = buildMockMp4('vide', 1, 6000, Buffer.from('V_DATA_12345'));
    const aBuf = buildMockMp4('soun', 1, 4000, Buffer.from('A_DATA_67890'));

    const vPath = join(tmp, 'v.mp4');
    const aPath = join(tmp, 'a.mp4');
    const outPath = join(tmp, 'merged.mp4');

    writeFileSync(vPath, vBuf);
    writeFileSync(aPath, aBuf);

    await mergeProgressiveMp4(vPath, aPath, outPath);

    const mergedBuf = readFileSync(outPath);
    const parsed = parseMp4(mergedBuf, outPath);

    expect(parsed.traks).toHaveLength(2);
    expect(parsed.traks[0].handler).toBe('vide');
    expect(parsed.traks[0].trackId).toBe(1);
    expect(parsed.traks[1].handler).toBe('soun');
    expect(parsed.traks[1].trackId).toBe(2);

    // Duration should be max duration (6000)
    const mvhdVer = mergedBuf[parsed.mvhd.ps];
    const dur = readU32(mergedBuf, parsed.mvhd.ps + 4 + (mvhdVer === 1 ? 16 : 8) + 4);
    expect(dur).toBe(6000);

    // mdat should contain both payloads
    const payload = mergedBuf.subarray(parsed.mdatStart, parsed.mdatStart + parsed.mdatPayloadLen);
    expect(payload.toString()).toBe('V_DATA_12345A_DATA_67890');
  });
});

describe('mergeDashStreamsProgressive memory guard', () => {
  test('triggers memory guard error when estimated memory exceeds limit', async () => {
    const vPath = join(tmp, 'big_v.mp4');
    const aPath = join(tmp, 'big_a.mp4');
    const outPath = join(tmp, 'out.mp4');

    // Create 2MB files -> 4MB input * 5 = 20MB estimated peak
    writeFileSync(vPath, Buffer.alloc(2 * 1024 * 1024));
    writeFileSync(aPath, Buffer.alloc(2 * 1024 * 1024));

    // Limit to 10MB
    await expect(
      mergeDashStreamsProgressive(vPath, aPath, outPath, { maxMediaMemMb: 10 }),
    ).rejects.toThrow('--container mp4 memory guard exceeded');
  });
});

describe('box parsing guards', () => {
  test('handles 64-bit box size < 16 gracefully without negative payload', () => {
    // 64-bit box with size=12 (< 16 hdr)
    const buf = Buffer.alloc(24);
    buf.writeUInt32BE(1, 0); // size = 1 (64-bit)
    buf.write('test', 4, 'latin1');
    buf.writeBigUInt64BE(12n, 8); // 64-bit size = 12
    const boxes = topBoxes(buf);
    expect(boxes).toHaveLength(0);
  });
});
