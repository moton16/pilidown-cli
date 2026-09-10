# 零 FFmpeg 方案调研

> **⚠️ 历史文档 —— 结论已过时，不要照着实施。**
>
> 本文件是 2026-08 制定「去掉 ffmpeg」方案时的原始调研。按它实施的结果引入了项目两个 P0 缺陷：
> `media.ts` 用渐进式解析器 `MP4Parser` 处理 B 站 fMP4（必然失败），以及 CJS bundle 下 `import.meta.url`
> 为 `undefined` 导致 mp3 转码必炸。两个缺陷已于 2026-09-10 修复。
>
> 另外本文件第 49 / 147-149 行的前提「GPL-2.0 传染可接受、项目转 GPL」已被推翻：
> 最终选择移除 mp3 转码链路，从而卸掉 GPL 依赖，项目保持 MIT。
>
> **当前有效的文档**：`docs/plans/p0-fix-plan.md`（已修复项与依据）、`docs/plans/p1-batch2-plan.md`（待办项）、
> `docs/quick_start.md`（代码地图）。
>
> 保留本文件只为记录决策过程——「纯 JS 合并」这个方向本身是对的，错在选错了库内部的 API。

> 目标：完全移除 pilidown 对 ffmpeg 二进制的依赖，改用纯 JS/WASM npm 包实现音视频处理。

## 一、现状分析

### 1.1 当前 ffmpeg 用途（`src/utils/ffmpeg.ts`）

| 函数 | 用途 | 调用方 |
|------|------|--------|
| `mergeVideoAudio` | DASH 视频+音频合并为 MP4 | DownloadService |
| `transcodeAudio` | m4a→mp3/aac/flac/wav 转码 | DownloadService |
| `extractAudio` | 从 durl 单文件提取音频 | DownloadService |
| `concatVideos` | 多分P拼接 | 未使用 |
| `extractVideo` | 提取纯视频流 | 未使用 |
| `ensureFullFfmpeg` | 自动下载 80MB 完整 ffmpeg | transcodeAudio 调用 |
| `findFfmpeg` | 探测 PATH 上的 ffmpeg | 多处调用 |

### 1.2 调用链

```
download.ts / fav.ts
  └── DownloadService.downloadVideo()
        ├── DASH 流：下载 video.m4v + audio.m4a
        │   ├── 默认：mergeVideoAudio() → .mp4
        │   └── --audio-only --format mp3：transcodeAudio() → .mp3
        └── durl 单文件：下载 .flv/.mp4
            └── --audio-only --format mp3：extractAudio() + transcodeAudio() → .mp3
```

### 1.3 需要替代的能力

1. **DASH 视频+音频合并**：两个 fMP4 文件 → 一个 MP4（H.264+AAC，不转码）
2. **m4a→mp3 转码**：AAC 解码 → PCM → MP3 编码
3. **durl 提取音频**：从 FLV/MP4 容器中提取 AAC 音频流

## 二、npm 包调研

### 2.1 音频转码（m4a→mp3）

| 包 | 体积 | 最后更新 | Stars | Node.js | License | 用途 |
|----|------|---------|-------|---------|---------|------|
| `@audio/decode-aac` | 391KB | 2026-07-22 | 204 | >=18 ESM | **GPL-2.0** | FAAD2 WASM 解码 AAC/M4A→PCM |
| `@breezystack/lamejs` | 460KB | 2023-10 | 897(上游) | ESM+CJS | LGPL-3.0 | 纯 JS 编码 PCM→MP3 |

**调研结论**：
- `@audio/decode-aac`：活跃维护，零依赖，FAAD2 WASM。Node.js 18+ 兼容。输出 `Float32Array[]` PCM。
- `@breezystack/lamejs`：是 `zhuker/lamejs` 的 fork，修复了 `MPEGMode is not defined` bug。3 年未更新但功能完整，周下载 247K。输入 `Int16Array` PCM。
- **注意**：`@audio/decode-aac` 是 GPL-2.0，会传染 pilidown 的 MIT 许可证。用户已接受。
- **注意**：`@audio/decode-aac` 是纯 ESM，pilidown 是 CommonJS，需动态 `import()`

**API 用法**：
```js
// 解码 M4A → PCM
import decode from '@audio/decode-aac';
const { channelData, sampleRate } = await decode(uint8array);
// channelData: Float32Array[]，每通道一个

// 编码 PCM → MP3
const lame = require('@breezystack/lamejs');
const encoder = new lame.Mp3Encoder(channels, sampleRate, 192);
// 需将 Float32Array → Int16Array
const int16 = floatToInt16(channelData);
const mp3Buf = encoder.encodeBuffer(int16);
const endBuf = encoder.flush();
```

### 2.2 DASH 视频+音频合并（fMP4 → MP4）

| 包 | 体积 | 最后更新 | Stars | Node.js | 能力 |
|----|------|---------|-------|---------|------|
| `mp4box` | 2.2MB | 2026-06-19 | 2,457 | ✅ | 解析+创建 MP4，可提取 samples |
| `jmuxer` | ~100KB | 2025-12 | ? | ✅ | 从 raw H264+AAC 创建 MP4 |

**调研结论**：
- `mp4box`（GPAC 的 JS 移植，原 `mp4box.js` 已改名为 `mp4box`）：能解析 fMP4 文件，提取 H264 NALU 和 AAC 帧，也能创建新 MP4。API 是回调式（`onReady`/`onSamples`）。
- `jmuxer`：能从 raw H264 + AAC 数据流创建 MP4，但无法解析 fMP4 容器。需要先用 mp4box 提取原始帧。
- **合并方案**：mp4box 解析两个 fMP4 → 提取 samples → jmuxer 写入合并 MP4

