/** Bounded, read-only disclosure for the existing Engineering Expert host adapter. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const MAX_REFERENCES = 3;
const MAX_CONTEXT_BYTES = 32_768;
// Domain IDs are the native SKILL.md core routing table's reference names.
// Signals select guidance; they do not assert domain facts or grant permission.
const DOMAINS = [
  ['erp-technical-specialist', /\b(?:odoo|erp|purchase request|rfqs?|alur bisnis)\b/i, /\b(?:company|quantity|concurrency|perusahaan)\b/i],
  ['solutions-architect', /\b(?:architecture|arsitektur|system design|desain sistem|multi-tenant)\b/i, /\b(?:integration|integrasi|tradeoffs?|alternatives?)\b/i],
  ['cybersecurity-devsecops', /\b(?:threat[- ]model|security (?:design|review)|keamanan|ancaman)\b/i, /\b(?:isolation|permissions?|authorization|audit|secrets?|otorisasi)\b/i],
  ['database-administrator', /\b(?:database|schema|sql|basis data)\b/i, /\b(?:storage|backups?|consistency|penyimpanan)\b/i],
  ['site-reliability-engineer', /\b(?:incident|reliability|availability|failover|insiden|keandalan)\b/i, /\b(?:recovery|observability|pemulihan)\b/i],
  ['ai-ml-engineer', /\b(?:machine learning|model evaluation|data pipeline|inference|pembelajaran mesin)\b/i, /\b(?:evaluation|evaluasi|training)\b/i],
  ['business-analyst', /\b(?:business (?:rules|requirements|process)|aturan bisnis|proses bisnis)\b/i, /\b(?:process|requirements|invariants|persyaratan|proses)\b/i],
  ['system-analyst', /\b(?:system requirements|system analysis|analisis sistem|spesifikasi sistem)\b/i, /\b(?:ambiguities|approval|organization|interactions|kebutuhan)\b/i],
  ['product-manager', /\b(?:product (?:outcome|strategy|discovery)|roadmap|prioritization|strategi produk)\b/i, /\b(?:product|prioritas)\b/i],
  ['ui-ux-designer', /\b(?:interaction design|accessibility|user experience|desain interaksi|aksesibilitas)\b/i, /\b(?:ux|ui|flows)\b/i],
  ['software-engineer', /\b(?:refactoring|debugging|application coding|implementasi|pemrograman)\b/i, /\b(?:code|module|implementation|kode|modul)\b/i],
  ['qa-engineer', /\b(?:test strategy|regression|strategi pengujian)\b/i, /\b(?:tests?|acceptance|verifikasi|penerimaan)\b/i],
  ['subject-matter-expert', /\b(?:domain-specific|regulations|regulated|regulasi)\b/i, /\b(?:domain|operations)\b/i],
];

function boundedLimit(value, ceiling) {
  if (value === undefined) return ceiling;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('EXPERT_INVALID_HOST_BUDGET');
  return Math.min(value, ceiling);
}

function selectGuidance(request) {
  const payload = request.payload ?? {};
  const parts = [request.intent, typeof request.payload === 'string' ? request.payload : null,
    payload.intent, payload.description, payload.prompt, payload.title];
  const text = parts.filter((part) => typeof part === 'string').join('\n');
  if (text.length > 65_536) throw new Error('EXPERT_TASK_TOO_LARGE');
  // A prohibited operation (e.g. "Do not access a database") is not a
  // request to load that domain. Original instructions remain unchanged.
  const routingText = text.replace(/(?:^|[.!?\n])\s*(?:do not|don't|never|jangan|dilarang|tidak boleh|tidak diizinkan)\b[^.!?\n]*/gi, ' ');
  const odoo = /\bodoo\b/i.test(text);
  const crossDomain = /\b(?:architecture|arsitektur|threat[- ]model|security (?:review|audit)|process|workflow|purchase request|rfqs?|multi-company|proses|alur|risiko)\b/i.test(routingText);
  const syntax = /\b(?:reverse (?:a |an? )?python list|reverse (?:a )?list|simple (?:python |programming )?syntax|balik(?:kan)? (?:daftar|list))\b/i.test(text);
  if (syntax || (odoo && !crossDomain) || (payload.exactKnownSource === true && !crossDomain)) {
    return { reason: 'DIRECT_SOURCE_OR_SPECIALIST_ONLY', selected: [], odoo: false, workflow: null };
  }
  const ranked = DOMAINS.map(([id, strong, weak], order) => ({ id, order,
    score: (strong.test(routingText) ? 4 : 0) + (weak.test(routingText) ? 1 : 0) }));
  if (!ranked.some((domain) => domain.score > 0) && ['architecture', 'system-design'].includes(request.taskType)) {
    ranked.find((domain) => domain.id === 'solutions-architect').score += 1;
  }
  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  const selected = ranked.filter((domain) => domain.score > 0);
  const expertTask = ['architecture', 'system-design', 'multi-disciplinary', 'general-engineering'].includes(request.taskType);
  if (!selected.length && !expertTask) return { reason: 'NO_EXPERT_SIGNAL', selected: [], odoo: false, workflow: null };
  const unknown = selected.length === 0;
  if (unknown) selected.push({ id: 'subject-matter-expert', score: 0 });
  const workflow = /\b(?:process|workflow|purchase request|rfqs?|proses|alur)\b/i.test(text)
    && selected[0].id === 'erp-technical-specialist' ? 'workflows/ai-data-erp.md' : null;
  const odooDenied = /\b(?:do not|don't|never|jangan|dilarang|tidak boleh|tidak diizinkan)\b[^\n.]{0,80}\bodoo\b|\bodoo\s*(?:=\s*0|off)\b/i.test(text);
  return { reason: unknown ? 'UNKNOWN_DOMAIN_REQUIRES_VALIDATION' : 'TASK_SIGNAL_MATCH', selected,
    odoo: odoo && !odooDenied, workflow, unknown };
}

