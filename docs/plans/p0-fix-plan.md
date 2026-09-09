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
| **fMP4 直通合并**（真实 B 站 AVC 流，118 片段） | 28.31MB / 69ms / RSS+3MB，ffprobe 双轨 295s 正确，`-xerror` 全解码零错误 |
| fMP4 直通合并（ffmpeg 产物回归，显式 base 形态） | 9 片段，全解码零错误 |
| fMP4 直通合并（337MB 输入） | 437ms，**RSS+15MB**（对照 convert 路径同输入 1986MB） |
| B 站 tfhd/trun 形态 | tfhd flags=0x20038（自带 default-base-is-moof、无显式 base）→ moof+mdat 成对搬移即可；ffmpeg 产物为显式 base（0x39），需 trun data_offset 修正（两种形态均已实测覆盖） |

结论（更新于 T1 二轮调研后）：合并链路有了更优解——**fMP4 直通合并**，跳过 `convertFmp4ToMp4`，内存从 4.7 倍文件大小降为 O(1)，正确性已用真实流与 ffmpeg 产物双重验证。mp3 的能力本身没问题，问题在打包形态与许可证。

## 3. 方案

### M1 合并链路重写（P0）

改动文件：`src/utils/media.ts`（重写）、新增 `src/utils/fmp4.ts`、`src/services/DownloadService.ts`（调用点）。

**主路径：fMP4 直通合并**（T1 二轮调研的结论，替代原先"convert ×2 + box 合并"方案）：

```
video.m4s ┐  双轨 moov 重建（视频 trak + 音频 trak + mvex 双 trex）
audio.m4s ┴→ 逐片段搬 moof/mdat（tfhd 改写 + trun data_offset 修正）→ out.mp4（仍是 fMP4）
```

要点（全部来自本机实测）：

- **不经过 `convertFmp4ToMp4`**。337MB 输入 RSS+15MB，内存 O(1)；convert 路径同输入 1986MB。
- 纯 box 搬运，不解析 NAL、不看 codec，AVC/HEVC/AV1 通用（直通路径对编码的兼容性与 convert 路径等价且更广）。
- tfhd 统一改写为 `default-base-is-moof`：源带显式 `base_data_offset`（如 ffmpeg 产物，flags=0x39）时删除该字段并按 `corr = 新moof长 + base − 源moof起点 − 源moof长` 修正所有 trun 的 data_offset（mdat 头尺寸在公式两侧相消，无需出现）；源本就是 default-base-is-moof（B 站实流，flags=0x20038）时 moof+mdat 成对搬移、偏移天然有效。
- 已踩过的坑：`hadBase` 必须以 tfhd 是否**真含** base 字段为准。初版把"存在 tfhd"误判为"有 base"，对 B 站流错误施加了 −moofStart 修正，产出 `Invalid NAL unit size`——该 bug 已在原型中复现并修复，写测试时必须覆盖"B 站形态（无显式 base）"与"ffmpeg 形态（显式 base）"两种 fixture。
- B 站 .m4v 头部有 `sidx`、尾部可能有 `mfra`：一律丢弃（索引类 box，非必需，ffprobe 实测无影响）。
- 新 moov：mvhd 取视频轨的，trak 按 handler（vide/soun）取轨并重编 trackID（1/2），mvex 双 trex 对应重编号。
- mdat 分块拷贝带反压（`write` 返回 false 时等 `drain`），不整读文件。

**兼容路径（可选 `--container mp4`）**：原方案保留——`convertFmp4ToMp4` ×2 → 流式 box 合并（搬 trak + 拼 mdat + 修 stco/co64 + 重编 trackID + 修 mvhd duration）。仅在用户显式要求传统 progressive MP4 容器（老硬件播放器、部分剪辑软件不认 fMP4）时启用。

fMP4 输出的兼容面：浏览器 `<video>`、MSE、VLC、mpv、ffmpeg 均原生支持（B 站网页播放器自己就是 fMP4）；风险集中在老硬件播放器，这正是保留兼容路径的原因。

