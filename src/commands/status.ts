import type { Command } from 'commander';
import { loadCookies } from '../services/CookieService';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show local login status without displaying credentials')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const cookies = loadCookies().cookies;
      const loggedIn = Boolean(cookies.SESSDATA);
      const result = { loggedIn, recommendedQuality: loggedIn ? 80 : 16, recommendedAudioQuality: loggedIn ? 30280 : 30216 };
      if (opts.json) {
        process.stdout.write(JSON.stringify({ event: 'status', data: result }) + '\n');
      } else {
        console.log(loggedIn ? '已检测到本地登录状态。' : '未检测到本地登录状态。');
        console.log(`默认画质: ${loggedIn ? '1080P30' : '最低可用画质'}；默认音质: ${loggedIn ? '192k' : '最低可用音质'}`);
      }
    });
}
