# pilidown 开发者变更日志

一切从这里开始吧，请标明commit，时间，如使用agent辅助开发与编辑此条目，一并列出agent名与模型（如agent的系统提示词明确表述自己的底层模型则列出，无则不需要）
如 commit ABCDEF,2026-09-10,Codex,GPT-6-Astra

---

## 本文件用途

按 commit 记录改动了哪处，回答"这个功能/这个 bug 是哪次改的、当时还动了什么"。面向开发者，不是给用户看的版本发布说明（用户向变更看 README）。

## 条目格式

```
### <commit> · <时间> · <agent>[/<模型>] · <类型>

- 改动文件：
  - `src/xxx/yyy.ts` — 具体改动
- 性质：feat / fix / refactor / docs / chore
- 重新构建：是 / 否
- 备注：影响面、风险点、后续待办
```

- 改动文件按 `src/` 逻辑模块聚合；构建产物（`bin/cli.cjs`、`skills/pilidown/bin/cli.cjs`）单独列出
- "重新构建：是"表示影响 `cli.cjs` 行为，必须 `npm run build`；若影响对外行为，还要同步 `skills/pilidown/bin/cli.cjs` 与 `skills/pilidown/SKILL.md`
- 新条目追加在文件顶部（最新在上）
- commit message 只写一句话，详细位置写在这里

## agent 标注说明

- 以提交里的 `Co-authored-by` trailer 为准：2026-09-09 的 5 个提交带 `Codex / Gemini / Claude` 三个 trailer，无法区分各自贡献，全部列出
- 无 trailer 的提交记 `未记录`，不臆测。2026-07-26 ~ 07-30 那批提交无署名信息，其提交信息格式与源码 `// ponytail:` 注释风格一致，但无证据指向具体 agent，故不写
- 模型只在对应 agent 的系统提示明确表述底层模型时列出，否则留空
- 记录当前 commit 自身时无法在文件内写自身 hash（写入后 amend 会改变 hash），此时省略 hash，用「日期 + agent + 类型」定位，或用 `git log -1 -- docs/changelog_developer.md` 查询

## 2026-09-10

### 2026-09-10 · Antigravity/Gemini 3.8 Flash · chore（发布 v0.2.0 版本）

- 改动文件：
  - `package.json` — 版本提升至 `0.2.0`。
  - `package-lock.json` — 根版本同步提升至 `0.2.0`。
  - `src/index.ts` — CLI 程序声明版本更新为 `0.2.0`。
  - `bin/cli.cjs`、`skills/pilidown/bin/cli.cjs` — 重新构建同步版本字符串至 `0.2.0`。
- 性质：chore(release)
- 重新构建：是
- 备注：v0.2.0 正式发布版本。包含 P1 第二批核心特性（断点续传直写与清单机制、渐进式 MP4 容器合并与内存护栏、批处理 failures 分类与确定性排序、GitHub Actions 自动化 CI 矩阵）以及 Darwin Skill 8 维度评估优化。

### 2026-09-10 · Antigravity/Gemini 3.8 Flash · docs（Skill 瘦身防过拟合与外部 FFmpeg 降级 SOP 落地）

- 改动文件：
  - `skills/pilidown/SKILL.md` — 依照 Progressive Disclosure（渐进式揭示）原则进行深度重构与瘦身：行数从 247 行削减至 51 行（缩减 79%），体积减少 64%（~4.3KB）；合并冗余的双轨命令模板与工作流，移除诱发模型幻觉的静态硬编码码率表，推行动态流探测原则；补齐关键的外部 FFmpeg 降级接盘 SOP（4步容灾流程），形成 100% 交付闭环。
- 性质：docs（优化 Skill Prompt，消除 Agent 过拟合与上下文浪费）

### 2026-09-10 · Antigravity/Gemini 3.8 Flash · feat（P1 第二批方案全面落地）

