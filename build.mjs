import { build } from 'esbuild';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const outdir = dirname(resolve('bin/cli.cjs'));
if (!existsSync(outdir)) {
  mkdirSync(outdir, { recursive: true });
}

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: 'bin/cli.cjs',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

console.log('✓ Build complete: bin/cli.cjs');
