# P0 修复方案：合并链路、音频导出、失败可见性

面向实现者。所有数字均来自本机实测，不是估计。

## 1. 现状

| 能力 | 状态 | 根因 |
|---|---|---|
| DASH 合并 | 必然失败 | `media.ts` 用 `MP4Parser`（渐进式 MP4 解析器，从 `stbl` 读采样）处理 B 站 fMP4，fMP4 的 `stbl` 为空 |
| `--audio-only` 转 mp3 | 必然失败 | CJS bundle 里 `import.meta.url` 为 `undefined`，`@audio/decode-aac` 的 `createRequire(undefined)` 抛错 |
| 失败可见性 | 恒 exit 0 | `DownloadService` catch 住合并失败只记日志，`download.ts` 照常打印 `Done.` |
| fresh clone 可跑 | 失败 | `.gitignore:6` 忽略 `bin/cli.cjs`，仓库里没有产物 |
| bangumi/cheese URL | 泄漏 | 无条件打印 CDN 签名地址，`stream` 有 `--show-url` 门控而这两处没有 |

`download` 的两条主路径同时不可用，且都表现为"看起来成功"。这是当前最严重的问题。

## 2. 本次实测数据

素材：真实 B 站流 BV18gtJ6LECq（295s），分别取 AVC / HEVC / AV1 三档；大文件用 ffmpeg 生成的 337MB fMP4（1080p/900s）。

| 验证项 | 结果 |
|---|---|
| `convertFmp4ToMp4` 对 AVC | 8850 帧 / 295.00s，ffprobe 正常 |
| `convertFmp4ToMp4` 对 HEVC | 8850 帧 / 295.00s（`hevc 640x360`） |
| `convertFmp4ToMp4` 对 AV1 | 8850 帧 / 295.00s（`av1 640x360`） |
| box 级合并（HEVC / AV1） | 输出双轨，`ffmpeg -xerror -i -f null -` 全解码零错误 |
| `convertFmp4ToMp4` 内存（337MB 输入） | RSS 363MB → 1986MB，约文件大小的 4.7 倍 |
| 合并：整体读入版 | 增量约 615MB，585ms |
| 合并：流式版 | RSS 55MB，385ms，输出字节与整读版一致，全解码 OK |
| 打包 A：CJS + external | 转码成功（6.75MB / 295.03s），但产物里是 `require("@audio/decode-aac")`，该包是 ESM，Node < 22.12 会 `ERR_REQUIRE_ESM` |
| 打包 B：ESM + external | 转码成功，静态 import，全版本安全 |
| 打包 C：ESM 全打包不 external | 失败，wasm 文件没进 bundle |
| 打包 D：ESM 全打包 + 手放 `src/aac.wasm.cjs` | 转码成功，但等于在 MIT 项目里分发 GPL-2.0 代码 |

结论：合并链路的正确性已验证（含 HEVC/AV1），剩下的问题是吞吐与内存；mp3 的能力本身没问题，问题在打包形态与许可证。

## 3. 方案

### M1 合并链路重写（P0）

改动文件：`src/utils/media.ts`（重写）、新增 `src/utils/mp4.ts`、`src/services/DownloadService.ts`（调用点）。

链路：

```
video.m4s --convertFmp4ToMp4--> 标准 MP4(视频轨) ┐
audio.m4s --convertFmp4ToMp4--> 标准 MP4(音频轨) ┴--流式 box 合并--> out.mp4
```

`mp4.ts` 负责：box 扫描、trak 搬迁、trackID 重编号、`stco`/`co64` 偏移修正、`mvhd` duration 取两轨最大值、mdat 分块流式拷贝。它不解析 NAL、不看 codec，因此 AVC/HEVC/AV1 通用。

`convertFmp4ToMp4` 的输出布局是 `ftyp` + `moov` + `mdat`（337MB 文件的 moov 只有 109KB，HEVC 的 154KB），所以流式合并只需把 moov 读进内存，mdat 用 `createReadStream` 分块拷。实测 RSS 55MB。

独立审查提出、本机实测排除的风险：tomp4 重建 moov 时已剥离 `edts`/`elst` 编辑列表与 `mvex`（实测 moov 子 box 只有 `mvhd, trak, udta`），"elst 导致开头 A/V 错位"与"mvex 残留让播放器找不存在的 moof"这两条不存在于本链路。实现时仍要处理三条：按 handler（`vide`/`soun`）取轨而非假设恰好两轨；`stco` 偏移叠加超过 32 位时必须升级为 `co64`；各轨 timescale 独立换算，不要混用。

删除：`extractAudioFromMp4`（对音频-only 输入必抛错，且是死路）、`splitAvccNalus`（只服务废弃的 AVCC 路径，且硬编码 4 字节长度前缀）、`MP4Parser` 相关代码。

