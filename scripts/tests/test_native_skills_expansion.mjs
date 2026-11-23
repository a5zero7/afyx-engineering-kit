import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AfyxEngineeringMemory,
  createEngineeringMemory,
  estimateTokens,
  estimateBytes,
  compressContextItems,
  detectRedundancy,
} from '../../afyx-context/src/index.js';

import {
  auditContent,
  auditDirectory,
  RISK_LEVELS,
} from '../afyx-security-auditor.mjs';

import {
  stripInstructionBoilerplate,
  extractStructuredCriteria,
  refineTaskDirective,
  evaluateTaskCompletion,
} from '../../afyx-forge/src/index.js';

describe('MB10: Native Skills Expansion Unit & Integration Tests', () => {
  // --- 1. Persistent Engineering Memory ---
  describe('Capability 1: Native Persistent Engineering Memory (afyx-context)', () => {
    it('records and retrieves project-scoped memories by relevance', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'afyx-mem-test-'));
      try {
        const mem = createEngineeringMemory({ projectRoot: tempDir, enabled: true, maxItems: 10 });

        mem.record({
          key: 'db-access-pattern',
          category: 'architecture',
          content: 'Always use parameterized SQL queries through SQLiteAdapter; never interpolate strings.',
          tags: ['sqlite', 'database', 'security'],
        });

        mem.record({
          key: 'orm-concurrency-rule',
          category: 'constraint',
          content: 'StoreWriter queue depth is strictly bounded to 16 bundles to prevent memory bloat.',
          tags: ['concurrency', 'memory', 'store-writer'],
        });

        // Exact symbol / tag query
        const res1 = mem.retrieve({ query: 'sqlite query execution', limit: 2 });
        assert.ok(res1.length > 0);
        assert.equal(res1[0].key, 'db-access-pattern');

        // Formatted Markdown prompt block
        const promptBlock = mem.formatForContext(res1);
        assert.ok(promptBlock.includes('<!-- AFYX-ENGINEERING-MEMORY:START -->'));
        assert.ok(promptBlock.includes('[ARCHITECTURE] db-access-pattern'));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('enforces deduplication and bounded retention limits', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'afyx-mem-bound-'));
      try {
        const mem = createEngineeringMemory({ projectRoot: tempDir, enabled: true, maxItems: 3 });

        // Record 4 distinct items
        mem.record({ key: 'item-1', category: 'fact', content: 'Fact 1' });
        mem.record({ key: 'item-2', category: 'fact', content: 'Fact 2' });
        mem.record({ key: 'item-3', category: 'fact', content: 'Fact 3' });
        mem.record({ key: 'item-4', category: 'fact', content: 'Fact 4' });

        // Must bound to maxItems (3)
        assert.equal(mem.items.length, 3);
        assert.equal(mem.items[0].key, 'item-4');

        // Deduplication: re-recording with same content or key updates in place
        mem.record({ key: 'item-4', category: 'fact', content: 'Fact 4 updated' });
        assert.equal(mem.items.length, 3);
        assert.equal(mem.items[0].content, 'Fact 4 updated');

        // Deletion
        assert.equal(mem.remove('item-4'), true);
        assert.equal(mem.items.length, 2);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('handles negative cases: disabled state and invalid input', () => {
      const mem = createEngineeringMemory({ enabled: false });
      assert.equal(mem.record({ key: 'k', content: 'c' }), null);
      assert.deepEqual(mem.retrieve({ query: 'test' }), []);

      const activeMem = createEngineeringMemory({ enabled: true });
      assert.throws(() => activeMem.record({ key: '', content: '' }), /non-empty/);
    });
  });

  // --- 2. Context Budgeting and Compression ---
  describe('Capability 2: Context Budgeting and Evidence Compression (afyx-context)', () => {
    it('estimates token and byte usage deterministically', () => {
      const sample = 'export function calculateTotal(items) { return items.reduce((a, b) => a + b, 0); }';
      const tokens = estimateTokens(sample);
      const bytes = estimateBytes(sample);

      assert.ok(tokens > 10 && tokens < 40);
      assert.equal(bytes, Buffer.byteLength(sample, 'utf8'));
    });

    it('compresses oversized context with truncation receipts and reference retention', () => {
      const items = [
        {
          id: 'critical-evidence.ts',
          text: 'export const CRITICAL_API_CONFIG = { timeoutMs: 5000, secure: true };\n'.repeat(50),
          priority: 10,
          references: ['CRITICAL_API_CONFIG', 'lib/config.ts'],
        },
        {
          id: 'secondary-log.txt',
          text: 'DEBUG log trace entry line...\n'.repeat(100),
          priority: 1,
          references: ['logger'],
        },
      ];

      // Compress under tight budget
      const result = compressContextItems(items, { maxBytes: 1500, maxLines: 25 });
      assert.equal(result.contract, 'afyx-context-budget-v1');
      assert.ok(result.metrics.consumedBytes <= 2000);
      assert.ok(result.admitted.length > 0);
      assert.ok(result.preservedReferences.includes('CRITICAL_API_CONFIG'));

      // Truncated item contains unambiguous metadata marker
      const partialItem = result.admitted.find((a) => a.status === 'PARTIAL');
      if (partialItem) {
        assert.ok(partialItem.text.includes('<!-- AFYX-TRUNCATED:'));
      }
    });

    it('detects repeated boilerplate lines', () => {
      const lines = [
        'Copyright (c) 2026 Company',
        'Copyright (c) 2026 Company',
        'Copyright (c) 2026 Company',
        'unique code line 1',
        'unique code line 2',
      ];
      const redundant = detectRedundancy(lines, { minRepeatCount: 3 });
      assert.ok(redundant.has('Copyright (c) 2026 Company'));
      assert.ok(!redundant.has('unique code line 1'));
    });
  });

  // --- 3. Native Read-Only Security Auditor ---
  describe('Capability 3: Native Read-Only Security Auditor', () => {
    it('detects high-risk shell injection and hardcoded secrets', () => {
      const insecureCode = `
        import child_process from 'node:child_process';
        const apiKey = "sk-live-123456789012345678901234";
        child_process.exec("rm -rf " + userInput);
        eval("2 + 2");
      `;

      const findings = auditContent(insecureCode, 'sample.js');
      assert.ok(findings.length >= 3);

      const rulesFound = findings.map((f) => f.ruleId);
      assert.ok(rulesFound.includes('SEC-PROC-01'));
      assert.ok(rulesFound.includes('SEC-SECRET-01'));
      assert.ok(rulesFound.includes('SEC-EVAL-01'));

      assert.equal(findings[0].filePath, 'sample.js');
      assert.ok(findings[0].lineNumber > 0);
    });

    it('scans clean directory without false positives', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'afyx-sec-clean-'));
      try {
        writeFileSync(
          join(tempDir, 'clean_module.js'),
          'export function add(a, b) { return a + b; }\nexport const PI = 3.14159;\n',
          'utf8'
        );

        const report = auditDirectory(tempDir);
        assert.equal(report.status, 'PASS');
        assert.equal(report.findings.length, 0);
        assert.equal(report.scannedFilesCount, 1);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  // --- 4. Forge Workflow Refiner & Intelligence ---
  describe('Capability 4: Forge Workflow Intelligence & Instruction Refiner', () => {
    it('strips prompt boilerplate and extracts structured acceptance criteria', () => {
      const rawPrompt = `
        Please act as a senior software engineer and lead architect.
        Make sure you think step by step and be very careful.
        # Objective
        Implement offline NPX link and audit sources.
        # Acceptance Criteria
        - Bare npx command works offline on Windows 11
        - Native security auditor identifies unsafe subprocesses
        # Constraints
        - Never copy proprietary third-party code
      `;

      const refined = refineTaskDirective(rawPrompt);
      assert.equal(refined.contract, 'afyx-forge-refiner-v1');
      assert.ok(refined.characterSavings > 50);
      assert.ok(refined.acceptanceCriteria.length >= 2);
      assert.ok(refined.constraints.length >= 1);

      // Verify criteria evaluation
      const evidence = [
        'Bare npx command works offline on Windows 11 verified',
        'Native security auditor identifies unsafe subprocesses with SEC-PROC-01',
      ];

      const completion = evaluateTaskCompletion(refined.acceptanceCriteria, evidence);
      assert.equal(completion.isComplete, true);
      assert.equal(completion.completionScore, 1.0);
    });
  });
});
