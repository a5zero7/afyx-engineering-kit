/**
 * AFYX Engineering Kit - Native Polyglot Language Expansion Facts
 *
 * Implements bounded native semantic fact extraction for:
 * - AFYX-225: Groovy, Elixir, Zig
 * - AFYX-226: F#, Clojure, Haskell, OCaml, Julia, Perl
 *
 * Emits structural nodes (classes, modules, structs, functions, methods, types, variables),
 * containment edges, calls, and imports/references via finishDynamicFacts.
 */

import type { ExtractionResult, Language, NodeKind } from '../../types';
import { scanSource } from './scanner';
import {
  finishDynamicFacts,
  narrowestOwner,
  unquote,
  type NativeDeclaration,
  type NativeReference,
} from './dynamic-fact-builder';

const CALLABLE_KINDS = new Set<NodeKind>(['function', 'method']);

export function extractNativePolyglotFacts(
  filePath: string,
  source: string,
  language: Language,
): ExtractionResult {
  const started = Date.now();
  const scan = scanSource(source, {
    hashComments: language === 'elixir' || language === 'julia' || language === 'perl' || language === 'clojure',
    backtickIdentifiers: language === 'fsharp' || language === 'clojure',
  });
  const tokens = scan.tokens;
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];

  const ownerAt = (index: number) => narrowestOwner(declarations, index, CALLABLE_KINDS);

  const pushDecl = (decl: NativeDeclaration): NativeDeclaration => {
    declarations.push(decl);
    return decl;
  };

  const pushRef = (
    index: number,
    name: string,
    kind: NativeReference['kind'] = 'calls',
    owner = ownerAt(index)
  ): void => {
    const token = tokens[index];
    if (token && name) {
      references.push({ owner, token, name, kind });
    }
  };

  switch (language) {
    case 'groovy': {
      // Groovy: class Foo, def bar(), import foo.bar
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (tok.text === 'class' || tok.text === 'interface' || tok.text === 'enum') {
          const next = tokens[i + 1];
          if (next && next.kind === 'identifier') {
            pushDecl({
              kind: tok.text === 'interface' ? 'interface' : 'class',
              name: next.text,
              start: i,
              end: i + 1,
              bodyStart: i + 2,
              bodyEnd: tokens.length - 1,
            });
          }
        } else if (tok.text === 'def' || tok.text === 'void') {
          const next = tokens[i + 1];
          if (next && next.kind === 'identifier' && tokens[i + 2]?.text === '(') {
            const owner = declarations[declarations.length - 1];
            pushDecl({
              kind: owner && (owner.kind === 'class' || owner.kind === 'interface') ? 'method' : 'function',
              name: next.text,
              start: i,
              end: i + 1,
              parent: owner,
            });
          }
        } else if (tok.text === 'import') {
          const imp = tokens[i + 1];
          if (imp) {
            pushRef(i + 1, imp.text, 'imports');
          }
        } else if (tok.kind === 'identifier' && tokens[i + 1]?.text === '(') {
          pushRef(i, tok.text, 'calls');
        }
      }
      break;
    }

    case 'elixir': {
      // Elixir: defmodule Foo.Bar do, def bar(x) do, alias Foo.Bar
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (tok.text === 'defmodule') {
          let modName = tokens[i + 1]?.text || '';
          let offset = i + 2;
          while (tokens[offset]?.text === '.' && tokens[offset + 1]) {
            modName += '.' + tokens[offset + 1]!.text;
            offset += 2;
          }
          if (modName) {
            pushDecl({
              kind: 'module',
              name: modName,
              start: i,
              end: offset - 1,
              bodyStart: offset,
              bodyEnd: tokens.length - 1,
            });
          }
        } else if (tok.text === 'def' || tok.text === 'defp' || tok.text === 'defmacro') {
          const fnName = tokens[i + 1];
          if (fnName && fnName.kind === 'identifier') {
            const owner = declarations.find(d => d.kind === 'module');
            pushDecl({
              kind: 'function',
              name: fnName.text,
              start: i,
              end: i + 1,
              parent: owner,
            });
          }
        } else if (tok.text === 'alias' || tok.text === 'import' || tok.text === 'use') {
          const target = tokens[i + 1];
          if (target) pushRef(i + 1, target.text, 'imports');
        } else if (tok.kind === 'identifier' && tokens[i + 1]?.text === '(') {
          pushRef(i, tok.text, 'calls');
        }
      }
      break;
    }

    case 'zig': {
      // Zig: const Foo = struct {, fn bar(x: i32) void
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (tok.text === 'fn' || (tok.text === 'pub' && tokens[i + 1]?.text === 'fn')) {
          const fnIdx = tok.text === 'pub' ? i + 2 : i + 1;
          const fnTok = tokens[fnIdx];
          if (fnTok && fnTok.kind === 'identifier') {
            pushDecl({
              kind: 'function',
              name: fnTok.text,
              start: i,
              end: fnIdx,
            });
          }
        } else if (tok.text === 'const' && tokens[i + 2]?.text === '=') {
          const nameTok = tokens[i + 1];
          const valTok = tokens[i + 3];
          if (nameTok && valTok && (valTok.text === 'struct' || valTok.text === 'enum' || valTok.text === 'union')) {
            pushDecl({
              kind: 'struct',
              name: nameTok.text,
              start: i,
              end: i + 3,
            });
          }
        } else if (tok.text === '@import') {
          const arg = tokens[i + 2];
          if (arg && arg.kind === 'string') {
            pushRef(i, unquote(arg.text), 'imports');
          }
        } else if (tok.kind === 'identifier' && tokens[i + 1]?.text === '(') {
          pushRef(i, tok.text, 'calls');
        }
      }
      break;
    }

    case 'fsharp': {
      // F#: module Foo, type Bar =, let foo x =
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (tok.text === 'module' || tok.text === 'namespace') {
          let modName = tokens[i + 1]?.text || '';
          let offset = i + 2;
          while (tokens[offset]?.text === '.' && tokens[offset + 1]?.kind === 'identifier') {
            modName += '.' + tokens[offset + 1]!.text;
            offset += 2;
          }
          if (modName) {
            pushDecl({ kind: 'module', name: modName, start: i, end: offset - 1 });
          }
        } else if (tok.text === 'type') {
          const name = tokens[i + 1];
          if (name) {
            pushDecl({ kind: 'class', name: name.text, start: i, end: i + 1 });
          }
        } else if (tok.text === 'let' || (tok.text === 'let' && tokens[i + 1]?.text === 'rec')) {
          const fnIdx = tokens[i + 1]?.text === 'rec' ? i + 2 : i + 1;
          const name = tokens[fnIdx];
          if (name && name.kind === 'identifier') {
            pushDecl({ kind: 'function', name: name.text, start: i, end: fnIdx });
          }
        } else if (tok.text === 'open') {
          const target = tokens[i + 1];
          if (target) pushRef(i + 1, target.text, 'imports');
        }
      }
      break;
    }

    case 'clojure': {
      // Clojure: (ns foo.bar), (defn foo [x]), (def bar 42)
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (tok.text === '(') {
          const form = tokens[i + 1];
          if (form) {
            if (form.text === 'ns') {
              let nsName = tokens[i + 2]?.text || '';
              let offset = i + 3;
              while (tokens[offset]?.text === '.' && tokens[offset + 1]) {
                nsName += '.' + tokens[offset + 1]!.text;
                offset += 2;
              }
              if (nsName) {
                pushDecl({ kind: 'module', name: nsName, start: i, end: offset - 1 });
              }
            } else if (form.text === 'defn' || form.text === 'defn-') {
              let fnName = tokens[i + 2]?.text || '';
              let offset = i + 3;
              while ((tokens[offset]?.text === '-' || tokens[offset]?.text === '_') && tokens[offset + 1]) {
                fnName += tokens[offset]!.text + tokens[offset + 1]!.text;
                offset += 2;
              }
              if (fnName) pushDecl({ kind: 'function', name: fnName, start: i, end: offset - 1 });
            } else if (form.text === 'def') {
              const name = tokens[i + 2];
              if (name) pushDecl({ kind: 'variable', name: name.text, start: i, end: i + 2 });
            }
          }
        }
      }
      break;
    }

    case 'haskell': {
      // Haskell: module Foo where, data Foo =, foo :: Type, foo x =
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (tok.text === 'module') {
          let modName = tokens[i + 1]?.text || '';
          let offset = i + 2;
          while (tokens[offset]?.text === '.' && tokens[offset + 1]) {
            modName += '.' + tokens[offset + 1]!.text;
            offset += 2;
          }
          if (modName) pushDecl({ kind: 'module', name: modName, start: i, end: offset - 1 });
        } else if (tok.text === 'data' || tok.text === 'type' || tok.text === 'newtype') {
          const name = tokens[i + 1];
          if (name) pushDecl({ kind: 'type_alias', name: name.text, start: i, end: i + 1 });
        } else if (tok.text === 'import') {
          const target = tokens[i + 1]?.text === 'qualified' ? tokens[i + 2] : tokens[i + 1];
          if (target) pushRef(i, target.text, 'imports');
        } else if (tok.kind === 'identifier' && tokens[i + 1]?.text === '::') {
          pushDecl({ kind: 'function', name: tok.text, start: i, end: i + 1 });
        }
      }
      break;
    }

    case 'ocaml': {
      // OCaml: module Foo =, type foo =, let foo x =
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (tok.text === 'module') {
          const name = tokens[i + 1];
          if (name) pushDecl({ kind: 'module', name: name.text, start: i, end: i + 1 });
        } else if (tok.text === 'type') {
          const name = tokens[i + 1];
          if (name) pushDecl({ kind: 'type_alias', name: name.text, start: i, end: i + 1 });
        } else if (tok.text === 'let' || (tok.text === 'let' && tokens[i + 1]?.text === 'rec')) {
          const fnIdx = tokens[i + 1]?.text === 'rec' ? i + 2 : i + 1;
          const name = tokens[fnIdx];
          if (name && name.kind === 'identifier') {
            pushDecl({ kind: 'function', name: name.text, start: i, end: fnIdx });
          }
        } else if (tok.text === 'open') {
          const target = tokens[i + 1];
          if (target) pushRef(i + 1, target.text, 'imports');
        }
      }
      break;
    }

    case 'julia': {
      // Julia: module Foo, struct Bar, function baz(x), using Pkg
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (tok.text === 'module') {
          const name = tokens[i + 1];
          if (name) pushDecl({ kind: 'module', name: name.text, start: i, end: i + 1 });
        } else if (tok.text === 'struct' || (tok.text === 'mutable' && tokens[i + 1]?.text === 'struct')) {
          const sIdx = tok.text === 'mutable' ? i + 2 : i + 1;
          const name = tokens[sIdx];
          if (name) pushDecl({ kind: 'struct', name: name.text, start: i, end: sIdx });
        } else if (tok.text === 'function') {
          const name = tokens[i + 1];
          if (name) pushDecl({ kind: 'function', name: name.text, start: i, end: i + 1 });
        } else if (tok.text === 'using' || tok.text === 'import') {
          const target = tokens[i + 1];
          if (target) pushRef(i + 1, target.text, 'imports');
        } else if (tok.kind === 'identifier' && tokens[i + 1]?.text === '(') {
          pushRef(i, tok.text, 'calls');
        }
      }
      break;
    }

    case 'perl': {
      // Perl: package Foo;, sub bar {, use Bar;
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (tok.text === 'package') {
          const name = tokens[i + 1];
          if (name) pushDecl({ kind: 'module', name: name.text.replace(/;$/, ''), start: i, end: i + 1 });
        } else if (tok.text === 'sub') {
          const name = tokens[i + 1];
          if (name && name.kind === 'identifier') {
            pushDecl({ kind: 'function', name: name.text, start: i, end: i + 1 });
          }
        } else if (tok.text === 'use' || tok.text === 'require') {
          const target = tokens[i + 1];
          if (target) pushRef(i + 1, target.text.replace(/;$/, ''), 'imports');
        }
      }
      break;
    }

    default:
      break;
  }

  return finishDynamicFacts(
    filePath,
    source,
    language,
    scan,
    declarations,
    references,
    started,
  );
}
