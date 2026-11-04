import * as path from 'path';
import type { Edge, ExtractionError, ExtractionResult, Language, Node, NodeKind, UnresolvedReference } from '../../types';
import { generateNodeId } from '../node-id';
import { scanSource, type NativeToken } from './scanner';

/** Distinguish modern bare-script CFML from tag-based source. */
export function isBareScriptCfml(source: string): boolean {
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\uFEFF') {
      index++;
    } else if (ch === '/' && source[index + 1] === '/') {
      const newline = source.indexOf('\n', index);
      index = newline === -1 ? source.length : newline + 1;
    } else if (ch === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
    } else {
      return ch !== '<';
    }
  }
  return true;
}

interface TagRegion {
  name: string;
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  text: string;
}

interface ScriptOwner {
  id: string;
  name?: string;
  kind: NodeKind;
  start: number;
  end: number;
}

export interface CfmlSyntaxSpan {
  start: number;
  end: number;
  cls: 'other' | 'ident' | 'comment' | 'string' | 'keyword' | 'number' | 'type' | 'def';
}

const SCRIPT_KEYWORDS = new Set(
  'abstract break case catch component continue default do else false final finally for function if import include interface local new null package param private property public remote required return static switch this throw true try var while'.split(' '),
);
const QUERY_KEYWORDS = new Set(
  'and as asc by case delete desc distinct else end exists from full group having in inner insert into is join left like limit not null offset on or order outer right select set then union update values when where'.split(' '),
);
const CALL_EXCLUSIONS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'new', 'return', 'throw',
]);

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === '\n') starts.push(index + 1);
  return starts;
}

function position(starts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: offset - starts[low]! };
}

function attributes(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const body = text.replace(/^<\/?\s*[A-Za-z][\w:-]*/u, '').replace(/\/?>\s*$/u, '');
  const pattern = /([A-Za-z_][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) result.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  return result;
}

/** CFML tag regions with bounded incomplete-input recovery and absolute offsets. */
export function scanCfmlRegions(source: string): TagRegion[] {
  const tags: Array<{ name: string; start: number; end: number; text: string; closing: boolean; selfClosing: boolean }> = [];
  const pattern = /<!---[\s\S]*?(?:--->|$)|<\s*(\/?)\s*(cf[A-Za-z][\w:-]*)\b[^>]*(?:>|$)/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[0].startsWith('<!---')) continue;
    tags.push({
      name: match[2]!.toLowerCase(), start: match.index, end: match.index + match[0].length,
      text: match[0], closing: match[1] === '/', selfClosing: /\/\s*>$/u.test(match[0]),
    });
  }
  const paired = new Map<number, typeof tags[number]>();
  const stacks = new Map<string, number[]>();
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]!;
    if (tag.closing) {
      const stack = stacks.get(tag.name);
      const open = stack?.pop();
      if (open !== undefined) paired.set(open, tag);
    } else if (!tag.selfClosing && ['cfcomponent', 'cffunction', 'cfscript', 'cfquery'].includes(tag.name)) {
      const stack = stacks.get(tag.name) ?? [];
      stack.push(index);
      stacks.set(tag.name, stack);
    }
  }
  return tags.filter((tag) => !tag.closing).map((tag) => {
    const originalIndex = tags.indexOf(tag);
    const close = paired.get(originalIndex);
    return {
      name: tag.name, start: tag.start, openEnd: tag.end,
      closeStart: close?.start ?? source.length, end: close?.end ?? (tag.selfClosing ? tag.end : source.length), text: tag.text,
    };
  });
}

class CfmlFactBuilder {
  readonly nodes: Node[] = [];
  readonly edges: Edge[] = [];
  readonly refs: UnresolvedReference[] = [];
  readonly errors: ExtractionError[] = [];
  private readonly starts: number[];
  private readonly language: Language;
  private readonly fileId: string;

