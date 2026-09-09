# pilidown 开发者变更日志

按 commit 记录改动位置，用于回答"这个功能/这个 bug 是哪次改的、当时还动了什么"。面向开发者，不是给用户看的版本发布说明（用户向变更看 README）。

## 记录规则

1. **每次 commit 必须追加一条**，写在文件顶部（最新在上）。
2. 一条记录包含四项：改动文件、性质、是否需重新构建、备注。
3. 改动文件按 `src/` 逻辑模块聚合写，构建产物（`bin/cli.cjs`、`skills/pilidown/bin/cli.cjs`）单独列出。
4. "重新构建"为「是」表示本次改动影响 `cli.cjs` 行为，必须 `npm run build`；若影响对外行为，还要同步 `skills/pilidown/bin/cli.cjs` 与 `skills/pilidown/SKILL.md`。
5. commit message 只写一句话，详细位置写在这里。

### 模板

```
### <short hash> · YYYY-MM-DD · <类型>

- 改动文件：
  - `src/xxx/yyy.ts` — 具体改动
- 性质：feat / fix / refactor / docs / chore
- 重新构建：是 / 否
- 备注：影响面、风险点、后续待办
```

---

## 2026-09-09

### 初始化提交 · 2026-09-09 · docs

（本条即创建本文件的那次提交，hash 无法在文件内自引用，用 `git log -1 -- docs/changelog_developer.md` 查；后续条目照常写 hash）

- 改动文件：
  - `docs/quick_start.md` — **新增**，开发者 onboarding：项目定位、技术栈、分层架构、模块职责、关键机制、构建分发链路、已知缺陷、改动分区（可改 / 谨慎 / 禁改）、常见任务速查、提交前检查
  - `docs/changelog_developer.md` — **新增**，本文件：记录规则、模板，并回填全部 27 个历史 commit
- 性质：docs
- 重新构建：否
- 备注：两个文件此前是 0 字节占位。本次初始化后，后续每个 commit 需在顶部追加一条

### `a0d92a5` · 2026-09-09 · chore

- 改动文件：
  - `skills/pilidown/bin/cli.cjs` — 构建产物同步
  - `src/core/assConverter.ts` — 注释中的仓库引用改为 `pilidown-skills`
- 性质：chore
- 重新构建：是（产物随源码重建后同步）
- 备注：无行为变化。注意 `assConverter.ts` 被连续三次改动（本条、`382c271`、`d569d6e`），实际都是注释/归因文本

### `ef3c2a9` · 2026-09-09 · docs

- 改动文件：
  - `README.md` — 删除部分内容
- 性质：docs
- 重新构建：否
- 备注：无代码改动

### `382c271` · 2026-09-09 · docs

- 改动文件：
  - `README.md` — 归整外部项目 attribution
  - `skills/pilidown/SKILL.md` — 同上
  - `skills/pilidown/bin/cli.cjs` — 构建产物同步
  - `src/core/assConverter.ts` — 头部 attribution 注释
- 性质：docs
- 重新构建：是
- 备注：DownKyi 等来源声明统一收口到 README / SKILL.md，源码文件内不再逐处重复

### `bfb35de` · 2026-09-09 · chore

- 改动文件：
  - `.gitignore` — 增加 `.trae/` 忽略规则
  - `.trae/skills/pilidown/**` — 删除（7 个文件，含 SKILL.md 与 cli.cjs）
  - `README.md` — 移除 `.trae` 相关说明
- 性质：chore
- 重新构建：否
- 备注：Skill 分发目录从 `.trae/skills/` 迁到 `skills/`，平台中立化

### `23f91d9` · 2026-09-09 · docs

- 改动文件：
  - `skills/pilidown/**` — 新增 Skill 分发包：`SKILL.md`、`bin/cli.cjs`、`bin/pilidown`、`bin/pilidown.cmd`、`darwin-results.tsv`、`test-prompts.json`
  - `bin/pilidown.cmd`、`package.json` — 跨平台 wrapper 与元数据
  - `.trae/skills/pilidown/bin/pilidown.cmd` — 旧路径保留
  - `LICENSE`、`README.md` — 文档
- 性质：docs
- 重新构建：否（产物为复制）
- 备注：`darwin-results.tsv` 与 `test-prompts.json` 是内部 eval 记录，会随 Skill 分发给所有使用者，属于应清理项

### `d569d6e` · 2026-09-09 · feat(security)

- 改动文件：
  - `src/commands/status.ts` — **新增** `status` 命令，只输出登录布尔态与推荐默认值
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

### `5210758` · 2026-07-30 · fix(qa)

- 改动文件：
  - `src/commands/download.ts`、`src/commands/fav.ts` — 修正 `--format` 帮助文本
  - `src/utils/downloader.ts` — 分片超时改为「至少 60s + 每 MB 30s」
- 性质：fix
- 重新构建：是
- 备注：ISSUE-001 / ISSUE-002。修复了大分片在小文件固定超时下被中断的问题

### `3d92389` · 2026-07-30 · feat

