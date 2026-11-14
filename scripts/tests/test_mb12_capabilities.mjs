import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspectLocalLink } from '../afyx-local-link-ownership.mjs';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { createGitHubReader, createGhRequest, serveGitHubMcp } from '../afyx-native-github.mjs';
import { auditContent, auditDirectory } from '../afyx-security-auditor.mjs';
import { discoverSkillDescriptors, loadSkillContext, refineSkillSpecification, composeSkillSpecifications } from '../afyx-skill-engineering.mjs';
import { classifyTaskIntent, resolveAfyxCapabilityRoute, discoverAfyxCapabilities, getRegisteredComponentIds, executeAfyxCapabilityRoute } from '../afyx-capability-orchestrator.mjs';
import { createInstalledHostAdapters } from '../afyx-host-adapters.mjs';
import { GRAPH_PACKAGE_TARGETS, graphArchiveName } from '../afyx-graph-targets.mjs';
import { validateReleaseChecksums } from '../resolve-git-release-artifacts.mjs';
import { createHash } from 'node:crypto';

const root = mkdtempSync(join(tmpdir(), 'afyx-mb12-'));
const repo = resolve(import.meta.dirname, '../..');
const okResponse = (data, headers = {}) => ({ status: 200, body: JSON.stringify(data), headers });
const state = { installed: true, enabled: true, healthy: true, authorized: true, compatible: true, sourceIdentity: 'fixture-reviewed-source' };
const states = Object.fromEntries(['efficient-coding', 'afyx-engineering-expert', 'odoo-engineering', 'afyx-context', 'afyx-forge', 'afyx-native-github', 'afyx-native-execution', 'afyx-security-auditor'].map((id) => [id, state]));
const route = (task, overrides = {}) => resolveAfyxCapabilityRoute({ task, provider: 'codex', componentStates: { ...states, ...overrides }, environment: {} });

test('security findings preserve rule/line evidence while all snippets redact a secret-bearing line', () => {
  const secret = 'synthetic-secret-do-not-use-123456';
  const code = `const apiKey = "${secret}"; child_process.exec("hello"); eval("hello");`;
  const findings = auditContent(code, 'owned-fixture.js');
  assert.ok(findings.length >= 3);
  assert.ok(findings.every((f) => f.lineNumber === 1 && f.verification === 'HEURISTIC_CANDIDATE'));
  assert.ok(!JSON.stringify(findings).includes(secret));
  const dir = join(root, 'security'); mkdirSync(dir); writeFileSync(join(dir, 'secret.js'), code);
  const before = readFileSync(join(dir, 'secret.js'));
  const child = spawnSync(process.execPath, [join(repo, 'scripts/afyx-security-auditor.mjs'), dir, '--json'], { encoding: 'utf8' });
  assert.equal(child.status, 1); assert.ok(!`${child.stdout}${child.stderr}`.includes(secret));
  assert.deepEqual(readFileSync(join(dir, 'secret.js')), before);
});

