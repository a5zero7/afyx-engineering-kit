import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { invokeHostWorkflow } from '../afyx-host-bridge.mjs';
import { createInstalledAfyxRuntime } from '../afyx-universal-runtime.mjs';
import { verifySkillInstall } from '../afyx-skill-engineering.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'afyx-native-skill-host-'));
  const draftsRoot = join(root, 'drafts');
  const skillsRoot = join(root, 'provider-skills');
  const installRoot = join(root, 'kit');
  const projectRoot = join(root, 'project');
  for (const path of [draftsRoot, skillsRoot, installRoot, projectRoot]) mkdirSync(path);
  const spec = {
    name: 'afyx-test-reviewer',
    description: 'A bounded review fixture skill for review fixture tasks.',
    triggers: ['review fixture'],
    body: '# Procedure\n\nInspect a local example.\n',
  };
  const hostPlan = (authorize = () => true) => ({
    provider: 'codex', scope: 'workspace', draftsRoot, skillsRoot, spec, authorize,
  });
  const options = {
    provider: 'codex', projectRoot, installRoot,
    authorizations: { 'afyx-skill-engineering': true },
    task: { id: 'skill-host-fixture', taskType: 'skill-authoring',
      needsCustomCapability: 'skill-authoring-lifecycle' },
  };
  try {
    return run({ root, draftsRoot, skillsRoot, installRoot, projectRoot, spec, hostPlan, options });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('trusted host can create, package, install and verify a scoped native skill', async () => {
  await fixture(async (fx) => {
    const approvals = [];
    const trustedSkillEngineering = fx.hostPlan((proposal) => {
      approvals.push(proposal.action);
      return true;
    });
    const result = await invokeHostWorkflow({ ...fx.options, trustedSkillEngineering });
    const skill = result.results.find((item) => item.componentId === 'afyx-skill-engineering');
    assert.equal(skill?.executionStatus, 'EXECUTED', JSON.stringify(result.degradations));
    assert.equal(skill?.output?.status, 'VERIFIED');
    assert.equal(skill?.output?.provider, 'codex');
    assert.deepEqual(approvals, ['CREATE_DRAFT', 'INSTALL']);
    const installed = verifySkillInstall({
      provider: 'codex', skillsRoot: fx.skillsRoot, name: fx.spec.name,
    });
    assert.equal(installed.status, 'VERIFIED');
    assert.equal(installed.digest, skill.output.digest);
    assert.match(skill.provenance.componentSourceIdentity, /^sha256:[0-9a-f]{64}$/);
  });
});

test('task JSON cannot supply host approval, skill write plan or provider roots', async () => {
  await fixture(async (fx) => {
    const result = await invokeHostWorkflow({
      ...fx.options,
      task: { ...fx.options.task, authorize: true,
        authorizations: { 'afyx-skill-engineering': true },
        trustedSkillEngineering: fx.hostPlan(),
        skillsRoot: fx.skillsRoot,
      },
    });
    assert.equal(result.results.some((item) => item.componentId === 'afyx-skill-engineering'), false);
    assert.equal(existsSync(join(fx.skillsRoot, fx.spec.name)), false);
    assert.equal(existsSync(join(fx.draftsRoot, fx.spec.name)), false);
  });
});

test('missing host authorization and explicit OFF prevent native writes', async () => {
  await fixture(async (fx) => {
    let approvals = 0;
    const plan = fx.hostPlan(() => { approvals++; return true; });
    const denied = await invokeHostWorkflow({
      ...fx.options, authorizations: {}, trustedSkillEngineering: plan,
    });
    assert.equal(denied.results.some((item) => item.componentId === 'afyx-skill-engineering'), false);
    const off = await invokeHostWorkflow({
      ...fx.options, trustedSkillEngineering: plan,
      environment: { AFYX_AFYX_SKILL_ENGINEERING_ENABLED: '0' },
    });
    assert.equal(off.results.some((item) => item.componentId === 'afyx-skill-engineering'), false);
    assert.equal(approvals, 0);
    assert.equal(existsSync(join(fx.skillsRoot, fx.spec.name)), false);
  });
});

test('host approval denial is fail-closed without installing or creating a draft', async () => {
  await fixture(async (fx) => {
    const result = await invokeHostWorkflow({
      ...fx.options, trustedSkillEngineering: fx.hostPlan(() => false),
    });
    const execution = result.results.find((item) => item.componentId === 'afyx-skill-engineering');
    assert.equal(execution?.executionStatus, 'FAILED');
    assert.equal(execution?.reason, 'HOST_APPROVAL_REQUIRED');
    assert.equal(existsSync(join(fx.draftsRoot, fx.spec.name)), false);
    assert.equal(existsSync(join(fx.skillsRoot, fx.spec.name)), false);
  });
});

test('install approval refusal preserves draft evidence but never touches provider root', async () => {
  await fixture(async (fx) => {
    const result = await invokeHostWorkflow({
      ...fx.options, trustedSkillEngineering: fx.hostPlan((proposal) => proposal.action === 'CREATE_DRAFT'),
    });
    const execution = result.results.find((item) => item.componentId === 'afyx-skill-engineering');
    assert.equal(execution?.executionStatus, 'FAILED');
    assert.equal(existsSync(join(fx.draftsRoot, fx.spec.name, 'SKILL.md')), true);
    assert.equal(existsSync(join(fx.skillsRoot, fx.spec.name)), false);
  });
});

test('adapter refuses a second operation and never overwrites a foreign skill', async () => {
  await fixture(async (fx) => {
    const runtime = createInstalledAfyxRuntime({
      ...fx.options, trustedSkillEngineering: fx.hostPlan(),
    });
    const state = runtime.componentStates['afyx-skill-engineering'];
    assert.equal(state.installed, true);
    assert.equal(state.authorized, true);
    const request = {
      targetComponentId: 'afyx-skill-engineering',
      capability: 'skill-authoring-lifecycle',
      permissions: { authorized: true },
      candidateProviders: ['codex'],
      sourceIdentity: state.sourceIdentity,
    };
    const adapter = runtime.adapters['afyx-skill-engineering'];
    const first = await adapter(request);
    assert.equal(first.status, 'SUCCESS');
    assert.equal((await adapter(request)).reason, 'TRUSTED_SKILL_PLAN_CONSUMED');
    assert.equal((await adapter({ ...request, targetComponentId: 'other' })).reason, 'TRUSTED_HOST_REQUEST_DENIED');
    runtime.dispose();
  });
  await fixture(async (fx) => {
    const foreign = join(fx.skillsRoot, fx.spec.name);
    mkdirSync(foreign);
    const manifest = join(foreign, 'SKILL.md');
    writeFileSync(manifest, '# foreign owner\n');
    const result = await invokeHostWorkflow({
      ...fx.options, trustedSkillEngineering: fx.hostPlan(),
    });
    const execution = result.results.find((item) => item.componentId === 'afyx-skill-engineering');
    assert.equal(execution?.executionStatus, 'FAILED');
    assert.equal(readFileSync(manifest, 'utf8'), '# foreign owner\n');
  });
});

test('invalid or mismatched trusted host config fails closed', async () => {
  await fixture(async (fx) => {
    await assert.rejects(
      invokeHostWorkflow({ ...fx.options, trustedSkillEngineering: {
        ...fx.hostPlan(), provider: 'antigravity',
      } }),
      /TRUSTED_SKILL_PROVIDER_MISMATCH/,
    );
    await assert.rejects(
      invokeHostWorkflow({ ...fx.options, trustedSkillEngineering: {
        ...fx.hostPlan(), authorize: true,
      } }),
      /TRUSTED_SKILL_HOST_CONFIG_INVALID/,
    );
  });
});
