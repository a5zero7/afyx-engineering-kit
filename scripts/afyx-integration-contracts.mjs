/** Versioned provider-capability and provider-neutral engineering contracts. */

import path from 'node:path';

export const PROVIDER_CAPABILITY_CONTRACT = 'ProviderCapability/v1';
export const PROVIDER_NEGOTIATION_CONTRACT = 'ProviderCapabilityNegotiation/v1';
export const ENGINEERING_TASK_CONTRACT = 'AfyxEngineeringTask/v1';
export const ENGINEERING_RESULT_CONTRACT = 'AfyxEngineeringResult/v1';
export const AGENT_GUARDRAILS_CONTRACT = 'AfyxAgentGuardrails/v1';

const ACCEPTANCE_STATES = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);
const COMPLETENESS_STATES = new Set(['COMPLETE', 'PARTIAL', 'UNKNOWN']);
const RESULT_STATES = new Set(['SUCCEEDED', 'FAILED', 'BLOCKED', 'UNSUPPORTED', 'NOT_RUN']);
const SEVERITIES = new Set(['INFO', 'WARNING', 'ERROR']);
const VERIFICATION_LEVELS = new Set(['DECLARED', 'RUNTIME']);
const INTEGRATION_COMPONENTS = new Set([
  'afyx-graph',
  'afyx-context',
  'afyx-engineering-expert',
  'odoo-engineering',
  'efficient-coding',
  'codex-usage-tracking',
  'afyx-forge',
]);
const KNOWN_CAPABILITIES = Object.freeze([
  'configuration', 'hooks', 'instructions', 'lifecycle', 'mcp', 'provider-routing', 'skills',
  'scope:cli-global', 'scope:global', 'scope:ide-global', 'scope:workspace',
  'surface:cli', 'surface:ide',
]);

export const EVIDENCE_CLASSES = Object.freeze([
  'DIRECT_EXECUTION',
  'VERIFIED_SOURCE',
  'GRAPH_INDEX',
  'EXTERNAL_DOCS',
  'INFERENCE',
  'UNAVAILABLE',
]);
export const EXECUTION_TYPES = Object.freeze(['REAL', 'MOCK', 'SYNTHETIC', 'STATIC', 'NONE']);
export const FRESHNESS_STATES = Object.freeze(['FRESH', 'STALE', 'UNKNOWN']);
export const CONTROL_MODES = Object.freeze(['MECHANICAL', 'ADVISORY', 'HYBRID']);
export const AUTHORIZATION_LEVELS = Object.freeze([
  'READ_ONLY',
  'WORKSPACE_WRITE',
  'DESTRUCTIVE_APPROVED',
  'ADMIN',
]);

export class ContractValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'ContractValidationError';
    this.code = 'INVALID_CONTRACT';
    this.path = path;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function object(value, path, allowed) {
  if (!isObject(value)) throw new ContractValidationError(path, 'must be an object');
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ContractValidationError(path, `contains unknown field ${unknown.sort()[0]}`);
  return value;
}

function text(value, path, max = 512) {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ContractValidationError(path, 'must be a non-empty printable string');
  }
  if (Buffer.byteLength(value, 'utf8') > max) throw new ContractValidationError(path, `exceeds ${max} bytes`);
  return value;
}

function optionalText(value, path, max = 512) {
  return value === undefined || value === null ? null : text(value, path, max);
}

function choice(value, path, allowed) {
  if (!allowed.has(value)) throw new ContractValidationError(path, `has unsupported value ${String(value)}`);
  return value;
}

function boolean(value, path, fallback = undefined) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'boolean') throw new ContractValidationError(path, 'must be boolean');
  return value;
}

function list(value, path, maximum = 256) {
  if (!Array.isArray(value)) throw new ContractValidationError(path, 'must be an array');
  if (value.length > maximum) throw new ContractValidationError(path, `exceeds ${maximum} items`);
  return value;
}

function split(value) {
  return typeof value === 'string' ? value.split(';').filter(Boolean) : [];
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function stableValue(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => stableValue(item, `${path}[${index}]`));
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key], `${path}.${key}`)]));
  }
  throw new ContractValidationError(path, 'must contain only JSON-compatible values');
}

export function serializeContract(value) {
  return JSON.stringify(stableValue(value));
}

