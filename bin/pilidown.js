#!/usr/bin/env node
'use strict';

// npm bin entry — relies on Node.js being in PATH (handled by shebang).
// For direct download distribution, use bin/pilidown (Unix) or bin/pilidown.cmd (Windows)
// which can probe Node from multiple locations.

require('./cli.cjs');