test('auditor is bounded, rejects missing roots and never traverses directory junctions', () => {
  assert.equal(auditDirectory(join(root, 'missing')).status, 'INCOMPLETE');
  const dir = join(root, 'audit'), outside = join(root, 'outside'); mkdirSync(dir); mkdirSync(outside);
  writeFileSync(join(dir, 'safe.js'), 'export const safe = 1;');
  writeFileSync(join(outside, 'unsafe.js'), 'eval("outside");');
  symlinkSync(outside, join(dir, 'foreign'), process.platform === 'win32' ? 'junction' : 'dir');
  symlinkSync(dir, join(dir, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = auditDirectory(dir);
  assert.equal(result.scannedFilesCount, 1); assert.equal(result.findings.length, 0); assert.equal(result.status, 'INCOMPLETE');
  assert.equal(auditDirectory(join(dir, 'foreign')).status, 'INCOMPLETE');
  assert.ok(auditDirectory(dir, { maxFileBytes: 1 }).diagnostics.some((d) => d.code === 'FILE_LIMIT'));
});

test('GitHub scope and schema reject mutation, arbitrary URL, secrets and traversal before transport', async () => {
  let calls = 0;
  const reader = createGitHubReader({ allowedRepositories: ['owner/project'], request: async () => { calls++; return okResponse({}); } });
  for (const args of [{ operation: 'delete', owner: 'owner', repo: 'project' }, { operation: 'repository', owner: 'other', repo: 'project' },
    { operation: 'repository', owner: 'owner', repo: 'project', token: 'secret' }, { operation: 'file', owner: 'owner', repo: 'project', path: '../secret' },
    { operation: 'repository', owner: 'owner', repo: 'project', url: 'https://other.invalid' }]) assert.equal((await reader.read(args)).status, 'DENIED');
  assert.equal(calls, 0);
});

test('GitHub bounded pagination, rate limits, redirects, redaction, cancellation and deadlines are truthful', async () => {
  const secret = 'ghp_syntheticsecret1234567890123'; let requested;
  const reader = createGitHubReader({ allowedRepositories: ['owner/project'], maxItems: 1, request: async (r) => { requested = r; return okResponse([{ token: secret }, {}]); } });
  const result = await reader.read({ operation: 'issues', owner: 'owner', repo: 'project', perPage: 2 });
  assert.equal(requested.method, 'GET'); assert.equal(result.data.length, 1); assert.equal(result.receipt.pagination.truncated, true); assert.equal(result.receipt.pagination.nextPageCandidate, 2);
  assert.ok(!JSON.stringify(result).includes(secret));
  for (const [status, expected] of [[429, 'RATE_LIMIT_OR_PERMISSION'], [302, 'LOG_REDIRECT_REQUIRES_TRUSTED_HOST'], [404, 'GITHUB_HTTP_ERROR']]) {
    const mock = createGitHubReader({ allowedRepositories: ['owner/project'], request: async () => ({ status, body: secret, headers: {} }) });
    const out = await mock.read({ operation: 'repository', owner: 'owner', repo: 'project' }); assert.equal(out.code, expected); assert.ok(!JSON.stringify(out).includes(secret));
  }
  const stalled = createGitHubReader({ allowedRepositories: ['owner/project'], timeoutMs: 10, request: () => new Promise(() => {}) });
  assert.equal((await stalled.read({ operation: 'repository', owner: 'owner', repo: 'project' })).status, 'TIMEOUT');
  const signal = AbortSignal.abort(); assert.equal((await reader.read({ operation: 'repository', owner: 'owner', repo: 'project' }, { signal })).status, 'CANCELLED');
  const oversized = createGitHubReader({ allowedRepositories: ['owner/project'], maxBytes: 128, request: async () => okResponse({ x: 'x'.repeat(256) }) });
  assert.equal((await oversized.read({ operation: 'repository', owner: 'owner', repo: 'project' })).code, 'OUTPUT_LIMIT');
});

test('standalone GitHub MCP discovers one read-only tool and uses the actual reader result', async () => {
  const input = new PassThrough(), output = new PassThrough(); let text = '', calls = 0; output.on('data', (b) => { text += b; });
  const reader = createGitHubReader({ allowedRepositories: ['owner/project'], request: async () => { calls++; return okResponse({ full_name: 'owner/project' }); } });
  const server = serveGitHubMcp({ reader, input, output });
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'afyx_github_read', arguments: { operation: 'repository', owner: 'owner', repo: 'project' } } }) + '\n');
  await new Promise((r) => setImmediate(r)); await server.drained(); server.close();
  const values = text.trim().split('\n').map(JSON.parse);
  assert.equal(values[0].result.tools[0].annotations.readOnlyHint, true); assert.equal(calls, 1);
  assert.equal(JSON.parse(values[1].result.content[0].text).data.full_name, 'owner/project');
});

test('GitHub file content is redacted after base64 decoding and marked as modified evidence', async () => {
  const secret = 'ghp_syntheticprivatekey123456789';
  const reader = createGitHubReader({ allowedRepositories: ['owner/project'], request: async () => okResponse({ encoding: 'base64', content: Buffer.from(`token=${secret}`).toString('base64') }) });
  const result = await reader.read({ operation: 'file', owner: 'owner', repo: 'project', path: 'fixture.txt' });
  assert.equal(result.status, 'SUCCESS'); assert.equal(result.receipt.contentRedacted, true);
  assert.ok(!Buffer.from(result.data.content, 'base64').toString().includes(secret));
  assert.equal(result.data.afyxContentDisposition, 'REDACTED_SOURCE_NOT_BYTE_EXACT');
});

test('canonical skill metadata discovery is lazy, source-bound and read-only', () => {
  const found = discoverSkillDescriptors({ roots: [join(repo, 'skills')] });
  const expert = found.items.find((s) => s.id === 'afyx-engineering-expert'); assert.ok(expert, JSON.stringify(found.diagnostics));
  assert.equal(expert.version, '0.1.1');
  assert.throws(() => loadSkillContext(expert), /AUTHORIZATION/);
  const loaded = loadSkillContext(expert, { authorize: () => true }); assert.equal(loaded.executionPerformed, false);
  const skillRoot = join(root, 'skills'), own = join(skillRoot, 'own'); mkdirSync(own, { recursive: true });
  const file = join(own, 'SKILL.md'); writeFileSync(file, '---\nname: own\ndescription: >\n  Trusted metadata only\nmetadata:\n  version: "1.0"\n---\n# Own\n');
  const desc = discoverSkillDescriptors({ roots: [skillRoot] }).items[0]; assert.equal(desc.version, '1.0');
  writeFileSync(file, 'changed'); assert.throws(() => loadSkillContext(desc, { authorize: () => true }), /SOURCE_CHANGED/);
});

