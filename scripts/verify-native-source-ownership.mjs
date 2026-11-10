#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
};
const repository = resolve(argument('--root', resolve(scriptDirectory, '..')));
const manifestPath = resolve(argument('--manifest', join(scriptDirectory, 'native-source-ownership.json')));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let ts = null;
const searchPaths = [
  join(repository, 'afyx-graph', 'engine', 'package.json'),
  join(process.cwd(), 'afyx-graph', 'engine', 'package.json'),
  join(process.cwd(), 'package.json'),
  import.meta.url,
];
for (const p of searchPaths) {
  try {
    ts = createRequire(p)('typescript');
    if (ts) break;
  } catch {
    // continue search
  }
}

const allowed = new Set([
  'AFYX_NATIVE_IMPLEMENTATION',
  'PUBLIC_API_BARREL',
  'PUBLIC_CONTRACT',
  'PRODUCT_SCHEMA_DATA',
  'STANDARD_PLATFORM_DATA',
  'THIRD_PARTY_COVERED',
  'PROVENANCE_REVIEW_REQUIRED',
]);

/**
 * Substantive inherited patterns from historical comparator implementations.
 * Active production sources must never contain these patterns.
 * Pre-push and CI fail closed if any are discovered.
 */
const PROHIBITED_SUBSTANTIVE_PATTERNS = [
  {
    name: 'Historical ORM_COMMON_OPS regex concatenation',
    pattern: /ORM_COMMON_OPS\s*=\s*['"]\(\?:find\|findOne\|findAll/i,
  },
  {
    name: 'Historical DB_ACCESS_OPERATIONS regex concatenation',
    pattern: /DB_ACCESS_OPERATIONS\s*=\s*['"]\(\?:find\\w\*\|get\|getOne/i,
  },
  {
    name: 'Historical BUILTIN_SYSTEM_RECEIVERS regex signature',
    pattern: /BUILTIN_SYSTEM_RECEIVERS\s*=\s*\/[\^]?\(\?:Object\|Array\|Promise/i,
  },
  {
    name: 'Historical upstream product author attribution in active source',
    pattern: new RegExp('Copyright\\s+\\(c\\)\\s+\\d{4}\\s+' + ['Code', 'Graph'].join(''), 'i'),
  },
  {
    name: 'Historical upstream package identifier in active imports',
    pattern: new RegExp('from\\s+[\'"]@' + ['code', 'graph'].join('') + '\\/', 'i'),
  },
];

/**
 * Architecture-level guard for the independently rewritten effect classifier.
 * Historical implementations encoded the domain model in very large regular
 * expressions. AFYX deliberately uses tokenisation plus explicit operation and
 * receiver sets; these limits are code-owned policy and cannot be relaxed by
 * editing the ownership manifest or merely updating its reviewed hash.
 */
const EFFECT_CLASSIFIER_POLICY = Object.freeze({
  path: 'afyx-graph/engine/src/ui-server/api/effects.ts',
  maximumRegexOccurrences: 24,
  maximumRegexLiteralLength: 80,
  maximumAlternationsPerLiteral: 8,
});

function regexInventory(filePath, content) {
  if (ts) {
    const ast = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const literals = [];
    function visit(node) {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
        const literal = node.getText(ast);
        literals.push({ literal, alternations: (literal.match(/\|/g) ?? []).length });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    return literals;
  }
  // Standalone fallback scanner when TypeScript runtime is not yet installed
  const matches = content.match(/\/(?![*+?])(?:[^\r\n\[/\\]|\\.|\[(?:[^\r\n\]\\]|\\.)*\])+\/[dgimsuy]*/g) ?? [];
  return matches.map((literal) => ({
    literal,
    alternations: (literal.match(/\|/g) ?? []).length,
  }));
}

function verifyEffectClassifierArchitecture(filePath, content) {
  const inventory = regexInventory(filePath, content);
  if (inventory.length > EFFECT_CLASSIFIER_POLICY.maximumRegexOccurrences) {
    fail(`effect classifier regex budget exceeded: ${inventory.length} > ${EFFECT_CLASSIFIER_POLICY.maximumRegexOccurrences}`);
  }
  for (const item of inventory) {
    if (item.literal.length > EFFECT_CLASSIFIER_POLICY.maximumRegexLiteralLength) {
      fail(`effect classifier contains an oversized regex literal (${item.literal.length} characters)`);
    }
    if (item.alternations > EFFECT_CLASSIFIER_POLICY.maximumAlternationsPerLiteral) {
      fail(`effect classifier contains a regex-encoded domain list (${item.alternations} alternations)`);
    }
  }
}

function fail(message) {
  console.error(`[native-source-ownership] FAIL: ${message}`);
  process.exitCode = 1;
}

if (manifest.schema !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length === 0) {
  fail('manifest identity or reviewed entry count is invalid');
} else {
  const seen = new Set();
  const manifestPaths = new Set();

  for (const entry of manifest.entries) {
    if (seen.has(entry.path)) fail(`duplicate entry: ${entry.path}`);
    seen.add(entry.path);
    manifestPaths.add(entry.path);

    if (!allowed.has(entry.classification)) fail(`unsupported classification: ${entry.path}`);
    if (entry.classification === 'PROVENANCE_REVIEW_REQUIRED') {
      fail(`unresolved substantive provenance review: ${entry.path}`);
    }
    if (typeof entry.evidence !== 'string' || entry.evidence.trim().length < 30) {
      fail(`missing substantive review evidence: ${entry.path}`);
    }

    const fullPath = join(repository, ...entry.path.split('/'));
    let bytes;
    try {
      bytes = readFileSync(fullPath);
    } catch (err) {
      fail(`file missing from disk: ${entry.path}`);
      continue;
    }
    const content = bytes.toString('utf8');

    if (entry.path === EFFECT_CLASSIFIER_POLICY.path) {
      verifyEffectClassifierArchitecture(fullPath, content);
    }

    // 1. Verify content does not contain prohibited inherited substantive patterns
    for (const probe of PROHIBITED_SUBSTANTIVE_PATTERNS) {
      if (probe.pattern.test(content)) {
        fail(`prohibited substantive inherited pattern detected (${probe.name}) in ${entry.path}`);
      }
    }

    // 2. Verify SHA-256 integrity against reviewed baseline (LF-normalized for cross-platform Git checkout)
    const normalized = content.replace(/\r\n/g, '\n');
    const actual = createHash('sha256').update(Buffer.from(normalized, 'utf8')).digest('hex');
    if (actual !== entry.reviewedSha256) fail(`reviewed source drift: ${entry.path}`);
    if (entry.baselineSha256 && actual === entry.baselineSha256) {
      fail(`source reverted to the pre-remediation baseline: ${entry.path}`);
    }
  }

  // 3. Scan all active engine and UI source files for coverage and prohibited patterns
  const productionRoots = [
    join(repository, 'afyx-graph', 'engine', 'src'),
    join(repository, 'afyx-graph', 'engine', 'ui', 'src'),
  ];

  function scanDir(dir) {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return;
    for (const name of readdirSync(dir)) {
      if (['node_modules', '__tests__', 'test', 'tests', 'fixtures', 'dist', 'build'].includes(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        scanDir(full);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !/\.(test|spec|d)\.ts$/.test(name)) {
        const rel = relative(repository, full).replace(/\\/g, '/');
        // If manifest covers full production files (> 100 entries), enforce that every disk file is classified
        if (manifest.entries.length > 100 && !manifestPaths.has(rel)) {
          fail(`unclassified production source file detected: ${rel}`);
        }
        const text = readFileSync(full, 'utf8');
        for (const probe of PROHIBITED_SUBSTANTIVE_PATTERNS) {
          if (probe.pattern.test(text)) {
            fail(`prohibited substantive inherited pattern detected (${probe.name}) in ${rel}`);
          }
        }
      }
    }
  }

  try {
    for (const root of productionRoots) {
      scanDir(root);
    }
  } catch (err) {
    fail(`source scanning error: ${err.message}`);
  }
}

if (!process.exitCode) {
  console.log(`[native-source-ownership] PASS: ${manifest.entries.length} production files match reviewed classifications, hashes, and fail-closed substantive provenance checks`);
}