  constructor(private readonly filePath: string, private readonly source: string, language: Language, tagBased: boolean) {
    this.starts = lineStarts(source);
    this.language = language;
    this.fileId = tagBased ? generateNodeId(filePath, 'file', filePath, 1) : `file:${filePath}`;
    const end = position(this.starts, source.length);
    this.nodes.push({
      id: this.fileId, kind: 'file', name: path.basename(filePath), qualifiedName: filePath,
      filePath, language, startLine: 1, endLine: end.line, startColumn: 0,
      endColumn: tagBased ? end.column : 0, isExported: tagBased ? undefined : false, updatedAt: Date.now(),
    });
  }

  owner(id: string, name: string | undefined, kind: NodeKind, start: number, end: number): ScriptOwner {
    return { id, name, kind, start, end };
  }

  fileOwner(): ScriptOwner { return this.owner(this.fileId, undefined, 'file', 0, this.source.length); }

  addNode(kind: NodeKind, name: string, qualifiedName: string, startOffset: number, endOffset: number,
    parent: ScriptOwner, extra: Partial<Node> = {}): ScriptOwner {
    const start = position(this.starts, startOffset);
    const end = position(this.starts, Math.max(startOffset, endOffset));
    const node: Node = {
      id: generateNodeId(this.filePath, kind, name, start.line), kind, name, qualifiedName,
      filePath: this.filePath, language: this.language,
      startLine: start.line, endLine: end.line, startColumn: start.column, endColumn: end.column,
      updatedAt: Date.now(), ...extra,
    };
    this.nodes.push(node);
    this.edges.push({ source: parent.id, target: node.id, kind: 'contains' });
    return this.owner(node.id, node.name, node.kind, startOffset, endOffset);
  }

  addRef(owner: ScriptOwner, name: string, kind: UnresolvedReference['referenceKind'], offset: number): void {
    const at = position(this.starts, offset);
    this.refs.push({
      fromNodeId: owner.id, referenceName: name, referenceKind: kind,
      filePath: this.filePath, language: this.language, line: at.line, column: at.column,
    });
  }

