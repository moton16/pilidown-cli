"use strict";

// src/types/errors.ts
var BiliApiError = class extends Error {
  constructor(code, message, apiUrl, hint) {
    super(message);
    this.code = code;
    this.apiUrl = apiUrl;
    this.hint = hint;
    this.name = "BiliApiError";
  }
};
var NetworkError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "NetworkError";
  }
};
var FileSystemError = class extends Error {
  constructor(message, path, cause) {
    super(message);
    this.path = path;
    this.cause = cause;
    this.name = "FileSystemError";
  }
};
var BILI_CODE_NEED_LOGIN = -352;

// src/services/CookieService.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_os = require("node:os");
var DEFAULT_COOKIE_DIR = (0, import_node_path.join)((0, import_node_os.homedir)(), ".pilidown");
var DEFAULT_COOKIE_PATH = (0, import_node_path.join)(DEFAULT_COOKIE_DIR, "cookies.json");
function loadCookies(filePath) {
  const path = filePath ?? DEFAULT_COOKIE_PATH;
  if (!(0, import_node_fs.existsSync)(path)) return { cookies: {} };
  try {
    const content = (0, import_node_fs.readFileSync)(path, "utf8");
    const data = JSON.parse(content);
    return { cookies: data.cookies ?? {}, refresh_token: data.refresh_token, savedAt: data.savedAt };
  } catch (err) {
    throw new FileSystemError(`Failed to load cookies from ${path}`, path, err);
  }
}

// src/utils/httpClient.ts
var DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var DEFAULT_TIMEOUT = 3e4;
var DEFAULT_RETRIES = 3;
var cachedBuvid3;
async function ensureBuvid3() {
  if (cachedBuvid3) return cachedBuvid3;
  const resp = await fetch("https://www.bilibili.com/", {
    headers: { "User-Agent": DEFAULT_UA },
    redirect: "manual"
  });
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const m = sc.match(/^buvid3=([^;]+)/);
    if (m) {
      cachedBuvid3 = m[1];
      return cachedBuvid3;
    }
  }
  throw new NetworkError("Failed to obtain buvid3 from bilibili.com");
}
function mergeBuvid3(cookies) {
  if (!cachedBuvid3) return cookies;
  if (!cookies) return { buvid3: cachedBuvid3 };
  if (cookies.buvid3) return cookies;
  return { ...cookies, buvid3: cachedBuvid3 };
}
async function httpRequest(url, options = {}) {
  const { method = "GET", headers = {}, cookies, timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES, body } = options;
  const finalHeaders = {
    "User-Agent": DEFAULT_UA,
    "Referer": "https://www.bilibili.com/",
    ...headers
  };
  if (cookies && Object.keys(cookies).length > 0) {
    finalHeaders["Cookie"] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(url, { method, headers: finalHeaders, body, signal: controller.signal });
      clearTimeout(timer);
      if (resp.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      const data = await resp.json();
      return { data, headers: resp.headers, status: resp.status };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    }
  }
  throw new NetworkError(`HTTP ${method} ${url} failed after ${retries + 1} attempts`, lastErr);
}
async function biliGet(url, options) {
  let mergedOptions = { ...options, method: "GET" };
  if (!mergedOptions.cookies) {
    const { cookies } = loadCookies();
    if (Object.keys(cookies).length > 0) {
      mergedOptions.cookies = cookies;
    }
  }
  if (!mergedOptions.cookies?.buvid3) {
    if (!cachedBuvid3) {
      try {
        await ensureBuvid3();
      } catch {
      }
    }
    if (cachedBuvid3) {
      mergedOptions.cookies = { ...mergedOptions.cookies, buvid3: cachedBuvid3 };
    }
  }
  let resp = await httpRequest(url, mergedOptions);
  let body = resp.data;
  if (body.code === BILI_CODE_NEED_LOGIN && !cachedBuvid3 && !mergedOptions.cookies?.buvid3) {
    try {
      await ensureBuvid3();
      mergedOptions.cookies = mergeBuvid3(mergedOptions.cookies);
      resp = await httpRequest(url, mergedOptions);
      body = resp.data;
    } catch {
    }
  }
  if (body.code !== 0) {
    const hint = body.code === BILI_CODE_NEED_LOGIN ? "\u8BF7\u5148\u8FD0\u884C `pilidown login` \u5B8C\u6210\u626B\u7801\u767B\u5F55" : void 0;
    throw new BiliApiError(body.code, body.message, url, hint);
  }
  return body.data ?? body.result ?? void 0;
}