function malformedDiscovery(definition, diagnostic) {
  return freeze({
    contract: PROVIDER_CAPABILITY_CONTRACT,
    provider: { id: String(definition?.provider || 'unknown'), name: String(definition?.name || 'Unknown') },
    status: 'BLOCKED',
    host: { commands: [], detected: null, command: null, version: null, status: 'BLOCKED', evidence: 'NONE', runtimeVerified: false },
    surfaces: [],
    scopes: { lifecycle: [], mcp: [], skills: [] },
    ownership: { class: 'USER', configurationPolicy: 'observe-only' },
    capabilities: [],
    acceptance: 'NOT_RUN',
    mutationAuthorized: false,
    diagnostics: [{ code: diagnostic, severity: 'ERROR', message: 'Capability metadata failed validation.' }],
  });
}

function hostObservation(value) {
  if (value === undefined) return { detected: null, command: null, version: null, evidence: 'NONE' };
  const host = object(value, 'host', ['detected', 'command', 'version', 'evidence']);
  const detected = host.detected === undefined ? null : boolean(host.detected, 'host.detected');
  const command = optionalText(host.command, 'host.command', 256);
  const version = optionalText(host.version, 'host.version', 256);
  const evidence = host.evidence === undefined ? 'NONE' : choice(host.evidence, 'host.evidence', new Set(['NONE', 'CALLER', 'FILESYSTEM']));
  if (detected === true && command === null) throw new ContractValidationError('host.command', 'is required when detected is true');
  return { detected, command, version, evidence };
}

function capabilityRecord(id, declared, host) {
  if (id === 'surface:cli' && declared) {
    if (host.detected === false) return { id, declared: true, status: 'BLOCKED', runtimeVerified: false, evidence: host.evidence };
    if (host.detected === null) return { id, declared: true, status: 'UNVERIFIED', runtimeVerified: false, evidence: 'DECLARED' };
    return { id, declared: true, status: 'UNVERIFIED', runtimeVerified: false, evidence: host.evidence };
  }
  if (id === 'surface:ide' && declared) {
    return { id, declared: true, status: 'UNVERIFIED', runtimeVerified: false, evidence: 'DECLARED' };
  }
  return declared
    ? { id, declared: true, status: 'SUPPORTED', runtimeVerified: false, evidence: 'DECLARED' }
    : { id, declared: false, status: 'UNSUPPORTED', runtimeVerified: false, evidence: 'REGISTRY' };
}

export function discoverProviderCapabilities(definition, adapterCapabilities, options = {}) {
  try {
    object(options, 'options', ['host']);
    const provider = text(definition?.provider, 'provider.provider', 128);
    const name = text(definition?.name, 'provider.name', 256);
    const ownershipClass = choice(definition?.ownership_class, 'provider.ownership_class', new Set(['AFYX', 'EXTERNAL', 'USER']));
    const configurationPolicy = choice(
      definition?.configuration_policy,
      'provider.configuration_policy',
      new Set(['merge-afyx-owned-entries-only', 'observe-only']),
    );
    const commands = split(definition?.host_commands).map((item, index) => text(item, `provider.host_commands[${index}]`, 256));
    const surfaces = split(definition?.surfaces).map((item, index) => text(item, `provider.surfaces[${index}]`, 128));
    const lifecycleScopes = (adapterCapabilities?.scopes || []).map((item, index) => text(item, `adapter.scopes[${index}]`, 128));
    const mcpScopes = split(definition?.mcp_scopes).map((item, index) => text(item, `provider.mcp_scopes[${index}]`, 128));
    const skillScopes = split(definition?.skill_scopes).map((item, index) => text(item, `provider.skill_scopes[${index}]`, 128));
    const instructionScopes = split(definition?.instruction_scopes).map((item, index) => text(item, `provider.instruction_scopes[${index}]`, 128));
    const host = hostObservation(options.host);
    const declared = new Set([
      ...split(definition?.capabilities),
      ...surfaces.map((item) => `surface:${item}`),
      ...[...new Set([...lifecycleScopes, ...mcpScopes, ...skillScopes, ...instructionScopes])].map((item) => `scope:${item}`),
      'configuration',
      'lifecycle',
    ]);
    const capabilities = KNOWN_CAPABILITIES.map((id) => capabilityRecord(id, declared.has(id), host));
    const hostStatus = host.detected === false ? 'BLOCKED' : 'UNVERIFIED';
    return freeze({
      contract: PROVIDER_CAPABILITY_CONTRACT,
      provider: { id: provider, name },
      status: hostStatus,
      host: { commands, ...host, status: hostStatus, runtimeVerified: false },
      surfaces,
      scopes: { lifecycle: lifecycleScopes, mcp: mcpScopes, skills: skillScopes, instructions: instructionScopes },
      ownership: { class: ownershipClass, configurationPolicy },
      capabilities,
      acceptance: 'NOT_RUN',
      mutationAuthorized: false,
      diagnostics: [],
    });
  } catch (error) {
    return malformedDiscovery(definition, error instanceof ContractValidationError ? 'MALFORMED_CAPABILITY_METADATA' : 'CAPABILITY_DISCOVERY_FAILED');
  }
}