- 改动文件：
  - `src/utils/box.ts` — **新增**。提取通用的 MP4 box 解析与构造工具（`topBoxes`, `childBoxes`, `find`, `findAll`, `createBox`, 字节读写函数等）。
  - `src/utils/mp4.ts` — **新增**。渐进式双轨 MP4 容器无损合并（移植自 `merge-mp4.mjs`，包含 trak 搬迁、trackId 重编号、`stco`/`co64` 采样偏移修正、`mvhd` 时长修正、流式分块写入与原子替换）。
  - `src/utils/media.ts` — 新增 `mergeDashStreamsProgressive`，集成输入体积 5 倍内存预检护栏（默认 4GB，可配 `--max-media-mem`，超限明确提示出路）；`mergeDashStreams` 增加 `container` 选项调度。
  - `src/utils/downloader.ts` — 落地字节级断点续传（偏移直写 `pwrite` + `.partstate.json` 清单，强校验 `Content-Range` 起始偏移，单分片 4 次重试退避，跨进程 `.part.lock` 保护，单一聚合器精确进度速度计算）；`mergeParts` 改造为流式异步 + 原子写。
  - `src/services/DownloadService.ts` — `DownloadFailure` 增加 `code` 错误分类码（`E_HTTP` / `E_MERGE` / `E_EXPIRED_URL` / `E_DISK` / `E_UNSUPPORTED`）；`downloadAllPages` 与 `downloadCollection` 预分配数组保证确定性页码顺序输出；透传 `container`、`noResume`、`maxMediaMemMb` 参数。
  - `src/commands/download.ts` — 增加 `--container <fmp4|mp4>`（默认 fmp4）、`--no-resume` 与 `--max-media-mem <mb>` 选项。
  - `.github/workflows/ci.yml` — **新增**。跨平台 CI 矩阵（Ubuntu + Windows × Node 20 / 22），包含类型检查、全套单测、构建及双分发产物漂移拦截（`git diff --exit-code`）。
  - `build.mjs` — 打包脚本升级为一次构建同时输出/同步 `bin/cli.cjs` 与 `skills/pilidown/bin/cli.cjs`，从构建根源消除副本漂移；目标平台调优为 node20。
  - `package.json` — 更新 `engines.node` 为 `>=20.0.0`。
  - `skills/pilidown/SKILL.md`、`README.md` — 更新 Node 20+ 要求与新增参数文档说明。
  - `tests/unit/downloadService.test.ts` — **新增**。为 `DownloadService` 补齐 8 个测试用例（覆盖全成功、部分失败 code 收集、全失败、确定性结果顺序、UGC 合集映射等）。
  - `tests/unit/mp4.test.ts` — **新增**。渐进式 MP4 解析、双轨合并及内存护栏拦截测试。
  - `tests/unit/downloader.test.ts` — 适配异步 `mergeParts`，并补充清单断点续传、Content-Range 错位拦截、200 忽略 Range 拦截、`--no-resume` 重置等测试。
  - `bin/cli.cjs`、`skills/pilidown/bin/cli.cjs` — 重新构建同步最新分发产物。
- 性质：feat（含 refactor / test / docs / chore）
- 重新构建：是（双份产物哈希一致且无漂移）
- 备注：P1 方案 5 大模块（M1~M5）已全部落地。tsc 零错误，Jest 24 个套件 257 个单测全部通过。

### 2026-09-10 · WorkBuddy · docs（交付整理）

（commit 见 `git log -1 -- docs/plans/prototypes/README.md`）

- 改动文件：
  - `docs/plans/prototypes/` — **新增**。把制定方案用的可运行验证脚本收进仓库：`merge-mp4.mjs`（渐进式双轨合并，M1 依据）、`resume-prototype.mjs`（偏移直写 + 清单续传，5 个用例，M2 依据）、`README.md`（各自服务哪条方案、怎么跑、已经验证了什么、Windows `EPERM` 坑）
  - `docs/quick_start.md` — 新增第 0 节「接手开发读什么」文档路由表；修正仓库地图的 docs 树；修正过时内容（用例数 233 → 242、`.gitignore` 忽略 `bin/cli.cjs` 的说明已失效，产物已入库且可复现）；修正媒体依赖表（`@audio/decode-aac`/`@breezystack/lamejs` 已移除）；「改媒体处理」章节改为指向 fmp4.ts 与 p0-fix-plan，并补入禁止对 GB 级文件全量解码的校验纪律
  - `docs/zero-ffmpeg-research.md` — 顶部加历史文档警示：结论已过时，照它实施正是两个 P0 的来源；「GPL 传染可接受」的前提已被推翻（最终移除 mp3 保持 MIT）
  - `TODOS.md` — 新增「尚未纳入任何计划的遗留问题」两节：Cookie 凭据明文存储 / Windows 无权限收紧 / 非原子写，以及非 JSON 模式下进度条与日志交错
