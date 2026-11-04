import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tokenizeSource } from '../src/extraction/syntax-tokens';
import { extractFromSource } from '../src/extraction/extract';

function semantic(result: ReturnType<typeof extractFromSource>) {
  const owners = new Map(result.nodes.map((node) => [node.id, `${node.kind}:${node.qualifiedName}`]));
  return {
    nodes: result.nodes.filter((node) => node.kind !== 'file').map((node) => ({
      kind: node.kind, name: node.name, qualifiedName: node.qualifiedName,
      visibility: node.visibility, returnType: node.returnType,
    })).sort((left, right) => `${left.kind}:${left.qualifiedName}`.localeCompare(`${right.kind}:${right.qualifiedName}`)),
    refs: result.unresolvedReferences.map((reference) => ({
      owner: owners.get(reference.fromNodeId), kind: reference.referenceKind, name: reference.referenceName,
    })).sort((left, right) => `${left.owner}|${left.kind}|${left.name}`.localeCompare(`${right.owner}|${right.kind}|${right.name}`)),
  };
}

describe('Afyx-native CFML family', () => {

  afterEach(() => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
  });

  const bare = `component extends="Base" implements="IRun" {
  property name="svc" inject="UserService";
  private string function run(required UserService arg) {
    var localSvc = new UserService();
    helper();
    return variables.svc.save(arg);
  }
}`;

  const mixed = `<cfcomponent name="Mixed" extends="Base">
  <cffunction name="run" access="private" returntype="string">
    <cfargument name="svc" type="UserService">
    <cfif true><cfscript>
      helper();
      return svc.save();
    </cfscript></cfif>
    <cfquery name="q" datasource="#variables.dsn#">
      SELECT * FROM users WHERE id = #currentUser().getId()#
    </cfquery>
  </cffunction>
  <cfscript>function configure() { return settings(); }</cfscript>
</cfcomponent>`;

  it.each([
    ['bare CFScript', 'Service.cfc', bare, 'cfml' as const],
    ['standalone CFScript', 'Service.cfs', bare, 'cfscript' as const],
    ['mixed tags/script/query', 'Mixed.cfc', mixed, 'cfml' as const],
  ])('preserves the parser-backed semantic contract for %s', (_label, file, source, language) => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
    const oldResult = extractFromSource(file, source, language);
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const nativeResult = extractFromSource(file, source, language);
    expect(semantic(nativeResult)).toEqual(semantic(oldResult));
  });

  it('preserves tag-to-script-to-query ownership and bounded incomplete input', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const incomplete = mixed.replace('</cfcomponent>', '<cffunction name="partial"><cfscript>openCall(\n</cfcomponent>');
    const result = extractFromSource('Mixed.cfc', incomplete, 'cfml');
    const owner = new Map(result.nodes.map((node) => [node.id, node.name]));
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'class', name: 'Mixed' }),
      expect.objectContaining({ kind: 'method', name: 'run' }),
      expect.objectContaining({ kind: 'method', name: 'configure' }),
      expect.objectContaining({ kind: 'method', name: 'partial' }),
    ]));
    expect(result.unresolvedReferences.filter((reference) => ['helper', 'svc.save', 'currentUser', 'getId'].includes(reference.referenceName))
      .map((reference) => [reference.referenceName, owner.get(reference.fromNodeId)]))
      .toEqual(expect.arrayContaining([
        ['helper', 'run'], ['svc.save', 'run'], ['currentUser', 'run'], ['getId', 'run'],
      ]));
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native_incomplete_source' })]));
  });

  it('routes CFML, CFScript, and CFQuery semantic/syntax without requesting a parser', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    expect(extractFromSource('Mixed.cfc', mixed, 'cfml').nodes.some((node) => node.name === 'run')).toBe(true);
    expect(extractFromSource('Service.cfs', bare, 'cfscript').nodes.some((node) => node.name === 'run')).toBe(true);
    const cfmlSyntax = await tokenizeSource(mixed, 'cfml');
    const scriptSyntax = await tokenizeSource(bare, 'cfscript');
    const querySyntax = await tokenizeSource('SELECT #currentUser().getId()#', 'cfquery');
    expect(cfmlSyntax?.spans.length).toBeGreaterThan(0);
    expect(scriptSyntax?.spans.length).toBeGreaterThan(0);
    expect(querySyntax?.spans.length).toBeGreaterThan(0);
    const values = (source: string, result: Awaited<ReturnType<typeof tokenizeSource>>, cls: string) =>
      (result?.spans ?? []).filter((span) => span.cls === cls).map((span) => source.slice(span.start, span.end));
    expect(values(bare, scriptSyntax, 'def')).toEqual(expect.arrayContaining(['run']));
    expect(values('SELECT #currentUser().getId()#', querySyntax, 'keyword')).toContain('SELECT');
    expect(values('SELECT #currentUser().getId()#', querySyntax, 'ident')).toEqual(expect.arrayContaining(['currentUser', 'getId']));
  });
});
