import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { auditContent } from '../afyx-security-auditor.mjs';
import { verifyReviewedProvenance } from '../verify-upstream-provenance.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { entries } = JSON.parse(readFileSync(new URL('../native-source-ownership.json', import.meta.url), 'utf8'));

test('pure-AFYX provenance passes and rejects any upstream classification or third-party notice', () => {
  verifyReviewedProvenance(root, entries);
  const entry = entries.find(item => item.path.endsWith('/ui-server/static.ts'));
  assert.equal(entry?.classification, 'AFYX_NATIVE_IMPLEMENTATION');
  assert.throws(() => verifyReviewedProvenance(root, [{ ...entry, classification: 'DERIVED_MIT_UPSTREAM' }]), /Disallowed upstream/);

  const tempDir = mkdtempSync(join(tmpdir(), 'afyx-pure-prov-'));
  try {
    writeFileSync(join(tempDir, 'THIRD_PARTY_NOTICES.md'), 'forbidden');
    assert.throws(() => verifyReviewedProvenance(tempDir, []), /Forbidden third-party notice/);
    rmSync(join(tempDir, 'THIRD_PARTY_NOTICES.md'));
    writeFileSync(join(tempDir, 'LICENSE'), 'Copyright (c) 2026 Elsewhere\n');
    assert.throws(() => verifyReviewedProvenance(tempDir, []), /Missing canonical Afyx copyright|Non-AFYX copyright/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('audit recognizes credential URLs, config literals, unsafe YAML, and dynamic SQL without exposing literals', () => {
  const cases = [
    ['config.yml', 'dsn: postgres://demo:fixture-data@db.invalid/demo', 'SEC-SECRET-01'],
    ['config.yml', 'dsn: mongodb+srv://demo:fixture-data@db.invalid/demo', 'SEC-SECRET-01'],
    ['config.yml', 'dsn: redis://:fixture-data@db.invalid', 'SEC-SECRET-01'],
    ['app.toml', 'token = "fixture-data"', 'SEC-SECRET-01'],
    ['infra.tf', 'password = "fixture-data"', 'SEC-SECRET-01'],
    ['loader.py', 'data = yaml.load(stream, Loader=yaml.Loader)', 'SEC-EVAL-01'],
    ['queries.py', 'query = f"SELECT name FROM demo WHERE id = {record_id}"', 'SEC-SQL-01'],
    ['queries.js', 'query = "DELETE FROM demo WHERE id = " + recordId;', 'SEC-SQL-01'],
    ['queries.js', 'query = `SELECT name FROM demo WHERE id = ${recordId}`;', 'SEC-SQL-01'],
  ];
  for (const [path, content, rule] of cases) {
    const results = auditContent(content, path);
    assert.ok(results.some(result => result.ruleId === rule), rule + ' at ' + path);
    assert.ok(results.every(result => result.snippet === '[REDACTED: source line]'));
    assert.ok(!JSON.stringify(results).includes('fixture-data'));
  }
  for (const content of ['yaml.safe_load(stream)', 'yaml.load(stream, Loader=yaml.SafeLoader)', 'query = "SELECT name FROM demo WHERE id = ?"']) {
    assert.deepEqual(auditContent(content, 'fixture.py'), []);
  }
});
