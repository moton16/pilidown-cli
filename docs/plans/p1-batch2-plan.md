# 第二批修复方案（P1）

> 范围：`--container mp4` 渐进式兼容路径、字节级续传、`mergeParts` 异步化、CI、批处理 failures 单测
> 前置：第一批（`08ab830`）已完成 fMP4 直通合并、移除 mp3、退出码可信化、URL 门控
> 审查方式：/autoplan 流水线（CEO → Eng → DX），因环境无 codex，双声音降级为单模型 + 独立子代理

---

## 1. 前提（Premises）

| # | 前提 | 判断 |
|---|---|---|
| P1 | fMP4 直通合并是默认容器，渐进式 MP4 只是给老播放器的逃生通道 | 成立——fMP4 是现代播放器、浏览器、ffmpeg 的通用格式；O(1) 内存是旗舰特性，不能为此让路 |
| P2 | "下载失败丢掉全部分片"是真实痛点，不是理论问题 | 成立——第一批实测中 8 线程下一个分片超时即删除整个 tempDir，22MB 已下载内容作废 |
| P3 | `mergeParts` 的同步 `readSync/writeSync` 会阻塞事件循环 | 成立，但**它是否还该存在于关键路径上**是另一个问题（见 M2/M3） |
| P4 | 仓库没有任何 CI，`bin/cli.cjs` 是提交产物 | 成立——`.github` 不存在，构建可复现性已验证但无人守门 |
| P5 | `downloadAllPages` / `downloadCollection` 的 failures 契约无测试 | 成立——233→242 个用例全在 API 解析、纯函数和 fmp4 结构上 |

---

## 2. 已经有什么（复用而非重建）

| 子问题 | 已有资产 | 结论 |
|---|---|---|
| 渐进式 MP4 生成 | `@invintusmedia/tomp4` 的 `convertFmp4ToMp4()`（已在依赖树里、已对 AVC/HEVC/AV1 真实流验证） | 直接复用，不引新库 |
| 两个渐进式 MP4 的 box 级合并 | 原型 `merge-mp4.mjs`（已验证：解 trak、拼 mdat、修 stco/co64、重编 trackID、修 mvhd duration，`ffmpeg -xerror` 全解码零错误） | 移植为 TS，约 120 行 |
| box 扫描 / trun 定位 / 分块流式拷贝 / 原子写 | `src/utils/fmp4.ts` 已有 `topBoxes` `boxSize` `trunDataOffsetPositions` 与 4MB 带反压拷贝 | 提取共享工具，避免两份 box 扫描代码 |
| Range 探测、分片划分 | `probeRangeSupport` / `createPartitions` 正确，直接留用 | 仅重写落盘与重试 |
| fetch mock 测试手法 | `tests/unit/downloader.test.ts` 已用 `jest.spyOn(globalThis,'fetch')` + `new Response(...)` | 新测试沿用同一套路 |

---

## 3. 方案

### M1 · `--container mp4`（渐进式兼容路径）

新增 `download --container <fmp4|mp4>`，默认 `fmp4`。

```
video.m4s ─┐
           ├─ --container fmp4（默认）：mergeFmp4() → 双轨 fMP4，O(1) 内存
audio.m4s ─┘
           └─ --container mp4（可选）：convertFmp4ToMp4(视频) → 渐进式 ┐
                                        convertFmp4ToMp4(音频) → 渐进式 ┴→ mergeProgressiveMp4() → 单轨渐进式 .mp4
```

新增 `src/utils/mp4.ts`：`mergeProgressiveMp4(videoPath, audioPath, destPath)`，移植 `merge-mp4.mjs` 已验证的逻辑（box 扫描、trak 搬迁、trackID 重编号、`stco`/`co64` 偏移叠加、`mvhd` duration 取双轨最大、mdat 分块流式拼接、temp+rename 原子写）。`src/utils/fmp4.ts` 中的 box 工具函数提取为 `src/utils/box.ts` 供两者共用。

**内存**：`convertFmp4ToMp4` 这一步是文件大小的约 4.7 倍（实测 337MB → RSS 1986MB）。因此：

- 转换前做预检：`预估峰值 = 输入大小 × 5 + 输出大小`，超过阈值直接报错，提示改用 `--no-merge`（保留分离流）或系统 ffmpeg。阈值默认 4GB，可用 `--max-media-mem <mb>` 覆盖。
- 报错文案必须给出路，不能只说"内存不够"。

**只作用于视频合并路径**：`--audio-only` 已经是渐进式 m4a（`audioStreamToMp4` 的输出就是），`--container` 对它是 no-op，文档写明。

