import { afterEach, describe, expect, it } from 'vitest';
import { extractNativeFacts } from '../src/extraction/native/fact-extractor';
import { extractFromSource } from '../src/extraction/extract';

afterEach(() => { delete process.env.AFYX_GRAPH_NATIVE_PARSER; });

function ownerOf(result: ReturnType<typeof extractNativeFacts>, kind: string, name: string) {
  const ref = result.unresolvedReferences.find((item) => item.referenceKind === kind && item.referenceName === name);
  return ref ? result.nodes.find((node) => node.id === ref.fromNodeId) : undefined;
}

describe('Afyx-native Rust semantic route', () => {
  it('extracts the product-required type, impl, import, call, and return-type facts', () => {
    const source = String.raw`
use crate::helpers::{build, run};
pub struct Unit;
pub struct Buffer<T> { value: T }
pub union Slot { raw: u32 }
pub enum State { Ready, Waiting(u32) }
pub trait Runner: Display { fn run(&self) -> Result; }
impl<T> Runner for Buffer<T> {
  pub async fn make() -> module::Factory { module::Factory::new() }
  fn run(&self) -> Result { self.value.run(); build() }
}
const START: usize = build();
static REGISTRY: Lazy<Cfg> = Lazy::new(|| run());
// fn phantom() {}
const TEXT: &str = r#"fn ghost() {}"#;
`;
    const result = extractNativeFacts('src/lib.rs', source, 'rust');
    const names = result.nodes.map((node) => `${node.kind}:${node.name}`);
    expect(names).toEqual(expect.arrayContaining([
      'struct:Unit', 'struct:Buffer', 'union:Slot', 'enum:State',
      'enum_member:Ready', 'enum_member:Waiting', 'trait:Runner',
      'method:run', 'method:make', 'variable:START', 'variable:REGISTRY',
    ]));
    expect(names).not.toContain('function:phantom');
    expect(names).not.toContain('function:ghost');
    expect(result.nodes.find((node) => node.name === 'make')?.returnType).toBe('Factory');
    expect(result.nodes.find((node) => node.name === 'make')?.isAsync).toBe(true);
    expect(result.nodes.find((node) => node.name === 'run' && node.qualifiedName.includes('Buffer'))).toBeDefined();
    expect(result.unresolvedReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ referenceKind: 'imports', referenceName: 'crate::helpers::buildrun' }),
      expect.objectContaining({ referenceKind: 'implements', referenceName: 'Runner' }),
      expect.objectContaining({ referenceKind: 'extends', referenceName: 'Display' }),
      expect.objectContaining({ referenceKind: 'calls', referenceName: 'module::Factory::new' }),
      expect.objectContaining({ referenceKind: 'calls', referenceName: 'self.value.run' }),
    ]));
    expect(ownerOf(result, 'calls', 'build')?.name).toBe('run');
  });

  it('keeps valid prefix facts and deterministic warnings for malformed source', () => {
    const first = extractNativeFacts('src/broken.rs', 'pub struct Ready; fn work() { call(', 'rust');
    const second = extractNativeFacts('src/broken.rs', 'pub struct Ready; fn work() { call(', 'rust');
    expect(first.nodes.some((node) => node.name === 'Ready')).toBe(true);
    expect(first.errors.map((error) => error.code)).toEqual(second.errors.map((error) => error.code));
    expect(first.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native_incomplete_source' })]));
  });
});

