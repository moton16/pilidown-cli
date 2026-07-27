/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# source: src/DownKyi.Core/Utils/QRCode.cs (replaced QRCoder with `qrcode` npm package)
 */

import * as QRCode from 'qrcode';
import * as path from 'node:path';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * Render `url` as a terminal-friendly ASCII QR code and write it to stdout.
 * Used for human mode (TTY) login flow.
 */
export async function printQrCodeInTerminal(url: string): Promise<void> {
  const text = await QRCode.toString(url, { type: 'terminal' });
  process.stdout.write(text + '\n');
}

/**
 * Return the QR code rendered as a terminal string (for JSON mode / programmatic use).
 */
export async function getQrCodeString(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'terminal' });
}

/**
 * Save QR code as a PNG file. Returns the absolute path.
 * ASCII codes in Windows Terminal often fail to scan; a PNG file is reliable.
 */
export async function saveQrCodePng(url: string, filePath: string): Promise<string> {
  const abs = path.resolve(filePath);
  await QRCode.toFile(abs, url, { width: 480, margin: 2 });
  return abs;
}

/**
 * Start a local HTTP server showing the QR code as an HTML page.
 * Returns the URL the user should open in their browser.
 * Caller is responsible for closing the server via `close()`.
 */
export async function startQrHttpServer(
  qrUrl: string,
  onScanSuccess?: () => void,
): Promise<{ url: string; close: () => void }> {
  const dataUrl = await QRCode.toDataURL(qrUrl, { width: 480, margin: 2 });
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pilidown 登录二维码</title>
<style>
* { box-sizing: border-box; }
body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; font-family: -apple-system, "Segoe UI", sans-serif; background: #f4f5f7; color: #333; }
.card { background: white; padding: 32px 40px; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); text-align: center; }
h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; }
.qr-wrap { margin: 20px 0; padding: 16px; background: white; border-radius: 8px; }
.qr-wrap img { width: 360px; height: 360px; display: block; }
.tip { color: #666; font-size: 14px; line-height: 1.6; }
.tip strong { color: #00a1d6; }
.status { margin-top: 16px; padding: 8px 16px; border-radius: 4px; background: #fff3cd; color: #856404; font-size: 14px; }
.status.success { background: #d4edda; color: #155724; }
</style>
</head>
<body>
<div class="card">
<h1>pilidown 登录二维码</h1>
<div class="qr-wrap"><img src="${dataUrl}" alt="QR Code" /></div>
<div class="tip">请使用 <strong>B 站手机 App</strong> 扫描上方二维码<br/>(在 App 右上角扫一扫)</div>
<div id="status" class="status">等待扫码...</div>
</div>
<script>
const evt = new EventSource('/events');
const el = document.getElementById('status');
evt.addEventListener('status', (e) => {
  const data = JSON.parse(e.data);
  el.textContent = data.message;
  el.className = 'status' + (data.done ? ' success' : '');
  if (data.done) { document.title = '登录成功 - pilidown'; }
});
</script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Keep connection open; status updates pushed via SSE.
      // (We don't actually need to push messages; the page just shows "waiting".)
      res.write(`event: status\ndata: ${JSON.stringify({ message: '等待扫码...', done: false })}\n\n`);
      // Send periodic heartbeats to keep connection alive.
      const heartbeat = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
      }, 15000);
      req.on('close', () => clearInterval(heartbeat));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      const port = addr.port;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => server.close(),
      });
    });
  });
}
