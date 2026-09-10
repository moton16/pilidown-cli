/**
 * Tests for src/utils/fmp4.ts — fMP4 passthrough merge.
 *
 * Fixtures are hand-built minimal fMP4 buffers (valid box structure, fake
 * payload bytes) — the merge is a pure structural operation, so structural
 * assertions are sufficient and no ffmpeg is needed in CI.
 *
 * Two tfhd shapes are covered (both seen in the wild):
 *  - ffmpeg shape: flags=0x39 → explicit base_data_offset, needs trun correction
 *  - Bilibili shape: flags=0x20038 → default-base-is-moof already set
 */

import { mergeFmp4, rebuildTfhd, trunDataOffsetPositions, rebuildMoof } from '../../src/utils/fmp4';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// box-building helpers
// ---------------------------------------------------------------------------

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function fullBox(type: string, version: number, flags: number, ...payload: Buffer[]): Buffer {
  const vf = Buffer.alloc(4);
  vf.writeUInt8(version, 0);
  vf.writeUIntBE(flags, 1, 3);
  return box(type, vf, ...payload);
}

function u32(v: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; }
function i32(v: number): Buffer { const b = Buffer.alloc(4); b.writeInt32BE(v); return b; }
function u64(v: number): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(v)); return b; }

function ftyp(): Buffer {
  return box('ftyp', Buffer.from('isomiso2avc1mp41', 'latin1'));
}

function mvhd(timescale: number, duration: number): Buffer {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(timescale, 12); // v0: ctime(4) mtime(4) timescale(4) duration(4)
  b.writeUInt32BE(duration, 16);
  return fullBox('mvhd', 0, 0, b);
}

function trak(trackId: number): Buffer {
  const tkhd = Buffer.alloc(20);
  tkhd.writeUInt32BE(trackId, 12); // fullbox(4)+ctime(4)+mtime(4) → trackID at 12
  return box('trak', fullBox('tkhd', 0, 3, tkhd));
}

function trex(trackId: number): Buffer {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(trackId, 4);
  b.writeUInt32BE(1, 8);
  b.writeUInt32BE(1024, 12);
  return fullBox('trex', 0, 0, b);
}

interface FragOpts {
  seq: number;
  trackId: number;
  /** tfhd flags; default ffmpeg-style explicit base (0x39) */
  tfhdFlags?: number;
  payload: Buffer;
}

/** Build a single-track fMP4 with one fragment; tfhd base and trun data_offset are self-consistent. */
function singleTrackFmp4(o: FragOpts): Buffer {
  const flags = o.tfhdFlags ?? 0x39;
  const ftypBox = ftyp();
  const moovBox = box('moov', mvhd(1000, 1000), trak(o.trackId), box('mvex', trex(o.trackId)));
  const moofStart = ftypBox.length + moovBox.length;

  // compute moof size up front so data_offset can point at the mdat payload start
  // NOTE: 0x39 = base|dur|size|defFlags — the 0x10 (default_sample_size) field IS present
  const tfhdSize =
    8 + 4 + 4 + (flags & 0x1 ? 8 : 0) + (flags & 0x8 ? 4 : 0) + (flags & 0x10 ? 4 : 0) + (flags & 0x20 ? 4 : 0);
  const trunSize = 8 + 4 + 4 + 4 + 4; // hdr + verflags + sample_count + data_offset + sample_size
  const moofSize = 8 + 16 + 8 + tfhdSize + trunSize; // moof hdr + mfhd + traf hdr + children
  const dataOffset = moofSize + 8; // base(=moof start) → mdat payload start

  const tfhdPayload: Buffer[] = [u32(o.trackId)];
  if (flags & 0x1) tfhdPayload.push(u64(moofStart)); // base = moof's own offset
  if (flags & 0x8) tfhdPayload.push(u32(1024));
  if (flags & 0x10) tfhdPayload.push(u32(0));
  if (flags & 0x20) tfhdPayload.push(u32(0x01000000));
  const tfhd = fullBox('tfhd', 0, flags, ...tfhdPayload);
  const trun = fullBox('trun', 0, 0x1, u32(1), i32(dataOffset), u32(o.payload.length));
  const moofBox = box('moof', fullBox('mfhd', 0, 0, u32(o.seq)), box('traf', tfhd, trun));
  const mdat = box('mdat', o.payload);
  return Buffer.concat([ftypBox, moovBox, moofBox, mdat]);
}

// ---------------------------------------------------------------------------
// unit tests: box rewriters
// ---------------------------------------------------------------------------

