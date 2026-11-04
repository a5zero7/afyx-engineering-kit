import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ToolResult } from './tool-results';
import { resolveServerRoot } from '../directory';

/**
 * Optional native Graph -> installed ACE bridge. Graph and its tool outputs are
 * authoritative. No ACE process, state directory or dependency is created for
 * ordinary/small/protected calls or when the user explicitly disables ACE.
 */
export const ACE_RECOVERY_TOOL = 'afyx_graph_ace_recover';
const MIN_OUTPUT_BYTES = 24 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const WORKER_TIMEOUT_MS = 5_000;
const MAX_WORKER_RESPONSE_BYTES = 2 * 1024 * 1024;
const REDUCIBLE_TOOLS = new Set([
  'afyx_graph_inventory', 'afyx_graph_callers', 'afyx_graph_callees', 'afyx_graph_impact',
]);
const PROTECTED_CONTENT = /\b(?:SECURITY|UNAUTHORIZED|PERMISSION DENIED|ACCESS DENIED|CREDENTIAL|SECRET|ERROR|FAIL(?:ED|URE)?|EXCEPTION|TRACEBACK)\b/i;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSafeFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
  } catch { return false; }
}

function installedBridge(): string | null {
  if (process.env.AFYX_CONTEXT_OPT_IN === '0') return null;
  if (process.env.AFYX_CONTEXT_RUNTIME_ROOT && !path.isAbsolute(process.env.AFYX_CONTEXT_RUNTIME_ROOT)) return null;
  const runtimeRoot = process.env.AFYX_CONTEXT_RUNTIME_ROOT
    ? path.resolve(process.env.AFYX_CONTEXT_RUNTIME_ROOT)
    : path.join(os.homedir(), '.afyx', 'context');
  const current = path.join(runtimeRoot, 'current');
  const bridge = path.join(current, 'dist', 'graph-mcp-bridge.js');
  try {
    if (!path.isAbsolute(runtimeRoot) || !isSafeFile(bridge)) return null;
    if (fs.lstatSync(runtimeRoot).isSymbolicLink()
        || fs.lstatSync(current).isSymbolicLink()
        || fs.lstatSync(path.join(current, 'dist')).isSymbolicLink()) return null;
    const metadataFile = path.join(runtimeRoot, 'metadata.json');
    const identityFile = path.join(current, 'identity.json');
    if (!isSafeFile(metadataFile) || !isSafeFile(identityFile)) return null;
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8')) as Record<string, unknown>;
    const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8')) as Record<string, unknown>;
    if (metadata.product_name !== 'Afyx Context Engine'
        || metadata.ownership_class !== 'AFYX'
        || identity.source_revision !== metadata.source_revision
        || identity.product_version !== metadata.product_version) return null;
    // The installed ACE manifest is the authoritative file inventory. Refuse
    // to launch a modified worker or dependency (or an unverifiable artifact).
    const manifest = path.join(runtimeRoot, 'integrity.sha256');
    if (!isSafeFile(manifest) || typeof metadata.artifact_digest !== 'string') return null;
    const manifestBytes = fs.readFileSync(manifest);
    if (createHash('sha256').update(manifestBytes).digest('hex') !== metadata.artifact_digest) return null;
    const records = manifestBytes.toString('utf8').trim().split('\n');
    if (records.length === 0 || records.length > 128) return null;
    let bridgeVerified = false;
    for (const record of records) {
      const match = /^([0-9a-f]{64})  current\/([A-Za-z0-9._/-]+)$/.exec(record.trim());
      if (!match || !match[2] || match[2].split('/').includes('..')) return null;
      const target = path.join(current, ...match[2].split('/'));
      if (!isSafeFile(target)) return null;
      if (createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== match[1]) return null;
      if (target === bridge) bridgeVerified = true;
    }
    return bridgeVerified ? bridge : null;
  } catch { return null; }
}

function outputLooksRepetitive(result: ToolResult, size: number): boolean {
  // No ACE worker for a large but unique output: it would substitute a
  // reference for essential context without demonstrating repeated-content
  // savings. The explicit companion skill can handle those cases by choice.
  const seen = new Set<string>();
  let repeatedBytes = 0;
  for (const block of result.content) {
    for (const line of block.text.split('\n')) {
      if (line.length < 64) continue;
      const fingerprint = sha256(line);
      if (seen.has(fingerprint)) repeatedBytes += Buffer.byteLength(line, 'utf8');
      else seen.add(fingerprint);
    }
  }
  return repeatedBytes >= size * 0.15;
}

function stateDirectory(): string | null {
  const configured = process.env.AFYX_CONTEXT_STATE_ROOT;
  if (configured && !path.isAbsolute(configured)) return null;
  return configured ? path.resolve(configured) : path.join(os.homedir(), '.afyx', 'state', 'context', 'graph');
}

interface BridgeRequest {
  operation: 'reduce' | 'recover';
  projectRoot: string;
  stateDir: string;
  sourceIdentity: string;
  toolName?: string;
  reference?: string;
  graphResult?: ToolResult;
}

interface BridgeResponse {
  status: string;
  result?: ToolResult;
  content?: string;
  savedChars?: number;
  failureCode?: string;
}

