import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import AfyxGraph from '../src/index';
import { extractNativeFacts } from '../src/extraction/native/fact-extractor';
import { parsePythonStaticStringValues } from '../src/extraction/native/python-class-assignments';
import { executeInventoryTool } from '../src/mcp/inventory-tool';
import { ToolHandler } from '../src/mcp/tools';
import type { FileRecord, Node } from '../src/types';

function model(name: string, value = "'sale.order'"): string {
  return `class ${name}(models.Model):\n    _inherit = ${value}\n`;
}

describe('Python structural class-assignment inventory', () => {
  let root = '';
  let graph: AfyxGraph | null = null;

  afterEach(() => {
    try { graph?.destroy(); } catch { /* already closed */ }
    graph = null;
    if (root) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    root = '';
  });

  it('extracts source-located scalar/list/tuple facts without false positives', () => {
    const source = [
      'from odoo import models',
      'class Scalar(models.Model):',
      "    _inherit = 'sale.order'",
      '    _name = "custom.scalar"',
      'class Multi(models.Model):',
      '    _inherit = [',
      "        'sale.order',",
      "        'pos.load.mixin',",
      '    ]',
      'class Tupled(models.Model):',
      "    _inherit = ('sale.order',)",
      'class Dynamic(models.Model):',
      '    _inherit = inherited_model()',
      'class Negative(models.Model):',
      "    _inherit = 'sale.order.line'",
      "    note = \"_inherit = 'sale.order'\"",
      "# _inherit = 'sale.order'",
      '    def method(self):',
      "        _inherit = 'sale.order'",
    ].join('\n');
    const result = extractNativeFacts('addons/demo/models/sale.py', source, 'python');
    const inheritance = result.nodes.filter((node) => node.kind === 'property' && node.name === '_inherit');
    expect(inheritance).toHaveLength(5);
    expect(inheritance.map((node) => [node.qualifiedName, node.startLine, node.signature])).toEqual([
      ['Scalar::_inherit', 3, "= 'sale.order'"],
      ['Multi::_inherit', 6, expect.stringContaining("'pos.load.mixin'")],
      ['Tupled::_inherit', 11, "= ('sale.order',)"],
      ['Dynamic::_inherit', 13, '= inherited_model()'],
      ['Negative::_inherit', 15, "= 'sale.order.line'"],
    ]);
    expect(result.nodes).toContainEqual(expect.objectContaining({
      kind: 'property', name: '_name', qualifiedName: 'Scalar::_name', signature: '= "custom.scalar"',
    }));
    expect(parsePythonStaticStringValues("['sale.order', 'pos.load.mixin']")).toEqual(['sale.order', 'pos.load.mixin']);
    expect(parsePythonStaticStringValues('inherited_model()')).toBeNull();
  });

  it('separates query-scoped Python diagnostics from global index diagnostics', () => {
    const target: Node = {
      id: 'target', kind: 'property', name: '_inherit', qualifiedName: 'SaleOrder::_inherit',
      filePath: 'addons/sale/models/sale.py', language: 'python', startLine: 3, endLine: 3,
      startColumn: 4, endColumn: 27, signature: "= 'sale.order'", updatedAt: 1,
    };
    const diagnostic = (
      filePath: string,
      severity: 'error' | 'warning',
    ): FileRecord => ({
      path: filePath, contentHash: filePath, language: 'python', size: 1,
      modifiedAt: 1, indexedAt: 1, nodeCount: 0,
      errors: [{ message: `${severity} diagnostic`, filePath, severity, code: 'parse_error' }],
    });
    const files = [diagnostic('vendor/outside.py', 'error')];
    const source = {
      getNodesByName: () => [target],
      getFiles: () => files,
      getIndexState: () => 'complete' as const,
      getIndexAccounting: () => ({
        discovered: 2, eligible: 2, indexed: 1, skipped: 0, unsupported: 0, failed: 1,
        ignored: null, retry: { attemptedFiles: 1, recoveredFiles: 0, failedFiles: 1 },
        skippedReasons: {}, unsupportedExtensions: [], completedAt: 1, timings: null,
      }),
      getIndexBuildInfo: () => ({ version: '1.0.0', extractionVersion: 28 }),
      isIndexStale: () => false,
    };

    let text = executeInventoryTool(source, {
      declaration: '_inherit', value: 'sale.order', path: 'addons',
    }).content[0]!.text;
    expect(text).toMatch(/COMPLETE FOR SUPPORTED LITERAL DECLARATIONS/);
    expect(text).toMatch(/Scoped Python files with extraction diagnostics: 0/);
    expect(text).toMatch(/Global file records with extraction diagnostics: 1 \(1 error-severity, 0 warning-only\)/);

    files.push(diagnostic('addons/warning.py', 'warning'));
    text = executeInventoryTool(source, {
      declaration: '_inherit', value: 'sale.order', path: 'addons',
    }).content[0]!.text;
    expect(text).toMatch(/LIMITED INDEX COVERAGE/);
    expect(text).toMatch(/Scoped Python files with extraction diagnostics: 1 \(0 error-severity, 1 warning-only\)/);
    expect(text).toMatch(/Global file records with extraction diagnostics: 2 \(1 error-severity, 1 warning-only\)/);
  });

  it('indexes and exactly enumerates the nine-item Odoo-17-like ground truth across catch-up and restart', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-282-odoo17-'));
    execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true });
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n');
    const write = (relative: string, content: string): void => {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `from odoo import models\n${content}`);
    };
    write('addons/sale_a/models/a.py', model('SharedName') + model('A2') + model('A3'));
    write('addons/sale_b/models/b.py', model('SharedName') + model('B2', "['sale.order', 'pos.load.mixin']") + model('B3'));
    write('addons/sale_c/models/c.py', model('C1', "(\n        'sale.order',\n    )") + model('C2') + model('C3') + [
      'class WrongName(models.Model):',
      "    _name = 'sale.order'",
      'class WrongValue(models.Model):',
      "    _inherit = 'sale.order.line'",
      'class Unknown(models.Model):',
      '    _inherit = model_alias',
      "DECOY = \"_inherit = 'sale.order'\"",
    ].join('\n'));
    write('ignored/hidden.py', model('IgnoredTarget'));
    write('enterprise/sibling.py', model('OutsideScope'));
    write('.venv/lib/noise.py', model('VirtualEnvNoise'));

    graph = AfyxGraph.initSync(root, { config: { include: ['**/*.py'], exclude: [] } });
    await graph.indexAll();
    const handler = new ToolHandler(graph);
    const query = (): Promise<ReturnType<ToolHandler['execute']> extends Promise<infer T> ? T : never> =>
      handler.execute('afyx_graph_inventory', { declaration: '_inherit', value: 'sale.order', path: 'addons' });

    let text = (await query()).content[0]!.text;
    expect(text).toMatch(/COMPLETE FOR SUPPORTED LITERAL DECLARATIONS/);
    expect(text).toMatch(/Matches:\*\* 9 declarations; 3 files; 3 modules/);
    expect(text).toMatch(/Unresolved\/unsupported `_inherit` expressions in scope: 1/);
    expect(text).not.toMatch(/IgnoredTarget|OutsideScope|VirtualEnvNoise|sale\.order\.line/);

    write('addons/sale_d/models/d.py', model('CatchUp'));
    handler.setCatchUpGate(graph.sync({ paths: ['addons/sale_d/models/d.py'] }).then(() => undefined));
    text = (await query()).content[0]!.text;
    expect(text).toMatch(/Matches:\*\* 10 declarations/);

    fs.rmSync(path.join(root, 'addons/sale_d/models/d.py'));
    await graph.sync({ paths: ['addons/sale_d/models/d.py'] });
    fs.renameSync(path.join(root, 'addons/sale_a/models/a.py'), path.join(root, 'addons/sale_a/models/renamed.py'));
    await graph.sync({ paths: ['addons/sale_a/models/a.py', 'addons/sale_a/models/renamed.py'] });
    text = (await query()).content[0]!.text;
    expect(text).toMatch(/Matches:\*\* 9 declarations/);
    expect(text).toMatch(/addons\/sale_a\/models\/renamed\.py/);

    write('addons/sale_a/models/renamed.py', model('SharedName') + model('A2'));
    await graph.sync({ paths: ['addons/sale_a/models/renamed.py'] });
    text = (await query()).content[0]!.text;
    expect(text).toMatch(/Matches:\*\* 8 declarations/);
    write('addons/sale_a/models/renamed.py', model('SharedName') + model('A2') + model('A3'));
    await graph.sync({ paths: ['addons/sale_a/models/renamed.py'] });

    graph.destroy();
    graph = AfyxGraph.openSync(root);
    text = (await new ToolHandler(graph).execute('afyx_graph_inventory', {
      declaration: '_inherit', value: 'sale.order', path: 'addons',
    })).content[0]!.text;
    expect(text).toMatch(/Matches:\*\* 9 declarations/);
  }, 30_000);

  it('enumerates all 45 Odoo-20-like declarations and marks bounded pages incomplete', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-282-odoo20-'));
    fs.mkdirSync(path.join(root, 'addons', 'bulk', 'models'), { recursive: true });
    const declarations = Array.from({ length: 44 }, (_, index) => model(`Scalar${index + 1}`));
    declarations.push(model('ListForm', "['sale.order', 'pos.load.mixin']"));
    fs.writeFileSync(path.join(root, 'addons', 'bulk', 'models', 'models.py'), `from odoo import models\n${declarations.join('\n')}`);
    graph = AfyxGraph.initSync(root, { config: { include: ['**/*.py'], exclude: [] } });
    await graph.indexAll();
    const handler = new ToolHandler(graph);
    const full = await handler.execute('afyx_graph_inventory', {
      declaration: '_inherit', value: 'sale.order', path: 'addons', limit: 100,
    });
    expect(full.content[0]!.text).toMatch(/Matches:\*\* 45 declarations; 1 files; 1 modules/);
    expect(full.content[0]!.text).toMatch(/COMPLETE FOR SUPPORTED LITERAL DECLARATIONS/);

    const page = await handler.execute('afyx_graph_inventory', {
      declaration: '_inherit', value: 'sale.order', path: 'addons', limit: 20,
    });
    expect(page.content[0]!.text).toMatch(/PARTIAL PAGE — DO NOT TREAT AS COMPLETE INVENTORY/);
    expect(page.content[0]!.text).toMatch(/25 matching declarations remain/);

    const unsafe = await handler.execute('afyx_graph_inventory', {
      declaration: '_inherit', value: 'sale.order', path: '../outside',
    });
    expect(unsafe.isError).toBe(true);
    expect(unsafe.content[0]!.text).toMatch(/project-relative scope/);
    const oversized = await handler.execute('afyx_graph_inventory', {
      declaration: '_inherit', value: 'sale.order', limit: 201,
    });
    expect(oversized.isError).toBe(true);
    expect(oversized.content[0]!.text).toMatch(/between 1 and 200/);
  });
});