function documentPath(root, name) {
  // Only internal allowlisted names reach this function; reject links at every
  // component as well as paths that leave the trusted installed skill root.
  let current = root;
  for (const part of name.split('/')) {
    if (!part || part === '.' || part === '..') throw new Error('EXPERT_UNSAFE_REFERENCE_PATH');
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('EXPERT_UNSAFE_REFERENCE_PATH');
  }
  const real = realpathSync(current);
  const scoped = relative(root, real);
  if (isAbsolute(scoped) || scoped === '..' || scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('EXPERT_UNSAFE_REFERENCE_PATH');
  }
  const stat = lstatSync(current);
  if (!stat.isFile()) throw new Error('EXPERT_REFERENCE_NOT_FILE');
  return { absolute: current, size: stat.size };
}

/** Host options can lower ceilings; task JSON cannot select paths or raise budgets. */
export function loadExpertGuidance({ skillRoot, request = {}, hostOptions = {} } = {}) {
  try {
    if (request.permissions?.authorized === false) throw new Error('EXPERT_PERMISSION_DENIED');
    const maxReferences = boundedLimit(hostOptions.maxReferences, MAX_REFERENCES);
    const maxContextBytes = Math.min(boundedLimit(hostOptions.maxContextBytes, MAX_CONTEXT_BYTES),
      boundedLimit(request.budgetLimits?.maxContextBytes, MAX_CONTEXT_BYTES));
    const routing = selectGuidance(request);
    if (!routing.selected.length) {
      const output = { authority: 'cross-disciplinary-expertise', mode: 'NOT_APPLICABLE', reason: routing.reason,
        primaryDomain: null, supportingDomains: [], references: [], telemetry: {
          evidenceStatus: 'NO_SKILL_READS', loadedPaths: [], referenceReads: 0, bytesRead: 0,
          providerTokens: null, agentLatencyMs: null,
        } };
      const contextBytes = Buffer.byteLength(JSON.stringify(output));
      if (contextBytes > maxContextBytes) throw new Error('EXPERT_CONTEXT_BUDGET_EXCEEDED');
      return { status: 'SUCCESS', output, contextBytes, evidence: [], followUpRequests: [] };
    }
    if (typeof skillRoot !== 'string' || !skillRoot || lstatSync(resolve(skillRoot)).isSymbolicLink()) {
      throw new Error('EXPERT_UNSAFE_SKILL_ROOT');
    }
    const root = realpathSync(resolve(skillRoot));
    const selected = routing.selected.slice(0, maxReferences);
    const names = ['SKILL.md', ...selected.map(({ id }) => `references/${id}.md`), ...(routing.workflow ? [routing.workflow] : [])];
    const paths = names.map((name) => ({ name, ...documentPath(root, name) }));
    if (paths.reduce((total, item) => total + item.size, 0) > maxContextBytes) throw new Error('EXPERT_CONTEXT_BUDGET_EXCEEDED');
    const documents = paths.map(({ name, absolute }) => {
      const bytes = readFileSync(absolute);
      if (bytes.length > maxContextBytes) throw new Error('EXPERT_CONTEXT_BUDGET_EXCEEDED');
      return { path: name, content: bytes.toString('utf8'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
    const output = {
      authority: 'cross-disciplinary-expertise', mode: 'ASSISTIVE_GUIDANCE_ONLY', reason: routing.reason,
      selectionAssurance: 'REQUEST_SIGNAL_HINTS_NOT_DOMAIN_VERIFICATION',
      expertGuidance: documents[0].content,
      primaryDomain: selected[0].id, supportingDomains: selected.slice(1).map(({ id }) => id),
      references: documents.filter((item) => item.path.startsWith('references/')),
      workflows: documents.filter((item) => item.path.startsWith('workflows/')),
      clarificationRequired: Boolean(routing.unknown),
      deferredDomains: routing.selected.slice(maxReferences).map(({ id }) => id),
      budget: { maxReferences, maxContextBytes },
      telemetry: { evidenceStatus: 'OBSERVED_SKILL_READS_ONLY', loadedPaths: documents.map((item) => item.path),
        referenceReads: selected.length, bytesRead: documents.reduce((total, item) => total + item.bytes, 0),
        providerTokens: null, agentLatencyMs: null },
    };
    const contextBytes = Buffer.byteLength(JSON.stringify(output));
    if (contextBytes > maxContextBytes) throw new Error('EXPERT_CONTEXT_BUDGET_EXCEEDED');
    return { status: 'SUCCESS', output, contextBytes,
      evidence: [{ kind: 'skill-manifest', path: join(root, 'SKILL.md'), sha256: documents[0].sha256 },
        { kind: 'skill-size-bytes', value: documents[0].bytes },
        ...documents.map(({ content, ...receipt }) => ({ kind: 'skill-document', ...receipt }))],
      followUpRequests: routing.odoo ? [{ targetComponentId: 'odoo-engineering',
        invocationReason: 'Odoo Engineering retains release-specific authority; Expert provides cross-disciplinary framing only' }] : [] };
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? 'EXPERT_SKILL_OR_REFERENCE_NOT_FOUND'
      : /^EXPERT_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'EXPERT_GUIDANCE_READ_FAILED';
    return { status: 'FAILED', reason, output: null, evidence: [], followUpRequests: [] };
  }
}