async function runBridge(worker: string, message: BridgeRequest): Promise<BridgeResponse | null> {
  const serialized = JSON.stringify(message);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_OUTPUT_BYTES + 4096) return null;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, [worker], {
        windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'],
        timeout: WORKER_TIMEOUT_MS, killSignal: 'SIGKILL',
      });
    } catch { resolve(null); return; }
    let received = '';
    let completed = false;
    const finish = (value: BridgeResponse | null) => {
      if (completed) return;
      completed = true;
      resolve(value);
    };
    const deadline = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* fail closed */ }
      finish(null);
    }, WORKER_TIMEOUT_MS + 1000);
    deadline.unref();
    child.once('error', () => { clearTimeout(deadline); finish(null); });
    child.stdout?.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8');
      if (Buffer.byteLength(received, 'utf8') > MAX_WORKER_RESPONSE_BYTES) {
        try { child.kill('SIGKILL'); } catch { /* fail closed */ }
        finish(null);
      }
    });
    child.once('close', (code) => {
      clearTimeout(deadline);
      if (code !== 0) { finish(null); return; }
      try {
        const parsed: unknown = JSON.parse(received);
        if (!parsed || typeof parsed !== 'object' || typeof (parsed as BridgeResponse).status !== 'string') {
          finish(null); return;
        }
        finish(parsed as BridgeResponse);
      } catch { finish(null); }
    });
    child.stdin?.on('error', () => { /* child close determines fallback */ });
    child.stdin?.end(serialized);
  });
}

function canonicalProject(projectPath: unknown): string | null {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) return null;
  try {
    const root = resolveServerRoot(projectPath).root;
    if (!root) return null;
    return fs.realpathSync.native(root);
  } catch { return null; }
}

function safeStateForProject(projectRoot: string): string | null {
  const state = stateDirectory();
  if (!state) return null;
  const relative = path.relative(projectRoot, state);
  const reverse = path.relative(state, projectRoot);
  const within = (value: string) => value === '' || (value !== '..' && !value.startsWith('..' + path.sep) && !path.isAbsolute(value));
  if (within(relative) || within(reverse)) return null;
  try {
    // Existing state or an ancestor must not be a symlink/reparse-point.
    let cursor = state;
    while (true) {
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) return null;
      const parent = path.dirname(cursor);
      if (cursor === parent) break;
      cursor = parent;
    }
  } catch { return null; }
  return state;
}

export class McpAceRuntime {
  /** No side effect: optional recovery surface is exposed only for installed ACE. */
  recoveryAvailable(): boolean {
    return installedBridge() !== null && stateDirectory() !== null;
  }

  async maybeOptimize(
    toolName: string, args: Record<string, unknown>, result: ToolResult, projectHint: string | null,
  ): Promise<ToolResult> {
    if (!REDUCIBLE_TOOLS.has(toolName) || result.isError
        || !Array.isArray(result.content) || result.content.some((b) => b.type !== 'text' || typeof b.text !== 'string')) return result;
    const size = result.content.reduce((n, item) => n + Buffer.byteLength(item.text, 'utf8'), 0);
    if (size < MIN_OUTPUT_BYTES || size > MAX_OUTPUT_BYTES) return result;
    if (result.content.some((item) => PROTECTED_CONTENT.test(item.text))) return result;
    if (!outputLooksRepetitive(result, size)) return result;
    const worker = installedBridge();
    const root = canonicalProject(args.projectPath ?? projectHint);
    if (!worker || !root) return result;
    const state = safeStateForProject(root);
    if (!state) return result;
    const response = await runBridge(worker, {
      operation: 'reduce', projectRoot: root, stateDir: state,
      sourceIdentity: 'graph-mcp-project:' + sha256(root),
      toolName, graphResult: result,
    });
    if (response?.status !== 'optimized' || !response.result || !Array.isArray(response.result.content)
        || typeof response.savedChars !== 'number'
        || !Number.isSafeInteger(response.savedChars) || response.savedChars <= 0
        || response.result.isError) return result;
    // Retain an actionable recovery route in the public MCP output.
    const optimized = response.result.content;
    if (optimized.length !== 1 || typeof optimized[0]?.text !== 'string') return result;
    const note = '\n\n[Afyx ACE: recover any ace:v1 reference with afyx_graph_ace_recover; projectPath is the indexed project root.]';
    return { ...result, content: [{ type: 'text', text: optimized[0].text + note }] };
  }

  async recover(reference: unknown, projectPath: unknown): Promise<ToolResult> {
    if (typeof reference !== 'string' || !/^ace:v1:[A-Za-z0-9:_-]{1,1024}$/.test(reference)) {
      return { content: [{ type: 'text', text: 'Invalid ACE recovery reference.' }], isError: true };
    }
    const worker = installedBridge();
    const root = canonicalProject(projectPath);
    if (!worker || !root) {
      return { content: [{ type: 'text', text: 'ACE recovery is unavailable or explicitly disabled.' }], isError: true };
    }
    const state = safeStateForProject(root);
    if (!state) return { content: [{ type: 'text', text: 'Unsafe ACE state or project path.' }], isError: true };
    const response = await runBridge(worker, {
      operation: 'recover', projectRoot: root, stateDir: state,
      sourceIdentity: 'graph-mcp-project:' + sha256(root), reference,
    });
    if (response?.status !== 'recovered' || typeof response.content !== 'string') {
      return { content: [{ type: 'text', text: 'Exact ACE recovery could not be verified.' }], isError: true };
    }
    return { content: [{ type: 'text', text: response.content }] };
  }
}

export const ACE_RECOVERY_DEFINITION = {
  name: ACE_RECOVERY_TOOL,
  description: 'Recover the exact original content for an ACE reference produced by an optimized Afyx Graph MCP response. Project must be indexed; unavailable ACE fails closed.',
  inputSchema: {
    type: 'object',
    properties: {
      reference: { type: 'string', description: 'Exact ace:v1 reference emitted by a previous Graph response' },
      projectPath: { type: 'string', description: 'Absolute indexed Afyx Graph project root that produced the reference' },
    },
    required: ['reference', 'projectPath'],
  },
  annotations: { title: 'Afyx ACE Exact Recovery', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
} as const;