- 改动文件：
  - `src/utils/media.ts` — **新增**，替代 ffmpeg：tomp4 合并 + decode-aac/lamejs 转码
  - `src/utils/ffmpeg.ts` — **删除**
  - `tests/unit/ffmpeg.test.ts` — **删除**
  - `src/services/DownloadService.ts`、`src/commands/download.ts`、`src/commands/fav.ts` — 改用 `media.ts`
  - `docs/zero-ffmpeg-research.md` — 新增调研文档
  - `package.json`、`package-lock.json` — 依赖替换
- 性质：feat（重大）
- 重新构建：是
- 备注：**本次改动引入了当前两个 P0 缺陷。** 一是 `media.ts` 用 `MP4Parser` 处理 B 站 fMP4，真实场景必然失败；二是 CJS bundle 下 `import.meta.url` 为 `undefined`，导致 mp3 转码 `createRequire(undefined)` 抛错。修复方向见 `docs/zero-ffmpeg-research.md`

## 2026-07-27

### `e74e776` · 2026-07-27 · fix

- 改动文件：
  - `src/services/DownloadService.ts`、`src/services/StreamService.ts` — durl-only（无 DASH）视频的兜底路径
  - `src/api/VideoApi.ts`、`src/types/bili.ts` — 播放地址解析调整
  - `src/commands/stream.ts`、`src/commands/login.ts` — 输出与流程
  - `src/utils/httpClient.ts`、`src/utils/qrcode.ts` — 稳定性
  - `jest.config.js`、`tests/setup.js`、`tests/unit/{historyApi,httpClient,streamService}.test.ts` — 测试稳定性
- 性质：fix
- 重新构建：是
- 备注：`selectStreams` 的 durl 分支（老式 FLV/MP4 单文件）从此可用

### `0506950` · 2026-07-27 · feat(M3+M5)

- 改动文件：
  - `src/services/DownloadService.ts` — 新增 `downloadCollection()`
  - `src/commands/download.ts` — 新增 `--collection`
  - `src/commands/info.ts` — 输出合集信息
  - `src/types/bili.ts` — 新增 `ugc_season` 类型
- 性质：feat
- 重新构建：是
- 备注：输入合集中任一 bvid 即可拉全部分集，命名 `{合集标题}-ep{N}-{分集标题}`

### `ed706e1` · 2026-07-27 · feat(M5)

- 改动文件：
  - `src/commands/download.ts` — 新增 `--audio-quality`
  - `src/commands/stream.ts` — 列出全部可用流
  - `src/services/DownloadService.ts`、`src/services/StreamService.ts` — 增加 `preferAudioId` 传递
- 性质：feat
- 重新构建：是

### `40e037c` · 2026-07-27 · fix(M5)

- 改动文件：
  - `src/commands/{danmaku,download,fav,history,space,stream,subtitle}.ts` — 数值参数解析统一加 radix
- 性质：fix
- 重新构建：是
- 备注：原 `parseInt` 未传 radix 导致 `threads` 为 NaN，产出 0 字节音频。`--codec` 在 `download.ts:22` 仍是裸 `parseInt`，属同类漏网，暂无默认值所以不触发

### `5a55e2f` · 2026-07-27 · fix(M6)

- 改动文件：
  - `src/core/danmakuReader.ts` — protobuf 元素读取字段号从 2 改为 1
  - `tests/unit/danmakuApi.test.ts`、`tests/unit/danmakuReader.test.ts`
- 性质：fix
- 重新构建：是
- 备注：此前弹幕解析结果为空或错位

### `6a5974e` · 2026-07-27 · fix(M9)

- 改动文件：
  - `src/utils/httpClient.ts` — 自动注入 buvid3，遇 `-352` 重试一次
  - `src/services/WbiKeyManager.ts` — 绕过 nav 接口 `-101`
  - `src/types/errors.ts` — 新增 `BILI_CODE_NEED_LOGIN` 常量与注释
  - `tests/unit/httpClient.test.ts`
- 性质：fix
- 重新构建：是
- 备注：`-352` 是反爬风控而非未登录，注释已写明。本条是匿名可用性的关键

### `712b870` · 2026-07-27 · chore

- 改动文件：
  - `package.json` — 版本 `0.1.0`
  - `README.md` — 补 DownKyi attribution
- 性质：chore
- 重新构建：否

### `d00a326` · 2026-07-27 · feat(M9.2)

- 改动文件：
  - `src/api/{BangumiApi,CheeseApi,FavoritesApi,HistoryApi,UserApi}.ts` — **新增** 5 个 API 模块
  - `src/commands/{bangumi,cheese,fav,history,space}.ts` — **新增** 5 个命令
  - `src/index.ts` — 注册
  - `src/api/VideoApi.ts`、`src/types/bili.ts`、`src/utils/wbiSign.ts` — 配套调整
  - `tests/unit/{bangumiApi,cheeseApi,favoritesApi,historyApi,userApi}.test.ts` — 新增测试
- 性质：feat
- 重新构建：是

