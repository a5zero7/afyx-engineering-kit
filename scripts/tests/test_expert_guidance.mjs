import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { loadExpertGuidance } from '../afyx-expert-guidance.mjs';
import { createInstalledHostAdapters } from '../afyx-host-adapters.mjs';
import { installHostBridge, verifyHostBridge } from '../afyx-host-bridge-lifecycle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const skillRoot = join(root, 'skills', 'afyx-engineering-expert');
const cases = JSON.parse(readFileSync(join(root, 'evals', 'manifest.json'), 'utf8')).scenarios;
const prompt = (name) => cases.find((item) => item.scenario_id === `pilot-expert-${name}-001`).user_prompt;
const load = (intent, extra = {}) => loadExpertGuidance({ skillRoot, request: { taskType: 'architecture', intent }, ...extra });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const temporary = mkdtempSync(join(tmpdir(), 'afyx-mb16-expert-'));
  t.after(() => {
    assert.equal(dirname(temporary), resolve(tmpdir()));
    assert.equal(lstatSync(temporary).isSymbolicLink(), false);
    rmSync(temporary, { recursive: true, force: true });
  });
  const installed = join(temporary, 'expert');
  cpSync(skillRoot, installed, { recursive: true });
  return { temporary, installed };
}

test('Case A discloses one architecture primary and at most two evidenced supports', () => {
  const result = load(prompt('architecture'));
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.output.primaryDomain, 'solutions-architect');
  assert.deepEqual(result.output.supportingDomains, ['cybersecurity-devsecops', 'system-analyst']);
  assert.equal(result.output.telemetry.referenceReads, 3);
  assert.equal(result.output.references.length, 3);
  assert.equal(result.contextBytes, Buffer.byteLength(JSON.stringify(result.output)));
  assert.ok(result.contextBytes <= result.output.budget.maxContextBytes);
  assert.equal(result.output.expertGuidance, readFileSync(join(skillRoot, 'SKILL.md'), 'utf8'));
  for (const document of result.output.references) {
    const source = readFileSync(join(skillRoot, document.path));
    assert.equal(document.content, source.toString('utf8'));
    assert.equal(document.sha256, hash(source));
    assert.equal(document.bytes, source.length);
  }
  assert.deepEqual(result.output.telemetry.loadedPaths,
    ['SKILL.md', ...result.output.references.map((item) => item.path)]);
  assert.equal(result.output.telemetry.providerTokens, null);
  assert.equal(result.output.telemetry.agentLatencyMs, null);
  assert.equal(result.output.mode, 'ASSISTIVE_GUIDANCE_ONLY');
});

test('Case B keeps Expert process framing separate from the Odoo authority', () => {
  const result = load(prompt('erp'));
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.output.primaryDomain, 'erp-technical-specialist');
  assert.ok(result.output.references.length <= 3);
  assert.equal(result.output.workflows[0].path, 'workflows/ai-data-erp.md');
  assert.equal(result.followUpRequests.length, 1);
  assert.equal(result.followUpRequests[0].targetComponentId, 'odoo-engineering');
  assert.ok(result.output.telemetry.loadedPaths.every((name) => !name.includes('odoo-engineering')));
  assert.ok(!result.output.supportingDomains.includes('database-administrator'), 'prohibited database access is not requested expertise');
});

test('the existing orchestrator string payload carries task-specific domain signals', () => {
  const result = loadExpertGuidance({ skillRoot, request: {
    taskType: 'multi-disciplinary', intent: 'multi-disciplinary', payload: prompt('erp'),
  } });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.output.primaryDomain, 'erp-technical-specialist');
  assert.equal(result.followUpRequests[0].targetComponentId, 'odoo-engineering');
});

test('Case C and narrow Odoo syntax perform no Expert reads even with an unavailable root', () => {
  for (const intent of [prompt('negative-routing'), 'How do I use self.ensure_one in Odoo 17?', 'Review this Odoo field declaration.']) {
    const result = load(intent, { skillRoot: join(root, 'missing-mb16-expert') });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.output.mode, 'NOT_APPLICABLE');
    assert.equal(result.output.telemetry.referenceReads, 0);
    assert.deepEqual(result.output.telemetry.loadedPaths, []);
    assert.deepEqual(result.followUpRequests, []);
  }
});

