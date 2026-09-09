---
name: "pilidown"
description: "Bilibili downloader CLI (pilidown). Invoke when user wants to download Bilibili videos, fetch video/stream info, get danmaku/subtitles, download collections, or query favorites/history/user space. Supports bangumi and cheese too."
---

# pilidown - Bilibili Downloader Skill

A lightweight CLI tool and universal Agent Skill for downloading Bilibili videos.

## When to Invoke

Invoke this skill when the user wants to:
- Download a Bilibili video (single, multi-page, or entire collection)
- Query video info / stream URLs / available qualities
- Fetch danmaku (弹幕) or subtitles (字幕)
- Login to Bilibili (for history/favorites/high-quality streams)
- List favorites, watch history, or user publications
- Fetch bangumi (anime) or cheese (course) info

**Binary (self-contained)**: this skill bundles the built CLI in `<skill_dir>/bin/`. On Windows run `<skill_dir>/bin/pilidown.cmd`; on Unix/macOS run `<skill_dir>/bin/pilidown`. The wrappers probe Node.js from PATH and common install locations, then run the bundled `cli.cjs` in the same directory.

- `<skill_dir>` = the directory containing this SKILL.md. Locate it first (e.g. the agent's working directory or the skill install folder), then append `/bin/pilidown.cmd` (Windows) or `/bin/pilidown` (Unix).
- In all command templates below, `pilidown` stands for that binary.
- No `npm ci` / `npm run build` needed — the CLI is pre-built and bundled. The only system requirement is Node.js 18+.

## Invocation Contract

1. Identify the user's intent and choose exactly one command family from the decision tree.
2. Before the first download, run `pilidown status --json`; do not request, display, or transmit credentials.
3. If login is needed, ask for confirmation before running `pilidown login`. The command starts a local HTTP QR page by default; `--qr-png <path>` also saves a local PNG. The user scans the QR code themselves.
4. For agent-internal calls, use `--json` and parse JSON Lines event-by-event. Do not assume one JSON document or success from exit code alone.
5. For danmaku export, always provide `--output <path>` when using `--json`; otherwise the exported ASS/XML/raw body may be written to stdout alongside JSON events.
6. Never print, copy, commit, persist, or upload `~/.pilidown/cookies.json` or temporary stream URLs.

Input rules: video commands accept a video URL, BV ID, or AV ID; `bangumi` and `cheese` use their own season/course input; `space` requires a numeric UID; `fav` requires a numeric UID; `history` takes no input.

## Initialization and Login Privacy

Before the first download, ask whether the user has already logged in to Bilibili locally. Do not ask for a password, QR token, SESSDATA value, or any other secret. If the user wants to log in, run `pilidown login` so they can scan the QR code themselves.

Login state is local to the current machine and is stored in the user's `~/.pilidown/cookies.json`; it is not uploaded by this Skill. The file contains sensitive session credentials: do not print, copy, commit, or send it anywhere. Users are responsible for complying with Bilibili's terms and applicable law. Without local login, Bilibili may restrict downloads to the lowest available quality; the CLI therefore defaults anonymously to the lowest quality and 64k audio. With local login, defaults request 1080P (`qn=80`, actual FPS and fallback are decided by the API) and 192k audio (`30280`). Use `pilidown status --json` to inspect only the boolean login state and recommended defaults.

## Decision Tree — Which Command to Call

| User intent | Command | Cost |
|-------------|---------|------|
| "查信息/基本信息/这是什么视频" | `info <url>` | cheap (1 API) |
| "画质/音质/有哪些清晰度" | `stream <url> --json` | medium (2 API) |
| "获取临时流地址" | `stream <url> --json --show-url` | medium (2 API) |
| "下载这个视频" (single) | `download <url>` | expensive (download) |
| "下载整个合集/全部" | `download <url> --collection` | very expensive |
| "弹幕" | `danmaku <url> --format ass` | cheap |
| "字幕" | `subtitle <url> --format srt` | cheap |
| "登录" | `login` | interactive (QR scan) |
| "登录状态" | `status --json` | cheap |
| "指定用户的收藏夹列表" | `fav <mid> --json` (needs login) | cheap |
| "按 media_id 查询收藏夹内容" | `fav <mid> --media <id> --json` (needs login; `<mid>` 仍是当前 CLI 的必填 UID 参数) | cheap |
| "观看历史" | `history` (needs login) | cheap |
| "稍后再看" | `history --toview` (needs login) | cheap |
| "UP主/用户空间/某人投稿" | `space <mid> --pub` | cheap |
| "用户信息" | `space <mid>` | cheap |
| "番剧/anime" | `bangumi <url>` | cheap |
| "课程/cheese" | `cheese <url>` | cheap |

## Token-Saving Rules (CRITICAL)

1. **Agent internal calls**: always add `--json` (structured output, easier to parse, less prose).
2. **Display to user**: omit `--json` (human-readable, but still concise).
3. **Never call `stream` before `download`**: `download` internally fetches streams itself. Calling `stream` first wastes 1 API call.
4. **Never re-call `info`**: if you already have video info from a previous call in the same conversation, reuse it.
5. **Prefer `info` over `stream`** when user just wants to know "what is this video" — info is 1 API, stream is 2.
6. **For downloads, check local login before the first download**: anonymous defaults are qn=16 and audio 30216; logged-in defaults request qn=80 (1080P; actual FPS and fallback are decided by the API) and audio 30280 (192k). Use qn=116 explicitly for 1080P60; higher qualities may need 大会员. `--quality` is a preference, not a guarantee.
7. **Use `--json` for `fav`/`history`/`space`**: their human output is verbose; JSON is more compact for agent parsing.

## Command Templates

### Query info (basic — no stream URLs)
```bash
pilidown info <url-or-bv>
# Shows: title, UP, stats, pages, collection (if any)
```

### Query stream info (quality/codecs available)
```bash
pilidown stream <url-or-bv> --json
# Returns stream metadata: quality, codec, resolution and bandwidth.
# Add --show-url only when the user explicitly requests temporary URLs.
pilidown stream <url-or-bv> --json --show-url
```

### Download single video
```bash
pilidown download <url-or-bv> --quality <qn> --audio-quality <id> --output <dir>
# Logged-in default: --quality 80 (1080P) --audio-quality 30280 (192k)
# Anonymous default: --quality 16 --audio-quality 30216 (64k)
# Small audio: --audio-quality 30216 (64k, ~50% smaller)
# Multi-page: --all (all pages) or --page <n>
# Skip merge: --no-merge (DASH usually keeps .m4v + .m4a; durl may remain .mp4/.flv)
```

### Download entire collection (合集)
```bash
pilidown download <url-or-bv> --collection --output <dir>
# Input any bvid belonging to the collection — auto-fetches all episodes
# Files named: {collectionTitle}-ep{N}-{episodeTitle}.mp4
```

### Danmaku (弹幕)
```bash
pilidown danmaku <url-or-bv> --format ass
# Formats: ass (recommended), xml, raw; --json means JSONL status events, not JSON danmaku content
# Use --page <n> for specific page
# With --json, always add --output <path>; raw without output writes binary data to stdout.
```

### Subtitles (字幕)
```bash
pilidown subtitle <url-or-bv> --format srt
# Formats: srt, json, ass
```

### Login (interactive — QR code)
```bash
pilidown login
# Starts a local HTTP QR page; user scans with Bilibili mobile app
# Optional: --qr-png <path> also saves a local PNG and prints terminal QR output
# Cookies persist in ~/.pilidown/cookies.json
# Required for: history, favorites, 1080P+ on some videos
```

### Favorites (needs login)
```bash
pilidown fav <mid> --json           # list user's favorite folders
pilidown fav <mid> --media <id> --json  # list resources by media_id; <mid> remains required by CLI
```

### History (needs login)
```bash
pilidown history --json             # watch history
pilidown history --toview --json    # "to view later" list
```

### User space
```bash
pilidown space <mid> --json          # user info
pilidown space <mid> --pub --json   # user's publications (videos)
```

### Bangumi / Cheese
```bash
pilidown bangumi <url-or-id> --json                 # season info only
pilidown bangumi <url-or-id> --ep <episode-id> --json  # season + selected episode stream
pilidown cheese <url-or-id> --json                  # course info only
pilidown cheese <url-or-id> --ep <episode-id> --json   # course + selected episode stream
```

## Reference Tables

### Video quality (qn)
| qn | Description |
|----|-------------|
| 127 | 8K HDR |
| 120 | 4K |
| 116 | 1080P60 |
| 112 | 1080P+ (high bitrate) |
| 80 | 1080P |
| 64 | 720P |
| 32 | 480P |
| 16 | 360P |

### Audio quality (id)
| id | Bitrate | Note |
|----|---------|------|
| 30216 | 64 kbps | Smallest, ~50% smaller than default |
| 30232 | 132 kbps | Medium |
| 30280 | 192 kbps | Default, highest quality regular AAC |
| 30250 | Dolby Atmos | Needs login + Dolby flag |
| 30251 | Hi-Res FLAC | Needs login + `--hires` flag |

### Video codec (codec id)
| id | Codec |
|----|-------|
| 7 | AVC (H.264) — most compatible |
| 12 | HEVC (H.265) — smaller, needs player support |
| 13 | AV1 — newest, smallest, limited player support |

## Common Workflows

### "Download this video"
```bash
pilidown download <url> --quality 80 --output ./downloads
```
(Logged-in default requests 1080P + 192k; anonymous default requests the lowest quality + 64k. No need to call `info`/`stream` first; `download` does it internally.)

### "Download highest quality" (needs 大会员 login)
```bash
pilidown login    # if not logged in yet
pilidown download <url> --quality 120 --output ./downloads    # 4K
# or --quality 116 for 1080P60
```

### "What is this video? Show me info"
```bash
pilidown info <url>
```

### "What qualities are available?"
```bash
pilidown stream <url> --json
```

### "Download entire collection"
```bash
pilidown download <url> --collection --output ./downloads
```

### "Get danmaku + subtitles for this video"
```bash
pilidown danmaku <url> --format ass
pilidown subtitle <url> --format srt
```

### "Download with smallest file size"
```bash
pilidown download <url> --quality 32 --audio-quality 30216 --output ./downloads
# 480P video + 64kbps audio — minimal size
```

## Error Handling

- `-352` risk control: auto-handled (injects buvid3 cookie, retries)
- `-101` not logged in: tell user to run `pilidown login` first
- FFmpeg is not required; pure JS/WASM handles the normal merge and MP3 conversion. If that processing fails, already downloaded `.m4v`/`.m4a` files are retained.
- Video not in collection: `download --collection` throws clear error
- Page numbers are 1-based; current commands fall back to page 1 when the requested page is out of range.
- Batch downloads continue after individual failures; inspect result counts and paths instead of trusting exit code alone.

## Notes

- Video commands accept URL, BV ID, or AV ID: `pilidown info BV1D4f5BTEE8` works.
- Commands with `--json` emit JSON Lines events, not necessarily one JSON object; `danmaku` requires `--output` for clean machine-readable stdout.
- `stream --show-url` and bangumi/cheese `--ep` can expose short-lived signed URLs; use only when explicitly requested and do not store or share them.
- Cookie file: `~/.pilidown/cookies.json` (persisted after login)
- Requires Node.js 18+; FFmpeg is optional because media processing has a pure-JS fallback