- 性质：docs
- 重新构建：否
- 备注：为交付给其他开发者接手做整理。核查中发现 `docs/zero-ffmpeg-research.md` 一直没被标记为过时，而它正是引入两个 P0 的历史方案，接手者按它实施会重走弯路

### 2026-09-10 · WorkBuddy · docs（P1 第二批方案）

（commit 见 `git log -1 -- docs/plans/p1-batch2-plan.md`）

- 改动文件：
  - `docs/plans/p1-batch2-plan.md` — **新增**。第二批方案：`--container mp4` 渐进式兼容路径（复用 tomp4 `convertFmp4ToMp4` + box 级合并，内存 4.7x 配预检护栏；自研 O(1) 流式转换器延后）、字节级续传（**偏移直写 + `.partstate.json` 清单**替代 tempDir + 分片文件）、`mergeParts` 异步化（`pipeline` + temp/rename 原子写，并退出下载关键路径）、CI（2 OS × 2 Node + 产物漂移检查）、批处理 failures 单测。含架构图、测试图谱、失败模式登记、5 个决策点、落地顺序、验收标准
  - `TODOS.md` — **新增**。5 条已决策延后事项，每条附触发条件
- 性质：docs
- 重新构建：否
- 备注：**续传原设计草案被独立审查否决**——"按文件大小推断已完成字节数"会在「服务器返回 200 忽略 Range、且这次重写写到一半被杀」时静默产出错位数据（残留分片装的是整文件前 N 字节而非该分片第 N 字节）。改为偏移直写 + 清单，并强制校验 `Content-Range` 起始偏移。原型实测 5 个用例全过（见 `docs/plans/p1-batch2-plan.md` 第 9 节验收标准的来源）：字节 sha256 一致、断点续传后 sha 一致、Content-Range 撒谎被拒、服务器忽略 Range 被拒。**Windows 平台差异实测踩出**：`FileHandle.truncate()` 在 `'a+'` 模式返回 `EPERM`，必须用 `'r+'` 且文件需先存在。外部调研结论：`mp4box.js`（全内存、无官方 flatten）、`mp4-muxer`（已废弃、需 WebCodecs）、`mux.js`（方向相反）、`mediabunny`（可 transmux 但为新增 MPL-2.0 依赖且未对 B 站双轨验证）；业界 yutto / BBDown / lux / yt-dlp 均直接调用 ffmpeg 或 MP4Box 做容器兼容，故复用已在依赖树里的 tomp4

### 2026-09-10 · WorkBuddy · fix（P0 修复第一批）

（commit 见 `git log -1 -- src/utils/fmp4.ts`）

- 改动文件：
  - `src/utils/fmp4.ts` — **新增**。fMP4 直通合并：双轨 moov 重建（两 trak + 双 trex，trackID 重编号）、逐片段搬 moof/mdat、tfhd 统一改 `default-base-is-moof`、trun data_offset 按 `corr = 新moof长 + base − 源moof起点 − 源moof长` 修正、mdat 4MB 分块拷贝带反压、原子写（`.part` → rename）。内存 O(1)：337MB 输入 RSS+15MB。含 9 个结构单测（`tests/unit/fmp4.test.ts`），覆盖 B 站（tfhd 0x20038 无显式 base）与 ffmpeg（0x39 显式 base）两种形态
  - `src/utils/media.ts` — 重写。`mergeDashStreams` 改走直通合并；新增 `audioStreamToM4a`（`convertFmp4ToMp4` 一步出标准 m4a）；删除 `extractVideoAccessUnits`/`extractAudioAccessUnits`/`splitAvccNalus`/`transcodeToMp3`/`extractAudioFromMp4`/`floatToInt16` 及 MP4Parser 路径（-271 行）
  - `src/services/DownloadService.ts` — 合并/转码失败不再 catch 吞掉，直接 throw；`downloadAllPages`/`downloadCollection` 改返回 `{ results, failures }`；`--format` 只接受 m4a，mp3 给明确弃用错误；durl + `--audio-only` 明确报错（原为静默保留原文件）；路径拼接统一 `path.join`；`extForVideo`/`extForAudio` 死分支简化
  - `src/commands/download.ts` — `--codec` 补 `parseInt(v,10)`；`--all`/`--collection` 输出 failures（JSON 带 `failures` 数组）并在有失败时 `exitCode=1`；`--format` 默认 m4a
  - `src/commands/fav.ts` — `--format` 默认 m4a；批量失败时 `exitCode=1`
  - `src/commands/bangumi.ts`、`src/commands/cheese.ts` — 新增 `--show-url` 门控，默认不再输出 CDN 临时流 URL（JSON 与 human 两条路径都改）
  - `skills/pilidown/SKILL.md` — 退出码契约改为"0 成功 / 1 失败且带 failures 数组"；合并与 mp3 描述同步
  - `README.md` — "零外部二进制依赖"宣传改为 fMP4 直通合并表述
  - `docs/quick_start.md` — 媒体处理章节、构建章节、已知缺陷区、禁改表同步（原缺陷 1–4 标记为已修复，新增 fMP4 容器兼容性等 6 条现存注意点）
  - `package.json` / `package-lock.json` — 移除 `@audio/decode-aac`（GPL-2.0）与 `@breezystack/lamejs`
  - `bin/cli.cjs`、`skills/pilidown/bin/cli.cjs` — 重新构建（两份 sha256 一致）；`.gitignore` 移除对 `bin/cli.cjs` 的忽略，产物入库
  - 删除：`docs/plans/spec.md`（0 字节）、`skills/pilidown/darwin-results.tsv`、`skills/pilidown/test-prompts.json`（内部 eval 记录）
