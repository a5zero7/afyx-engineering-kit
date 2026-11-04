#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DistributionError, verifyEngineDistribution } from './distribution-contract.mjs';

const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const staged = rootAt >= 0 && Boolean(args[rootAt + 1]);
const root = staged
  ? resolve(args[rootAt + 1])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = verifyEngineDistribution(root);
  console.log(
    `[check-ui-build] dist/viewer ok (index.html + ${result.assets} referenced asset(s)); ` +
      'dist/ engine intact',
  );
} catch (error) {
  const message = error instanceof DistributionError || error instanceof Error
    ? error.message
    : String(error);
  console.error(`[check-ui-build] ${message}`);
  process.exitCode = 1;
}
