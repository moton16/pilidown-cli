const TABLE = 'fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF';
const MAP = [9, 8, 1, 6, 2, 4, 0, 7, 3, 5];
const XOR = 177451812;
const ADD = 100618342136696320;

const REVERSE_TABLE: Record<string, number> = {};
for (let i = 0; i < TABLE.length; i++) {
  REVERSE_TABLE[TABLE[i]] = i;
}

export function bv2av(bv: string): number {
  if (bv.length !== 12 || !bv.startsWith('BV')) {
    throw new Error('Invalid BV: must be 12 chars starting with "BV"');
  }
  const body = bv.substring(2);
  let r = 0n;
  for (let i = 0; i < 10; i++) {
    const ch = body[MAP[i]];
    const idx = REVERSE_TABLE[ch];
    if (idx === undefined) {
      throw new Error('Invalid BV: contains invalid character');
    }
    r += BigInt(idx) * (58n ** BigInt(i));
  }
  return Number((r - BigInt(ADD)) ^ BigInt(XOR));
}

export function av2bv(av: number): string {
  const x = (BigInt(av) ^ BigInt(XOR)) + BigInt(ADD);
  const chars: string[] = ['B', 'V', '', '', '', '', '', '', '', '', '', ''];
  for (let i = 0; i < 10; i++) {
    const idx = Number((x / (58n ** BigInt(i))) % 58n);
    chars[2 + MAP[i]] = TABLE[idx];
  }
  return chars.join('');
}