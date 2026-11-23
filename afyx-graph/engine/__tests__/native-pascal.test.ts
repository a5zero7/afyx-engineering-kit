import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { extractFromSource } from '../src/extraction/extract';
import { extractNativePascalFacts } from '../src/extraction/native/pascal-facts';
import { scanSource } from '../src/extraction/native/scanner';
import { tokenizeSource } from '../src/extraction/syntax-tokens';

const SOURCE = `unit Demo;
interface
uses System.SysUtils, Helpers;
const MAX_ITEMS = 10;
type
  IWorker = interface
    procedure Run;
  end;
  TWorker = class(TBase, IWorker)
  private
    FCount: Integer;
  public
    constructor Create;
    class function Build: TWorker; static;
    procedure Run;
    property Count: Integer read FCount;
  end;
  TState = (stIdle, stReady);
  TLabel = string;
implementation
constructor TWorker.Create;
begin
  inherited Create;
end;
class function TWorker.Build: TWorker;
begin
  Result := TWorker.Create;
end;
procedure TWorker.Run;
begin
  if FCount < MAX_ITEMS then Log(FCount);
end;
end.`;

function semantic(result: ReturnType<typeof extractFromSource>) {
  const byId = new Map(result.nodes.map((node) => [node.id, `${node.kind}:${node.name}`]));
  return {
    nodes: result.nodes.filter((node) => node.kind !== 'file').map((node) => ({
      kind: node.kind, name: node.name, qualifiedName: node.qualifiedName,
      visibility: node.visibility, static: node.isStatic, returnType: node.returnType,
    })).sort((left, right) => `${left.kind}:${left.qualifiedName}`.localeCompare(`${right.kind}:${right.qualifiedName}`)),
    edges: result.edges.filter((edge) => edge.metadata?.valueRef !== true)
      .map((edge) => `${byId.get(edge.source)}>${edge.kind}>${byId.get(edge.target)}`).sort(),
    refs: result.unresolvedReferences.map((reference) =>
      `${byId.get(reference.fromNodeId)}>${reference.referenceKind}>${reference.referenceName}`).sort(),
  };
}

describe('Afyx-native Pascal facts', () => {

  afterEach(() => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
  });

  it('preserves the established semantic contract against the parser fallback', () => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
    const oldResult = extractFromSource('Demo.pas', SOURCE, 'pascal');
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const newResult = extractFromSource('Demo.pas', SOURCE, 'pascal');
    expect(semantic(newResult)).toEqual(semantic(oldResult));
  });

  it('routes native-gated semantic extraction without requesting a parser', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const result = extractFromSource('Demo.pas', SOURCE, 'pascal');
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'class', name: 'TWorker' }),
      expect.objectContaining({ kind: 'method', name: 'Run' }),
    ]));
  });

  it('classifies Pascal source natively, including both comment forms', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = "{ brace } (* paren *) type TThing = class end;";
    const result = await tokenizeSource(source, 'pascal');
    expect(result?.spans.filter((span) => span.cls === 'comment')).toHaveLength(2);
    expect(result?.spans.some((span) => span.cls === 'def' && source.slice(span.start, span.end) === 'TThing')).toBe(true);
  });

  it('keeps useful prefix facts for an incomplete editor buffer', () => {
    const scan = scanSource("unit Broken; type TThing = class { open", { hashComments: false, pascalSyntax: true });
    expect(scan.unterminated).toContain('comment');
    const result = extractNativePascalFacts('Broken.pas', "unit Broken; type TThing = class { open");
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'module', name: 'Broken' }),
      expect.objectContaining({ kind: 'class', name: 'TThing' }),
    ]));
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'native_incomplete_source' }),
    ]));
  });
});
