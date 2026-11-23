import { ACE_LIMITS, AfyxContextEngine, validateContextRequest } from './engine.js';
import { AceError } from './errors.js';

export const ACE_INTEGRATION_CONTRACT = 'ace.integration/v1';
export const SUPPORTED_COMPONENTS = Object.freeze(['graph', 'engineering-expert', 'forge', 'kit']);

function readOriginalInput(request) {
  try {
    return request && typeof request === 'object' ? request.segments : undefined;
  } catch {
    return undefined;
  }
}

function renderOriginal(input) {
  if (typeof input === 'string') return { renderedContext: input, complete: true };
  if (!Array.isArray(input)) return { renderedContext: '', complete: input === undefined };
  const rendered = [];
  let renderedBytes = 0;
  let complete = true;
  try {
    for (let index = 0; index < input.length; index += 1) {
      const segment = input[index];
      let value;
      if (typeof segment === 'string') {
        value = `[segment-${index + 1}] normal\n${segment}`;
      } else if (segment && typeof segment === 'object' && typeof segment.content === 'string') {
        const id = typeof segment.id === 'string' && segment.id.length > 0 ? segment.id : `segment-${index + 1}`;
        const classification = typeof segment.classification === 'string' ? segment.classification : 'normal';
        value = `[${id}] ${classification}\n${segment.content}`;
      } else {
        complete = false;
        continue;
      }
      renderedBytes += Buffer.byteLength(value, 'utf8') + (rendered.length === 0 ? 0 : 2);
      if (renderedBytes > ACE_LIMITS.maxRequestBytes) {
        return { renderedContext: '', complete: false };
      }
      rendered.push(value);
    }
  } catch {
    return { renderedContext: '', complete: false };
  }
  return { renderedContext: rendered.join('\n\n'), complete };
}

function fallback(request, failureCode) {
  const originalInput = readOriginalInput(request);
  const rendered = renderOriginal(originalInput);
  return {
    status: 'fallback',
    failureCode,
    renderedContext: rendered.renderedContext,
    originalInput,
    originalComplete: rendered.complete,
  };
}

/**
 * Optional, dependency-inverted adapter. The caller owns lifecycle and can
 * continue with `renderedContext` even when ACE is absent or fails.
 */
export function createOptionalIntegrationAdapter({ component, createEngine = (options) => new AfyxContextEngine(options) } = {}) {
  if (!SUPPORTED_COMPONENTS.includes(component)) {
    throw new AceError('INVALID_INTEGRATION', `unsupported optional component: ${component}`);
  }
  return {
    contract: ACE_INTEGRATION_CONTRACT,
    component,
    process(request) {
      try {
        if (!request || typeof request !== 'object' || request.contract !== ACE_INTEGRATION_CONTRACT) {
          throw new AceError('INVALID_INTEGRATION', `request contract must be ${ACE_INTEGRATION_CONTRACT}`);
        }
        if (request.component !== component) {
          throw new AceError('INVALID_INTEGRATION', `request component must be ${component}`);
        }
        validateContextRequest(request);
        const engine = createEngine({ stateDir: request.stateDir, ownerId: request.ownerId, sessionId: request.sessionId });
        const result = engine.reduce(request);
        return { status: 'optimized', result, renderedContext: result.renderedContext };
      } catch (error) {
        return fallback(request, error instanceof AceError ? error.code : 'ACE_UNAVAILABLE');
      }
    },
  };
}