export function negotiateProviderCapabilities(discovery, requirements) {
  const blocked = (code, message) => freeze({
    contract: PROVIDER_NEGOTIATION_CONTRACT,
    provider: typeof discovery?.provider?.id === 'string' ? discovery.provider.id : 'unknown',
    status: 'BLOCKED',
    requirements: [],
    mutationAuthorized: false,
    diagnostics: [{ code, severity: 'ERROR', message }],
  });
  try {
    if (!isObject(discovery) || discovery.contract !== PROVIDER_CAPABILITY_CONTRACT || !Array.isArray(discovery.capabilities)) {
      return blocked('MALFORMED_DISCOVERY', 'Capability discovery is invalid.');
    }
    if (discovery.status === 'BLOCKED') {
      return blocked('DISCOVERY_BLOCKED', 'Capability discovery is blocked.');
    }
    const requested = list(requirements, 'requirements', 128).map((requirement, index) => {
      const path = `requirements[${index}]`;
      const item = object(requirement, path, ['capability', 'required', 'verification']);
      return {
        capability: text(item.capability, `${path}.capability`, 128),
        required: boolean(item.required, `${path}.required`, true),
        verification: item.verification === undefined ? 'DECLARED' : choice(item.verification, `${path}.verification`, VERIFICATION_LEVELS),
      };
    });
    const available = new Map(discovery.capabilities.map((item) => [item.id, item]));
    const evaluated = requested.map((requirement) => {
      const capability = available.get(requirement.capability);
      let status = 'BLOCKED';
      let reason = capability ? '' : 'UNKNOWN_CAPABILITY';
      if (capability) {
        if (!capability.declared) status = 'UNSUPPORTED';
        else if (requirement.verification === 'DECLARED') status = 'SUPPORTED';
        else if (capability.runtimeVerified) status = 'SUPPORTED';
        else if (capability.status === 'BLOCKED') status = 'BLOCKED';
        else {
          status = 'UNVERIFIED';
          reason = 'RUNTIME_EVIDENCE_ABSENT';
        }
      }
      return { ...requirement, status, ...(reason ? { reason } : {}) };
    });
    const required = evaluated.filter((item) => item.required);
    const status = required.some((item) => item.status === 'BLOCKED') ? 'BLOCKED'
      : required.some((item) => item.status === 'UNSUPPORTED') ? 'UNSUPPORTED'
        : required.some((item) => item.status === 'UNVERIFIED') ? 'UNVERIFIED' : 'SUPPORTED';
    return freeze({
      contract: PROVIDER_NEGOTIATION_CONTRACT,
      provider: discovery.provider.id,
      status,
      requirements: evaluated,
      mutationAuthorized: false,
      diagnostics: evaluated.filter((item) => item.reason).map((item) => ({ code: item.reason, severity: 'WARNING', message: `Capability ${item.capability} is not runtime-verified.` })),
    });
  } catch {
    return blocked('MALFORMED_REQUIREMENTS', 'Capability requirements failed validation.');
  }
}

function provenance(value, path) {
  const item = object(value, path, ['source', 'reference', 'digest']);
  return {
    source: text(item.source, `${path}.source`, 256),
    ...(item.reference === undefined ? {} : { reference: text(item.reference, `${path}.reference`, 32_767) }),
    ...(item.digest === undefined ? {} : { digest: text(item.digest, `${path}.digest`, 256) }),
  };
}

function capabilityRequirements(value, path) {
  return list(value, path, 128).map((requirement, index) => {
    const at = `${path}[${index}]`;
    const item = object(requirement, at, ['capability', 'required', 'verification']);
    return {
      capability: text(item.capability, `${at}.capability`, 128),
      required: boolean(item.required, `${at}.required`, true),
      verification: item.verification === undefined ? 'DECLARED' : choice(item.verification, `${at}.verification`, VERIFICATION_LEVELS),
    };
  });
}

