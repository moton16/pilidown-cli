# pilidown

A lightweight, standalone Bilibili downloader CLI and universal AI Agent Skill.

[English](#features) | [中文说明](#核心特性)

---

## Features / 核心特性

- 🚀 **Zero External Binary Dependencies / 零外部二进制依赖**：使用纯 JS / WebAssembly 处理音视频流封装与转码（无需安装 FFmpeg 或 aria2，开箱即用）。
- 🤖 **Universal AI Agent Skill / 通用智能体技能**：内置规范化 `SKILL.md`，可无缝集成到任意 AI Agent 平台（如 Antigravity, Claude Code, Codex, OpenClaw, Cursor, Trae 等）。
- 📊 **Agent-Friendly JSON Lines / 结构化交互**：各主要命令支持 `--json` 输出流式 JSON Lines 事件，便于 LLM 和自动化脚本解析调用。
- 🔒 **Privacy & Security First / 隐私与安全优先**：用户凭据（Cookie / Token）仅保存在本机；命令输出默认屏蔽 CDN 临时带签名流地址；绝无外部遥测或第三方数据外发。
- ⚡ **High-Speed Segmented Downloader / 高速分段下载**：支持多线程并发下载、自动 Range 探测与重试合并。
- 🎬 **Comprehensive Content Support / 全面内容覆盖**：支持单视频、多 P 视频、UGC 合集、弹幕导出（ASS/XML）、字幕导出（SRT/JSON）、番剧、课程、收藏夹与历史记录。

---

## Quick Start / 快速开始

### 1. Requirements

- **Node.js 18+**

### 2. Run with Bundled Wrappers (No build required)

本项目已在 `bin/` 提供构建好的跨平台启动脚本，会自动探测系统中安装的 Node.js：

- **Windows**: `bin\pilidown.cmd <command>`
- **macOS / Linux**: `bin/pilidown <command>`

### 3. Build from Source

```bash
npm ci
npm run build
npm test
```

---

## CLI Usage / 常用命令

```bash
# 查询视频基本信息
bin/pilidown info <url-or-bvid>

# 查询可用画质与音频流（支持以 JSON Lines 格式供 Agent 解析）
bin/pilidown stream <url-or-bvid> --json

# 下载单个视频（已登录默认 1080P，未登录默认最低画质以防受限）
bin/pilidown download <url-or-bvid> --output ./downloads

# 下载完整合集
bin/pilidown download <url-or-bvid> --collection --output ./downloads

# 导出弹幕（支持 ass / xml / raw 格式）
bin/pilidown danmaku <url-or-bvid> --format ass --output ./danmaku.ass

# 导出字幕（支持 srt / json / ass 格式）
bin/pilidown subtitle <url-or-bvid> --format srt --output ./subtitle.srt

# 扫码登录（启动本地 127.0.0.1 网页，手机 App 扫码即可完成登录）
bin/pilidown login

# 查看当前本地登录状态与推荐画质
bin/pilidown status --json
```

---

## Universal Agent Skill Integration / 通用 Agent Skill 集成

本项目可直接作为 AI Agent 的扩展技能（Skill）使用：

1. 将仓库中的 `skills/pilidown`（或 `SKILL.md` 与包含独立打包产物的 `bin/` 目录）放置到对应 Agent 的 Skills 目录下（例如 `~/.claude/skills/pilidown`、`~/.gemini/config/skills/pilidown`、`.trae/skills/pilidown` 或项目中对应的工作区 skill 路径）。
2. 在对话中即可直接通过自然语言让 Agent 下载视频、抓取字幕、获取弹幕或查询合集。

详细的 Agent 调度规范与决策树见 [skills/pilidown/SKILL.md](skills/pilidown/SKILL.md)。

---

## Privacy Policy / 隐私说明

- **本地存储**：登录后的 Cookie 数据仅保存在用户本机的 `~/.pilidown/cookies.json` 中，权限设置为仅当前用户可读（POSIX 0600）。
- **零泄露**：`pilidown` 不会上传、转发或向任何第三方发送用户的敏感凭据。
- **合规声明**：请遵守哔哩哔哩（Bilibili）平台的服务条款和相关法律法规，仅用于学习交流及合法个人用途。

---

## Acknowledgments / 致敬与鸣谢

This project is inspired by [DownKyi](https://github.com/leiurayer/downkyi) by leiurayer. Core algorithms (WBI signature, BvId conversion, danmaku parsing, ASS conversion, multi-thread downloader) are ported from DownKyi.Core.

---

## License

[MIT](LICENSE)

