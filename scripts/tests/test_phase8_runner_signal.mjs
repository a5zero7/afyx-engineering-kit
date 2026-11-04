import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, '..', '..');
const runnerPath = path.join(repositoryRoot, 'scripts', 'phase8-representative-workload.mjs');

console.log('Testing Phase 8 Runner signal integrity and regression...');

// 1. Positive Run (--ci)
const pos = spawnSync(process.execPath, [runnerPath, '--ci'], {
  cwd: repositoryRoot,
  encoding: 'utf-8',
});
assert.equal(pos.status, 0, `Expected exit code 0 for positive run, got ${pos.status}: ${pos.stderr}`);
const posReport = JSON.parse(pos.stdout.trim());
assert.equal(posReport.acceptanceMatrix['P08-8_ACE_BYTE_EXACT_RECOVERY'], 'PASS');
assert.equal(posReport.acceptanceMatrix['P08-6_ACE_DEFAULT_OFF'], 'PASS');
console.log('✔ Positive run passed and derived PASS dynamically.');

// 2. Negative Run (--inject-failure fail-recovery)
const negRec = spawnSync(process.execPath, [runnerPath, '--ci', '--inject-failure', 'fail-recovery'], {
  cwd: repositoryRoot,
  encoding: 'utf-8',
});
assert.equal(negRec.status, 1, `Expected exit code 1 for injected recovery failure, got ${negRec.status}`);
const negRecReport = JSON.parse(negRec.stdout.trim());
assert.equal(negRecReport.acceptanceMatrix['P08-8_ACE_BYTE_EXACT_RECOVERY'], 'FAIL');
assert.equal(negRecReport.contextEngineEvaluation.overallVerdict, 'FAIL');
console.log('✔ Negative test for recovery failure verified (exit code 1, matrix FAIL).');

// 3. Negative Run (--inject-failure fail-default-off)
const negOff = spawnSync(process.execPath, [runnerPath, '--ci', '--inject-failure', 'fail-default-off'], {
  cwd: repositoryRoot,
  encoding: 'utf-8',
});
assert.equal(negOff.status, 1, `Expected exit code 1 for injected default-off failure, got ${negOff.status}`);
const negOffReport = JSON.parse(negOff.stdout.trim());
assert.equal(negOffReport.acceptanceMatrix['P08-6_ACE_DEFAULT_OFF'], 'FAIL');
assert.equal(negOffReport.contextEngineEvaluation.overallVerdict, 'FAIL');
console.log('✔ Negative test for default-off failure verified (exit code 1, matrix FAIL).');

console.log('\nAll Phase 8 runner signal integrity tests passed.');

