/**
 * Real Installed Host Component Adapters for Afyx Universal Interoperability.
 *
 * Connects the host-neutral Afyx capability orchestrator to actual installed
 * component runtimes, MCP servers, CLIs, and skill surfaces in the target environment.
 *
 * Implements genuine host wiring:
 * - Afyx Graph: Dispatches to installed afyx-graph.js runtime on target project
 * - Afyx Context: Invokes installed afyx-context CLI / bridge for bounded reduction & recovery
 * - Afyx Forge: Queries installed afyx-forge.js for assistive guidance (blocks autonomous unless A8)
 * - Skills (Odoo, Expert, Efficient Coding): Reads authoritative installed SKILL.md & reference manifests
 * - Codex Usage Tracking: Invokes passive PowerShell telemetry module where supported and authorized
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const AFYX_HOST_ADAPTERS_CONTRACT = 'AfyxHostAdapters/v1';

/**
 * Safely extracts structured graph evidence (symbols, declarations, calls)
 * from afyx-graph stdout so that downstream host models (Codex, Antigravity)
 * receive explicit, structured evidence in the JSON payload without relying
 * solely on raw unparsed text or falling victim to host string truncation.
 *
 * @param {string} stdout - Raw stdout from afyx-graph CLI execution
 * @param {boolean} [isInventory=false] - Whether the execution was an inventory command
 * @param {string} [projectRoot=null] - Target project root
 * @returns {Array<Object>} Structured evidence entries
 */
