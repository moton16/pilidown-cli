import { createHash } from 'node:crypto';

/**
 * WBI mixin key 重排表（B 站官方固定值）。
 * 64 项，是 0..63 的特定置换。
 * 来源：SocialSisterYi/bilibili-API-collect wbi.md
 */
export const MIXIN_KEY_ENC_TAB: readonly number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

/**
 * 从 img_key+sub_key 派生 mixin_key。
 * 取 raw 按 MIXIN_KEY_ENC_TAB 重排后的前 32 个字符。
 * @param raw img_key + sub_key 拼接（长度 >= 64）
 */
export function getMixinKey(raw: string): string {
  let out = '';
  for (const idx of MIXIN_KEY_ENC_TAB) {
    out += raw[idx];
  }
  return out.substring(0, 32);
}

/**
 * 过滤 WBI 签名中不参与的 sub-delim 字符。
 * B 站约定：query 中的 !'()* 不参与签名计算。
 */
function filterSpecialChars(s: string): string {
  return s.replace(/[!'()*]/g, '');
}

/**
 * 对参数进行 WBI 签名，返回 32 位小写 hex 的 w_rid。
 *
 * 步骤：
 * 1. 注入 wts（秒级时间戳）
 * 2. 按 key 字典序升序排序
 * 3. URL 编码后过滤 !'()* 字符
 * 4. 拼接 mixin_key 后计算 md5
 *
 * @param params 业务参数（不含 wts/w_rid）
 * @param mixinKey 由 getMixinKey 计算得到
 * @param wts 秒级 Unix 时间戳
 */
export function encWbi(
  params: Record<string, string | number>,
  mixinKey: string,
  wts: number,
): string {
  const withWts: Record<string, string | number> = { ...params, wts };
  const sortedKeys = Object.keys(withWts).sort();
  const parts: string[] = [];
  for (const k of sortedKeys) {
    const v = withWts[k];
    const encoded = `${k}=${encodeURIComponent(String(v))}`;
    parts.push(filterSpecialChars(encoded));
  }
  const query = parts.join('&');
  return createHash('md5').update(query + mixinKey, 'utf8').digest('hex');
}