/**
 * pilidown - login command (M8.3)
 * Original C# source: src/DownKyi.Core/BiliApi/LoginNew/LoginQR.cs
 *
 * Usage: pilidown login [--json] [--timeout <seconds>]
 *
 * Flow:
 *   1. GET /x/passport-login/web/qrcode/generate -> url + qrcode_key
 *   2. Print QR code to terminal (or emit `qrcode` JSON Lines event in --json)
 *   3. Poll /x/passport-login/web/qrcode/poll every 2s until login success or expiry
 *   4. On success: parse Set-Cookie, merge with existing cookies.json, save.
 */

import type { Command } from 'commander';
import { generateQrCode, pollLoginStatus, QR_STATUS } from '../api/LoginApi';
import { printQrCodeInTerminal } from '../utils/qrcode';
import { loadCookies, saveCookies, mergeCookies } from '../services/CookieService';
import { setJsonMode, info, warn, error as logError, isJsonMode } from '../utils/logger';

const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_SEC = 300;

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Scan QR code with the Bilibili mobile app to log in')
    .option('--json', 'Output as JSON Lines (for agent use)')
    .option('--timeout <seconds>', 'Max polling duration in seconds', parseInt, DEFAULT_TIMEOUT_SEC)
    .action(async (opts: { json?: boolean; timeout: number }) => {
      if (opts.json) setJsonMode(true);
      const maxAttempts = Math.max(1, Math.floor((opts.timeout * 1000) / POLL_INTERVAL_MS));
      try {
        const { url, qrcodeKey } = await generateQrCode();

        if (isJsonMode()) {
          // JSON Lines: emit machine-readable QR url + key so agents can render or display it.
          info('qrcode', { url, qrcodeKey });
        } else {
          console.log('请使用 Bilibili 手机 App 扫描下方二维码登录：');
          console.log('');
          await printQrCodeInTerminal(url);
          console.log('');
          console.log(`(若二维码无法识别，可手动访问此 URL: ${url})`);
        }

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await sleep(POLL_INTERVAL_MS);
          const status = await pollLoginStatus(qrcodeKey);

          if (status.code === QR_STATUS.SUCCESS) {
            // 登录成功：合并到已有 cookies.json 并保存
            const existing = loadCookies();
            const merged = mergeCookies(existing.cookies, status.cookies ?? {});
            saveCookies({
              cookies: merged,
              refresh_token: status.refresh_token ?? existing.refresh_token,
            });
            if (isJsonMode()) {
              info('login_success', {
                refresh_token: status.refresh_token,
                saved_keys: Object.keys(merged),
              });
            } else {
              console.log('登录成功！Cookies 已保存到 ~/.pilidown/cookies.json');
            }
            return;
          }

          if (status.code === QR_STATUS.EXPIRED) {
            if (isJsonMode()) {
              warn('qrcode_expired', { code: status.code, message: status.message });
            } else {
              console.log('二维码已失效，请重新运行 login 命令。');
            }
            process.exitCode = 1;
            return;
          }

          if (status.code === QR_STATUS.NOT_SCANNED) {
            if (isJsonMode()) {
              info('waiting_for_scan', { code: status.code, attempt });
            } else {
              console.log('等待扫码...');
            }
            continue;
          }

          if (status.code === QR_STATUS.WAITING_CONFIRM) {
            if (isJsonMode()) {
              info('waiting_for_confirm', { code: status.code, attempt });
            } else {
              console.log('已扫码，等待确认...');
            }
            continue;
          }

          // 未知状态码：警告但继续轮询
          if (isJsonMode()) {
            warn('unknown_status', { code: status.code, message: status.message });
          } else {
            console.log(`未知状态: code=${status.code} message=${status.message}`);
          }
        }

        // 轮询超时
        if (isJsonMode()) {
          warn('login_timeout', { attempts: maxAttempts, timeout_sec: opts.timeout });
        } else {
          console.log(`登录超时（已轮询 ${maxAttempts} 次，共 ${opts.timeout} 秒）。`);
        }
        process.exitCode = 1;
      } catch (err) {
        logError('login failed', { error: (err as Error).message });
        process.exitCode = 1;
      }
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
