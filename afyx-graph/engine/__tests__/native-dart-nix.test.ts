import { afterEach, describe, expect, it } from 'vitest';
import { extractNativeFacts } from '../src/extraction/native/fact-extractor';
import { tokenizeSource } from '../src/extraction/syntax-tokens';
import { extractFromSource } from '../src/extraction/extract';

afterEach(() => { delete process.env.AFYX_GRAPH_NATIVE_PARSER; });

describe('Afyx-native Dart facts', () => {
  it('preserves definitions, ownership, types, routes, calls, and constant reads', () => {
    const result = extractNativeFacts('lib/model.dart', [
      "import 'base.dart';",
      'abstract class Model extends Base with Mixed implements Contract {',
      '  static const limit = 3;',
      '  final Value value;',
      '  Model(this.value);',
      '  factory Model.empty() => Model(Value());',
      '  Future<Result?> load(Input input) async { helper(input); register(load); return null; }',
      '  int capped(int n) => n > limit ? limit : n;',
      '}',
      'mixin Mixed {}',
      'extension Values on Value {}',
      'enum State { ready, done }',
      'typedef Loader = Result Function(Input);',
    ].join('\n'), 'dart');

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'class', name: 'Model', isAbstract: true }),
      expect.objectContaining({ kind: 'method', name: 'empty', returnType: 'Model' }),
      expect.objectContaining({ kind: 'method', name: 'load', returnType: 'Future', isAsync: true }),
      expect.objectContaining({ kind: 'constant', name: 'limit', isStatic: true }),
      expect.objectContaining({ kind: 'enum', name: 'State' }),
      expect.objectContaining({ kind: 'type_alias', name: 'Loader' }),
    ]));
    expect(result.unresolvedReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ referenceKind: 'imports', referenceName: 'base.dart' }),
      expect.objectContaining({ referenceKind: 'extends', referenceName: 'Base' }),
      expect.objectContaining({ referenceKind: 'implements', referenceName: 'Mixed' }),
      expect.objectContaining({ referenceKind: 'implements', referenceName: 'Contract' }),
      expect.objectContaining({ referenceKind: 'calls', referenceName: 'helper' }),
      expect.objectContaining({ referenceKind: 'function_ref', referenceName: 'load' }),
    ]));
    const limit = result.nodes.find((node) => node.name === 'limit');
    const capped = result.nodes.find((node) => node.name === 'capped');
    expect(result.edges).toContainEqual(expect.objectContaining({ source: capped?.id, target: limit?.id, kind: 'references' }));
  });

  it('keeps raw/triple strings and incomplete input bounded', () => {
    const result = extractNativeFacts('lib/incomplete.dart', "void run() { final text = r'''call(fake)'''; real(", 'dart');
    expect(result.unresolvedReferences.some((ref) => ref.referenceName === 'fake')).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native_incomplete_source' })]));
  });

  it('routes semantic facts and syntax through native logic behind the gate', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = 'abstract class Feature { Future<Result?> run() async => build(); } // note';
    const facts = extractFromSource('feature.dart', source);
    expect(facts.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'class', name: 'Feature' }),
      expect.objectContaining({ kind: 'method', name: 'run' }),
    ]));
    const syntax = await tokenizeSource(source, 'dart');
    const spans = syntax?.spans.map((span) => [span.cls, source.slice(span.start, span.end)]);
    expect(spans).toEqual(expect.arrayContaining([
      ['keyword', 'abstract'], ['keyword', 'class'], ['def', 'Feature'],
      ['type', 'Future'], ['def', 'run'], ['comment', '// note'],
    ]));
  });
});

describe('Afyx-native Nix facts', () => {
  it('preserves lexical bindings, functions, exports, imports, and applications', () => {
    const result = extractNativeFacts('modules/default.nix', [
      '{ pkgs, ... }:',
      'let',
      '  helper = value: pkgs.lib.id value;',
      '  package = pkgs.callPackage ./package.nix { };',
      'in rec {',
      '  inherit helper;',
      '  nested.value = helper package;',
      '  imports = [ ./child.nix ];',
      '}',
    ].join('\n'), 'nix');

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'function', name: 'helper' }),
      expect.objectContaining({ kind: 'variable', name: 'nested.value', isExported: true }),
    ]));
    expect(result.unresolvedReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ referenceKind: 'imports', referenceName: './package.nix' }),
      expect.objectContaining({ referenceKind: 'imports', referenceName: './child.nix' }),
      expect.objectContaining({ referenceKind: 'calls', referenceName: 'pkgs.callPackage' }),
      expect.objectContaining({ referenceKind: 'calls', referenceName: 'pkgs.lib.id' }),
      expect.objectContaining({ referenceKind: 'function_ref', referenceName: 'helper' }),
    ]));
  });

  it('does not turn dynamic imports or string interpolation into static dependencies', () => {
    const result = extractNativeFacts('dynamic.nix', "{ path }: { a = import path; text = ''${import ./fake.nix}''; }", 'nix');
    expect(result.unresolvedReferences.filter((ref) => ref.referenceKind === 'imports')).toEqual([]);
  });

  it('routes semantic facts and syntax through native logic behind the gate', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = 'let helper = value: value; in { result = helper true; } # note';
    const facts = extractFromSource('default.nix', source);
    expect(facts.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'function', name: 'helper' }),
      expect.objectContaining({ kind: 'variable', name: 'result' }),
    ]));
    const syntax = await tokenizeSource(source, 'nix');
    const spans = syntax?.spans.map((span) => [span.cls, source.slice(span.start, span.end)]);
    expect(spans).toEqual(expect.arrayContaining([
      ['keyword', 'let'], ['def', 'helper'], ['keyword', 'in'], ['number', 'true'], ['comment', '# note'],
    ]));
  });
});
