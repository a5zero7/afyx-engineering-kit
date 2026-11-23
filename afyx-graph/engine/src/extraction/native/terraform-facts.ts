import type { NodeKind, UnresolvedReference } from '../../types';
import {
  finishDynamicFacts,
  type NativeDeclaration,
  type NativeReference,
  unquote,
} from './dynamic-fact-builder';
import { scanSource, type NativeScanResult, type NativeToken } from './scanner';

const BUILTIN_HEADS = new Set(['each', 'count', 'self', 'path', 'terraform']);
const BUILTIN_KEYWORDS = new Set(['null', 'true', 'false']);
const MODULE_META_ARGS = new Set(['source', 'version', 'count', 'for_each', 'providers', 'depends_on']);

interface Block {
  readonly type: string;
  readonly labels: readonly string[];
  readonly start: number;
  readonly open: number;
  readonly close: number;
  parent?: Block;
}

interface Attribute {
  readonly name: string;
  readonly start: number;
  readonly equals: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

interface BlockShape {
  readonly kind: NodeKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly signature: string;
  readonly exported?: boolean;
}

function nextSignificant(tokens: readonly NativeToken[], from: number, limit = tokens.length): number | undefined {
  for (let index = from; index < limit; index += 1) {
    if (tokens[index]?.kind !== 'comment') return index;
  }
  return undefined;
}

function labelValue(token: NativeToken | undefined): string | null {
  if (!token) return null;
  if (token.kind === 'identifier') return token.text;
  if (token.kind === 'string' && token.text.startsWith('"') && token.text.endsWith('"')) return unquote(token.text);
  return null;
}

function braceDepths(tokens: readonly NativeToken[]): number[] {
  const result: number[] = [];
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.text === '}') depth = Math.max(0, depth - 1);
    result[index] = depth;
    if (tokens[index]?.text === '{') depth += 1;
  }
  return result;
}

function findBlocks(scan: NativeScanResult): Block[] {
  const tokens = scan.tokens;
  const result: Block[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.kind !== 'identifier') continue;
    const labels: string[] = [];
    let cursor = nextSignificant(tokens, index + 1);
    while (cursor !== undefined && cursor < tokens.length && tokens[cursor]?.text !== '{') {
      if (tokens[cursor]?.text === '=') break;
      const label = labelValue(tokens[cursor]);
      if (label === null) break;
      labels.push(label);
      cursor = nextSignificant(tokens, cursor + 1);
    }
    if (cursor === undefined || tokens[cursor]?.text !== '{') continue;
    const close = scan.pairs.get(cursor);
    result.push({
      type: tokens[index]!.text,
      labels,
      start: index,
      open: cursor,
      close: close !== undefined && close > cursor ? close : tokens.length - 1,
    });
  }
  for (const block of result) {
    block.parent = result
      .filter((candidate) => candidate !== block && candidate.open < block.start && candidate.close >= block.close)
      .sort((left, right) => (left.close - left.open) - (right.close - right.open))[0];
  }
  return result;
}

function describeBlock(type: string, labels: readonly string[]): BlockShape | null {
  const [first, second] = labels;
  if (type === 'resource' && first && second) return {
    kind: 'class', name: `${first}.${second}`, qualifiedName: `${first}.${second}`,
    signature: `resource "${first}" "${second}"`,
  };
  if (type === 'data' && first && second) return {
    kind: 'class', name: `${first}.${second}`, qualifiedName: `data.${first}.${second}`,
    signature: `data "${first}" "${second}"`,
  };
  if (type === 'module' && first) return {
    kind: 'module', name: first, qualifiedName: `module.${first}`, signature: `module "${first}"`,
  };
  if (type === 'variable' && first) return {
    kind: 'variable', name: first, qualifiedName: `var.${first}`, signature: `variable "${first}"`, exported: true,
  };
  if (type === 'output' && first) return {
    kind: 'variable', name: first, qualifiedName: `output.${first}`, signature: `output "${first}"`, exported: true,
  };
  if (type === 'provider' && first) return {
    kind: 'namespace', name: first, qualifiedName: `provider.${first}`, signature: `provider "${first}"`,
  };
  return null;
}

