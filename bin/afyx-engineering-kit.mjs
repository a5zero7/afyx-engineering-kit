#!/usr/bin/env node

/**
 * afyx-engineering-kit
 * Universal CLI entrypoint for AFYX Engineering Kit.
 */

import {
  getPackageVersion,
  getHelpText,
  parseCliArgs,
  buildSubprocessCall,
  executeSubprocess,
} from '../scripts/afyx-npm-installer.mjs';

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.showVersion) {
    console.log(`afyx-engineering-kit v${getPackageVersion()}`);
    process.exit(0);
  }

  if (parsed.showHelp) {
    console.log(getHelpText());
    process.exit(0);
  }

  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      console.error(`Error: ${err}`);
    }
    console.error('\nRun "afyx-engineering-kit --help" for usage information.');
    process.exit(1);
  }

  const callInfo = buildSubprocessCall(parsed.command, parsed.options);

  try {
    const exitCode = await executeSubprocess(callInfo);
    process.exit(exitCode);
  } catch (err) {
    console.error(`Failed to launch installer lifecycle subprocess (${callInfo.executable}):`, err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal CLI execution error:', err);
  process.exit(1);
});