describe('fmp4: rebuildTfhd', () => {
  it('drops explicit base_data_offset and forces default-base-is-moof (ffmpeg shape)', () => {
    const tfhd = fullBox('tfhd', 0, 0x39, u32(1), u64(12345), u32(1024), u32(0x01000000));
    const { box: out, baseOffset } = rebuildTfhd(tfhd, 0, tfhd.length, 2);
    expect(baseOffset).toBe(12345);
    expect(out.readUInt32BE(0)).toBe(out.length);
    expect(out.toString('latin1', 4, 8)).toBe('tfhd');
    const flags = out.readUInt32BE(8) & 0xffffff;
    expect(flags & 0x020000).toBe(0x020000); // default-base-is-moof forced
    expect(flags & 0x1).toBe(0); // explicit base flag cleared
    expect(out.readUInt32BE(12)).toBe(2); // trackID rewritten
    expect(out.length).toBe(tfhd.length - 8); // base field (8 bytes) removed
    expect(out.readUInt32BE(16)).toBe(1024); // default_sample_duration preserved
    expect(out.readUInt32BE(20)).toBe(0x01000000); // default_sample_flags preserved
  });

  it('leaves a base-is-moof tfhd untouched in size (Bilibili shape)', () => {
    const tfhd = fullBox('tfhd', 0, 0x20038, u32(1), u32(1024), u32(0x01000000));
    const { box: out, baseOffset } = rebuildTfhd(tfhd, 0, tfhd.length, 1);
    expect(baseOffset).toBeNull();
    expect(out.length).toBe(tfhd.length);
    expect(out.readUInt32BE(12)).toBe(1);
    expect((out.readUInt32BE(8) & 0xffffff) & 0x020000).toBe(0x020000);
  });
});

describe('fmp4: trunDataOffsetPositions', () => {
  it('finds data_offset fields inside moof', () => {
    const trun = fullBox('trun', 0, 0x1, u32(1), i32(100), u32(4));
    const moof = box('moof', fullBox('mfhd', 0, 0, u32(1)), box('traf', trun));
    const positions = trunDataOffsetPositions(moof, moof.length);
    expect(positions).toHaveLength(1);
    expect(moof.readInt32BE(positions[0])).toBe(100);
  });

  it('throws when trun lacks data_offset', () => {
    const trun = fullBox('trun', 0, 0x0, u32(1), u32(4));
    const moof = box('moof', box('traf', trun));
    expect(() => trunDataOffsetPositions(moof, moof.length)).toThrow(/data_offset/);
  });
});