function integrations(value, path) {
  if (value === undefined) return [];
  return list(value, path, 8).map((integration, index) => {
    const at = `${path}[${index}]`;
    const item = object(integration, at, ['component', 'contract', 'status', 'reference']);
    return {
      component: choice(item.component, `${at}.component`, INTEGRATION_COMPONENTS),
      contract: text(item.contract, `${at}.contract`, 256),
      status: choice(item.status, `${at}.status`, new Set(['AVAILABLE', 'UNAVAILABLE', 'BLOCKED', 'NOT_RUN'])),
      ...(item.reference === undefined ? {} : { reference: text(item.reference, `${at}.reference`, 32_767) }),
    };
  });
}

function policyDefinition(value, path) {
  if (value === undefined || value === null) return null;
  const item = object(value, path, [
    'contract',
    'controlMode',
    'allowedOperations',
    'allowedFiles',
    'excludedScope',
    'expectedOutcomes',
    'authorization',
  ]);
  const contract = item.contract === undefined
    ? AGENT_GUARDRAILS_CONTRACT
    : choice(item.contract, `${path}.contract`, new Set([AGENT_GUARDRAILS_CONTRACT]));
  const controlMode = item.controlMode === undefined
    ? 'HYBRID'
    : choice(item.controlMode, `${path}.controlMode`, new Set(CONTROL_MODES));
  const allowedOperations = item.allowedOperations === undefined
    ? []
    : list(item.allowedOperations, `${path}.allowedOperations`, 64).map((op, i) => text(op, `${path}.allowedOperations[${i}]`, 128));
  const allowedFiles = item.allowedFiles === undefined
    ? []
    : list(item.allowedFiles, `${path}.allowedFiles`, 256).map((f, i) => text(f, `${path}.allowedFiles[${i}]`, 1024));
  const excludedScope = item.excludedScope === undefined
    ? []
    : list(item.excludedScope, `${path}.excludedScope`, 256).map((f, i) => text(f, `${path}.excludedScope[${i}]`, 1024));
  const expectedOutcomes = item.expectedOutcomes === undefined
    ? []
    : list(item.expectedOutcomes, `${path}.expectedOutcomes`, 64).map((o, i) => text(o, `${path}.expectedOutcomes[${i}]`, 1024));
  const authorization = item.authorization === undefined
    ? 'READ_ONLY'
    : choice(item.authorization, `${path}.authorization`, new Set(AUTHORIZATION_LEVELS));
  return {
    contract,
    controlMode,
    allowedOperations,
    allowedFiles,
    excludedScope,
    expectedOutcomes,
    authorization,
  };
}

export function createEngineeringTask(input) {
  const root = object(input, 'taskContract', ['contract', 'task', 'workspace', 'context', 'requirements', 'integrations', 'policy']);
  if (root.contract !== undefined && root.contract !== ENGINEERING_TASK_CONTRACT) {
    throw new ContractValidationError('taskContract.contract', 'has an unsupported contract version');
  }
  const task = object(root.task, 'taskContract.task', ['id', 'operation', 'objective']);
  const workspace = object(root.workspace, 'taskContract.workspace', ['id', 'root', 'revision']);
  const context = object(root.context, 'taskContract.context', ['sources', 'completeness']);
  const sources = list(context.sources, 'taskContract.context.sources', 256).map((source, index) => {
    const at = `taskContract.context.sources[${index}]`;
    const item = object(source, at, ['id', 'type', 'completeness', 'provenance']);
    return {
      id: text(item.id, `${at}.id`, 512),
      type: text(item.type, `${at}.type`, 128),
      completeness: choice(item.completeness, `${at}.completeness`, COMPLETENESS_STATES),
      provenance: provenance(item.provenance, `${at}.provenance`),
    };
  });
  const policy = root.policy === undefined ? null : policyDefinition(root.policy, 'taskContract.policy');
  return freeze({
    contract: ENGINEERING_TASK_CONTRACT,
    task: {
      id: text(task.id, 'taskContract.task.id', 512),
      operation: text(task.operation, 'taskContract.task.operation', 256),
      ...(task.objective === undefined ? {} : { objective: text(task.objective, 'taskContract.task.objective', 4096) }),
    },
    workspace: {
      id: text(workspace.id, 'taskContract.workspace.id', 512),
      ...(workspace.root === undefined ? {} : { root: text(workspace.root, 'taskContract.workspace.root', 32_767) }),
      ...(workspace.revision === undefined ? {} : { revision: text(workspace.revision, 'taskContract.workspace.revision', 512) }),
    },
    context: { sources, completeness: choice(context.completeness, 'taskContract.context.completeness', COMPLETENESS_STATES) },
    requirements: capabilityRequirements(root.requirements, 'taskContract.requirements'),
    integrations: integrations(root.integrations, 'taskContract.integrations'),
    ...(policy ? { policy } : {}),
  });
}