- 性质：fix（含 refactor / chore）
- 重新构建：是（`bin/cli.cjs` 与 `skills/pilidown/bin/cli.cjs` 已同步，产物 364KB → 257KB）
- 备注：本机实测结论——真实 B 站流合并（AVC 118 片段，ffprobe 双轨 295s，前 20s 全解码零错误）；HEVC 1080p 端到端通过（`--quality 120 --codec 12`）；`--audio-only` 产出 7MB m4a；`--format mp3` exit 1；故意截断视频文件后合并失败 exit 1 且报错定位到字节偏移。`tsc --noEmit` 通过，jest 22 套件 242 用例全绿。未做：`--container mp4` 渐进式兼容路径、多线程下载字节级续传、`mergeParts` 异步化、CI（见 `docs/plans/p0-fix-plan.md` 第 5 节余下步骤）

---

## 2026-09-09

### 2026-09-09 · WorkBuddy · docs

（T1 新方向 + T2 建议 + T3/T4 拍板落档；commit 见 `git log -1 -- docs/plans/p0-fix-plan.md`）

- 改动文件：
  - `docs/plans/p0-fix-plan.md` — T1 二轮调研结论：**fMP4 直通合并**替代 convert+box 合并成为主路径（跳过 `convertFmp4ToMp4`，内存 4.7x → O(1)，337MB 输入 RSS+15MB；真实 B 站流 118 片段 69ms RSS+3MB 全解码零错误）。M1 重写（tfhd 改写规则、hadBase 判定坑、sidx/mfra 丢弃、两种 tfhd 形态 fixture 要求、验证纪律：禁止 GB 级文件全量解码）；M2 写入砍 mp3 建议与理由；M6 的 convert 内存段落删除；决策点表更新（T1 已解决 / T2 建议砍 / T3 不改名 / T4 提交）；新增第 8 节原型验证记录
- 性质：docs
- 重新构建：否
- 备注：用户对 T1 否决"延后"方案并要求找新方向；fMP4 直通合并为本机实测验证（原型 ~250 行）。调研期间曾因对 337MB 文件做全量解码 + node 持有双 337MB 比对 buffer 把 16GB 机器压到 OOM，get_buffer 报错归因为资源叠加而非数据错误（mdat 逐字节一致），教训写入 M1 验收纪律。T3/T4 由用户确认按原建议执行，T2 待用户最终拍板

### 2026-09-09 · WorkBuddy · docs

（P0 修复方案入库；commit 见 `git log -1 -- docs/plans/p0-fix-plan.md`）

- 改动文件：
  - `docs/plans/p0-fix-plan.md` — 新增。P0/P1/P2 修复方案：合并链路重写（convertFmp4ToMp4 + 流式 box 合并）、音频导出默认 m4a、失败可见性与退出码、产物入库、URL 门控、内存护栏与原子写、测试与 CI、一致性清理；附实测数据、失败模式登记、落地顺序、4 个决策点、独立审查采纳记录
