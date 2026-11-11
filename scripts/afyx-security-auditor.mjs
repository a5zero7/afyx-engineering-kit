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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
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
            snippet: trimmed.slice(0, 120),
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
export function auditDirectory(rootDir, { failOnSeverity = null } = {}) {
  const resolvedRoot = resolve(rootDir);
  const allFindings = [];
  let scannedFilesCount = 0;

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry)) continue;
      const fullPath = join(dir, entry);
      let st;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        walk(fullPath);
      } else if (st.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (SCANNABLE_EXTENSIONS.has(ext)) {
          scannedFilesCount++;
          try {
            const content = readFileSync(fullPath, 'utf8');
            const relPath = relative(resolvedRoot, fullPath).replace(/\\/g, '/');
            const fileFindings = auditContent(content, relPath);
            allFindings.push(...fileFindings);
          } catch {
            // Unreadable file skipped cleanly
          }
        }
      }
    }
  }

  walk(resolvedRoot);

  const summary = {
    critical: allFindings.filter((f) => f.severity === RISK_LEVELS.CRITICAL).length,
    high: allFindings.filter((f) => f.severity === RISK_LEVELS.HIGH).length,
    medium: allFindings.filter((f) => f.severity === RISK_LEVELS.MEDIUM).length,
    low: allFindings.filter((f) => f.severity === RISK_LEVELS.LOW).length,
  };

  const hasFailingFindings = failOnSeverity === 'HIGH'
    ? summary.critical > 0 || summary.high > 0
    : summary.critical > 0;

  return {
    contract: SECURITY_AUDITOR_CONTRACT,
    targetRoot: resolvedRoot,
    scannedFilesCount,
    status: allFindings.length === 0 ? 'PASS' : hasFailingFindings ? 'FAIL' : 'WARNING',
    summary,
    findings: allFindings,
  };
}

// CLI entry point
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

  if (report.status === 'FAIL') process.exit(1);
}