`convertFmp4ToMp4` 输出布局为 `ftyp`+`moov`+`mdat`（337MB 文件的 moov 仅 109KB），兼容路径的流式合并把 moov 读进内存、mdat 分块拷，实测 RSS 55MB。

独立审查提出、本机实测排除的风险：tomp4 重建 moov 时已剥离 `edts`/`elst` 编辑列表与 `mvex`（实测 moov 子 box 只有 `mvhd, trak, udta`）。实现时仍要处理三条：按 handler（`vide`/`soun`）取轨而非假设恰好两轨；兼容路径的 `stco` 偏移超过 32 位时升级 `co64`；各轨 timescale 独立换算。

删除：`extractAudioFromMp4`（对音频-only 输入必抛错，且是死路）、`splitAvccNalus`（只服务废弃的 AVCC 路径，且硬编码 4 字节长度前缀）、`MP4Parser` 相关代码。

验收：三种编码各跑一个真实视频，`ffprobe` 断言双轨 + 时长 + 帧数；`ffmpeg -v error -xerror -i out.mp4 -f null -` 零错误；两种 tfhd 形态 fixture 各过一遍。**验证纪律：解码校验用 ≤60s 素材或 `-t` 限时长，禁止对 GB 级文件做全量解码**（本方案调研期间曾因此把 16GB 机器压到 OOM）。

### M2 音频导出（P0）

`--audio-only` 默认输出 m4a：DASH 音频流本身就是 AAC，`convertFmp4ToMp4` 一步产出可播放 m4a，无需解码重编码。实测音频轨 6.68MB / 295.02s / aac 48k 2ch 正常。

**T2 建议：砍掉 mp3。** 理由：

1. B 站音频原生 AAC，mp3 是有损转有损，音质纯降质，信息量为负
2. mp3 链路绑死 GPL-2.0 解码器（`@audio/decode-aac` 内含 FAAD2）：任何 mp3 输出都要先 AAC→PCM（GPL 解码器）再进 lamejs 编码，这是许可证问题的总源头
3. 砍掉后 P0-2 整体消失：不用改构建格式（CJS/ESM 之争）、不用抬 `engines`、不用 external、单文件分发与 wasm 加载问题不复存在
4. 主要调用方是 Agent，m4a 无兼容性问题；人要 mp3 的场景（老车机等）用一条系统 ffmpeg 命令解决，不该由下载器承担
5. 保 mp3 的最廉价方案（CJS+external）实测要求 Node ≥ 22.12，把最低版本从 18 抬到 22 去换一个降质转码，不划算

过渡方案：`--format mp3` 保留一个版本但明确报弃用错误并提示 m4a，SKILL.md/README 同步；下个版本删参数。

（若最终决定保留 mp3，则走 CJS + external，`engines.node` 提到 `>=22.12`，仅此一条路可接受；ESM 构建会让 Skill 分发带上 node_modules，与单文件分发冲突。）

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

`convertFmp4ToMp4` 的 4.7 倍内存峰值随直通路径成为默认而**整体消失**（T1 已解决）。内存护栏（`文件大小 × 5` 预检、超 4GB 报错）只对兼容路径（`--container mp4`）生效。

输出原子性：转换与合并都先写 `<dest>.part` 临时文件，成功后 `rename` 到目标名。中断不留半截可播放头却无尾的文件；`existsSafe` 跳过逻辑配合原子写才真正幂等。

### M7 测试与 CI（P1）

`src/utils/media.ts` 和 `src/services/DownloadService.ts` 目前零覆盖，这是两个 P0 能进 main 的直接原因。

- 新增 `tests/unit/fmp4.test.ts`：fixture 必须覆盖两种 tfhd 形态——B 站实流形态（default-base-is-moof、头部 sidx）与 ffmpeg 形态（显式 base_data_offset），断言 box 结构、trun 修正值、trackID 重编号
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
| fMP4 输入（当前全部情况） | `No video track found` | 直通合并，成功（兼容路径留给 `--container mp4`） |
| 解析不到宽高/采样率 | 静默用 1920x1080 / 48000 / 2 兜底 | 抛错（MP4 路径不再需要这些字段） |
| fresh clone 无产物 | `MODULE_NOT_FOUND` | 产物已提交 |