export function validateEngineeringTask(value) {
  if (!isObject(value) || value.contract !== ENGINEERING_TASK_CONTRACT) {
    throw new ContractValidationError('taskContract.contract', 'must identify AfyxEngineeringTask/v1');
  }
  return createEngineeringTask(value);
}

export function createEngineeringResult(input) {
  const root = object(input, 'resultContract', ['contract', 'taskId', 'status', 'output', 'evidence', 'diagnostics', 'integrations']);
  if (root.contract !== undefined && root.contract !== ENGINEERING_RESULT_CONTRACT) {
    throw new ContractValidationError('resultContract.contract', 'has an unsupported contract version');
  }
  const evidence = list(root.evidence, 'resultContract.evidence', 256).map((entry, index) => {
    const at = `resultContract.evidence[${index}]`;
    const item = object(entry, at, ['id', 'type', 'validation', 'provenance', 'evidenceClass', 'executionType', 'freshness']);
    const validation = choice(item.validation, `${at}.validation`, ACCEPTANCE_STATES);
    const evidenceClass = item.evidenceClass === undefined ? null : choice(item.evidenceClass, `${at}.evidenceClass`, new Set(EVIDENCE_CLASSES));
    const executionType = item.executionType === undefined ? null : choice(item.executionType, `${at}.executionType`, new Set(EXECUTION_TYPES));
    const freshness = item.freshness === undefined ? null : choice(item.freshness, `${at}.freshness`, new Set(FRESHNESS_STATES));

    if (validation === 'PASS') {
      if (evidenceClass === 'INFERENCE' || evidenceClass === 'UNAVAILABLE') {
        throw new ContractValidationError(
          `${at}.validation`,
          `unsupported claim cannot receive verified PASS status (evidenceClass: ${evidenceClass})`
        );
      }
      if (executionType === 'MOCK' && evidenceClass === 'DIRECT_EXECUTION') {
        throw new ContractValidationError(
          `${at}.validation`,
          'mock execution cannot receive verified direct execution PASS status'
        );
      }
    }

    return {
      id: text(item.id, `${at}.id`, 512),
      type: text(item.type, `${at}.type`, 128),
      validation,
      provenance: provenance(item.provenance, `${at}.provenance`),
      ...(evidenceClass ? { evidenceClass } : {}),
      ...(executionType ? { executionType } : {}),
      ...(freshness ? { freshness } : {}),
    };
  });
  const diagnostics = list(root.diagnostics, 'resultContract.diagnostics', 256).map((diagnostic, index) => {
    const at = `resultContract.diagnostics[${index}]`;
    const item = object(diagnostic, at, ['code', 'severity', 'message']);
    return {
      code: text(item.code, `${at}.code`, 128),
      severity: choice(item.severity, `${at}.severity`, SEVERITIES),
      message: text(item.message, `${at}.message`, 4096),
    };
  });
  return freeze({
    contract: ENGINEERING_RESULT_CONTRACT,
    taskId: text(root.taskId, 'resultContract.taskId', 512),
    status: choice(root.status, 'resultContract.status', RESULT_STATES),
    ...(root.output === undefined ? {} : { output: stableValue(root.output, 'resultContract.output') }),
    evidence,
    diagnostics,
    integrations: integrations(root.integrations, 'resultContract.integrations'),
  });
}

export function validateEngineeringResult(value) {
  if (!isObject(value) || value.contract !== ENGINEERING_RESULT_CONTRACT) {
    throw new ContractValidationError('resultContract.contract', 'must identify AfyxEngineeringResult/v1');
  }
  return createEngineeringResult(value);
}

function isUnsafeAbsolutePath(rawPath) {
  if (typeof rawPath !== 'string') return false;
  const p = rawPath.trim();
  if (p.startsWith('\\\\') || p.startsWith('//')) return true;
  if (/^[a-zA-Z]:/u.test(p)) return true;
  if (p.startsWith('/') || p.startsWith('\\')) return true;
  return false;
}

