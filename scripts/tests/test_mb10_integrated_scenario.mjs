import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createGraphAceConsumer,
  createEngineeringMemory,
  compressContextItems,
} from '../../afyx-context/src/index.js';
import {
  createForgePlan,
  refineTaskDirective,
  evaluateTaskCompletion,
} from '../../afyx-forge/src/index.js';
import { auditDirectory } from '../afyx-security-auditor.mjs';

describe('T11: End-to-End Integrated Engineering Scenario (Forge -> Graph -> Context -> Security -> Plan)', () => {
  const fixtureSource = join(
    process.cwd(),
    'afyx-context',
    'test-fixtures',
    'integrated-dogfood-repo'
  );
  const graphDist = join(process.cwd(), 'afyx-graph', 'engine', 'dist');

  let tempLab;
  let graphInstance = null;
  let GraphClass;
  let ToolHandlerClass;

  it('Setup: clone fixture and initialize native runtimes', async () => {
    assert.ok(existsSync(fixtureSource), `Fixture exists: ${fixtureSource}`);
    tempLab = mkdtempSync(join(tmpdir(), 'afyx-mb10-scenario-'));
    cpSync(fixtureSource, tempLab, { recursive: true });

    const graphModule = await import(pathToFileURL(join(graphDist, 'index.js')).href);
    const toolsModule = await import(pathToFileURL(join(graphDist, 'mcp', 'tools.js')).href);
    GraphClass = graphModule.default?.default ?? graphModule.default ?? graphModule.AfyxGraph;
    ToolHandlerClass = toolsModule.ToolHandler;
    assert.ok(GraphClass, 'GraphClass loaded');
    assert.ok(ToolHandlerClass, 'ToolHandlerClass loaded');
  });

  it('Step 1: Forge workflow refiner distills raw task directive into high-signal criteria', () => {
    const rawDirective = `
      Please act as a principal systems architect and lead security engineer.
      Make sure you think step by step and be very careful.
      # Technical Objective
      Conduct security audit and architect audit logging extension for Odoo sales orders.
      # Requirements
      - Scan active models for unsafe subprocess invocations and secret leaks
      - Index data models and trace inheritance between sale.order and sale.order.audit
      - Store architectural design decisions in persistent engineering memory
      - Deliver bounded execution plan without repository mutation
      # Constraints
      - Never modify source files without explicit confirmation
    `;

    const refined = refineTaskDirective(rawDirective);
    assert.ok(refined.characterSavings > 50);
    assert.ok(refined.acceptanceCriteria.length >= 4);
    assert.ok(refined.constraints.length >= 1);
  });

  it('Step 2: Read-Only Security Auditor scans fixture repository', () => {
    const auditReport = auditDirectory(tempLab);
    assert.equal(auditReport.status, 'PASS');
    assert.equal(auditReport.summary.critical, 0);
    assert.equal(auditReport.summary.high, 0);
    assert.ok(auditReport.scannedFilesCount >= 4);
  });

  it('Step 3: Graph engine indexes fixture and queries structural relationships', async () => {
    graphInstance = GraphClass.initSync(tempLab);
    const indexResult = await graphInstance.indexAll();
    assert.equal(indexResult.success, true);
    assert.ok(indexResult.filesIndexed >= 3);

    const toolHandler = new ToolHandlerClass(graphInstance);
    const inventoryResult = await toolHandler.execute('afyx_graph_inventory', {
      declaration: '_inherit',
      value: 'sale.order',
      limit: 10,
    });

    assert.equal(inventoryResult.isError, undefined);
    assert.ok(inventoryResult.content.some((c) => c.text.includes('sale_order.py')));
  });

  it('Step 4: Context Engine manages memory and compresses retrieved evidence within budget', () => {
    const memory = createEngineeringMemory({ projectRoot: tempLab, enabled: true });
    memory.record({
      key: 'sale-order-audit-inheritance',
      category: 'architecture',
      content: 'SaleOrderAudit extends models.Model and inherits sale_order relational fields.',
      tags: ['odoo', 'models', 'audit'],
      source: 'addons/integrated_sales/models/sale_order_audit.py',
    });

    const retrievedMemories = memory.retrieve({ query: 'SaleOrderAudit relational fields', limit: 1 });
    assert.equal(retrievedMemories.length, 1);
    assert.equal(retrievedMemories[0].key, 'sale-order-audit-inheritance');

    const rawPayloads = [
      {
        id: 'memory-context',
        text: memory.formatForContext(retrievedMemories),
        priority: 10,
        references: ['SaleOrderAudit'],
      },
      {
        id: 'graph-exploration',
        text: 'Node: SaleOrderAudit (class)\nExtends: models.Model\nField: order_id (Many2one -> sale.order)\n'.repeat(10),
        priority: 5,
        references: ['sale.order'],
      },
    ];

    const compressed = compressContextItems(rawPayloads, { maxBytes: 1000, maxLines: 20 });
    assert.equal(compressed.contract, 'afyx-context-budget-v1');
    assert.ok(compressed.metrics.consumedBytes <= 1200);
    assert.ok(compressed.preservedReferences.includes('SaleOrderAudit'));
  });

  it('Step 5: Forge generates final verified plan and completes criteria validation', () => {
    const plan = createForgePlan({
      taskText: 'Architect and verify audit logging extension for Odoo sales orders',
      format: 'json',
      environment: {
        hasGraph: true,
        hasContext: true,
        contextOptIn: true,
        graphOptIn: true,
      },
    });

    assert.equal(plan.status, 'PLANNED');
    assert.equal(plan.boundedExecution.autonomousCodeExecution, false);

    const verifiedEvidence = [
      'Scan active models for unsafe subprocess invocations passed with zero critical findings',
      'Index data models and trace inheritance between sale.order and sale.order.audit completed',
      'Store architectural design decisions in persistent engineering memory recorded',
      'Deliver bounded execution plan without repository mutation generated and planned',
    ];

    const criteria = [
      { id: 'AC-1', text: 'Scan active models for unsafe subprocess invocations and secret leaks' },
      { id: 'AC-2', text: 'Index data models and trace inheritance between sale.order and sale.order.audit' },
      { id: 'AC-3', text: 'Store architectural design decisions in persistent engineering memory' },
      { id: 'AC-4', text: 'Deliver bounded execution plan without repository mutation' },
    ];

    const evaluation = evaluateTaskCompletion(criteria, verifiedEvidence);
    assert.equal(evaluation.isComplete, true);
    assert.equal(evaluation.completionScore, 1.0);
  });

  it('Cleanup: close database and safely remove lab directory', () => {
    if (graphInstance) {
      try {
        graphInstance.close();
      } catch {
        // ignore
      }
    }
    if (tempLab && existsSync(tempLab)) {
      rmSync(tempLab, { recursive: true, force: true });
    }
  });
});
