#!/usr/bin/env node
/**
 * AFYX Engineering Kit - Native Read-Only Security Auditor
 *
 * Deterministic, source-grounded static security analysis for codebases.
 * Audits source code for high-risk execution flaws:
 * - Unsafe Subprocess Execution (arbitrary shell injection)
 * - Hardcoded Secrets & Cryptographic Keys
 * - Path Traversal & Unvalidated File Operations
 * - Insecure Deserialization & Dynamic Code Evaluation
 *
 * Read-only by design; produces verifiable line-level evidence without mutation.
 */

import { readdirSync, lstatSync, realpathSync, openSync, readSync, closeSync, fstatSync, constants, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const SECURITY_AUDITOR_CONTRACT = 'afyx-security-audit-v1';

export const RISK_LEVELS = Object.freeze({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
});

/**
 * Deterministic detection signatures.
 */
export const AUDIT_RULES = Object.freeze([
  {
    id: 'SEC-PROC-01',
    category: 'UNSAFE_PROCESS_EXECUTION',
    severity: RISK_LEVELS.HIGH,
    title: 'Unsafe Subprocess Shell Invocation',
    description: 'Direct invocation of system shell with potential command injection risks.',
    patterns: [
      /\bchild_process\s*\.\s*(?:exec|execSync)\s*\(/i,
      /\b(?:cp|childProcess)\s*\.\s*(?:exec|execSync)\s*\(/i,
      /\bexecSync\s*\([^,)]*shell\s*:\s*true/i,
      /\bsubprocess\s*\.\s*(?:Popen|call|run|check_call|check_output)\s*\([^)]*shell\s*=\s*True/i,
      /\bos\s*\.\s*system\s*\(/i,
    ],
    remediation: 'Use argument-array based subprocess invocation without shell: true (e.g. execFile or execFileSync).',
  },
  {
    id: 'SEC-SECRET-01',
    category: 'HARDCODED_SECRET',
    severity: RISK_LEVELS.CRITICAL,
    title: 'Hardcoded Private Key or Cryptographic Secret',
    description: 'Embedded private cryptographic key or token detected in source or configuration.',
    patterns: [
      /-----BEGIN (?:(?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/,
      /\b(?:AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{75,}|sk-[A-Za-z0-9_-]{24,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/,
      /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'@/:]*:[^\s"'@/]+@[^\s"'@/]+/i,
    ],
    remediation: 'Extract credentials to environment variables or local secure vault; never commit secrets in code.',
  },
  {
    id: 'SEC-EVAL-01',
    category: 'INSECURE_EVAL_DESERIALIZE',
    severity: RISK_LEVELS.CRITICAL,
    title: 'Dynamic Code Evaluation or Insecure Deserialization',
    description: 'Execution of dynamic strings as code or unsafe deserialization of untrusted payloads.',
    patterns: [
      /\beval\s*\([^)]{3,}\)/,
      /\bnew\s+Function\s*\([^)]*\)/,
      /\bpickle\s*\.\s*loads?\s*\(/,
      /\byaml\s*\.\s*load\s*\((?![^#)\r\n]*,\s*(?:Loader\s*=\s*)?(?:yaml\s*\.\s*)?(?:CSafeLoader|SafeLoader)\s*\))/,
    ],
    remediation: 'Use safe parsing (JSON.parse, ast.literal_eval, yaml.safe_load) rather than dynamic code execution.',
  },
  {
    id: 'SEC-SQL-01',
    category: 'DYNAMIC_SQL',
    severity: RISK_LEVELS.HIGH,
    title: 'Interpolated SQL Statement',
    description: 'A SQL statement contains inline interpolation or concatenation.',
    patterns: [
      /(?:\bf['"]|`)[^'"`\r\n]*\b(?:SELECT|INSERT|UPDATE|DELETE)\s+[^'"`\r\n]*\{[^}\r\n]+\}/i,
      /['"`]\s*(?:SELECT|INSERT|UPDATE|DELETE)\s+[^'"`\r\n]*['"`]\s*\+\s*\S/i,
    ],
    remediation: 'Use parameterized queries or trusted static query fragments.',
  },
  {
    id: 'SEC-PATH-01',
    category: 'PATH_TRAVERSAL',
    severity: RISK_LEVELS.MEDIUM,
    title: 'Potential Path Traversal Pattern',
    description: 'Unvalidated relative path concatenation containing upward traversal indicators.',
    patterns: [
      /(?:readFile|createReadStream|open|unlink)\s*\([^)]*\.\.\//,
      /(?:readFileSync|writeFileSync)\s*\([^)]*\.\.\//,
    ],
    remediation: 'Normalize paths using path.resolve and validate containment within authorized target root.',
  },
]);

const SCANNABLE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.sh', '.ps1', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.tf', '.properties', '.xml'
]);

const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '.afyx-graph', '.coverage', '__pycache__'
]);

/**
 * Scans a single text content for security violations.
 */
export function auditContent(content, filePath = 'unknown') {
  const findings = [];
  const lines = content.split(/\r?\n/);
  const secretRule = AUDIT_RULES.find((rule) => rule.id === 'SEC-SECRET-01');
  const pathFixture = /(?:^|\/)(?:(?:__tests__|tests?)\/(?:[^/]+\/)*fixtures|test-fixtures)\//.test(filePath.replaceAll('\\', '/'));
  const shellNames = new Set(['exec', 'execSync']);
  const spawnNames = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync']);
  const imports = /(?:import\s*\{([^}]+)\}\s*from\s*|(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*)['"](?:node:)?child_process['"]/g;
  for (const match of content.matchAll(imports)) {
    for (const binding of (match[1] ?? match[2]).split(',')) {
      const entry = /^\s*([\w$]+)(?:\s*(?:as|:)\s*([\w$]+))?\s*$/.exec(binding);
      if (!entry) continue;
      if (shellNames.has(entry[1])) shellNames.add(entry[2] ?? entry[1]);
      if (spawnNames.has(entry[1])) spawnNames.add(entry[2] ?? entry[1]);
    }
  }
  const dynamicShell = new RegExp('(?:^|[^\\w$.])(?:' + [...shellNames].map(n => n.replaceAll('$', '\\$')).join('|') + ')\\s*\\(\\s*[^\\s\'"\\x60]');
  const shellSpawn = new RegExp('(?:^|[^\\w$.])(?:' + [...spawnNames].map(n => n.replaceAll('$', '\\$')).join('|') + ')\\s*\\([^\\n]*\\bshell\\s*:\\s*true\\b');
  const interpolatedShell = new RegExp('(?:^|[^\\w$.])(?:' + [...shellNames].map(n => n.replaceAll('$', '\\$')).join('|') + ')\\s*\\(\\s*\\x60[^\\x60]*\\$\\{');
  const shellCommand = new RegExp('(?:^|[^\\w$.])(?:' + [...spawnNames].map(n => n.replaceAll('$', '\\$')).join('|') +
    ')\\s*\\(\\s*[\'" ](?:[\\w/.-]*/)?(?:sh|bash|zsh|cmd(?:\\.exe)?|powershell(?:\\.exe)?|pwsh)[\'"]\\s*,\\s*\\[\\s*[\'"](?:-c|/c|-command)[\'"]', 'i');
  const assignment = /\b(password|client[_-]?secret|aws_secret_access_key|api[_-]?key|secret[_-]?token|auth[_-]?token|token|secret)\b['"]?\s*[:=]\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([A-Za-z0-9_+/=-]{12,})(?=\s*(?:[#;,]|$)))/i;
  const configSecret = ['.toml', '.tf'].includes(extname(filePath).toLowerCase());
  const placeholder = /^(?:example|sample|placeholder|dummy|redacted|changeme|your[-_]|insert[-_]|\$\{|<|\*+|xxx)/i;
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const assigned = assignment.exec(trimmed);
    const value = assigned?.slice(2).find(part => part !== undefined);
    const generic = /^(?:token|secret)$/i.test(assigned?.[1] ?? '');
    const secret = secretRule.patterns.some(pattern => pattern.test(trimmed))
      || (value && (configSecret || (!generic && value.length >= 12)) && !placeholder.test(value));
    const comment = /^(?:\/\/|#|\*)/.test(trimmed);
    const processSignature = /^(?:exec|execSync)\s*\(\s*(?:[\w$]+\s*:\s*[^)]+\)|[\w$]*\s*\)\s*\{)/.test(trimmed);
    for (const rule of AUDIT_RULES) {
      const matches = rule === secretRule ? secret : !comment &&
        !(rule.id === 'SEC-PATH-01' && pathFixture) &&
        (rule.patterns.some(pattern => pattern.test(trimmed))
          || (rule.id === 'SEC-PROC-01' && !processSignature && (dynamicShell.test(trimmed) || interpolatedShell.test(trimmed) || shellSpawn.test(trimmed) || shellCommand.test(trimmed))));
      if (!matches) continue;
      findings.push({
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        title: rule.title,
        filePath,
        lineNumber: index + 1,
        snippet: '[REDACTED: source line]',
        verification: 'HEURISTIC_CANDIDATE',
        remediation: rule.remediation,
      });
    }
  }
  return findings;
}

export function loadDispositionLedger(ledgerPath) {
  if (!ledgerPath || !existsSync(ledgerPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    if (!Array.isArray(raw?.entries)) return null;
    const ledger = new Map();
    for (const entry of raw.entries) {
      if (!entry.filePath || !entry.lineNumber || !entry.ruleId || !entry.contextDigest) continue;
      const normPath = entry.filePath.replaceAll('\\', '/');
      // Enforce fail-closed boundary: waivers cannot apply to production sources
      if (!/(?:^|\/)(?:tests?|__tests__|scripts\/tests)\//.test(normPath)) continue;
      const key = `${normPath}:${entry.lineNumber}:${entry.ruleId}`;
      ledger.set(key, entry);
    }
    return ledger;
  } catch {
    return null;
  }
}

/**
 * Recursively audits a directory tree.
 */
export function auditDirectory(rootDir, { failOnSeverity = null, maxFiles = 5000, maxDepth = 20,
  maxFileBytes = 1048576, maxTotalBytes = 67108864, maxFindings = 5000, maxDurationMs = 30000, exclusions = [],
  dispositionPath = undefined, dispositionLedger = undefined } = {}) {
  for (const value of [maxFiles, maxDepth, maxFileBytes, maxTotalBytes, maxFindings, maxDurationMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('AUDIT_INVALID_LIMIT');
  }
  let resolvedRoot = resolve(rootDir);
  // macOS /var aliases (and trusted parent aliases) resolve before containment.
  // The selected root itself must still be an ordinary directory.
  try { if (!lstatSync(resolvedRoot).isSymbolicLink()) resolvedRoot = realpathSync(resolvedRoot); } catch { /* reported below */ }
  const excluded = exclusions.map(value => {
    const path = value.replaceAll('\\', '/').replace(/\/$/, '');
    if (!path || isAbsolute(path) || path.includes(':') || path.split('/').some(part => !part || part === '..' || part === '.')) {
      throw new Error('AUDIT_INVALID_EXCLUSION');
    }
    return path;
  });
  if (dispositionLedger === undefined) {
    if (dispositionPath !== undefined) {
      dispositionLedger = dispositionPath ? loadDispositionLedger(resolve(resolvedRoot, dispositionPath)) : null;
    } else {
      const defaultLedger = join(resolvedRoot, 'scripts', 'security-audit-disposition.json');
      dispositionLedger = existsSync(defaultLedger) ? loadDispositionLedger(defaultLedger) : null;
    }
  }
  const findings = [], diagnostics = [], visited = new Set();
  let scannedFilesCount = 0, totalBytes = 0;
  const started = Date.now();
  const diagnostic = (code, file = '') => { if (diagnostics.length < 100) diagnostics.push({ code, path: file }); };
  const within = (file) => { const rel = relative(resolvedRoot, file); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
  function walk(dir, depth = 0) {
    if (Date.now() - started >= maxDurationMs || depth > maxDepth) { diagnostic('SCAN_LIMIT'); return; }
    let entries;
    try { const real = realpathSync(dir); if (!within(real) || visited.has(real)) { diagnostic('PATH_BOUNDARY'); return; }
      visited.add(real); entries = readdirSync(dir).sort(); }
    catch { diagnostic('UNREADABLE_DIRECTORY', relative(resolvedRoot, dir)); return; }
    for (const name of entries) {
      if (IGNORED_DIRECTORIES.has(name)) continue;
      if (scannedFilesCount >= maxFiles || totalBytes >= maxTotalBytes || findings.length >= maxFindings || Date.now() - started >= maxDurationMs) { diagnostic('SCAN_LIMIT'); break; }
      const full = join(dir, name), rel = relative(resolvedRoot, full);
      const portable = rel.split(sep).join('/');
      if (excluded.some(path => portable === path || portable.startsWith(path + '/'))) continue;
      let stat;
      try { stat = lstatSync(full); } catch { diagnostic('UNREADABLE_ENTRY', rel); continue; }
      if (stat.isSymbolicLink()) { diagnostic('SYMLINK_SKIPPED', rel); continue; }
      if (stat.isDirectory()) { walk(full, depth + 1); continue; }
      if (!stat.isFile() || !(SCANNABLE_EXTENSIONS.has(extname(name).toLowerCase()) || /^\.env/i.test(name))) continue;
      if (stat.nlink > 1 || stat.size > maxFileBytes || totalBytes + stat.size > maxTotalBytes) { diagnostic('FILE_LIMIT', rel); continue; }
      let fd;
      try {
        if (!within(realpathSync(full))) { diagnostic('PATH_BOUNDARY', rel); continue; }
        fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.nlink > 1 || opened.ino !== stat.ino || opened.dev !== stat.dev) { diagnostic('FILE_CHANGED', rel); continue; }
        const bytes = Buffer.alloc(Math.min(maxFileBytes, stat.size) + 1);
        const count = readSync(fd, bytes, 0, bytes.length, 0);
        const closedSnapshot = fstatSync(fd);
        if (count !== opened.size || opened.size !== stat.size || closedSnapshot.size !== opened.size ||
            closedSnapshot.mtimeMs !== opened.mtimeMs || closedSnapshot.ctimeMs !== opened.ctimeMs) {
          diagnostic('FILE_CHANGED', rel);
          continue;
        }
        totalBytes += count; scannedFilesCount++;
        const contentStr = bytes.subarray(0, count).toString('utf8');
        const found = auditContent(contentStr, rel);
        if (dispositionLedger && found.length > 0) {
          const lines = contentStr.split(/\r?\n/);
          for (const item of found) {
            const key = `${item.filePath.replaceAll('\\', '/')}:${item.lineNumber}:${item.ruleId}`;
            const waiver = dispositionLedger.get(key);
            if (waiver && waiver.disposition !== 'REMEDIATED') {
              const lineText = lines[item.lineNumber - 1] ?? '';
              const digest = createHash('sha256').update(lineText.trim()).digest('hex');
              if (digest === waiver.contextDigest) {
                item.waived = true;
                item.waiverId = waiver.id;
                item.classification = waiver.classification;
                item.rationale = waiver.rationale;
                item.disposition = waiver.disposition;
              }
            }
          }
        }
        const available = maxFindings - findings.length;
        findings.push(...found.slice(0, available));
        if (found.length > available) diagnostic('FINDING_LIMIT', rel);
      } catch { diagnostic('UNREADABLE_FILE', rel); }
      finally { if (fd !== undefined) closeSync(fd); }
    }
  }
  try {
    if (lstatSync(resolvedRoot).isSymbolicLink() || realpathSync(resolvedRoot) !== resolvedRoot) diagnostic('UNSAFE_ROOT');
    else if (!lstatSync(resolvedRoot).isDirectory()) diagnostic('INVALID_ROOT');
    else walk(resolvedRoot);
  } catch { diagnostic('UNREADABLE_ROOT'); }
  const activeFindings = findings.filter((f) => !f.waived);
  const waivedFindings = findings.filter((f) => f.waived);
  const summary = Object.fromEntries(Object.entries(RISK_LEVELS).map(([key, level]) => [key.toLowerCase(), activeFindings.filter((f) => f.severity === level).length]));
  const waivedSummary = Object.fromEntries(Object.entries(RISK_LEVELS).map(([key, level]) => [key.toLowerCase(), waivedFindings.filter((f) => f.severity === level).length]));
  const failing = failOnSeverity === 'HIGH' ? summary.critical + summary.high > 0 : summary.critical > 0;
  return { contract: SECURITY_AUDITOR_CONTRACT, targetRoot: resolvedRoot, scannedFilesCount, totalBytes,
    status: failing ? 'FAIL' : diagnostics.length ? 'INCOMPLETE' : activeFindings.length ? 'WARNING' : 'PASS',
    summary, waivedSummary, findings: activeFindings, waivedFindings, diagnostics,
    coverage: diagnostics.length ? 'PARTIAL' : 'COMPLETE_WITHIN_RULES',
    verification: 'HEURISTIC_CANDIDATES_NOT_CONFIRMED_VULNERABILITIES' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs({ allowPositionals: true, tokens: true, options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      format: { type: 'string' },
      'max-files': { type: 'string' },
      exclude: { type: 'string', multiple: true },
      disposition: { type: 'string' },
      'no-disposition': { type: 'boolean' },
    } });
    const { values, positionals, tokens } = args;
    const seen = new Set();
    for (const token of tokens) {
      if (token.kind !== 'option' || token.name === 'exclude') continue;
      if (seen.has(token.name)) throw new Error('AUDIT_DUPLICATE_OPTION');
      seen.add(token.name);
    }
    const format = values.format ?? (values.json ? 'json' : 'text');
    if (positionals.length > 1 || (values.json && values.format !== undefined) || !['json', 'text'].includes(format)) {
      throw new Error('AUDIT_INVALID_ARGUMENTS');
    }
    if (values['max-files'] !== undefined && !/^[1-9][0-9]*$/.test(values['max-files'])) {
      throw new Error('AUDIT_INVALID_LIMIT');
    }
    const maxFiles = values['max-files'] === undefined ? undefined : Number(values['max-files']);
    if (maxFiles !== undefined && !Number.isSafeInteger(maxFiles)) throw new Error('AUDIT_INVALID_LIMIT');
    if (values.help) {
      console.log('Usage: node scripts/afyx-security-auditor.mjs [ROOT] [--json | --format json|text] [--max-files N] [--exclude RELATIVE_PATH ...] [--disposition PATH] [--no-disposition]');
    } else {
      const dispositionPath = values['no-disposition'] ? '' : values.disposition;
      const report = auditDirectory(positionals[0] ?? process.cwd(), { maxFiles, exclusions: values.exclude, dispositionPath });
      if (format === 'json') console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`[security-audit] ${report.status} (${report.scannedFilesCount} files, ${report.coverage})`);
        for (const item of report.findings) console.log(`[${item.severity}] ${item.ruleId} ${item.filePath}:${item.lineNumber}`);
        for (const item of report.diagnostics) console.log(`[coverage] ${item.code} ${item.path}`);
        if (report.waivedFindings?.length > 0) {
          console.log(`[security-audit] Waived test fixtures/false positives: ${report.waivedFindings.length}`);
        }
      }
      if (report.status === 'FAIL' || report.coverage === 'PARTIAL' || report.status === 'INCOMPLETE') process.exitCode = 1;
    }
  } catch {
    console.error('[security-audit] Invalid options. See --help.');
    process.exitCode = 2;
  }
}