function claimsChildren(block: Block): boolean {
  return block.type === 'locals' || block.type === 'terraform' || block.type === 'moved' ||
    block.type === 'import' || block.type === 'removed' || block.type === 'assert' ||
    describeBlock(block.type, block.labels) !== null;
}

function hasClaimedAncestor(block: Block): boolean {
  let parent = block.parent;
  while (parent) {
    if (claimsChildren(parent)) return true;
    parent = parent.parent;
  }
  return false;
}

function directAttributes(
  block: Block,
  tokens: readonly NativeToken[],
  depths: readonly number[],
): Attribute[] {
  const directDepth = (depths[block.open] ?? 0) + 1;
  const bodyEnd = tokens[block.close]?.text === '}' ? block.close - 1 : block.close;
  const starts: Array<{ name: string; start: number; equals: number }> = [];
  for (let index = block.open + 1; index <= bodyEnd; index += 1) {
    if (depths[index] !== directDepth || tokens[index]?.kind !== 'identifier') continue;
    const equals = nextSignificant(tokens, index + 1, block.close);
    if (equals !== undefined && tokens[equals]?.text === '=') starts.push({ name: tokens[index]!.text, start: index, equals });
  }
  return starts.map((item, position) => ({
    ...item,
    valueStart: nextSignificant(tokens, item.equals + 1, block.close) ?? item.equals,
    valueEnd: (starts[position + 1]?.start ?? bodyEnd + 1) - 1,
  }));
}

function qualifyReference(head: string, attrs: readonly string[]): string[] {
  if (BUILTIN_HEADS.has(head) || BUILTIN_KEYWORDS.has(head)) return [];
  if (head === 'var') return attrs[0] ? [`var.${attrs[0]}`] : [];
  if (head === 'local') return attrs[0] ? [`local.${attrs[0]}`] : [];
  if (head === 'module') {
    if (!attrs[0]) return [];
    const refs = [`module.${attrs[0]}`];
    if (attrs[1]) refs.push(`module.${attrs[0]}:output.${attrs[1]}`);
    if (attrs[1] === 'outputs' && attrs[2]) refs.push(`module.${attrs[0]}:remote-output.${attrs[2]}`);
    return refs;
  }
  if (head === 'data') return attrs[0] && attrs[1] ? [`data.${attrs[0]}.${attrs[1]}`] : [];
  return attrs[0] ? [`${head}.${attrs[0]}`] : [];
}

function syntheticToken(source: string, offset: number, text: string): NativeToken {
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  const line = lines.length;
  const column = lines.at(-1)?.length ?? 0;
  return {
    kind: 'identifier', text,
    start: { offset, line, column },
    end: { offset: offset + text.length, line, column: column + text.length },
  };
}

function addRef(
  references: NativeReference[], owner: NativeDeclaration | undefined,
  token: NativeToken | undefined, name: string, kind: UnresolvedReference['referenceKind'] = 'references',
): void {
  if (token) references.push({ owner, token, name, kind });
}

function addQualified(
  references: NativeReference[], owner: NativeDeclaration | undefined,
  token: NativeToken | undefined, head: string, attrs: readonly string[], suppressScoped = false,
): void {
  for (const name of qualifyReference(head, attrs)) {
    if (!suppressScoped || !name.includes(':')) addRef(references, owner, token, name);
  }
}