describe('fmp4: rebuildMoof', () => {
  it('reports hadBase only when explicit base_data_offset is present', () => {
    const ffmpegMoof = box('moof',
      fullBox('mfhd', 0, 0, u32(1)),
      box('traf', fullBox('tfhd', 0, 0x39, u32(1), u64(500), u32(1024)), fullBox('trun', 0, 0x1, u32(1), i32(904), u32(4))));
    const r1 = rebuildMoof(ffmpegMoof, 1);
    expect(r1.hadBase).toBe(true);
    expect(r1.baseOffset).toBe(500);
    expect(r1.buf.readUInt32BE(0)).toBe(r1.buf.length);

    const biliMoof = box('moof',
      fullBox('mfhd', 0, 0, u32(1)),
      box('traf', fullBox('tfhd', 0, 0x20038, u32(1), u32(1024)), fullBox('trun', 0, 0x1, u32(1), i32(904), u32(4))));
    const r2 = rebuildMoof(biliMoof, 2);
    // regression guard: "has tfhd" must NOT imply "has base" (this exact bug
    // produced Invalid NAL unit size against real Bilibili streams)
    expect(r2.hadBase).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// integration: merge two single-track fMP4 files
// ---------------------------------------------------------------------------

describe('fmp4: mergeFmp4 (integration)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pilidown-fmp4-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  interface TopBox { type: string; size: number; start: number }

  function topBoxes(b: Buffer): TopBox[] {
    const out: TopBox[] = [];
    let off = 0;
    while (off + 8 <= b.length) {
      let sz = b.readUInt32BE(off);
      if (sz === 1) sz = Number(b.readBigUInt64BE(off + 8));
      if (sz < 8) break;
      out.push({ type: b.toString('latin1', off + 4, off + 8), size: sz, start: off });
      off += sz;
    }
    return out;
  }

  it('merges ffmpeg-shape (explicit base) tracks with corrected data_offsets', async () => {
    const vPayload = Buffer.alloc(64, 0xaa);
    const aPayload = Buffer.alloc(32, 0xbb);
    const v = singleTrackFmp4({ seq: 1, trackId: 1, payload: vPayload });
    const a = singleTrackFmp4({ seq: 1, trackId: 1, payload: aPayload });
    const vPath = join(dir, 'v.m4v'), aPath = join(dir, 'a.m4a'), out = join(dir, 'out.mp4');
    writeFileSync(vPath, v);
    writeFileSync(aPath, a);

    await mergeFmp4(vPath, aPath, out);

    const b = readFileSync(out);
    const boxes = topBoxes(b);
    expect(boxes.map(x => x.type)).toEqual(['ftyp', 'moov', 'moof', 'mdat', 'moof', 'mdat']);

    // each output trun data_offset must equal outMoofSize + mdatHeader(8)
    for (const m of boxes.filter(x => x.type === 'moof')) {
      const moofBuf = b.subarray(m.start, m.start + m.size);
      const pos = trunDataOffsetPositions(moofBuf, moofBuf.length)[0] + m.start;
      expect(b.readInt32BE(pos)).toBe(m.size + 8);
    }
    // payload bytes preserved verbatim
    const [vMdat, aMdat] = boxes.filter(x => x.type === 'mdat');
    expect(b.subarray(vMdat.start + 8, vMdat.start + vMdat.size)).toEqual(vPayload);
    expect(b.subarray(aMdat.start + 8, aMdat.start + aMdat.size)).toEqual(aPayload);
    // no .part leftover
    expect(topBoxes(b).length).toBe(6);
  });

  it('merges Bilibili-shape (default-base-is-moof) tracks with offsets untouched', async () => {
    const vPayload = Buffer.alloc(64, 0xaa);
    const aPayload = Buffer.alloc(32, 0xbb);
    const v = singleTrackFmp4({ seq: 1, trackId: 1, tfhdFlags: 0x20038, payload: vPayload });
    const a = singleTrackFmp4({ seq: 1, trackId: 1, tfhdFlags: 0x20038, payload: aPayload });
    const vPath = join(dir, 'v.m4v'), aPath = join(dir, 'a.m4a'), out = join(dir, 'out.mp4');
    writeFileSync(vPath, v);
    writeFileSync(aPath, a);

    await mergeFmp4(vPath, aPath, out);

    const b = readFileSync(out);
    const boxes = topBoxes(b);
    const moofs = boxes.filter(x => x.type === 'moof');
    expect(moofs).toHaveLength(2);
    // moof moved with its mdat → data_offset (relative to moof start) preserved
    for (const m of moofs) {
      const moofBuf = b.subarray(m.start, m.start + m.size);
      const pos = trunDataOffsetPositions(moofBuf, moofBuf.length)[0] + m.start;
      // must equal the source fixture's dataOffset = moofSize + 8
      expect(b.readInt32BE(pos)).toBe(84 + 8);
    }
    const mdats = boxes.filter(x => x.type === 'mdat');
    expect(b.subarray(mdats[0].start + 8, mdats[0].start + mdats[0].size)).toEqual(vPayload);
    expect(b.subarray(mdats[1].start + 8, mdats[1].start + mdats[1].size)).toEqual(aPayload);
  });

  it('rejects non-fMP4 input with a clear error', async () => {
    const vPath = join(dir, 'bad.m4v');
    writeFileSync(vPath, Buffer.from('this is not an mp4 at all'));
    const a = singleTrackFmp4({ seq: 1, trackId: 1, tfhdFlags: 0x20038, payload: Buffer.alloc(16) });
    const aPath = join(dir, 'a.m4a');
    writeFileSync(aPath, a);
    await expect(mergeFmp4(vPath, aPath, join(dir, 'out.mp4'))).rejects.toThrow(/not a single-track fMP4/);
  });

  it('renumbers track IDs 1/2 in tkhd and trex', async () => {
    const v = singleTrackFmp4({ seq: 1, trackId: 1, tfhdFlags: 0x20038, payload: Buffer.alloc(16) });
    const a = singleTrackFmp4({ seq: 1, trackId: 1, tfhdFlags: 0x20038, payload: Buffer.alloc(16) });
    const vPath = join(dir, 'v.m4v'), aPath = join(dir, 'a.m4a'), out = join(dir, 'out.mp4');
    writeFileSync(vPath, v);
    writeFileSync(aPath, a);
    await mergeFmp4(vPath, aPath, out);

    const b = readFileSync(out);
    const moov = topBoxes(b).find(x => x.type === 'moov')!;
    const moovBuf = b.subarray(moov.start, moov.start + moov.size);
    // two tkhd: trackID at (moov+8 tkhd offset 20)
    const tkhds: number[] = [];
    let trexSeen = 0;
    let o = 8;
    while (o + 8 <= moovBuf.length) {
      const sz = moovBuf.readUInt32BE(o);
      const t = moovBuf.toString('latin1', o + 4, o + 8);
      if (t === 'trak') {
        // tkhd: trak+8 → fullbox(4)+ctime(4)+mtime(4) → trackID at trak+20 = o+20
        tkhds.push(moovBuf.readUInt32BE(o + 20));
      }
      if (t === 'mvex') {
        // find trex inside mvex: mvex+8 is trex header, trackID at mvex+8+12
        expect(moovBuf.readUInt32BE(o + 8 + 12)).toBe(trexSeen === 0 ? 1 : 2);
        trexSeen++;
      }
      o += sz;
    }
    expect(tkhds).toEqual([1, 2]);
  });
});