### `92f38e8` · 2026-07-27 · feat(M5)

- 改动文件：
  - `src/commands/download.ts` — **新增** download 命令
  - `src/services/DownloadService.ts` — **新增** 下载编排
  - `src/utils/downloader.ts` — **新增** 多线程分片下载
  - `src/utils/ffmpeg.ts` — **新增** ffmpeg 封装（后被 `3d92389` 删除）
  - `src/index.ts` — 注册
  - `tests/unit/{downloader,ffmpeg}.test.ts`
- 性质：feat
- 重新构建：是

### `9977a87` · 2026-07-27 · feat(M7)

- 改动文件：无（空提交）
- 性质：feat
- 重新构建：否
- 备注：subtitle 命令的实际代码已包含在 `58ff2ce` 中，本条无文件变更

### `1f10861` · 2026-07-27 · feat(M6)

- 改动文件：
  - `src/commands/danmaku.ts` — **新增** danmaku 命令
  - `src/index.ts` — 注册
- 性质：feat
- 重新构建：是

### `58ff2ce` · 2026-07-27 · feat(M8)

- 改动文件：
  - `src/api/LoginApi.ts`、`src/utils/qrcode.ts` — 二维码生成/轮询/终端渲染/本地 HTTP 页面/PNG
  - `src/api/DanmakuApi.ts`、`src/core/{assConverter,danmakuReader,subtitleConverter}.ts`、`src/commands/subtitle.ts` — 弹幕与字幕基础设施
  - `src/commands/login.ts` — **新增**
  - `src/index.ts`、`src/types/bili.ts` — 注册与类型
  - `package.json`、`package-lock.json` — 新增 qrcode、iconv-lite 依赖
  - `tests/unit/{assConverter,danmakuApi,danmakuReader,loginApi,qrcode,subtitleConverter}.test.ts`
- 性质：feat
- 重新构建：是
- 备注：一次性落地了 M6/M7/M8 三个里程碑的底层代码

### `2de4ba0` · 2026-07-27 · feat(M3+M4)

- 改动文件：
  - `src/api/VideoApi.ts` — **新增** WBI 签名的视频接口
  - `src/services/StreamService.ts` — **新增** 选流策略
  - `src/commands/{info,stream}.ts` — **新增** 两个命令
  - `src/index.ts`、`src/types/bili.ts` — 注册与类型
  - `tests/unit/{streamService,videoApi}.test.ts`
- 性质：feat
- 重新构建：是

### `d8cdc32` · 2026-07-27 · feat(M2)

- 改动文件：
  - `src/utils/httpClient.ts` — **新增** `httpRequest` / `biliGet` / `downloadBuffer`
  - `src/utils/logger.ts` — **新增** JSON Lines / human 双模日志
  - `src/services/CookieService.ts` — **新增** `~/.pilidown/cookies.json` 读写
  - `src/services/WbiKeyManager.ts` — **新增** WBI key 缓存
  - `src/types/errors.ts`、`src/types/bili.ts` — 错误类与响应类型
  - `tests/unit/{cookieService,httpClient,wbiKeyManager}.test.ts`
- 性质：feat
- 重新构建：是
- 备注：基础设施层。`biliGet` 自动加载 cookie 的行为从这里开始，影响所有后续命令

### `7373c46` · 2026-07-26 · feat(M1.4)

- 改动文件：
  - `src/core/parseEntrance.ts` — **新增**
  - `tests/unit/parseEntrance.test.ts`
- 性质：feat
- 重新构建：是

### `e94508b` · 2026-07-26 · feat(M1.2)

- 改动文件：
  - `src/core/wbi.ts` — **新增** WBI 签名算法
  - `tests/unit/wbi.test.ts` — 含官方测试向量
- 性质：feat
- 重新构建：是

### `50835bb` · 2026-07-26 · feat(M1.3)

- 改动文件：
  - `src/core/constants.ts` — **新增** 画质/音质/编码 ID 表与 FNVAL 位掩码
  - `tests/unit/constants.test.ts`
- 性质：feat
- 重新构建：是

### `7487644` · 2026-07-26 · feat(M1.1)

- 改动文件：
  - `src/core/bvid.ts` — **新增** BV ↔ AV 互转
  - `src/types/index.ts`、`tests/unit/bvid.test.ts`
- 性质：feat
- 重新构建：是

### `000f9b3` · 2026-07-26 · chore

- 改动文件：
  - `package.json`、`package-lock.json`、`tsconfig.json`、`jest.config.js`、`build.mjs` — 工具链
  - `src/index.ts` — CLI 骨架
  - `bin/pilidown`、`bin/pilidown.cmd`、`bin/pilidown.js` — 跨平台 wrapper
  - `.gitattributes`、`.gitignore`、`README.md`
  - `docs/plans/{checklist,spec,tasks}.md` — 计划文档（`spec.md` 为 0 字节空文件）
- 性质：chore
- 重新构建：否
- 备注：项目初始化。`.gitignore` 从此忽略 `bin/cli.cjs`，是 fresh clone 需先 build 的根源
