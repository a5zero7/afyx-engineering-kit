import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AceError } from './errors.js';
import { ACE_INTEGRATION_CONTRACT } from './integrations.js';

export const GRAPH_ACE_CONSUMER_CONTRACT = 'graph.ace.consumer/v1';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 60_000;
const TERMINATION_GRACE_MS = 5_000;
const SOURCE_TOOLS = new Set(['afyx_graph_explore', 'afyx_graph_files', 'afyx_graph_node']);
const DIAGNOSTIC_TOOLS = new Set(['afyx_graph_status']);

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertString(value, name, maxBytes = undefined) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AceError('INVALID_INTEGRATION', `${name} must be a non-empty string`);
  }
  if (maxBytes !== undefined && Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new AceError('RESOURCE_LIMIT', `${name} exceeds the ${maxBytes} byte limit`);
  }
  return value;
}

function canonicalProjectRoot(value) {
  const resolved = path.resolve(assertString(value, 'projectRoot', 32_767));
  let canonical;
  try {
    canonical = fs.realpathSync.native(resolved);
  } catch {
    throw new AceError('INVALID_INTEGRATION', 'projectRoot must be an accessible directory');
  }
  if (!fs.statSync(canonical).isDirectory()) {
    throw new AceError('INVALID_INTEGRATION', 'projectRoot must be a directory');
  }
  return canonical;
}

function cloneGraphResult(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.content)) {
    throw new AceError('INVALID_INTEGRATION', 'Graph result must contain a content array');
  }
  if (!value.content.every((item) => item && item.type === 'text' && typeof item.text === 'string')) {
    throw new AceError('INVALID_INTEGRATION', 'Graph result contains an unsupported content block');
  }
  try {
    return structuredClone(value);
  } catch {
    throw new AceError('INVALID_INTEGRATION', 'Graph result must be cloneable');
  }
}

function classificationFor(toolName) {
  if (SOURCE_TOOLS.has(toolName)) return 'source-evidence';
  if (DIAGNOSTIC_TOOLS.has(toolName)) return 'diagnostic';
  return 'normal';
}

function pathKey(value) {
  // Compare canonical paths even when the state directory is not created yet.
  // macOS /var -> /private/var and Windows junction/reparse-point ancestors
  // otherwise defeat a purely lexical project/state overlap check.
  let existing = path.resolve(value);
  const missing = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  let resolved;
  try { resolved = path.join(fs.realpathSync.native(existing), ...missing); }
  catch { resolved = path.resolve(value); }
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

function pathsOverlap(left, right) {
  const a = pathKey(left);
  const b = pathKey(right);
  const aToB = path.relative(a, b);
  const bToA = path.relative(b, a);
  return a === b
    || (aToB !== '' && aToB !== '..' && !aToB.startsWith(`..${path.sep}`) && !path.isAbsolute(aToB))
    || (bToA !== '' && bToA !== '..' && !bToA.startsWith(`..${path.sep}`) && !path.isAbsolute(bToA));
}

function exactGraphFallback(graphResult, status, failureCode = undefined) {
  return {
    contract: GRAPH_ACE_CONSUMER_CONTRACT,
    status,
    ...(failureCode ? { failureCode } : {}),
    consumerResult: cloneGraphResult(graphResult),
    ace: null,
  };
}

function publicAceResult(result) {
  return {
    contract: result.contract,
    mode: result.mode,
    ...(result.reason ? { reason: result.reason } : {}),
    metrics: result.metrics,
    items: result.items.map((item) => ({
      id: item.id,
      classification: item.classification,
      disposition: item.disposition,
      digest: item.digest,
      reference: item.reference,
      provenance: item.provenance,
      ...(item.reason ? { reason: item.reason } : {}),
    })),
  };
}

export function nativeAceRunner(message, { signal, spawnChild = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, [fileURLToPath(new URL('./graph-integration-worker.js', import.meta.url))], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let settled = false;
    let response;
    let terminalError;
    let terminationTimer;
    const finish = (action, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      clearTimeout(terminationTimer);
      action(value);
    };
    const terminate = (error) => {
      if (settled) return;
      terminalError ??= error;
      if (terminationTimer === undefined) {
        terminationTimer = setTimeout(() => {
          finish(reject, new AceError(
            'ACE_TERMINATION_UNCONFIRMED',
            'optional ACE child did not confirm termination within the bounded grace period',
          ));
        }, TERMINATION_GRACE_MS);
      }
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch { /* bounded timer remains authoritative */ }
      }
    };
    const abort = () => terminate(new AceError('ACE_TIMEOUT', 'optional ACE operation timed out'));
    signal?.addEventListener('abort', abort, { once: true });
    child.once('message', (value) => { response = value; });
    child.once('error', terminate);
    child.once('close', (code, exitSignal) => {
      if (terminalError) {
        finish(reject, terminalError);
      } else if (code === 0 && response !== undefined) {
        finish(resolve, response);
      } else {
        finish(reject, new Error(`ACE worker exited with code ${code ?? 'null'} (${exitSignal ?? 'no signal'})`));
      }
    });
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      child.send(message, (error) => {
        if (error) terminate(error);
      });
    } catch (error) {
      terminate(error);
    }
  });
}