- 性质：docs
- 重新构建：否
- 备注：方案中的实测均在本机完成（AVC/HEVC/AV1 真实流、337MB 大文件内存、四种打包配置、构建可复现 sha256）；独立审查提出的 elst/mvex 风险已实测排除，内存护栏、原子写、测试矩阵缺口已采纳进方案

### 2026-09-09 · WorkBuddy · docs

（本条记录紧随其后的那次提交，commit 见 `git log -1 -- docs/changelog_developer.md`）

- 改动文件：
  - `docs/changelog_developer.md` — 重排：顶部保留初始说明原文；条目格式改为 `commit · 时间 · agent[/模型] · 类型`；每条补 agent 标注；新增「agent 标注说明」小节；按日期拆分 2026-07-26 组；`3d92389` 备注补充提交正文里的 `License MIT to GPL-2.0` 事实
  - `docs/quick_start.md` — 提交前检查第 5 条对齐新格式；文末标注由 WorkBuddy 初始化
- 性质：docs
- 重新构建：否
- 备注：起因是未按文件初始说明标明 agent 与模型。历史条目中 `ef3c2a9` 与 2026-07-26 ~ 07-30 全部提交无 `Co-authored-by` trailer，一律记「未记录」，未作推测

### d1035e8 · 2026-09-09 · WorkBuddy · docs

- 改动文件：
  - `docs/quick_start.md` — 新增。开发者 onboarding：项目定位与双形态分发、环境准备、仓库地图、技术栈、分层架构与两条数据流、模块职责、关键机制（WBI / Cookie / buvid3 / 选流 / 多线程下载 / 零 FFmpeg）、构建分发链路、已知缺陷、改动分区（放心改 / 需谨慎 / 禁改）、常见任务速查、编码约定、提交前检查
  - `docs/changelog_developer.md` — 新增。本文件：记录格式与 agent 标注规则，回填此前全部 27 个 commit 的改动位置、性质、是否需重新构建、备注
- 性质：docs
- 重新构建：否
- 备注：两个文件此前是 0 字节占位文件（未纳入版本库）。本条是文件初始化提交，hash 为提交后回填

### a0d92a5 · 2026-09-09 · Codex / Gemini / Claude · chore

- 改动文件：
  - `skills/pilidown/bin/cli.cjs` — 构建产物同步
  - `src/core/assConverter.ts` — 注释中的仓库引用改为 `pilidown-skills`
- 性质：chore
- 重新构建：是（产物随源码重建后同步）
- 备注：无行为变化。`assConverter.ts` 被连续三次改动（本条、`382c271`、`d569d6e`），实际都只动注释/归因文本

### ef3c2a9 · 2026-09-09 · 未记录 · docs

- 改动文件：
  - `README.md` — 删除部分内容
- 性质：docs
- 重新构建：否
- 备注：无代码改动。提交正文为 `Updated README.md for formatting and content clarity.`，无 Co-authored-by trailer

### 382c271 · 2026-09-09 · Codex / Gemini / Claude · docs

- 改动文件：
  - `README.md` — 归整外部项目 attribution
  - `skills/pilidown/SKILL.md` — 同上
  - `skills/pilidown/bin/cli.cjs` — 构建产物同步
  - `src/core/assConverter.ts` — 头部 attribution 注释
- 性质：docs
- 重新构建：是
- 备注：DownKyi 等来源声明统一收口到 README / SKILL.md，源码文件内不再逐处重复

### bfb35de · 2026-09-09 · Codex / Gemini / Claude · chore

- 改动文件：
  - `.gitignore` — 增加 `.trae/` 忽略规则
  - `.trae/skills/pilidown/**` — 删除（7 个文件，含 SKILL.md 与 cli.cjs）
  - `README.md` — 移除 `.trae` 相关说明
- 性质：chore
- 重新构建：否
- 备注：Skill 分发目录从 `.trae/skills/` 迁到 `skills/`，平台中立化

### 23f91d9 · 2026-09-09 · Codex / Gemini / Claude · docs

