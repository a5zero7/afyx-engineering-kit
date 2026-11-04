import { afterEach, describe, expect, it } from 'vitest';
import { extractNativeFacts } from '../src/extraction/native/fact-extractor';
import { tokenizeSource } from '../src/extraction/syntax-tokens';
import { extractFromSource } from '../src/extraction/extract';
import { guardsInSource } from '../src/graph/branch-guards';

afterEach(() => { delete process.env.AFYX_GRAPH_NATIVE_PARSER; });

function facts(source: string) {
  return extractNativeFacts('Feature.swift', source, 'swift');
}

function names(result: ReturnType<typeof facts>): string[] {
  return result.nodes.map((node) => `${node.kind}:${node.name}`);
}

function refs(result: ReturnType<typeof facts>, kind: string): string[] {
  return result.unresolvedReferences.filter((ref) => ref.referenceKind === kind).map((ref) => ref.referenceName);
}

describe('Afyx-native Swift semantic route', () => {
  it('extracts modules, types, ownership, properties, initializers, extensions, and enum cases', () => {
    const result = facts(`
@testable import Foundation
protocol Running { func run() }
enum Mode { case idle, active }
actor Store { let count: Int }
class Service<T>: Store, Running {
  let stored: T
  var computed: Int { stored.hashValue }
  init(stored: T) { self.stored = stored }
  func run() { work() }
}
extension Service { func reset() {} }
func topLevel() {}
`);
    expect(names(result)).toEqual(expect.arrayContaining([
      'import:Foundation', 'interface:Running', 'enum:Mode', 'enum_member:idle', 'enum_member:active',
      'class:Store', 'class:Service', 'field:stored', 'property:computed', 'method:init',
      'method:run', 'method:reset', 'function:topLevel',
    ]));
    expect(refs(result, 'extends')).toEqual(expect.arrayContaining(['Store', 'Running']));
    expect(refs(result, 'references')).toContain('Service');
    expect(result.nodes.some((node) => node.name === 'run' && node.kind === 'method' && node.qualifiedName.includes('Service::run'))).toBe(true);
  });

  it('extracts optional/generic return types, calls, factory chains, metatypes, and callable values', () => {
    const result = facts(`
struct Product {}
class Builder {
  func make() -> Product? { Product() }
  func render() { Builder.make().draw(); register(render); use(Product.self) }
}
`);
    const make = result.nodes.find((node) => node.name === 'make');
    expect(make?.returnType).toBe('Product');
    expect(refs(result, 'calls')).toEqual(expect.arrayContaining(['Product', 'Builder.make', 'Builder.make().draw', 'register', 'use']));
    expect(refs(result, 'references')).toContain('Product');
    expect(refs(result, 'function_ref')).toContain('render');
  });

  it('routes Swift through native facts behind the feature gate', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const result = extractFromSource('Feature.swift', 'struct Feature { func run() { work() } }');
    expect(names(result)).toEqual(expect.arrayContaining(['struct:Feature', 'method:run']));
    expect(refs(result, 'calls')).toContain('work');
  });

  it('classifies Swift syntax without loading a grammar', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = 'public struct Feature { func run() -> String { "ok" } } // note';
    const result = await tokenizeSource(source, 'swift');
    const classified = result?.spans.map((span) => [span.cls, source.slice(span.start, span.end)]);
    expect(classified).toEqual(expect.arrayContaining([
      ['keyword', 'public'], ['keyword', 'struct'], ['def', 'Feature'],
      ['def', 'run'], ['type', 'String'], ['string', '"ok"'], ['comment', '// note'],
    ]));
  });
});

describe('Afyx-native Swift branch guards', () => {
  async function at(source: string, needle: string) {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const prefix = source.slice(0, source.indexOf(needle));
    const line = prefix.split('\n').length;
    const column = prefix.length - prefix.lastIndexOf('\n') - 1;
    return guardsInSource(source, 'swift', line, column);
  }

  it('preserves guard continuation, if/else, switch, catch, and early-exit semantics', async () => {
    const source = `func run() {
  guard ready else { stop(); return }
  if enabled { open() } else { close() }
  switch mode { case .fast: speed() default: wait() }
  do { work() } catch { recover() }
  if busy { return }
  continueWork()
}`;
    expect(await at(source, 'stop()')).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'ready', negated: true, form: 'else' })]));
    expect(await at(source, 'open()')).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'enabled', negated: false })]));
    expect(await at(source, 'close()')).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'enabled', negated: true })]));
    expect(await at(source, 'speed()')).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'mode == .fast', form: 'case' })]));
    expect(await at(source, 'recover()')).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'on error', form: 'catch' })]));
    expect(await at(source, 'continueWork()')).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'ready', negated: false, form: 'guard', exit: 'return' }),
      expect.objectContaining({ text: 'busy', negated: true, form: 'guard', exit: 'return' }),
    ]));
  });

  it('does not leak enclosing guards into assigned or trailing closures', async () => {
    const source = `func run() {
  guard ready else { return }
  let callback = { value in nested(value) }
  queue.async { trailing() }
  execute { bareTrailing() }
}`;
    expect(await at(source, 'nested(value)')).toEqual([]);
    expect(await at(source, 'trailing()')).toEqual([]);
    expect(await at(source, 'bareTrailing()')).toEqual([]);
  });
});
