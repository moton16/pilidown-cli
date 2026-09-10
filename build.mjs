import { build } from 'esbuild';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const outdir = dirname(resolve('bin/cli.cjs'));
if (!existsSync(outdir)) {
  mkdirSync(outdir, { recursive: true });
}
const skillOutdir = dirname(resolve('skills/pilidown/bin/cli.cjs'));
if (!existsSync(skillOutdir)) {
  mkdirSync(skillOutdir, { recursive: true });
}

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'bin/cli.cjs',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

copyFileSync('bin/cli.cjs', 'skills/pilidown/bin/cli.cjs');

console.log('✓ Build complete: bin/cli.cjs and skills/pilidown/bin/cli.cjs');