async function invokeBounded(runner, message, timeoutMs) {
  const controller = new AbortController();
  let timer;
  let terminationTimer;
  const termination = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => {
      terminationTimer = setTimeout(() => {
        reject(new AceError(
          'ACE_TERMINATION_UNCONFIRMED',
          'optional ACE operation did not confirm termination within the bounded grace period',
        ));
      }, TERMINATION_GRACE_MS);
    }, { once: true });
  });
  timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await Promise.race([
      Promise.resolve().then(() => runner(message, { signal: controller.signal })),
      termination,
    ]);
  } finally {
    clearTimeout(timer);
    clearTimeout(terminationTimer);
  }
}

export function deriveGraphAceIdentity({ projectRoot, sourceIdentity, consumerId } = {}) {
  const canonicalRoot = canonicalProjectRoot(projectRoot);
  const source = assertString(sourceIdentity, 'sourceIdentity', 512);
  const consumer = assertString(consumerId, 'consumerId', 512);
  return Object.freeze({
    ownerId: `graph-owner:${digest(`${canonicalRoot}\0${consumer}`)}`,
    sessionId: `graph-session:${digest(source)}`,
  });
}

/**
 * Optional Graph consumer. It never changes Graph itself: the caller supplies a
 * normal Graph executor, and the exact Graph result is the authoritative
 * fallback whenever ACE is disabled, unavailable, invalid, or timed out.
 */