验收：三种编码各跑一个真实视频，`ffprobe` 断言双轨 + 时长 + 帧数；`ffmpeg -v error -xerror -i out.mp4 -f null -` 零错误；与 `ffmpeg -c copy` 参考输出的时长一致。

### M2 音频导出（P0）

`--audio-only` 默认输出 m4a：DASH 音频流本身就是 AAC，`convertFmp4ToMp4` 一步产出可播放 m4a，无需解码重编码。实测音频轨 6.68MB / 295.02s / aac 48k 2ch 正常。

mp3 路径三选一（决策点 T2）：
- ESM 构建 + `external: ['@audio/decode-aac']`：全 Node 版本安全，但 Skill 分发需要带 `node_modules`
- 保持 CJS + `external`：最小改动，但要求 Node ≥ 22.12（`engines` 要改）
- 砍掉 mp3，只出 m4a：零依赖、零许可证风险

三条都不 inline GPL wasm。若坚持单文件 + mp3，只能接受项目整体转 GPL-2.0，不建议。

### M3 失败可见性（P0）

改动文件：`src/services/DownloadService.ts`、`src/commands/download.ts`、`src/commands/fav.ts`。

- `DownloadService` 不再吞异常：合并/转码失败直接 throw，不返回 `mergedPath: undefined`
- `downloadVideo` 返回结构中 `mergedPath` 为空即视为失败
- `downloadAllPages` / `downloadCollection` 收集失败项，返回 `{ results, failures }`；有失败即 `process.exitCode = 1`，`--json` 输出 `failures` 数组（含 page/episode、阶段、错误）
- `SKILL.md` 里"Do not assume success from exit code alone"这句删掉：退出码可信之后，这句话是在给 bug 打补丁

### M4 fresh clone 可跑（P0）

两条都做：把 `bin/cli.cjs` 从 `.gitignore` 移除并提交（与 `skills/pilidown/bin/cli.cjs` 同源），README Quick Start 第 2 步保留 `npm run build` 但改为"已有产物，可选"。构建可复现性已验证（重建产物与提交产物 sha256 一致），加一条 CI 步骤校验。

### M5 URL 门控（P0）

`src/commands/bangumi.ts`（104/114/186/192 行）、`src/commands/cheese.ts`（100/110 行）加 `--show-url` 门控，默认只输出脱敏信息，与 `stream.ts` 行为一致。

### M6 吞吐与内存（P1）

- 合并流式化：已完成原型验证（55MB / 385ms），移植进 `mp4.ts`
- `mergeParts` 的同步 `readSync`/`writeSync` 循环改为 `stream/promises` 的 `pipeline`，几 GB 文件时不再阻塞事件循环
- 分片续传：分片先落盘并记录已完成字节，单分片失败只重传该分片，不再删整个 tempDir 重来
- 进度：`onProgress` 改为按流 `bytesRead` 累加触发，速度用全局时间窗采样，不在并发 worker 间共享可变状态

`convertFmp4ToMp4` 那一步的 4.7 倍内存峰值暂不解决（决策点 T1）。要彻底解决得自研流式 fMP4 → progressive MP4：第一遍只读 `moof` 头统计采样数以算出 `moov` 大小，第二遍流式拷 mdat 数据，最后回填 `moov`。内存恒定，工作量约等于 M1 的两倍。

延后不等于静默：转换前按 `文件大小 × 5` 估算峰值内存，超过阈值（默认 4GB，可用 `--max-media-mem` 覆盖）直接报错并提示改用 `--no-merge`，不把 OOM 留给用户。

输出原子性：转换与合并都先写 `<dest>.part` 临时文件，成功后 `rename` 到目标名。中断不留半截可播放头却无尾的文件；`existsSafe` 跳过逻辑配合原子写才真正幂等。

### M7 测试与 CI（P1）

`src/utils/media.ts` 和 `src/services/DownloadService.ts` 目前零覆盖，这是两个 P0 能进 main 的直接原因。

- 新增 `tests/unit/mp4.test.ts`：用 ffmpeg 生成的固定 fMP4 fixture（几 MB），断言 box 结构（trak 数、stco 偏移、mdat 长度）
- 新增 `tests/integration/media.test.ts`：跑真实合并，用 ffprobe 断言双轨与时长（CI 上可用 fixture，本机可跑真实流）
- `tests/unit/downloadService.test.ts`：注入假的 downloader 与 media，断言失败会 throw、失败项进 failures
- GitHub Actions：`tsc --noEmit` + `jest` + `build` + 产物 sha256 校验（构建可复现性已实测：重建产物与提交产物 sha256 完全一致）

