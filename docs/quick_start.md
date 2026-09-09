# pilidown 开发者速览

面向首次接触本仓库的开发者。读完后应能定位任意功能所在文件、知道改哪里、知道哪些地方不能动。

## 1. 项目定位

pilidown 是一个 B 站（bilibili）下载器 CLI，TypeScript 编写，无外部二进制依赖。核心代码移植自 DownKyi（C#，<https://github.com/leiurayer/downkyi>），许可证 MIT。

它以两种形态分发：

| 形态 | 入口 | 使用者 |
|---|---|---|
| npm CLI | `bin/pilidown.cmd`（Win）/ `bin/pilidown`（Unix）→ `bin/cli.cjs` | 人 |
| Agent Skill | `skills/pilidown/SKILL.md` + `skills/pilidown/bin/cli.cjs` | AI Agent |

两种形态共用同一个 esbuild 打包产物 `bin/cli.cjs`。Skill 形态只是把产物复制一份并配一份 SKILL.md，让 Agent 无需 `npm install` 即可调用。

## 2. 环境准备

```bash
npm install          # 安装依赖
npm run typecheck    # tsc --noEmit
npm test             # jest，21 套件 / 233 用例
npm run build        # esbuild → bin/cli.cjs
node bin/cli.cjs info BV1xx411c7mD
```

Node 版本要求 ≥ 18（依赖原生 `fetch` 与 `Readable.fromWeb`）。

`.gitignore` 第 6 行忽略了 `bin/cli.cjs`，**fresh clone 后必须先 `npm run build`**，否则 `bin/pilidown.cmd` 直接 `MODULE_NOT_FOUND`。Skill 目录下的 `skills/pilidown/bin/cli.cjs` 是提交进仓库的，不受影响。

## 3. 仓库地图

```
src/
  index.ts              CLI 入口，注册 12 个命令
  commands/             命令层：参数解析、输出格式化、退出码  ← 只做胶水
  api/                  B 站 HTTP 接口封装（纯函数调用）
  core/                 与 B 站弱相关的纯逻辑（BV 转换、WBI、弹幕 protobuf、字幕转换、入口解析）
  services/             业务流程编排（选流、下载、Cookie、WBI key 缓存）
  utils/                基础设施（HTTP、日志、多线程下载、媒体处理、二维码）
  types/                类型定义（bili.ts 490 行，是最大的单文件）
build.mjs               esbuild 打包脚本
bin/                    跨平台 wrapper + 打包产物
skills/pilidown/        Agent Skill 分发包
docs/                   文档（本文件、zero-ffmpeg-research.md、changelog_developer.md）
tests/unit/             jest 单测
scripts/                playurl 诊断脚本（临时排查用，非产品代码）
```

共 38 个 TS 源文件、约 5600 行。

## 4. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 语言 | TypeScript 5.4，`strict: true` | `module: CommonJS`，`target: ES2022` |
| CLI 框架 | commander 12 | 每个命令一个 `registerXxxCommand(program)` |
| 网络 | Node 原生 `fetch` | 不依赖 axios/undici 封装 |
| 打包 | esbuild 0.21 | 单文件 CJS 输出，无 external |
| 测试 | jest 29 + ts-jest | 纯单测，无 mock 服务器（用 stub 注入） |
| 媒体处理 | `@invintusmedia/tomp4`、`@audio/decode-aac`、`@breezystack/lamejs` | 替代原 ffmpeg 路径 |
| 其他 | qrcode、iconv-lite | 登录二维码、GBK 字幕解码 |

设计取向（`ponytail` 原则）：能用标准库就不加依赖，能固定分区就不用动态调度，能 20 行写完就不上设计模式。源码中 `// ponytail:` 开头的注释标记了这类取舍与简化点，改动前先看一眼。

## 5. 架构分层

```
用户 / Agent
    │
    ▼
commands/          参数解析 → 调用 service → 格式化输出 → 设退出码
    │
    ▼
services/          业务流程编排（选流、下载编排、登录态）
    │
    ├──► api/     B 站接口（内部走 utils/httpClient）
    └──► core/    纯计算（WBI 签名、BV/AV 互转、弹幕解析、格式转换）
    │
    ▼
utils/             HTTP、日志、多线程下载、媒体处理
```

