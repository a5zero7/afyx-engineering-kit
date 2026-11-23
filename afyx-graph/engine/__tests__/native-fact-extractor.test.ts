import { describe, expect, it } from 'vitest';
import { extractNativeFacts } from '../src/extraction/native/fact-extractor';

describe('Afyx-native JS/TS fact extraction', () => {
  it('extracts declarations, containment, imports, and calls without false comment/string facts', () => {
    const result = extractNativeFacts('src/ledger.ts', [
      "import { helper } from './helper';",
      'export class Ledger {',
      '  total(value: number): number {',
      '    return helper(value);',
      '  }',
      '}',
      'const decoy = "function ghost() {}";',
      '// function phantom() {}',
    ].join('\n'), 'typescript');

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'class', name: 'Ledger', startLine: 2, endLine: 6, isExported: true }),
      expect.objectContaining({ kind: 'method', name: 'total', startLine: 3, endLine: 5 }),
    ]));
    expect(result.nodes.some((node) => node.name === 'ghost' || node.name === 'phantom')).toBe(false);
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'contains', source: expect.stringMatching(/^class:/), target: expect.stringMatching(/^method:/) }),
    ]));
    expect(result.unresolvedReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ referenceKind: 'imports', referenceName: './helper' }),
      expect.objectContaining({ referenceKind: 'imports', referenceName: 'helper', line: 1 }),
    ]));
  });

  it('keeps useful prefix facts for incomplete code', () => {
    const result = extractNativeFacts('src/incomplete.ts', 'export function ready() { call(', 'typescript');
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'function', name: 'ready' }),
    ]));
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'native_incomplete_source' }),
    ]));
  });

  it('keeps object return types outside the executable body and records parameter types', () => {
    const result = extractNativeFacts(
      'report.ts',
      'export function report(cart: CartRepository): { ok(): boolean } { return { ok: () => !!cart }; }',
      'typescript',
    );
    const report = result.nodes.find((node) => node.kind === 'function' && node.name === 'report');
    expect(report).toBeDefined();
    expect(result.unresolvedReferences).toContainEqual(expect.objectContaining({
      fromNodeId: report!.id,
      referenceKind: 'references',
      referenceName: 'CartRepository',
    }));
    expect(result.unresolvedReferences).not.toContainEqual(expect.objectContaining({
      fromNodeId: report!.id,
      referenceKind: 'calls',
      referenceName: 'ok',
    }));
  });

  it('extracts constructors and RTK Query generated surface', () => {
    const result = extractNativeFacts('api.ts', [
      'class Service { constructor(config: Config) { new Cache(config); } }',
      'export const api = createApi({ endpoints: build => ({',
      '  getUser: build.query({ query: () => "/user" }),',
      '}) });',
      'export const { useGetUserQuery } = api;',
    ].join('\n'), 'typescript');
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'method', name: 'constructor' }),
      expect.objectContaining({ kind: 'function', name: 'getUser' }),
      expect.objectContaining({ kind: 'function', name: 'useGetUserQuery', signature: '= RTK Query generated hook' }),
    ]));
  });
});

describe('Afyx-native Python fact extraction', () => {
  it('preserves positional class bases and ignores keyword class options', () => {
    const result = extractNativeFacts(
      'service.py',
      'class ApiService(core.BaseService, AuditMixin, metaclass=ServiceMeta):\n    pass\n',
      'python',
    );

    expect(result.unresolvedReferences.filter((ref) => ref.referenceKind === 'extends')).toEqual([
      expect.objectContaining({ referenceName: 'core.BaseService' }),
      expect.objectContaining({ referenceName: 'AuditMixin' }),
    ]);
  });

  it('emits self calls as class-local names without flattening other receivers', () => {
    const result = extractNativeFacts(
      'service.py',
      'class Service:\n    def run(self):\n        self.flush()\n        worker.flush()\n',
      'python',
    );
    const calls = result.unresolvedReferences
      .filter((ref) => ref.referenceKind === 'calls')
      .map((ref) => ref.referenceName);

    expect(calls).toContain('flush');
    expect(calls).toContain('worker.flush');
    expect(calls).not.toContain('self.flush');
  });
});

describe('Afyx-native Java fact extraction', () => {
  it('preserves a field type as a reference from the field', () => {
    const result = extractNativeFacts(
      'Renderer.java',
      'class Renderer {\n  private final Formatter formatter = new UpperFormatter();\n}\n',
      'java',
    );
    const field = result.nodes.find((node) => node.kind === 'field' && node.name === 'formatter');

    expect(field).toBeDefined();
    expect(result.unresolvedReferences).toContainEqual(expect.objectContaining({
      fromNodeId: field!.id,
      referenceKind: 'references',
      referenceName: 'Formatter',
    }));
  });
});