**B 站 DASH 流格式**：
- 视频：fMP4 格式（`ftyp` + `moov` + `moof`/`mdat`），内含一条 H.264/H.265/AV1 track
- 音频：fMP4 格式，内含一条 AAC/FLAC track

**mp4box API 用法**：
```js
const MP4Box = require('mp4box');
// 解析
const file = MP4Box.createFile();
file.onReady = (info) => { /* tracks ready */ };
file.onSamples = (trackId, user, samples) => { /* extracted samples */ };
file.appendBuffer(buffer); // 喂数据
file.flush();
// 创建新 MP4
const newFile = MP4Box.createFile();
newFile.addTrack({ ... });
newFile.addSample(trackId, data, { ... });
```

### 2.3 durl 音频提取（FLV/MP4 → AAC）

durl 单文件可能是 FLV 或 MP4 格式，内含视频+音频。

| 场景 | 方案 |
|------|------|
| MP4 容器 | 用 `mp4box` 解析，提取 AAC 音频 track 的 samples |
| FLV 容器 | 需要 FLV 解析器 |

**FLV 解析选项**：
- `node-flv` - 需确认是否存在
- 手写 FLV parser - FLV 格式简单（tag-based），约 200 行代码可解析音频 tag

**简化方案**：durl 单文件的 `--audio-only` 场景较少，可以先只支持 MP4 容器，FLV 暂时输出原文件不提取。

### 2.4 ts→mp4 容器转换

| 包 | 体积 | 最后更新 | Stars | Node.js |
|----|------|---------|-------|---------|
| `@invintusmedia/tomp4` | 323KB | 2026-04-24 | 1 | ✅ |

**API 用法**：
```js
import toMp4 from '@invintusmedia/tomp4';
const result = await toMp4(uint8Array);
result.data; // Uint8Array MP4 数据
```

**注意**：此包社区较小（1 star, 22 周下载），但代码活跃、API 干净。支持 TS/fMP4/HLS → MP4，输出 H.264+AAC MP4。

## 三、依赖变更

### 3.1 新增依赖

| 包 | 体积 | 用途 | license |
|----|------|------|---------|
| `@audio/decode-aac` | 391KB | AAC→PCM 解码 | GPL-2.0 |
| `@breezystack/lamejs` | 460KB | PCM→MP3 编码 | LGPL-3.0 |
| `mp4box` | 2.2MB | fMP4 解析+MP4 创建 | BSD-3-Clause |
| `@invintusmedia/tomp4` | 323KB | ts→mp4 容器转换 | MIT |
| **合计** | **~3.4MB** | | |

### 3.2 移除

- `ensureFullFfmpeg` + `downloadFullFfmpeg`（80MB 下载逻辑）
- `findFfmpeg` + `hasAudioEncoders`（ffmpeg 探测）
- `mergeVideoAudio` / `transcodeAudio` / `extractAudio` / `concatVideos` / `extractVideo`（ffmpeg 调用）

### 3.3 许可证变更

pilidown 从 MIT → **GPL-2.0**（因 `@audio/decode-aac` 传染）。需更新 `package.json` 的 `license` 字段和 README。

## 四、实施计划

### 4.1 新建 `src/utils/media.ts`（替代 `ffmpeg.ts`）

```
mergeDashStreams(videoPath, audioPath, destPath)  // fMP4+fMP4 → MP4
transcodeToMp3(inputPath, outputPath, bitrate)     // m4a → mp3
extractAudioFromMp4(videoPath, outputPath)         // mp4 → m4a
convertTsToMp4(inputPath, outputPath)               // ts → mp4
```

### 4.2 修改 `DownloadService.ts`

- 移除 `import { ... } from '../utils/ffmpeg'`
- 改为 `import { mergeDashStreams, transcodeToMp3, extractAudioFromMp4 } from '../utils/media'`
- DASH 合并：`mergeDashStreams(videoPath, audioPath, mergedPath)`
- `--audio-only --format mp3`：`transcodeToMp3(audioPath, mp3Path, 192)`
- durl `--audio-only`：如果是 MP4 则 `extractAudioFromMp4()` 再转码，FLV 则保留原文件

### 4.3 修改 `download.ts` 和 `fav.ts`

- 移除 `import { findFfmpeg } from '../utils/ffmpeg'`
- 移除 ffmpeg 探测逻辑和警告

### 4.4 删除 `src/utils/ffmpeg.ts`

### 4.5 测试

- 现有单元测试更新 mock
- 新增 `tests/unit/media.test.ts` 测试合并/转码逻辑
- 端到端验证：下载一个 DASH 视频，确认合并后的 MP4 可播放

## 五、风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| `@audio/decode-aac` 是 ESM，pilidown 是 CommonJS | 需用动态 `import()` | 在 `media.ts` 中用 async import |
| `@breezystack/lamejs` 3 年未更新 | 可能有未修 bug | 247K 周下载说明仍可用；上游 fork 修了主要 bug |
| mp4box API 是回调式，需封装成 Promise | 代码复杂度增加 | 封装为 `parseMp4(buffer)` 返回 Promise |
| FLV durl 无法提取音频 | 部分 durl 视频 `--audio-only` 不可用 | 先支持 MP4，FLV 保留原文件并提示 |
| GPL-2.0 传染 | pilidown 许可证变更 | 用户已确认接受 |
