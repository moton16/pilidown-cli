// 原型：偏移直写 + 清单续传（替代 tempDir + 分片文件 + 同步 mergeParts）
// 用本地 Range 服务器验证：字节一致性 / 断点续传 / Content-Range 篡改能否被检出
import { createServer } from 'node:http';
import { open, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const SIZE = 5 * 1024 * 1024;
const PAYLOAD = randomBytes(SIZE);
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');
console.log('payload', SIZE, 'bytes sha256', SHA.slice(0, 16));

// ---- 假装是 CDN：支持 Range，但可以按需"说谎" ----
let lieRange = false;     // 回了 206，但 Content-Range 起始偏移撒谎
let ignoreRange = false;  // 完全忽略 Range，回 200 + 整个文件
let failParts = new Set(); // 这些分片的前 N 次请求直接 500
const failCount = new Map();
const server = createServer((req, res) => {
  const key = req.url;
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  if (!m) { res.writeHead(200, { 'content-length': SIZE }); res.end(PAYLOAD); return; }
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : SIZE - 1;
  const partKey = `${from}-${to}`;
  if (failParts.has(partKey) && (failCount.get(partKey) ?? 0) < 2) {
    failCount.set(partKey, (failCount.get(partKey) ?? 0) + 1);
    res.writeHead(500); res.end('boom'); return;
  }
  if (ignoreRange) { res.writeHead(200, { 'content-length': SIZE }); res.end(PAYLOAD); return; }
  const start = lieRange ? from + 7 : from;
  const body = PAYLOAD.subarray(start, to + 1);
  res.writeHead(206, {
    'content-range': `bytes ${start}-${to}/${SIZE}`,
    'accept-ranges': 'bytes',
    'content-length': String(body.length),
  });
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/x`;
console.log('server', URL_);

// ---- 待验证的下载实现 ----
function parts(size, n) {
  const ps = Math.floor(size / n), out = [];
  for (let i = 0; i < n; i++) out.push({ i, from: i * ps, to: i === n - 1 ? size - 1 : i * ps + ps - 1 });
  return out;
}

async function probe(url) {
  const r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  const size = Number(r.headers.get('content-range')?.split('/')?.[1]);
  await r.arrayBuffer().catch(() => {});
  return { size, rangeAllowed: r.status === 206 && (r.headers.get('accept-ranges') ?? '') === 'bytes' };
}

/** 单分片下载：从 from+done 续，校验 Content-Range 起始偏移，逐块 pwrite。 */
async function fetchPart(url, part, fh, done, onBytes) {
  const start = part.from + done;
  if (start > part.to) return done;
  const ac = new AbortController();
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${part.to}` }, signal: ac.signal });
  if (r.status === 200) {
    // 服务器忽略 Range → 只能从 0 重写整个分片
    throw new Error(`server ignored Range (200) for part ${part.i} — must restart part from 0`);
  }
  if (r.status !== 206) throw new Error(`HTTP ${r.status} on part ${part.i} range ${start}-${part.to}`);
  const cr = r.headers.get('content-range'); // 必须校验，否则静默错位
  const cm = /bytes (\d+)-(\d+)\//.exec(cr ?? '');
  if (!cm || Number(cm[1]) !== start) {
    throw new Error(`Content-Range mismatch on part ${part.i}: requested ${start}, got ${cr}`);
  }
  let pos = start;
  for await (const chunk of Readable.fromWeb(r.body)) {
    const n = chunk.length;
    await fh.write(chunk, 0, n, pos);   // 偏移写，不走文件游标
    pos += n;
    onBytes(n);
  }
  return pos - part.from;
}