export function createGraphAceConsumer(options = {}) {
  const enabled = options.enabled === true;
  if (options.enabled !== undefined && typeof options.enabled !== 'boolean') {
    throw new AceError('INVALID_INTEGRATION', 'enabled must be boolean');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new AceError('INVALID_INTEGRATION', `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }
  const runner = options.aceRunner ?? nativeAceRunner;
  if (typeof runner !== 'function') throw new AceError('INVALID_INTEGRATION', 'aceRunner must be a function');

  let stateDir;
  let ownerId;
  let sessionId;
  if (enabled) {
    stateDir = path.resolve(assertString(options.stateDir, 'stateDir', 32_767));
    if (!path.isAbsolute(options.stateDir)) {
      throw new AceError('UNSAFE_STATE_PATH', 'stateDir must be absolute');
    }
    ownerId = assertString(options.ownerId, 'ownerId', 512);
    sessionId = assertString(options.sessionId, 'sessionId', 512);
  }

  async function execute({ executeGraph, toolName, args = {}, projectRoot, sourceIdentity, budgetChars } = {}) {
    if (typeof executeGraph !== 'function') {
      throw new AceError('INVALID_INTEGRATION', 'executeGraph must be a function');
    }
    const tool = assertString(toolName, 'toolName', 256);
    const graphResult = cloneGraphResult(await executeGraph(tool, args));

    if (!enabled) return exactGraphFallback(graphResult, 'disabled');
    if (graphResult.isError === true) return exactGraphFallback(graphResult, 'graph-error');
    let root;
    let source;
    try {
      root = canonicalProjectRoot(projectRoot);
      source = assertString(sourceIdentity, 'sourceIdentity', 512);
    } catch (error) {
      return exactGraphFallback(
        graphResult,
        'fallback',
        error instanceof AceError ? error.code : 'INVALID_INTEGRATION',
      );
    }
    if (pathsOverlap(root, stateDir)) {
      return exactGraphFallback(graphResult, 'fallback', 'UNSAFE_STATE_PATH');
    }

    const classification = classificationFor(tool);
    // ACE deliberately preserves protected Graph output byte-for-byte. Starting
    // a worker for those tools can only add latency/state and cannot reduce the
    // returned context, so keep the authoritative Graph result inline.
    if (classification !== 'normal') {
      return exactGraphFallback(graphResult, 'bypassed');
    }
    let queryIdentity;
    try {
      const encodedQuery = JSON.stringify({ toolName: tool, args });
      if (encodedQuery === undefined || Buffer.byteLength(encodedQuery, 'utf8') > 1_048_576) {
        return exactGraphFallback(graphResult, 'fallback', 'INVALID_INTEGRATION');
      }
      queryIdentity = digest(encodedQuery);
    } catch {
      return exactGraphFallback(graphResult, 'fallback', 'INVALID_INTEGRATION');
    }
    const request = {
      contract: ACE_INTEGRATION_CONTRACT,
      component: 'graph',
      stateDir,
      ownerId,
      sessionId,
      ...(budgetChars === undefined ? {} : { budgetChars }),
      segments: graphResult.content.map((item, index) => ({
        id: `graph-${index + 1}`,
        content: item.text,
        classification,
        provenance: {
          contract: GRAPH_ACE_CONSUMER_CONTRACT,
          toolName: tool,
          projectRoot: root,
          sourceIdentity: source,
          queryIdentity,
          contentIndex: index,
          graphResultComplete: true,
          ...(classification === 'source-evidence' ? { exactSource: true } : {}),
        },
      })),
    };

    let response;
    try {
      response = await invokeBounded(runner, { operation: 'reduce', request }, timeoutMs);
    } catch (error) {
      if (error instanceof AceError && error.code === 'ACE_TERMINATION_UNCONFIRMED') throw error;
      const code = error instanceof AceError ? error.code : 'ACE_UNAVAILABLE';
      return exactGraphFallback(graphResult, 'fallback', code);
    }
    if (!response || typeof response !== 'object') {
      return exactGraphFallback(graphResult, 'fallback', 'INVALID_ACE_RESULT');
    }
    if (response.status === 'fallback') {
      // This request was constructed from a validated, complete Graph result.
      // If ACE cannot prove its fallback complete, use that retained result;
      // never expose the adapter's partial or empty rendering.
      return exactGraphFallback(graphResult, 'fallback', response.failureCode ?? 'ACE_UNAVAILABLE');
    }
    if (response.status !== 'optimized') {
      return exactGraphFallback(graphResult, 'fallback', 'INVALID_ACE_RESULT');
    }
    const result = response.result;
    if (!result || result.contract !== 'ace.result/v1' || typeof result.renderedContext !== 'string' || !Array.isArray(result.items)
      || !result.items.every((item) => item && typeof item === 'object' && typeof item.id === 'string'
        && typeof item.classification === 'string' && typeof item.disposition === 'string' && typeof item.digest === 'string')) {
      return exactGraphFallback(graphResult, 'fallback', 'INVALID_ACE_RESULT');
    }
    try {
      return {
        contract: GRAPH_ACE_CONSUMER_CONTRACT,
        status: 'optimized',
        consumerResult: { ...graphResult, content: [{ type: 'text', text: result.renderedContext }] },
        ace: publicAceResult(result),
      };
    } catch {
      return exactGraphFallback(graphResult, 'fallback', 'INVALID_ACE_RESULT');
    }
  }

  async function recover(reference) {
    if (!enabled) throw new AceError('ACE_DISABLED', 'ACE recovery is unavailable while integration is disabled');
    const value = assertString(reference, 'reference');
    const response = await invokeBounded(runner, {
      operation: 'retrieve',
      stateDir,
      ownerId,
      sessionId,
      reference: value,
    }, timeoutMs);
    if (!response || response.status !== 'recovered' || !response.record || typeof response.record.content !== 'string') {
      const error = new AceError(response?.failureCode ?? 'RECOVERY_FAILED', response?.message ?? 'ACE recovery failed closed');
      throw error;
    }
    if (digest(response.record.content) !== response.record.digest) {
      throw new AceError('CONTENT_INTEGRITY', 'recovered original digest mismatch');
    }
    return response.record;
  }

  return Object.freeze({ contract: GRAPH_ACE_CONSUMER_CONTRACT, enabled, execute, recover });
}