- 改动文件：
  - `skills/pilidown/**` — 新增 Skill 分发包：`SKILL.md`、`bin/cli.cjs`、`bin/pilidown`、`bin/pilidown.cmd`、`darwin-results.tsv`、`test-prompts.json`
  - `bin/pilidown.cmd`、`package.json` — 跨平台 wrapper 与元数据
  - `.trae/skills/pilidown/bin/pilidown.cmd` — 旧路径保留
  - `LICENSE`、`README.md` — 文档
- 性质：docs
- 重新构建：否（产物为复制）
- 备注：`darwin-results.tsv` 与 `test-prompts.json` 是内部 eval 记录，会随 Skill 分发给所有使用者，属于应清理项

### d569d6e · 2026-09-09 · Codex / Gemini / Claude · feat(security)

- 改动文件：
  - `src/commands/status.ts` — 新增 `status` 命令，只输出登录布尔态与推荐默认值
  - `src/commands/login.ts` — JSON 输出脱敏，不再泄漏凭据
  - `src/commands/bangumi.ts`、`src/commands/cheese.ts`、`src/commands/download.ts`、`src/commands/fav.ts`、`src/commands/stream.ts` — 输出与参数调整
  - `src/index.ts` — 注册 `status`
  - `src/utils/downloader.ts` — 下载超时改为按分片大小比例计算
  - `tests/unit/downloader.test.ts` — 同步更新
  - `scripts/diagnose-playurl.cjs`、`scripts/diagnose-playurl.ts` — 新增排查脚本
  - `.trae/skills/pilidown/**` — 首次打包 Skill
  - `README.md`、`package.json`
- 性质：feat + security
- 重新构建：是
- 备注：`status` 命令是 Agent 侧登录态探测的标准入口；`bangumi.ts` / `cheese.ts` 无条件打印流 URL 的问题在本次改动后仍存在

## 2026-07-30

### 5210758 · 2026-07-30 · 未记录 · fix(qa)

- 改动文件：
  - `src/commands/download.ts`、`src/commands/fav.ts` — 修正 `--format` 帮助文本
  - `src/utils/downloader.ts` — 分片超时改为「至少 60s + 每 MB 30s」
- 性质：fix
- 重新构建：是
- 备注：ISSUE-001 / ISSUE-002。修复大分片在固定超时下被中断的问题

### 3d92389 · 2026-07-30 · 未记录 · feat

- 改动文件：
  - `src/utils/media.ts` — 新增，替代 ffmpeg：tomp4 合并 + decode-aac/lamejs 转码
  - `src/utils/ffmpeg.ts` — 删除
  - `tests/unit/ffmpeg.test.ts` — 删除
  - `src/services/DownloadService.ts`、`src/commands/download.ts`、`src/commands/fav.ts` — 改用 `media.ts`
  - `docs/zero-ffmpeg-research.md` — 新增调研文档
  - `package.json`、`package-lock.json` — 依赖替换
- 性质：feat（重大）
- 重新构建：是
- 备注：**本次改动引入了当前两个 P0 缺陷。** 一是 `media.ts` 用 `MP4Parser` 处理 B 站 fMP4，真实场景必然失败；二是 CJS bundle 下 `import.meta.url` 为 `undefined`，mp3 转码 `createRequire(undefined)` 抛错。修复方向见 `docs/zero-ffmpeg-research.md`。提交正文写有 `License MIT to GPL-2.0`，指新增依赖 `@audio/decode-aac` 为 GPL-2.0

## 2026-07-27

### e74e776 · 2026-07-27 · 未记录 · fix

- 改动文件：
  - `src/services/DownloadService.ts`、`src/services/StreamService.ts` — durl-only（无 DASH）视频的兜底路径
  - `src/api/VideoApi.ts`、`src/types/bili.ts` — 播放地址解析调整
  - `src/commands/stream.ts`、`src/commands/login.ts` — 输出与流程
  - `src/utils/httpClient.ts`、`src/utils/qrcode.ts` — 稳定性
  - `jest.config.js`、`tests/setup.js`、`tests/unit/{historyApi,httpClient,streamService}.test.ts` — 测试稳定性
- 性质：fix
- 重新构建：是
- 备注：`selectStreams` 的 durl 分支（老式 FLV/MP4 单文件）从此可用；`biliGet` 自动加载 cookie 与 buvid3 `-352` 重试也在本次落地

### 0506950 · 2026-07-27 · 未记录 · feat(M3+M5)

