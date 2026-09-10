// 原型：把两个单轨标准 MP4（video-only / audio-only）做 box 级无损合并
// 不解码、不重编码、与 codec 无关（AVC/HEVC/AV1 通用），只搬 trak + 拼 mdat + 修 stco/co64
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FFPROBE = 'E:/dependency/ffmpeg/bin/ffprobe.exe';

function topBoxes(buf) {
  const out = []; let off = 0;
  while (off + 8 <= buf.length) {
    let size = readU32(buf, off);
    let hdr = 8;
    if (size === 1) { size = Number(readU64(buf, off + 8)); hdr = 16; }
    else if (size === 0) { size = buf.length - off; }
    if (size < 8 || off + size > buf.length) break;
    out.push({ type: ascii(buf, off + 4, 4), start: off, size, hdr, ps: off + hdr, pe: off + size });
    off += size;
  }
  return out;
}
function childBoxes(buf, start, end) {
  const out = []; let off = start;
  while (off + 8 <= end) {
    let size = readU32(buf, off); let hdr = 8;
    if (size === 1) { size = Number(readU64(buf, off + 8)); hdr = 16; }
    else if (size === 0) { size = end - off; }
    if (size < 8 || off + size > end) break;
    out.push({ type: ascii(buf, off + 4, 4), start: off, size, hdr, ps: off + hdr, pe: off + size });
    off += size;
  }
  return out;
}
function find(boxes, type) { return boxes.find(b => b.type === type); }
function findAll(boxes, type) { return boxes.filter(b => b.type === type); }
const readU32 = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
const readU64 = (b, o) => (BigInt(readU32(b, o)) << 32n) | BigInt(readU32(b, o + 4));
const readU16 = (b, o) => (b[o] << 8 | b[o + 1]) >>> 0;
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
function writeU32(b, o, v) { b[o] = v >>> 24 & 255; b[o + 1] = v >>> 16 & 255; b[o + 2] = v >>> 8 & 255; b[o + 3] = v & 255; }
function box(type, ...payloads) {
  const n = payloads.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(8 + n);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  writeU32(out, 0, 8 + n);
  let o = 8; for (const p of payloads) { out.set(p, o); o += p.length; }
  return out;
}

function parseMp4(file) {
  const buf = new Uint8Array(readFileSync(file));
  const tops = topBoxes(buf);
  const ftyp = find(tops, 'ftyp');
  const moov = find(tops, 'moov');
  const mdats = findAll(tops, 'mdat');
  if (!moov || mdats.length === 0) throw new Error(`${file}: 不是可合并的标准 MP4（缺 moov 或多/无 mdat）`);
  const mdatStart = mdats[0].ps;
  // 校验 mdat 连续
  let contiguous = true, cursor = mdats[0].pe;
  for (let i = 1; i < mdats.length; i++) { if (mdats[i].start !== cursor) contiguous = false; cursor = mdats[i].pe; }
  const mdatPayload = buf.subarray(mdatStart, cursor);
  const kids = childBoxes(buf, moov.ps, moov.pe);
  const mvhd = find(kids, 'mvhd');
  const traks = findAll(kids, 'trak').map(t => {
    const tk = childBoxes(buf, t.ps, t.pe);
    const tkhd = find(tk, 'tkhd');
    const mdia = find(tk, 'mdia');
    const mk = childBoxes(buf, mdia.ps, mdia.pe);
    const mdhd = find(mk, 'mdhd');
    const hdlr = find(mk, 'hdlr');
    const minf = find(mk, 'minf');
    const stbl = find(childBoxes(buf, minf.ps, minf.pe), 'stbl');
    const ver = buf[tkhd.ps];
    const trackId = readU32(buf, tkhd.ps + 4 + (ver === 1 ? 8 : 0) + 8); // version+flags(4) + [ctime(8)+mtime(8)] + trackID(4)
    const mver = buf[mdhd.ps];
    const timescale = readU32(buf, mdhd.ps + 4 + (mver === 1 ? 16 : 8));
    const duration = mver === 1 ? Number(readU64(buf, mdhd.ps + 4 + 20)) : readU32(buf, mdhd.ps + 4 + 12);
    return { ...t, tkhd, mdhd, stbl, trackId, timescale, duration, handler: ascii(buf, hdlr.ps + 8, 4) };
  });
  return { buf, ftyp, moov, kids, mvhd, traks, mdatStart, mdatPayload, contiguous, mdatCount: mdats.length };
}

