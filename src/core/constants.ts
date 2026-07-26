/**
 * B 站视频画质 ID 表。
 * 参考 playurl 接口的 accept_quality / quality 字段。
 */
export const QUALITY: Record<number, string> = {
  127: '8K 超高清',
  126: '杜比视界',
  125: 'HDR 真彩',
  120: '4K 超清',
  116: '1080P 60帧',
  112: '1080P 高码率',
  100: '智能修复',
  80: '1080P 高清',
  74: '720P 60帧',
  64: '720P 高清',
  48: '720P',
  32: '480P 清晰',
  16: '360P 流畅',
};

/**
 * B 站音质 ID 表。
 * 参考 playurl 接口 dash.audio[].id 字段。
 */
export const AUDIO_QUALITY: Record<number, string> = {
  30216: '64K',
  30232: '132K',
  30280: '192K',
  30250: '杜比全景声',
  30251: 'Hi-Res 无损',
};

/**
 * B 站视频编码 ID 表。
 * 参考 playurl 接口 dash.video[].codecs 字段。
 */
export const CODEC: Record<number, string> = {
  7: 'AV1',
  12: 'HEVC',
  13: 'AVC',
};

/**
 * FNVAL 位掩码枚举。
 * 调用 playurl 时通过按位 OR 组合所需特性。
 */
export const FNVAL = {
  DASH: 16,
  HDR: 64,
  FOUR_K: 128,
  DOLBY_AUDIO: 256,
  DOLBY_VISION: 512,
  EIGHT_K: 1024,
  AV1: 2048,
} as const;

/**
 * 默认 fnval：请求所有现代特性。
 * 等价于 DASH|HDR|FOUR_K|DOLBY_AUDIO|DOLBY_VISION|EIGHT_K|AV1 = 4048。
 */
export const FNVAL_DEFAULT: number =
  FNVAL.DASH |
  FNVAL.HDR |
  FNVAL.FOUR_K |
  FNVAL.DOLBY_AUDIO |
  FNVAL.DOLBY_VISION |
  FNVAL.EIGHT_K |
  FNVAL.AV1;