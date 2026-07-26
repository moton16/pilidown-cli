# pilidown 任务清单

> 基于 spec.md 拆分的可执行任务，每个任务遵循 TDD：写测试 → 看失败 → 实现 → 看通过 → 提交。

---

## M0：项目骨架（1h）

### Task M0.1：初始化项目
- [ ] 创建 `package.json`（name: pilidown, type: commonjs, bin: ./bin/pilidown.cmd）
- [ ] 创建 `tsconfig.json`（strict: true, target: ES2022, module: CommonJS）
- [ ] 创建 `.gitignore`（node_modules/, dist/, bin/cli.cjs, *.log）
- [ ] 创建 `README.md`（最小描述）
- [ ] `git init` + 首次 commit

### Task M0.2：配置构建工具链
- [ ] 安装 devDependencies: `esbuild typescript @types/node jest ts-jest @types/jest`
- [ ] 创建 `build.mjs`（esbuild 配置：bundle + platform=node + format=cjs + outfile=bin/cli.cjs）
- [ ] 创建 `jest.config.js`（preset: ts-jest, testEnvironment: node）
- [ ] package.json 添加 scripts: `build`, `test`, `typecheck`
- [ ] 写一个 `src/index.ts` 输出 "hello pilidown"，跑 `npm run build` 验证产出 `bin/cli.cjs`
- [ ] commit

### Task M0.3：编写 wrapper 脚本
- [ ] 创建 `bin/pilidown.cmd`（Windows wrapper，where node 探测）
- [ ] 创建 `bin/pilidown`（Unix wrapper，command -v node 探测，chmod +x）
- [ ] 手动测试：`./bin/pilidown.cmd --version` 输出版本号
- [ ] commit

---

## M1：核心算法（2h）

### Task M1.1：BvId 转换（TDD）
- [ ] 写测试 `tests/unit/bvid.test.ts`：
  - `bv2av("BV17x411w7KC") === 170001`
  - `av2bv(170001) === "BV17x411w7KC"`
  - 边界：BV 长度 12、av=0、大 av 值
- [ ] 跑测试看失败
- [ ] 实现 `src/core/bvid.ts`（用新算法：ADD=100618342136696320, MAP=[9,8,1,6,2,4,0,7,3,5]）
- [ ] 跑测试看通过
- [ ] commit

### Task M1.2：WBI 签名（TDD）
- [ ] 写测试 `tests/unit/wbi.test.ts`：
  - 用官方测试用例：imgKey=7cd084941338484aae1ad9425b84077c, subKey=4932caff0ff746eab6f01bf08b70ac45
  - 参数 `{foo:"114", bar:"514", baz:"1919810"}`, wts=1684746387
  - 预期 w_rid=90efcab09403023875b8516f07e9f9de
  - 测试 `!'()*` 过滤
  - 测试参数排序
- [ ] 跑测试看失败
- [ ] 实现 `src/core/wbi.ts`（mixinKeyEncTab + getMixinKey + encWbi）
- [ ] 跑测试看通过
- [ ] commit

### Task M1.3：常量表
- [ ] 实现 `src/core/constants.ts`：
  - QUALITY（画质 ID 表）
  - AUDIO_QUALITY（音质 ID 表）
  - CODEC（编码 ID 表）
  - FNVAL（位掩码枚举）
  - FNVAL_DEFAULT = 4048
- [ ] 写测试验证关键值
- [ ] commit

### Task M1.4：URL 解析器（TDD）
- [ ] 写测试 `tests/unit/parseEntrance.test.ts`：
  - BV url: `https://www.bilibili.com/video/BV17x411w7KC`
  - BV id: `BV17x411w7KC`
  - av id: `av170001`
  - 短链: `https://b23.tv/BV17x411w7KC`
  - 番剧 ss/ep/md
  - 课程 ss/ep
  - 收藏夹 ml
  - 用户 uid/url
- [ ] 跑测试看失败
- [ ] 实现 `src/core/parseEntrance.ts`（返回 `{type, id}` 联合类型）
- [ ] 跑测试看通过
- [ ] commit

