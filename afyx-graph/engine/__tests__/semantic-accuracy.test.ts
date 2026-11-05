import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AfyxGraph from '../src/index';
import { isSourceGroundedRelationship } from '../src/graph/relationship-presentation';
import { EXTENSION_MAP, isSourceFile, isFileLevelOnlyLanguage, detectLanguage } from '../src/extraction/grammars';
import type { Node, Edge } from '../src/types';

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'semantic-accuracy');

interface EvaluationMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

function computeMetrics(tp: number, fp: number, fn: number): EvaluationMetrics {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 1;
  return { tp, fp, fn, precision, recall, f1 };
}

describe('AFYX Graph Semantic Accuracy & Ground Truth Validation', () => {
  let tempRoot: string;
  let graph: AfyxGraph;

  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-accuracy-test-'));
    fs.cpSync(FIXTURE_DIR, tempRoot, {
      recursive: true,
      filter: (src) => !src.includes('.afyx-graph'),
    });
    graph = AfyxGraph.initSync(tempRoot);
    await graph.indexAll();
  }, 120_000);

  afterAll(() => {
    graph?.destroy();
    if (tempRoot && fs.existsSync(tempRoot)) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // ignore transient Windows file lock
      }
    }
  });

  const getNode = (filePath: string, name: string, kind?: string): Node => {
    const norm = filePath.replace(/\\/g, '/');
    const nodes = graph.getNodesByName(name).filter(
      (n) => n.filePath.replace(/\\/g, '/').endsWith(norm) && (!kind || n.kind === kind)
    );
    expect(nodes.length, `Expected node "${name}" in "${filePath}" (kind: ${kind ?? '*'})`).toBeGreaterThanOrEqual(1);
    return nodes[0]!;
  };

  const getOutgoingTargets = (filePath: string, name: string, edgeKind: string) => {
    const source = getNode(filePath, name);
    return graph
      .getOutgoingEdges(source.id)
      .filter((e) => e.kind === edgeKind)
      .map((e) => graph.getNode(e.target))
      .filter((t): t is Node => t !== null);
  };

  it('1. File Classification & Language Detection Accuracy', () => {
    const expectedLanguages: Record<string, string> = {
      'ts/service.ts': 'typescript',
      'ts/validator.ts': 'typescript',
      'ts/types.ts': 'typescript',
      'python/base_models.py': 'python',
      'python/custom_sale.py': 'python',
      'python/ir.model.access.csv': 'csv',
      'go/engine/processor.go': 'go',
      'go/main/main.go': 'go',
      'rust/lib.rs': 'rust',
      'csharp/Payment.cs': 'csharp',
      'java/Account.java': 'java',
      'php/Repository.php': 'php',
      'swift/Device.swift': 'swift',
      'c/main.c': 'c',
      'c/utils.h': 'c',
      'cpp/Shape.hpp': 'cpp',
      'cpp/Shape.cpp': 'cpp',
      'sfc/Counter.vue': 'vue',
      'sfc/Badge.svelte': 'svelte',
      'metadata/README.md': 'markdown',
      'metadata/config.json': 'json',
      'metadata/deploy.yml': 'yaml',
    };

    let correct = 0;
    const total = Object.keys(expectedLanguages).length;
    for (const [relPath, expectedLang] of Object.entries(expectedLanguages)) {
      const fullPath = path.join(tempRoot, relPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const detected = detectLanguage(fullPath, content);
      if (detected === expectedLang) {
        correct++;
      } else {
        expect(detected, `Language mismatch for ${relPath}`).toBe(expectedLang);
      }
    }

    const accuracy = correct / total;
    expect(accuracy).toBe(1.0); // 100% file classification accuracy
  });

  it('2. Resilient Symbol Extraction with Line & Column Offsets', () => {
    // TypeScript classes, methods, interfaces
    const processor = getNode('ts/service.ts', 'PaymentProcessor', 'class');
    expect(processor.startLine).toBeGreaterThan(0);
    expect(processor.endLine).toBeGreaterThanOrEqual(processor.startLine);

    const orderInterface = getNode('ts/types.ts', 'Order', 'interface');
    expect(orderInterface.kind).toBe('interface');

    // Partial syntax error tolerance in broken_syntax.ts
    const leading = getNode('ts/broken_syntax.ts', 'validLeading', 'function');
    const trailing = getNode('ts/broken_syntax.ts', 'validTrailing', 'function');
    expect(leading).toBeDefined();
    expect(trailing).toBeDefined();
  });

  it('3. Cross-File Direct Calls and Aliased Imports', () => {
    // Direct call: PaymentProcessor.processPayment -> validateOrder
    const callTargets = getOutgoingTargets('ts/service.ts', 'processPayment', 'calls');
    expect(callTargets.some((t) => t.name === 'validateOrder')).toBe(true);

    // Aliased call: runValidation calls verifyOrder (alias of validateOrder)
    const aliasTargets = getOutgoingTargets('ts/alias_consumer.ts', 'runValidation', 'calls');
    expect(aliasTargets.some((t) => t.name === 'validateOrder')).toBe(true);
  });

  it('4. Strict Distinction between Calls and Type References', () => {
    // processPayment uses Order as type, but does NOT call Order
    const callsFromProcess = getOutgoingTargets('ts/service.ts', 'processPayment', 'calls');
    expect(callsFromProcess.some((t) => t.name === 'Order')).toBe(false);

    // Caller presentation of Order interface must report 0 executable callers
    const orderNode = getNode('ts/types.ts', 'Order', 'interface');
    const executableCallers = graph
      .getCallers(orderNode.id)
      .filter((c) => isSourceGroundedRelationship(c) && (c.edge.kind === 'calls' || c.edge.kind === 'instantiates'));
    expect(executableCallers).toHaveLength(0); // An interface has 0 executable callers
  });

  it('5. Safe Unresolved Status for Ambiguous Symbols', () => {
    // auditLog exists in both duplicate_a.ts and duplicate_b.ts
    // ambiguous_caller calls auditLog without import: must stay unresolved
    const calls = getOutgoingTargets('ts/ambiguous_caller.ts', 'executeAudit', 'calls');
    expect(calls).toEqual([]); // Zero invented targets

    const unresolved = graph
      .getUnresolvedReferencesInFile('ts/ambiguous_caller.ts')
      .filter((r) => r.referenceName === 'auditLog');
    expect(unresolved.length).toBeGreaterThan(0);
  });

  it('6. Circular Dependency Handling without Traversal Crash', () => {
    const aTargets = getOutgoingTargets('ts/circular_a.ts', 'stepA', 'calls');
    expect(aTargets.some((t) => t.name === 'stepB')).toBe(true);

    const bTargets = getOutgoingTargets('ts/circular_b.ts', 'stepB', 'calls');
    expect(bTargets.some((t) => t.name === 'stepA')).toBe(true);
  });

  it('7. Inheritance and Method Overrides', () => {
    const customCls = getNode('ts/override.ts', 'CustomGateway', 'class');
    const baseCls = getNode('ts/override.ts', 'BaseGateway', 'class');

    const extendsEdges = graph
      .getOutgoingEdges(customCls.id)
      .filter((e) => e.kind === 'extends' && e.target === baseCls.id);
    expect(extendsEdges).toHaveLength(1);

    // Verify type hierarchy and extends relation
    const hierarchy = graph.getTypeHierarchy(customCls.id);
    expect(hierarchy.nodes.has(baseCls.id)).toBe(true);
  });

  it('8. Python & Odoo Model Inheritance (_inherit)', () => {
    const customSale = getNode('python/custom_sale.py', 'CustomSaleOrder', 'class');
    const baseSale = getNode('python/base_models.py', 'SaleOrder', 'class');

    const inheritanceEdges = graph
      .getOutgoingEdges(customSale.id)
      .filter((e) => e.kind === 'extends' && e.target === baseSale.id);
    expect(inheritanceEdges).toHaveLength(1);
    expect(inheritanceEdges[0]!.metadata?.relation).toBe('model_inheritance');
  });

  it('9. Multi-Language Semantic Implementations & Calls', () => {
    // Go cross-package call
    const goCalls = getOutgoingTargets('go/main/main.go', 'Start', 'calls');
    expect(goCalls.some((t) => t.name === 'ExecuteTask')).toBe(true);

    // C# implementation
    const csTx = getNode('csharp/Payment.cs', 'TransactionService', 'class');
    const csInterface = getNode('csharp/Payment.cs', 'ITransactionService', 'interface');
    const csImplements = graph
      .getOutgoingEdges(csTx.id)
      .filter((e) => e.kind === 'implements' && e.target === csInterface.id);
    expect(csImplements).toHaveLength(1);

    // Java implementation
    const javaDefault = getNode('java/Account.java', 'DefaultAccountService', 'class');
    const javaInterface = getNode('java/Account.java', 'AccountService', 'interface');
    const javaImplements = graph
      .getOutgoingEdges(javaDefault.id)
      .filter((e) => e.kind === 'implements' && e.target === javaInterface.id);
    expect(javaImplements).toHaveLength(1);

    // PHP static method call
    const phpCalls = getOutgoingTargets('php/Repository.php', 'get', 'calls');
    expect(phpCalls.some((t) => t.name === 'findById')).toBe(true);

    // Swift protocol conformance
    const swiftDev = getNode('swift/Device.swift', 'BluetoothDevice', 'class');
    const swiftProto = getNode('swift/Device.swift', 'DeviceController', 'interface');
    const swiftImplements = graph
      .getOutgoingEdges(swiftDev.id)
      .filter((e) => e.kind === 'implements' && e.target === swiftProto.id);
    expect(swiftImplements).toHaveLength(1);

    // C function call
    const cCalls = getOutgoingTargets('c/main.c', 'run_app', 'calls');
    expect(cCalls.some((t) => t.name === 'calculate_area')).toBe(true);

    // C++ inheritance
    const cppRect = getNode('cpp/Shape.hpp', 'Rectangle', 'class');
    const cppShape = getNode('cpp/Shape.hpp', 'Shape', 'class');
    const cppExtends = graph
      .getOutgoingEdges(cppRect.id)
      .filter((e) => e.kind === 'extends' && e.target === cppShape.id);
    expect(cppExtends).toHaveLength(1);

    // Vue & Svelte SFC extraction
    const vueComp = getNode('sfc/Counter.vue', 'Counter', 'component');
    expect(vueComp).toBeDefined();
    const vueIncr = getNode('sfc/Counter.vue', 'increment');
    expect(vueIncr).toBeDefined();
    expect(['function', 'method']).toContain(vueIncr.kind);
    const svelteGetLabel = getNode('sfc/Badge.svelte', 'getLabel', 'function');
    expect(svelteGetLabel).toBeDefined();
  });

  it('10. Incremental Indexing & Rebuild Determinism', async () => {
    // Baseline state
    const initialFiles = graph.getFiles().length;

    // Modify a file: edit types.ts
    const typesPath = path.join(tempRoot, 'ts/types.ts');
    const oldContent = fs.readFileSync(typesPath, 'utf8');
    fs.writeFileSync(typesPath, oldContent + '\nexport interface Invoice { number: string; }\n');

    // Run incremental sync
    const syncRes = await graph.sync();
    expect(syncRes.filesModified).toBeGreaterThanOrEqual(1);

    const invoice = getNode('ts/types.ts', 'Invoice', 'interface');
    expect(invoice).toBeDefined();

    // Revert types.ts and resync
    fs.writeFileSync(typesPath, oldContent);
    await graph.sync();

    const revertedInvoice = graph.getNodesByName('Invoice');
    expect(revertedInvoice).toHaveLength(0); // Clean removal of deleted symbol
  });

  it('11. Quantitative Precision, Recall & F1 Evaluation', () => {
    // Ground-truth expected relations across categories:
    // Category 1: Direct function/method calls
    const callCases = [
      { from: ['ts/service.ts', 'processPayment'], to: 'validateOrder', kind: 'calls', expected: true },
      { from: ['ts/alias_consumer.ts', 'runValidation'], to: 'validateOrder', kind: 'calls', expected: true },
      { from: ['ts/circular_a.ts', 'stepA'], to: 'stepB', kind: 'calls', expected: true },
      { from: ['ts/circular_b.ts', 'stepB'], to: 'stepA', kind: 'calls', expected: true },
      { from: ['go/main/main.go', 'Start'], to: 'ExecuteTask', kind: 'calls', expected: true },
      { from: ['php/Repository.php', 'get'], to: 'findById', kind: 'calls', expected: true },
      { from: ['c/main.c', 'run_app'], to: 'calculate_area', kind: 'calls', expected: true },
      // Negative call cases (must NOT resolve):
      { from: ['ts/ambiguous_caller.ts', 'executeAudit'], to: 'auditLog', kind: 'calls', expected: false },
      { from: ['ts/service.ts', 'processPayment'], to: 'Order', kind: 'calls', expected: false },
    ];

    let callTP = 0, callFP = 0, callFN = 0;
    for (const c of callCases) {
      const targets = getOutgoingTargets(c.from[0], c.from[1], c.kind);
      const matched = targets.some((t) => t.name === c.to);
      if (c.expected) {
        if (matched) callTP++; else callFN++;
      } else {
        if (matched) callFP++;
      }
    }
    const callMetrics = computeMetrics(callTP, callFP, callFN);
    expect(callMetrics.precision).toBeGreaterThanOrEqual(0.99);
    expect(callMetrics.recall).toBeGreaterThanOrEqual(0.95);
    expect(callMetrics.f1).toBeGreaterThanOrEqual(0.97);

    // Category 2: Inheritance & Implementation
    const inheritanceCases = [
      { from: ['ts/override.ts', 'CustomGateway'], to: 'BaseGateway', kind: 'extends' },
      { from: ['python/custom_sale.py', 'CustomSaleOrder'], to: 'SaleOrder', kind: 'extends' },
      { from: ['csharp/Payment.cs', 'TransactionService'], to: 'ITransactionService', kind: 'implements' },
      { from: ['java/Account.java', 'DefaultAccountService'], to: 'AccountService', kind: 'implements' },
      { from: ['swift/Device.swift', 'BluetoothDevice'], to: 'DeviceController', kind: 'implements' },
      { from: ['cpp/Shape.hpp', 'Rectangle'], to: 'Shape', kind: 'extends' },
    ];

    let inhTP = 0, inhFP = 0, inhFN = 0;
    for (const c of inheritanceCases) {
      const source = getNode(c.from[0], c.from[1]);
      const targets = graph
        .getOutgoingEdges(source.id)
        .filter((e) => e.kind === c.kind)
        .map((e) => graph.getNode(e.target))
        .filter((t): t is Node => t !== null);
      if (targets.some((t) => t.name === c.to)) {
        inhTP++;
      } else {
        inhFN++;
      }
    }
    const inhMetrics = computeMetrics(inhTP, inhFP, inhFN);
    expect(inhMetrics.precision).toBe(1.0);
    expect(inhMetrics.recall).toBe(1.0);
    expect(inhMetrics.f1).toBe(1.0);
  });

  it('12. Universal File Catalog: Metadata-Only Files without False Symbols', () => {
    const files = graph.getFiles().map((f) => f.path.replace(/\\/g, '/'));
    expect(files.some((f) => f.endsWith('metadata/README.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('metadata/config.json'))).toBe(true);
    expect(files.some((f) => f.endsWith('metadata/deploy.yml'))).toBe(true);

    // Markdown, JSON, YAML emit 0 semantic symbols
    expect(graph.getNodesInFile('metadata/README.md')).toHaveLength(0);
    expect(graph.getNodesInFile('metadata/config.json')).toHaveLength(0);
    expect(graph.getNodesInFile('metadata/deploy.yml')).toHaveLength(0);
  });

  it('13. Complete 81-Extension Capability Matrix Verification', () => {
    const allExtensions = Object.keys(EXTENSION_MAP);
    expect(allExtensions.length).toBeGreaterThanOrEqual(80);

    for (const ext of allExtensions) {
      expect(isSourceFile(`test${ext}`)).toBe(true);
      const lang = EXTENSION_MAP[ext]!;
      expect(detectLanguage(`test${ext}`)).toBe(lang);
    }

    // Special path detection
    expect(isSourceFile('ir.model.access.csv')).toBe(true);
    expect(detectLanguage('ir.model.access.csv')).toBe('csv');
    expect(isSourceFile('conf/routes')).toBe(true);
    expect(detectLanguage('conf/routes')).toBe('yaml');
    expect(isSourceFile('my_app.app.src')).toBe(true);
    expect(detectLanguage('my_app.app.src')).toBe('erlang');
    expect(isSourceFile('templates/index.json')).toBe(true);
    expect(detectLanguage('templates/index.json')).toBe('liquid');

    // Unsupported binary / media files
    expect(isSourceFile('image.png')).toBe(false);
    expect(isSourceFile('archive.zip')).toBe(false);
    expect(isSourceFile('binary.exe')).toBe(false);
  });

  it('14. Monorepo Project References & Nested Tsconfig Path Aliases', async () => {
    const monoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-mono-test-'));
    try {
      fs.writeFileSync(path.join(monoRoot, 'package.json'), JSON.stringify({ name: 'mono-root', workspaces: ['packages/*'] }));
      fs.writeFileSync(path.join(monoRoot, 'tsconfig.json'), JSON.stringify({
        files: [],
        references: [{ path: './packages/core' }, { path: './packages/web' }],
      }));

      fs.mkdirSync(path.join(monoRoot, 'packages/core/src'), { recursive: true });
      fs.writeFileSync(path.join(monoRoot, 'packages/core/package.json'), JSON.stringify({ name: '@mono/core' }));
      fs.writeFileSync(path.join(monoRoot, 'packages/core/tsconfig.json'), JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@core/*': ['src/*'] } },
      }));
      fs.writeFileSync(path.join(monoRoot, 'packages/core/src/service.ts'), 'export function executeTask(): string { return "done"; }\n');
      fs.writeFileSync(path.join(monoRoot, 'packages/core/src/handler.ts'), 'import * as S from "@core/service";\nexport function handle(): string { return S.executeTask(); }\n');

      fs.mkdirSync(path.join(monoRoot, 'packages/web/src'), { recursive: true });
      fs.writeFileSync(path.join(monoRoot, 'packages/web/package.json'), JSON.stringify({ name: '@mono/web' }));
      fs.writeFileSync(path.join(monoRoot, 'packages/web/tsconfig.json'), JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }));
      fs.writeFileSync(path.join(monoRoot, 'packages/web/src/app.ts'), 'import { executeTask } from "@core/service";\nexport function startApp(): string { return executeTask(); }\n');

      const monoGraph = AfyxGraph.initSync(monoRoot);
      await monoGraph.indexAll();

      // Check within package: handler.ts -> service.ts
      const handlerFn = monoGraph.getNodesInFile('packages/core/src/handler.ts').find((n) => n.name === 'handle');
      expect(handlerFn).toBeDefined();
      const handlerCalls = monoGraph.getOutgoingEdges(handlerFn!.id).filter((e) => e.kind === 'calls');
      expect(handlerCalls).toHaveLength(1);
      const serviceFn = monoGraph.getNodesInFile('packages/core/src/service.ts').find((n) => n.name === 'executeTask');
      expect(serviceFn).toBeDefined();
      expect(handlerCalls[0]!.target).toBe(serviceFn!.id);

      // Check across package: app.ts in web -> service.ts in core
      const startAppFn = monoGraph.getNodesInFile('packages/web/src/app.ts').find((n) => n.name === 'startApp');
      expect(startAppFn).toBeDefined();
      const appCalls = monoGraph.getOutgoingEdges(startAppFn!.id).filter((e) => e.kind === 'calls');
      expect(appCalls).toHaveLength(1);
      expect(appCalls[0]!.target).toBe(serviceFn!.id);

      // Zero false unresolved calls in both files
      expect(
        monoGraph
          .getUnresolvedReferencesInFile('packages/core/src/handler.ts')
          .filter((r) => r.referenceKind === 'calls')
      ).toHaveLength(0);
      expect(
        monoGraph
          .getUnresolvedReferencesInFile('packages/web/src/app.ts')
          .filter((r) => r.referenceKind === 'calls')
      ).toHaveLength(0);

      monoGraph.destroy();
    } finally {
      if (fs.existsSync(monoRoot)) {
        try {
          fs.rmSync(monoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        } catch {
          // ignore transient Windows file lock
        }
      }
    }
  });
});
