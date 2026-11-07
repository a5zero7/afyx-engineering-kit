import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createInstalledHostAdapters,
  extractGraphEvidence,
} from '../afyx-host-adapters.mjs';

const SAMPLE_EXPLORE_OUTPUT = `**Exploration: OrderService**

Found 3 symbols across 1 file.

**Blast radius — what depends on these (update/verify before editing)**

- \`OrderService\` (src/OrderService.ts:1) — 1 reference in \`src/OrderService.ts\`; no tests found within 3 hops
- \`calculateTotal\` (src/OrderService.ts:2) — 1 caller in \`src/OrderService.ts\`; no tests found within 3 caller hops

**Source Code**

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

**\`src/OrderService.ts\`** — OrderService(class), calculateTotal(method), createOrderTotal(function)

\`\`\`typescript
1	export class OrderService {
2	    calculateTotal(price: number, quantity: number): number {
3	        return price * quantity;
4	    }
5	}
6	
7	export function createOrderTotal(): number {
8	    return new OrderService().calculateTotal(10, 2);
9	}
\`\`\`
`;

const SAMPLE_INVENTORY_OUTPUT = `# Declarations matching \`_inherit\` = \`sale.order\`

**Matches:** 2 declarations across 2 files.

- \`SaleOrderCustom\` — \`models/sale_order.py:12\` — module \`sale\` — values \`sale.order\`
- \`SaleOrderExtended\` — \`models/sale_ext.py:45\` — module \`sale\` — values \`sale.order\`
`;

test('extractGraphEvidence parses symbols, lines, types, and calls from explore output', () => {
  const evidence = extractGraphEvidence(SAMPLE_EXPLORE_OUTPUT, false, '/workspace');

  assert.ok(evidence.length >= 4);

  const orderService = evidence.find((e) => e.kind === 'graph-symbol' && e.symbol === 'OrderService');
  assert.ok(orderService, 'OrderService symbol found');
  assert.equal(orderService.file, 'src/OrderService.ts');
  assert.equal(orderService.line, 1);
  assert.equal(orderService.type, 'class');

  const calcTotal = evidence.find((e) => e.kind === 'graph-symbol' && e.symbol === 'calculateTotal');
  assert.ok(calcTotal, 'calculateTotal method found');
  assert.equal(calcTotal.file, 'src/OrderService.ts');
  assert.equal(calcTotal.line, 2);
  assert.equal(calcTotal.type, 'method');

  const createTotal = evidence.find((e) => e.kind === 'graph-symbol' && e.symbol === 'createOrderTotal');
  assert.ok(createTotal, 'createOrderTotal function found');
  assert.equal(createTotal.file, 'src/OrderService.ts');
  assert.equal(createTotal.line, 7);
  assert.equal(createTotal.type, 'function');

  const calls = evidence.filter((e) => e.kind === 'graph-call');
  assert.ok(calls.length >= 1, 'At least one call relationship found');

  const calcTotalCall = calls.find((c) => c.caller === 'createOrderTotal' && c.callee === 'calculateTotal');
  assert.ok(calcTotalCall, 'Call from createOrderTotal to calculateTotal found');
  assert.equal(calcTotalCall.file, 'src/OrderService.ts');
  assert.equal(calcTotalCall.line, 8);
});

test('extractGraphEvidence parses inventory declarations and summary', () => {
  const evidence = extractGraphEvidence(SAMPLE_INVENTORY_OUTPUT, true, '/workspace');
  assert.equal(evidence.length, 3);

  const decl1 = evidence.find((e) => e.kind === 'graph-declaration' && e.symbol === 'SaleOrderCustom');
  assert.ok(decl1);
  assert.equal(decl1.file, 'models/sale_order.py');
  assert.equal(decl1.line, 12);
  assert.equal(decl1.module, 'sale');
  assert.equal(decl1.value, 'sale.order');

  const summary = evidence.find((e) => e.kind === 'graph-inventory-summary');
  assert.ok(summary);
  assert.equal(summary.matchCount, 2);
});

test('extractGraphEvidence handles empty or non-graph stdout gracefully', () => {
  assert.deepEqual(extractGraphEvidence(''), []);
  assert.deepEqual(extractGraphEvidence('   \n  '), []);
  assert.deepEqual(extractGraphEvidence(null), []);
  assert.deepEqual(extractGraphEvidence('random plain text with no matching patterns'), []);
});