describe('Afyx-native Kotlin semantic route', () => {
  it('preserves ownership, accessors, fun interfaces, calls, refs, and nullable returns', () => {
    const source = `
package demo
import demo.api.Target
fun interface Handler { fun invoke(value: String): Unit }
interface Base
class Service : Base {
  val field: Target = createTarget()
  var changing = load()
  val text = """class Ghost { fun phantom() {} }"""
  val computed: Target get() = compute()
  fun create(): Target? { return field }
  fun local() {
    val callback = Runnable { target() }
    val (a, b) = makePair()
    callback.run()
  }
}
object Registry { const val NAME = "x"; val handler = ::factory }
fun factory(): Target = Target()
// class Phantom
`;
    const result = extractNativeFacts('src/Service.kt', source, 'kotlin');
    const names = result.nodes.map((node) => `${node.kind}:${node.name}`);
    expect(names).toEqual(expect.arrayContaining([
      'namespace:demo', 'interface:Handler', 'interface:Base', 'class:Service',
      'field:field', 'field:changing', 'field:computed', 'method:create', 'method:local',
      'class:Registry', 'constant:NAME', 'constant:handler', 'function:factory',
    ]));
    expect(names).not.toContain('constant:callback');
    expect(names).not.toContain('class:Phantom');
    expect(names).not.toContain('class:Ghost');
    expect(result.nodes.find((node) => node.name === 'create')?.returnType).toBe('Target');
    expect(result.unresolvedReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ referenceKind: 'imports', referenceName: 'demo.api.Target' }),
      expect.objectContaining({ referenceKind: 'extends', referenceName: 'Base' }),
      expect.objectContaining({ referenceKind: 'references', referenceName: 'Target' }),
      expect.objectContaining({ referenceKind: 'function_ref', referenceName: 'factory' }),
      expect.objectContaining({ referenceKind: 'calls', referenceName: 'target' }),
      expect.objectContaining({ referenceKind: 'calls', referenceName: 'makePair' }),
    ]));
  });

  it('uses the native production route only behind the feature gate', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const result = extractFromSource('Route.kt', 'class Route { fun go() { target() } }', 'kotlin');
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'class', name: 'Route' }),
      expect.objectContaining({ kind: 'method', name: 'go' }),
    ]));
  });
});

describe('Afyx-native Scala semantic route', () => {
  it('extracts types, scoped val/var, annotations, extensions, calls, and return types', () => {
    const source = `
package demo
import demo.api.Target
trait Base
class Service extends Base {
  val field: Target = create()
  var state: Int = 0
  val text = """object Ghost { def phantom() = () }"""
  def create(): pkg.Target = Target()
}
object Registry {
  val handler = () => target()
  var mutable = load()
}
enum Color { case Red, Blue }
type Alias = Target
extension (value: Service) { def refresh(): Target = value.create() }
// object Phantom
`;
    const result = extractNativeFacts('src/Service.scala', source, 'scala');
    const names = result.nodes.map((node) => `${node.kind}:${node.name}`);
    expect(names).toEqual(expect.arrayContaining([
      'trait:Base', 'class:Service', 'field:field', 'field:state',
      'method:create', 'class:Registry', 'constant:handler', 'variable:mutable',
      'enum:Color', 'enum_member:Red', 'enum_member:Blue', 'type_alias:Alias', 'method:refresh',
    ]));
    expect(names).not.toContain('class:Phantom');
    expect(names).not.toContain('class:Ghost');
    expect(result.nodes.find((node) => node.name === 'create')?.returnType).toBe('Target');
    expect(result.unresolvedReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ referenceKind: 'imports', referenceName: 'demo' }),
      expect.objectContaining({ referenceKind: 'extends', referenceName: 'Base' }),
      expect.objectContaining({ referenceKind: 'references', referenceName: 'Target' }),
      expect.objectContaining({ referenceKind: 'calls', referenceName: 'target' }),
    ]));
  });

  it('keeps Scala 3 indentation bodies bounded', () => {
    const result = extractNativeFacts('src/Indented.scala', `
object Indented:
  val answer = compute()
  def run(): Result =
    next()
class Outside
`, 'scala');
    expect(result.nodes.find((node) => node.name === 'answer')?.qualifiedName).toContain('Indented');
    expect(result.nodes.find((node) => node.name === 'run')?.qualifiedName).toContain('Indented');
    expect(result.nodes.find((node) => node.name === 'Outside')?.qualifiedName).not.toContain('Indented');
  });
});
