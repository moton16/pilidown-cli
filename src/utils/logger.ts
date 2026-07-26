/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 *
 * Note: Original DownKyi uses WPF UI for progress display.
 * This logger is rewritten for CLI/agent use (TTY + JSON Lines).
 */

let jsonMode = false;

export function setJsonMode(enabled: boolean): void { jsonMode = enabled; }
export function isJsonMode(): boolean { return jsonMode; }

export function info(event: string, data?: unknown): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ event, data }) + '\n');
  } else {
    process.stdout.write(`[info] ${event}${data ? ' ' + JSON.stringify(data) : ''}\n`);
  }
}

export function warn(event: string, data?: unknown): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ level: 'warn', event, data }) + '\n');
  } else {
    process.stderr.write(`[warn] ${event}${data ? ' ' + JSON.stringify(data) : ''}\n`);
  }
}

export function error(event: string, data?: unknown): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ level: 'error', event, data }) + '\n');
  } else {
    process.stderr.write(`[error] ${event}${data ? ' ' + JSON.stringify(data) : ''}\n`);
  }
}

export function progress(current: number, total: number, extra?: Record<string, unknown>): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ event: 'progress', data: { current, total, ...extra } }) + '\n');
  } else if (process.stdout.isTTY) {
    const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
    const bar = '█'.repeat(Math.floor(percent / 5)).padEnd(20, '░');
    process.stdout.write(`\r${percent}% [${bar}] ${current}/${total}`);
    if (current >= total) process.stdout.write('\n');
  }
}
