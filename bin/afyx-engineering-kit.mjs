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
import { runMidnightCircuit, terminalMode } from '../scripts/afyx-midnight-circuit.mjs';

function verifyNodeRuntime() {
  const version = process.versions.node;
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error(`Error: AFYX Engineering Kit requires Node.js >= 22.5.0 (current: v${version}).`);
    process.exit(1);
  }
}

async function main() {
  verifyNodeRuntime();
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

  let finish;
  if (parsed.command === 'install') {
    const mode = terminalMode({ requested: parsed.options.ui || 'auto' });
    const hasSelections = parsed.options.preset || parsed.options.provider || parsed.options.providerScope ||
      parsed.options.skipProviderConfiguration || parsed.options.componentActions.length || parsed.options.customComponents.length;
    if (parsed.options.ui === 'tui' && (hasSelections || parsed.options.nonInteractive || parsed.options.dryRun || parsed.options.validateOnly)) {
      throw new Error('--ui tui runs the interactive installer; remove scripted selection/preview flags or use --ui plain.');
    }
    if (mode === 'tui' && !hasSelections &&
        !parsed.options.nonInteractive && !parsed.options.dryRun && !parsed.options.validateOnly) {
      const selection = await runMidnightCircuit({ options: parsed.options });
      if (!selection) { console.log('Installation canceled without changes.'); return; }
      finish = selection.finish;
      Object.assign(parsed.options, selection);
      delete parsed.options.finish;
    }
  }
  const callInfo = buildSubprocessCall(parsed.command, parsed.options);
  if (parsed.options.ui === 'plain') callInfo.env = { ...callInfo.env, NO_COLOR: '1' };

  try {
    const exitCode = await executeSubprocess(callInfo);
    const finalCode = finish ? await finish(exitCode) : exitCode;
    process.exit(finalCode);
  } catch (err) {
    if (finish) await finish(1);
    console.error(`Failed to launch installer lifecycle subprocess (${callInfo.executable}):`, err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal CLI execution error:', err);
  process.exit(1);
});