test('afyx-graph host adapter reports GRAPH_OUTPUT_EMPTY when exit code is 0 but stdout is empty', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'afyx-adapter-test-'));
  try {
    const installRoot = join(temp, 'install');
    const projectRoot = join(temp, 'project');
    const graphBin = join(installRoot, 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js');

    mkdirSync(join(installRoot, 'graph', 'current', 'lib', 'dist', 'bin'), { recursive: true });
    mkdirSync(projectRoot, { recursive: true });

    // Script that exits 0 with completely empty stdout
    writeFileSync(graphBin, '// empty exit\nprocess.exit(0);\n', 'utf8');

    const adapters = createInstalledHostAdapters({
      installRoot,
      projectRoot,
      nodePath: process.execPath,
    });

    const result = await adapters['afyx-graph']({ intent: 'OrderService' });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.reason, 'GRAPH_OUTPUT_EMPTY');
    assert.equal(result.output, null);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('afyx-graph host adapter propagates environment variables to subprocess', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'afyx-adapter-env-'));
  try {
    const installRoot = join(temp, 'install');
    const projectRoot = join(temp, 'project');
    const graphBin = join(installRoot, 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js');

    mkdirSync(join(installRoot, 'graph', 'current', 'lib', 'dist', 'bin'), { recursive: true });
    mkdirSync(projectRoot, { recursive: true });

    // Script that outputs the custom state dir environment variable
    writeFileSync(
      graphBin,
      'process.stdout.write("STATE:" + (process.env.AFYX_GRAPH_STATE_DIR || "NONE"));\n',
      'utf8',
    );

    const testStateDir = join(temp, 'custom-state-dir');
    const adapters = createInstalledHostAdapters({
      installRoot,
      projectRoot,
      nodePath: process.execPath,
      environment: {
        AFYX_GRAPH_STATE_DIR: testStateDir,
      },
    });

    const result = await adapters['afyx-graph']({ intent: 'OrderService' });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.output, `STATE:${testStateDir}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('extractGraphEvidence safely handles malformed and truncated output', () => {
  const malformed = [
    '### Not a graph format at all\nrandom string',
    '**`incomplete/path`**',
    '**`incomplete/path`** — symbolWithoutParens, another(incomplete',
    '- `Broken` (no-line-number) — invalid details',
    '- callerWithoutArrow',
    '```typescript\nrandom code block without line numbers\n```',
    '12345\t\t\t\t',
    '**Exploration: OrderService**\n\nFound 3 symbols\n- `OrderSer',
    '**`src/OrderService.ts`** — OrderService(class)\n```typescript\n1\texport class Ord',
  ];
  for (const item of malformed) {
    const res = extractGraphEvidence(item, false);
    assert.ok(Array.isArray(res), 'Malformed or truncated input must return an array');
  }
});

test('afyx-graph host adapter reports FAILED on nonzero subprocess exit', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'afyx-adapter-err-'));
  try {
    const installRoot = join(temp, 'install');
    const projectRoot = join(temp, 'project');
    const graphBin = join(installRoot, 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js');

    mkdirSync(join(installRoot, 'graph', 'current', 'lib', 'dist', 'bin'), { recursive: true });
    mkdirSync(projectRoot, { recursive: true });

    // Script that writes stderr and exits with code 1
    writeFileSync(graphBin, 'process.stderr.write("FATAL_GRAPH_CRASH"); process.exit(1);\n', 'utf8');

    const adapters = createInstalledHostAdapters({
      installRoot,
      projectRoot,
      nodePath: process.execPath,
    });

    const result = await adapters['afyx-graph']({ intent: 'OrderService' });
    assert.equal(result.status, 'FAILED');
    assert.ok(result.reason.includes('FATAL_GRAPH_CRASH'));
    assert.equal(result.output, null);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('afyx-graph host adapter preserves raw output byte-for-byte in results output', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'afyx-adapter-raw-'));
  try {
    const installRoot = join(temp, 'install');
    const projectRoot = join(temp, 'project');
    const graphBin = join(installRoot, 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js');

    mkdirSync(join(installRoot, 'graph', 'current', 'lib', 'dist', 'bin'), { recursive: true });
    mkdirSync(projectRoot, { recursive: true });

    const rawExpected = SAMPLE_EXPLORE_OUTPUT;
    writeFileSync(graphBin, `process.stdout.write(${JSON.stringify(rawExpected)});\n`, 'utf8');

    const adapters = createInstalledHostAdapters({
      installRoot,
      projectRoot,
      nodePath: process.execPath,
    });

    const result = await adapters['afyx-graph']({ intent: 'OrderService' });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.output, rawExpected, 'Original output must be preserved byte-for-byte');
    assert.ok(result.evidence.length >= 4, 'Structured evidence is populated alongside output');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('extractGraphEvidence ignores calls in commented lines and deduplicates calls per line', () => {
  const sampleWithComments = `**\`src/CommentService.ts\`** — CommentService(class), doTask(function), targetMethod(method)

\`\`\`typescript
1\texport function doTask(): void {
2\t    // targetMethod(1, 2) should be ignored
3\t    /* targetMethod(3, 4) should also be ignored */
4\t    * targetMethod(5, 6) in javadoc should be ignored
5\t    targetMethod(10); targetMethod(20);
6\t}
\`\`\`
`;
  const evidence = extractGraphEvidence(sampleWithComments, false);
  const calls = evidence.filter((e) => e.kind === 'graph-call');

  // Should only have 1 call entry for line 5 (deduplicated for line 5, lines 2, 3, 4 ignored)
  assert.equal(calls.length, 1);
  assert.equal(calls[0].caller, 'doTask');
  assert.equal(calls[0].callee, 'targetMethod');
  assert.equal(calls[0].line, 5);
});

test('extractGraphEvidence caps maximum extracted evidence at 200 items', () => {
  let hugeOutput = '**Exploration: Huge**\n\n';
  for (let i = 0; i < 300; i++) {
    hugeOutput += `- \`Sym${i}\` (src/file${i}.ts:${i}) — caller\n`;
  }
  const evidence = extractGraphEvidence(hugeOutput, false);
  assert.ok(evidence.length <= 200, `Expected <= 200 items, got ${evidence.length}`);
});