依赖方向严格单向：`commands → services → api/core → utils`。唯一例外是 `utils/httpClient.ts` 依赖 `services/CookieService.ts`（自动加载登录态），见第 7 节。

### 查询链路（info / stream）

```
parseEntrance(arg) → { type:'video', bvid }
    → VideoApi.getVideoInfo()           WBI 签名 + biliGet
    → VideoApi.getPlayUrl(cid, qn)      WBI 签名，fnval=4048 请求 DASH
    → StreamService.selectStreams()     按 qn/codec/bandwidth 选出 video+audio
    → 输出（human 文本 或 JSON Lines）
```

### 下载链路（download）

```
parseEntrance → getVideoInfo → getPlayUrl → selectStreams
    → downloadStream(video)   utils/downloader.ts 多线程分片
    → downloadStream(audio)
    → media.mergeDashStreams(video, audio, out.mp4)     ← 已知缺陷区，见第 9 节
    → 输出 DownloadResult
```

`--all` / `--collection` 走 `downloadAllPages` / `downloadCollection`，内部是并发 3 的 promise pool，逐页调用 `downloadVideo`。

## 6. 模块逐个说明

### api/（8 个文件）

每个文件对应一类 B 站接口，导出纯 async 函数，不做重试、不做缓存、不碰文件系统。需签名的接口走 `utils/wbiSign.ts` 的 `signWbiQuery()` 后调用 `biliGet()`。

- `VideoApi.ts` — `getVideoInfo` / `getPlayUrl` / `getPlayerInfo` / `getNavInfo`，主链路
- `BangumiApi.ts` / `CheeseApi.ts` — 番剧、课程
- `DanmakuApi.ts` — 分段拉取弹幕 protobuf
- `FavoritesApi.ts` / `HistoryApi.ts` / `UserApi.ts` — 收藏夹、历史、用户空间
- `LoginApi.ts` — 二维码生成与轮询

### core/（7 个文件）

- `parseEntrance.ts` — URL/裸 ID → 联合类型，支持 BV/av/ss/ep/md/ml/uid/mid、b23.tv 短链
- `wbi.ts` — WBI 签名算法，附官方测试向量
- `bvid.ts` — BV ↔ AV 互转（新算法）
- `constants.ts` — 画质 ID、音质 ID、编码 ID、FNVAL 位掩码表
- `danmakuReader.ts` — 手写 protobuf 解析（不依赖 protobufjs）
- `assConverter.ts` — 弹幕 → ASS，440 行，含碰撞检测
- `subtitleConverter.ts` — 字幕 → srt/json/ass

### services/（4 个文件）

- `StreamService.ts` — 选流策略
- `DownloadService.ts` — 下载编排（348 行，最大的业务文件）
- `CookieService.ts` — `~/.pilidown/cookies.json` 读写
- `WbiKeyManager.ts` — WBI img_key/sub_key 缓存（带 TTL）

### utils/（6 个文件）

- `httpClient.ts` — `httpRequest` / `biliGet` / `downloadBuffer`，含 buvid3 自动注入
- `downloader.ts` — 分片探测、并发下载、同步合并
- `media.ts` — 零 FFmpeg 媒体处理
- `logger.ts` — JSON Lines / human 双模输出
- `qrcode.ts` — 终端二维码 + 本地 HTTP 页面 + PNG
- `wbiSign.ts` — 签名参数拼装

### types/

`bili.ts`（490 行）是 B 站接口响应的类型定义集合，改接口时先动这里。`errors.ts` 定义 `BiliApiError` / `NetworkError` / `FileSystemError`。

## 7. 关键机制

**WBI 签名**：B 站部分接口要求参数按 `MIXIN_KEY_ENC_TAB` 置换后 MD5 签名。key 由 `WbiKeyManager` 缓存，签名统一入口是 `src/utils/wbiSign.ts`。

**Cookie 与登录态**：`CookieService` 在 `~/.pilidown/cookies.json` 存明文 JSON。`biliGet()` 在调用方未显式传 cookies 时**自动加载**该文件，所以所有需登录的接口自动受益。副作用：任何 `biliGet` 调用都可能带上登录态。

**buvid3 风控**：B 站返回 `-352` 是反爬风控而非字面"未登录"。`httpClient` 检测到该码会自动取 buvid3 并重试一次。测试环境用 `__setBuvid3ForTest()` stub，不访问真实域名。