function referencesInTemplate(
  source: string, token: NativeToken, owner: NativeDeclaration | undefined,
  references: NativeReference[], suppressScoped: boolean,
): void {
  const pattern = /([$%])\{([\s\S]*?)\}/gu;
  for (const match of token.text.matchAll(pattern)) {
    if (match[1] === '$' && match.index !== undefined && token.text[match.index - 1] === '$') continue;
    const expression = match[2] ?? '';
    const traversal = /\b([A-Za-z_][\w-]*)((?:\.[A-Za-z_][\w-]*)+)/gu;
    for (const found of expression.matchAll(traversal)) {
      const attrs = (found[2] ?? '').slice(1).split('.');
      const offset = token.start.offset + (match.index ?? 0) + match[0].indexOf(expression) + (found.index ?? 0);
      addQualified(references, owner, syntheticToken(source, offset, found[1]!), found[1]!, attrs, suppressScoped);
    }
  }
}

function collectReferences(
  source: string, tokens: readonly NativeToken[], scan: NativeScanResult,
  start: number, end: number, owner: NativeDeclaration | undefined,
  references: NativeReference[], suppressScoped = false, suppressed: readonly Attribute[] = [],
): void {
  const isSuppressed = (index: number) => suppressed.some((attr) => index >= attr.start && index <= attr.valueEnd);
  for (let index = start; index <= end; index += 1) {
    const token = tokens[index];
    if (!token || token.kind === 'comment' || isSuppressed(index)) continue;
    if (token.kind === 'string') {
      referencesInTemplate(source, token, owner, references, suppressScoped);
      continue;
    }
    if (token.kind !== 'identifier' || tokens[index - 1]?.text === '.') continue;
    const attrs: string[] = [];
    let cursor = index + 1;
    while (cursor <= end) {
      if (tokens[cursor]?.text === '[') {
        const close = scan.pairs.get(cursor);
        if (close === undefined || close <= cursor) break;
        cursor = close + 1;
        continue;
      }
      if (tokens[cursor]?.text !== '.' || tokens[cursor + 1]?.kind !== 'identifier') break;
      attrs.push(tokens[cursor + 1]!.text);
      cursor += 2;
    }
    if (attrs.length > 0) addQualified(references, owner, token, token.text, attrs, suppressScoped);
  }
}

function staticProviderSelection(tokens: readonly NativeToken[], attr: Attribute): string | null {
  const values: NativeToken[] = [];
  for (let index = attr.valueStart; index <= attr.valueEnd; index += 1) {
    const token = tokens[index];
    if (token && token.kind !== 'comment') values.push(token);
  }
  if (values.length === 1 && values[0]!.kind === 'identifier') return values[0]!.text;
  if (values.length === 3 && values[0]!.kind === 'identifier' && values[1]!.text === '.' && values[2]!.kind === 'identifier') {
    return `${values[0]!.text}.${values[2]!.text}`;
  }
  return null;
}

function stringAttribute(tokens: readonly NativeToken[], attr: Attribute | undefined): string | null {
  const token = attr ? tokens[attr.valueStart] : undefined;
  if (!token || token.kind !== 'string' || !token.text.startsWith('"') || !token.text.endsWith('"')) return null;
  const value = unquote(token.text);
  return value.includes('${') || value.includes('%{') ? null : value;
}

function emitModuleProviderRefs(
  tokens: readonly NativeToken[], attr: Attribute, owner: NativeDeclaration,
  references: NativeReference[],
): void {
  for (let index = attr.valueStart; index <= attr.valueEnd; index += 1) {
    if (tokens[index]?.text !== '=') continue;
    const head = nextSignificant(tokens, index + 1, attr.valueEnd + 1);
    if (head === undefined || tokens[head]?.kind !== 'identifier') continue;
    const dot = nextSignificant(tokens, head + 1, attr.valueEnd + 1);
    const tail = dot !== undefined && tokens[dot]?.text === '.' ? nextSignificant(tokens, dot + 1, attr.valueEnd + 1) : undefined;
    const selection = tail !== undefined && tokens[tail]?.kind === 'identifier'
      ? `${tokens[head]!.text}.${tokens[tail]!.text}`
      : tokens[head]!.text;
    addRef(references, owner, tokens[head], `provider.${selection}`);
  }
}

