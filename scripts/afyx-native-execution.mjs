import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export const NATIVE_EXECUTION_CONTRACT = 'AfyxNativeExecution/v1';
const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const ENV_KEYS = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'];
const SECRET_KEY = /token|secret|password|credential|authorization|api.?key/i;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const plain = (value) => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
function inside(root, target) {
  const rel = relative(root, target);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}
function bounded(value, fallback, ceiling) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > ceiling) throw new Error('INVALID_LIMIT');
  return selected;
}
function compile(spec) {
  if (!plain(spec) || !NAME.test(spec.id) || !isAbsolute(spec.executable)
    || !['read', 'mutation'].includes(spec.effect) || !Array.isArray(spec.argv) || spec.argv.length > 64
    || (spec.privileged !== undefined && typeof spec.privileged !== 'boolean')) throw new Error('INVALID_CATALOG');
  const allowed = ['id', 'executable', 'effect', 'argv', 'parameters', 'privileged', 'timeoutMs', 'maxOutputBytes', 'environmentKeys'];
  if (Object.keys(spec).some((key) => !allowed.includes(key))) throw new Error('INVALID_CATALOG');
  const executable = realpathSync(spec.executable);
  if (!statSync(executable).isFile() || /\.(?:cmd|bat|ps1|sh)$/i.test(executable)) throw new Error('NATIVE_EXECUTABLE_REQUIRED');
  const parameters = spec.parameters ?? {};
  if (!plain(parameters) || Object.keys(parameters).length > 32) throw new Error('INVALID_PARAMETERS');
  const validated = {};
  for (const [name, rule] of Object.entries(parameters)) {
    if (!NAME.test(name) || !plain(rule) || !['string', 'integer', 'enum'].includes(rule.type)
      || Object.keys(rule).some((key) => !['type', 'required', 'values', 'min', 'max', 'maxLength', 'flag'].includes(key))
      || (rule.flag !== undefined && !/^--[a-z][a-z0-9-]{0,63}$/.test(rule.flag))
      || (rule.required !== undefined && typeof rule.required !== 'boolean')) throw new Error('INVALID_PARAMETERS');
    if (rule.type === 'enum' && (!Array.isArray(rule.values) || !rule.values.length || rule.values.length > 64
      || rule.values.some((value) => typeof value !== 'string' || value.length > 256 || /[\0\r\n]/.test(value)))) throw new Error('INVALID_ENUM');
    if (rule.type === 'integer' && ((rule.min !== undefined && !Number.isSafeInteger(rule.min))
      || (rule.max !== undefined && !Number.isSafeInteger(rule.max)) || (rule.min ?? 0) > (rule.max ?? Number.MAX_SAFE_INTEGER))) throw new Error('INVALID_RANGE');
    validated[name] = Object.freeze({ ...rule, maxLength: bounded(rule.maxLength, 256, 4096), values: rule.values ? Object.freeze([...rule.values]) : undefined });
  }
  const argv = spec.argv.map((part) => {
    if (typeof part === 'string' && part.length <= 4096 && !/[\0\r\n]/.test(part)) return part;
    if (!plain(part) || Object.keys(part).length !== 1 || !Object.hasOwn(validated, part.parameter)) throw new Error('INVALID_ARGV');
    return Object.freeze({ parameter: part.parameter });
  });
  // Interpreter command strings are deliberately outside this adapter contract.
  const interpreter = /^(?:node|python(?:\d+(?:\.\d+)*)?|ruby|perl|sh|bash|zsh|cmd|pwsh|powershell)(?:\.exe)?$/i.test(basename(executable));
  if (interpreter && argv.some((arg) => typeof arg === 'string'
    && /^(?:--(?:eval|print|require|import|loader|experimental-loader)(?:=|$)|-[eprc](?:$|[^a-z])|\/c(?:$|[ :=])|-(?:command|encodedcommand)(?:$|[ :=]))/i.test(arg))) throw new Error('INTERPRETER_COMMAND_DENIED');
  if (interpreter) {
    const inspection = argv.length === 1 && ['--version', '-v', '--help'].includes(argv[0]);
    // A model may supply arguments to a host-pinned script, never its entrypoint or interpreter flags.
    const pinnedScript = typeof argv[0] === 'string' && isAbsolute(argv[0]) && statSync(argv[0]).isFile();
    if (!inspection && !pinnedScript) throw new Error('INTERPRETER_ENTRYPOINT_REQUIRED');
  }
  const environmentKeys = spec.environmentKeys ?? ENV_KEYS;
  if (!Array.isArray(environmentKeys) || environmentKeys.length > 32
    || environmentKeys.some((key) => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || SECRET_KEY.test(key) || /^NODE_OPTIONS$/i.test(key))) throw new Error('UNSAFE_ENVIRONMENT');
  return Object.freeze({ id: spec.id, executable, effect: spec.effect, privileged: spec.privileged === true,
    argv: Object.freeze(argv), parameters: Object.freeze(validated), environmentKeys: Object.freeze([...environmentKeys]),
    timeoutMs: bounded(spec.timeoutMs, 5000, 60_000), maxOutputBytes: bounded(spec.maxOutputBytes, 65_536, 1_048_576) });
}

