import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStructuredDocument } from '../../afyx-context/src/index.js';
import { reviewTechnicalProse } from '../../afyx-forge/src/index.js';
import {
  createSkillContextSession, discoverSkillDescriptors, distillSkillFromDocument,
  loadSkillContext, loadSkillReference, validateSkill,
} from '../afyx-skill-engineering.mjs';
import {
  createArtifactManifest, verifyArtifactLineage, verifyArtifactManifest,
} from '../afyx-provenance.mjs';
import { classifyTaskIntent, resolveAfyxCapabilityRoute } from '../afyx-capability-orchestrator.mjs';
import { runInstalledAfyxWorkflow } from '../afyx-universal-runtime.mjs';
import { createNativeSkillHostAdapter } from '../afyx-native-skill-host.mjs';
import { AfyxBrowserSession } from '../afyx-browser-devtools.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const authorize = () => true;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'afyx-b12-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('catalog only reads metadata; activation and reference retrieval require host approval', (t) => {
  const root = fixture(t);
  const directory = join(root, 'fixture-skill');
  mkdirSync(join(directory, 'references'), { recursive: true });
  const frontmatter = '---\nname: fixture-skill\ndescription: Fixture skill\n---\n';
  const manifest = frontmatter + 'Related skill instructions. '.repeat(64);
  writeFileSync(join(directory, 'SKILL.md'), manifest);
  writeFileSync(join(directory, 'references', 'source.txt'), 'Fixture reference');
  const unrelated = join(root, 'unrelated-skill');
  mkdirSync(unrelated);
  writeFileSync(join(unrelated, 'SKILL.md'), manifest.replace('fixture-skill', 'unrelated-skill'));
  for (const provider of ['codex', 'antigravity', 'claude']) {
    const result = discoverSkillDescriptors({ roots: [root], provider });
    const skill = result.items.find((item) => item.name === 'fixture-skill');
    assert.equal(result.referenceBytesLoaded, 0);
    assert.equal(result.instructionBytesLoaded, 0);
    assert.equal(skill.metadataBytes, Buffer.byteLength(frontmatter));
    assert.ok(result.items.reduce((sum, item) => sum + item.metadataBytes, 0) < Buffer.byteLength(manifest));
    const session = createSkillContextSession();
    assert.throws(() => loadSkillReference(skill, 'references/source.txt', { authorize, session }), /AUTHORIZATION/);
    assert.equal(loadSkillContext(skill, { authorize, session }).content, manifest);
    assert.equal(loadSkillContext(skill, { authorize, session }).bytesLoaded, 0);
    assert.equal(loadSkillReference(skill, 'references/source.txt', { authorize, session }).content, 'Fixture reference');
    assert.throws(() => loadSkillReference(skill, 'references/../SKILL.md', { authorize, session }), /UNSAFE/);
  }
  assert.equal(discoverSkillDescriptors({ roots: [root], disabled: ['fixture-skill'] }).items.length, 1);
  const stale = discoverSkillDescriptors({ roots: [root] }).items[0];
  rmSync(join(directory, 'SKILL.md'));
  assert.throws(() => loadSkillContext(stale, { authorize }), /SOURCE_CHANGED/);
});