/** 偏移直写 + 清单；失败保留 .part + .partstate；成功 rename。 */
async function download(url, dest, { threads = 4, resume = true, maxTries = 4 } = {}) {
  const { size, rangeAllowed } = await probe(url);
  if (!rangeAllowed) throw new Error('no range support');
  const plan = parts(size, threads);
  const partPath = `${dest}.part`;
  const statePath = `${dest}.partstate.json`;
  let state = { v: 1, size, done: plan.map(() => 0) };
  if (resume && existsSync(statePath) && existsSync(partPath)) {
    const prev = JSON.parse(readFileSync(statePath, 'utf8'));
    if (prev.v === 1 && prev.size === size && prev.done?.length === plan.length) {
      state = prev;
      console.log('  [resume] 已续传进度', state.done.join('/'), '累计', state.done.reduce((a, b) => a + b, 0));
    }
  } else {
    await rm(partPath, { force: true });
  }
  // Windows 上 'a+' 不允许 ftruncate（EPERM），必须用 'r+' 且文件需先存在
  let fh;
  try { fh = await open(partPath, 'r+'); }
  catch (e) { if (e.code === 'ENOENT') fh = await open(partPath, 'w+'); else throw e; }
  try { await fh.truncate(size); } catch { /* 预分配是优化，失败也能正确写入 */ }
  let total = state.done.reduce((a, b) => a + b, 0);
  let lastSave = Date.now();
  const saveState = async (force = false) => {
    if (!force && Date.now() - lastSave < 300) return;
    lastSave = Date.now();
    const sh = await open(statePath, 'w');
    await sh.writeFile(JSON.stringify(state));
    await sh.close();
  };
  try {
    await Promise.all(plan.map(async (p) => {
      let tries = 0;
      for (;;) {
        try {
          const at = state.done[p.i];
          const got = await fetchPart(url, p, fh, at, (n) => { total += n; });
          state.done[p.i] = got;   // got 是"该分片已完成的字节数"
          await saveState(true);
          return;
        } catch (e) {
          if (++tries >= maxTries) throw e;
          await new Promise(r => setTimeout(r, 50 * tries));  // 退避
        }
      }
    }));
    await fh.sync();          // 落盘后再改名，防断电空洞
    await fh.close();
    const sum = state.done.reduce((a, b) => a + b, 0);
    if (sum !== size) throw new Error(`incomplete: ${sum}/${size}`);
    const { rename } = await import('node:fs/promises');
    await rename(partPath, dest);
    await rm(statePath, { force: true });
    return { bytes: total };
  } catch (e) {
    await fh.close().catch(() => {});
    await saveState(true);
    throw new Error(`${e.message}\n  → 已保留 ${partPath} 与 ${statePath}，重跑同一条命令会从断点继续`);
  }
}

const OUT = 'E:/Softwares/WorkCache/2026-09-09-20-07-52/probe5';
const dest = `${OUT}/out.bin`;
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');

console.log('\n=== 用例1：正常下载 4 分片 ===');
await rm(dest, { force: true }); await rm(dest + '.part', { force: true }); await rm(dest + '.partstate.json', { force: true });
let t = Date.now();
await download(URL_, dest, { threads: 4 });
console.log(' 用时', Date.now() - t, 'ms  大小', statSync(dest).size, ' sha匹配:', sha(dest) === SHA);
console.log(' 残留 .part:', existsSync(dest + '.part'), ' .partstate:', existsSync(dest + '.partstate.json'));

console.log('\n=== 用例2：中途 2 个分片连续 500，观察重试 ===');
await rm(dest, { force: true }); await rm(dest + '.part', { force: true }); await rm(dest + '.partstate.json', { force: true });
failCount.clear();
const plan4 = parts(SIZE, 4);
failParts = new Set([`${plan4[1].from}-${plan4[1].to}`, `${plan4[3].from}-${plan4[3].to}`]);
t = Date.now();
await download(URL_, dest, { threads: 4 });
console.log(' 用时', Date.now() - t, 'ms  sha匹配:', sha(dest) === SHA, ' 重试次数:', [...failCount.values()].join(','));
failParts = new Set();

console.log('\n=== 用例3：跨进程续传（先下 1 个分片就中断，再跑一次） ===');
await rm(dest, { force: true }); await rm(dest + '.part', { force: true }); await rm(dest + '.partstate.json', { force: true });
// 人为造一个"上次断在分片0半途"的状态
{
  const fh0 = await open(dest + '.part', 'r+').catch(() => open(dest + '.part', 'w+'));
  try { await fh0.truncate(SIZE); } catch {}
  const half = Math.floor(plan4[0].to / 2);
  await fh0.write(PAYLOAD.subarray(0, half + 1), 0, half + 1, 0);
  await fh0.sync(); await fh0.close();
  { const sh = await open(dest + '.partstate.json', 'w');
    await sh.writeFile(JSON.stringify({ v: 1, size: SIZE, done: [half + 1, 0, 0, 0] }));
    await sh.close(); }
}
await download(URL_, dest, { threads: 4 });
console.log(' 续传后 sha匹配:', sha(dest) === SHA, '（分片0 前半段是上次写的）');

console.log('\n=== 用例4：Content-Range 撒谎（起始偏移 +7）能否被检出 ===');
await rm(dest, { force: true }); await rm(dest + '.part', { force: true }); await rm(dest + '.partstate.json', { force: true });
lieRange = true;
try { await download(URL_, dest, { threads: 4, resume: false }); console.log(' ❌ 未被发现——会静默产出错位数据'); }
catch (e) { console.log(' ✅ 被检出:', String(e.message).split('\n')[0]); }
lieRange = false;

console.log('\n=== 用例5：服务器忽略 Range（回 200） ===');
await rm(dest, { force: true }); await rm(dest + '.part', { force: true }); await rm(dest + '.partstate.json', { force: true });
ignoreRange = true;
try { await download(URL_, dest, { threads: 4, resume: false }); console.log(' ❌ 未检出'); }
catch (e) { console.log(' ✅ 被检出:', String(e.message).split('\n')[0]); }
ignoreRange = false;

server.close();
console.log('\n完成。');
