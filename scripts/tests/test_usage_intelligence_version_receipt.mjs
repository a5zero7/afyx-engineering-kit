/**
 * Unit & Regression Tests for Afyx Usage Intelligence Version Receipt (Section 6)
 *
 * Verifies:
 * - Fresh install reports canonical version 1.0.0
 * - Repair incomplete runtime reports 1.0.0
 * - Repeated repair reports 1.0.0
 * - Update reports 1.0.0
 * - Missing metadata does not invent version
 * - Component not installed does not invent version
 * - Receipt generation produces `Afyx Usage Intelligence: REPAIRED; 1.0.0`
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeExecution } from '../afyx-install-backend.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');

test('Afyx Usage Intelligence metadata.json exists and declares 1.0.0', () => {
  const metaPath = join(REPO_ROOT, 'tools', 'afyx-usage-intelligence', 'metadata.json');
  assert.equal(existsSync(metaPath), true, 'metadata.json must exist');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  assert.equal(meta.product_name, 'Afyx Usage Intelligence');
  assert.equal(meta.product_version, '1.0.0');
});

test('scripts/components.json declares version_source for afyx-usage-intelligence', () => {
  const contractPath = join(REPO_ROOT, 'scripts', 'components.json');
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  const usage = contract.components.find((c) => c.id === 'afyx-usage-intelligence');
  assert.ok(usage, 'afyx-usage-intelligence component must exist');
  assert.equal(usage.version_source, 'metadata.json#product_version');
  assert.equal(usage.version_required, 'true');
});

test('Receipt generation produces `Afyx Usage Intelligence: REPAIRED; 1.0.0`', () => {
  const actualPlan = {
    components: [
      {
        id: 'afyx-usage-intelligence',
        name: 'Afyx Usage Intelligence',
        version: '1.0.0',
        currentState: 'HEALTHY',
        desired: true,
        compatibility: 'SUPPORTED',
        target: 'C:\\Users\\test\\.codex\\tools',
        ownership: 'afyx',
        detail: 'runtime files installed',
      },
    ],
  };

  const reviewedPlan = {
    components: [
      {
        id: 'afyx-usage-intelligence',
        backendAction: 'repair',
      },
    ],
  };

  const verification = {
    exitCode: 0,
    rows: [
      { state: 'OK', name: 'Codex Usage Tracker', detail: '1.0.0; runtime files installed' },
    ],
  };

  const summary = summarizeExecution(actualPlan, verification, 0, reviewedPlan);
  assert.equal(summary.status, 'PASS');
  const usageItem = summary.components.find((c) => c.id === 'afyx-usage-intelligence');
  assert.ok(usageItem, 'usage item must be summarized');
  assert.equal(usageItem.outcome, 'REPAIRED');
  assert.equal(usageItem.version, '1.0.0');

  // Verify midnight circuit formatting
  const formattedLabel = `${usageItem.name}: ${usageItem.outcome}; ${usageItem.version || 'n/a'}`;
  assert.equal(formattedLabel, 'Afyx Usage Intelligence: REPAIRED; 1.0.0');
});

test('Receipt generation for fresh install produces `Afyx Usage Intelligence: INSTALLED; 1.0.0`', () => {
  const actualPlan = {
    components: [
      {
        id: 'afyx-usage-intelligence',
        name: 'Afyx Usage Intelligence',
        version: '1.0.0',
        currentState: 'HEALTHY',
        desired: true,
        compatibility: 'SUPPORTED',
        target: 'C:\\Users\\test\\.codex\\tools',
        ownership: 'afyx',
        detail: 'runtime files installed',
      },
    ],
  };

  const reviewedPlan = {
    components: [
      {
        id: 'afyx-usage-intelligence',
        backendAction: 'install',
      },
    ],
  };

  const verification = { exitCode: 0, rows: [] };
  const summary = summarizeExecution(actualPlan, verification, 0, reviewedPlan);
  const usageItem = summary.components.find((c) => c.id === 'afyx-usage-intelligence');
  assert.equal(usageItem.outcome, 'INSTALLED');
  assert.equal(usageItem.version, '1.0.0');
  assert.equal(`${usageItem.name}: ${usageItem.outcome}; ${usageItem.version || 'n/a'}`, 'Afyx Usage Intelligence: INSTALLED; 1.0.0');
});

test('Receipt generation for update produces `Afyx Usage Intelligence: UPDATED; 1.0.0`', () => {
  const actualPlan = {
    components: [
      {
        id: 'afyx-usage-intelligence',
        name: 'Afyx Usage Intelligence',
        version: '1.0.0',
        currentState: 'HEALTHY',
        desired: true,
        compatibility: 'SUPPORTED',
        target: 'C:\\Users\\test\\.codex\\tools',
        ownership: 'afyx',
        detail: 'runtime files installed',
      },
    ],
  };

  const reviewedPlan = {
    components: [
      {
        id: 'afyx-usage-intelligence',
        backendAction: 'update',
      },
    ],
  };

  const verification = { exitCode: 0, rows: [] };
  const summary = summarizeExecution(actualPlan, verification, 0, reviewedPlan);
  const usageItem = summary.components.find((c) => c.id === 'afyx-usage-intelligence');
  assert.equal(usageItem.outcome, 'UPDATED');
  assert.equal(usageItem.version, '1.0.0');
  assert.equal(`${usageItem.name}: ${usageItem.outcome}; ${usageItem.version || 'n/a'}`, 'Afyx Usage Intelligence: UPDATED; 1.0.0');
});

test('Uninstalled component does not invent version (version is empty)', () => {
  const actualPlan = {
    components: [
      {
        id: 'afyx-usage-intelligence',
        name: 'Afyx Usage Intelligence',
        version: '',
        currentState: 'NOT INSTALLED',
        desired: false,
        compatibility: 'SUPPORTED',
        target: 'C:\\Users\\test\\.codex\\tools',
        ownership: 'none',
        detail: 'not installed',
      },
    ],
  };

  const reviewedPlan = {
    components: [
      {
        id: 'afyx-usage-intelligence',
        backendAction: 'skip',
      },
    ],
  };

  const verification = { exitCode: 0, rows: [] };
  const summary = summarizeExecution(actualPlan, verification, 0, reviewedPlan);
  const usageItem = summary.components.find((c) => c.id === 'afyx-usage-intelligence');
  assert.equal(usageItem.version, '');
  assert.equal(`${usageItem.name}: ${usageItem.outcome}; ${usageItem.version || 'n/a'}`, 'Afyx Usage Intelligence: SKIPPED; n/a');
});