/** Trusted host configuration compiles adapters; task JSON can only select validated parameters. */
export function createNativeExecution({ projectRoot, catalog, authorize, environment = process.env } = {}) {
  if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot) || lstatSync(projectRoot).isSymbolicLink()
    || !statSync(projectRoot).isDirectory()) throw new Error('TRUSTED_PROJECT_ROOT_REQUIRED');
  const root = realpathSync(projectRoot);
  const specs = catalog ?? [{ id: 'node-version', executable: process.execPath, argv: ['--version'], effect: 'read' }];
  if (!Array.isArray(specs) || specs.length > 64) throw new Error('INVALID_CATALOG');
  const entries = new Map();
  for (const spec of specs) {
    const entry = compile(spec);
    if (entries.has(entry.id)) throw new Error('DUPLICATE_CAPABILITY');
    entries.set(entry.id, entry);
  }
  const hostEnvironment = Object.freeze({ ...environment });
  const discover = () => [...entries.values()].map(({ id, effect, privileged, parameters }) => ({ id, effect, privileged, parameters: Object.keys(parameters) }));
  async function execute(request, { signal } = {}) {
    const started = performance.now();
    const receipt = { contract: NATIVE_EXECUTION_CONTRACT, capabilityId: request?.capabilityId ?? null, status: 'DENIED',
      exitCode: null, stdoutBytes: 0, stderrBytes: 0, durationMs: 0 };
    const finish = (status, reason, stdout = '', stderr = '') => Object.freeze({ status, reason, output: { stdout, stderr },
      receipt: Object.freeze({ ...receipt, status, durationMs: performance.now() - started }) });
    if (!plain(request) || Object.keys(request).some((key) => !['capabilityId', 'arguments', 'cwd'].includes(key))) return finish('DENIED', 'INVALID_REQUEST');
    const entry = entries.get(request.capabilityId);
    if (!entry) return finish('DENIED', 'CAPABILITY_UNAVAILABLE');
    const input = request.arguments ?? {};
    if (!plain(input) || Object.keys(input).some((name) => !Object.hasOwn(entry.parameters, name))) return finish('DENIED', 'INVALID_ARGUMENTS');
    const values = {};
    for (const [name, rule] of Object.entries(entry.parameters)) {
      const value = input[name];
      if (value === undefined && rule.required !== false) return finish('DENIED', 'MISSING_ARGUMENT');
      if (value === undefined) continue;
      const valid = rule.type === 'integer' ? Number.isSafeInteger(value) && value >= (rule.min ?? 0) && value <= (rule.max ?? Number.MAX_SAFE_INTEGER)
        : typeof value === 'string' && value.length <= rule.maxLength && !/[\0\r\n]/.test(value) && (rule.type !== 'enum' || rule.values.includes(value));
      if (!valid) return finish('DENIED', 'INVALID_ARGUMENTS');
      if (typeof value === 'string' && /^[-/]/.test(value) && rule.type !== 'enum') return finish('DENIED', 'DYNAMIC_OPTION_DENIED');
      values[name] = String(value);
    }
    let cwd;
    try {
      if (request.cwd !== undefined && typeof request.cwd !== 'string') return finish('DENIED', 'INVALID_CWD');
      cwd = realpathSync(resolve(root, request.cwd ?? '.'));
      if (!inside(root, cwd) || !statSync(cwd).isDirectory()) return finish('DENIED', 'CWD_OUTSIDE_ROOT');
    } catch { return finish('DENIED', 'INVALID_CWD'); }
    const argv = entry.argv.flatMap((part) => typeof part === 'string' ? [part] : values[part.parameter] === undefined ? []
      : [...(entry.parameters[part.parameter].flag ? [entry.parameters[part.parameter].flag] : []), values[part.parameter]]);
    receipt.argvDigest = sha(JSON.stringify(argv));
    receipt.executable = entry.executable;
    const approval = Object.freeze({ capabilityId: entry.id, effect: entry.effect, privileged: entry.privileged, cwd, argvDigest: receipt.argvDigest });
    if (entry.effect === 'mutation' || entry.privileged) {
      try { if (typeof authorize !== 'function' || authorize(approval) !== true) return finish('DENIED', 'HOST_APPROVAL_REQUIRED'); }
      catch { return finish('DENIED', 'HOST_APPROVAL_REQUIRED'); }
    }
    if (signal?.aborted) return finish('CANCELLED', 'HOST_CANCELLED');
    const env = {};
    for (const key of entry.environmentKeys) {
      const actual = Object.keys(hostEnvironment).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (actual && typeof hostEnvironment[actual] === 'string') env[actual] = hostEnvironment[actual];
    }
    const secrets = Object.entries(hostEnvironment).filter(([key, value]) => SECRET_KEY.test(key) && typeof value === 'string' && value.length >= 4).map(([, value]) => value);
    const redact = (value) => secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
    return await new Promise((resolveResult) => {
      let child;
      try { child = spawn(entry.executable, argv, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch { resolveResult(finish('FAILED', 'SPAWN_FAILED')); return; }
      const stdout = []; const stderr = []; let kept = 0; let forced = null; let settled = false;
      let killTimer; let settleTimer;
      const stop = (status) => {
        if (forced || settled) return;
        forced = status;
        try { child.kill(); } catch { /* hard cleanup remains bounded */ }
        killTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* child may already have exited */ }
          // Descendants holding inherited pipes cannot extend the owned command deadline.
          child.stdout.destroy(); child.stderr.destroy();
          settleTimer = setTimeout(() => done(null), 50);
        }, 100);
      };
      const abort = () => stop('CANCELLED');
      const timer = setTimeout(() => stop('TIMEOUT'), entry.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const collect = (chunks, key) => (chunk) => {
        receipt[key] += chunk.length;
        const remaining = entry.maxOutputBytes - kept;
        if (remaining > 0) { const part = chunk.subarray(0, remaining); chunks.push(part); kept += part.length; }
        if (receipt.stdoutBytes + receipt.stderrBytes > entry.maxOutputBytes) stop('OUTPUT_LIMIT');
      };
      child.stdout.on('data', collect(stdout, 'stdoutBytes'));
      child.stderr.on('data', collect(stderr, 'stderrBytes'));
      const done = (code, spawnError = false) => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(settleTimer);
        signal?.removeEventListener('abort', abort); receipt.exitCode = code;
        receipt.truncated = forced === 'OUTPUT_LIMIT'; receipt.terminationGraceMs = forced ? 150 : 0;
        if (forced) { child.stdout.destroy(); child.stderr.destroy(); }
        resolveResult(finish(forced ?? (code === 0 && !spawnError ? 'SUCCESS' : 'FAILED'), forced ?? (spawnError ? 'SPAWN_FAILED' : code === 0 ? 'COMPLETED' : 'NONZERO_EXIT'),
          forced ? '' : redact(Buffer.concat(stdout).toString('utf8')), forced ? '' : redact(Buffer.concat(stderr).toString('utf8'))));
      };
      child.once('error', () => done(null, true)); child.once('close', (code) => done(code));
    });
  }
  return Object.freeze({ contract: NATIVE_EXECUTION_CONTRACT, discover, execute });
}
