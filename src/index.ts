#!/usr/bin/env node
/**
 * pilidown - Lightweight Bilibili downloader CLI
 * Ported from DownKyi (https://github.com/leiurayer/downkyi)
 * MIT License
 */

import { Command } from 'commander';
import { registerInfoCommand } from './commands/info';
import { registerStreamCommand } from './commands/stream';
import { registerDownloadCommand } from './commands/download';
import { registerDanmakuCommand } from './commands/danmaku';
import { registerSubtitleCommand } from './commands/subtitle';
import { registerLoginCommand } from './commands/login';
import { registerBangumiCommand } from './commands/bangumi';
import { registerCheeseCommand } from './commands/cheese';
import { registerFavCommand } from './commands/fav';
import { registerHistoryCommand } from './commands/history';
import { registerSpaceCommand } from './commands/space';
import { registerStatusCommand } from './commands/status';

const program = new Command();

program
  .name('pilidown')
  .description('Lightweight Bilibili downloader CLI')
  .version('0.2.0');

registerInfoCommand(program);
registerStreamCommand(program);
registerDownloadCommand(program);
registerDanmakuCommand(program);
registerSubtitleCommand(program);
registerLoginCommand(program);
registerBangumiCommand(program);
registerCheeseCommand(program);
registerFavCommand(program);
registerHistoryCommand(program);
registerSpaceCommand(program);
registerStatusCommand(program);

program.parse(process.argv);