**不做的**：自研流式 fMP4 → 渐进式转换器（O(1) 内存版）。理由：需要从 trun 重建 `stts`/`ctts`/`stss`/`stsc`/`stsz`/`stco`，其中 `ctts`（B 帧显示顺序）和 `stss`（关键帧表）写错会产出"能播但 seek 花屏 / 时间戳错乱"这类最难查的故障；而这条路径是可选逃生通道，用已验证的库 + 护栏把失败模式显式化，性价比远高于自研。触发条件写进 TODOS.md：**若用户撞上内存护栏且确实需要渐进式输出，再启动自研**。

---

### M2 · 字节级续传（改为偏移直写）

**当前实现的问题**：`Promise.all(parts.map(downloadPart))` 任一失败 → reject → `finally` 删掉整个 tempDir → 已下载分片全部作废；重试只是 baseUrl / backupUrls 轮换（同文件整体重试）。

**独立审查否掉了原设计草案**。草案是"tempDir 稳定 key + 按文件大小推断续传点"，审查指出致命缺陷：

> 用"文件大小 = 已完成字节数"推断可续性，却从不校验已写字节的身份。最危险的路径：某次请求服务器返回 200（忽略 Range），若这次重写写到一半被杀，残留分片里装的是**整文件前 N 字节**而不是该分片的第 N 字节；下次续传见大小落在 (0, expected) 就 append，产生**错位且永不报错**的数据。

**采纳的方案：偏移直写 + 清单**（原型已实测，见第 9 节）

```
destPath.part          预分配 size 字节的目标文件，各 worker 用 pwrite 写到自己的偏移
destPath.partstate.json  { v:1, size, key, done:[每分片的已完成字节数] }
成功后：fsync → rename(.part → destPath) → 删除 .partstate.json
失败后：两个文件都保留，错误信息打印路径与"重跑即续传"
```

关键点：

1. **Content-Range 必须校验**：请求 `bytes=(from+done)-(to)` 后，断言响应 `Content-Range` 的起始偏移 == `from+done`，不符即报错。这是防静默损坏的第一道闸。
2. **收到 200 即报错**（服务器忽略 Range）→ 不能 append（会产生错位），本轮该分片失败而不是静默写坏。
3. **每分片独立重试 + 指数退避**（默认 4 次），不再整体重来。
4. **成功后 `fsync` 再 rename**：断电时 NTFS/ext4 可能保留文件大小但数据未落盘，`done` 会信任一个空洞。fsync 成本极低。
5. **清单以内容身份为准**：`key` 由调用方传入（`bvid-cid-streamId`），`size` 必须匹配。换了清晰度/音轨/分P → key 变 → 丢弃旧状态，不会串台。
6. **进度与速度重算**：废弃并发 worker 共享的 `lastSpeedMark`/`lastSpeedBytes`，改由一个聚合器（定时 250ms 读各分片 `done` 之和）计算总进度与瞬时速度。顺带修掉"8 线程只有 8 次跳变"和"速度数字是错的"。
7. **新增 `--no-resume`** 强制丢弃残留状态从零开始。
8. **孤儿状态清理**：正常结束会删；进程被 kill 时残留 `<dest>.part` / `<dest>.partstate.json`。不做后台 janitor，改为 `--no-resume` 显式清理 + 文档写明。跨进程并发写同一目标时，用 `.part.lock`（`wx` 独占创建）拒绝第二个进程。

**跨会话续传真的可行吗**：可行。B 站签名 URL 约 1 小时过期，但**每次运行都会重新取 playurl**，所以重跑拿到的是指向同一内容的新有效 URL，续传照样成立。前提是内容身份相同（key 匹配），这一点由清单保证。

---

### M3 · `mergeParts` 异步化

用户的要求是"异步化"。M2 落地后，`mergeParts` 将**不再出现在下载关键路径上**（偏移直写不需要合并）。

处理方式：**保留函数但改造为异步 + 原子写**，作为公开工具函数继续存在并保留测试：

- 用 `createReadStream` + `pipeline(..., ws, { end: false })` 顺序串接，带反压，不再阻塞事件循环（注意：前 N-1 段必须 `{ end: false }`，否则写流提前关闭）。
- 写入 `destPath + '.tmp'`，全部完成后 `fsync` + `renameSync` 原子替换，避免中途失败留下半成品。
- 签名由 `mergeParts(partPaths, destPath, onDeleteTemp?): void` 变为 `Promise<void>`，调用方与测试相应 `await`。

> 这是对用户指令的一处偏离，需要确认：两者都指向"应该让它退出关键路径"。若倾向删掉，则 `tests/unit/downloader.test.ts` 中两条用例一并删除。默认按"保留并异步化"执行。