  script(source: string, baseOffset: number, externalOwner: ScriptOwner, component?: ScriptOwner, componentScope = false): void {
    const scan = scanSource(source, { hashComments: false });
    const tokens = scan.tokens;
    const declarations: Array<{ owner: ScriptOwner; bodyStart: number; bodyEnd: number }> = [];
    const tokenAbsolute = (token: NativeToken): number => baseOffset + token.start.offset;
    const endAbsolute = (token: NativeToken): number => baseOffset + token.end.offset;
    const find = (from: number, text: string, limit = tokens.length): number => {
      for (let i = from; i < limit; i += 1) if (tokens[i]?.text === text) return i;
      return -1;
    };
    const containing = (index: number): ScriptOwner => declarations
      .filter((entry) => entry.bodyStart <= index && entry.bodyEnd >= index)
      .sort((left, right) => (left.bodyEnd - left.bodyStart) - (right.bodyEnd - right.bodyStart))[0]?.owner ?? externalOwner;

    let scriptComponent = component;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      const lower = token.text.toLowerCase();
      if ((lower === 'component' || lower === 'interface') && tokens[index + 1]?.text !== '=') {
        const open = find(index + 1, '{');
        if (open < 0) continue;
        const close = scan.pairs.get(open) ?? tokens.length - 1;
        const name = path.basename(this.filePath).replace(/\.(?:cfc|cfm|cfs)$/iu, '');
        const kind: NodeKind = lower === 'interface' ? 'interface' : 'class';
        const attrs = source.slice(token.end.offset, tokens[open]!.start.offset);
        scriptComponent = this.addNode(kind, name, `${this.filePath}::${name}`, tokenAbsolute(token), endAbsolute(tokens[close]!), externalOwner, { isExported: true });
        declarations.push({ owner: scriptComponent, bodyStart: open, bodyEnd: close });
        const extendsMatch = /\bextends\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s{]+))/iu.exec(attrs);
        if (extendsMatch) this.addRef(scriptComponent, extendsMatch[1] ?? extendsMatch[2] ?? extendsMatch[3]!, 'extends', baseOffset + token.end.offset + extendsMatch.index);
        const implementsMatch = /\bimplements\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s{]+))/iu.exec(attrs);
        if (implementsMatch) for (const namePart of (implementsMatch[1] ?? implementsMatch[2] ?? implementsMatch[3]!).split(',').map((part) => part.trim()).filter(Boolean)) {
          this.addRef(scriptComponent, namePart, 'implements', baseOffset + token.end.offset + implementsMatch.index);
        }
      }
    }

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token.text.toLowerCase() !== 'function') continue;
      const nameIndex = index + 1;
      const nameToken = tokens[nameIndex];
      if (!nameToken || nameToken.kind !== 'identifier') continue;
      const paramsOpen = find(nameIndex + 1, '(');
      if (paramsOpen < 0) continue;
      const paramsClose = scan.pairs.get(paramsOpen) ?? paramsOpen;
      const bodyOpen = tokens[paramsClose + 1]?.text === '{' ? paramsClose + 1 : find(paramsClose + 1, '{', Math.min(tokens.length, paramsClose + 3));
      const bodyClose = bodyOpen >= 0 ? scan.pairs.get(bodyOpen) ?? tokens.length - 1 : paramsClose;
      const lexicalParent = declarations
        .filter((entry) => entry.bodyStart < index && entry.bodyEnd >= index)
        .sort((left, right) => (left.bodyEnd - left.bodyStart) - (right.bodyEnd - right.bodyStart))[0]?.owner;
      const parent = lexicalParent ?? (componentScope && scriptComponent ? scriptComponent : externalOwner);
      const isMethod = parent.kind === 'class' || parent.kind === 'interface';
      const kind: NodeKind = isMethod ? 'method' : 'function';
      let statementStart = index;
      while (statementStart > 0 && tokens[statementStart - 1]!.start.line === token.start.line && ![';', '{', '}'].includes(tokens[statementStart - 1]!.text)) statementStart -= 1;
      const prefix = tokens.slice(statementStart, index).map((item) => item.text.toLowerCase());
      const visibility = prefix.includes('private') ? 'private' : prefix.includes('package') ? 'internal'
        : prefix.some((item) => item === 'public' || item === 'remote') ? 'public' : undefined;
      const owner = this.addNode(kind, nameToken.text,
        parent.name ? `${parent.name}::${nameToken.text}` : nameToken.text,
        tokenAbsolute(tokens[statementStart] ?? token), endAbsolute(tokens[bodyClose] ?? nameToken), parent,
        { visibility, signature: source.slice(tokens[paramsOpen]!.start.offset, tokens[paramsClose]!.end.offset) });
      if (bodyOpen >= 0) declarations.push({ owner, bodyStart: bodyOpen, bodyEnd: bodyClose });
    }

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      const lower = token.text.toLowerCase();
      if (lower === 'import' || lower === 'include') {
        const semi = find(index + 1, ';');
        const limit = semi < 0 ? Math.min(tokens.length - 1, index + 16) : semi;
        const parts = tokens.slice(index + 1, limit).map((item) => item.text);
        const moduleName = parts.join('').replace(/^['"]|['"]$/gu, '');
        if (moduleName) this.addNode('import', moduleName, moduleName, tokenAbsolute(token), endAbsolute(tokens[limit]!), containing(index), { signature: source.slice(token.start.offset, tokens[limit]!.end.offset).trim() });
      }
    }

    for (let index = 1; index < tokens.length; index += 1) {
      if (tokens[index]!.text !== '(') continue;
      const before = tokens[index - 1]!;
      if (before.kind !== 'identifier') continue;
      const nameLower = before.text.toLowerCase();
      if (CALL_EXCLUSIONS.has(nameLower)) continue;
      if (tokens[index - 2]?.text.toLowerCase() === 'function') continue;
      let first = index - 1;
      while (first >= 2 && tokens[first - 1]?.text === '.' && tokens[first - 2]?.kind === 'identifier') first -= 2;
      const chain = tokens.slice(first, index).map((item) => item.text).join('');
      const previous = tokens[first - 1]?.text.toLowerCase();
      if (previous === 'new') {
        this.addRef(containing(index), chain.split('.').at(-1)!, 'instantiates', tokenAbsolute(before));
        continue;
      }
      let name = chain;
      if (/^(?:this)\.[A-Za-z_]\w*$/iu.test(chain)) name = before.text;
      else if (!/^(?:variables|this|local|arguments)\.[A-Za-z_]\w*\.[A-Za-z_]\w*$/iu.test(chain) && chain.split('.').length > 2) name = before.text;
      this.addRef(containing(index), name, 'calls', tokenAbsolute(before));
    }

    for (const incomplete of scan.unterminated) this.errors.push({
      message: `Incomplete ${incomplete} while scanning ${this.filePath}`,
      filePath: this.filePath, severity: 'warning', code: 'native_incomplete_source',
    });
  }

  query(source: string, baseOffset: number, owner: ScriptOwner): void {
    const pattern = /#(?!#)([\s\S]*?)(?<!#)#/gu;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) this.script(match[1] ?? '', baseOffset + match.index + 1, owner);
  }

  result(started: number): ExtractionResult {
    return { nodes: this.nodes, edges: this.edges, unresolvedReferences: this.refs, errors: this.errors, durationMs: Date.now() - started };
  }
}

