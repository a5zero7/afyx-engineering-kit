import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { auditContent, auditDirectory } from '../afyx-security-auditor.mjs';

test('audit mencakup komentar, format konfigurasi dan header kunci tanpa membocorkan nilai', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-audit-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const header = '-----BEGIN ' + 'PGP PRIVATE KEY BLOCK-----';
  for (const kind of ['PRIVATE KEY', 'RSA PRIVATE KEY', 'DSA PRIVATE KEY', 'EC PRIVATE KEY',
    'OPENSSH PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'PGP PRIVATE KEY BLOCK']) {
    const candidates = auditContent('# -----BEGIN ' + kind + '-----', 'fixture.env');
    assert.deepEqual(candidates.map(({ ruleId }) => ruleId), ['SEC-SECRET-01']);
  }
  assert.equal(auditContent('-----BEGIN PUBLIC KEY-----').length, 0);
  const patterns = ['AKIA' + 'A'.repeat(16), 'ghp_' + 'b'.repeat(36),
    'github_pat_' + 'c'.repeat(82), 'sk-' + 'd'.repeat(32), 'xoxb-' + 'e'.repeat(28)];
  for (const token of patterns) {
    const report = auditContent('# ' + token, 'secret.cfg');
    assert.equal(report.length, 1);
    assert.ok(!JSON.stringify(report).includes(token));
  }
  const setting = '# client_secret = "' + 'fixtureSyntheticValue927' + '"';
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', '.env.local'), setting);
  writeFileSync(join(root, 'app.toml'), header);
  writeFileSync(join(root, 'example.ini'), 'password = "placeholder-for-tests"');
  const report = auditDirectory(root);
  assert.equal(report.coverage, 'COMPLETE_WITHIN_RULES');
  assert.equal(report.scannedFilesCount, 3);
  assert.deepEqual(report.findings.map(({ filePath }) => filePath).sort(), ['app.toml', join('dist', '.env.local')]);
  assert.doesNotMatch(JSON.stringify(report), /fixtureSyntheticValue927|BEGIN PGP/);
  assert.equal(auditDirectory(root, { maxFiles: 1 }).coverage, 'PARTIAL');
  assert.equal(auditDirectory(root, { exclusions: ['dist'] }).scannedFilesCount, 2);
});

test('audit membedakan shell dinamis, pemanggilan aman, dan pengecualian fixture sempit', () => {
  const source = [
    "import { exec as run, spawn as launch } from 'node:child_process';",
    'run(commandFromCaller);',
    "launch('git', ['status'], {shell: true});",
    "launch('git', ['status']);",
    "const parsed = pattern.exec(text);",
    "readFileSync('../fixture.txt');",
    'exec(sql: string): void;',
    'exec(sql) { this.native.exec(sql); }',
    "launch('sh', ['-c', task]);",
    "execFileSync('which', [knownExecutable]);",
  ].join('\n');
  assert.deepEqual(auditContent(source, 'src/main.js').map(({ ruleId, lineNumber }) => [ruleId, lineNumber]),
    [['SEC-PROC-01', 2], ['SEC-PROC-01', 3], ['SEC-PATH-01', 6], ['SEC-PROC-01', 9]]);
  assert.equal(auditContent(source, 'scripts/tests/fixtures/sample.js').some(f => f.ruleId === 'SEC-PATH-01'), false);
  assert.equal(auditContent('# password = "fixtureSyntheticValue927"', 'tests/fixtures/.env').length, 1);
});

test('CLI menolak opsi invalid dan menghasilkan JSON yang bisa diparse', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-audit-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../afyx-security-auditor.mjs', import.meta.url));
  const invokeCli = (...args) => spawnSync(process.execPath, [cli, root, ...args], { encoding: 'utf8', timeout: 10000 });
  for (const args of [['--unknown'], ['--max-files'], ['--max-files', '0'], ['--json', '--format', 'json'],
    ['--format', 'xml'], ['--max-files', '1', '--max-files', '2'], ['--exclude', '../private']]) {
    assert.equal(invokeCli(...args).status, 2);
  }
  const result = invokeCli('--json');
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, 'PASS');
});