---

### M4 · CI

新增 `.github/workflows/ci.yml`：

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest]   # Windows 是本项目主力平台，路径/权限差异必须被覆盖
    node: [20, 22]
```

步骤：`npm ci` → `npm run typecheck` → `npm test` → `npm run build` → **产物漂移检查**（`git diff --exit-code -- bin/cli.cjs skills/pilidown/bin/cli.cjs`）。

最后一步是重点：`bin/cli.cjs` 与 `skills/pilidown/bin/cli.cjs` 是提交进仓库的分发产物，CI 必须保证"改了源码但忘了重新构建"或"两份产物不同步"无法通过。

配套改动：`build.mjs` 现在只写 `bin/cli.cjs`，skill 侧靠手工 `cp`。改为一次构建同时写两处，从结构上消除漂移。

`engines` 目前是 `>=18`。Node 18 已于 2025-04 EOL，且 CI 矩阵取 20/22。建议同步提到 `>=20`（决策点 D2）。

---

### M5 · 批处理 failures 单测

新增 `tests/unit/downloadService.test.ts`（当前 `DownloadService.ts` 零覆盖），mock `../api/VideoApi` 与 `../utils/downloader` / `../utils/media`：

| 场景 | 断言 |
|---|---|
| 全部成功 | `failures` 为空，`results.length === pages.length` |
| 部分失败 | 失败项进入 `failures`，字段含 `page`/`stage`/`error`；`results` 只含成功项 |
| 全部失败 | `results` 为空，`failures` 完整 |
| 每个页面恰好尝试一次 | 并发 worker 的 cursor 逻辑无重复无遗漏（这是 `worker()` 里最易错的部分） |
| 结果顺序确定 | 见下方修正 |
| `downloadVideo` 合并失败必须 reject | P0-3 契约的回归防护（当前无任何测试） |
| `--collection` 同上一组 | `episode` 字段与 `bvid` 对应正确 |

**顺带修正**：`results.push(r)` 由并发 worker 写入，数组顺序是完成顺序而非页码顺序。改为按索引预分配数组写入，让 `--json` 输出稳定且有序——对"主要使用者是 Agent"的项目，输出确定性是契约的一部分。

**顺带修正**：`DownloadFailure` 增加 `code` 字段（`E_HTTP` / `E_MERGE` / `E_EXPIRED_URL` / `E_DISK` / `E_UNSUPPORTED`）。既然本来就在改这个结构，Agent 侧靠字符串匹配错误信息是脆弱的。完整错误码体系留到后续。

`tests/unit/downloader.test.ts` 同步扩测（新增用例）：续传命中清单只请求剩余范围、Content-Range 不匹配即抛错、分片重试与退避、`--no-resume` 丢弃状态、进度单调不减、`mergeParts` 异步 + 原子写。

---

## 4. 架构

```
commands/download.ts ──┬─ downloadVideo / downloadAllPages / downloadCollection
                       │        (DownloadService.ts)
                       │             │
                       │             ├─ api/VideoApi ──── 取视频信息 / playurl
                       │             ├─ StreamService ── 选流
                       │             ├─ utils/downloader ─ 偏移直写 + 清单续传   ← M2 重写
                       │             │      └─ probeRangeSupport / createPartitions（保留）
                       │             ├─ utils/media.ts ─── 容器层分发             ← M1 扩展
                       │             │      ├─ fmp4.ts ─ mergeFmp4（默认，O(1)）
                       │             │      └─ mp4.ts  ─ mergeProgressiveMp4（可选）  ← M1 新增
                       │             │      └─ box.ts  ─ 共享 box 工具             ← M1 新增
                       │             └─ utils/logger
                       └─ process.exitCode / failures[]                            ← M5 扩测
