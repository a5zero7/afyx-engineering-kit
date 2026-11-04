#!/usr/bin/env node
/**
 * Afyx Forge Core — CLI Executable Entrypoint
 */

import { runCli } from '../src/cli.js';

runCli(process.argv.slice(2)).then((code) => {
  if (typeof code === 'number' && code !== 0) {
    process.exit(code);
  }
}).catch((err) => {
  console.error(`Unexpected failure in afyx-forge: ${err.stack || err.message}`);
  process.exit(1);
});

