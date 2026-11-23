import * as path from 'path';
import type { Edge, ExtractionResult, Language, Node, NodeKind, UnresolvedReference } from '../../types';
import { generateNodeId } from '../node-id';
import { scanSource, type NativeToken } from './scanner';

type CFamilyLanguage = 'c' | 'cpp' | 'objc' | 'csharp';

interface Declaration {
  kind: NodeKind;
  name: string;
  start: number;
  end: number;
  bodyStart?: number;
  bodyEnd?: number;
  parent?: Declaration;
  qualifiedOwner?: string;
  visibility?: Node['visibility'];
  static?: boolean;
  async?: boolean;
  abstract?: boolean;
  returnType?: string;
  signature?: string;
  docstring?: string;
}

const CONTROL = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'lock', 'using', 'sizeof', 'typeof', 'nameof']);
const TYPE_WORDS = new Set([
  'void', 'bool', 'boolean', 'byte', 'sbyte', 'char', 'short', 'ushort', 'int', 'uint', 'long', 'ulong',
  'float', 'double', 'decimal', 'string', 'object', 'dynamic', 'var', 'auto', 'signed', 'unsigned', 'const',
  'volatile', 'static', 'extern', 'inline', 'virtual', 'override', 'final', 'public', 'private', 'protected',
  'internal', 'readonly', 'async', 'unsafe', 'partial', 'abstract', 'sealed', 'struct', 'class', 'enum',
  'union', 'interface', 'record', 'typename', 'template', 'id', 'instancetype', 'nullable', 'nonnull',
  '__global__', '__device__', '__host__', '__constant__', '__shared__', '__managed__', '__grid_constant__',
  '__forceinline__', '__noinline__', '__launch_bounds__',
]);

const DECLARATION_ATTRIBUTES = new Set(['__attribute__', '__declspec', '__launch_bounds__']);

function cleanDocComment(text: string): string {
  return text.trim()
    .replace(/^\/\*+!?/, '').replace(/\*+\/$/, '')
    .replace(/^\/\/[/!]?[ ]?/gm, '')
    .replace(/^\s*\*[ ]?/gm, '')
    .trim();
}

function precedingDoc(tokens: readonly NativeToken[], declaration: Declaration): string | undefined {
  const start = tokens[declaration.start];
  if (!start) return undefined;
  for (let index = declaration.start - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (token.kind === 'comment') return start.start.line - token.end.line <= 3 ? cleanDocComment(token.text) : undefined;
    if (token.text === '}' || token.text === ';' || start.start.line - token.end.line > 2) return undefined;
  }
  return undefined;
}

function visibility(tokens: readonly NativeToken[], start: number, end: number): Node['visibility'] {
  for (let i = start; i < end; i += 1) {
    const text = tokens[i]?.text;
    if (text === 'public' || text === 'private' || text === 'protected' || text === 'internal') return text;
  }
  return undefined;
}

function simpleReturnType(tokens: readonly NativeToken[], start: number, nameIndex: number): string | undefined {
  const callingConventions = new Set(['WINAPI', 'STDMETHODCALLTYPE', 'APIENTRY', 'CALLBACK', '__cdecl', '__stdcall', '__fastcall', '__thiscall']);
  const candidates = tokens.slice(start, nameIndex)
    .filter((token) => token.kind === 'identifier' && !TYPE_WORDS.has(token.text));
  const value = [...candidates].reverse().find((token) => !callingConventions.has(token.text))?.text;
  return value && /^[A-Za-z_]\w*$/.test(value) ? value : undefined;
}

function ownerFor(declarations: readonly Declaration[], start: number, end: number, kinds?: ReadonlySet<NodeKind>): Declaration | undefined {
  return declarations
    .filter((item) => item.bodyStart !== undefined && item.bodyEnd !== undefined && item.bodyStart < start && item.bodyEnd >= end && (!kinds || kinds.has(item.kind)))
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
}

function normalizedInclude(raw: string): string {
  return raw.replace(/^\s*[<"]|[>"]\s*$/g, '');
}