test('bounded local ingestion and deterministic skill draft carry verifiable source lineage', (t) => {
  const root = fixture(t);
  const documents = new Map([
    ['source.md', '# Runbook\n\nVerify assertions first.\n'],
    ['source.txt', 'Plain text'],
    ['source.json', '{"counter":9223372036854775807}'],
    ['source.csv', 'Name,Note\r\n"Alpha, Beta","A ""quoted"" value"\r\n'],
    ['source.tsv', 'Name\tNote\nAlpha\tWorks'],
    ['bad.csv', 'Header\n"invalid'],
    ['source.pdf', '%PDF-'],
    ['source.zip', 'Archive'],
  ]);
  for (const [name, data] of documents) writeFileSync(join(root, name), data);
  for (const name of ['source.md', 'source.txt', 'source.json', 'source.csv', 'source.tsv']) {
    const result = readStructuredDocument(root, name, { enabled: true });
    assert.equal(result.status, 'SUCCESS', name);
    assert.equal(verifyArtifactLineage(result.provenance, documents.get(name), result.markdown).integrity, 'VERIFIED');
    assert.equal(verifyArtifactLineage(result.provenance, documents.get(name), result.markdown + ' changed').integrity, 'MISMATCH');
  }
  assert.equal(readStructuredDocument(root, 'source.md').status, 'ACCESS_DENIED');
  assert.equal(readStructuredDocument(root, '../outside.md', { enabled: true }).status, 'ACCESS_DENIED');
  assert.equal(readStructuredDocument(root, 'source.md', { enabled: true, maxInputBytes: 3 }).status, 'RESOURCE_LIMIT_EXCEEDED');
  assert.equal(readStructuredDocument(root, 'bad.csv', { enabled: true }).status, 'INVALID_DOCUMENT');
  assert.equal(readStructuredDocument(root, 'source.pdf', { enabled: true }).status, 'NOT_AVAILABLE');
  assert.equal(readStructuredDocument(root, 'source.zip', { enabled: true }).status, 'UNSUPPORTED_FORMAT');
  const spec = { sourceRoot: root, source: 'source.md', name: 'fixture-draft', description: 'Use a local runbook' };
  for (const name of ['draft-a', 'draft-b']) mkdirSync(join(root, name));
  const draftsRoot = join(root, 'draft-a');
  assert.throws(() => distillSkillFromDocument({ ...spec, draftsRoot }), /NOT_AUTHORIZED/);
  assert.throws(() => distillSkillFromDocument({ ...spec, draftsRoot, name: '../escape' }, { authorize }), /METADATA/);
  const first = distillSkillFromDocument({ ...spec, draftsRoot }, { authorize });
  const second = distillSkillFromDocument({ ...spec, draftsRoot: join(root, 'draft-b') }, { authorize });
  assert.equal(first.digest, second.digest);
  assert.equal(first.status, 'VALIDATED_DRAFT');
  assert.equal(first.activationPerformed, false);
  assert.equal(validateSkill(join(draftsRoot, spec.name)).digest, first.digest);
  assert.throws(() => distillSkillFromDocument({ ...spec, draftsRoot }, { authorize }), /EXISTS/);
});

test('manifest verifier preserves legacy manifests and refuses traversal', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'fixture.txt'), 'Initial');
  const manifest = createArtifactManifest(root);
  assert.equal(verifyArtifactManifest(manifest, root).verified, true);
  const outside = { ...manifest, files: [{ ...manifest.files[0], path: '../outside.txt' }] };
  assert.equal(verifyArtifactManifest(outside, root).reason, 'INVALID_MANIFEST_ENTRIES');
  writeFileSync(join(root, 'fixture.txt'), 'Modified');
  assert.equal(verifyArtifactManifest(manifest, root).verified, false);
});

test('technically protected prose is preserved; suggestions do not edit terminology', () => {
  const protectedText = ['## Changelog', '### Maintenance', 'It is important to note that this historical wording stays.', 'The tool must run v1.2.1.', 'Copyright (c) 2026 Afyx', '', '~~~sh', 'In order to run', '~~~', ''].join('\r\n');
  const frontmatter = '---\r\ndescription: at this point in time\r\n---\r\n';
  const input = frontmatter + 'It is important to note that the user can wait in order to proceed.\r\n' + protectedText;
  assert.equal(reviewTechnicalProse(input).content, input);
  const reviewed = reviewTechnicalProse(input, { enabled: true, terminology: { user: 'operator' } });
  assert.equal(reviewed.content, frontmatter + 'The user can wait to proceed.\r\n' + protectedText);
  assert.equal(reviewed.suggestions[0].reason, 'REVIEW_TERMINOLOGY');
  assert.equal(reviewTechnicalProse(reviewed.content, { enabled: true }).edits, 0);
});