**选流策略**：`selectVideoStream` 先按 `qn` 过滤、再按 `codecid` 过滤，最后取 `bandwidth` 最大者。音频同理，但 Dolby / Hi-Res FLAC 优先于普通音频。

**多线程下载**：`probeRangeSupport()` 用 `Range: bytes=0-0` 探测大小与 range 支持 → `createPartitions()` 固定 N 等分 → `Promise.all` 并发 → `mergeParts()` 同步合并。任一分片失败则整体 reject 并删除临时目录，无字节级续传。

**零 FFmpeg 媒体处理**：`utils/media.ts` 用 tomp4 做 MP4 解析/封装，用 decode-aac + lamejs 做 AAC→MP3 转码。当前实现存在结构性缺陷，见第 9 节与 `docs/zero-ffmpeg-research.md`。

## 8. 构建与分发链路

```
src/**/*.ts  ──esbuild──▶  bin/cli.cjs  ──复制──▶  skills/pilidown/bin/cli.cjs
                              ▲
                              └── bin/pilidown(.cmd) wrapper 调用
```

`build.mjs` 配置：`bundle: true`、`platform: 'node'`、`format: 'cjs'`、`target: 'node18'`、`minify: true`、**无 external、无 `import.meta.url` define**。最后一条是已知问题的根因，详见第 9 节。

改完 `src/` 后：

1. `npm run typecheck && npm test`
2. `npm run build`
3. 若行为对外可见，把新 `bin/cli.cjs` 复制到 `skills/pilidown/bin/cli.cjs` 并同步 `skills/pilidown/SKILL.md`

## 9. 已知缺陷（改动前必读）

完整调研见 `docs/zero-ffmpeg-research.md`。此处只列会直接影响改代码的结论：

1. **DASH 合并在真实场景下必然失败。** B 站 DASH 产出的是 fragmented MP4（moov 只有空骨架 + mvex，采样全在 moof/mdat 里），而 `utils/media.ts` 用的 `MP4Parser` 是渐进式 MP4 解析器，读不到采样 → 抛 `No video track found`。正确修法是改用同库的 `convertFmp4ToMp4()` 先转标准 MP4 再做 box 级合并，不是换库，也不需要引入 ffmpeg。
2. **`--audio-only` 的 mp3 转码必然失败。** CJS bundle 里 `import.meta.url` 为 `undefined`，`@audio/decode-aac` 的 `createRequire(undefined)` 直接抛错。
3. **失败被吞掉，退出码恒为 0。** `DownloadService.ts:255-258` catch 住合并失败只记日志；`download.ts` 照常打印 `Done.`。对外契约应该是"失败即非 0 退出码"，而不是让调用方自己猜。
4. **`bangumi.ts` / `cheese.ts` 无条件打印流 URL**（`stream.ts` 有 `--show-url` 门控，这两处没有）。新增输出前先确认有没有同样的门控要求。
5. **`utils/media.ts` 和 `services/DownloadService.ts` 零测试覆盖。** 233 个用例全在 API 解析与纯函数上。改这两个文件必须补测试或真机实测。
6. **内存**：`mergeDashStreams` / `transcodeToMp3` / `convertTsToMp4` 都把整个文件读进内存再 build 整个输出，1GB 视频峰值可达 3–4GB。

## 10. 改动分区

### 可以放心改

| 位置 | 说明 |
|---|---|
| `src/commands/*.ts` 的输出格式 | 只影响展示层，不影响数据流 |
| `src/core/*.ts` 纯函数 | 有测试覆盖，改完跑 `npm test` |
| `src/types/bili.ts` 增字段 | B 站加字段时补上，只增不删 |
| `docs/`、`tests/` | 无构建依赖，随时改随时补 |

### 改之前需要想清楚

