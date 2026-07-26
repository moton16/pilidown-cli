/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Original C# source: src/DownKyi.Core/Utils/QRCode.cs (replaced QRCoder with `qrcode` npm package)
 */

import * as QRCode from 'qrcode';

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