- 改动文件：
  - `src/services/DownloadService.ts` — 新增 `downloadCollection()`
  - `src/commands/download.ts` — 新增 `--collection`
  - `src/commands/info.ts` — 输出合集信息
  - `src/types/bili.ts` — 新增 `ugc_season` 类型
- 性质：feat
- 重新构建：是
- 备注：输入合集中任一 bvid 即可拉全部分集，命名 `{合集标题}-ep{N}-{分集标题}`。提交正文记录实测 BV1D4f5BTEE8（512 集合集）

### ed706e1 · 2026-07-27 · 未记录 · feat(M5)

- 改动文件：
  - `src/commands/download.ts` — 新增 `--audio-quality`
  - `src/commands/stream.ts` — 列出全部可用流
  - `src/services/DownloadService.ts`、`src/services/StreamService.ts` — 增加 `preferAudioId` 传递
- 性质：feat
- 重新构建：是
- 备注：提交正文记录实测：30280 音轨 28.19MB → 30216 为 13.15MB

### 40e037c · 2026-07-27 · 未记录 · fix(M5)

- 改动文件：
  - `src/commands/{danmaku,download,fav,history,space,stream,subtitle}.ts` — 数值参数解析统一加 radix
- 性质：fix
- 重新构建：是
- 备注：根因是 commander 把 defaultValue 作为第二参数传给 parseArg，`parseInt("8", 8)` 返回 NaN → 分片数 0 → 0 字节音频。`--codec` 在 `download.ts:22` 仍是裸 `parseInt`，属同类漏网，暂无默认值所以不触发

### 5a55e2f · 2026-07-27 · 未记录 · fix(M6)

- 改动文件：
  - `src/core/danmakuReader.ts` — protobuf 元素读取字段号从 2 改为 1
  - `tests/unit/danmakuApi.test.ts`、`tests/unit/danmakuReader.test.ts`
- 性质：fix
- 重新构建：是
- 备注：此前弹幕解析结果为空或错位

### 6a5974e · 2026-07-27 · 未记录 · fix(M9)

- 改动文件：
  - `src/utils/httpClient.ts` — 自动注入 buvid3，遇 `-352` 重试一次
  - `src/services/WbiKeyManager.ts` — 绕过 nav 接口 `-101`
  - `src/types/errors.ts` — 新增 `BILI_CODE_NEED_LOGIN` 常量与注释
  - `tests/unit/httpClient.test.ts`
- 性质：fix
- 重新构建：是
- 备注：`-352` 是反爬风控而非未登录，注释已写明。本条是匿名可用性的关键

### 712b870 · 2026-07-27 · 未记录 · chore

- 改动文件：
  - `package.json` — 版本 `0.1.0`
  - `README.md` — 补 DownKyi attribution
- 性质：chore
- 重新构建：否

### d00a326 · 2026-07-27 · 未记录 · feat(M9.2)

- 改动文件：
  - `src/api/{BangumiApi,CheeseApi,FavoritesApi,HistoryApi,UserApi}.ts` — 新增 5 个 API 模块
  - `src/commands/{bangumi,cheese,fav,history,space}.ts` — 新增 5 个命令
  - `src/index.ts` — 注册
  - `src/api/VideoApi.ts`、`src/types/bili.ts`、`src/utils/wbiSign.ts` — 配套调整
  - `tests/unit/{bangumiApi,cheeseApi,favoritesApi,historyApi,userApi}.test.ts` — 新增测试
- 性质：feat
- 重新构建：是

### 92f38e8 · 2026-07-27 · 未记录 · feat(M5)

- 改动文件：
  - `src/commands/download.ts` — 新增 download 命令
  - `src/services/DownloadService.ts` — 新增下载编排
  - `src/utils/downloader.ts` — 新增多线程分片下载
  - `src/utils/ffmpeg.ts` — 新增 ffmpeg 封装（后被 `3d92389` 删除）
  - `src/index.ts` — 注册
  - `tests/unit/{downloader,ffmpeg}.test.ts`
- 性质：feat
- 重新构建：是

### 9977a87 · 2026-07-27 · 未记录 · feat(M7)

- 改动文件：无（空提交）
- 性质：feat
- 重新构建：否
- 备注：subtitle 命令的实际代码已包含在 `58ff2ce` 中，本条无文件变更

### 1f10861 · 2026-07-27 · 未记录 · feat(M6)

