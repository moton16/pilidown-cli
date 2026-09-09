import { getVideoInfo, getPlayUrl } from '../src/api/VideoApi';

async function inspect(bvid: string) {
  const info = await getVideoInfo({ bvid });
  const cid = info.pages[0]?.cid ?? info.cid;
  console.log(`\n=== ${bvid} | ${info.title} | cid=${cid} | duration=${info.duration}s ===`);

  // 1) 默认 DASH 请求
  for (const qn of [80, 64, 32]) {
    const resp = await getPlayUrl({ bvid, cid, qn, fnval: 4048 });
    const durl = (resp as any).durl as any[] | undefined;
    console.log(`qn=${qn} fnval=4048 -> quality=${resp.quality}, dash.video=${resp.dash?.video?.length ?? 0}, dash.audio=${resp.dash?.audio?.length ?? 0}, durl=${durl?.length ?? 0}`);
    if (durl?.length) {
      console.log(`  durl[0] size=${durl[0].size} bytes, length=${durl[0].length}ms, url=${(durl[0].url as string).slice(0, 80)}...`);
    }
  }

  // 2) html5 平台请求
  for (const qn of [80, 64]) {
    const resp = await getPlayUrl({ bvid, cid, qn, fnval: 4048, platform: 'html5' });
    const durl = (resp as any).durl as any[] | undefined;
    console.log(`qn=${qn} platform=html5 -> quality=${resp.quality}, dash.video=${resp.dash?.video?.length ?? 0}, dash.audio=${resp.dash?.audio?.length ?? 0}, durl=${durl?.length ?? 0}`);
    if (durl?.length) {
      console.log(`  durl[0] size=${durl[0].size} bytes, length=${durl[0].length}ms`);
    }
  }

  // 3) 纯 MP4 请求
  const respMp4 = await getPlayUrl({ bvid, cid, qn: 80, fnval: 1 });
  const durlMp4 = (respMp4 as any).durl as any[] | undefined;
  console.log(`qn=80 fnval=1 (MP4) -> quality=${respMp4.quality}, dash.video=${respMp4.dash?.video?.length ?? 0}, durl=${durlMp4?.length ?? 0}`);
  if (durlMp4?.length) {
    console.log(`  durl[0] size=${durlMp4[0].size} bytes`);
  }
}

async function main() {
  for (const bvid of ['BV1Rz7Q6EEyV', 'BV1knNj6hEKU', 'BV1ME3j6sEmc', 'BV1D4f5BTEE8']) {
    try {
      await inspect(bvid);
    } catch (err) {
      console.log(`\n=== ${bvid} ERROR: ${(err as Error).message} ===`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
