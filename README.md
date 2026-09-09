# pilidown

Lightweight Bilibili downloader CLI for TRAE Skill integration.

## Status

v0.1.0 — core commands and unit-tested download pipeline are available.

See `docs/plans/spec.md` for design, `docs/plans/tasks.md` for task breakdown.

## Quick Start

```powershell
npm ci
npm run build
bin\pilidown.cmd info <url-or-bvid>
bin\pilidown.cmd download <url-or-bvid> --output .\downloads
```

When local login is detected, downloads default to 1080P30 video (`--quality 80`) and 192k audio (`--audio-quality 30280`). Without login, defaults are the lowest available quality and 64k audio (`--audio-quality 30216`) because Bilibili may restrict anonymous access. Audio-only downloads default to MP3; use `--format m4a` to keep the original audio container.

## Commands

- `info <url-or-id>`: show video metadata.
- `stream <url-or-id> --json`: inspect available streams; add `--show-url` only when temporary URLs are needed.
- `download <url-or-id>`: download one video; use `--all` for all pages or `--collection` for a collection.
- `danmaku <url-or-id>`: export `ass`, `xml`, or `raw` danmaku.
- `subtitle <url-or-id>`: export `srt`, `json`, or `ass` subtitles.
- `status`: inspect only local login presence and recommended defaults.
- `login`, `fav`, `history`, `space`, `bangumi`, `cheese`: account and content workflows.

Append `--json` to supported commands for JSON Lines output intended for agents. Run `pilidown <command> --help` for options.

## Login

Run `pilidown login` and scan the QR code with the Bilibili mobile app. Cookies are stored locally under the user's `.pilidown` directory and are not uploaded by pilidown. Treat this file as a secret: do not print, share, commit, or send it to anyone. Users remain responsible for complying with Bilibili's terms and applicable law.

## Acknowledgments

This project is inspired by [DownKyi](https://github.com/leiurayer/downkyi)
by leiurayer. Core algorithms (WBI signature, BvId conversion, danmaku parsing,
ASS conversion, multi-thread downloader) are ported from DownKyi.Core.

## License

MIT
