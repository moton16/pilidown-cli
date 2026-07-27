const { tmpdir, homedir } = require('node:os');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');

const testHome = join(tmpdir(), `pilidown-test-${process.pid}`);
mkdirSync(testHome, { recursive: true });
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
console.log('[pilidown-test-setup] HOME=' + testHome + ' homedir=' + homedir());
