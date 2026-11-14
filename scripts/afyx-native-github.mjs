/** AFYX scoped read-only GitHub API/MCP. Host configuration owns scope and credentials. */
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeExecution } from './afyx-native-execution.mjs';

export const GITHUB_CONTRACT = 'AfyxGitHub/v1';
const OPERATIONS = ['repository', 'branches', 'commits', 'file', 'issues', 'pulls', 'pull', 'workflow-runs', 'workflow-jobs', 'job-log'];
const LISTS = new Set(['branches', 'commits', 'issues', 'pulls', 'workflow-runs', 'workflow-jobs']);
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const KEYS = new Set(['operation', 'owner', 'repo', 'number', 'path', 'ref', 'page', 'perPage']);
function endpoint(args) {
  if (!args || Object.keys(args).some((key) => !KEYS.has(key)) || !OPERATIONS.includes(args.operation)
    || !NAME.test(args.owner || '') || !NAME.test(args.repo || '') || [args.owner, args.repo].some((s) => s.includes('..'))) throw new Error('INVALID_REQUEST');
  const base = `repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}`;
  const number = () => { if (!Number.isSafeInteger(args.number) || args.number < 1) throw new Error('INVALID_NUMBER'); return args.number; };
  const paths = { repository: '', branches: '/branches', commits: '/commits', issues: '/issues', pulls: '/pulls', 'workflow-runs': '/actions/runs' };
  let suffix = paths[args.operation];
  if (args.operation === 'pull') suffix = `/pulls/${number()}`;
  if (args.operation === 'workflow-jobs') suffix = `/actions/runs/${number()}/jobs`;
  if (args.operation === 'job-log') suffix = `/actions/jobs/${number()}/logs`;
  if (args.operation === 'file') {
    if (typeof args.path !== 'string' || args.path.length > 1024 || args.path.split('/').some((p) => !p || p === '..' || p === '.') || /[\\\x00-\x1f]/.test(args.path)) throw new Error('INVALID_PATH');
    suffix = '/contents/' + args.path.split('/').map(encodeURIComponent).join('/');
  }
  const query = new URLSearchParams();
  if (args.ref !== undefined) { if (!['file', 'commits'].includes(args.operation) || typeof args.ref !== 'string' || !args.ref || args.ref.length > 256 || /[\x00-\x1f]/.test(args.ref)) throw new Error('INVALID_REF'); query.set(args.operation === 'commits' ? 'sha' : 'ref', args.ref); }
  if (LISTS.has(args.operation)) {
    for (const [key, fallback, max] of [['page', 1, 10000], ['perPage', 30, 100]]) {
      const value = args[key] ?? fallback; if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('INVALID_PAGINATION');
      query.set(key === 'perPage' ? 'per_page' : key, value);
    }
  } else if (args.page !== undefined || args.perPage !== undefined) throw new Error('INVALID_PAGINATION');
  return base + suffix + (query.size ? '?' + query.toString() : '');
}
function redact(value, secrets) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets) if (typeof secret === 'string' && secret.length > 3) text = text.split(secret).join('[REDACTED]');
  return text.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|secret[_-]?token|password)\s*[:=]\s*["'])([^"'\r\n]{8,})(["'])/gi, '$1[REDACTED]$3');
}