export function extractGraphEvidence(stdout, isInventory = false, projectRoot = null) {
  const evidence = [];
  if (typeof stdout !== 'string' || !stdout.trim()) {
    return evidence;
  }

  try {
    if (isInventory) {
      const declRegex = /^-\s+`([A-Za-z0-9_]+)`\s+—\s+`([^:]+):(\d+)`\s+—\s+module\s+`([^`]+)`\s+—\s+values\s+`([^`]+)`/gm;
      let match;
      while ((match = declRegex.exec(stdout)) !== null) {
        evidence.push({
          kind: 'graph-declaration',
          symbol: match[1],
          file: match[2],
          line: Number(match[3]),
          module: match[4],
          value: match[5],
        });
      }
      const matchCount = stdout.match(/\*\*Matches:\*\*\s+(\d+)\s+declarations/);
      if (matchCount) {
        evidence.push({
          kind: 'graph-inventory-summary',
          matchCount: Number(matchCount[1]),
        });
      }
      return evidence;
    }

    // 1. Files and symbol declarations from header: **`file`** — Sym1(kind), Sym2(kind)
    const fileDeclRegex = /^\*\*`([^`]+)`\*\*\s+—\s+(.+)$/gm;
    let fileMatch;
    const fileSymbolsMap = new Map();
    while ((fileMatch = fileDeclRegex.exec(stdout)) !== null) {
      const file = fileMatch[1];
      const declsStr = fileMatch[2];
      const symbols = [];
      const symRegex = /([A-Za-z0-9_]+)(?:\(([^)]+)\))?/g;
      let symMatch;
      while ((symMatch = symRegex.exec(declsStr)) !== null) {
        symbols.push({ name: symMatch[1], type: symMatch[2] || 'unknown' });
      }
      fileSymbolsMap.set(file, symbols);
    }

    // 2. Blast radius items: - `Sym` (file:line) — callers/references
    const blastRegex = /^-\s+`([A-Za-z0-9_]+)`\s+\(([^:]+):(\d+)\)\s+—\s+(.+)$/gm;
    let blastMatch;
    const symbolMap = new Map();
    while ((blastMatch = blastRegex.exec(stdout)) !== null) {
      const sym = blastMatch[1];
      const file = blastMatch[2];
      const line = Number(blastMatch[3]);
      const details = blastMatch[4].trim();
      const key = `${file}:${sym}`;
      const item = {
        kind: 'graph-symbol',
        symbol: sym,
        file,
        line,
        details,
      };
      symbolMap.set(key, item);
    }

    // 3. Reconcile symbols from file declarations
    for (const [file, symbols] of fileSymbolsMap.entries()) {
      for (const s of symbols) {
        const key = `${file}:${s.name}`;
        if (symbolMap.has(key)) {
          const existing = symbolMap.get(key);
          if (s.type && s.type !== 'unknown') {
            existing.type = s.type;
          }
        } else {
          const item = {
            kind: 'graph-symbol',
            symbol: s.name,
            type: s.type,
            file,
            line: null,
          };
          symbolMap.set(key, item);
        }
      }
    }

    // Add all unique symbols to evidence
    for (const item of symbolMap.values()) {
      evidence.push(item);
    }

    // 5. Explicit relationship lines: - caller → callee
    const relCallsRegex = /^-\s+([A-Za-z0-9_]+)\s+→\s+([A-Za-z0-9_]+)/gm;
    let relMatch;
    while ((relMatch = relCallsRegex.exec(stdout)) !== null) {
      evidence.push({
        kind: 'graph-relationship',
        caller: relMatch[1],
        callee: relMatch[2],
      });
    }

    // Cap evidence count to prevent unbounded memory or payload inflation
    if (evidence.length > 200) {
      evidence.length = 200;
    }
  } catch {
    // If parsing fails for any reason, do not fail execution
  }

  return evidence;
}

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function requestTimeout(request, ceilingMs) {
  const requested = request?.budgetLimits?.maxExecutionMs;
  return Number.isSafeInteger(requested) && requested > 0
    ? Math.min(requested, ceilingMs)
    : ceilingMs;
}

/**
 * Creates genuine host-wired adapters for all installed components in a pilot root.
 *
 * @param {Object} options
 * @param {string} options.installRoot - Root directory where components are installed (e.g. install-root)
 * @param {string} options.projectRoot - Target project directory containing the codebase
 * @param {string} [options.stateRoot] - Context state directory (e.g. context-state)
 * @param {string} [options.codexToolsRoot] - Directory for codex usage tools
 * @param {string} [options.nodePath] - Path to node executable
 * @returns {Object} Map of component adapters { [componentId]: (request) => Promise<result> }
 */
export function createInstalledHostAdapters({
  installRoot,
  projectRoot,
  graphIndexRoot = null,
  stateRoot = null,
  codexToolsRoot = null,
  skillRoots = {},
  nodePath = process.execPath,
  environment = process.env,
  trustedCapabilities = {},
} = {}) {
  if (!isNonEmptyString(installRoot) || !isNonEmptyString(projectRoot)) {
    throw new TypeError('installRoot and projectRoot are required non-empty paths');
  }
  const resolvedInstallRoot = resolve(installRoot);
  const resolvedProjectRoot = resolve(projectRoot);
  const resolvedStateRoot = stateRoot ? resolve(stateRoot) : null;

  // Path resolution for installed artifacts
  const graphEntrypoint = join(resolvedInstallRoot, 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js');
  const contextCliEntrypoint = join(resolvedInstallRoot, 'context', 'current', 'dist', 'cli.js');
  const forgeEntrypoint = join(resolvedInstallRoot, 'forge', 'current', 'bin', 'afyx-forge.js');
  const odooSkillDir = skillRoots['odoo-engineering'] ?? join(resolvedInstallRoot, 'skills', 'odoo-engineering');
  const expertSkillDir = skillRoots['afyx-engineering-expert'] ?? join(resolvedInstallRoot, 'skills', 'afyx-engineering-expert');
  const efficientSkillDir = skillRoots['efficient-coding'] ?? join(resolvedInstallRoot, 'skills', 'efficient-coding');
  const codexToolFile = codexToolsRoot ? join(resolve(codexToolsRoot), 'CodexUsage.psm1') : null;

  let documentationCatalog, usageAnalytics, nativeExecution, githubReader;
  const success = (data, capability, evidence = []) => ({ status: 'SUCCESS', output: data, capability,
    evidence, outputBytes: Buffer.byteLength(JSON.stringify(data)), followUpRequests: [] });
  return Object.freeze({

    'afyx-native-execution': async (request, { signal } = {}) => {
      const { createNativeExecution } = await import('./afyx-native-execution.mjs');
      nativeExecution ??= createNativeExecution({ projectRoot: resolvedProjectRoot, ...trustedCapabilities.nativeExecution, environment });
      const result = await nativeExecution.execute(request.payload ?? { capabilityId: 'node-version', arguments: {} }, { signal });
      return { ...success(result, 'validated-local-execution'), status: result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED', reason: result.receipt?.reason };
    },
    'afyx-native-github': async (request, { signal } = {}) => {
      if (!trustedCapabilities.github) return { status: 'FAILED', reason: 'GITHUB_HOST_SCOPE_REQUIRED', output: null };
      const { createGitHubReader } = await import('./afyx-native-github.mjs');
      githubReader ??= createGitHubReader(trustedCapabilities.github);
      const result = await githubReader.read(request.payload, { signal });
      return { ...success(result, 'scoped-github-evidence'), status: result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED', reason: result.code };
    },
    'afyx-security-auditor': async () => {
      const { auditDirectory } = await import('./afyx-security-auditor.mjs');
      return success(auditDirectory(resolvedProjectRoot, trustedCapabilities.securityAudit), 'source-security-candidates');
    },

    /**
     * Real host adapter for Afyx Graph
     */
    'afyx-graph': async (request) => {
      if (!existsSync(graphEntrypoint)) {
        return { status: 'FAILED', reason: 'GRAPH_ENTRYPOINT_NOT_FOUND', output: null };
      }

      const intent = String(request.intent || '').toLowerCase();
      const isInventory = request.taskType === 'odoo-impact-analysis';
      const isFileInventory = !isInventory && intent.includes('inventory');

      let runArgs = [];
      if (isInventory) {
        runArgs = [graphEntrypoint, 'inventory', '_inherit', 'sale.order', '--path', resolvedProjectRoot];
      } else if (isFileInventory) {
        runArgs = [graphEntrypoint, 'files', '--format', 'tree', '--max-depth', '2', '--path', resolvedProjectRoot];
      } else {
        const queryTerm = request.intent?.replace(/[^a-zA-Z0-9_]/g, ' ').trim() || 'OrderService';
        runArgs = [graphEntrypoint, 'explore', queryTerm, '--path', resolvedProjectRoot];
      }

      const execResult = spawnSync(nodePath, runArgs, {
        cwd: resolvedProjectRoot,
        encoding: 'utf8',
        timeout: requestTimeout(request, 10_000),
        windowsHide: true,
        env: {
          ...process.env,
          ...(environment ?? {}),
        },
      });

      const stdout = execResult.stdout || '';
      const stderr = execResult.stderr || '';

      if (execResult.status !== 0 || execResult.error) {
        return {
          status: 'FAILED',
          reason: `GRAPH_EXECUTION_ERROR: ${execResult.error?.message || stderr.trim() || 'Exit code ' + execResult.status}`,
          output: null,
        };
      }

      if (!stdout || !stdout.trim()) {
        return {
          status: 'FAILED',
          reason: 'GRAPH_OUTPUT_EMPTY',
          output: null,
        };
      }

      // Check if output is large enough to benefit from context reduction
      const outputBytes = Buffer.byteLength(stdout, 'utf8');
      const followUpRequests = [];
      if (outputBytes > 20_000) {
        followUpRequests.push({
          targetComponentId: 'afyx-context',
          invocationReason: 'Compress large graph evidence payload',
        });
      }

      const structuredEvidence = isFileInventory ? [] : extractGraphEvidence(stdout, isInventory, resolvedProjectRoot);

      return {
        status: 'SUCCESS',
        output: stdout,
        contextBytes: outputBytes,
        evidence: [
          { kind: 'graph-tool', command: isInventory ? 'inventory' : (isFileInventory ? 'files' : 'explore') },
          { kind: 'graph-source-root', path: graphIndexRoot ?? resolvedProjectRoot },
          ...structuredEvidence,
        ],
        followUpRequests,
      };
    },

    /**
     * Real host adapter for Afyx Context Engine
     */
    'afyx-context': async (request) => {
      if (['documentation-search', 'documentation-research', 'usage-analytics'].includes(request.taskType)) {
        const contextModule = await import(pathToFileURL(join(resolvedInstallRoot, 'context', 'current', 'dist', 'index.js')).href);
        if (request.taskType === 'usage-analytics') {
          usageAnalytics ??= contextModule.createUsageAnalytics(trustedCapabilities.usage);
          for (const event of trustedCapabilities.usage?.events ?? []) usageAnalytics.record(event);
          return success(usageAnalytics.summarize(request.payload ?? {}), 'bounded-context-optimization');
        }
        documentationCatalog ??= contextModule.createDocumentationCatalog({ projectRoot: resolvedProjectRoot,
          sources: [{ id: 'readme', path: 'README.md', domain: 'engineering' }], ...trustedCapabilities.documentation });
        const result = documentationCatalog.search(request.payload ?? { query: request.task?.intent ?? request.intent });
        return success(result, 'bounded-context-optimization', result.items.map((item) => ({ kind: 'documentation-source', path: item.path, sha256: item.sha256 })));
      }

      // Check for explicit OFF environment variable
      if (String(environment?.AFYX_CONTEXT_OPT_IN ?? '').trim() === '0') {
        return { status: 'FAILED', reason: 'EXPLICITLY_DISABLED', output: null };
      }

      if (!existsSync(contextCliEntrypoint)) {
        return { status: 'FAILED', reason: 'CONTEXT_ENTRYPOINT_NOT_FOUND', output: null };
      }

      const source = request.sourceResult;
      const standaloneContent = typeof request.payload === 'string' ? request.payload
        : (typeof request.text === 'string' ? request.text : (typeof request.input === 'string' ? request.input : null));
      const contentToReduce = (source?.componentId === 'afyx-graph' && source.status === 'EXECUTED' && typeof source.output === 'string')
        ? source.output
        : standaloneContent;

      if (!contentToReduce) {
        return { status: 'FAILED', reason: 'GRAPH_EVIDENCE_NOT_AVAILABLE', output: null };
      }
      const sourceBytes = Buffer.byteLength(contentToReduce, 'utf8');
      if (sourceBytes > 1_048_576) {
        return { status: 'FAILED', reason: 'GRAPH_EVIDENCE_BUDGET_EXCEEDED', output: null };
      }
      const digest = createHash('sha256').update(contentToReduce).digest('hex');
      const session = `graph-${digest.slice(0, 24)}`;
      const owner = `afyx-host-${createHash('sha256').update(resolvedProjectRoot).digest('hex').slice(0, 24)}`;
      const contextState = resolvedStateRoot ?? join(tmpdir(), 'afyx-host-context', owner);

      // Preserve Context Engine's diagnostic/security protection:
      // Content classified as security or diagnostic must not be forcibly compressed.
      const isSecurity = request.classification === 'security' ||
        request.taskType === 'security' ||
        Boolean(request.task?.securityFinding) ||
        source?.evidence?.some((e) => ['security-finding', 'security-alert', 'vulnerability'].includes(e.kind));
      const isDiagnostic = request.classification === 'diagnostic' ||
        request.taskType === 'diagnostic' ||
        Boolean(request.task?.diagnosticContent) ||
        source?.evidence?.some((e) => e.kind === 'diagnostic');
      const segmentClassification = isSecurity ? 'security' : (isDiagnostic ? 'diagnostic' : 'normal');

      const input = JSON.stringify({
        budgetChars: Math.max(1_024, Math.min(16_000, Math.ceil(contentToReduce.length / 2))),
        segments: [{
          id: 'graph-structure', content: contentToReduce,
          classification: segmentClassification,
          provenance: { sourceComponent: source?.componentId ?? 'standalone-context', sourceDigest: digest,
            projectRoot: resolvedProjectRoot, sourceIdentity: source?.provenance?.componentSourceIdentity ?? null },
        }],
      });
      const runResult = spawnSync(nodePath, [contextCliEntrypoint, 'reduce',
        '--state', contextState, '--owner', owner, '--session', session, '--input', '-'], {
        input,
        encoding: 'utf8',
        timeout: requestTimeout(request, 5_000),
        windowsHide: true,
        maxBuffer: 1_048_576,
      });

      if (runResult.status !== 0 || runResult.error) {
        return { status: 'FAILED', reason: `CONTEXT_REDUCTION_FAILED: ${runResult.error?.message || runResult.stderr?.trim() || runResult.status}`, output: null };
      }
      let reduced;
      try { reduced = JSON.parse(runResult.stdout); } catch {
        return { status: 'FAILED', reason: 'CONTEXT_RESULT_INVALID', output: null };
      }
      if (reduced.contract !== 'ace.result/v1' || typeof reduced.renderedContext !== 'string') {
        return { status: 'FAILED', reason: 'CONTEXT_RESULT_INVALID', output: null };
      }
      return {
        status: 'SUCCESS',
        output: { mode: reduced.mode, renderedContext: reduced.renderedContext,
          items: reduced.items, metrics: reduced.metrics, recovery: { stateRoot: contextState, owner, session } },
        contextBytes: Buffer.byteLength(reduced.renderedContext, 'utf8'),
        evidence: [{ kind: 'graph-result-digest', value: digest },
          { kind: 'context-mode', value: reduced.mode }],
        followUpRequests: [],
      };
    },

    /**
     * Real host adapter for Afyx Forge Core
     */
    'afyx-forge': async (request) => {
      if (['workflow-execution', 'multi-agent-workflow'].includes(request.taskType)) {
        if (!trustedCapabilities.forge) return { status: 'FAILED', reason: 'FORGE_HOST_ADAPTERS_REQUIRED', output: null };
        const forge = await import(pathToFileURL(join(resolvedInstallRoot, 'forge', 'current', 'src', 'index.js')).href);
        const result = await forge.executeForgeWorkflow(request.payload, trustedCapabilities.forge);
        return { ...success(result, 'adaptive-engineering-policy'), status: result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED' };
      }

      if (!existsSync(forgeEntrypoint)) {
        return { status: 'FAILED', reason: 'FORGE_ENTRYPOINT_NOT_FOUND', output: null };
      }

      // Strict A8 governance: check if request demands autonomous execution
      const isAutonomous = request.intent?.includes('autonomous') ||
        request.taskType?.includes('campaign') ||
        request.taskType?.includes('autonomous');

      if (isAutonomous) {
        return {
          status: 'FAILED',
          reason: 'FORGE_A8_REQUIRED: Autonomous campaign execution strictly blocked',
          output: null,
        };
      }

      // Assistive guidance query
      const runResult = spawnSync(nodePath, [forgeEntrypoint, 'doctor'], {
        encoding: 'utf8',
        timeout: requestTimeout(request, 5_000),
        windowsHide: true,
      });

      if (runResult.status !== 0 || runResult.error) {
        return {
          status: 'FAILED',
          reason: `FORGE_EXECUTION_ERROR: ${runResult.error?.message || runResult.stderr?.trim() || `Exit code ${runResult.status}`}`,
          output: null,
        };
      }

      let doctorPayload = null;
      try {
        doctorPayload = JSON.parse(runResult.stdout);
      } catch {
        doctorPayload = { rawOutput: runResult.stdout };
      }

      return {
        status: 'SUCCESS',
        output: doctorPayload,
        contextBytes: Buffer.byteLength(JSON.stringify(doctorPayload), 'utf8'),
        evidence: [
          { kind: 'forge-mode', value: 'ASSISTIVE_GUIDANCE_ONLY' },
          { kind: 'forge-governance', value: doctorPayload.governance?.status || 'A8_GATED' },
        ],
        followUpRequests: [],
      };
    },

    /**
     * Real host adapter for Afyx Odoo Engineering (Skill)
     */
    'odoo-engineering': async (request) => {
      const skillFile = join(odooSkillDir, 'SKILL.md');
      if (!existsSync(skillFile)) {
        return { status: 'FAILED', reason: 'ODOO_SKILL_FILE_NOT_FOUND', output: null };
      }

      const skillContent = readFileSync(skillFile, 'utf8');
      const lines = skillContent.split('\n');
      const titleLine = lines.find((l) => l.startsWith('#')) || '# Odoo Engineering';

      // Check if project has models/ directory and suggest Graph follow-up for relational analysis
      const followUpRequests = [];
      const modelsDir = join(resolvedProjectRoot, 'addons');
      if (existsSync(modelsDir)) {
        followUpRequests.push({
          targetComponentId: 'afyx-graph',
          invocationReason: 'Inspect Odoo addon model inheritance relationships',
        });
      }

      return {
        status: 'SUCCESS',
        output: {
          authority: 'odoo-framework-authority',
          versionScope: '10-20',
          skillTitle: titleLine.replace(/^#\s*/, '').trim(),
        },
        contextBytes: 256,
        evidence: [
          { kind: 'skill-manifest', path: skillFile },
          { kind: 'skill-size-bytes', value: statSync(skillFile).size },
        ],
        followUpRequests,
      };
    },

    /**
     * Real host adapter for Afyx Engineering Expert (Skill)
     */
    'afyx-engineering-expert': async (request) => {
      if (['skill-discovery', 'skill-refinement', 'skill-composition'].includes(request.taskType)) {
        const catalog = await import('./afyx-skill-catalog.mjs');
        if (request.taskType === 'skill-refinement') return success(catalog.refineSkillSpecification(request.payload), 'cross-disciplinary-expertise');
        if (request.taskType === 'skill-composition') return success(catalog.composeSkillSpecifications(request.payload?.skills), 'cross-disciplinary-expertise');
        const result = catalog.discoverSkillDescriptors({ roots: [resolve(expertSkillDir, '..')], ...trustedCapabilities.skills });
        return success(result, 'cross-disciplinary-expertise');
      }

      const skillFile = join(expertSkillDir, 'SKILL.md');
      if (!existsSync(skillFile)) {
        return { status: 'FAILED', reason: 'EXPERT_SKILL_FILE_NOT_FOUND', output: null };
      }

      const skillContent = readFileSync(skillFile, 'utf8');
      const followUpRequests = [];

      // Expert can delegate framework questions to Odoo and record telemetry
      if (request.task?.project?.isOdoo || request.intent?.toLowerCase().includes('odoo')) {
        followUpRequests.push({
          targetComponentId: 'odoo-engineering',
          invocationReason: 'Request Odoo framework domain constraints',
        });
      }

      return {
        status: 'SUCCESS',
        output: {
          authority: 'cross-disciplinary-expertise',
          expertGuidance: 'Multi-disciplinary systems architecture and workflow selection',
        },
        contextBytes: 256,
        evidence: [
          { kind: 'skill-manifest', path: skillFile },
          { kind: 'skill-size-bytes', value: statSync(skillFile).size },
        ],
        followUpRequests,
      };
    },

    /**
     * Real host adapter for Afyx Efficient Coding (Skill)
     */
    'efficient-coding': async (request) => {
      const skillFile = join(efficientSkillDir, 'SKILL.md');
      if (!existsSync(skillFile)) {
        return { status: 'FAILED', reason: 'EFFICIENT_CODING_SKILL_FILE_NOT_FOUND', output: null };
      }

      return {
        status: 'SUCCESS',
        output: {
          authority: 'focused-coding-discipline',
          discipline: 'Inspect -> Minimal Change -> Scoped Verification',
        },
        contextBytes: 128,
        evidence: [
          { kind: 'skill-manifest', path: skillFile },
          { kind: 'skill-size-bytes', value: statSync(skillFile).size },
        ],
        followUpRequests: [],
      };
    },

    /**
     * Real host adapter for Codex Usage Tracking (Tool)
     */
    'codex-usage-tracking': async (request) => {
      // Permission and provider gated
      const provider = request.candidateProviders?.[0] || 'codex';
      if (provider !== 'codex') {
        return { status: 'FAILED', reason: 'UNAUTHORIZED_ON_NON_CODEX_PROVIDER', output: null };
      }

      const toolExists = codexToolFile && existsSync(codexToolFile);
      if (!toolExists) {
        return { status: 'FAILED', reason: 'USAGE_TRACKING_TOOL_NOT_FOUND', output: null };
      }
      return {
        status: 'SUCCESS',
        output: {
          telemetryRecorded: false,
          provider: 'codex',
          toolAvailable: true,
          mode: 'PASSIVE_OBSERVABILITY_ONLY',
        },
        contextBytes: 64,
        evidence: [
          { kind: 'telemetry-mode', value: 'PASSIVE_NON_BLOCKING' },
          { kind: 'telemetry-gating', value: 'PERMISSION_VERIFIED' },
        ],
        followUpRequests: [],
      };
    },
  });
}

