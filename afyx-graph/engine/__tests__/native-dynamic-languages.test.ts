import { afterEach, describe, expect, it } from 'vitest';
import { extractNativePhpFacts } from '../src/extraction/native/php-facts';
import { extractNativeRubyFacts } from '../src/extraction/native/ruby-facts';
import { extractNativeLuaFacts } from '../src/extraction/native/lua-facts';
import { extractNativeRFacts } from '../src/extraction/native/r-facts';
import { extractFromSource } from '../src/extraction/extract';
import { tokenizeSource } from '../src/extraction/syntax-tokens';

afterEach(() => { delete process.env.AFYX_GRAPH_NATIVE_PARSER; });

function names(result: ReturnType<typeof extractNativePhpFacts>): string[] {
  return result.nodes.map((node) => `${node.kind}:${node.qualifiedName}`);
}

function refs(result: ReturnType<typeof extractNativePhpFacts>, kind: string): string[] {
  return result.unresolvedReferences.filter((ref) => ref.referenceKind === kind).map((ref) => ref.referenceName);
}

describe('Afyx-native PHP semantic route', () => {
  it('preserves namespaces, imports, containers, ownership, composition, and calls', () => {
    const result = extractNativePhpFacts('Service.php', `<?php
namespace App\\Services;
use Vendor\\Contracts\\Runner;
trait Logs {}
interface Work {}
class Service extends Base implements Work {
  use Logs;
  private Client $client;
  public function run(Job $job): Result { return $this->client->send($job); }
}`);
    expect(names(result)).toEqual(expect.arrayContaining([
      'import:Vendor\\Contracts\\Runner', 'trait:App\\Services::Logs',
      'interface:App\\Services::Work', 'class:App\\Services::Service',
      'field:App\\Services::Service::client', 'method:App\\Services::Service::run',
    ]));
    expect(refs(result, 'extends')).toContain('Base');
    expect(refs(result, 'implements')).toEqual(expect.arrayContaining(['Work', 'Logs']));
    expect(refs(result, 'calls')).toContain('this->client.send');
    expect(refs(result, 'references')).toEqual(expect.arrayContaining(['Job', 'Result']));
  });

  it('keeps assignment-bound closures separate from their enclosing method', () => {
    const result = extractNativePhpFacts('Callbacks.php', `<?php class C {
      function outer() { $cb = function($x) { inner($x); }; $map = fn($x) => transform($x); }
    }`);
    const callback = result.nodes.find((node) => node.name === 'cb');
    const arrow = result.nodes.find((node) => node.name === 'map');
    expect(callback?.kind).toBe('method');
    expect(arrow?.kind).toBe('method');
    expect(result.unresolvedReferences.find((ref) => ref.referenceName === 'inner')?.fromNodeId).toBe(callback?.id);
    expect(result.unresolvedReferences.find((ref) => ref.referenceName === 'transform')?.fromNodeId).toBe(arrow?.id);
  });

  it('routes facts and syntax natively behind the gate', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    expect(extractFromSource('X.php', '<?php class X { function run(): string {} }').nodes.some((node) => node.name === 'X')).toBe(true);
    const source = '<?php class X { public function run(): string {} }';
    const syntax = await tokenizeSource(source, 'php');
    const spans = syntax?.spans.map((span) => [span.cls, source.slice(span.start, span.end)]);
    expect(spans).toEqual(expect.arrayContaining([['keyword', 'class'], ['def', 'X'], ['def', 'run'], ['type', 'string']]));
  });
});

describe('Afyx-native Ruby semantic route', () => {
  it('extracts modules, classes, singleton methods, mixins, requires, and receiver calls', () => {
    const result = extractNativeRubyFacts('lib/worker.rb', `require_relative 'base'
module Jobs
  class Worker < Base
    include Logging
    def self.run(item)
      client.send(item)
    end
  end
end`);
    expect(names(result as ReturnType<typeof extractNativePhpFacts>)).toEqual(expect.arrayContaining([
      'module:Jobs', 'class:Jobs::Worker', 'method:Jobs::Worker::run', 'import:base',
    ]));
    expect(refs(result as ReturnType<typeof extractNativePhpFacts>, 'extends')).toContain('Base');
    expect(refs(result as ReturnType<typeof extractNativePhpFacts>, 'implements')).toContain('Logging');
    expect(refs(result as ReturnType<typeof extractNativePhpFacts>, 'calls')).toContain('client.send');
  });

  it('gives assignment-bound lambdas an independent scope', () => {
    const result = extractNativeRubyFacts('callbacks.rb', 'callback = ->(x) { transform(x) }\ncallback.call(1)');
    const callback = result.nodes.find((node) => node.name === 'callback');
    expect(callback?.kind).toBe('function');
    expect(result.unresolvedReferences.find((ref) => ref.referenceName === 'transform')?.fromNodeId).toBe(callback?.id);
  });

  it('uses native syntax classification behind the gate', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = 'class Worker\n  def run(x)\n    x\n  end\nend';
    const syntax = await tokenizeSource(source, 'ruby');
    const spans = syntax?.spans.map((span) => [span.cls, source.slice(span.start, span.end)]);
    expect(spans).toEqual(expect.arrayContaining([['keyword', 'class'], ['def', 'Worker'], ['keyword', 'def'], ['def', 'run']]));
    const incomplete = 'class Store';
    const incompleteSyntax = await tokenizeSource(incomplete, 'ruby');
    expect(incompleteSyntax?.spans.map((span) => [span.cls, incomplete.slice(span.start, span.end)]))
      .toContainEqual(['def', 'Store']);
  });
});

