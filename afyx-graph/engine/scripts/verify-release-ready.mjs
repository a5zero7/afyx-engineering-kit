#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDistributionLegalFiles } from './distribution-contract.mjs';
import { verifyReleaseReady } from './release-readiness.mjs';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootAt = process.argv.indexOf('--root');
const root = rootAt >= 0 && process.argv[rootAt + 1]
  ? resolve(process.argv[rootAt + 1])
  : scriptRoot;

try {
  verifyDistributionLegalFiles(root);
  const result = verifyReleaseReady(root);
  console.error(`[release-ready] PASS source=${result.sourceDigest}; assets=${result.assets}`);
} catch (error) {
  console.error(`[release-ready] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
