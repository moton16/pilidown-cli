# pilidown 检查清单

> 实施过程中和发布前对照检查。

---

## 代码质量

### 通用
- [ ] TypeScript strict mode 启用
- [ ] 所有函数有明确返回类型
- [ ] 所有公共 API 有 JSDoc 注释
- [ ] 无 `any` 类型（必要时用 `unknown` + 类型守卫）
- [ ] 无 `// @ts-ignore` 注释
- [ ] 无 `eslint-disable` 注释（除非有充分理由）

### 错误处理
- [ ] 所有网络请求有 try/catch
- [ ] 所有文件操作有 try/catch
- [ ] 错误消息包含 hint（如何修复）
- [ ] JSON 模式下错误格式统一（{ok, error: {code, message, hint}}）
- [ ] 退出码语义清晰（0/1/2/3/4/5）

### 安全
- [ ] 无硬编码密钥/密码
- [ ] Cookie 文件权限 0600（Unix）
- [ ] SQL 注入防护（如有数据库，本项目应该不用）
- [ ] 命令注入防护（FFmpeg 参数用数组传递，不用字符串拼接）
- [ ] 路径遍历防护（用户输入的 output 路径需校验）

---

## 算法正确性

### WBI 签名
- [ ] `mixinKeyEncTab` 64 项数组与官方文档一字不差
- [ ] `img_key + sub_key` 顺序正确（img 在前）
- [ ] `mixin_key` 截取前 32 字符
- [ ] `wts` 是秒级时间戳（不是毫秒）
- [ ] 过滤 `!'()*` 五个字符（在 URL 编码之前）
- [ ] 参数按 key 字典序升序排序
- [ ] URL 编码字母大写（`encodeURIComponent` 默认满足）
- [ ] `w_rid = md5(query + mixin_key)` 输出 32 位小写 hex
- [ ] **官方测试用例通过**：imgKey=7cd084941338484aae1ad9425b84077c, subKey=4932caff0ff746eab6f01bf08b70ac45, wts=1684746387, w_rid=90efcab09403023875b8516f07e9f9de

### BvId 转换
- [ ] 用新算法（ADD=100618342136696320, MAP=[9,8,1,6,2,4,0,7,3,5]）
- [ ] `bv2av("BV17x411w7KC") === 170001`
- [ ] `av2bv(170001) === "BV17x411w7KC"`
- [ ] 边界测试：av=0, av=大数
- [ ] 反查表 TR 用 `Record<string, number>` 而非 char 索引

### 弹幕 protobuf
- [ ] 字段编号 1-11 与官方 .proto 一致
- [ ] `progress` 单位是毫秒（转 ASS 时除以 1000）
- [ ] `color` 是 uint32（`>>> 0` 保持无符号）
- [ ] `mode` 映射：1→scroll, 4→bottom, 5→top, 7/8/9→可选过滤
- [ ] 未知字段能正确跳过（向前兼容）
- [ ] 用真实弹幕二进制样本验证

### ASS 转换
- [ ] `displayLength` 汉字按 2 计、ASCII 按 1 计
- [ ] `Collision.detect` 返回 `(lineIndex, offset)`
- [ ] `Collision.update` 用 `Math.ceil`
- [ ] `second2hms` 格式：`H:MM:SS.cc`（小时 1 位，分秒 2 位，百分秒 2 位）
- [ ] `int2bgr` 输出 BGR 顺序（不是 RGB）
- [ ] ASS 颜色格式：`\c&H${BGR}`（无尾随 `&`）
- [ ] `\move` 用于滚动，`\a6\pos` 用于固定
- [ ] 暗色弹幕加 `\3c&H000000` 黑边
- [ ] `CorrectTypos`: `/n` → `\N`, `&gt;` → `>`, `&lt;` → `<`
- [ ] LayoutAlgorithm 用 switch（不用反射）
- [ ] 与 C# 实现输出对比（用固定弹幕样本）

### 多线程下载
- [ ] 分片最小 25 KB
- [ ] 最后一片吃下余数
- [ ] 动态分片扩展阈值 50 KB
- [ ] 速度统计滚动 10 帧平均
- [ ] 文件合并按 `From` 升序
- [ ] 合并 buffer 4096 字节
- [ ] 临时分片文件下载完成后删除

---

## 测试覆盖

### 单元测试
- [ ] WBI 签名：100% 覆盖（含官方测试用例）
- [ ] BvId 转换：100% 覆盖
- [ ] URL 解析：100% 覆盖（所有支持的格式）
- [ ] ASS 转换：100% 覆盖
- [ ] protobuf reader：100% 覆盖
- [ ] 字幕转换：100% 覆盖
- [ ] CookieService：100% 覆盖
- [ ] StreamService：100% 覆盖
- [ ] DownloadService：100% 覆盖（mock HTTP）