describe('Afyx-native Lua/Luau semantic route', () => {
  it('extracts Lua declarations, table methods, requires, calls, and callable values', () => {
    const result = extractNativeLuaFacts('mod.lua', `local dep = require("net.http")
local function helper(x) return x end
function M:run(x) return helper(x) end
M.callback = function(x) return helper(x) end
register(helper)`, 'lua');
    expect(names(result as ReturnType<typeof extractNativePhpFacts>)).toEqual(expect.arrayContaining([
      'import:net.http', 'function:helper', 'method:M::run', 'method:M::callback',
    ]));
    expect(refs(result as ReturnType<typeof extractNativePhpFacts>, 'calls')).toContain('helper');
    expect(refs(result as ReturnType<typeof extractNativePhpFacts>, 'function_ref')).toContain('helper');
  });

  it('attributes calls inside anonymous functions to the function-valued binding', () => {
    const result = extractNativeLuaFacts('scope.lua', 'local cb = function(x)\n nested(x)\nend\nouter()', 'lua');
    const callback = result.nodes.find((node) => node.name === 'cb');
    expect(result.unresolvedReferences.find((ref) => ref.referenceName === 'nested')?.fromNodeId).toBe(callback?.id);
    expect(result.unresolvedReferences.find((ref) => ref.referenceName === 'outer')?.fromNodeId).toBe('file:scope.lua');
  });

  it('adds Luau aliases, typed signatures, return types, and references without duplicating Lua core', () => {
    const result = extractNativeLuaFacts('typed.luau', `export type Handler<T> = (T) -> Result
function Client:fetch(path: string): Response
  return send(path)
end`, 'luau');
    expect(names(result as ReturnType<typeof extractNativePhpFacts>)).toEqual(expect.arrayContaining(['type_alias:Handler', 'method:Client::fetch']));
    const fetch = result.nodes.find((node) => node.name === 'fetch');
    expect(fetch?.signature).toContain(': Response');
    expect(fetch?.returnType).toBe('Response');
    expect(refs(result as ReturnType<typeof extractNativePhpFacts>, 'references')).toContain('Result');
  });

  it('classifies Lua comments and Luau types natively', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = '-- note\nexport type Handler = (string) -> boolean';
    const syntax = await tokenizeSource(source, 'luau');
    const spans = syntax?.spans.map((span) => [span.cls, source.slice(span.start, span.end)]);
    expect(spans).toEqual(expect.arrayContaining([['comment', '-- note'], ['keyword', 'export'], ['keyword', 'type'], ['def', 'Handler'], ['type', 'string']]));
  });
});

describe('Afyx-native R semantic route', () => {
  it('extracts assigned and nested functions with lexical call ownership', () => {
    const result = extractNativeRFacts('model.R', `fit <- function(data) {
  prep <- function(x) scale(x)
  train(prep(data))
}`);
    expect(names(result as ReturnType<typeof extractNativePhpFacts>)).toEqual(expect.arrayContaining(['function:fit', 'function:fit::prep']));
    const fit = result.nodes.find((node) => node.name === 'fit');
    const prep = result.nodes.find((node) => node.name === 'prep');
    expect(result.unresolvedReferences.find((ref) => ref.referenceName === 'scale')?.fromNodeId).toBe(prep?.id);
    expect(result.unresolvedReferences.find((ref) => ref.referenceName === 'train')?.fromNodeId).toBe(fit?.id);
  });

  it('preserves package/source dependencies, namespaced calls, and callable values', () => {
    const result = extractNativeRFacts('main.R', `library(dplyr)
source("helpers.R")
clean <- function(x) x
purrr::map(items, clean)`);
    expect(names(result as ReturnType<typeof extractNativePhpFacts>)).toEqual(expect.arrayContaining(['import:dplyr', 'import:helpers.R', 'function:clean']));
    expect(refs(result as ReturnType<typeof extractNativePhpFacts>, 'calls')).toContain('purrr::map');
    expect(refs(result as ReturnType<typeof extractNativePhpFacts>, 'function_ref')).toContain('clean');
  });

  it('extracts R6/ggproto class methods and native syntax', async () => {
    const result = extractNativeRFacts('classes.R', 'Geom <- ggproto("Geom", Parent, draw = function(x) { render(x) })');
    expect(names(result as ReturnType<typeof extractNativePhpFacts>)).toEqual(expect.arrayContaining(['class:Geom', 'method:Geom::draw']));
    expect(refs(result as ReturnType<typeof extractNativePhpFacts>, 'extends')).toContain('Parent');
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = 'fit <- function(x) x # note';
    const syntax = await tokenizeSource(source, 'r');
    const spans = syntax?.spans.map((span) => [span.cls, source.slice(span.start, span.end)]);
    expect(spans).toEqual(expect.arrayContaining([['def', 'fit'], ['keyword', 'function'], ['comment', '# note']]));
  });
});
