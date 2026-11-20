import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  WorkLedger,
  ImpactSimulator,
  DbInspector,
  EnvPreflight,
  CliCompactor,
  MassiveContextNavigator,
} from '../src/index.js';
import {
  MigrationPlanner,
  ContractValidator,
} from '../../afyx-forge/src/index.js';

describe('Matrix A — General & Non-Code Workspaces (POSTV1-UNIVERSAL-TOOLS-C03)', () => {
  it('operates fully in a non-code document workspace without Git or Jira requirements', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-matrix-a-doc-'));

    try {
      // Create non-code folders and files
      fs.mkdirSync(path.join(tmpDir, 'docs', 'reports'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });

      // 1. Markdown & Documents
      const docPath = path.join(tmpDir, 'docs', 'architecture.md');
      fs.writeFileSync(docPath, `# Engineering Standard v1\n\nSee [Security Guidelines](reports/security.md) for details.\n`);
      const reportPath = path.join(tmpDir, 'docs', 'reports', 'security.md');
      fs.writeFileSync(reportPath, `# Security Audit\n\nAll credentials must be redacted.\n`);

      // 2. CSV Data with sensitive columns
      const csvPath = path.join(tmpDir, 'data', 'users.csv');
      fs.writeFileSync(csvPath, `id,name,role,password\n1,Alice,Admin,supersecret123\n2,Bob,Analyst,mypassword456\n`);

      // 3. JSON Configuration
      const jsonPath = path.join(tmpDir, 'data', 'settings.json');
      fs.writeFileSync(jsonPath, JSON.stringify({ app: 'DocsPortal', port: 8080, api_key: 'secret-key-xyz' }, null, 2));

      // 4. NDJSON
      const ndjsonPath = path.join(tmpDir, 'data', 'events.ndjson');
      fs.writeFileSync(ndjsonPath, `{"event":"login","user":"Alice","token":"bearer-1"}\n{"event":"view","user":"Bob","token":"bearer-2"}\n`);

      // 5. Environment example
      const envExPath = path.join(tmpDir, '.env.example');
      fs.writeFileSync(envExPath, `PORT=8080\nDB_HOST=localhost\nAPP_SECRET=change-me\n`);
      const envPath = path.join(tmpDir, '.env');
      fs.writeFileSync(envPath, `PORT=8080\nDB_HOST=localhost\nAPP_SECRET=production-secret-999\n`);

      // Test 1: Work Ledger (No Git / Jira required)
      const ledger = new WorkLedger(tmpDir);
      const entry = ledger.recordEntry({
        ledgerId: 'task-doc-org-01',
        taskObjective: 'Organize documentation and audit user datasets',
        scope: 'docs, data',
        decisions: [{ decision: 'Standardize security reports under docs/reports', rationale: 'ISO conformity' }],
        affectedFiles: ['docs/architecture.md', 'docs/reports/security.md', 'data/users.csv'],
        verificationState: 'VERIFIED',
        evidence: [{ summary: 'File checksums generated successfully' }],
      });

      assert.strictEqual(entry.verificationState, 'VERIFIED');
      assert.strictEqual(entry.gitCommit, null);
      assert.strictEqual(entry.jiraIssue, null);
      assert.strictEqual(entry.affectedFiles.length, 3);
      assert.ok(entry.affectedFiles[0].sha256.length === 64);

      const receipt = ledger.createReceipt('task-doc-org-01');
      assert.ok(receipt.receiptHash.length === 64);
      assert.strictEqual(WorkLedger.verifyReceipt(receipt), true);

      // Test 2: Migration Planner
      const planner = new MigrationPlanner(tmpDir);
      const plan = planner.createMigrationPlan({
        migrationType: 'document-migration',
        sourcePath: 'docs',
        targetPath: 'archive/docs_v1',
      });
      assert.strictEqual(plan.status, 'READY_TO_APPLY');
      assert.strictEqual(plan.dryRun, true);
      assert.strictEqual(plan.rollbackPlan.feasible, true);
      assert.ok(plan.stagedSteps.length >= 3);

      // Test 3: DB / Data Inspector (CSV sensitive column redaction)
      const inspector = new DbInspector(tmpDir);
      const csvReport = inspector.inspectDataset('data/users.csv');
      assert.strictEqual(csvReport.status, 'INSPECTED');
      assert.strictEqual(csvReport.rowCount, 2);
      assert.strictEqual(csvReport.sample[0].password, '[REDACTED]');
      assert.strictEqual(csvReport.sample[1].password, '[REDACTED]');

      // Test JSON Inspection with sensitive key redaction
      const jsonReport = inspector.inspectDataset('data/settings.json');
      assert.strictEqual(jsonReport.status, 'INSPECTED');
      assert.strictEqual(jsonReport.sample[0].api_key, '[REDACTED]');

      // Test NDJSON Inspection with sensitive token redaction
      const ndjsonReport = inspector.inspectDataset('data/events.ndjson');
      assert.strictEqual(ndjsonReport.status, 'INSPECTED');
      assert.strictEqual(ndjsonReport.sample[0].token, '[REDACTED]');

      // Test 4: Contract Validator (.env vs .env.example)
      const validator = new ContractValidator(tmpDir);
      const envVal = validator.validate('.env', { contractType: 'env', exampleFile: '.env.example' });
      assert.strictEqual(envVal.status, 'PASS');
      assert.strictEqual(envVal.totalKeysFound, 3);

      // Verify diagnostics NEVER leak the actual secret value
      const rawReport = JSON.stringify(envVal);
      assert.ok(!rawReport.includes('production-secret-999'));

      // Test 5: Env Preflight
      const preflight = new EnvPreflight(tmpDir);
      const pfResult = await preflight.runPreflight({ portsToCheck: [39123] });
      assert.ok(['PASS', 'WARN'].includes(pfResult.status));
      assert.strictEqual(pfResult.checks.find((c) => c.name === 'node-runtime')?.status, 'PASS');
      assert.strictEqual(pfResult.checks.find((c) => c.name === 'workspace-permissions')?.status, 'PASS');

      // Test 6: Fallback Impact Simulator on documents (without Graph)
      const simulator = new ImpactSimulator(tmpDir);
      const simResult = simulator.simulate('docs/reports/security.md');
      assert.strictEqual(simResult.status, 'ANALYZED_FALLBACK');
      assert.strictEqual(simResult.downstream.some((d) => d.file === 'docs/architecture.md'), true);

      // Test 7: Massive Context Navigator on document archive
      const navigator = new MassiveContextNavigator(tmpDir, { chunkSizeBytes: 100 });
      const idxResult = navigator.indexWorkspace();
      assert.strictEqual(idxResult.status, 'INDEXED');
      assert.ok(idxResult.indexedFiles >= 4);

      const ctxResult = navigator.retrieveContext('Security Audit credentials');
      assert.strictEqual(ctxResult.status, 'RETRIEVED');
      assert.ok(ctxResult.segments.length > 0);
      assert.ok(ctxResult.segments.some((s) => s.content.includes('redacted')));

      // Test 8: CLI Compactor
      const compactor = new CliCompactor();
      const rawPassingLogs = Array.from({ length: 40 }, (_, i) => `✔ Test case ${i + 1} passed (2ms)`).join('\n') +
        '\nℹ tests 40\nℹ pass 40\nℹ fail 0\n';
      const compacted = compactor.compact(rawPassingLogs, { command: 'node --test' });
      assert.ok(compacted.reductionPercent > 40);
      assert.strictEqual(compacted.failuresPreserved, 0);
      assert.ok(compacted.compactedOutput.includes('<!-- AFYX-CLI-COMPACTED -->'));
    } finally {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  it('safely handles read-only SQL validation and rejects mutation payloads', () => {
    // Valid read-only queries
    assert.strictEqual(DbInspector.validateReadOnlySql('SELECT id, name FROM users WHERE active = 1').safe, true);
    assert.strictEqual(DbInspector.validateReadOnlySql('WITH ranked AS (SELECT * FROM sales) SELECT * FROM ranked').safe, true);
    assert.strictEqual(DbInspector.validateReadOnlySql('PRAGMA table_info(users)').safe, true);

    // Rejected mutation queries
    assert.strictEqual(DbInspector.validateReadOnlySql('DROP TABLE users').safe, false);
    assert.strictEqual(DbInspector.validateReadOnlySql('DELETE FROM users WHERE id = 1').safe, false);
    assert.strictEqual(DbInspector.validateReadOnlySql('UPDATE accounts SET balance = 0').safe, false);
    assert.strictEqual(DbInspector.validateReadOnlySql('INSERT INTO audit (msg) VALUES ("test")').safe, false);
    assert.strictEqual(DbInspector.validateReadOnlySql('SELECT 1; DROP TABLE users;').safe, false);
    assert.strictEqual(DbInspector.validateReadOnlySql('EXPLAIN ANALYZE SELECT * FROM users').safe, false);
    assert.strictEqual(DbInspector.validateReadOnlySql('PRAGMA writable_schema = ON').safe, false);
  });
});
