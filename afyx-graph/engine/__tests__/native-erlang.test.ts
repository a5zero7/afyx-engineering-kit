import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { extractNativeErlangFacts } from '../src/extraction/native/erlang-facts';
import { scanSource } from '../src/extraction/native/scanner';
import { tokenizeSource } from '../src/extraction/syntax-tokens';
import { extractFromSource } from '../src/extraction/extract';

const SOURCE = `-module(native_sample).
-behaviour(gen_server).
-export([run/1, run/2]).
-record(state, {value}).
-type result() :: ok | error.
-define(TARGET, worker).

run(X) -> local(X);
run(#state{value = X}) -> ?TARGET:work(X).
run(X, Y) -> other:join(X, Y).
local(X) -> X.
`;

function semantic(result: ReturnType<typeof extractFromSource>) {
  const owner = new Map(result.nodes.map((node) => [node.id, `${node.kind}:${node.qualifiedName}`]));
  return {
    nodes: result.nodes.map((node) => ({
      kind: node.kind, name: node.name, qualifiedName: node.qualifiedName,
      exported: node.isExported, signature: node.signature,
    })),
    refs: result.unresolvedReferences.map((ref) => ({
      owner: owner.get(ref.fromNodeId), name: ref.referenceName, kind: ref.referenceKind,
    })),
  };
}

describe('Afyx-native Erlang facts', () => {

  afterEach(() => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
  });

  it('preserves the representative parser-backed semantic contract', () => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
    const oldResult = extractFromSource('src/native_sample.erl', SOURCE, 'erlang');
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const newResult = extractFromSource('src/native_sample.erl', SOURCE, 'erlang');
    expect(semantic(newResult)).toEqual(semantic(oldResult));
  });

  it('routes gated semantic extraction without requesting Tree-sitter', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const result = extractFromSource('src/native_sample.erl', SOURCE, 'erlang');
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'namespace', name: 'native_sample' }),
      expect.objectContaining({ kind: 'function', qualifiedName: 'native_sample::run/1' }),
      expect.objectContaining({ kind: 'function', qualifiedName: 'native_sample::run/2' }),
    ]));
  });

  it('classifies Erlang definitions, keywords, literals, and percent comments natively', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = "% note\n-module(m).\nrun(X) when is_atom(X) -> 'ok'.";
    const result = await tokenizeSource(source, 'erlang');
    const spans = result?.spans ?? [];
    const values = (cls: string) => spans.filter((span) => span.cls === cls).map((span) => source.slice(span.start, span.end));
    expect(values('comment')).toContain('% note');
    expect(values('def')).toContain('run');
    expect(values('keyword')).toEqual(expect.arrayContaining(['when']));
    expect(values('string')).toContain("'ok'");
  });

  it('preserves established syntax classes for the ordinary Erlang surface', async () => {
    const source = '% note\n-module(m).\nrun(X) when is_atom(X) -> "ok".';
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
    const oldResult = await tokenizeSource(source, 'erlang');
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const newResult = await tokenizeSource(source, 'erlang');
    // The native recognizer can finally mark a function name as `def`; the
    // grammar adapter exposed the name below fun_decl and therefore painted it
    // as a plain identifier. Normalize only that intentional improvement.
    const semanticSpans = (result: Awaited<ReturnType<typeof tokenizeSource>>) =>
      result?.spans.map((span) => {
        const text = source.slice(span.start, span.end);
        return [span.cls === 'def' && text === 'run' ? 'ident' : span.cls, text];
      });
    expect(semanticSpans(newResult)).toEqual(semanticSpans(oldResult));
  });

  it('keeps calls in anonymous and named fun bodies owned by the enclosing function', () => {
    const source = `-module(m).
run() ->
    A = fun() -> helper() end,
    B = fun Loop(0) -> done; Loop(N) -> Loop(N - 1) end,
    {A, B}.
helper() -> ok.
`;
    const result = extractNativeErlangFacts('src/m.erl', source);
    const run = result.nodes.find((node) => node.qualifiedName === 'm::run/0');
    const calls = result.unresolvedReferences
      .filter((ref) => ref.fromNodeId === run?.id && ref.referenceKind === 'calls')
      .map((ref) => ref.referenceName);
    expect(calls).toContain('helper/0');
    expect(calls).not.toContain('Loop/1');
  });

  it('does not count commas inside binary syntax as function arity', () => {
    const source = '-module(m).\npack(<<A, B>>, C) -> other:send(<<A, B>>, C).';
    const result = extractNativeErlangFacts('src/m.erl', source);
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ qualifiedName: 'm::pack/2' }),
    ]));
    expect(result.unresolvedReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ referenceKind: 'calls', referenceName: 'other::send/2' }),
    ]));
  });

  it('keeps prefix facts and a bounded diagnostic for incomplete editor input', () => {
    const source = '-module(m).\nrun(X) -> io:format("unterminated';
    const scan = scanSource(source, { hashComments: false, erlangSyntax: true });
    expect(scan.unterminated).toContain('string');
    const result = extractNativeErlangFacts('src/m.erl', source);
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'namespace', name: 'm' }),
      expect.objectContaining({ kind: 'function', qualifiedName: 'm::run/1' }),
    ]));
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'native_incomplete_source' }),
    ]));
  });
});