// src/core/wbi.ts
var import_node_crypto = require("node:crypto");
var MIXIN_KEY_ENC_TAB = [
  46,
  47,
  18,
  2,
  53,
  8,
  23,
  32,
  15,
  50,
  10,
  31,
  58,
  3,
  45,
  35,
  27,
  43,
  5,
  49,
  33,
  9,
  42,
  19,
  29,
  28,
  14,
  39,
  12,
  38,
  41,
  13,
  37,
  48,
  7,
  16,
  24,
  55,
  40,
  61,
  26,
  17,
  0,
  1,
  60,
  51,
  30,
  4,
  22,
  25,
  54,
  21,
  56,
  59,
  6,
  63,
  57,
  62,
  11,
  36,
  20,
  34,
  44,
  52
];
function getMixinKey(raw) {
  let out = "";
  for (const idx of MIXIN_KEY_ENC_TAB) {
    out += raw[idx];
  }
  return out.substring(0, 32);
}
function filterSpecialChars(s) {
  return s.replace(/[!'()*]/g, "");
}
function encWbi(params, mixinKey, wts) {
  const withWts = { ...params, wts };
  const sortedKeys = Object.keys(withWts).sort();
  const parts = [];
  for (const k of sortedKeys) {
    const v = withWts[k];
    const encoded = `${k}=${encodeURIComponent(String(v))}`;
    parts.push(filterSpecialChars(encoded));
  }
  const query = parts.join("&");
  return (0, import_node_crypto.createHash)("md5").update(query + mixinKey, "utf8").digest("hex");
}

// src/services/WbiKeyManager.ts
var CACHE_TTL = 30 * 60 * 1e3;
function extractKeyFromUrl(url) {
  const m = url.match(/\/([0-9a-f]{32})\.\w+$/);
  if (!m) throw new Error(`Cannot extract WBI key from URL: ${url}`);
  return m[1];
}
var WbiKeyManager = class {
  imgKey;
  subKey;
  expiresAt = 0;
  async getKeys() {
    if (this.imgKey && this.subKey && Date.now() < this.expiresAt) {
      return { imgKey: this.imgKey, subKey: this.subKey };
    }
    const resp = await httpRequest(
      "https://api.bilibili.com/x/web-interface/nav"
    );
    const navData = resp.data.data;
    if (!navData?.wbi_img?.img_url) {
      throw new Error(`Cannot fetch WBI keys from nav: code=${resp.data.code} msg=${resp.data.message}`);
    }
    this.imgKey = extractKeyFromUrl(navData.wbi_img.img_url);
    this.subKey = extractKeyFromUrl(navData.wbi_img.sub_url);
    this.expiresAt = Date.now() + CACHE_TTL;
    return { imgKey: this.imgKey, subKey: this.subKey };
  }
  async getMixinKey() {
    const { imgKey, subKey } = await this.getKeys();
    return getMixinKey(imgKey + subKey);
  }
  clearCache() {
    this.imgKey = void 0;
    this.subKey = void 0;
    this.expiresAt = 0;
  }
};
var wbiKeyManager = new WbiKeyManager();

// src/utils/wbiSign.ts
async function signWbiQuery(params) {
  const mixinKey = await wbiKeyManager.getMixinKey();
  const wts = Math.floor(Date.now() / 1e3);
  const w_rid = encWbi(params, mixinKey, wts);
  const all = { ...params, wts, w_rid };
  return Object.entries(all).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
}

// src/core/constants.ts
var FNVAL = {
  DASH: 16,
  HDR: 64,
  FOUR_K: 128,
  DOLBY_AUDIO: 256,
  DOLBY_VISION: 512,
  EIGHT_K: 1024,
  AV1: 2048
};
var FNVAL_DEFAULT = FNVAL.DASH | FNVAL.HDR | FNVAL.FOUR_K | FNVAL.DOLBY_AUDIO | FNVAL.DOLBY_VISION | FNVAL.EIGHT_K | FNVAL.AV1;

// src/api/VideoApi.ts
async function getVideoInfo(opts) {
  const params = {};
  if (opts.bvid) params.bvid = opts.bvid;
  else if (opts.aid !== void 0) params.aid = opts.aid;
  else throw new Error("getVideoInfo requires bvid or aid");
  const query = await signWbiQuery(params);
  return biliGet(`https://api.bilibili.com/x/web-interface/wbi/view?${query}`);
}
async function getPlayUrl(opts) {
  const params = {
    from_client: "BROWSER",
    fourk: 1,
    fnver: 0,
    fnval: opts.fnval ?? FNVAL_DEFAULT,
    cid: opts.cid,
    qn: opts.qn ?? 127
  };
  if (opts.platform) params.platform = opts.platform;
  if (opts.bvid) params.bvid = opts.bvid;
  else if (opts.aid !== void 0) params.aid = opts.aid;
  else throw new Error("getPlayUrl requires bvid or aid");
  const query = await signWbiQuery(params);
  return biliGet(`https://api.bilibili.com/x/player/wbi/playurl?${query}`);
}

// scripts/diagnose-playurl.ts
async function inspect(bvid) {
  const info = await getVideoInfo({ bvid });
  const cid = info.pages[0]?.cid ?? info.cid;
  console.log(`
=== ${bvid} | ${info.title} | cid=${cid} | duration=${info.duration}s ===`);
  for (const qn of [80, 64, 32]) {
    const resp = await getPlayUrl({ bvid, cid, qn, fnval: 4048 });
    const durl = resp.durl;
    console.log(`qn=${qn} fnval=4048 -> quality=${resp.quality}, dash.video=${resp.dash?.video?.length ?? 0}, dash.audio=${resp.dash?.audio?.length ?? 0}, durl=${durl?.length ?? 0}`);
    if (durl?.length) {
      console.log(`  durl[0] size=${durl[0].size} bytes, length=${durl[0].length}ms, url=${durl[0].url.slice(0, 80)}...`);
    }
  }
  for (const qn of [80, 64]) {
    const resp = await getPlayUrl({ bvid, cid, qn, fnval: 4048, platform: "html5" });
    const durl = resp.durl;
    console.log(`qn=${qn} platform=html5 -> quality=${resp.quality}, dash.video=${resp.dash?.video?.length ?? 0}, dash.audio=${resp.dash?.audio?.length ?? 0}, durl=${durl?.length ?? 0}`);
    if (durl?.length) {
      console.log(`  durl[0] size=${durl[0].size} bytes, length=${durl[0].length}ms`);
    }
  }
  const respMp4 = await getPlayUrl({ bvid, cid, qn: 80, fnval: 1 });
  const durlMp4 = respMp4.durl;
  console.log(`qn=80 fnval=1 (MP4) -> quality=${respMp4.quality}, dash.video=${respMp4.dash?.video?.length ?? 0}, durl=${durlMp4?.length ?? 0}`);
  if (durlMp4?.length) {
    console.log(`  durl[0] size=${durlMp4[0].size} bytes`);
  }
}
async function main() {
  for (const bvid of ["BV1Rz7Q6EEyV", "BV1knNj6hEKU", "BV1ME3j6sEmc", "BV1D4f5BTEE8"]) {
    try {
      await inspect(bvid);
    } catch (err) {
      console.log(`
=== ${bvid} ERROR: ${err.message} ===`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