## 5. 落地顺序

1. M1 + M3（直通合并 + 失败可见性）—— 两个 P0 一起改，因为改完合并后失败路径才真正被触发
2. M2（默认 m4a，砍 mp3）—— 改动小，立刻让 `--audio-only` 可用并解除 GPL 悬置
3. M4 + M5（产物提交 + URL 门控）—— 各几行
4. M6 的 mergeParts 异步化 + 分片续传（合并流式化已内置于直通路径）
5. M7（测试 + CI，fixture 必须含 B 站/ffmpeg 两种 tfhd 形态）
6. 兼容路径（`--container mp4`，原 M1 方案的 convert+box 合并，可延后）
7. M8（一致性清理，可拆成多个小提交）

## 6. 决策点

| 编号 | 决策 | 结论 |
|---|---|---|
| T1 | convert 内存（4.7x） | **已解决**：fMP4 直通合并为主路径，跳过 convert，内存 O(1)（337MB 输入 RSS+15MB），不再需要自研流式转换器 |
| T2 | mp3 保留方式 | **建议砍掉**（理由见 M2），等最终拍板；若保留只能走 CJS+external + Node ≥ 22.12 |
| T3 | `--output` 改名 | **已拍板**：不改名，SKILL.md 与 README 明确写"目录" |
| T4 | `bin/cli.cjs` 提交进仓库 | **已拍板**：提交，与 `skills/pilidown/bin/cli.cjs` 同源 |

## 7. 审查记录

本方案经过一轮独立工程审查（未参与制定的视角），采纳了以下调整：

1. elst / mvex 风险 → 实测排除（见第 3 节 M1）
2. convert 内存延后需加显式护栏，不能静默 OOM → 护栏保留，只对兼容路径生效（T1 被直通方案整体取代）
3. 输出必须原子写（temp + rename）→ 已加入 M6
4. 默认路径（m4a）必须保持单文件、广 Node 兼容，external 与 Node ≥ 22 只允许出现在 mp3 可选路径上 → 已写入 M2
5. 退出码现在改：对人是修 bug，对 Agent 是契约修正，越晚改代价越高 → 与 M3 一致；同时在 SKILL.md 注明"部分失败时成品可能残缺，按文件检查而非只信退出码"
6. 供应链风险（tomp4 单点依赖）→ 直通主路径后 tomp4 降级为兼容路径依赖，主链路零第三方 muxer；失败时报错精确到阶段

未采纳：立即实现自研流式 fMP4 转换器 —— 被二轮调研的 fMP4 直通合并取代（内存 O(1) 且工作量更小）。

## 8. 直通合并原型验证记录（2026-09-09）

原型 `merge-fmp4.mjs`（约 250 行）已完成三种素材验证：

| 素材 | 形态 | 结果 |
|---|---|---|
| ffmpeg 产物 60s（360p+音频） | 显式 base（tfhd 0x39） | 14ms，RSS+3MB，全解码零错误 |
| 真实 B 站流 295s（AVC 118 片段 + 音频） | default-base-is-moof（0x20038），头部 sidx | 69ms，RSS+3MB，双轨 295s，全解码零错误 |
| ffmpeg 产物 900s（1080p，337MB） | 显式 base | 合并 437ms，RSS+15MB；109 个 mdat payload 与源逐字节一致 |

第三项当时的 `-xerror` 全解码报 `get_buffer() failed`，归因为**验证方式资源叠加**（node 比对脚本持有 2×337MB Buffer + ffmpeg 多线程 1080p 全量解码同机运行），非数据错误：mdat 逐字节一致、结构 ffprobe 正常、同构小文件全解码通过。教训已写入 M1 验收纪律：禁止对 GB 级文件全量解码，校验用限时长解码 + 结构断言 + payload 字节比对。
