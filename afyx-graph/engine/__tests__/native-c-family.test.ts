import { afterEach, describe, expect, it } from 'vitest';
import { extractNativeFacts } from '../src/extraction/native/fact-extractor';
import { extractFromSource } from '../src/extraction/extract';
import { guardsInSource } from '../src/graph/branch-guards';
import type { Language } from '../src/types';

afterEach(() => { delete process.env.AFYX_GRAPH_NATIVE_PARSER; });

function names(result: ReturnType<typeof extractNativeFacts>): string[] {
  return result.nodes.map((node) => `${node.kind}:${node.name}`);
}

function refs(result: ReturnType<typeof extractNativeFacts>, kind: string): string[] {
  return result.unresolvedReferences.filter((ref) => ref.referenceKind === kind).map((ref) => ref.referenceName);
}

describe('Afyx-native C semantic route', () => {
  it('extracts includes, typedef aggregates, functions, calls, types, and function pointers', () => {
    const source = `
#include "entry.h"
typedef struct Entry { int value; } Entry;
typedef void (*entry_cb)(Entry *);
static void visit(Entry *entry) { consume(entry); }
static entry_cb callbacks[] = { visit };
int run(Entry *entry) { visit(entry); return entry->value; }
`;
    const result = extractNativeFacts('entry.c', source, 'c');
    expect(names(result)).toEqual(expect.arrayContaining([
      'struct:Entry', 'type_alias:entry_cb', 'function:visit', 'function:run', 'import:entry.h',
    ]));
    expect(refs(result, 'calls')).toEqual(expect.arrayContaining(['consume', 'visit']));
    expect(refs(result, 'function_ref')).toContain('visit');
    expect(refs(result, 'references')).toContain('Entry');
  });
});

describe('Afyx-native C++ semantic route', () => {
  it('preserves namespace/class ownership, inheritance, qualified calls, templates, and member refs', () => {
    const source = `
#include <memory>
namespace demo {
class Base {};
class Widget : public Base {
public:
  Widget() {}
  void render() { draw(); }
  static Widget make() { return Widget(); }
};
template <typename T> struct Box { T value; };
void wire(Box<Widget> box) { Widget::make(); auto cb = &Widget::render; }
}
`;
    const result = extractNativeFacts('widget.cpp', source, 'cpp');
    expect(names(result)).toEqual(expect.arrayContaining([
      'namespace:demo', 'class:Base', 'class:Widget', 'method:Widget', 'method:render',
      'method:make', 'struct:Box', 'function:wire', 'import:memory',
    ]));
    expect(result.nodes.find((node) => node.name === 'render')?.qualifiedName).toContain('Widget::render');
    expect(refs(result, 'extends')).toContain('Base');
    expect(refs(result, 'calls')).toContain('Widget::make');
    expect(refs(result, 'function_ref')).toContain('Widget::render');
    expect(refs(result, 'references')).toEqual(expect.arrayContaining(['Box', 'Widget']));
  });
});

describe('Afyx-native Objective-C semantic route', () => {
  it('extracts interface/implementation ownership, protocols, properties, messages, and imports', () => {
    const source = `
#import <Foundation/Foundation.h>
@protocol Runnable
@end
@interface Worker : NSObject <Runnable>
@property (nonatomic) NSString *name;
- (void)run;
+ (Worker *)shared;
@end
@implementation Worker
- (void)run { [self notify:@"done"]; NSLog(@"done"); }
+ (Worker *)shared { return [Worker new]; }
@end
`;
    const result = extractNativeFacts('Worker.m', source, 'objc');
    expect(names(result)).toEqual(expect.arrayContaining([
      'protocol:Runnable', 'class:Worker', 'property:name', 'method:run', 'method:shared',
      'import:Foundation/Foundation.h',
    ]));
    expect(result.nodes.filter((node) => node.kind === 'method' && node.name === 'run')).toHaveLength(1);
    expect(refs(result, 'extends')).toContain('NSObject');
    expect(refs(result, 'implements')).toContain('Runnable');
    expect(refs(result, 'calls')).toEqual(expect.arrayContaining(['notify:', 'NSLog', 'Worker.new']));
  });
});

describe('Afyx-native C# semantic route', () => {
  it('extracts namespaces, records/types, members, inheritance, nullable generics, calls, and delegates', () => {
    const source = `
using System.Collections.Generic;
namespace Demo;
public interface IRunner { }
public record Payload(string Value);
public class Service : IRunner {
  public List<Payload>? Items { get; init; }
  public int Count => Items.Count;
  public void Run() { Helper(); System.Console.WriteLine(Count); }
  private void Helper() { }
  public void Wire() { System.Action callback = this.Helper; }
}
`;
    const result = extractNativeFacts('Service.cs', source, 'csharp');
    expect(names(result)).toEqual(expect.arrayContaining([
      'namespace:Demo', 'interface:IRunner', 'class:Payload', 'class:Service',
      'property:Items', 'property:Count', 'method:Run', 'method:Helper', 'method:Wire',
      'import:System.Collections.Generic',
    ]));
    expect(refs(result, 'extends')).toContain('IRunner');
    expect(refs(result, 'references')).toEqual(expect.arrayContaining(['List', 'Payload']));
    expect(refs(result, 'calls')).toEqual(expect.arrayContaining(['Helper', 'System.Console.WriteLine']));
    expect(refs(result, 'function_ref')).toContain('Helper');
  });

  it('records every method/property/field type dependency in a file-scoped namespace', () => {
    const source = `namespace MyApp;
public class DataExporter {
  public SessionInfoDto Build(UserDto user, SessionInfoDto session) { return session; }
  public Task<SessionInfoDto> BuildAsync(UserDto user) { return Task.FromResult(new SessionInfoDto()); }
  public SessionInfoDto Latest { get; set; } = new();
  private UserDto _cached;
}`;
    const result = extractNativeFacts('Service.cs', source, 'csharp');
    const typeRefs = result.unresolvedReferences.filter((ref) => ref.referenceKind === 'references');
    expect(typeRefs.filter((ref) => ref.referenceName === 'SessionInfoDto')).toHaveLength(4);
    expect(typeRefs.filter((ref) => ref.referenceName === 'UserDto')).toHaveLength(3);
    expect(result.nodes.find((node) => node.name === 'Build')?.qualifiedName).toBe('MyApp::DataExporter::Build');
  });
});

describe('C-family native routing and branch guards', () => {
  it.each([
    ['c', 'int route(int ready) { if (!ready) return 0; work(); return 1; }'],
    ['cpp', 'void route(bool ready) { if (!ready) return; work(); }'],
    ['objc', '@implementation App\n- (void)route { if (!ready) return; [self work]; }\n@end'],
    ['csharp', 'class App { void Route(bool ready) { if (!ready) return; Work(); } }'],
  ] as const)('%s uses native facts and guards behind the feature gate', async (language, source) => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const routed = extractFromSource(`fixture.${language === 'csharp' ? 'cs' : language === 'objc' ? 'm' : language === 'cpp' ? 'cpp' : 'c'}`, source);
    expect(routed.nodes.some((node) => node.kind === 'function' || node.kind === 'method')).toBe(true);
    const target = language === 'objc' ? '[self work]' : language === 'csharp' ? 'Work()' : 'work()';
    const offset = source.indexOf(target);
    const prefix = source.slice(0, offset);
    const line = prefix.split('\n').length;
    const column = prefix.length - (prefix.lastIndexOf('\n') + 1);
    const guards = await guardsInSource(source, language as Language, line, column);
    expect(guards).toEqual(expect.arrayContaining([expect.objectContaining({ form: 'guard', negated: true })]));
  });
});