/** Native CFML-family semantic orchestrator. It never loads or requests a grammar. */
export function extractNativeCfmlFacts(filePath: string, source: string, language: Language): ExtractionResult {
  const started = Date.now();
  const bare = language === 'cfscript' || isBareScriptCfml(source);
  const builder = new CfmlFactBuilder(filePath, source, language, !bare);
  if (bare) {
    builder.script(source, 0, builder.fileOwner(), undefined, true);
    return builder.result(started);
  }

  const regions = scanCfmlRegions(source);
  const file = builder.fileOwner();
  const componentTag = regions.find((region) => region.name === 'cfcomponent');
  let component: ScriptOwner | undefined;
  if (componentTag) {
    const attr = attributes(componentTag.text);
    const name = attr.get('name') ?? path.basename(filePath).replace(/\.(?:cfc|cfm|cfs)$/iu, '');
    component = builder.addNode('class', name, `${filePath}::${name}`, componentTag.start, componentTag.end, file, { isExported: true });
    const extended = attr.get('extends');
    if (extended) builder.addRef(component, extended, 'extends', componentTag.start);
    for (const implemented of (attr.get('implements') ?? '').split(',').map((part) => part.trim()).filter(Boolean)) builder.addRef(component, implemented, 'implements', componentTag.start);
  }

  const functions: ScriptOwner[] = [];
  for (const region of regions.filter((item) => item.name === 'cffunction')) {
    const attr = attributes(region.text);
    const name = attr.get('name');
    if (!name) continue;
    const parent = component && region.start >= component.start && region.end <= component.end ? component : file;
    const kind: NodeKind = parent === component ? 'method' : 'function';
    const access = attr.get('access')?.toLowerCase();
    const visibility = access === 'private' ? 'private' : access === 'package' ? 'internal' : access ? 'public' : undefined;
    functions.push(builder.addNode(kind, name, parent.name ? `${parent.name}::${name}` : `${filePath}::${name}`,
      region.start, region.end, parent, { visibility, returnType: attr.get('returntype') }));
  }
  const ownerAt = (offset: number): ScriptOwner => functions
    .filter((owner) => owner.start <= offset && owner.end >= offset)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0]
    ?? (component && component.start <= offset && component.end >= offset ? component : file);

  for (const region of regions.filter((item) => item.name === 'cfscript')) {
    const owner = ownerAt(region.start);
    builder.script(source.slice(region.openEnd, region.closeStart), region.openEnd, owner, component, owner === component);
  }
  for (const region of regions.filter((item) => item.name === 'cfquery')) {
    builder.query(source.slice(region.openEnd, region.closeStart), region.openEnd, ownerAt(region.start));
  }
  return builder.result(started);
}

function appendSpan(out: CfmlSyntaxSpan[], start: number, end: number, cls: CfmlSyntaxSpan['cls']): void {
  if (end <= start) return;
  const previous = out.at(-1);
  if (previous && previous.end === start && previous.cls === cls) previous.end = end;
  else out.push({ start, end, cls });
}