### 集成测试
- [ ] NavApi（联网，匿名）
- [ ] VideoApi.getVideoInfo（联网，用真实 bvid）
- [ ] VideoApi.getPlayUrl（联网，用低画质避免风控）
- [ ] DanmakuApi（联网，用真实 cid）
- [ ] LoginApi（手动扫码）

### 端到端测试
- [ ] `pilidown info BV1xxx`
- [ ] `pilidown stream BV1xxx`
- [ ] `pilidown download BV1xxx --quality 80`
- [ ] `pilidown download BV1xxx --no-merge`
- [ ] `pilidown danmaku BV1xxx --format ass`
- [ ] `pilidown danmaku BV1xxx --format xml`
- [ ] `pilidown subtitle BV1xxx`
- [ ] `pilidown login`（手动）

---

## 构建与打包

### 产物
- [ ] `npm run build` 产出 `bin/cli.cjs`
- [ ] 产物体积 < 300 KB
- [ ] 产物不包含 source map（生产模式）
- [ ] 产物不包含测试代码
- [ ] `bin/pilidown.cmd`（Windows wrapper）
- [ ] `bin/pilidown`（Unix wrapper，可执行权限）

### 依赖
- [ ] `dependencies` 仅包含：commander, iconv-lite, qrcode
- [ ] `devDependencies` 不进产物
- [ ] 无原生模块依赖（避免跨平台编译问题）
- [ ] `package-lock.json` 已提交

### 跨平台
- [ ] Windows 测试通过
- [ ] Unix wrapper 测试通过（如在 WSL 测试）
- [ ] 路径分隔符用 `path.join` / `path.sep`
- [ ] 无 Windows 专属 API（如 `process.platform === 'win32'` 时分支处理）

---

## CLI 用户体验

### 命令设计
- [ ] 所有命令支持 `--help`
- [ ] 全局选项：`--json --cookie --config --timeout --ffmpeg --user-agent`
- [ ] 子命令选项完整（见 spec.md 第 4 节）
- [ ] 默认值合理（quality=80, threads=8, timeout=30000）
- [ ] 错误信息友好（含 hint）

### 输出格式
- [ ] TTY 模式：人类可读，含进度条
- [ ] JSON 模式：每行一个 JSON 事件
- [ ] JSON 事件类型：info / download_progress / download_complete / done / error
- [ ] 颜色输出可选（`--no-color` 关闭）

### 错误处理
- [ ] 网络错误重试 3 次
- [ ] 风控 -352 提示登录
- [ ] 二维码失效自动重新生成
- [ ] FFmpeg 缺失自动降级
- [ ] 文件已存在提示（默认不覆盖，`--overwrite` 覆盖）

---

## TRAE Skill 集成

### SKILL.md
- [ ] `skill/SKILL.md` 存在
- [ ] frontmatter 完整（name, description）
- [ ] 命令清单完整
- [ ] 输出格式说明
- [ ] 错误处理说明
- [ ] 使用示例

### Agent 友好
- [ ] 所有命令支持 `--json` 输出
- [ ] JSON 输出可被 `JSON.parse` 解析
- [ ] 进度事件可流式处理
- [ ] 错误事件包含 hint
- [ ] 退出码语义清晰
- [ ] 幂等性（相同参数产生相同结果，除下载覆盖文件外）

---

## 发布前检查

### 文档
- [ ] `README.md` 完整（安装、使用、命令清单、示例、故障排查）
- [ ] `CHANGELOG.md` 存在（v0.1.0 条目）
- [ ] `LICENSE` 文件存在（MIT）
- [ ] `package.json` 字段完整（name, version, description, bin, main, scripts, keywords, author, license, repository, homepage, bugs）

### 版本控制
- [ ] git tag v0.1.0
- [ ] 所有改动已提交
- [ ] `.gitignore` 正确（node_modules, dist, bin/cli.cjs）
- [ ] 无敏感信息泄露（无 cookie、token、密码）

### 功能验收
- [ ] MVP 切片 M0-M5 全部完成
- [ ] 增值切片 M6-M8 全部完成
- [ ] 扩展切片 M9 全部完成
- [ ] Skill 封装 M10 全部完成
- [ ] 所有测试通过
- [ ] 手动测试通过

---

## 已知限制（v0.1.0）

- 不支持旧版 LoginQR（B 站已弃用）
- 不支持 DanmakuSender CRC32 反查（性能差）
- 不支持 SQLite 加密存储（用 JSON 文件）
- 不支持去水印 delogo（FFmpeg 高级功能）
- 不支持 WebP 封面转换
- ASS 转换未实现 LayoutAlgorithm 的全部模式（仅 sync/async）
- 多线程下载未实现暂停/恢复（仅支持取消）

这些限制将在后续版本中评估是否实现。