/** Bounded Afyx-native Terraform/OpenTofu semantic facts. */
export function extractNativeTerraformFacts(filePath: string, source: string) {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: true, hclSyntax: true });
  const tokens = scan.tokens;
  const depths = braceDepths(tokens);
  const blocks = findBlocks(scan);
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];

  if (filePath.toLowerCase().endsWith('.tfvars')) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (depths[index] !== 0 || tokens[index]?.kind !== 'identifier') continue;
      const equals = nextSignificant(tokens, index + 1);
      if (equals !== undefined && tokens[equals]?.text === '=') addRef(references, undefined, tokens[index], `var.${tokens[index]!.text}`);
    }
  }

  for (const block of blocks) {
    if (hasClaimedAncestor(block)) continue;
    const attrs = directAttributes(block, tokens, depths);
    if (block.type === 'terraform') continue;
    if (block.type === 'locals' && block.labels.length === 0) {
      for (const attr of attrs) {
        const local: NativeDeclaration = {
          kind: 'constant', name: attr.name, qualifiedName: `local.${attr.name}`,
          start: attr.start, end: attr.valueEnd, signature: `local.${attr.name}`,
        };
        declarations.push(local);
        collectReferences(source, tokens, scan, attr.valueStart, attr.valueEnd, local, references);
      }
      continue;
    }
    const bodyEnd = tokens[block.close]?.text === '}' ? block.close - 1 : block.close;
    if (['moved', 'import', 'removed', 'assert'].includes(block.type) && block.labels.length === 0) {
      collectReferences(source, tokens, scan, block.open + 1, bodyEnd, undefined, references, true);
      continue;
    }
    const shape = describeBlock(block.type, block.labels);
    if (!shape) continue;
    let name = shape.name;
    let qualifiedName = shape.qualifiedName;
    let signature = shape.signature;
    if (block.type === 'provider') {
      const alias = stringAttribute(tokens, attrs.find((attr) => attr.name === 'alias'));
      if (alias) {
        name = `${block.labels[0]}.${alias}`;
        qualifiedName = `provider.${name}`;
        signature = `provider "${block.labels[0]}" alias="${alias}"`;
      }
    }
    const declaration: NativeDeclaration = {
      kind: shape.kind, name, qualifiedName, signature, exported: shape.exported ?? false,
      start: block.start, end: block.close, bodyStart: block.open + 1, bodyEnd,
    };
    declarations.push(declaration);

    const suppressed: Attribute[] = [];
    if (block.type === 'resource' || block.type === 'data') {
      const provider = attrs.find((attr) => attr.name === 'provider');
      if (provider) {
        suppressed.push(provider);
        const selection = staticProviderSelection(tokens, provider);
        if (selection) addRef(references, declaration, tokens[provider.valueStart], `provider.${selection}`);
      }
    }
    if (block.type === 'module') {
      const providers = attrs.find((attr) => attr.name === 'providers');
      if (providers) {
        suppressed.push(providers);
        emitModuleProviderRefs(tokens, providers, declaration, references);
      }
    }
    collectReferences(source, tokens, scan, block.open + 1, bodyEnd, declaration, references, false, suppressed);

    if (block.type === 'module' && block.labels[0]) {
      const moduleName = block.labels[0];
      const sourceAttr = attrs.find((attr) => attr.name === 'source');
      const moduleSource = stringAttribute(tokens, sourceAttr);
      if (moduleSource?.startsWith('./') || moduleSource?.startsWith('../')) {
        addRef(references, declaration, tokens[block.start], `module.${moduleName}:file`, 'imports');
      }
      for (const attr of attrs) {
        if (MODULE_META_ARGS.has(attr.name)) continue;
        addRef(references, declaration, tokens[attr.start], `module.${moduleName}:var.${attr.name}`);
      }
    }
  }

  return finishDynamicFacts(filePath, source, 'terraform', scan, declarations, references, started);
}