待实测的编码矩阵（容器搬运理论上 codec 无关，但要在真流上确认）：E-AC-3（杜比音频 30250）、Hi-Res FLAC（30251）、杜比视界（`dvh1`/`dvhe`）。这三类只出现在大会员内容，普通账号拿不到流，属于"能播但可能错"的静默缺陷高发区。

### M8 一致性与清理（P2）

- `--output` 在 `download`/`fav` 是目录、在 `danmaku`/`subtitle` 是文件路径（决策点 T3）
- `--codec` 补 `parseInt(v, 10)`（`download.ts:22` 仍是裸 `parseInt`，与 `40e037c` 修过的同类问题）
- 路径拼接统一 `path.join`，替换 `DownloadService` 里的 `${outputDir}/${baseName}`
- `extForVideo` / `extForAudio` 三个分支返回同一个值，直接简化为常量
- Cookie 写入改为临时文件 + `rename` 原子替换；Windows 上的权限收紧需要 ACL，可延后
- 非 JSON 模式下进度用 `\r` 与日志 `\n` 交错会打断进度条，改为进度走 stderr 或统一缓冲
- 清理：删除 `docs/plans/spec.md`（0 字节）、`skills/pilidown/darwin-results.tsv`、`skills/pilidown/test-prompts.json`（后两个是内部 eval 记录，会随 Skill 分发给每个使用者）

## 4. 失败模式登记

| 失败模式 | 当前行为 | 修复后 |
|---|---|---|
| 合并抛错 | 记日志，打印 Done.，exit 0 | throw → 命令层 exit 1 |
| 转码抛错 | 记日志，保留原始 m4a，exit 0 | 同上 |
| `--all` 部分页失败 | 只返回成功项，exit 0 | failures 数组 + exit 1 |
| 分片下载超时 | 整体 reject，删 tempDir | 单分片重试，已下完的保留 |
| fMP4 输入（当前全部情况） | `No video track found` | 走 convert 路径，成功 |
| 解析不到宽高/采样率 | 静默用 1920x1080 / 48000 / 2 兜底 | 抛错（MP4 路径不再需要这些字段） |
| fresh clone 无产物 | `MODULE_NOT_FOUND` | 产物已提交 |

## 5. 落地顺序

1. M1 + M3（合并 + 失败可见性）—— 两个 P0 一起改，因为改完合并后失败路径才真正被触发
2. M2（默认 m4a）—— 改动小，立刻让 `--audio-only` 可用
3. M4 + M5（产物提交 + URL 门控）—— 各几行
4. M6 的合并流式化 + mergeParts 异步化
5. M7（测试 + CI）
6. M8（一致性清理，可拆成多个小提交）

## 6. 决策点

| 编号 | 决策 | 选项 | 默认建议 |
|---|---|---|---|
| T1 | `convertFmp4ToMp4` 的内存（4.7x）现在解决吗 | 现在自研流式 / 延后 | 延后：复用已验证的库，M1 工作量减半；代价是 1GB 以上视频峰值约 5GB |
| T2 | mp3 怎么保留 | ESM 构建 + external / CJS + external（Node ≥ 22.12）/ 砍掉只留 m4a | 默认 m4a，mp3 走 CJS + external 并把 engines 提到 22；Skill 场景不提供 mp3 |
| T3 | `--output` 改名 | 改名 `--dir` / 保持 `--output` 但文档写明 / 两者都收 | 保持 `--output`，SKILL.md 与 README 明确写"目录"，避免破坏现有调用 |
| T4 | 是否把 `bin/cli.cjs` 提交进仓库 | 提交 / 只改文档要求 build | 提交：`skills/` 下已经在提交产物，根目录不一致没有理由 |

## 7. 审查记录

本方案经过一轮独立工程审查（未参与制定的视角），采纳了以下调整：

1. elst / mvex 风险 → 实测排除（见第 3 节 M1）
2. convert 内存延后需加显式护栏，不能静默 OOM → 已加入 M6（`文件大小 × 5` 预检 + 阈值报错）
3. 输出必须原子写（temp + rename）→ 已加入 M6
4. 默认路径（m4a）必须保持单文件、广 Node 兼容，external 与 Node ≥ 22 只允许出现在 mp3 可选路径上 → 已写入 T2 默认建议
5. 退出码现在改：对人是修 bug，对 Agent 是契约修正，越晚改代价越高 → 与 M3 一致；同时在 SKILL.md 注明"部分失败时成品可能残缺，按文件检查而非只信退出码"
6. 供应链风险（tomp4 单点依赖）→ 失败时报错精确到阶段（转换/合并），不硬崩；ffmpeg 兜底作为远期可选项不进本期

未采纳：立即实现自研流式 fMP4 转换器（T1 延后，理由：复用已验证库、工作量减半，且有内存护栏兜底）。