---

## M2：HTTP 客户端（1h）

### Task M2.1：HTTP 客户端封装
- [ ] 实现 `src/utils/httpClient.ts`：
  - `get(url, options)` 基于 fetch
  - 自动注入 User-Agent / Referer / Cookie
  - AbortController 超时控制
  - 重试（5xx 错误，最多 3 次）
- [ ] 写测试（mock fetch）
- [ ] commit

### Task M2.2：Cookie 管理
- [ ] 实现 `src/services/CookieService.ts`：
  - `load(path?)`: 从 JSON 文件加载 Cookie
  - `save(cookies, path?)`: 保存 Cookie
  - `toHeader(cookies)`: 转 `Cookie:` header 字符串
  - 默认路径 `~/.pilidown/cookies.json`
- [ ] 写测试
- [ ] commit

### Task M2.3：错误处理
- [ ] 实现 `src/types/errors.ts`：
  - `BiliApiError`（code, message, apiUrl）
  - `NetworkError`
  - `FileSystemError`
- [ ] 实现 `src/utils/logger.ts`：
  - `setJsonMode(bool)`
  - `info/warn/error(event, data)` 输出 JSON Lines 或 TTY 文本
- [ ] commit

---

## M3：info 命令（1h）

### Task M3.1：NavApi（获取 WBI key）
- [ ] 实现 `src/api/NavApi.ts`：
  - `getNavInfo()`: 调用 `/x/web-interface/nav`
  - 返回 `{imgKey, subKey, isLogin, userInfo}`
- [ ] 写集成测试（需联网，用真实账号或匿名）
- [ ] commit

### Task M3.2：VideoApi（视频信息）
- [ ] 实现 `src/api/VideoApi.ts`：
  - `getVideoInfo(bvid|aid)`: 调用 `/x/web-interface/wbi/view`（带 WBI 签名）
  - 返回 `{bvid, aid, title, pic, owner, pages, duration, ...}`
- [ ] 写集成测试（用真实 bvid）
- [ ] commit

### Task M3.3：info 命令实现
- [ ] 实现 `src/commands/info.ts`：
  - 解析 URL/id → 调 VideoApi → 输出信息
  - 支持 `--json` 输出 JSON Lines
- [ ] 在 `src/index.ts` 注册命令
- [ ] 手动测试：`pilidown info BV1xx411c7mD`
- [ ] commit

---

## M4：stream 命令（2h）

### Task M4.1：VideoApi（流地址）
- [ ] 扩展 `src/api/VideoApi.ts`：
  - `getPlayUrl(bvid|aid, cid, qn?, fnval?)`: 调用 `/x/player/wbi/playurl`
  - 返回 `{dash, durl, accept_quality, support_formats}`
- [ ] 写集成测试
- [ ] commit

### Task M4.2：流选择逻辑
- [ ] 实现 `src/services/StreamService.ts`：
  - `selectVideoStream(dash, qn, codec)`: 按画质+编码选视频流
  - `selectAudioStream(dash, audioQuality)`: 按音质选音频流
  - 支持 Dolby / Hi-Res 优先
- [ ] 写测试
- [ ] commit

### Task M4.3：stream 命令实现
- [ ] 实现 `src/commands/stream.ts`：
  - 输出可用清晰度列表
  - 输出选定流的 URL（默认不显示完整 URL，可 `--show-url`）
- [ ] 注册命令
- [ ] 手动测试
- [ ] commit

---

## M5：download 命令（4h）

### Task M5.1：多线程下载器
- [ ] 实现 `src/utils/downloader.ts`：
  - `MultiThreadDownloader` 类
  - `createPartitions(size, parts)`: 切分分片
  - `downloadPart(url, from, to, filePath)`: 单片下载（Range 请求）
  - `dynamicExpand()`: 动态分片扩展
  - `mergeParts()`: 按序合并（4096 字节 buffer）
  - `getSpeed()`: 滚动 10 帧平均速度
