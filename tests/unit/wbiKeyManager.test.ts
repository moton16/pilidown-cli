/**
 * pilidown - Unit tests for WbiKeyManager
 * Original: tests are original to pilidown.
 *
 * The WbiKeyManager singleton calls biliGet() which calls fetch internally.
 * We mock the fetch call so nav returns synthetic WBI img/sub URLs and
 * verify that the manager extracts keys, caches them, and produces mixinKey
 * via getMixinKey() (delegated to wbi.getMixinKey which already has its own
 * unit tests).
 */

import { wbiKeyManager } from '../../src/services/WbiKeyManager';

const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';

// Realistic 32-char hex keys for URL embedding.
const IMG_KEY = '653657f524a547ac981ded72ea172057';
const SUB_KEY = '6e4909c702f846728e64f6007736a338';

// ponytail: use mockImplementation so each fetch call returns a fresh Response
// (Response body can only be consumed once — mockResolvedValue reuses one instance).
function mockNav(): void {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(
      JSON.stringify({
        code: 0,
        message: '0',
        data: {
          isLogin: false,
          mid: 0,
          uname: '',
          wbi_img: {
            img_url: `https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`,
            sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`,
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

beforeEach(() => {
  wbiKeyManager.clearCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('WbiKeyManager.getKeys', () => {
  test('extracts 32-hex imgKey/subKey from nav URLs', async () => {
    mockNav();
    const keys = await wbiKeyManager.getKeys();
    expect(keys.imgKey).toBe(IMG_KEY);
    expect(keys.subKey).toBe(SUB_KEY);
  });

  test('caches: subsequent calls do not refetch nav', async () => {
    mockNav();
    await wbiKeyManager.getKeys();
    await wbiKeyManager.getKeys();
    await wbiKeyManager.getKeys();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('clearCache forces refetch on next call', async () => {
    mockNav();
    await wbiKeyManager.getKeys();
    wbiKeyManager.clearCache();
    await wbiKeyManager.getKeys();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test('throws when img_url does not contain 32-hex key', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          message: '0',
          data: { isLogin: false, mid: 0, wbi_img: { img_url: 'https://x/no-key.png', sub_url: 'https://x/no-key.png' } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(wbiKeyManager.getKeys()).rejects.toThrow(/Cannot extract WBI key/);
  });
});

describe('WbiKeyManager.getMixinKey', () => {
  test('returns 32-char mixinKey derived from imgKey+subKey via wbi.getMixinKey', async () => {
    mockNav();
    const mixinKey = await wbiKeyManager.getMixinKey();
    expect(mixinKey).toHaveLength(32);
    // Known good vector: imgKey+subKey produces this mixinKey (per M1 wbi tests).
    expect(mixinKey).toBe('72136226c6a73669787ee4fd02a74c27');
  });
});

// Suppress unused import warnings (nav URL kept for documentation).
void NAV_URL;