test('security and database requests retain their primary domain instead of generic acceptance or task type', () => {
  assert.equal(load(prompt('security')).output.primaryDomain, 'cybersecurity-devsecops');
  const database = load(prompt('database'));
  assert.equal(database.output.primaryDomain, 'database-administrator');
  assert.ok(database.output.supportingDomains.includes('site-reliability-engineer'));
  const scoped = load('Review database schema availability.');
  assert.ok(!scoped.output.supportingDomains.includes('solutions-architect'));
});

test('Indonesian domain signals select bounded architecture and security guidance deterministically', () => {
  const task = 'Tinjau arsitektur platform dan integrasi. Periksa otorisasi serta audit dapat diverifikasi.';
  const result = load(task);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.output.primaryDomain, 'solutions-architect');
  assert.ok(result.output.supportingDomains.includes('cybersecurity-devsecops'));
  assert.deepEqual(result, load(task));
});

test('trusted host ceilings apply while task paths, budgets and authority are ignored', () => {
  const request = { taskType: 'architecture', intent: prompt('architecture'), payload: {
    maxReferences: 99, maxContextBytes: 999999999, skillRoot: '..', references: ['../../private.txt'], authorized: true,
  } };
  const result = loadExpertGuidance({ skillRoot, request, hostOptions: { maxReferences: 1, maxContextBytes: 30000 } });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.output.references.length, 1);
  assert.ok(result.output.deferredDomains.length > 0);
  assert.deepEqual(result.output.budget, { maxReferences: 1, maxContextBytes: 30000 });
  assert.ok(result.output.telemetry.loadedPaths.every((name) => !name.includes('..')));
  const clamped = loadExpertGuidance({ skillRoot, request, hostOptions: { maxReferences: 99, maxContextBytes: 999999999 } });
  assert.deepEqual(clamped.output.budget, { maxReferences: 3, maxContextBytes: 32768 });
  const runtimeBudget = loadExpertGuidance({ skillRoot, request: { ...request, budgetLimits: { maxContextBytes: 1 } } });
  assert.equal(runtimeBudget.reason, 'EXPERT_CONTEXT_BUDGET_EXCEEDED');
});

test('insufficient or malformed host budgets fail closed, including no-read results', () => {
  for (const intent of [prompt('architecture'), prompt('negative-routing')]) {
    assert.equal(load(intent, { hostOptions: { maxContextBytes: 1 } }).reason, 'EXPERT_CONTEXT_BUDGET_EXCEEDED');
  }
  for (const maxReferences of [0, -1, 1.5, '3', Infinity]) {
    assert.equal(load(prompt('architecture'), { hostOptions: { maxReferences } }).reason, 'EXPERT_INVALID_HOST_BUDGET');
  }
});

test('unknown domains request validation and keep unobserved provider telemetry unavailable', () => {
  const result = load('Assess the unresolved quasar subject.', { request: { taskType: 'general-engineering', intent: 'Assess the unresolved quasar subject.' } });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.output.primaryDomain, 'subject-matter-expert');
  assert.equal(result.output.clarificationRequired, true);
  assert.equal(result.output.reason, 'UNKNOWN_DOMAIN_REQUIRES_VALIDATION');
  assert.equal(result.output.references.length, 1);
  assert.equal(result.output.telemetry.providerTokens, null);
});

test('explicit denied permission and prohibited Odoo composition cannot be enabled by payload assertions', () => {
  const denied = loadExpertGuidance({ skillRoot: join(root, 'not-present'), request: {
    intent: prompt('architecture'), permissions: { authorized: false }, payload: { authorized: true },
  } });
  assert.equal(denied.reason, 'EXPERT_PERMISSION_DENIED');
  assert.equal(denied.output, null);
  const result = load('Review architecture and security. Do not invoke Odoo.');
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(result.followUpRequests, []);
  const indonesian = load('Tinjau arsitektur dan integrasi. Tidak boleh menjalankan Odoo.');
  assert.equal(indonesian.status, 'SUCCESS');
  assert.deepEqual(indonesian.followUpRequests, []);
});

