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
