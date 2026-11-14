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

import { readFileSync, readdirSync, lstatSync, realpathSync, openSync, readSync, closeSync, fstatSync, constants } from 'node:fs';
import { extname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    description: 'Embedded private cryptographic key or token detected in active source file.',
    patterns: [
      /-----BEGIN\s+(?:RSA|OPENSSH|EC|PGP|PRIVATE)\s+KEY-----/,
      /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
      /(?:api[_-]?key|secret[_-]?token|auth[_-]?token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{24,}['"]/i,
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
      /\byaml\s*\.\s*load\s*\([^,)]*Loader\s*=\s*(?:yaml\.)?(?:UnsafeLoader|Loader)\s*\)/,
    ],
    remediation: 'Use safe parsing (JSON.parse, ast.literal_eval, yaml.safe_load) rather than dynamic code execution.',
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
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.sh', '.ps1', '.json', '.yaml', '.yml'
]);

const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '.afyx-graph', 'dist', 'build', '.coverage', '__pycache__'
]);

/**
 * Scans a single text content for security violations.
 */
export function auditContent(content, filePath = 'unknown') {
  const findings = [];
  const lines = content.split(/\r?\n/);
  const secretRule = AUDIT_RULES.find((rule) => rule.id === 'SEC-SECRET-01');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    for (const rule of AUDIT_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(line)) {
          // Avoid triggering on comments explaining rules or test mocks
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
            continue;
          }
          findings.push({
            ruleId: rule.id,
            category: rule.category,
            severity: rule.severity,
            title: rule.title,
            filePath,
            lineNumber: lineIdx + 1,
            snippet: secretRule.patterns.some((pattern) => pattern.test(line)) ? '[REDACTED: sensitive source line]' : trimmed.slice(0, 120),
            verification: 'HEURISTIC_CANDIDATE',
            remediation: rule.remediation,
          });
          break; // Avoid duplicate reports for same rule on same line
        }
      }
    }
  }

  return findings;
}

/**
 * Recursively audits a directory tree.
 */
export function auditDirectory(rootDir, { failOnSeverity = null, maxFiles = 1000, maxDepth = 20,
  maxFileBytes = 1048576, maxTotalBytes = 16777216, maxFindings = 1000, maxDurationMs = 5000 } = {}) {
  for (const value of [maxFiles, maxDepth, maxFileBytes, maxTotalBytes, maxFindings, maxDurationMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('AUDIT_INVALID_LIMIT');
  }
  const resolvedRoot = resolve(rootDir), findings = [], diagnostics = [], visited = new Set();
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
      let stat;
      try { stat = lstatSync(full); } catch { diagnostic('UNREADABLE_ENTRY', rel); continue; }
      if (stat.isSymbolicLink()) { diagnostic('SYMLINK_SKIPPED', rel); continue; }
      if (stat.isDirectory()) { walk(full, depth + 1); continue; }
      if (!stat.isFile() || !SCANNABLE_EXTENSIONS.has(extname(name).toLowerCase())) continue;
      if (stat.nlink > 1 || stat.size > maxFileBytes || totalBytes + stat.size > maxTotalBytes) { diagnostic('FILE_LIMIT', rel); continue; }
      let fd;
      try {
        if (!within(realpathSync(full))) { diagnostic('PATH_BOUNDARY', rel); continue; }
        fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.nlink > 1 || opened.ino !== stat.ino || opened.dev !== stat.dev) { diagnostic('FILE_CHANGED', rel); continue; }
        const bytes = Buffer.alloc(Math.min(maxFileBytes, stat.size) + 1);
        const count = readSync(fd, bytes, 0, bytes.length, 0);
        if (count > stat.size || count > maxFileBytes) { diagnostic('FILE_CHANGED', rel); continue; }
        totalBytes += count; scannedFilesCount++;
        const found = auditContent(bytes.subarray(0, count).toString('utf8'), rel);
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
  const summary = Object.fromEntries(Object.entries(RISK_LEVELS).map(([key, level]) => [key.toLowerCase(), findings.filter((f) => f.severity === level).length]));
  const failing = failOnSeverity === 'HIGH' ? summary.critical + summary.high > 0 : summary.critical > 0;
  return { contract: SECURITY_AUDITOR_CONTRACT, targetRoot: resolvedRoot, scannedFilesCount, totalBytes,
    status: failing ? 'FAIL' : diagnostics.length ? 'INCOMPLETE' : findings.length ? 'WARNING' : 'PASS',
    summary, findings, diagnostics, coverage: diagnostics.length ? 'PARTIAL' : 'COMPLETE_WITHIN_RULES',
    verification: 'HEURISTIC_CANDIDATES_NOT_CONFIRMED_VULNERABILITIES' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] || process.cwd();
  const isJson = process.argv.includes('--json');
  const report = auditDirectory(target);

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[security-audit] Target: ${report.targetRoot}`);
    console.log(`[security-audit] Scanned Files: ${report.scannedFilesCount}`);
    console.log(`[security-audit] Verdict: ${report.status} (Critical: ${report.summary.critical}, High: ${report.summary.high}, Medium: ${report.summary.medium})`);
    if (report.findings.length > 0) {
      console.log('\n--- Findings ---');
      for (const f of report.findings) {
        console.log(`[${f.severity}] ${f.ruleId}: ${f.title}`);
        console.log(`  File: ${f.filePath}:${f.lineNumber}`);
        console.log(`  Code: ${f.snippet}`);
        console.log(`  Fix:  ${f.remediation}\n`);
      }
    }
  }

  if (report.status === 'FAIL' || report.status === 'INCOMPLETE') process.exit(1);
}
