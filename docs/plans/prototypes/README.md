# 原型脚本

这些是为制定方案而写的**可运行验证脚本**，不是产品代码，不参与构建与测试。保留原因：两份方案里的关键结论都靠它们得出，实现时可以直接对照。

运行方式（本机 Node 22）：

```bash
node merge-mp4.mjs <video-only.mp4> <audio-only.mp4> <out.mp4>
node resume-prototype.mjs        # 自带本地 Range 服务器，无需外部依赖
```

---

## `merge-mp4.mjs` — 两个渐进式 MP4 的 box 级无损合并

**支撑**：`p1-batch2-plan.md` M1（`--container mp4`）

**做什么**：把两个单轨标准 MP4（video-only / audio-only）合成一个双轨 MP4。不解码、不重编码、与 codec 无关（AVC/HEVC/AV1 通用）：搬 `trak`、拼 `mdat`、修 `stco`/`co64` 偏移、重编 `trackID`、`mvhd` duration 取两轨最大值。

**已验证**：产出物 `ffmpeg -v error -xerror -i out -f null -` 全解码零错误，时长与 `ffmpeg -c copy` 参考输出一致。早期版本曾在 `stco` 偏移与 `mvhd` duration 上出错，脚本里保留的注释就是当时踩的坑。

**实现时注意**：这个脚本服务的是 **渐进式** 输入（`convertFmp4ToMp4` 的输出）。默认路径用的 `src/utils/fmp4.ts` 是 **fMP4 片段**合并，两者输入结构不同，不要混用。

---

## `resume-prototype.mjs` — 偏移直写 + 清单续传

**支撑**：`p1-batch2-plan.md` M2（字节级续传）

**做什么**：演示替代「tempDir + 分片文件 + 合并」的方案。预分配 `<dest>.part`，各 worker 用 `FileHandle.write(buf, 0, n, position)` 写到自己的区间，配 `<dest>.partstate.json` 记录每分片已完成字节数。成功 → `fsync` → `rename` → 删清单；失败 → 两个文件都保留，重跑即续传。

**5 个用例全部通过**：

| 用例 | 结果 |
|---|---|
| 正常下载 4 分片 | 大小正确，sha256 与源一致，成功后无残留 |
| 部分分片连续 500 | 分片级重试与退避生效，最终 sha256 一致 |
| 模拟断点（分片 0 半途）后重跑 | 命中清单续传，sha256 一致 |
| 服务器 `Content-Range` 起始偏移撒谎 | 被拒 |
| 服务器忽略 Range（回 200） | 被拒 |

**这个脚本存在的意义是证明一件事**：用「分片文件大小」推断续传进度是不安全的。危险路径是——服务器回 200（忽略 Range）→ 代码决定整段重写 → 这次重写写到一半被杀 → 残留分片里装的是**整文件前 N 字节**，而非该分片的第 N 字节；下次见大小落在 `(0, expected)` 就 append，产出**错位且永不报错**的数据。所以清单 + `Content-Range` 校验是必须的，不是保险。

**Windows 兼容**：脚本里的 `open(path, 'r+')` + ENOENT 退 `'w+'` 是必需的。`FileHandle.truncate()` 在 `'a+'` 模式下抛 `EPERM`（errno -4048），实测踩出。
