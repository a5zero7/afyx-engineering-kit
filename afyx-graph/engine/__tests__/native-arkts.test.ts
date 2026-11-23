import { afterEach, describe, expect, it } from 'vitest';
import { extractNativeFacts } from '../src/extraction/native/fact-extractor';
import { tokenizeSource } from '../src/extraction/syntax-tokens';
import { extractFromSource } from '../src/extraction/extract';
import { guardsInSource } from '../src/graph/branch-guards';

afterEach(() => { delete process.env.AFYX_GRAPH_NATIVE_PARSER; });

function facts(source: string) {
  return extractNativeFacts('pages/Home.ets', source, 'arkts');
}

function refs(result: ReturnType<typeof facts>, kind: string): string[] {
  return result.unresolvedReferences
    .filter((ref) => ref.referenceKind === kind)
    .map((ref) => ref.referenceName);
}

describe('Afyx-native ArkTS semantic route', () => {
  it('reuses TypeScript facts for modules, types, members, ownership, and relationships', () => {
    const result = facts(`
import router from '@ohos.router';
import { Model } from '../model/Model';
interface Runnable { run(): Model; }
enum Mode { Idle, Active = 2 }
type Handler = (value: Model) => void;
class Base {}
export class Service<T> extends Base implements Runnable {
  private model: Model = new Model();
  constructor(model: Model) { this.model = model; }
  run(): Model { router.pushUrl({ url: 'next' }); return this.model; }
}
`);
    const names = result.nodes.map((node) => `${node.kind}:${node.name}`);
    expect(names).toEqual(expect.arrayContaining([
      'import:@ohos.router', 'import:../model/Model', 'interface:Runnable',
      'enum:Mode', 'enum_member:Idle', 'enum_member:Active', 'type_alias:Handler',
      'class:Base', 'class:Service', 'property:model', 'method:constructor', 'method:run',
    ]));
    expect(result.nodes.find((node) => node.qualifiedName === 'Service::run')?.returnType).toBe('Model');
    expect(refs(result, 'extends')).toContain('Base');
    expect(refs(result, 'implements')).toContain('Runnable');
    expect(refs(result, 'instantiates')).toContain('Model');
    expect(refs(result, 'calls')).toContain('router.pushUrl');
  });

  it('preserves ArkUI structs, decorators, DSL chains, and handler bindings', () => {
    const result = facts(`
@Extend(Text) function titleStyle(size: number) { .fontSize(size) }
@Entry
@Component
export struct Home {
  @State count: number = 0;
  @Builder header(): void { Button('Go').onClick(this.handle) }
  handle(): void { this.count += 1; }
  build() { Column() { Text('Home').titleStyle(24) } .height('100%') }
}
`);
    const home = result.nodes.find((node) => node.kind === 'struct' && node.name === 'Home');
    const count = result.nodes.find((node) => node.qualifiedName === 'Home::count');
    const header = result.nodes.find((node) => node.qualifiedName === 'Home::header');
    const extend = result.nodes.find((node) => node.name === 'titleStyle');
    expect(home?.isExported).toBe(true);
    expect(home?.decorators).toEqual(expect.arrayContaining(['Entry', 'Component']));
    expect(count?.decorators).toContain('State');
    expect(header?.decorators).toContain('Builder');
    expect(extend?.decorators).toContain('Extend');
    expect(refs(result, 'calls')).toEqual(expect.arrayContaining([
      '.fontSize', '.onClick', 'handle', '.titleStyle', '.height',
    ]));
  });

  it('routes facts and syntax tokens natively behind the feature gate', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = '@Entry\n@Component\nstruct Home { build(): void { Text("ok") } }';
    const result = extractFromSource('Home.ets', source);
    expect(result.nodes.map((node) => `${node.kind}:${node.name}`)).toEqual(expect.arrayContaining([
      'struct:Home', 'method:build',
    ]));
    const syntax = await tokenizeSource(source, 'arkts');
    const classified = syntax?.spans.map((span) => [span.cls, source.slice(span.start, span.end)]);
    expect(classified).toEqual(expect.arrayContaining([
      ['keyword', 'struct'], ['def', 'Home'], ['def', 'build'], ['type', 'void'], ['string', '"ok"'],
    ]));
  });

  it('reuses native TypeScript-family branch boundaries and guards', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = `struct Home {
  build() {
    if (ready) { render() }
    if (busy) { return }
    finish()
  }
}`;
    const at = (needle: string) => {
      const prefix = source.slice(0, source.indexOf(needle));
      const line = prefix.split('\n').length;
      const column = prefix.length - prefix.lastIndexOf('\n') - 1;
      return guardsInSource(source, 'arkts', line, column);
    };
    const render = await at('render()');
    const finish = await at('finish()');
    expect(render).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'ready', negated: false })]));
    expect(finish).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'busy', negated: true, exit: 'return' })]));
  });
});
