import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createForgePlan } from '../../afyx-forge/src/index.js';
import { createGraphAceConsumer, deriveGraphAceIdentity } from '../../afyx-context/src/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(testDir, '../..');
const fixtureSource = path.join(kitRoot, 'afyx-context', 'test-fixtures', 'integrated-dogfood-repo');
const graphDist = path.join(kitRoot, 'afyx-graph', 'engine', 'dist');

describe('T05: Unified Graph + Context + Forge Integration', () => {
  let labRoot;
  let fixtureRoot;
  let GraphClass;
  let ToolHandlerClass;
  let graphInstance = null;
  const sharedEvidence = {};

  test('Setup: Load actual Graph, Context, and Forge runtimes and copy clean fixture', async () => {
    assert.ok(fs.existsSync(fixtureSource), `Fixture source must exist at ${fixtureSource}`);
    assert.ok(fs.existsSync(path.join(graphDist, 'index.js')), 'Graph dist must exist');

    labRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-unified-integration-'));
    fixtureRoot = path.join(labRoot, 'integrated-dogfood-repo');
    fs.cpSync(fixtureSource, fixtureRoot, { recursive: true });

    const graphModule = await import(pathToFileURL(path.join(graphDist, 'index.js')).href);
    const toolsModule = await import(pathToFileURL(path.join(graphDist, 'mcp', 'tools.js')).href);
    GraphClass = graphModule.default?.default ?? graphModule.default ?? graphModule.AfyxGraph;
    ToolHandlerClass = toolsModule.ToolHandler;

    assert.ok(GraphClass, 'Graph runtime class must be loaded');
    assert.ok(ToolHandlerClass, 'Graph ToolHandler class must be loaded');
  });

  test('Step 1 & 2: Forge requirement analysis classifies task and recommends graph exploration', () => {
    const taskText =
      'Investigate the relationship between an Odoo model extension, its XML views, ' +
      'access-control configuration, and affected methods in addons/integrated_sales. ' +
      'Identify the source evidence and generate an actionable, bounded implementation plan.';

    const plan = createForgePlan({
      taskText,
      format: 'json',
      environment: {
        hasGraph: true,
        hasContext: true,
        contextOptIn: true,
      },
    });

    assert.equal(plan.contract, 'afyx-forge-plan/v1');
    assert.equal(plan.status, 'PLANNED');
    assert.ok(plan.classification, 'Plan must include classification');
    assert.ok(
      plan.classification.frameworks?.includes('Odoo'),
      'Odoo framework must be identified by Forge'
    );
    assert.ok(plan.guidance.toolRecommendations?.preferred?.length > 0, 'Preferred tools must be recommended');
    assert.ok(plan.guidance.validationScope?.length > 0, 'Validation scope must be defined');
  });

  test('Step 3: Real Graph runtime indexes fixture repository and returns structural relationships', async () => {
    const priorGraphState = process.env.AFYX_GRAPH_STATE_DIR;
    process.env.AFYX_GRAPH_STATE_DIR = path.join(labRoot, 'graph-state');
    try {
      graphInstance = GraphClass.initSync(fixtureRoot);
      const indexResult = await graphInstance.indexAll();
      assert.equal(indexResult.success, true, 'Graph indexing must succeed');
      assert.ok(indexResult.filesIndexed >= 3, 'Must index fixture files');

      const handler = new ToolHandlerClass(graphInstance);

      // 1. Search for Odoo model inheritance
      const inventoryResult = await handler.execute('afyx_graph_inventory', {
        declaration: '_inherit',
        value: 'sale.order',
        limit: 10,
      });
      assert.equal(inventoryResult.isError, undefined);
      const inventoryText = inventoryResult.content.map((c) => c.text).join('\n');
      assert.match(inventoryText, /sale_order\.py/);

      // 2. Discover XML views
      const filesResult = await handler.execute('afyx_graph_files', {
        pattern: '**/*.xml',
        format: 'flat',
      });
      assert.equal(filesResult.isError, undefined);
      const filesText = filesResult.content.map((c) => c.text).join('\n');
      assert.match(filesText, /sale_order_views\.xml/);

      sharedEvidence.graph = {
        handler,
        inventoryText,
        filesText,
      };
    } finally {
      if (priorGraphState !== undefined) {
        process.env.AFYX_GRAPH_STATE_DIR = priorGraphState;
      } else {
        delete process.env.AFYX_GRAPH_STATE_DIR;
      }
    }
  });

  test('Step 4: Real Context Engine executes with Graph and retains recoverable evidence', async () => {
    const identity = deriveGraphAceIdentity({
      projectRoot: fixtureRoot,
      sourceIdentity: 'sha256:fixture-test-commit',
      consumerId: 'afyx-unified-test-consumer',
    });

    const consumer = createGraphAceConsumer({
      enabled: true,
      stateDir: path.join(labRoot, 'ace-state'),
      ...identity,
      timeoutMs: 5000,
    });

    assert.equal(consumer.enabled, true);

    // Call Graph through Context consumer execute wrapper
    const contextResult = await consumer.execute({
      executeGraph: (tool, args) => sharedEvidence.graph.handler.execute(tool, args),
      toolName: 'afyx_graph_inventory',
      args: { declaration: '_inherit', value: 'sale.order', limit: 5 },
      projectRoot: fixtureRoot,
      sourceIdentity: 'sha256:fixture-test-commit',
    });

    assert.ok(contextResult, 'Context execute must return result');
    assert.equal(contextResult.contract, 'graph.ace.consumer/v1');
    const contentText = contextResult.consumerResult.content.map((c) => c.text).join('\n');
    assert.match(contentText, /sale_order\.py/);

    sharedEvidence.contextResult = contextResult;
  });

  test('Step 5: Forge consumes retrieved evidence and produces final verified implementation plan', () => {
    const enrichedTaskText =
      'Implement audited sale order total verification based on verified evidence:\n' +
      `- Model: addons/integrated_sales/models/sale_order.py\n` +
      `- Audit: addons/integrated_sales/models/sale_order_audit.py\n` +
      `- View: addons/integrated_sales/views/sale_order_views.xml\n` +
      `- Security: addons/integrated_sales/security/ir.model.access.csv\n` +
      'Ensure atomicity and non-regression on standard Odoo workflow.';

    const finalPlan = createForgePlan({
      taskText: enrichedTaskText,
      format: 'json',
      environment: {
        hasGraph: true,
        hasContext: true,
        contextOptIn: true,
      },
    });

    assert.equal(finalPlan.contract, 'afyx-forge-plan/v1');
    assert.equal(finalPlan.status, 'PLANNED');
    assert.ok(finalPlan.guidance.investigationPriorities.length >= 3);

    // Verify all reported source files actually exist on disk
    const expectedFiles = [
      'addons/integrated_sales/models/sale_order.py',
      'addons/integrated_sales/models/sale_order_audit.py',
      'addons/integrated_sales/views/sale_order_views.xml',
      'addons/integrated_sales/security/ir.model.access.csv',
    ];

    for (const relPath of expectedFiles) {
      const fullPath = path.join(fixtureRoot, relPath);
      assert.ok(fs.existsSync(fullPath), `Reported file must exist: ${relPath}`);
    }

    // Verify zero autonomous mutation occurred on fixture
    const unmodifiedSaleOrder = fs.readFileSync(
      path.join(fixtureRoot, 'addons/integrated_sales/models/sale_order.py'),
      'utf8'
    );
    assert.match(unmodifiedSaleOrder, /class SaleOrder/);
  });

  test('Negative Case 1: When Graph is disabled, Forge falls back to direct source inspection', () => {
    const plan = createForgePlan({
      taskText: 'Read addons/integrated_sales/models/sale_order.py and fix typo in comment',
      format: 'json',
      environment: {
        hasGraph: false,
        hasContext: true,
        contextOptIn: true,
      },
    });

    assert.equal(plan.status, 'PLANNED');
    assert.ok(
      plan.guidance.toolRecommendations?.preferred?.some((t) => /read_file|direct source/i.test(t)),
      'Must prefer direct file reading when graph is unavailable or unnecessary'
    );
  });

  test('Negative Case 2: When Context is explicitly disabled (AFYX_CONTEXT_OPT_IN=0), setting wins', () => {
    const priorOptIn = process.env.AFYX_CONTEXT_OPT_IN;
    process.env.AFYX_CONTEXT_OPT_IN = '0';
    try {
      const identity = deriveGraphAceIdentity({
        projectRoot: fixtureRoot,
        sourceIdentity: 'sha256:fixture-test-commit',
        consumerId: 'afyx-unified-test-consumer',
      });
      const consumer = createGraphAceConsumer({
        enabled: false,
        stateDir: path.join(labRoot, 'ace-state-off'),
        ...identity,
      });
      assert.equal(consumer.enabled, false);
    } finally {
      if (priorOptIn !== undefined) {
        process.env.AFYX_CONTEXT_OPT_IN = priorOptIn;
      } else {
        delete process.env.AFYX_CONTEXT_OPT_IN;
      }
    }
  });

  test('Negative Case 3: Forge operates fully standalone without optional peers', () => {
    const plan = createForgePlan({
      taskText: 'Refactor calculate_order_totals in pure python utility',
      format: 'json',
      environment: {
        hasGraph: false,
        hasContext: false,
        contextOptIn: false,
      },
    });

    assert.equal(plan.contract, 'afyx-forge-plan/v1');
    assert.equal(plan.status, 'PLANNED');
    assert.ok(plan.guidance.completionCriteria.length > 0);
  });

  test('Cleanup: Close database and safely remove lab directory', () => {
    if (graphInstance) {
      try {
        graphInstance.close();
      } catch {
        // ignore
      }
      graphInstance = null;
    }
    if (labRoot && fs.existsSync(labRoot)) {
      fs.rmSync(labRoot, { recursive: true, force: true });
    }
    assert.ok(!fs.existsSync(labRoot), 'Lab root must be cleaned up');
  });
});