function retagTrackId(src, trak, newId) {
  const out = src.slice(trak.start, trak.pe); // 整段 trak 副本
  const off = trak.tkhd.start - trak.start + 4 + (src[trak.tkhd.ps] === 1 ? 8 : 0) + 8;
  writeU32(out, off, newId);
  return out;
}

function shiftChunkOffsets(src, trak, delta) {
  const out = src.slice(trak.start, trak.pe);
  const stbl = trak.stbl;
  for (const kind of ['stco', 'co64']) {
    const b = find(childBoxes(src, stbl.ps, stbl.pe), kind);
    if (!b) continue;
    const n = readU32(src, b.ps + 4);
    const base = b.start - trak.start;
    for (let i = 0; i < n; i++) {
      const p = base + 16 + i * (kind === 'stco' ? 4 : 8); // header(8) + version/flags(4) + entry_count(4)
      if (kind === 'stco') writeU32(out, p, (readU32(out, p) + delta) >>> 0);
      else {
        const v = BigInt(readU32(out, p)) << 32n | BigInt(readU32(out, p + 4));
        const nv = v + BigInt(delta);
        writeU32(out, p, Number(nv >> 32n) >>> 0); writeU32(out, p + 4, Number(nv & 0xffffffffn) >>> 0);
      }
    }
  }
  return out;
}

export function mergeMp4Tracks(videoFile, audioFile, destFile) {
  const V = parseMp4(videoFile);
  const A = parseMp4(audioFile);
  if (!V.contiguous || !A.contiguous) throw new Error('多段非连续 mdat，暂不支持');

  const newTracks = [];
  // 视频轨保持 trackId=1（若不是 1 则重编号）
  const vTrak = V.traks.find(t => t.handler === 'vide') ?? V.traks[0];
  const aTrak = A.traks.find(t => t.handler === 'soun') ?? A.traks[0];
  newTracks.push(retagTrackId(V.buf, vTrak, 1));
  const audioId = vTrak.trackId === 2 ? 3 : 2;
  newTracks.push(retagTrackId(A.buf, aTrak, audioId));

  // 新 mvhd：timescale 取视频的，duration 取两者换算后的最大值
  const vMvhdTs = readU32(V.buf, V.mvhd.ps + 4 + (V.buf[V.mvhd.ps] === 1 ? 16 : 8));
  const aMvhdTs = readU32(A.buf, A.mvhd.ps + 4 + (A.buf[A.mvhd.ps] === 1 ? 16 : 8));
  const vMvhdDur = V.buf[V.mvhd.ps] === 1
    ? Number(readU64(V.buf, V.mvhd.ps + 4 + 20)) : readU32(V.buf, V.mvhd.ps + 4 + 12);
  const aMvhdDur = A.buf[A.mvhd.ps] === 1
    ? Number(readU64(A.buf, A.mvhd.ps + 4 + 20)) : readU32(A.buf, A.mvhd.ps + 4 + 12);
  const durSec = Math.max(vMvhdDur / vMvhdTs, aMvhdDur / aMvhdTs);
  const mvhd = V.buf.slice(V.mvhd.start, V.mvhd.pe);
  const mv = V.buf[V.mvhd.ps];
  const durOff = (V.mvhd.start - V.mvhd.start) + 8 + 4 + (mv === 1 ? 16 : 8) + (mv === 1 ? 8 : 0); // version/flags + timescale 后
  // 结构：version(1)flags(3) + [ctime(4) mtime(4)] + timescale(4) + duration(4|8)
  const dOff = 4 + (mv === 1 ? 16 : 8) + 4; // version/flags + [ctime/mtime] + timescale
  if (mv === 1) {
    const nv = BigInt(Math.round(durSec * vMvhdTs));
    writeU32(mvhd, 8 + dOff, Number(nv >> 32n) >>> 0); writeU32(mvhd, 8 + dOff + 4, Number(nv & 0xffffffffn) >>> 0);
  } else writeU32(mvhd, 8 + dOff, Math.round(durSec * vMvhdTs));
  void durOff;

  // 先占位算 moov 大小 → 决定 mdat 头大小 → 再定稿偏移
  const others = V.kids.filter(k => k.type !== 'mvhd' && k.type !== 'trak' && k.type !== 'mvex')
    .map(k => V.buf.slice(k.start, k.pe));
  const mdatPayloadLen = V.mdatPayload.length + A.mdatPayload.length;
  const mdatHdr = mdatPayloadLen + 8 > 0xffffffff ? 16 : 8;

  let moov = box('moov', mvhd, ...newTracks, ...others);
  let mdatPayloadStart = V.ftyp.size + moov.length + mdatHdr;
  const deltaV = mdatPayloadStart - V.mdatStart;
  const deltaA = mdatPayloadStart + V.mdatPayload.length - A.mdatStart;

  const fixed = [
    shiftChunkOffsets(V.buf, vTrak, deltaV),
    shiftChunkOffsets(A.buf, aTrak, deltaA),
  ];
  moov = box('moov', mvhd, ...fixed, ...others);
  mdatPayloadStart = V.ftyp.size + moov.length + mdatHdr;

  const out = new Uint8Array(V.ftyp.size + moov.length + mdatHdr + mdatPayloadLen);
  out.set(V.buf.subarray(V.ftyp.start, V.ftyp.pe), 0);
  out.set(moov, V.ftyp.size);
  let o = V.ftyp.size + moov.length;
  if (mdatHdr === 16) {
    writeU32(out, o, 1); for (let i = 0; i < 4; i++) out[o + 4 + i] = 'mdat'.charCodeAt(i);
    const total = BigInt(16 + mdatPayloadLen);
    writeU32(out, o + 8, Number(total >> 32n) >>> 0); writeU32(out, o + 12, Number(total & 0xffffffffn) >>> 0);
    o += 16;
  } else {
    writeU32(out, o, 8 + mdatPayloadLen);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = 'mdat'.charCodeAt(i);
    o += 8;
  }
  out.set(V.mdatPayload, o); o += V.mdatPayload.length;
  out.set(A.mdatPayload, o);
  writeFileSync(destFile, out);
  return out.length;
}