function classifyScriptSyntax(source: string, offset: number): CfmlSyntaxSpan[] {
  const scan = scanSource(source, { hashComments: false });
  const out: CfmlSyntaxSpan[] = [];
  for (let index = 0; index < scan.tokens.length; index += 1) {
    const token = scan.tokens[index]!;
    const lower = token.text.toLowerCase();
    let cls: CfmlSyntaxSpan['cls'] = 'other';
    if (token.kind === 'comment') cls = 'comment';
    else if (token.kind === 'string') cls = 'string';
    else if (token.kind === 'number') cls = 'number';
    else if (token.kind === 'identifier') {
      const previous = scan.tokens[index - 1]?.text.toLowerCase();
      if (previous === 'function' || previous === 'component' || previous === 'interface') cls = 'def';
      else if (previous === 'new' || previous === 'extends' || previous === 'implements') cls = 'type';
      else cls = SCRIPT_KEYWORDS.has(lower) ? 'keyword' : 'ident';
    }
    appendSpan(out, offset + token.start.offset, offset + token.end.offset, cls);
  }
  return out;
}

function classifyQuerySyntax(source: string, offset: number): CfmlSyntaxSpan[] {
  const scan = scanSource(source, { hashComments: false });
  const out: CfmlSyntaxSpan[] = [];
  for (const token of scan.tokens) {
    let cls: CfmlSyntaxSpan['cls'] = 'other';
    if (token.kind === 'comment') cls = 'comment';
    else if (token.kind === 'string') cls = 'string';
    else if (token.kind === 'number') cls = 'number';
    else if (token.kind === 'identifier') cls = QUERY_KEYWORDS.has(token.text.toLowerCase()) ? 'keyword' : 'ident';
    appendSpan(out, offset + token.start.offset, offset + token.end.offset, cls);
  }
  return out;
}

/** Native syntax classifier for bare and mixed CFML-family source. */
export function classifyNativeCfmlSyntax(source: string, language: Language, offset = 0): CfmlSyntaxSpan[] {
  if (language === 'cfscript' || language === 'cfquery' || isBareScriptCfml(source)) {
    if (language === 'cfquery') return classifyQuerySyntax(source, offset);
    return classifyScriptSyntax(source, offset);
  }
  const out: CfmlSyntaxSpan[] = [];
  const comments: Array<[number, number]> = [];
  const commentPattern = /<!---[\s\S]*?(?:--->|$)/gu;
  let comment: RegExpExecArray | null;
  while ((comment = commentPattern.exec(source)) !== null) comments.push([comment.index, comment.index + comment[0].length]);
  for (const [start, end] of comments) appendSpan(out, offset + start, offset + end, 'comment');
  const regions = scanCfmlRegions(source);
  for (const region of regions) {
    const tagName = /<\s*\/?\s*(cf[A-Za-z][\w:-]*)/iu.exec(region.text);
    if (tagName?.[1]) {
      const start = region.start + tagName.index + tagName[0].lastIndexOf(tagName[1]);
      appendSpan(out, offset + start, offset + start + tagName[1].length, 'keyword');
    }
    const attrPattern = /([A-Za-z_][\w:-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gu;
    let attr: RegExpExecArray | null;
    while ((attr = attrPattern.exec(region.text)) !== null) {
      const nameStart = region.start + attr.index;
      appendSpan(out, offset + nameStart, offset + nameStart + attr[1]!.length, 'ident');
      const valueStart = region.start + attr.index + attr[0].lastIndexOf(attr[2]!);
      appendSpan(out, offset + valueStart, offset + valueStart + attr[2]!.length, 'string');
    }
    if (region.name === 'cfscript') out.push(...classifyScriptSyntax(source.slice(region.openEnd, region.closeStart), offset + region.openEnd));
    if (region.name === 'cfquery') out.push(...classifyQuerySyntax(source.slice(region.openEnd, region.closeStart), offset + region.openEnd));
  }
  out.sort((left, right) => left.start - right.start || left.end - right.end);
  return out.filter((span, index) => index === 0 || span.start >= out[index - 1]!.end);
}