test('UI routing requires matching intent and cannot enable an explicitly disabled skill', () => {
  const id = 'afyx-ui-architect';
  const task = { filePath: 'screen.tsx', intent: 'Review responsive layout and accessibility' };
  assert.equal(classifyTaskIntent(task).ui, true);
  assert.equal(classifyTaskIntent({ ...task, intent: 'Rename an API parameter' }).ui, false);
  assert.equal(classifyTaskIntent({ ...task, domain: 'odoo' }).ui, false);
  const skill = readFileSync(resolve(repo, 'skills', id, 'SKILL.md'), 'utf8');
  assert.match(skill, /typography.*spacing.*color/);
  assert.match(skill, /keyboard.*focus.*contrast/);
  assert.match(skill, /breakpoints/);
  const states = { installed: true, healthy: true, compatible: true, authorized: true, sourceIdentity: 'fixture' };
  const enabled = resolveAfyxCapabilityRoute({ task, componentStates: { [id]: states } });
  const disabled = resolveAfyxCapabilityRoute({ task, componentStates: { [id]: { ...states, enabled: false } } });
  assert.ok(JSON.stringify(enabled).includes(id));
  assert.equal(disabled.discovery.capabilities[id].available, false);
});

test('installed runtime loads only the authorized UI skill across provider contracts', async (t) => {
  const root = fixture(t);
  const id = 'afyx-ui-architect';
  const destination = join(root, 'skills', id);
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'SKILL.md'), readFileSync(join(repo, 'skills', id, 'SKILL.md')));
  let approved = 0;
  const trustedCapabilities = { ui: { authorize: () => { approved++; return true; } } };
  const options = { installRoot: root, projectRoot: root, trustedCapabilities, authorizations: { [id]: true } };
  for (const provider of ['codex', 'antigravity', 'claude']) {
    const result = await runInstalledAfyxWorkflow({ ...options, provider, task: { taskType: 'ui-review' } });
    const ui = result.results.find((item) => item.componentId === id);
    assert.equal(ui?.status, 'EXECUTED', JSON.stringify(ui));
    assert.match(ui.output.content, /Afyx UI Architect/);
  }
  await runInstalledAfyxWorkflow({ ...options, provider: 'codex', task: { taskType: 'implementation', intent: 'API schema' } });
  await runInstalledAfyxWorkflow({ ...options, provider: 'codex', task: { taskType: 'ui-review' }, componentSettings: { [id]: { enabled: false } } });
  assert.equal(approved, 3);
});

test('native skill host distillation stops at validated draft after exact approval', async (t) => {
  const root = fixture(t);
  const draftsRoot = join(root, 'drafts');
  const skillsRoot = join(root, 'installed');
  mkdirSync(draftsRoot);
  mkdirSync(skillsRoot);
  writeFileSync(join(root, 'knowledge.txt'), 'Verify fixtures before running.');
  const approvals = [];
  const name = 'fixture-distillation';
  const host = createNativeSkillHostAdapter({
    provider: 'codex', draftsRoot, skillsRoot, spec: { name, description: 'Use isolated knowledge', triggers: [] },
    distillation: { sourceRoot: root, source: 'knowledge.txt' },
    authorize: (proposal) => { approvals.push(proposal.action); return true; },
  });
  const response = await host.adapter({
    targetComponentId: 'afyx-skill-engineering', capability: 'skill-authoring-lifecycle',
    permissions: { authorized: true }, candidateProviders: ['codex'], sourceIdentity: host.sourceIdentity,
  });
  assert.equal(response.output?.status, 'VALIDATED_DRAFT', JSON.stringify(response));
  assert.deepEqual(approvals, ['DISTILL_SKILL_DRAFT']);
  assert.equal(existsSync(join(skillsRoot, name)), false);
});

test('browser diagnostics default off and reject unowned profiles and endpoints', async () => {
  const browser = new AfyxBrowserSession();
  assert.equal((await browser.readDiagnostics()).status, 'DENIED');
  if (browser.chromePath) {
    assert.equal((await browser.readDiagnostics({ relevant: true, optIn: true, authorize })).status, 'DENIED');
  } else {
    assert.equal((await browser.readDiagnostics({ relevant: true, optIn: true, authorize })).status, 'NOT_AVAILABLE');
  }
  assert.throws(() => new AfyxBrowserSession({ wsUrl: 'ws://127.0.0.1:9222' }), /EXTERNAL_ATTACH_DENIED/);
  assert.throws(() => new AfyxBrowserSession({ userDataDir: 'daily-profile' }), /EXTERNAL_ATTACH_DENIED/);
});