function probeJson(p) {
  try {
    const s = execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', p], { encoding: 'utf8' });
    const j = JSON.parse(s);
    return { fmt: j.format?.format_name, dur: Number(j.format?.duration).toFixed(2), size: j.format?.size,
      streams: (j.streams || []).map(x => `${x.codec_type}:${x.codec_name}${x.width ? ` ${x.width}x${x.height}` : ''}${x.sample_rate ? ` ${x.sample_rate}/${x.channels}ch` : ''} nb=${x.nb_frames ?? '?'}`) };
  } catch (e) { return { error: String(e.message).split('\n').slice(0, 3).join(' | ') }; }
}

// CLI 自检：node merge-mp4.mjs <video.mp4> <audio.mp4> <out.mp4>
if (process.argv[1] && process.argv[1].endsWith('merge-mp4.mjs')) {
  const [vf, af, dst] = process.argv.slice(2);
  if (!vf || !af || !dst) { console.log('usage: node merge-mp4.mjs <video.mp4> <audio.mp4> <out.mp4>'); process.exit(1); }
  const t0 = Date.now();
  const n = mergeMp4Tracks(vf, af, dst);
  console.log(`mergeMp4Tracks -> ${(n / 1024 / 1024).toFixed(2)}MB  ${Date.now() - t0}ms`);
  console.log('ffprobe(merged):', JSON.stringify(probeJson(dst)));
  try {
    execFileSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-xerror', '-i', dst, '-c', 'copy', '-f', 'null', '-'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('ffmpeg copy 校验: OK（无错误）');
  } catch (e) { console.log('ffmpeg copy 校验: FAIL', String(e.stderr || e.message).split('\n').slice(0, 5).join(' | ')); }
}
