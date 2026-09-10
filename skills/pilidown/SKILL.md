---
name: "pilidown"
description: "Bilibili downloader CLI (pilidown). Invoke to download Bilibili videos, audio, collections, danmaku, subtitles, or query stream/user info. Bundled self-contained Node.js CLI."
---

# pilidown - Bilibili Downloader Skill

A lightweight, zero-dependency Bilibili CLI and universal Agent Skill.
- **Bundled Executable**: `<skill_dir>/bin/pilidown.cmd` (Windows) or `<skill_dir>/bin/pilidown` (Unix/macOS). In templates below, `pilidown` represents this binary.
- **Environment**: Node.js 20+ required. Pre-bundled (`bin/cli.cjs`), zero external build dependencies (no ffmpeg, python, or browser needed).

## Core Guardrails

1. **Machine-Readable Protocol**: Always append `--json` for agent-internal calls to parse structured JSON Lines. Omit `--json` only when printing human-readable text directly for the user.
2. **Privacy & Security**: Never print, commit, or transmit `~/.pilidown/cookies.json` or signed media URLs. Check login state non-intrusively via `pilidown status --json`.
3. **No Redundant Probes**: Never run `info` or `stream` before `download` (`download` automatically negotiates and selects streams).
4. **Dynamic Stream Negotiation**: Stream availability is dynamic per video. Query `pilidown stream <url> --json` rather than hardcoding static codec IDs. Defaults: 1080P (`-q 80`) when logged in, 360P (`-q 16`) anonymously.

## Command Routing Matrix

| User Intent | Command Template | Notes & Flags |
|---|---|---|
| **Download video** | `pilidown download <url-or-bv> --output <dir>` | Default: fMP4 (O(1) memory, no ffmpeg). Add `-q <qn>` or `--page <n>` as needed. |
| **Download entire collection (合集)** | `pilidown download <url-or-bv> --collection --output <dir>` | Downloads all UGC episodes; outputs `{season}-ep{N}-{title}.mp4`. |
| **Download audio only** | `pilidown download <url-or-bv> --audio-only --output <dir>` | Outputs native `.m4a` without transcoding quality loss. |
| **Legacy player MP4** | `pilidown download <url-or-bv> --container mp4 --output <dir>` | Dual-track progressive MP4 merge with memory preflight guard. |
| **Skip merge (separate streams)** | `pilidown download <url-or-bv> --no-merge --output <dir>` | Retains raw `.m4v` and `.m4a` streams for external toolchains. |
| **Danmaku (弹幕)** | `pilidown danmaku <url-or-bv> --format ass --output <file>` | Formats: `ass` (recommended), `xml`, `raw`. Always supply `--output` with `--json`. |
| **Subtitles (字幕)** | `pilidown subtitle <url-or-bv> --format srt --output <file>` | Formats: `srt`, `json`, `ass`. |
| **Query video streams / metadata** | `pilidown info <url-or-bv>`<br>`pilidown stream <url-or-bv> --json` | `info` queries title/pages (1 API); `stream` queries available qualities/codecs. |
| **Login / Login status** | `pilidown status --json`<br>`pilidown login` | `status` checks login boolean; `login` generates QR code for user to scan. |
| **Favorites / History / Space** | `pilidown fav <mid> --json`<br>`pilidown history --json`<br>`pilidown space <mid> --pub --json` | Requires login. Returns compact JSON records. |
| **Bangumi / Cheese** | `pilidown bangumi <url> --json`<br>`pilidown cheese <url> --json` | Anime season/episodes and course streams. |

## Error Handling & FFmpeg Fallback SOP

- **Risk control (-352)**: Automatically bypassed by buvid3 injection and retry.
- **Login required (-101)**: Instruct user to execute `pilidown login` to scan QR code.
- **Batch failures**: `--all` and `--collection` record individual failures in a sorted `failures` array and set exit code 1.
- **Resuming**: Enabled by default (`.part` + `.partstate.json`). Use `--no-resume` to discard corrupt partial states and force a clean restart.

### External FFmpeg Fallback SOP
Built-in merge uses pure-JS box surgery. If merge fails (`E_MERGE` exit code 1) or custom container conversion is required:
1. **Verify streams**: Ensure downloaded `<name>.m4v` and `<name>.m4a` remain in the output directory (pilidown never deletes streams on merge failure).
2. **Check environment**: Execute `ffmpeg -version`. If unavailable, notify the user to install ffmpeg or merge manually.
3. **Lossless mux**:
   ```bash
   ffmpeg -i "<video.m4v>" -i "<audio.m4a>" -c copy -y "<output.mp4>"
   ```
4. **Cleanup & Deliver**: Remove `.m4v` and `.m4a` upon successful ffmpeg exit, then deliver the final `.mp4`.