- 改动文件：
  - `src/commands/danmaku.ts` — 新增 danmaku 命令
  - `src/index.ts` — 注册
- 性质：feat
- 重新构建：是

### 58ff2ce · 2026-07-27 · 未记录 · feat(M8)

- 改动文件：
  - `src/api/LoginApi.ts`、`src/utils/qrcode.ts` — 二维码生成/轮询/终端渲染/本地 HTTP 页面/PNG
  - `src/api/DanmakuApi.ts`、`src/core/{assConverter,danmakuReader,subtitleConverter}.ts`、`src/commands/subtitle.ts` — 弹幕与字幕基础设施
  - `src/commands/login.ts` — 新增
  - `src/index.ts`、`src/types/bili.ts` — 注册与类型
  - `package.json`、`package-lock.json` — 新增 qrcode、iconv-lite 依赖
  - `tests/unit/{assConverter,danmakuApi,danmakuReader,loginApi,qrcode,subtitleConverter}.test.ts`
- 性质：feat
- 重新构建：是
- 备注：一次性落地 M6/M7/M8 三个里程碑的底层代码

### 2de4ba0 · 2026-07-27 · 未记录 · feat(M3+M4)

- 改动文件：
  - `src/api/VideoApi.ts` — 新增 WBI 签名的视频接口
  - `src/services/StreamService.ts` — 新增选流策略
  - `src/commands/{info,stream}.ts` — 新增两个命令
  - `src/index.ts`、`src/types/bili.ts` — 注册与类型
  - `tests/unit/{streamService,videoApi}.test.ts`
- 性质：feat
- 重新构建：是

### d8cdc32 · 2026-07-27 · 未记录 · feat(M2)

- 改动文件：
  - `src/utils/httpClient.ts` — 新增 `httpRequest` / `biliGet` / `downloadBuffer`
  - `src/utils/logger.ts` — 新增 JSON Lines / human 双模日志
  - `src/services/CookieService.ts` — 新增 `~/.pilidown/cookies.json` 读写
  - `src/services/WbiKeyManager.ts` — 新增 WBI key 缓存
  - `src/types/errors.ts`、`src/types/bili.ts` — 错误类与响应类型
  - `tests/unit/{cookieService,httpClient,wbiKeyManager}.test.ts`
- 性质：feat
- 重新构建：是
- 备注：基础设施层。`biliGet` 自动加载 cookie 的行为从这里开始，影响所有后续命令

## 2026-07-26

### 7373c46 · 2026-07-26 · 未记录 · feat(M1.4)

- 改动文件：
  - `src/core/parseEntrance.ts` — 新增
  - `tests/unit/parseEntrance.test.ts`
- 性质：feat
- 重新构建：是

### e94508b · 2026-07-26 · 未记录 · feat(M1.2)

- 改动文件：
  - `src/core/wbi.ts` — 新增 WBI 签名算法
  - `tests/unit/wbi.test.ts` — 含官方测试向量
- 性质：feat
- 重新构建：是

### 50835bb · 2026-07-26 · 未记录 · feat(M1.3)

- 改动文件：
  - `src/core/constants.ts` — 新增画质/音质/编码 ID 表与 FNVAL 位掩码
  - `tests/unit/constants.test.ts`
- 性质：feat
- 重新构建：是

### 7487644 · 2026-07-26 · 未记录 · feat(M1.1)

- 改动文件：
  - `src/core/bvid.ts` — 新增 BV ↔ AV 互转
  - `src/types/index.ts`、`tests/unit/bvid.test.ts`
- 性质：feat
- 重新构建：是

### 000f9b3 · 2026-07-26 · 未记录 · chore

- 改动文件：
  - `package.json`、`package-lock.json`、`tsconfig.json`、`jest.config.js`、`build.mjs` — 工具链
  - `src/index.ts` — CLI 骨架
  - `bin/pilidown`、`bin/pilidown.cmd`、`bin/pilidown.js` — 跨平台 wrapper
  - `.gitattributes`、`.gitignore`、`README.md`
  - `docs/plans/{checklist,spec,tasks}.md` — 计划文档（`spec.md` 为 0 字节空文件）
- 性质：chore
- 重新构建：否
- 备注：项目初始化。`.gitignore` 从此忽略 `bin/cli.cjs`，是 fresh clone 需先 build 的根源
