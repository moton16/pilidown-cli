#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('pilidown')
  .description('Lightweight Bilibili downloader CLI')
  .version('0.0.0');

// Placeholder: subcommands will be registered in M3+
program.parse(process.argv);