- [ ] 写测试（mock HTTP server）
- [ ] commit

### Task M5.2：FFmpeg 封装
- [ ] 实现 `src/utils/ffmpeg.ts`：
  - `findFfmpeg(path?)`: 探测 FFmpeg（参数 → PATH → 常见路径）
  - `mergeVideoAudio(video, audio, output)`: `-y -i audio -i video -strict -2 -acodec copy -vcodec copy -f mp4 output`
  - `concatVideos(files, output)`: concat demuxer
  - `extractAudio(video, output)`
  - `extractVideo(video, output)`
- [ ] 写测试（mock child_process）
- [ ] commit

### Task M5.3：DownloadService（任务编排）
- [ ] 实现 `src/services/DownloadService.ts`：
  - `downloadVideo(bvid, options)`: 单 P 下载完整流程
  - `downloadAllPages(bvid, options)`: 多 P 并发（默认并发 3）
  - 文件命名模板：`{title}-{page}.mp4`
  - 进度回调
- [ ] 写测试
- [ ] commit

### Task M5.4：download 命令实现
- [ ] 实现 `src/commands/download.ts`：
  - 选项：`--quality --codec --audio-quality --page --output --filename --no-merge --threads --overwrite`
  - 进度显示（TTY 进度条 / JSON Lines）
- [ ] 注册命令
- [ ] 手动测试：`pilidown download BV1xx411c7mD --quality 80`
- [ ] commit

---

## M6：danmaku 命令（3h）

### Task M6.1：手写 protobuf reader
- [ ] 实现 `src/core/danmakuReader.ts`：
  - `parseDanmaku(buffer: ArrayBuffer): DanmakuElem[]`
  - varint 解码
  - 字段 1-11 解析（id/progress/mode/fontsize/color/midHash/content/ctime/weight/action/pool）
  - 未知字段跳过
- [ ] 写测试（用真实弹幕二进制样本，放 `tests/fixtures/`）
- [ ] commit

### Task M6.2：DanmakuApi
- [ ] 实现 `src/api/DanmakuApi.ts`：
  - `getDanmakuList(avid, cid)`: 循环拉取所有分段
  - 返回 `DanmakuElem[]`
- [ ] 写集成测试
- [ ] commit

### Task M6.3：ASS 转换器
- [ ] 实现 `src/core/assConverter.ts`：
  - `Collision` 类（leaves[] 数组、detect、update）
  - `Display` 基类 + `ScrollDisplay` / `TopDisplay` / `BottomDisplay` 子类
  - `setDuration`（Sync/Async，用 switch 替代反射）
  - `setHorizontal` / `setVertical` / `setWidth` / `setHeight` / `setFontSize`
  - `Subtitle` 类（ASS Dialogue 行格式化）
  - `int2hls` / `isDark` / `int2bgr` / `second2hms` / `displayLength` / `correctTypos`
  - `createAssFile(danmakus, config)`: 生成完整 ASS 文件
- [ ] 写测试（用固定弹幕样本对比输出）
- [ ] commit

### Task M6.4：danmaku 命令实现
- [ ] 实现 `src/commands/danmaku.ts`：
  - 选项：`--format xml|ass`、`--output`、`--page`
- [ ] 注册命令
- [ ] 手动测试
- [ ] commit

---

## M7：subtitle 命令（2h）

### Task M7.1：字幕获取与转换
- [ ] 扩展 `src/api/VideoApi.ts`：
  - `getPlayerInfo(bvid|aid, cid)`: 调用 `/x/player/wbi/v2`
  - 返回 `{subtitle: {subtitles: [{lan, subtitle_url}]}}`
- [ ] 实现 `src/core/subtitleConverter.ts`：
  - `fetchSubtitle(subtitleUrl)`: 拉取字幕 JSON
  - `subtitleToJson(srt)`: JSON → SRT
  - `subtitleToAss(srt)`: JSON → ASS（简易版，无碰撞算法）