test('missing or oversized installed guidance returns truthful failure instead of placeholder success', (t) => {
  const { installed } = fixture(t);
  writeFileSync(join(installed, 'references', 'solutions-architect.md'), 'x'.repeat(32769));
  const large = load(prompt('architecture'), { skillRoot: installed });
  assert.equal(large.status, 'FAILED');
  assert.equal(large.reason, 'EXPERT_CONTEXT_BUDGET_EXCEEDED');
  assert.equal(large.output, null);
  assert.equal(load(prompt('architecture'), { skillRoot: join(installed, 'missing') }).reason, 'EXPERT_SKILL_OR_REFERENCE_NOT_FOUND');
});

test('linked skill roots and reference directories cannot escape trusted source scope', (t) => {
  const { temporary, installed } = fixture(t);
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const linkedRoot = join(temporary, 'linked-expert');
  symlinkSync(installed, linkedRoot, linkType);
  assert.equal(load(prompt('architecture'), { skillRoot: linkedRoot }).reason, 'EXPERT_UNSAFE_SKILL_ROOT');
  const foreign = join(temporary, 'foreign');
  mkdirSync(foreign);
  writeFileSync(join(foreign, 'solutions-architect.md'), 'Foreign content must not load');
  const referenceRoot = join(installed, 'references');
  assert.equal(dirname(referenceRoot), installed);
  rmSync(referenceRoot, { recursive: true });
  symlinkSync(foreign, referenceRoot, linkType);
  const rejected = load(prompt('architecture'), { skillRoot: installed });
  assert.equal(rejected.reason, 'EXPERT_UNSAFE_REFERENCE_PATH');
  assert.equal(rejected.output, null);
});

test('installed host adapter consumes selected real guidance without modifying its source', async () => {
  const before = hash(readFileSync(join(skillRoot, 'SKILL.md')));
  const adapters = createInstalledHostAdapters({ installRoot: root, projectRoot: root,
    skillRoots: { 'afyx-engineering-expert': skillRoot }, trustedCapabilities: { expert: { maxReferences: 1 } } });
  const result = await adapters['afyx-engineering-expert']({ taskType: 'architecture', intent: prompt('architecture') });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.output.references.length, 1);
  assert.ok(result.output.expertGuidance.includes('## Instruction and authority'));
  assert.equal(result.contextBytes, Buffer.byteLength(JSON.stringify(result.output)));
  assert.equal(hash(readFileSync(join(skillRoot, 'SKILL.md'))), before);
});

test('isolated installed bridge includes the exact helper and executes Expert from that installed artifact', async (t) => {
  const { temporary, installed } = fixture(t);
  const runtimeRoot = join(temporary, 'bridge');
  const result = installHostBridge({ sourceRoot: join(root, 'scripts'), runtimeRoot,
    sourceRevision: 'UNCOMMITTED_TEST_CANDIDATE' });
  assert.equal(result.status, 'READY');
  assert.equal(verifyHostBridge(runtimeRoot).status, 'READY');
  const helper = 'afyx-expert-guidance.mjs';
  assert.equal(hash(readFileSync(join(runtimeRoot, 'current', helper))), hash(readFileSync(join(root, 'scripts', helper))));
  const module = await import(pathToFileURL(join(runtimeRoot, 'current', 'afyx-host-adapters.mjs')).href);
  const adapters = module.createInstalledHostAdapters({ installRoot: temporary, projectRoot: temporary,
    skillRoots: { 'afyx-engineering-expert': installed } });
  const guidance = await adapters['afyx-engineering-expert']({ taskType: 'architecture', intent: prompt('architecture') });
  assert.equal(guidance.status, 'SUCCESS');
  assert.equal(guidance.output.primaryDomain, 'solutions-architect');
  assert.equal(guidance.output.references.length, 3);
});