export function createGitHubReader({ allowedRepositories = [], authorize = () => true, request, maxBytes = 262144,
  maxItems = 100, timeoutMs = 5000, secrets = [], authMode = 'PUBLIC' } = {}) {
  if (!Array.isArray(allowedRepositories) || !allowedRepositories.length || allowedRepositories.length > 100
    || allowedRepositories.some((r) => typeof r !== 'string' || r.split('/').length !== 2 || r.split('/').some((n) => !NAME.test(n) || n.includes('..')))
    || !Number.isSafeInteger(maxBytes) || maxBytes < 128 || maxBytes > 1048576 || !Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 100
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || typeof authorize !== 'function') throw new Error('INVALID_HOST_CONFIGURATION');
  const allowed = new Set(allowedRepositories.map((s) => s.toLowerCase()));
  async function read(args, { signal } = {}) {
    const started = performance.now(); let route;
    const result = (status, code, data = null, extra = {}) => ({ contract: GITHUB_CONTRACT, status, code, data,
      receipt: { operation: args?.operation || null, authMode, durationMs: performance.now() - started, ...extra } });
    try { route = endpoint(args); } catch { return result('DENIED', 'INVALID_REQUEST'); }
    if (!allowed.has(`${args.owner}/${args.repo}`.toLowerCase())) return result('DENIED', 'REPOSITORY_OUTSIDE_SCOPE');
    try { if (authorize(Object.freeze({ repository: `${args.owner}/${args.repo}`, operation: args.operation, method: 'GET' })) !== true) return result('DENIED', 'HOST_AUTHORIZATION_REQUIRED'); }
    catch { return result('DENIED', 'HOST_AUTHORIZATION_REQUIRED'); }
    const controller = new AbortController(); const abort = () => controller.abort();
    if (signal?.aborted) return result('CANCELLED', 'HOST_CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      let response;
      const operation = async () => {
        if (request) return request(Object.freeze({ endpoint: route, method: 'GET', signal: controller.signal, maxBytes }));
        const raw = await fetch(`https://api.github.com/${route}`, { method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AFYX-Native-GitHub', 'X-GitHub-Api-Version': '2022-11-28' } });
        if (raw.status >= 300 && raw.status < 400) { await raw.body?.cancel(); return { status: raw.status, body: '', headers: {} }; }
        let bytes = 0; const chunks = [];
        for await (const chunk of raw.body ?? []) { bytes += chunk.length; if (bytes > maxBytes) throw new Error('OUTPUT_LIMIT'); chunks.push(chunk); }
        return { status: raw.status, body: Buffer.concat(chunks).toString('utf8'), headers: Object.fromEntries(raw.headers) };
      };
      const deadline = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('ABORTED')), { once: true }));
      response = await Promise.race([operation(), deadline]);
      if (!response || !Number.isInteger(response.status)) return result('FAILED', 'INVALID_HOST_RESPONSE');
      const rate = { remaining: response.headers?.['x-ratelimit-remaining'] ?? null, reset: response.headers?.['x-ratelimit-reset'] ?? null };
      if ([403, 429].includes(response.status)) return result('FAILED', 'RATE_LIMIT_OR_PERMISSION', null, { rate, retryAfter: response.headers?.['retry-after'] ?? null });
      if (response.status >= 300 && response.status < 400) return result('BLOCKED', 'LOG_REDIRECT_REQUIRES_TRUSTED_HOST');
      if (response.status !== 200) return result('FAILED', 'GITHUB_HTTP_ERROR', null, { httpStatus: response.status });
      const raw = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
      if (Buffer.byteLength(raw) > maxBytes) return result('FAILED', 'OUTPUT_LIMIT');
      const safe = redact(raw, secrets); let data;
      try { data = JSON.parse(safe); } catch { if (args.operation !== 'job-log') return result('FAILED', 'INVALID_GITHUB_JSON'); data = safe; }
      let contentRedacted = false;
      if (args.operation === 'file' && data?.encoding === 'base64' && typeof data.content === 'string') {
        const decoded = Buffer.from(data.content, 'base64');
        if (decoded.length > maxBytes) return result('FAILED', 'OUTPUT_LIMIT');
        const source = decoded.toString('utf8'), sanitized = redact(source, secrets);
        if (sanitized !== source) {
          data = { ...data, content: Buffer.from(sanitized).toString('base64'), afyxContentDisposition: 'REDACTED_SOURCE_NOT_BYTE_EXACT' };
          contentRedacted = true;
        }
      }
      const list = Array.isArray(data) ? data : data?.workflow_runs ?? data?.jobs;
      const received = Array.isArray(list) ? list.length : null;
      if (Array.isArray(list)) {
        const bounded = list.slice(0, maxItems);
        if (Array.isArray(data)) data = bounded;
        else data = { ...data, [data.workflow_runs ? 'workflow_runs' : 'jobs']: bounded };
      }
      return result('SUCCESS', 'READ_ONLY', data, { endpoint: route, bytes: Buffer.byteLength(safe), sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'), contentRedacted, rate,
        pagination: LISTS.has(args.operation) ? { page: args.page ?? 1, perPage: args.perPage ?? 30, returned: Math.min(received ?? 0, maxItems),
          nextPageCandidate: received === (args.perPage ?? 30) ? (args.page ?? 1) + 1 : null, truncated: received > maxItems, automaticFollow: false } : null });
    } catch (error) { return result(controller.signal.aborted ? signal?.aborted ? 'CANCELLED' : 'TIMEOUT' : 'FAILED', error.message === 'OUTPUT_LIMIT' ? 'OUTPUT_LIMIT' : 'REQUEST_FAILED'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return Object.freeze({ read, inventory: () => ({ contract: GITHUB_CONTRACT, operations: [...OPERATIONS], repositories: [...allowed], authMode, readOnly: true }) });
}

/** Uses an existing native gh credential session; credentials never enter task JSON or results. */
export function createGhRequest({ executable, projectRoot, environment = process.env } = {}) {
  const executor = createNativeExecution({ projectRoot, environment, catalog: [{ id: 'github-get', executable, effect: 'read',
    argv: ['api', { parameter: 'endpoint' }, '--method', 'GET'], parameters: { endpoint: { type: 'string', maxLength: 4096 } },
    environmentKeys: ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'GH_CONFIG_DIR'], maxOutputBytes: 1048576, timeoutMs: 10000 }] });
  return async ({ endpoint: route, signal, maxBytes }) => {
    if (typeof route !== 'string' || !route.startsWith('repos/') || route.includes('\0')) throw new Error('INVALID_ENDPOINT');
    const result = await executor.execute({ capabilityId: 'github-get', arguments: { endpoint: route } }, { signal });
    if (result.status !== 'SUCCESS') return { status: 502, body: '', headers: {} };
    if (Buffer.byteLength(result.output.stdout) > maxBytes) throw new Error('OUTPUT_LIMIT');
    return { status: 200, body: result.output.stdout, headers: {} };
  };
}

export function serveGitHubMcp({ reader, input = process.stdin, output = process.stdout } = {}) {
  if (!reader?.read) throw new Error('GITHUB_READER_REQUIRED');
  const send = (x) => output.write(JSON.stringify(x) + '\n');
  const lines = createInterface({ input, crlfDelay: Infinity }); let chain = Promise.resolve(), queued = 0;
  lines.on('line', (line) => {
    if (Buffer.byteLength(line) > 65536 || queued >= 8) { send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'INPUT_LIMIT' } }); return; }
    queued++;
    chain = chain.then(async () => {
      let req; try { req = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'INVALID_JSON' } }); return; }
      if (req.id === undefined) return;
      let result;
      if (req.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'afyx-native-github', version: '1.0.0' } };
      else if (req.method === 'ping') result = {};
      else if (req.method === 'tools/list') result = { tools: [{ name: 'afyx_github_read', description: 'Scoped, read-only GitHub evidence; host owns repository authorization.', annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: { type: 'object', additionalProperties: false, properties: { operation: { enum: OPERATIONS }, owner: { type: 'string' }, repo: { type: 'string' }, number: { type: 'integer' }, path: { type: 'string' }, ref: { type: 'string' }, page: { type: 'integer' }, perPage: { type: 'integer' } }, required: ['operation', 'owner', 'repo'] } }] };
      else if (req.method === 'tools/call' && req.params?.name === 'afyx_github_read') { const value = await reader.read(req.params.arguments); result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: value.status !== 'SUCCESS' }; }
      else { send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'READ_ONLY_SERVER_UNKNOWN_METHOD' } }); return; }
      send({ jsonrpc: '2.0', id: req.id, result });
    }).catch(() => send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'SAFE_INTERNAL_ERROR' } })).finally(() => queued--);
  });
  return { close: () => lines.close(), drained: () => chain };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = (flag) => { const at = process.argv.indexOf(flag); return at < 0 ? null : process.argv[at + 1]; };
  const allowedRepositories = (value('--repositories') || '').split(',').filter(Boolean);
  const gh = value('--gh-executable');
  const reader = createGitHubReader({ allowedRepositories, ...(gh ? { request: createGhRequest({ executable: gh, projectRoot: resolve(value('--project-root') || process.cwd()) }), authMode: 'HOST_GH_SESSION' } : {}) });
  if (process.argv.includes('--mcp')) serveGitHubMcp({ reader });
  else process.stdout.write(JSON.stringify(reader.inventory()) + '\n');
}