- [ ] 写测试
- [ ] commit

### Task M7.2：subtitle 命令实现
- [ ] 实现 `src/commands/subtitle.ts`
- [ ] 注册命令
- [ ] 手动测试
- [ ] commit

---

## M8：login 命令（2h）

### Task M8.1：LoginApi
- [ ] 实现 `src/api/LoginApi.ts`：
  - `generateQrCode()`: 调用 `/x/passport-login/web/qrcode/generate`
  - `pollLoginStatus(qrcodeKey)`: 调用 `/x/passport-login/web/qrcode/poll`
  - 解析 Set-Cookie 提取 SESSDATA/bili_jct/DedeUserID
- [ ] 写测试（mock 响应）
- [ ] commit

### Task M8.2：二维码显示
- [ ] 安装 `qrcode` 依赖（运行时）
- [ ] 实现 `src/utils/qrcode.ts`：
  - `printQrCodeInTerminal(url)`: 终端打印 ASCII 二维码
- [ ] 写测试
- [ ] commit

### Task M8.3：login 命令实现
- [ ] 实现 `src/commands/login.ts`：
  - 生成二维码 → 终端显示 → 轮询（2s 间隔）→ 成功保存 Cookie
  - 处理 86101/86090/86038/0 四种状态
- [ ] 注册命令
- [ ] 手动测试（真实扫码）
- [ ] commit

---

## M9：扩展命令（3h）

### Task M9.1：番剧/课程
- [ ] 实现 `src/api/BangumiApi.ts`（pgc/playurl + pgc/review/user）
- [ ] 实现 `src/api/CheeseApi.ts`（pugv/playurl）
- [ ] 实现 `src/commands/bangumi.ts`
- [ ] 实现 `src/commands/cheese.ts`
- [ ] commit

### Task M9.2：收藏夹/历史/用户空间
- [ ] 实现 `src/api/FavoritesApi.ts`
- [ ] 实现 `src/api/HistoryApi.ts`
- [ ] 实现 `src/api/UserApi.ts`
- [ ] 实现 `src/commands/fav.ts`（批量下载）
- [ ] 实现 `src/commands/history.ts`
- [ ] 实现 `src/commands/space.ts`
- [ ] commit

---

## M10：Skill 封装（1h）

### Task M10.1：TRAE Skill 文件
- [ ] 创建 `skill/SKILL.md`（按 spec.md 第 9 节模板）
- [ ] 创建 `skill/README.md`（使用说明）
- [ ] commit

### Task M10.2：集成测试
- [ ] 写 `tests/integration/e2e.test.ts`：
  - `pilidown info BV1xx411c7mD`
  - `pilidown download BV1xx411c7mD --quality 80`
  - `pilidown danmaku BV1xx411c7mD --format ass`
- [ ] 跑通集成测试
- [ ] commit

### Task M10.3：发布 v0.1.0
- [ ] 更新 `README.md`（完整文档）
- [ ] 更新 `package.json` version: 0.1.0
- [ ] 跑 `npm run build` 确认产物
- [ ] 手动测试 wrapper
- [ ] git tag v0.1.0
- [ ] commit

---

## 任务依赖关系

```
M0 → M1 → M2 → M3 → M4 → M5
                       ↓
                       M6 (并行)
                       ↓
                       M7 (并行)
                       ↓
                       M8 (并行)
                       ↓
                       M9 (依赖 M5)
                       ↓
                       M10 (依赖所有)
```

M5 完成后即可发布 v0.1.0-alpha，M6-M8 可并行开发，M9 依赖 M5 的下载基础设施。

---

## 验收标准

每个任务必须满足：
1. ✅ 测试通过（`npm test`）
2. ✅ 类型检查通过（`npm run typecheck`）
3. ✅ 构建成功（`npm run build`）
4. ✅ 提交（git commit，遵循 Conventional Commits）

每个切片（M0-M10）完成后：
1. ✅ 所有子任务完成
2. ✅ 手动测试通过
3. ✅ 提交到主分支