| 位置 | 风险 |
|---|---|
| `src/core/constants.ts` | ID 表来自 B 站 playurl 接口语义，改错会导致选流不准；改前用 `scripts/diagnose-playurl.ts` 验证 |
| `src/core/wbi.ts` | 签名错则全站接口 403。有官方测试向量兜底，务必保留 |
| `src/utils/httpClient.ts` | `biliGet` 的 cookie 自动注入和 buvid3 重试是全局行为，影响所有命令 |
| `src/core/parseEntrance.ts` | 命令行输入契约，改了要同步 SKILL.md 的输入说明 |
| `src/utils/logger.ts` | JSON Lines 输出格式被 Agent 侧解析，改结构等于破坏外部调用方 |
| `src/services/StreamService.ts` | 选流结果直接决定下载质量，改前确认 AVC/HEVC/AV1 的带宽排序假设 |
| `src/utils/downloader.ts` | 并发与超时行为，改错会导致大文件下载中断 |

### 不建议改 / 不能直接改

| 位置 | 原因 |
|---|---|
| `bin/cli.cjs`、`skills/pilidown/bin/cli.cjs` | **构建产物，不要手改。** 要改就改 `src/` 再 `npm run build`。两份产物必须同源 |
| `utils/media.ts` 中 `MP4Parser` 相关路径 | 见第 9 节第 1 条，这条路径本身是坏的，改它不如替换它 |
| 把 `@audio/decode-aac` inline 进 bundle | 该包 LICENSE 为 **GPL-2.0**（内含 FAAD2）。本仓库是 MIT，静态分发会导致整个 CLI 须转 GPL。目前 wasm 未 inline，无现行违规——保持现状 |
| `skills/pilidown/SKILL.md` 的调用契约 | Agent 依赖它决策。任何 CLI 参数或输出变化都必须同步，否则 Agent 会按旧契约调用 |
| 提交 `cookies.json` / `config.json` / `.pilidown/` | 已在 `.gitignore`，含真实会话凭据 |
| 提交 `skills/pilidown/darwin-results.tsv`、`test-prompts.json` | 内部 eval 记录，会随 Skill 分发给所有使用者 |

## 11. 常见任务速查

**新增一个命令**

1. 在 `src/commands/` 新建 `xxx.ts`，导出 `registerXxxCommand(program: Command)`
2. 在 `src/index.ts` 注册
3. 若需要新接口，在 `src/api/` 加函数，走 `biliGet`
4. 输出一律走 `utils/logger`，支持 `--json`
5. 补 `tests/unit/xxx.test.ts`
6. 同步 `skills/pilidown/SKILL.md` 的决策树与命令模板

**新增一个 B 站接口**

在对应 `src/api/*.ts` 加 async 函数 → 在 `src/types/bili.ts` 定义响应类型 → 调用处用 `biliGet<T>()` → 补测试（参考 `videoApi.test.ts` 的 stub 写法）。

**改画质/音质 ID**

改 `src/core/constants.ts`，同步 `skills/pilidown/SKILL.md` 对应说明，跑 `npm run build` 后实测确认。

**改媒体处理（合并/转码）**

先读 `docs/zero-ffmpeg-research.md`，再动 `src/utils/media.ts`。改完必须真机实测：下载一个真实视频，用 `ffprobe` 检查轨道数、时长、帧数，并用 `ffmpeg -v error -xerror -i out.mp4 -f null -` 做全解码校验。

## 12. 编码约定

- 所有导出函数带 JSDoc；移植自 DownKyi 的文件在头部注明原始 C# 文件路径
- 错误处理用 `types/errors.ts` 的三个 Error 类，不要裸 `throw new Error`
- 命令层统一 `try/catch` → `logError` → `process.exitCode = 1`
- 输出走 `utils/logger`，不要直接 `console.log`（JSON 模式下会污染输出流）
- `--json` 模式下进度事件用 JSON Lines，每行一个事件
- 路径拼接用 `node:path` 的 `join`，不要用字符串模板（Windows 上会产生混用分隔符）

## 13. 提交前检查

1. `npm run typecheck` 通过
2. `npm test` 全绿
3. 涉及 `src/` 改动 → `npm run build`；涉及对外行为 → 同步 `skills/pilidown/bin/cli.cjs`
4. 涉及 CLI 参数或输出格式 → 同步 `skills/pilidown/SKILL.md`
5. 在 `docs/changelog_developer.md` 追加一条，按该文件的格式标明 commit、时间、agent（及模型，若已知）、改动文件、性质、是否需重新构建

---

本文件由 WorkBuddy 于 2026-09-09 初始化（commit d1035e8）。内容随代码变动会过时，发现与代码不符以代码为准并顺手更正。
