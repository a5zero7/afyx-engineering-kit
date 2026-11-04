/** Pure, provider-neutral Afyx-first tool-family decision. No I/O or tool execution. */
export const AFYX_TOOL_FAMILY_ROUTING_CONTRACT = 'AfyxToolFamilyRouting/v1';
const OWNERS = new Set(['AFYX', 'EXTERNAL']);
function invalid(message) {
  const error = new TypeError(message);
  error.code = 'INVALID_TOOL_ROUTING_INPUT';
  return error;
}
function text(value) {
  return typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f]/u.test(value);
}
function candidateValid(c, i) {
  if (!c || typeof c !== 'object' || Array.isArray(c) ||
      !text(c.id) || !text(c.surface) || !OWNERS.has(c.ownership)) {
    throw invalid('candidate ' + i + ' invalid identity or ownership');
  }
  if (!Array.isArray(c.capabilities) || c.capabilities.some((v) => !text(v))) {
    throw invalid('candidate ' + i + ' invalid capabilities');
  }
  for (const field of ['installed','enabled','reachable','healthy','authorized','compatible']) {
    if (typeof c[field] !== 'boolean') throw invalid('candidate ' + i + ' missing verified ' + field);
  }
  if (typeof c.fresh !== 'boolean') {
    throw invalid('candidate ' + i + ' invalid freshness');
  }
}
/**
 * Caller must verify status/permissions independently for each MCP/CLI surface.
 * Returns a decision, never probes/installs/executes a host tool.
 * Inputs: {intent:'exact-source'|'capability', capability, candidates[],
 *          allowExternalFallback?:boolean}.
 */
export function resolveAfyxToolFamilyRoute(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw invalid('invalid configuration');
  const {intent, capability, candidates, allowExternalFallback = false} = config;
  if (!['exact-source','capability'].includes(intent) || !text(capability) || !Array.isArray(candidates) ||
      typeof allowExternalFallback !== 'boolean') throw invalid('invalid routing fields');
  candidates.forEach(candidateValid);
  const seen = new Set();
  for (const c of candidates) {
    const key = c.id + ':' + c.surface;
    if (seen.has(key)) throw invalid('duplicate candidate surface');
    seen.add(key);
  }
  function decision(route, reason, item = null) {
    return Object.freeze({contract: AFYX_TOOL_FAMILY_ROUTING_CONTRACT, capability,
      route, reason, toolId: item?.id ?? null, surface: item?.surface ?? null,
      externalFallbackAuthorized: allowExternalFallback,
      observationSource: 'CALLER_VERIFIED'});
  }
  // Exact known-source operations need not incur graph/context tool overhead.
  if (intent === 'exact-source') return decision('DIRECT_SOURCE', 'EXACT_SOURCE');
  const usable = candidates.filter((c) =>
    c.capabilities.includes(capability) && c.installed && c.enabled &&
    c.reachable && c.healthy && c.authorized && c.compatible && c.fresh
  ).sort((a,b) => a.id.localeCompare(b.id) || a.surface.localeCompare(b.surface));
  const native = usable.find((c) => c.ownership === 'AFYX');
  if (native) return decision('AFYX', 'NATIVE_READY', native);
  if (allowExternalFallback) {
    const fallback = usable.find((c) => c.ownership === 'EXTERNAL');
    if (fallback) return decision('EXTERNAL', 'EXTERNAL_EXPLICITLY_ALLOWED', fallback);
  }
  return decision('DIRECT_SOURCE', 'NO_AUTHORIZED_COMPATIBLE_TOOL');
}