function normalizePath(p) {
  const replaced = String(p).replace(/\\/g, '/');
  const posixNorm = path.posix.normalize(replaced);
  return posixNorm.replace(/^\.\//, '');
}

function matchesScopePattern(filePath, pattern) {
  const normFile = normalizePath(filePath);
  const normPattern = normalizePath(pattern);
  if (normPattern === '*' || normPattern === '**') return true;
  if (normFile === normPattern) return true;
  if (normPattern.endsWith('/**')) {
    const prefix = normPattern.slice(0, -3);
    return normFile === prefix || normFile.startsWith(prefix + '/');
  }
  if (normPattern.endsWith('/*')) {
    const prefix = normPattern.slice(0, -2);
    if (!normFile.startsWith(prefix + '/')) return false;
    const rest = normFile.slice(prefix.length + 1);
    return !rest.includes('/');
  }
  return normFile.startsWith(normPattern.endsWith('/') ? normPattern : normPattern + '/');
}

const READ_ONLY_OPERATIONS = new Set(['inspect', 'review', 'plan', 'verify', 'analyze', 'status', 'read']);

function isMutatingOperation(op) {
  if (typeof op !== 'string' || !op.trim()) return false;
  return !READ_ONLY_OPERATIONS.has(op.trim().toLowerCase());
}

export function validateTaskScope(task, requestedAction = {}) {
  if (!isObject(task) || task.contract !== ENGINEERING_TASK_CONTRACT) {
    throw new ContractValidationError('task', 'must be a valid AfyxEngineeringTask/v1');
  }
  const action = object(requestedAction, 'requestedAction', [
    'operation',
    'files',
    'revision',
    'mutation',
  ]);

  const violations = [];
  const policy = task.policy;
  const hasPolicy = Boolean(policy);
  const isGuardedWrite = hasPolicy && policy.authorization !== 'READ_ONLY';

  // 0. Field type validation & malformed context checks
  if (action.operation !== undefined && action.operation !== null) {
    if (typeof action.operation !== 'string' || !action.operation.trim()) {
      violations.push({
        code: 'MALFORMED_ACTION_FIELD',
        message: "Field 'operation' must be a non-empty string.",
      });
    }
  }

  if (action.revision !== undefined && action.revision !== null) {
    if (typeof action.revision !== 'string' || !action.revision.trim()) {
      violations.push({
        code: 'MALFORMED_ACTION_FIELD',
        message: "Field 'revision' must be a non-empty string.",
      });
    }
  }

  if (action.mutation !== undefined && action.mutation !== null) {
    if (typeof action.mutation !== 'boolean') {
      violations.push({
        code: 'MALFORMED_ACTION_FIELD',
        message: "Field 'mutation' must be a boolean.",
      });
    }
  }

  if (action.files !== undefined && action.files !== null) {
    if (!Array.isArray(action.files)) {
      violations.push({
        code: 'MALFORMED_ACTION_FIELD',
        message: "Field 'files' must be an array of path strings.",
      });
    } else {
      for (let i = 0; i < action.files.length; i++) {
        const f = action.files[i];
        if (typeof f !== 'string' || !f.trim()) {
          violations.push({
            code: 'INVALID_FILE_ENTRY',
            message: `File entry at index ${i} must be a non-empty string.`,
          });
        }
      }
    }
  }

  // 1. Conservative mutation classification:
  // Explicit mutation:false must not override evidence of an intended write
  const hasMutatingOp = isMutatingOperation(action.operation);
  const isExplicitMutation = action.mutation === true;
  const isMutation = isExplicitMutation || hasMutatingOp
    || (hasPolicy && Array.isArray(action.files) && action.files.length > 0 && action.operation === undefined);

  // 2. Source revision check (Fail closed on missing/mismatched revision for guarded tasks)
  const expectedRevision = task.workspace?.revision;
  if (hasPolicy && isMutation && expectedRevision) {
    if (action.revision === undefined || action.revision === null || action.revision === '') {
      violations.push({
        code: 'MISSING_SOURCE_REVISION',
        message: 'Guarded mutation request must declare source revision matching task baseline.',
      });
    } else if (action.revision !== expectedRevision) {
      violations.push({
        code: 'SOURCE_REVISION_MISMATCH',
        message: `Current revision '${action.revision}' does not match task baseline revision '${expectedRevision}'.`,
      });
    }
  } else if (action.revision !== undefined && action.revision !== null) {
    if (expectedRevision && action.revision !== expectedRevision) {
      violations.push({
        code: 'SOURCE_REVISION_MISMATCH',
        message: `Current revision '${action.revision}' does not match task baseline revision '${expectedRevision}'.`,
      });
    }
  }

  // 3. Allowed operations check
  if (hasPolicy && isMutation) {
    if (action.operation === undefined || action.operation === null || action.operation === '') {
      violations.push({
        code: 'MISSING_OPERATION',
        message: 'Guarded mutation request must declare an operation to evaluate allowedOperations.',
      });
    }
  }

  if (isGuardedWrite) {
    // Explicit guarded write policy must not silently interpret missing allowedOperations as unrestricted
    if (action.operation) {
      if (!policy.allowedOperations || policy.allowedOperations.length === 0) {
        violations.push({
          code: 'UNAUTHORIZED_OPERATION',
          message: `Guarded write policy does not authorize operation '${action.operation}'; allowedOperations is not configured. Use explicit wildcard or operation grants.`,
        });
      } else if (!policy.allowedOperations.includes('*') && !policy.allowedOperations.includes(action.operation)) {
        violations.push({
          code: 'UNAUTHORIZED_OPERATION',
          message: `Operation '${action.operation}' is not within allowedOperations: [${policy.allowedOperations.join(', ')}].`,
        });
      }
    }
  } else if (action.operation !== undefined && policy?.allowedOperations?.length) {
    if (!policy.allowedOperations.includes('*') && !policy.allowedOperations.includes(action.operation)) {
      violations.push({
        code: 'UNAUTHORIZED_OPERATION',
        message: `Operation '${action.operation}' is not within allowedOperations: [${policy.allowedOperations.join(', ')}].`,
      });
    }
  }

  // 4. Mutation authorization check
  if (isMutation) {
    if (policy?.authorization === 'READ_ONLY') {
      violations.push({
        code: 'MUTATION_NOT_AUTHORIZED',
        message: 'Task authorization is READ_ONLY; file mutations are not permitted.',
      });
    }
    if (hasPolicy && (!Array.isArray(action.files) || action.files.length === 0)) {
      violations.push({
        code: 'MISSING_TARGET_FILES',
        message: 'Guarded mutation requested without specifying target files.',
      });
    }
  }

  // 5. File scope checks (Absolute, UNC, drive paths rejected before allowlist matching; traversal and allowlist)
  if (Array.isArray(action.files) && action.files.length > 0) {
    for (const file of action.files) {
      if (typeof file !== 'string' || !file.trim()) {
        continue;
      }
      if (isUnsafeAbsolutePath(file)) {
        violations.push({
          code: 'ABSOLUTE_PATH_REJECTED',
          message: `File '${file}' is an absolute or drive-qualified path; only workspace-relative paths are permitted.`,
        });
        continue;
      }

      const normFile = normalizePath(file);
      if (normFile.startsWith('../') || normFile === '..') {
        violations.push({
          code: 'PATH_TRAVERSAL_DETECTED',
          message: `File '${file}' attempts directory traversal outside workspace boundary.`,
        });
        continue;
      }
      if (policy?.excludedScope?.length) {
        const isExcluded = policy.excludedScope.some((pattern) => matchesScopePattern(normFile, pattern));
        if (isExcluded) {
          violations.push({
            code: 'EXCLUDED_SCOPE_VIOLATION',
            message: `File '${file}' matches excluded scope pattern.`,
          });
        }
      }
      if (isGuardedWrite) {
        // Explicit guarded write policy must not silently interpret missing allowedFiles as unrestricted
        if (!policy.allowedFiles || policy.allowedFiles.length === 0) {
          violations.push({
            code: 'UNAUTHORIZED_FILE_SCOPE',
            message: `File '${file}' is unauthorized; guarded write policy does not configure allowedFiles. Use explicit wildcard grants (e.g. ['**']) for broad access.`,
          });
        } else {
          const isAllowed = policy.allowedFiles.some((pattern) => matchesScopePattern(normFile, pattern));
          if (!isAllowed) {
            violations.push({
              code: 'UNAUTHORIZED_FILE_SCOPE',
              message: `File '${file}' is outside allowedFiles scope.`,
            });
          }
        }
      } else if (policy?.allowedFiles?.length) {
        const isAllowed = policy.allowedFiles.some((pattern) => matchesScopePattern(normFile, pattern));
        if (!isAllowed) {
          violations.push({
            code: 'UNAUTHORIZED_FILE_SCOPE',
            message: `File '${file}' is outside allowedFiles scope.`,
          });
        }
      }
    }
  }

  const allowed = violations.length === 0;
  return freeze({
    allowed,
    status: allowed ? 'SCOPE_AUTHORIZED' : 'SCOPE_VIOLATION',
    violations,
  });
}

export function evaluateSearchEfficiency(input = {}) {
  const options = object(input, 'searchEfficiencyOptions', [
    'query',
    'previousQueries',
    'indexFreshness',
    'newEvidenceAvailable',
    'unresolvedQuestion',
    'requiresRelationships',
    'knownPath',
  ]);

  const query = text(options.query, 'searchEfficiencyOptions.query', 1024);
  const previousQueries = options.previousQueries === undefined ? [] : list(options.previousQueries, 'searchEfficiencyOptions.previousQueries', 128);
  const indexFreshness = options.indexFreshness === undefined ? 'FRESH' : choice(options.indexFreshness, 'searchEfficiencyOptions.indexFreshness', new Set(FRESHNESS_STATES));
  const newEvidenceAvailable = boolean(options.newEvidenceAvailable, 'searchEfficiencyOptions.newEvidenceAvailable', false);
  const unresolvedQuestion = optionalText(options.unresolvedQuestion, 'searchEfficiencyOptions.unresolvedQuestion', 2048);
  const requiresRelationships = boolean(options.requiresRelationships, 'searchEfficiencyOptions.requiresRelationships', false);
  const knownPath = optionalText(options.knownPath, 'searchEfficiencyOptions.knownPath', 1024);

  // Preference 1: If exact path is known and relationships are not required, direct source inspection is preferred
  if (knownPath && !requiresRelationships) {
    return freeze({
      action: 'DIRECT_INSPECTION',
      target: knownPath,
      reason: 'DIRECT_INSPECTION_PREFERRED',
      message: `Exact path '${knownPath}' is known and relationship exploration is not required; inspect source directly.`,
    });
  }

  // Check duplicate equivalent queries
  const normalizedQuery = query.trim().toLowerCase();
  const isDuplicate = previousQueries.some((prev) => {
    const prevText = typeof prev === 'string' ? prev : prev?.query;
    return typeof prevText === 'string' && prevText.trim().toLowerCase() === normalizedQuery;
  });

  if (isDuplicate) {
    if (newEvidenceAvailable) {
      return freeze({
        action: 'EXECUTE',
        reason: 'REQUERY_JUSTIFIED_BY_NEW_EVIDENCE',
        message: 'Re-query is justified because new evidence or modified files became available.',
      });
    }
    if (indexFreshness === 'STALE') {
      return freeze({
        action: 'EXECUTE',
        reason: 'REQUERY_JUSTIFIED_BY_INDEX_STALENESS',
        message: 'Re-query is justified because Graph index is stale and requires refreshed exploration.',
      });
    }
    if (unresolvedQuestion) {
      return freeze({
        action: 'EXECUTE',
        reason: 'REQUERY_JUSTIFIED_BY_UNRESOLVED_QUESTION',
        message: `Re-query is justified to resolve specific question: ${unresolvedQuestion}`,
      });
    }
    return freeze({
      action: 'REUSE_PREVIOUS',
      reason: 'DUPLICATE_QUERY_REUSE',
      message: 'Equivalent search was previously executed; reuse prior evidence instead of redundant tool invocation.',
    });
  }

  if (requiresRelationships) {
    if (indexFreshness === 'STALE') {
      return freeze({
        action: 'GRAPH_EXPLORE',
        reason: 'STALE_INDEX_FALLBACK_RECOMMENDED',
        message: 'Graph relationships needed, but index is stale; combine with direct source cross-check.',
      });
    }
    return freeze({
      action: 'GRAPH_EXPLORE',
      reason: 'RELATIONSHIP_ANALYSIS_REQUIRED',
      message: 'Graph exploration selected because structural relationship or impact analysis is required.',
    });
  }

  return freeze({
    action: 'EXECUTE',
    reason: 'INITIAL_QUERY',
    message: 'Initial query execution permitted.',
  });
}

export function evaluateProviderGuardrailsPolicy(providerId, negotiation) {
  const provider = text(providerId, 'providerId', 128);
  const negotiationObj = object(negotiation, 'negotiation', [
    'contract',
    'provider',
    'status',
    'requirements',
    'mutationAuthorized',
    'diagnostics',
  ]);

  const requirements = negotiationObj.requirements || [];
  const unsupported = requirements.filter((r) => r.status === 'UNSUPPORTED');
  const unverified = requirements.filter((r) => r.status === 'UNVERIFIED');

  return freeze({
    contract: AGENT_GUARDRAILS_CONTRACT,
    provider,
    enforcementScope: 'VALIDATOR_ONLY',
    contractValidatorsAvailable: true,
    explicitInvocationValidation: true,
    automaticMutationInterception: false,
    automaticGraphInterception: false,
    runtimeEnforcementActive: false,
    osLevelEnforcement: false,
    mechanicalEnforcement: false,
    unsupportedCapabilities: unsupported.map((u) => u.capability),
    unverifiedCapabilities: unverified.map((u) => u.capability),
    gracefullyDegraded: unsupported.length > 0 || unverified.length > 0,
  });
}