/** Afyx-native semantic facts for the product-required C-family surface. */
export function extractNativeCFamilyFacts(filePath: string, source: string, language: CFamilyLanguage): ExtractionResult {
  const started = Date.now();
  const scan = scanSource(source, {
    hashComments: false,
    cppRawStrings: language === 'cpp',
    csharpStrings: language === 'csharp',
  });
  const tokens = scan.tokens;
  const declarations: Declaration[] = [];
  const refs: UnresolvedReference[] = [];
  const sourceLines = source.split(/\r?\n/);
  const directiveLines = new Set<number>();
  const cudaFunctionMacros = new Set<string>();
  let continuation = false;
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = sourceLines[lineIndex]!;
    const directive: boolean = continuation || /^\s*#/.test(line);
    if (directive) directiveLines.add(lineIndex + 1);
    continuation = directive && /\\\s*$/.test(line);
    if (!/^\s*#\s*define\b/.test(line)) continue;
    let logical = line;
    let end = lineIndex;
    while (/\\\s*$/.test(sourceLines[end] ?? '') && end + 1 < sourceLines.length) logical += `\n${sourceLines[++end]}`;
    const macro = /^\s*#\s*define\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)/.exec(logical);
    if (macro?.[1] && macro[2] && new RegExp(`\\b__global__\\s+void\\s+${macro[2]}\\s*\\(`).test(logical)) {
      cudaFunctionMacros.add(macro[1]);
    }
  }
  const nextText = (from: number, text: string, limit = tokens.length): number => {
    for (let i = from; i < limit; i += 1) if (tokens[i]?.text === text) return i;
    return -1;
  };
  const statementStart = (index: number): number => {
    let cursor = index;
    while (cursor > 0 && ![';', '{', '}'].includes(tokens[cursor - 1]!.text)) cursor -= 1;
    return cursor;
  };
  const statementEnd = (index: number): number => {
    for (let cursor = index; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor]!.text === ';') return cursor;
      if (tokens[cursor]!.text === '}' && cursor !== index) return cursor - 1;
    }
    return index;
  };
  const containingKinds = new Set<NodeKind>(['namespace', 'class', 'struct', 'union', 'interface', 'protocol', 'enum']);
  const declarationAttributeRanges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (!DECLARATION_ATTRIBUTES.has(tokens[index]!.text) || tokens[index + 1]?.text !== '(') continue;
    const end = scan.pairs.get(index + 1);
    if (end !== undefined) declarationAttributeRanges.push({ start: index, end });
  }

  // Namespaces are explicit owners in C++ and C#.
  if (language === 'cpp' || language === 'csharp') {
    for (let i = 0; i < tokens.length - 1; i += 1) {
      if (tokens[i]!.text !== 'namespace') continue;
      let cursor = i + 1;
      const nameParts: string[] = [];
      while (cursor < tokens.length && tokens[cursor]!.text !== '{' && tokens[cursor]!.text !== ';') {
        if (tokens[cursor]!.kind === 'identifier' || tokens[cursor]!.text === '.' || tokens[cursor]!.text === '::') nameParts.push(tokens[cursor]!.text);
        cursor += 1;
      }
      const name = nameParts.join('');
      if (!name) continue;
      const bodyEnd = tokens[cursor]?.text === '{' ? scan.pairs.get(cursor) : undefined;
      declarations.push({ kind: 'namespace', name, start: i, end: bodyEnd ?? cursor, bodyStart: bodyEnd === undefined ? undefined : cursor, bodyEnd });
    }
  }

  // C/C++ aggregate definitions and C# named types.
  const typeKinds: Record<string, NodeKind> = {
    class: 'class', struct: 'struct', union: 'union', enum: 'enum', interface: 'interface',
  };
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const keyword = tokens[i]!.text;
    if (!(keyword in typeKinds) && !(language === 'csharp' && keyword === 'record')) continue;
    if (language === 'c' && keyword === 'class') continue;
    let kind = keyword === 'record' ? 'class' as NodeKind : typeKinds[keyword]!;
    let nameIndex = i + 1;
    if (keyword === 'record' && (tokens[nameIndex]?.text === 'class' || tokens[nameIndex]?.text === 'struct')) {
      kind = tokens[nameIndex]!.text === 'struct' ? 'struct' : 'class';
      nameIndex += 1;
    }
    if (language === 'cpp' && keyword === 'enum' && (tokens[nameIndex]?.text === 'class' || tokens[nameIndex]?.text === 'struct')) nameIndex += 1;
    if (language === 'cpp' && tokens[nameIndex]?.kind === 'identifier' && /^[A-Z][A-Z0-9_]*$/.test(tokens[nameIndex]!.text) && tokens[nameIndex + 1]?.kind === 'identifier') nameIndex += 1;
    const nameToken = tokens[nameIndex];
    if (!nameToken || nameToken.kind !== 'identifier') continue;
    let cursor = nameIndex + 1;
    let invalidAggregateUse = false;
    let inheritanceClause = false;
    while (cursor < tokens.length && !['{', ';'].includes(tokens[cursor]!.text)) {
      if (tokens[cursor]!.text === ':') inheritanceClause = true;
      if (language !== 'csharp' && ['=', ')', '[', '*'].includes(tokens[cursor]!.text) ||
          (language !== 'csharp' && tokens[cursor]!.text === ',' && !inheritanceClause)) {
        invalidAggregateUse = true;
        break;
      }
      cursor += 1;
    }
    if (invalidAggregateUse) continue;
    const bodyEnd = tokens[cursor]?.text === '{' ? scan.pairs.get(cursor) : undefined;
    const positionalRecord = language === 'csharp' && keyword === 'record' &&
      tokens.slice(nameIndex + 1, cursor).some((token) => token.text === '(');
    if (bodyEnd === undefined && !positionalRecord) continue; // forward declaration
    let start = i;
    while (start > 0 && tokens[start - 1]!.start.line === tokens[i]!.start.line && ![';', '{', '}'].includes(tokens[start - 1]!.text)) start -= 1;
    declarations.push({
      kind, name: nameToken.text, start, end: bodyEnd ?? cursor,
      bodyStart: bodyEnd === undefined ? undefined : cursor, bodyEnd,
      visibility: visibility(tokens, start, i),
    });
  }

  // C-family typedef aggregates/aliases. The alias owns anonymous aggregate bodies.
  if (language !== 'csharp') {
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i]!.text !== 'typedef') continue;
      let end = statementEnd(i);
      const aggregateIndex = tokens.slice(i + 1, end).findIndex((token) => ['struct', 'union', 'enum'].includes(token.text));
      const absoluteAggregate = aggregateIndex < 0 ? -1 : i + 1 + aggregateIndex;
      const body = absoluteAggregate < 0 ? -1 : nextText(absoluteAggregate + 1, '{');
      const close = body < 0 ? undefined : scan.pairs.get(body);
      if (close !== undefined) end = nextText(close + 1, ';');
      if (end < 0) continue;
      let aliasIndex = -1;
      for (let cursor = i + 2; cursor < end - 1; cursor += 1) {
        if (tokens[cursor - 1]?.text === '*' && tokens[cursor]?.kind === 'identifier' && tokens[cursor + 1]?.text === ')') {
          aliasIndex = cursor;
          break;
        }
      }
      if (aliasIndex < 0) {
        aliasIndex = end - 1;
        while (aliasIndex > i && tokens[aliasIndex]!.kind !== 'identifier') aliasIndex -= 1;
      }
      if (aliasIndex <= i) continue;
      const alias = tokens[aliasIndex]!;
      const kind = absoluteAggregate >= 0 && close !== undefined
        ? typeKinds[tokens[absoluteAggregate]!.text]!
        : 'type_alias';
      // Replace the anonymous/tag aggregate emitted above with the public typedef.
      if (close !== undefined) {
        for (let d = declarations.length - 1; d >= 0; d -= 1) {
          const candidate = declarations[d]!;
          if (candidate.start >= absoluteAggregate && candidate.bodyStart === body) declarations.splice(d, 1);
        }
      }
      declarations.push({ kind, name: alias.text, start: i, end, bodyStart: close === undefined ? undefined : body, bodyEnd: close });
    }
  }

  // Objective-C owners: @interface, @implementation, @protocol and categories.
  const objcSections: Array<{ start: number; end: number; owner: Declaration }> = [];
  if (language === 'objc') {
    for (let i = 0; i < tokens.length - 2; i += 1) {
      if (tokens[i]!.text !== '@' || !['interface', 'implementation', 'protocol'].includes(tokens[i + 1]?.text ?? '')) continue;
      const form = tokens[i + 1]!.text;
      const name = tokens[i + 2];
      if (!name || name.kind !== 'identifier') continue;
      let end = i + 3;
      while (end < tokens.length && !(tokens[end]!.text === '@' && tokens[end + 1]?.text === 'end')) end += 1;
      const existing = declarations.find((item) => item.name === name.text && (item.kind === 'class' || item.kind === 'protocol'));
      const owner = existing ?? {
        kind: form === 'protocol' ? 'protocol' as NodeKind : 'class' as NodeKind,
        name: name.text, start: i, end: Math.min(tokens.length - 1, end + 1), bodyStart: i + 3, bodyEnd: end,
      };
      if (!existing) declarations.push(owner);
      objcSections.push({ start: i, end, owner });
    }
  }

  // Assign type/namespace nesting before member discovery.
  for (const declaration of declarations) {
    declaration.parent = ownerFor(declarations.filter((item) => item !== declaration), declaration.start, declaration.end, containingKinds);
  }
  if (language === 'csharp') {
    const fileNamespace = declarations.find((item) => item.kind === 'namespace' && item.bodyStart === undefined);
    if (fileNamespace) {
      for (const declaration of declarations) {
        if (declaration !== fileNamespace && !declaration.parent && declaration.start > fileNamespace.start) declaration.parent = fileNamespace;
      }
    }
  }

  // Objective-C methods/properties use selector syntax rather than C declarators.
  if (language === 'objc') {
    for (const section of objcSections) {
      for (let i = section.start + 3; i < section.end; i += 1) {
        if (tokens[i]!.text === '@' && tokens[i + 1]?.text === 'property') {
          const end = statementEnd(i);
          let nameIndex = end - 1;
          while (nameIndex > i && tokens[nameIndex]!.kind !== 'identifier') nameIndex -= 1;
          if (nameIndex > i) declarations.push({ kind: 'property', name: tokens[nameIndex]!.text, start: i, end, parent: section.owner });
          i = end;
          continue;
        }
        if (!['-', '+'].includes(tokens[i]!.text) || tokens[i + 1]?.text !== '(') continue;
        const typeEnd = scan.pairs.get(i + 1);
        if (typeEnd === undefined) continue;
        const selectorParts: string[] = [];
        let cursor = typeEnd + 1;
        let firstName: NativeToken | undefined;
        while (cursor < section.end && ![';', '{'].includes(tokens[cursor]!.text)) {
          if (tokens[cursor]!.kind === 'identifier' && !firstName) firstName = tokens[cursor];
          if (tokens[cursor]!.kind === 'identifier' && tokens[cursor + 1]?.text === ':') selectorParts.push(`${tokens[cursor]!.text}:`);
          cursor += 1;
        }
        if (!firstName) continue;
        const bodyEnd = tokens[cursor]?.text === '{' ? scan.pairs.get(cursor) : undefined;
        const returnType = tokens.slice(i + 2, typeEnd).find((token) => token.kind === 'identifier' && !TYPE_WORDS.has(token.text))?.text;
        if (bodyEnd === undefined) { i = cursor; continue; }
        const prior = declarations.find((item) => item.parent === section.owner && item.kind === 'method' && item.name === (selectorParts.length > 0 ? selectorParts.join('') : firstName.text));
        if (prior) {
          const at = declarations.indexOf(prior);
          declarations.splice(at, 1);
        }
        declarations.push({
          kind: 'method', name: selectorParts.length > 0 ? selectorParts.join('') : firstName.text,
          start: i, end: bodyEnd ?? cursor, bodyStart: bodyEnd === undefined ? undefined : cursor, bodyEnd,
          parent: section.owner, static: tokens[i]!.text === '+', returnType,
        });
        i = bodyEnd ?? cursor;
      }
    }
  }

  // Brace/expression-bodied functions and methods shared by C/C++/C# (and C functions in ObjC).
  const cppReceiverAt = (nameIndex: number): { name: string; start: number } | undefined => {
    if (tokens[nameIndex - 1]?.text !== '::') return undefined;
    let cursor = nameIndex - 2;
    if (tokens[cursor]?.text === '>') {
      let depth = 1;
      cursor -= 1;
      while (cursor >= 0 && depth > 0) {
        if (tokens[cursor]!.text === '>') depth += 1;
        else if (tokens[cursor]!.text === '<') depth -= 1;
        cursor -= 1;
      }
    }
    const receiver = tokens[cursor];
    if (receiver?.kind !== 'identifier') return undefined;
    const parts = [receiver.text];
    let start = cursor;
    while (start >= 2 && tokens[start - 1]?.text === '::' && tokens[start - 2]?.kind === 'identifier') {
      start -= 2;
      parts.unshift(tokens[start]!.text);
    }
    return { name: parts.join('::'), start };
  };
  const declarationQualifiedName = (declaration: Declaration): string =>
    declaration.parent
      ? `${declarationQualifiedName(declaration.parent)}::${declaration.name}`
      : declaration.name;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const name = tokens[i]!;
    if (name.kind !== 'identifier' || tokens[i + 1]?.text !== '(' || CONTROL.has(name.text)) continue;
    if (directiveLines.has(name.start.line) || DECLARATION_ATTRIBUTES.has(name.text) ||
        declarationAttributeRanges.some((range) => range.start < i && i < range.end)) continue;
    if (['class', 'struct', 'interface', 'record', 'enum', 'namespace', 'new', 'return'].includes(tokens[i - 1]?.text ?? '')) continue;
    const paramsEnd = scan.pairs.get(i + 1);
    if (paramsEnd === undefined) continue;
    let terminator = paramsEnd + 1;
    while (terminator < tokens.length && !['{', ';', '=>'].includes(tokens[terminator]!.text)) terminator += 1;
    const expressionBody = language === 'csharp' && tokens[terminator]?.text === '=>';
    const bodyStart = tokens[terminator]?.text === '{' ? terminator : expressionBody ? terminator : -1;
    const bodyEnd = tokens[terminator]?.text === '{' ? scan.pairs.get(terminator) : expressionBody ? statementEnd(terminator) : undefined;
    if (bodyStart < 0 || bodyEnd === undefined) continue;
    const macroName = cudaFunctionMacros.has(name.text) && tokens[i + 2]?.kind === 'identifier'
      ? tokens[i + 2]!.text
      : undefined;
    // Multi-character all-caps invocations before a declaration are normally
    // annotation/export macros. A macro whose own argument list is followed
    // immediately by a body is a callable wrapper (for example TEST_F); a
    // proven CUDA definition macro is named by its first invocation argument.
    if (language === 'cpp' && name.text.length > 1 && /^[A-Z][A-Z0-9_]*$/.test(name.text) &&
        !macroName && terminator !== paramsEnd + 1) continue;
    let start = statementStart(i);
    while (start < i && tokens[start]?.kind === 'comment') start += 1;
    // Calls followed by a block inside an existing callable are not declarations.
    const enclosingCallable = ownerFor(declarations, i, bodyEnd, new Set<NodeKind>(['function', 'method']));
    if (enclosingCallable) continue;
    let owner = ownerFor(declarations, i, bodyEnd, containingKinds);
    let methodName = macroName ?? name.text;
    const cppReceiver = language === 'cpp' ? cppReceiverAt(i) : undefined;
    let qualifiedOwner: string | undefined;
    if (cppReceiver) {
      const receiverOwner = declarations.find((item) =>
        ['class', 'struct', 'union'].includes(item.kind) &&
        (item.name === cppReceiver.name || declarationQualifiedName(item) === cppReceiver.name)
      );
      if (receiverOwner) {
        owner = receiverOwner;
      } else {
        const lexicalPrefix = owner?.kind === 'namespace' ? declarationQualifiedName(owner) : undefined;
        qualifiedOwner = lexicalPrefix && !cppReceiver.name.startsWith(`${lexicalPrefix}::`)
          ? `${lexicalPrefix}::${cppReceiver.name}`
          : cppReceiver.name;
      }
    }
    if (language === 'cpp' && tokens[i - 1]?.text === '~') methodName = `~${name.text}`;
    const kind: NodeKind = owner && ['class', 'struct', 'union', 'interface'].includes(owner.kind) || cppReceiver ? 'method' : 'function';
    declarations.push({
      kind, name: methodName, start, end: bodyEnd, bodyStart, bodyEnd, parent: owner,
      visibility: visibility(tokens, start, i), qualifiedOwner,
      static: tokens.slice(start, i).some((token) => token.text === 'static'),
      async: tokens.slice(start, i).some((token) => token.text === 'async'),
      returnType: simpleReturnType(tokens, start, cppReceiver?.start ?? i),
      signature: source.slice(tokens[start]!.start.offset, tokens[bodyStart]!.start.offset).trim(),
    });
    i = bodyEnd;
  }

  // C++ operator definitions and pure-virtual declarations are semantically callable members.
  if (language === 'cpp') {
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i]!.text === 'operator') {
        let params = i + 1;
        let forcedOperatorName: string | undefined;
        if (tokens[params]?.text === '(' && scan.pairs.get(params) === params + 1 && tokens[params + 2]?.text === '(') {
          forcedOperatorName = 'operator()';
          params += 2;
        }
        while (params < tokens.length && tokens[params]!.text !== '(') params += 1;
        if (tokens[params]?.text !== '(') continue;
        const paramsEnd = scan.pairs.get(params);
        if (paramsEnd === undefined) continue;
        const raw = tokens.slice(i + 1, params).map((token) => token.text).join('');
        const operatorName = forcedOperatorName ?? (/^[A-Za-z_]/.test(raw) ? `operator ${raw}` : `operator${raw}`);
        let terminator = paramsEnd + 1;
        while (terminator < tokens.length && !['{', ';'].includes(tokens[terminator]!.text)) terminator += 1;
        const bodyEnd = tokens[terminator]?.text === '{' ? scan.pairs.get(terminator) : undefined;
        const pure = tokens[terminator]?.text === ';' && tokens.slice(paramsEnd + 1, terminator).some((token, offset) => token.text === '=' && tokens[paramsEnd + 2 + offset]?.text === '0');
        if (bodyEnd === undefined && !pure) continue;
        const owner = ownerFor(declarations, i, bodyEnd ?? terminator, new Set<NodeKind>(['class', 'struct', 'union']));
        const receiver = cppReceiverAt(i);
        if (!owner && !receiver) continue;
        const start = statementStart(i);
        declarations.push({ kind: 'method', name: operatorName, start, end: bodyEnd ?? terminator,
          bodyStart: bodyEnd === undefined ? undefined : terminator, bodyEnd, parent: owner,
          qualifiedOwner: !owner ? receiver?.name : undefined, abstract: pure,
          returnType: simpleReturnType(tokens, start, i), signature: source.slice(tokens[start]!.start.offset, tokens[params]!.start.offset).trim() });
      } else if (tokens[i]!.kind === 'identifier' && tokens[i + 1]?.text === '(') {
        const paramsEnd = scan.pairs.get(i + 1);
        if (paramsEnd === undefined) continue;
        const semi = nextText(paramsEnd + 1, ';', paramsEnd + 8);
        if (semi < 0) continue;
        const tail = tokens.slice(paramsEnd + 1, semi).map((token) => token.text);
        if (!tail.some((text, offset) => text === '=' && tail[offset + 1] === '0')) continue;
        const owner = ownerFor(declarations, i, semi, new Set<NodeKind>(['class', 'struct', 'union']));
        if (!owner) continue;
        const start = statementStart(i);
        declarations.push({ kind: 'method', name: tokens[i]!.text, start, end: semi, parent: owner, abstract: true,
          returnType: simpleReturnType(tokens, start, i) });
      }
    }
  }

  // C# properties and constants/fields needed by value/type dependency semantics.
  if (language === 'csharp') {
    const owners = declarations.filter((item) => ['class', 'struct', 'interface'].includes(item.kind) && item.bodyStart !== undefined);
    for (const owner of owners) {
      for (let i = owner.bodyStart! + 1; i < (owner.bodyEnd ?? owner.end); i += 1) {
        const name = tokens[i]!;
        if (name.kind !== 'identifier') continue;
        if (tokens[i + 1]?.text === '{') {
          const close = scan.pairs.get(i + 1);
          if (close !== undefined && close <= (owner.bodyEnd ?? owner.end) && tokens.slice(i + 2, close).some((token) => ['get', 'set', 'init'].includes(token.text))) {
            declarations.push({ kind: 'property', name: name.text, start: statementStart(i), end: close, bodyStart: i + 1, bodyEnd: close, parent: owner, visibility: visibility(tokens, statementStart(i), i) });
            i = close;
          }
        } else if (tokens[i + 1]?.text === '=>' && !declarations.some((item) => item.start <= i && item.end >= i && (item.kind === 'method' || item.kind === 'property'))) {
          const end = statementEnd(i + 1);
          declarations.push({ kind: 'property', name: name.text, start: statementStart(i), end, bodyStart: i + 1, bodyEnd: end, parent: owner, visibility: visibility(tokens, statementStart(i), i) });
          i = end;
        }
      }
      for (let end = owner.bodyStart! + 1; end < (owner.bodyEnd ?? owner.end); end += 1) {
        if (tokens[end]!.text !== ';') continue;
        const start = statementStart(end);
        if (start >= end || declarations.some((item) => item !== owner && item.start <= start && item.end >= end && ['method', 'property'].includes(item.kind))) continue;
        if (tokens.slice(start, end).some((token) => token.text === '(' || token.text === 'using')) continue;
        const equals = tokens.slice(start, end).findIndex((token) => token.text === '=');
        let nameIndex = (equals < 0 ? end : start + equals) - 1;
        while (nameIndex >= start && tokens[nameIndex]!.kind !== 'identifier') nameIndex -= 1;
        if (nameIndex <= start) continue;
        const modifiers = tokens.slice(start, nameIndex).map((token) => token.text);
        const constant = modifiers.includes('const') || (modifiers.includes('static') && modifiers.includes('readonly'));
        declarations.push({ kind: constant ? 'constant' : 'field', name: tokens[nameIndex]!.text, start, end,
          bodyStart: equals < 0 ? undefined : start + equals, bodyEnd: equals < 0 ? undefined : end,
          parent: owner, static: modifiers.includes('static'), visibility: visibility(tokens, start, nameIndex) });
      }
    }
  }

  // Enum members.
  for (const owner of declarations.filter((item) => item.kind === 'enum' && item.bodyStart !== undefined && item.bodyEnd !== undefined)) {
    let expectMember = true;
    for (let i = owner.bodyStart! + 1; i < owner.bodyEnd!; i += 1) {
      if (tokens[i]!.text === ',') { expectMember = true; continue; }
      if (!expectMember || tokens[i]!.kind !== 'identifier') continue;
      if (tokens.slice(owner.bodyStart! + 1, i).some((token) => token.start.line === tokens[i]!.start.line && token.text === '#')) continue;
      declarations.push({ kind: 'enum_member', name: tokens[i]!.text, start: i, end: i, parent: owner });
      expectMember = false;
    }
  }

  declarations.sort((left, right) => left.start - right.start || right.end - left.end);
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const fileNode: Node = {
    id: `file:${filePath}`, kind: 'file', name: path.basename(filePath), qualifiedName: filePath,
    filePath, language, startLine: 1, endLine: source.split('\n').length, startColumn: 0, endColumn: 0,
    isExported: false, updatedAt: Date.now(),
  };
  nodes.push(fileNode);
  const nodeByDeclaration = new Map<Declaration, Node>();
  for (const declaration of declarations) {
    const start = tokens[declaration.start];
    if (!start) continue;
    const end = tokens[declaration.end] ?? start;
    const parentNode = declaration.parent ? nodeByDeclaration.get(declaration.parent) : undefined;
    const qualifiedName = declaration.qualifiedOwner ? `${declaration.qualifiedOwner}::${declaration.name}`
      : parentNode ? `${parentNode.qualifiedName}::${declaration.name}` : declaration.name;
    const node: Node = {
      id: generateNodeId(filePath, declaration.kind, declaration.name, start.start.line),
      kind: declaration.kind, name: declaration.name, qualifiedName, filePath, language,
      startLine: start.start.line, endLine: end.end.line, startColumn: start.start.column, endColumn: end.end.column,
      visibility: declaration.visibility ?? (language === 'csharp' && declaration.kind !== 'namespace' ? 'private' : undefined),
      isExported: language === 'csharp' ? declaration.visibility === 'public' : undefined,
      isStatic: declaration.static || undefined, isAsync: declaration.async || undefined,
      isAbstract: declaration.abstract || undefined,
      returnType: declaration.returnType, signature: declaration.signature,
      docstring: declaration.docstring ?? precedingDoc(tokens, declaration), updatedAt: Date.now(),
    };
    nodes.push(node);
    nodeByDeclaration.set(declaration, node);
    edges.push({ source: parentNode?.id ?? fileNode.id, target: node.id, kind: 'contains' });
  }
  const ownerAt = (index: number): Node => {
    const owner = declarations.filter((item) => item.start <= index && item.end >= index)
      .sort((left, right) => {
        const lc = left.kind === 'method' || left.kind === 'function' ? 0 : 1;
        const rc = right.kind === 'method' || right.kind === 'function' ? 0 : 1;
        return lc - rc || (left.end - left.start) - (right.end - right.start);
      })[0];
    return owner ? nodeByDeclaration.get(owner) ?? fileNode : fileNode;
  };
  const pushRef = (index: number, name: string, kind: UnresolvedReference['referenceKind'], columnIndex = index): void => {
    const token = tokens[index];
    const columnToken = tokens[columnIndex] ?? token;
    if (!token || !columnToken || !name) return;
    const from = ownerAt(index);
    if (refs.some((ref) => ref.fromNodeId === from.id && ref.referenceKind === kind && ref.referenceName === name &&
      (kind === 'function_ref' || (ref.line === token.start.line && ref.column === columnToken.start.column)))) return;
    refs.push({ fromNodeId: from.id, referenceName: name, referenceKind: kind, line: token.start.line, column: columnToken.start.column });
  };

  // CUDA kernel launches are not ordinary C++ calls: the launch configuration
  // sits between the callee and argument list. Capture the bounded product
  // contract directly, including templated kernels and local function-pointer
  // aliases whose assignments may select more than one concrete kernel.
  if (language === 'cpp' && source.includes('<<<')) {
    const aliases = new Map<string, Set<string>>();
    for (let index = 0; index < tokens.length - 3; index += 1) {
      const alias = tokens[index];
      if (alias?.kind !== 'identifier' || tokens[index + 1]?.text !== '=') continue;
      let cursor = index + 2;
      if (tokens[cursor]?.text !== '&') continue;
      cursor += 1;
      const target = tokens[cursor];
      if (target?.kind !== 'identifier') continue;
      const targets = aliases.get(alias.text) ?? new Set<string>();
      targets.add(target.text);
      aliases.set(alias.text, targets);
    }
    const tokenByOffset = new Map(tokens.map((token, index) => [token.start.offset, index]));
    const launch = /\b([A-Za-z_]\w*)\s*(?:<[^;{}()\n]{0,200}>)?\s*<<<[^;]{0,400}?>>>\s*\(/g;
    for (const match of source.matchAll(launch)) {
      if (match.index === undefined || !match[1]) continue;
      const index = tokenByOffset.get(match.index);
      if (index === undefined) continue;
      const targets = aliases.get(match[1]) ?? new Set([match[1]]);
      for (const target of targets) pushRef(index, target, 'calls');
    }
  }

  // Includes/imports/usings.
  const importPattern = language === 'csharp'
    ? /^\s*using\s+(?:static\s+)?(?:[A-Za-z_]\w*\s*=\s*)?([^;\r\n]+)\s*;/gm
    : /^\s*#\s*(?:include|import)\s*([<"][^>"\r\n]+[>"])/gm;
  for (const match of source.matchAll(importPattern)) {
    const raw = match[1];
    if (!raw || match.index === undefined) continue;
    const name = language === 'csharp' ? raw.trim() : normalizedInclude(raw);
    const before = source.slice(0, match.index);
    const line = before.split('\n').length;
    const column = match[0].indexOf(language === 'csharp' ? 'using' : '#');
    const importNode: Node = {
      id: generateNodeId(filePath, 'import', name, line), kind: 'import', name, qualifiedName: name,
      filePath, language, startLine: line, endLine: line, startColumn: Math.max(0, column), endColumn: match[0].length,
      signature: match[0].trim(), updatedAt: Date.now(),
    };
    nodes.push(importNode);
    edges.push({ source: fileNode.id, target: importNode.id, kind: 'contains' });
    refs.push({ fromNodeId: fileNode.id, referenceName: name, referenceKind: 'imports', line, column: Math.max(0, column) });
  }

  // Inheritance/protocol relationships.
  for (const declaration of declarations.filter((item) => ['class', 'struct', 'interface', 'protocol'].includes(item.kind))) {
    const node = nodeByDeclaration.get(declaration);
    let limit = declaration.bodyStart ?? declaration.end;
    if (language === 'objc') {
      const headerLine = tokens[declaration.start]?.start.line;
      let cursor = declaration.start + 1;
      while (cursor < declaration.end && tokens[cursor]!.start.line === headerLine) cursor += 1;
      limit = cursor;
    }
    if (!node) continue;
    let colon = nextText(declaration.start + 1, ':', limit);
    if (language === 'objc' && tokens[declaration.start]?.text === '@') colon = nextText(declaration.start + 2, ':', limit);
    if (colon >= 0 && language === 'cpp') {
      let segmentStart = colon + 1;
      for (let cursor = segmentStart; cursor <= limit; cursor += 1) {
        if (cursor < limit && tokens[cursor]!.text !== ',') continue;
        const segment = tokens.slice(segmentStart, cursor);
        let genericDepth = 0;
        const parts: string[] = [];
        let location: NativeToken | undefined;
        for (const token of segment) {
          if (token.text === '<') { genericDepth += 1; continue; }
          if (token.text === '>') { genericDepth = Math.max(0, genericDepth - 1); continue; }
          if (genericDepth > 0 || ['public', 'private', 'protected', 'virtual'].includes(token.text)) continue;
          if (token.kind === 'identifier' || token.text === '::') {
            parts.push(token.text);
            if (!location && token.kind === 'identifier') location = token;
          }
        }
        const name = parts.join('').replace(/::+$/, '');
        if (name && location) refs.push({ fromNodeId: node.id, referenceName: name, referenceKind: 'extends', line: location.start.line, column: location.start.column });
        segmentStart = cursor + 1;
      }
    } else if (colon >= 0) {
      let first = true;
      for (let i = colon + 1; i < limit; i += 1) {
        const token = tokens[i]!;
        if (token.kind !== 'identifier' || TYPE_WORDS.has(token.text) || token.text === declaration.name) continue;
        refs.push({ fromNodeId: node.id, referenceName: token.text, referenceKind: language === 'objc' && !first ? 'implements' : 'extends', line: token.start.line, column: token.start.column });
        first = false;
      }
    }
    if (language === 'objc') {
      const open = nextText(declaration.start + 1, '<', limit);
      const close = open < 0 ? -1 : nextText(open + 1, '>', limit);
      if (open >= 0 && close > open) {
        for (let i = open + 1; i < close; i += 1) if (tokens[i]!.kind === 'identifier') {
          refs.push({ fromNodeId: node.id, referenceName: tokens[i]!.text, referenceKind: 'implements', line: tokens[i]!.start.line, column: tokens[i]!.start.column });
        }
      }
    }
  }

  // Calls and qualified calls inside callable/value bodies.
  const declarationNameOffsets = new Set(declarations.map((item) => tokens[item.start]?.start.offset).filter((value): value is number => value !== undefined));
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const callee = tokens[i]!;
    if (callee.kind !== 'identifier' || tokens[i + 1]?.text !== '(' || CONTROL.has(callee.text)) continue;
    const callEnd = scan.pairs.get(i + 1);
    const aggregateOwner = ownerFor(declarations, i, callEnd ?? i + 1, new Set<NodeKind>(['class', 'struct', 'union', 'interface', 'protocol']));
    const callableOwner = ownerFor(declarations, i, callEnd ?? i + 1, new Set<NodeKind>(['function', 'method']));
    if (aggregateOwner && !callableOwner && callEnd !== undefined) {
      let after = callEnd + 1;
      while (after < tokens.length && ![';', '{', '=>'].includes(tokens[after]!.text)) after += 1;
      if (tokens[after]?.text === ';') continue;
    }
    if (declarations.some((item) => item.name.replace(/^~/, '') === callee.text && item.start <= i && i <= (item.bodyStart ?? item.end))) continue;
    if (declarationNameOffsets.has(callee.start.offset)) continue;
    let name = callee.text;
    let columnIndex = i;
    if ((tokens[i - 1]?.text === '.' || tokens[i - 1]?.text === '->') && tokens[i - 2]?.text === ')') {
      const innerOpen = scan.pairs.get(i - 2);
      const innerName = innerOpen === undefined ? undefined : tokens[innerOpen - 1];
      if (!innerName || innerName.kind !== 'identifier') continue;
      let inner = innerName.text;
      let innerStart = innerOpen! - 1;
      if (tokens[innerStart - 1]?.text === '.' || tokens[innerStart - 1]?.text === '->' || tokens[innerStart - 1]?.text === '::') {
        const innerReceiver = tokens[innerStart - 2];
        if (innerReceiver?.kind === 'identifier') {
          inner = `${innerReceiver.text}${tokens[innerStart - 1]!.text === '::' ? '::' : '.'}${inner}`;
          innerStart -= 2;
        }
      }
      name = `${inner}().${callee.text}`;
      columnIndex = innerStart;
    } else if (tokens[i - 1]?.text === '.' || tokens[i - 1]?.text === '->' || tokens[i - 1]?.text === '::') {
      let start = i;
      while (start >= 2 && ['.', '->', '::'].includes(tokens[start - 1]!.text) && tokens[start - 2]?.kind === 'identifier') start -= 2;
      if (start < i) {
        name = tokens.slice(start, i + 1).map((token) => token.text === '->' ? '.' : token.text).join('');
        if (tokens[start]!.text === 'this' || tokens[start]!.text === 'self' || tokens[start]!.text === 'super') name = callee.text;
        columnIndex = start;
      }
    }
    pushRef(i, name, 'calls', columnIndex);
  }

  if (language === 'cpp') {
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i]!.text !== 'operator') continue;
      let params = i + 1;
      let forcedOperatorName: string | undefined;
      if (tokens[params]?.text === '(' && scan.pairs.get(params) === params + 1 && tokens[params + 2]?.text === '(') {
        forcedOperatorName = 'operator()';
        params += 2;
      }
      while (params < tokens.length && tokens[params]!.text !== '(') params += 1;
      if (tokens[params]?.text !== '(' || params === i + 1) continue;
      const raw = tokens.slice(i + 1, params).map((token) => token.text).join('');
      const operatorName = forcedOperatorName ?? (/^[A-Za-z_]/.test(raw) ? `operator ${raw}` : `operator${raw}`);
      if (!['.', '->'].includes(tokens[i - 1]?.text ?? '')) continue;
      const receiver = tokens[i - 2];
      if (receiver?.kind !== 'identifier') continue;
      pushRef(i, receiver.text === 'this' ? operatorName : `${receiver.text}.${operatorName}`, 'calls', i - 2);
    }

    // Direct/brace initialization has no call node, but it is an instantiation dependency.
    const seenInstantiation = new Set<string>();
    for (let i = 0; i < tokens.length - 2; i += 1) {
      if (tokens[i]!.text !== 'new') continue;
      let cursor = i + 1;
      let type: NativeToken | undefined;
      while (cursor < tokens.length && !['(', '{', ';'].includes(tokens[cursor]!.text)) {
        if (tokens[cursor]!.kind === 'identifier') type = tokens[cursor];
        cursor += 1;
      }
      if (!type || TYPE_WORDS.has(type.text)) continue;
      const from = ownerAt(i);
      const key = `${from.id}\0${type.text}`;
      if (seenInstantiation.has(key)) continue;
      seenInstantiation.add(key);
      refs.push({ fromNodeId: from.id, referenceName: type.text, referenceKind: 'instantiates', line: type.start.line, column: type.start.column });
    }
    for (let variable = 1; variable < tokens.length - 1; variable += 1) {
      if (tokens[variable]!.kind !== 'identifier' || !['(', '{'].includes(tokens[variable + 1]!.text)) continue;
      if (tokens[variable + 1]!.text === '(' && scan.pairs.get(variable + 1) === variable + 2) continue;
      if (!ownerFor(declarations, variable, variable + 1, new Set<NodeKind>(['function', 'method']))) continue;
      const start = statementStart(variable);
      if (start >= variable) continue;
      const prefix = tokens.slice(start, variable);
      if (prefix.some((token) => ['auto', '=', 'return', 'new'].includes(token.text))) continue;
      const typeCandidates = prefix.filter((token) => token.kind === 'identifier' && !TYPE_WORDS.has(token.text));
      const type = typeCandidates.at(-1);
      if (!type || /^[a-z]/.test(type.text) && !prefix.some((token) => token.text === '::')) continue;
      const from = ownerAt(variable);
      const key = `${from.id}\0${type.text}`;
      if (seenInstantiation.has(key)) continue;
      seenInstantiation.add(key);
      refs.push({ fromNodeId: from.id, referenceName: type.text, referenceKind: 'instantiates', line: type.start.line, column: type.start.column });
    }
  }

  // Objective-C message sends: receiver plus complete keyword selector.
  if (language === 'objc') {
    for (const [open, close] of scan.pairs) {
      if (open >= close || tokens[open]?.text !== '[') continue;
      if (tokens[open + 1]?.text === '[') {
        const innerClose = scan.pairs.get(open + 1);
        if (innerClose === undefined || innerClose >= close) continue;
        const innerReceiver = tokens[open + 2];
        const innerMethod = tokens.slice(open + 3, innerClose).find((token) => token.kind === 'identifier');
        const outerMethod = tokens.slice(innerClose + 1, close).find((token) => token.kind === 'identifier');
        if (innerReceiver?.kind === 'identifier' && /^[A-Z]/.test(innerReceiver.text) && innerMethod && outerMethod) {
          const innerIndex = tokens.indexOf(innerMethod);
          const innerSelector = tokens[innerIndex + 1]?.text === ':' ? `${innerMethod.text}:` : innerMethod.text;
          pushRef(tokens.indexOf(outerMethod), `${innerReceiver.text}.${innerSelector}().${outerMethod.text}`, 'calls', open + 2);
          continue;
        }
      }
      const receiver = tokens.slice(open + 1, close).find((token) => token.kind === 'identifier');
      if (!receiver) continue;
      const receiverIndex = tokens.indexOf(receiver);
      const parts: string[] = [];
      let bare: NativeToken | undefined;
      for (let i = receiverIndex + 1; i < close; i += 1) {
        if (tokens[i]!.kind !== 'identifier') continue;
        if (!bare) bare = tokens[i]!;
        if (tokens[i + 1]?.text === ':') parts.push(`${tokens[i]!.text}:`);
      }
      const selector = parts.length > 0 ? parts.join('') : bare?.text;
      if (!selector || !bare) continue;
      const name = receiver.text === 'self' || receiver.text === 'super' ? selector : `${receiver.text}.${selector}`;
      pushRef(tokens.indexOf(bare), name, 'calls', receiverIndex);
      if (/^[A-Z]/.test(receiver.text)) pushRef(receiverIndex, receiver.text, 'references');
    }
  }

  // Function/method values.
  const definedNames = new Set(declarations.filter((item) => item.kind === 'function' || item.kind === 'method').map((item) => item.name.replace(/^~/, '')));
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind !== 'identifier' || tokens[i + 1]?.text === '(') continue;
    if (language === 'cpp' && tokens[i - 1]?.text === '::' && tokens[i - 2]?.kind === 'identifier' && tokens[i - 3]?.text === '&') {
      pushRef(i, `${tokens[i - 2]!.text}::${token.text}`, 'function_ref', i - 2);
    } else if (language === 'cpp' && tokens[i - 1]?.text === '&' && definedNames.has(token.text)) {
      pushRef(i, token.text, 'function_ref');
    } else if (language === 'c' && !TYPE_WORDS.has(token.text) && tokens[i - 1]?.text !== '.' && tokens[i - 1]?.text !== '->') {
      const context = tokens[i - 1]?.text;
      if (definedNames.has(token.text) || ['=', '{', ',', '(', '&'].includes(context ?? '')) pushRef(i, token.text, 'function_ref');
    } else if (language === 'csharp') {
      if (tokens[i - 2]?.text === 'this' && tokens[i - 1]?.text === '.') pushRef(i, token.text, 'function_ref');
      else if (definedNames.has(token.text) && ['=', '+=', '(', ',', '{'].includes(tokens[i - 1]?.text ?? '')) pushRef(i, token.text, 'function_ref');
    } else if (language === 'objc' && tokens[i - 2]?.text === '@' && tokens[i - 1]?.text === 'selector') {
      pushRef(i, token.text, 'function_ref');
    }
  }

  // Product-level type references from declaration headers, excluding builtins/modifiers.
  const seenTypeRefs = new Set<string>();
  for (const declaration of declarations) {
    const node = nodeByDeclaration.get(declaration);
    if (!node) continue;
    const end = declaration.bodyStart ?? Math.min(declaration.end + 1, tokens.length);
    for (let i = declaration.start; i < end; i += 1) {
      const token = tokens[i]!;
      if (token.kind !== 'identifier' || TYPE_WORDS.has(token.text) || token.text === declaration.name || CONTROL.has(token.text)) continue;
      if (tokens[i - 1]?.text === '#' || tokens[i - 1]?.text === '@') continue;
      const typeShaped = /^[A-Z]/.test(token.text) || tokens[i + 1]?.text === '*' || tokens[i + 1]?.text === '&' || tokens[i + 1]?.text === '?' || tokens[i + 1]?.text === '<';
      if (!typeShaped) continue;
      const key = `${node.id}\0${token.text}\0${token.start.offset}`;
      if (seenTypeRefs.has(key)) continue;
      seenTypeRefs.add(key);
      refs.push({ fromNodeId: node.id, referenceName: token.text, referenceKind: 'references', line: token.start.line, column: token.start.column });
    }
  }

  nodes.splice(1, nodes.length - 1, ...nodes.slice(1).sort((left, right) => left.startLine - right.startLine || left.startColumn - right.startColumn || left.kind.localeCompare(right.kind)));
  refs.sort((left, right) => left.line - right.line || left.column - right.column);
  return {
    nodes, edges, unresolvedReferences: refs,
    errors: scan.unterminated.map((kind) => ({ message: `Incomplete ${kind} while scanning ${filePath}`, filePath, severity: 'warning' as const, code: 'native_incomplete_source' })),
    durationMs: Date.now() - started,
  };
}

export function isNativeCFamilyLanguage(language: Language): language is CFamilyLanguage {
  return language === 'c' || language === 'cpp' || language === 'objc' || language === 'csharp';
}