test('disposition ledger hanya mengecualikan test fixtures yang valid dan menolak waiver produksi atau konten yang diubah', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-audit-ledger-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });

  const prodSecret = 'const token = "AKIA' + 'A'.repeat(16) + '";';
  const testSecret = 'const testKey = "ghp_' + 'b'.repeat(36) + '";';
  writeFileSync(join(root, 'src', 'app.js'), prodSecret);
  writeFileSync(join(root, 'test', 'sample.test.js'), testSecret);

  const testDigest = (await import('node:crypto')).createHash('sha256').update(testSecret.trim()).digest('hex');

  // Ledger attempting both a production waiver and a valid test fixture waiver
  const ledger = {
    contract: 'afyx-security-disposition-ledger-v1',
    entries: [
      {
        id: 'DISP-FAKE-PROD',
        filePath: 'src/app.js',
        lineNumber: 1,
        ruleId: 'SEC-SECRET-01',
        contextDigest: (await import('node:crypto')).createHash('sha256').update(prodSecret.trim()).digest('hex'),
        classification: 'REAL_RISK',
        rationale: 'Illegitimate production waiver attempt',
        disposition: 'WAIVED_TEST_FIXTURE'
      },
      {
        id: 'DISP-VALID-TEST',
        filePath: 'test/sample.test.js',
        lineNumber: 1,
        ruleId: 'SEC-SECRET-01',
        contextDigest: testDigest,
        classification: 'EXPECTED_SYNTHETIC_FIXTURE',
        rationale: 'Legitimate test fixture waiver',
        disposition: 'WAIVED_TEST_FIXTURE'
      }
    ]
  };

  const ledgerPath = join(root, 'scripts', 'security-audit-disposition.json');
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  // 1. Audit with disposition: production secret MUST NOT be waived and must fail the audit
  const withoutApproval = auditDirectory(root);
  assert.equal(withoutApproval.findings.some((finding) => finding.disposition === 'WAIVED_TEST_FIXTURE'), false);
  const reportWithProd = auditDirectory(root, { dispositionPath: ledgerPath });
  assert.equal(reportWithProd.status, 'FAIL');
  assert.equal(reportWithProd.coverage, 'COMPLETE_WITHIN_RULES');
  assert.equal(reportWithProd.findings.length, 1);
  assert.equal(reportWithProd.findings[0].filePath, join('src', 'app.js'));
  assert.equal(reportWithProd.waivedFindings.length, 1);
  assert.equal(reportWithProd.waivedFindings[0].waiverId, 'DISP-VALID-TEST');

  // 2. Remove production secret so only test fixture remains
  writeFileSync(join(root, 'src', 'app.js'), '// Safe production code');
  const reportClean = auditDirectory(root, { dispositionPath: ledgerPath });
  assert.equal(reportClean.status, 'PASS');
  assert.equal(reportClean.findings.length, 0);
  assert.equal(reportClean.waivedFindings.length, 1);

  // 3. Tamper with test fixture content (digest mismatch) -> waiver must be rejected
  writeFileSync(join(root, 'test', 'sample.test.js'), 'const testKey = "ghp_' + 'c'.repeat(36) + '";');
  const reportTampered = auditDirectory(root, { dispositionPath: ledgerPath });
  assert.equal(reportTampered.status, 'FAIL');
  assert.equal(reportTampered.findings.length, 1);
  assert.equal(reportTampered.waivedFindings.length, 0);

  // 4. Partial scan must result in INCOMPLETE and PARTIAL, never PASS
  const reportPartial = auditDirectory(root, { maxFiles: 1 });
  assert.equal(reportPartial.status, 'INCOMPLETE');
  assert.equal(reportPartial.coverage, 'PARTIAL');
});