```

新增依赖：**无**。`mp4.ts` 复用已在依赖树里的 `@invintusmedia/tomp4`。

## 5. 测试图谱

| 代码路径 | 现状 | 本批 |
|---|---|---|
| `createPartitions` / `probeRangeSupport` | ✅ 已测 | 不动 |
| `downloadPart` / `downloadMultiThread` | ⚠️ 仅 happy path | + 续传 / Content-Range 校验 / 重试 / 进度 |
| `mergeParts` | ⚠️ 仅同步 happy path | 改异步 + 原子写，用例重写 |
| `mergeFmp4`（fmp4.ts） | ✅ 9 个结构用例 | 不动 |
| `mergeProgressiveMp4`（mp4.ts） | ❌ 无 | + 手工构造双轨渐进式 fixture：trak 数 / trackID / stco 偏移 / mdat 长度 |
| `downloadVideo` | ❌ 无 | + 合并失败必须 reject |
| `downloadAllPages` / `downloadCollection` | ❌ 无 | + 全成功 / 部分失败 / 全失败 / 每页一次 / 顺序 |
| `audioStreamToM4a` | ❌ 无 | + 非 fMP4 输入直通、fMP4 输入转换（可延后） |
| CI | ❌ 无 | + tsc / jest / build / 产物漂移检查，2 OS × 2 Node |

## 6. 失败模式登记

| 失败 | 触发 | 现状 | 本批后 |
|---|---|---|---|
| 分片失败丢弃全部进度 | 任一分片 HTTP 错误或超时 | 删 tempDir，从零重来 | 保留 `.part` + 清单，重跑续传 |
| **静默数据损坏** | 服务器 200/Content-Range 异常后中断 | 不可能发生（从不续传） | 校验 Content-Range 起始偏移，不符即报错 |
| 断电留下空洞 | 未 fsync 即信任文件大小 | 不适用 | 每分片 fsync 后 rename |
| 两份 bundle 漂移 | 改源码忘构建 / skill 副本未同步 | 无守门 | CI 检查 `git diff --exit-code` |
| 渐进式路径 OOM | `--container mp4` 无护栏 | 不适用 | 大小 × 5 预检 + 可配阈值 + 明确出路 |
| Agent 靠猜错误 | failures 只有自然语言 error | 字符串匹配 | `code` 字段 |
| 结果数组顺序不定 | 并发 push | 完成顺序 | 按索引写入，确定性有序 |

## 7. 决策点

| # | 决策 | 选项 | 默认建议 |
|---|---|---|---|
| D1 | 渐进式路径实现方式 | 复用 tomp4 convert + box 合并（内存 4.7x，约 150 行已验证） / 自研流式（O(1)，约 300 行 + ctts/stss 风险） | **前者**。可选逃生通道不值得承担 sample table 重建风险；TODOS.md 记触发条件 |
| D2 | `engines` 是否提到 `>=20` | 提到 20 / 保持 18 | **提到 20**。Node 18 已 EOL，CI 矩阵取 20/22 |
| D3 | `mergeParts` 保留还是删除 | 保留并异步化 / 删除 | **保留并异步化**（尊重原始指令；它仍是合理公开工具） |
| D4 | CI 是否含 Windows runner | 2 OS × 2 Node = 4 job / 仅 ubuntu | **含 Windows**。主力平台是 Windows，`ftruncate` 这类差异只有 Windows 能抓到 |
| D5 | 续传默认开关 | 默认开 + `--no-resume` / 默认关 + `--resume` | **默认开**。失败保留状态无害，且是 Agent 长任务的核心保障 |

## 8. 落地顺序

1. **M5 单测先行**（为新契约立靶，且不需要改产品代码就能写）
2. **M2 续传重写**（最大价值；M3 的结论依赖它）
3. **M3 `mergeParts` 异步化**（M2 落地后顺手）
4. **M4 CI + `build.mjs` 双写 + engines**（此时测试已齐，CI 一挂就能用）
5. **M1 `--container mp4`**（最大工作量，独立于前四项，放最后）

## 9. 验收标准

- 偏移直写原型的实测结论必须在 TS 实现上复现：4 分片，sha256 与源一致、成功后无残留、模拟断点后重跑 sha 一致、Content-Range 撒谎被拒。
- `--container mp4` 产出物：`ffprobe` 双轨时长正确，`ffmpeg -v error -xerror -i out -f null -` 零错误，seek 到中段解码正常。
- **纪律：禁止对大文件做全量解码校验。** 上一轮对 337MB / 1080p 做全量解码 + 双 buffer 比对导致 16G 机器 OOM。大文件只做 `ffprobe` 头部 + `-t 20` 定长解码。
- CI 在 ubuntu 与 windows 双平台对 Node 20/22 全绿，且故意改一行源码不重新构建时 CI 必须失败（漂移检查自验证）。
- 全量 `npx tsc --noEmit` 与 `npx jest` 通过。

## 10. 不在范围内

| 项 | 理由 |
|---|---|
| 自研流式 fMP4 → 渐进式转换器 | D1；记入 TODOS.md，附触发条件 |
| 完整错误码体系 | 本批只加 `code` 字段；系统性错误分类需要单独设计 |
| eslint / prettier | 仓库当前无 lint 配置，引入是独立议题 |
| 分片失败后的自动跨会话后台重试 | 复杂度远超收益，用户重跑一条命令即可 |
| `darwin-results.tsv` 类内部文件的清理策略 | 已于第一批删除，无需再做 |
| `--quality 120` HEVC/AV1 之外的编码矩阵（E-AC-3 / FLAC / 杜比视界） | 容器搬运与 codec 无关，理论覆盖；待有真实样本再补 |

## 11. 审查记录

本方案经一轮独立子代理对抗式审查（未参与设计）与一轮外部调研，采纳情况：

**采纳**
1. 偏移直写替代"按文件大小猜进度"——原草案会在 200-重写被中断时静默产出错位数据
2. Content-Range 起始偏移强制校验
3. 每分片 fsync 后 rename
4. 跨进程 `.part.lock` 互斥 + `--no-resume` 显式清理孤儿状态
5. 清单以内容身份（key + size）为准，而非 URL
6. `mergeParts` 必须 temp + rename 原子写；多段顺序写需 `{ end: false }`
7. 进度/速度改由单一聚合器计算，消除并发共享可变状态

**未采纳**
1. "跨会话续传不可行，稳定 key 白做"——每次运行都会重新取 playurl，新 URL 指向同一内容，续传成立。该审查结论的前提有误
2. "所有分片直接写同一 fd 的不同偏移"——已采纳，但补充了 `.part` + rename 以保证原子可见性

**外部调研结论**（第 3 节 M1 依据）：`mp4box.js` 是全内存模型且无官方 fragment→progressive flatten；`mp4-muxer` 已废弃且需 WebCodecs 喂数据；`mux.js` 方向相反（TS→fMP4）；`mediabunny` 可做 transmux 但属新增依赖（MPL-2.0）且未对 B 站双轨 fMP4 验证。业界（yutto / BBDown / lux / yt-dlp）普遍直接调用 ffmpeg 或 MP4Box 做容器兼容，下载器不自研。→ 复用已在依赖树里的 tomp4。

---

<!-- AUTONOMOUS DECISION LOG -->
## 决策审计

| # | 阶段 | 决策 | 分类 | 依据原则 | 理由 | 否决项 |
|---|---|---|---|---|---|---|
| 1 | Eng | 渐进式路径复用 tomp4 而非自研流式 | 口味（D1） | P3 务实 / P5 显式 | 可选逃生通道不值得承担 stts/ctts/stss 重建风险；已有验证过的 150 行胶水 | 自研 O(1) 流式转换器 |
| 2 | Eng | 续传改为偏移直写 + 清单 | 机械 | P1 完备 | 审查证明"按大小猜"会静默损坏；直写同时消灭 merge 步骤 | tempDir + 分片文件 + 按大小续传 |
| 3 | Eng | Content-Range 起始偏移强制校验 | 机械 | P1 完备 | 唯一的防静默损坏闸口 | 只信 HTTP 206 |
| 4 | Eng | 每分片 fsync 后 rename | 机械 | P1 完备 | 断电可留空洞，成本极低 | 直接写目标路径 |
| 5 | Eng | 进度/速度改单一聚合器 | 机械 | P5 显式 | 现有实现的速度数字是错的，且与续传代码同函数 | 保留并发共享可变状态 |
| 6 | Eng | `mergeParts` 保留并异步化 | 口味（D3） | P6 行动偏向 | 尊重原始指令；保留为公开工具 | 直接删除 |
| 7 | Eng | 结果数组改为按索引有序写入 | 机械 | P5 显式 | Agent 是主要使用者，输出确定性属契约 | 保留并发 push 的完成顺序 |
| 8 | DX | failures 增加 `code` 字段 | 机械 | P1 完备 | 正在改该结构，Agent 靠字符串匹配错误脆弱 | 只留自然语言 error |
| 9 | DX | `--container` / `--no-resume` 命名 | 机械 | P5 显式 | 与现有 `--no-merge` 前缀风格一致 | `--legacy-mp4` / `--fresh` |
| 10 | CEO | 内存护栏阈值可配 + 报错给路 | 机械 | P1 完备 | 失败模式必须显式，不能把 OOM 丢给用户 | 静默尝试并 OOM |
| 11 | CEO | CI 加入 Windows runner | 口味（D4） | P2 煮沸湖水 | Windows 是主力平台，`ftruncate EPERM` 只有它能抓 | 仅 ubuntu |
| 12 | CEO | engines 提到 20 | 口味（D2） | P3 务实 | Node 18 已 EOL | 保持 18 |
| 13 | CEO | 自研流式转换器延后并记触发条件 | 机械 | P3 务实 | 记录而非丢弃，避免重复决策 | 立即纳入本批 |
