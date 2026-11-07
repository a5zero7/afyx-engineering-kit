import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeAfyxCapabilityRoute,
  resolveAfyxCapabilityRoute,
} from '../afyx-capability-orchestrator.mjs';

const available = (extra = {}) => ({
  installed: true,
  healthy: true,
  compatible: true,
  authorized: true,
  sourceIdentity: 'fixture-source',
  ...extra,
});

const componentStates = () => ({
  'odoo-engineering': available(),
  'afyx-graph': available({ indexReady: true, indexFresh: true }),
  'afyx-context': available(),
  'afyx-skill-engineering': available(),
  'afyx-credential-broker': available(),
});

test('combined Odoo to Graph to Context keeps task type and real executed evidence without duplicate Context calls', async () => {
  const payload = 'SaleOrder _inherit sale.order at project/addons/sale/models/sale_order.py:3';
  let graphCalls = 0;
  let contextCalls = 0;
  let contextReceivedSource = false;

  const result = await executeAfyxCapabilityRoute({
    provider: 'codex',
    environment: { AFYX_CONTEXT_OPT_IN: '1' },
    componentStates: componentStates(),
    task: {
      id: 'combined-odoo-graph-context',
      taskType: 'odoo-impact-analysis',
      needsRelationalEvidence: true,
      workspaceIdentity: 'fixture/repository',
      sourceRevision: 'fixture-source',
    },
    adapters: {
      'odoo-engineering': () => ({ status: 'SUCCESS', output: 'Odoo authority' }),
      'afyx-graph': (request) => {
        graphCalls += 1;
        assert.equal(request.taskType, 'odoo-impact-analysis');
        return {
          status: 'SUCCESS',
          output: payload,
          followUpRequests: [
            { targetComponentId: 'afyx-context', invocationReason: 'Reduce actual Graph evidence' },
            { targetComponentId: 'afyx-context', invocationReason: 'Do not reduce twice' },
          ],
        };
      },
      'afyx-context': (request) => {
        contextCalls += 1;
        assert.equal(request.sourceResult?.status, 'EXECUTED');
        assert.equal(request.sourceResult?.componentId, 'afyx-graph');
        assert.equal(request.sourceResult?.output, payload);
        contextReceivedSource = true;
        return { status: 'SUCCESS', output: 'bounded:SaleOrder' };
      },
    },
  });

  assert.equal(result.executionStatus, 'EXECUTED');
  assert.equal(graphCalls, 1);
  assert.equal(contextCalls, 1);
  assert.equal(contextReceivedSource, true);
  assert.equal(result.metrics.duplicateInvocationsAvoided, 1);
});

test('native Skill Engineering selects only when requested; unrelated direct source and Credential Broker OFF remain idle', async () => {
  const states = componentStates();
  let skillCalls = 0;
  let graphCalls = 0;
  const skillRoute = await executeAfyxCapabilityRoute({
    provider: 'codex',
    componentStates: states,
    task: { id: 'native-skill', taskType: 'skill-authoring', needsCustomCapability: 'skill-authoring-lifecycle' },
    adapters: {
      'afyx-skill-engineering': () => {
        skillCalls += 1;
        return { status: 'SUCCESS', output: 'validated-skills-package' };
      },
      'afyx-graph': () => { graphCalls += 1; return { status: 'SUCCESS' }; },
    },
  });
  assert.equal(skillRoute.executionStatus, 'EXECUTED');
  assert.equal(skillCalls, 1);
  assert.equal(graphCalls, 0);

  const disabledStates = {
    ...states,
    'afyx-credential-broker': available({ enabled: false }),
  };
  const brokerRoute = resolveAfyxCapabilityRoute({
    provider: 'codex',
    componentStates: disabledStates,
    task: { id: 'broker-off', needsCustomCapability: 'credential-use-authorization' },
  });
  assert.equal(brokerRoute.requests.some((request) => request.targetComponentId === 'afyx-credential-broker'), false);

  const direct = await executeAfyxCapabilityRoute({
    provider: 'codex',
    componentStates: states,
    task: { id: 'direct', taskType: 'known-file', knownFile: true },
    adapters: {
      'afyx-graph': () => { graphCalls += 1; return { status: 'SUCCESS' }; },
    },
  });
  assert.equal(direct.executionStatus, 'DIRECT_SOURCE');
  assert.equal(direct.metrics.toolCalls, 0);
  assert.equal(graphCalls, 0);
});
