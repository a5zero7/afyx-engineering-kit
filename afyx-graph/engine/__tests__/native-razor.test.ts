import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { syntaxRegionsFor, tokenizeSource } from '../src/extraction/syntax-tokens';
import { extractFromSource } from '../src/extraction/extract';

const RAZOR = `<ServiceCard />
@inject CatalogService Service
@code {
  private CatalogService _service = new CatalogService();
  void Refresh() { _service.Load(); }
}`;

const CSHTML = `@model LoginModel
@functions {
  private AuditService _audit = new AuditService();
  void Record() { _audit.Write(); }
}
@{ helper(); }`;

function referenceContract(result: ReturnType<typeof extractFromSource>) {
  return result.unresolvedReferences.map((reference) => ({
    name: reference.referenceName,
    kind: reference.referenceKind,
    line: reference.line,
  })).sort((left, right) => `${left.line}:${left.kind}:${left.name}`.localeCompare(`${right.line}:${right.kind}:${right.name}`));
}

describe('Afyx-native Razor/Blazor C# regions', () => {

  afterEach(() => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
  });

  it.each([
    ['Blazor', 'Component.razor', RAZOR],
    ['Razor', 'View.cshtml', CSHTML],
  ])('preserves the established %s dependency-reference contract', (_label, file, source) => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
    const oldResult = extractFromSource(file, source, 'razor');
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const nativeResult = extractFromSource(file, source, 'razor');
    const oldContract = referenceContract(oldResult);
    const nativeContract = referenceContract(nativeResult);
    expect(nativeContract).toEqual(expect.arrayContaining(oldContract));
    if (file.endsWith('.razor')) expect(nativeContract).toEqual(oldContract);
    else expect(nativeContract.filter((reference) => reference.name === 'helper'))
      .toEqual([{ name: 'helper', kind: 'calls', line: 6 }]);
  });

  it('uses native C# semantic and syntax routes without requesting a parser', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    expect(extractFromSource('Component.razor', RAZOR, 'razor').unresolvedReferences.length).toBeGreaterThan(0);
    expect(extractFromSource('View.cshtml', CSHTML, 'razor').unresolvedReferences.length).toBeGreaterThan(0);
    expect((await tokenizeSource(RAZOR, 'razor'))?.grammars).toEqual(['csharp']);
    expect((await tokenizeSource(CSHTML, 'razor'))?.grammars).toEqual(['csharp']);
  });

  it('maps same-line and later-region references to absolute UTF-16 positions and component ownership', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = `@code { void Run() { first(); } }
<div />
@functions {
  void Later() { second(); }
}`;
    const result = extractFromSource('Offsets.razor', source, 'razor');
    const component = result.nodes.find((node) => node.kind === 'component');
    const first = result.unresolvedReferences.find((reference) => reference.referenceName === 'first');
    const second = result.unresolvedReferences.find((reference) => reference.referenceName === 'second');
    expect(result.nodes).toEqual([component]);
    expect(first).toEqual(expect.objectContaining({
      fromNodeId: component?.id,
      line: 1,
      column: source.indexOf('first'),
    }));
    expect(second).toEqual(expect.objectContaining({
      fromNodeId: component?.id,
      line: 4,
      column: 17,
    }));
  });

  it('keeps incomplete native code bounded and rejects comment, attribute, and escaped transitions', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = `@* @code { hidden(); } *@
<!-- @functions { hiddenHtml(); } -->
<div title="@code { hiddenAttribute(); }">@@code { escaped(); }</div>
@code { kept(); }
@functions {
  void Prefix() { partial(`;
    const result = extractFromSource('Incomplete.razor', source, 'razor');
    const calls = result.unresolvedReferences
      .filter((reference) => reference.referenceKind === 'calls')
      .map((reference) => reference.referenceName);
    expect(calls).toEqual(expect.arrayContaining(['kept', 'partial']));
    for (const excluded of ['hidden', 'hiddenHtml', 'hiddenAttribute', 'escaped']) {
      expect(calls).not.toContain(excluded);
    }
    const regions = syntaxRegionsFor(source, 'razor');
    expect(regions).toHaveLength(2);
    expect(regions?.[1]?.end).toBe(source.length);
  });

  it('keeps directives and component tags container-owned while leaving inline expressions out of scope', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = `@model PageModel
@inherits BasePage<PageModel>
@inject IService Service
<Widget TItem="CatalogItem" />
<p>@Compute()</p>`;
    const result = extractFromSource('Contract.razor', source, 'razor');
    const names = result.unresolvedReferences.map((reference) => reference.referenceName);
    expect(names).toEqual(expect.arrayContaining(['PageModel', 'BasePage', 'IService', 'Widget', 'CatalogItem']));
    expect(names).not.toContain('Compute');
  });
});