test('skill specification composition rejects competing owners and grants no execution authority', () => {
  const spec = { name: 'own', objective: 'Read project metadata', domain: 'engineering', inputs: ['path'], outputs: ['evidence'], acceptance: ['source grounded'], permissions: ['read'] };
  assert.equal(refineSkillSpecification(spec).status, 'VALID');
  assert.equal(composeSkillSpecifications([spec]).executionPerformed, false);
  assert.equal(composeSkillSpecifications([spec, { ...spec, name: 'other' }]).status, 'CONFLICT');
});

test('domain routing selects only relevant capabilities, manual selection cannot enable OFF, custom discovery is task-local', () => {
  for (const [taskType, expected] of [['documentation-search', 'afyx-context'], ['usage-analytics', 'afyx-context'], ['github-operation', 'afyx-native-github'], ['cli-automation', 'afyx-native-execution'], ['security-audit', 'afyx-security-auditor']]) {
    const result = route({ taskType }); assert.deepEqual(result.requests.map((r) => r.targetComponentId), [expected]);
  }
  assert.equal(classifyTaskIntent({ taskType: 'string-replacement', exactKnownSource: true }).directSource, true);
  const off = route({ taskType: 'github-operation', manualSelection: ['afyx-native-github'] }, { 'afyx-native-github': { ...state, enabled: false } });
  assert.equal(off.requests.length, 0); assert.equal(off.degradations[0].reason, 'EXPLICITLY_DISABLED');
  const before = getRegisteredComponentIds(); discoverAfyxCapabilities({ provider: 'codex', customComponents: [{ id: 'task-local-only' }] });
  assert.deepEqual(getRegisteredComponentIds(), before);
});

test('installed host adapters lazily execute Context docs, bounded usage and native execution from trusted configuration', async () => {
  const install = join(root, 'install'), project = join(root, 'project'); mkdirSync(project); writeFileSync(join(project, 'README.md'), '# Native documentation\nDocument source contracts');
  cpSync(join(repo, 'afyx-context'), join(install, 'context/current'), { recursive: true, filter: (p) => !p.includes('node_modules') });
  const adapters = createInstalledHostAdapters({ installRoot: install, projectRoot: project, trustedCapabilities: { usage: { events: [{ provider: 'codex', sessionId: 's1', eventId: 'e1', source: 'test-actual-event', timestamp: 100, mode: 'delta', inputTokens: 10, outputTokens: 5 }] } } });
  const docs = await adapters['afyx-context']({ taskType: 'documentation-search', payload: { query: 'documentation' } });
  assert.equal(docs.status, 'SUCCESS'); assert.ok(docs.evidence.length); assert.ok(docs.output.renderedContext.includes('Native documentation'));
  const usage = await adapters['afyx-context']({ taskType: 'usage-analytics', payload: {} }); assert.equal(usage.output.totals.totalTokens, 15);
  const execution = await executeAfyxCapabilityRoute({ task: { taskType: 'cli-automation', payload: { capabilityId: 'node-version' } }, provider: 'codex', componentStates: states, adapters, environment: {} });
  assert.ok(JSON.stringify(execution).includes(process.version));
});

test('new Graph manifest requires both Darwin archives, preserves schema-1 compatibility and rejects incomplete candidates', () => {
  const revision = 'a'.repeat(40), digest = createHash('sha256').update('archive').digest('hex');
  const manifest = { schema: 2, source_revision: revision, artifacts: GRAPH_PACKAGE_TARGETS.map((target) => ({ file: graphArchiveName(target), target, sha256: digest })) };
  const sums = manifest.artifacts.map((a) => `${a.sha256}  ${a.file}`).join('\n');
  assert.equal(validateReleaseChecksums(manifest, sums, revision).size, 4);
  assert.throws(() => validateReleaseChecksums({ ...manifest, artifacts: manifest.artifacts.slice(0, 2) }, sums, revision), /Incomplete/);
  const legacy = { schema: 1, source_revision: revision, artifacts: manifest.artifacts.slice(0, 2) };
  assert.equal(validateReleaseChecksums(legacy, legacy.artifacts.map((a) => `${a.sha256}  ${a.file}`).join('\n'), revision).size, 2);
});

test('local npm link ownership protects foreign packages and accepts only the exact repository link', () => {
  const modules = join(root, 'global-modules'); mkdirSync(modules);
  assert.equal(inspectLocalLink(repo, modules).status, 'NOT_INSTALLED');
  mkdirSync(join(modules, 'afyx-engineering-kit'));
  assert.equal(inspectLocalLink(repo, modules).status, 'FOREIGN_INSTALLATION');
  const owned = join(root, 'owned-global'); mkdirSync(owned);
  symlinkSync(repo, join(owned, 'afyx-engineering-kit'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(inspectLocalLink(repo, owned).status, 'OWNED_LINK');
});
