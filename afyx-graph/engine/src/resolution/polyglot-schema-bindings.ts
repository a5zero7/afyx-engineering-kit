/** Copyright (c) 2026 Afyx */
import type { Edge, Node } from '../types';
import { BindingSource, localSource, ownerName, schemaEdge, type Binding } from './schema-binding-source';

const ROOTS = new Map([['QueryType', 'Query'], ['MutationType', 'Mutation'], ['SubscriptionType', 'Subscription']]);
const camel = (name: string) => name.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()).replace(/^[A-Z]/, char => char.toLowerCase());
const pascal = (name: string) => camel(name).replace(/^[a-z]/, char => char.toUpperCase());

function methods(source: BindingSource, owner: string, open: number): Node[] {
  const end = source.end(open);
  if (end === undefined) return [];
  return source.nodes.filter(node => node.kind === 'method' && ownerName(node) === owner &&
    source.containsPosition(open, end, node));
}

function precedingAttribute(source: BindingSource, start: number, rust: boolean): { open: number; close: number } | undefined {
  let close = start - 1;
  while (['pub', 'async'].includes(source.text(close))) close--;
  if (source.text(close) !== ']') return undefined;
  const open = source.end(close);
  if (open === undefined || (rust && source.text(open - 1) !== '#')) return undefined;
  return { open, close };
}

function explicitField(source: BindingSource, attr: { open: number; close: number }, rust: boolean): string | undefined {
  const name = source.names(source.next(attr.open), rust ? '::' : '.');
  if (name.parts.join(rust ? '::' : '.') !== (rust ? 'graphql' : 'HotChocolate.GraphQLName') ||
      source.text(name.next) !== '(' || source.end(name.next) === undefined) return undefined;
  const callEnd = source.end(name.next)!;
  if (source.next(callEnd) !== attr.close) return undefined;
  let arg = source.next(name.next);
  if (rust) {
    if (source.text(arg) !== 'name' || source.text(source.next(arg)) !== '=') return undefined;
    arg = source.next(source.next(arg));
  }
  return source.next(arg) === callEnd ? source.literal(arg) : undefined;
}

function usesNamespace(source: BindingSource, keyword: string, separator: string, namespace: string): boolean {
  return [...source.marks(keyword)].some(mark => {
    const path = source.names(source.next(mark), separator);
    return source.text(path.next) === ';' && path.parts.join(separator) === namespace;
  });
}

function* hotChocolateObjectTypes(source: BindingSource): IterableIterator<Binding> {
  const registered = new Set<string>();
  for (const mark of source.marks('AddType')) {
    if (source.text(mark - 1) !== '.' || source.text(source.next(mark)) !== '<') continue;
    const registration = source.text(mark - 2) === ')' ? source.end(mark - 2) : undefined;
    if (registration === undefined || source.text(registration - 1) !== 'AddGraphQLServer' ||
        source.text(registration - 2) !== '.') continue;
    const type = source.names(source.next(source.next(mark)), '.');
    const open = source.next(type.next);
    if (type.parts.length >= 2 && source.text(type.next) === '>' &&
        source.text(open) === '(' && source.end(open) === source.next(open)) registered.add(type.parts.join('::'));
  }
  for (const mark of source.marks('class')) {
    const name = source.next(mark), colon = source.next(name);
    if (source.text(colon) !== ':') continue;
    const types = source.nodes.filter(node => node.kind === 'class' && node.name === source.id(name) &&
      node.startLine === source.line(mark));
    if (types.length !== 1 || !registered.has(types[0]!.qualifiedName)) continue;
    const type = types[0]!;
    const base = source.names(source.next(colon), '.');
    if (base.parts.join('.') !== 'HotChocolate.Types.ObjectType' || source.text(base.next) !== '<') continue;
    const model = source.names(source.next(base.next), '.');
    const classOpen = source.next(model.next);
    if (model.parts.length < 2 || source.text(model.next) !== '>' || source.text(classOpen) !== '{') continue;
    const configs = methods(source, type.name, classOpen).filter(node => node.name === 'Configure');
    if (configs.length !== 1) continue;
    const configure = configs[0]!;
    const signature = (configure.signature ?? '').replace(/\s+/g, '');
    const prefix = 'protectedoverridevoidConfigure(HotChocolate.Types.IObjectTypeDescriptor<' + model.parts.join('.') + '>';
    const receiver = signature.startsWith(prefix) && /^([A-Za-z_]\w*)\)$/.exec(signature.slice(prefix.length))?.[1];
    if (!receiver) continue;
    const configureStart = source.positionIndex(configure);
    const body = configureStart === undefined ? undefined :
      [...source.marks('Configure')].find(i => source.line(i) === configure.startLine && source.braceScope(i) === classOpen);
    if (body === undefined) continue;
    const args = source.end(source.next(body));
    const open = args === undefined ? -1 : source.next(args);
    if (source.text(open) !== '{') continue;
    const direct = (i: number) => source.braceScope(i) === open && source.text(i - 1) === '.' && source.text(i - 2) === receiver &&
      ['{', ';'].includes(source.text(i - 3));
    const ownerNames = [...source.marks('Name')].filter(direct);
    if (ownerNames.length !== 1) continue;
    const ownerOpen = source.next(ownerNames[0]!);
    const owner = source.text(ownerOpen) === '(' && source.end(ownerOpen) === source.next(source.next(ownerOpen))
      ? source.literal(source.next(ownerOpen)) : undefined;
    if (!owner) continue;
    for (const field of source.marks('Field')) {
      if (!direct(field)) continue;
      const call = source.next(field), parameter = source.next(call);
      const lambda = source.next(parameter), object = source.next(lambda);
      const dot = source.next(object), member = source.next(dot), invoke = source.next(member);
      const close = source.end(invoke);
      if (source.text(call) !== '(' || source.text(lambda) !== '=>' || !source.id(parameter) ||
          source.id(parameter) !== source.id(object) || source.text(dot) !== '.' || !source.id(member) ||
          source.text(invoke) !== '(' || close !== source.next(invoke) || source.end(call) !== source.next(close)) continue;
      const dotName = source.next(source.end(call)!);
      const rename = source.next(dotName), nameCall = source.next(rename), literal = source.next(nameCall);
      if (source.text(dotName) !== '.' || source.text(rename) !== 'Name' || source.text(nameCall) !== '(' ||
          source.end(nameCall) !== source.next(literal) || source.text(source.next(source.end(nameCall)!)) !== ';') continue;
      const fieldName = source.literal(literal);
      const targets = exactMethods(source, model.parts.join('::'), source.id(member)!, 'csharp')
        .filter(node => /\(\s*\)\s*$/.test(node.signature ?? '') && node.visibility === 'public');
      if (fieldName && targets.length === 1 && localSource(source.ctx, targets[0]!.filePath) !== null) {
        yield { owner, member: fieldName, target: targets[0]!, evidence: 'hotchocolate-registered-object-type' };
      }
    }
  }
}

/** Read syntax markers as tokens. Delimiters, comments and literals cannot introduce declarations. */
export function* polyglotGraphql(source: BindingSource): IterableIterator<Binding> {
  if (source.file.endsWith('.cs')) yield* hotChocolateObjectTypes(source);
  for (let index = 0; index < source.length; index++) {
    if (source.text(index) !== '[') continue;
    const end = source.end(index);
    if (end === undefined) continue;
    const after = source.next(end);
    if (source.file.endsWith('.rs') && source.text(index - 1) === '#' && source.text(after) === 'impl') {
      const name = source.id(source.next(after));
      if (!name) continue;
      const attr = source.names(source.next(index), '::');
      const kind = attr.parts.join('::');
      if (attr.next !== end || !((['async_graphql::Object', 'Object'].includes(kind) &&
          ['Query', 'Mutation'].includes(name)) ||
          (['async_graphql::Subscription', 'Subscription'].includes(kind) && name === 'Subscription'))) continue;
      if (!kind.includes('::') && !usesNamespace(source, 'use', '::', 'async_graphql::' + kind)) continue;
      const open = source.next(source.next(after));
      if (source.text(open) !== '{') continue;
      for (const target of methods(source, name, open)) {
        const token = source.positionIndex(target);
        if (token === undefined || source.braceScope(token) !== open) continue;
        const attr = precedingAttribute(source, token, true);
        const member = attr ? explicitField(source, attr, true) : camel(target.name);
        if (member) yield { owner: name, member, target, evidence: 'async-graphql-root' };
      }
    } else if (source.file.endsWith('.cs')) {
      const attr = source.names(source.next(index), '.');
      const owner = ROOTS.get(attr.parts.at(-1) ?? '');
      const qualified = attr.parts.slice(0, -1).join('.');
      if (!owner || attr.next !== end || (qualified !== 'HotChocolate.Types' &&
          !(attr.parts.length === 1 && usesNamespace(source, 'using', '.', 'HotChocolate.Types')))) continue;
      let cursor = after;
      while (['public', 'internal', 'partial', 'static', 'sealed'].includes(source.text(cursor))) cursor = source.next(cursor);
      if (source.text(cursor) !== 'class') continue;
      const nameIndex = source.next(cursor);
      const ownerName = source.id(nameIndex);
      const open = source.next(nameIndex);
      if (!ownerName || source.text(open) !== '{') continue;
      for (const target of methods(source, ownerName, open)) {
        const token = source.positionIndex(target);
        if (token === undefined || source.braceScope(token) !== open) continue;
        const attrEnd = source.text(token) === '[' ? source.end(token) : undefined;
        const start = attrEnd === undefined ? token : source.next(attrEnd);
        if (source.text(start) !== 'public') continue;
        const attr = attrEnd === undefined ? precedingAttribute(source, token, false) : { open: token, close: attrEnd };
        const member = attr ? explicitField(source, attr, false) : camel(target.name);
        if (member) yield { owner, member, target, evidence: 'hotchocolate-root' };
      }
    }
  }
}

export function* polyglotGrpc(source: BindingSource): IterableIterator<Binding> {
  if (source.file.endsWith('.rs')) {
    for (const index of source.marks('impl')) {
      if (source.text(index - 1) !== ']') continue;
      const attrOpen = source.end(index - 1);
      if (attrOpen === undefined || source.text(attrOpen - 1) !== '#' ||
          source.names(source.next(attrOpen), '::').parts.join('::') !== 'tonic::async_trait') continue;
      const trait = source.names(source.next(index), '::');
      if (source.text(trait.next) !== 'for' || trait.parts[0] !== 'crate' || trait.parts.length < 4) continue;
      const service = trait.parts.at(-1)!;
      const module = service.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase() + '_server';
      if (trait.parts.at(-2) !== module) continue;
      const handler = source.next(trait.next);
      const name = source.id(handler);
      const open = source.next(handler);
      if (!name || source.text(open) !== '{') continue;
      for (const target of methods(source, name, open)) {
        const token = source.positionIndex(target);
        if (token === undefined || source.braceScope(token) !== open) continue;
        yield { owner: [...trait.parts.slice(1, -2), service].join('.'),
          member: pascal(target.name), target, evidence: 'tonic-qualified-trait' };
      }
    }
  } else if (source.file.endsWith('.cs')) {
    for (const index of source.marks('class')) {
      const handler = source.next(index);
      const name = source.id(handler);
      const colon = source.next(handler);
      if (!name || source.text(colon) !== ':') continue;
      const base = source.names(source.next(colon), '.');
      const service = base.parts.at(-2);
      if (!service || base.parts.length < 3 || base.parts.at(-1) !== service + 'Base' || source.text(base.next) !== '{') continue;
      for (const target of methods(source, name, base.next)) {
        const start = source.positionIndex(target);
        if (start === undefined || source.braceScope(start) !== base.next) continue;
        let position = start;
        while (['public', 'protected', 'internal', 'sealed', 'async'].includes(source.text(position))) position = source.next(position);
        if (source.text(position) !== 'override') continue;
        yield { owner: base.parts.slice(0, -1).join('.'), member: target.name, target, evidence: 'aspnet-grpc-override' };
      }
    }
  }
}

function normalizedName(parts: string[]): string { return parts.join('::'); }

function exactMethods(source: BindingSource, type: string, name: string, language: Node['language']): Node[] {
  return source.ctx.getNodesByQualifiedName(type + '::' + name).filter(node =>
    node.language === language && node.kind === 'method');
}

export function* lighthouseGraphql(source: BindingSource): IterableIterator<Edge> {
  const owners = new Set(source.nodes.filter(node => node.kind === 'class' &&
    /^(?:extend\s+)?type\s/.test(node.signature ?? '')).map(node => node.qualifiedName));
  const fields = source.nodes.filter(node => node.kind === 'property' &&
    owners.has(node.qualifiedName.slice(0, node.qualifiedName.lastIndexOf('.'))));
  for (const mark of source.marks('field')) {
    if (source.text(mark - 1) !== '@') continue;
    const open = source.next(mark);
    if (source.text(open) !== '(') continue;
    const args = [...source.items(open)];
    const resolver = args.filter(({ start, stop }) =>
      source.text(start) === 'resolver' && source.text(source.next(start)) === ':' &&
      source.next(source.next(source.next(start))) === stop);
    if (resolver.length !== 1) continue;
    const literal = source.stringToken(source.next(source.next(resolver[0]!.start)));
    // Decode only JSON string escaping, and accept an explicit PHP FQN.
    let decoded: unknown;
    try { decoded = literal ? JSON.parse(literal) : null; } catch { continue; }
    const match = typeof decoded === 'string' &&
      /^\\?([A-Za-z_]\w*(?:\\[A-Za-z_]\w*)+)@([A-Za-z_]\w*)$/.exec(decoded);
    if (!match) continue;
    const field = fields.filter(node => node.startLine === source.line(mark));
    if (field.length !== 1) continue;
    const target = exactMethods(source, match[1]!.split('\\').join('::'), match[2]!, 'php');
    if (target.length === 1 && localSource(source.ctx, target[0]!.filePath) !== null) yield schemaEdge(field[0]!, {
      owner: '', member: field[0]!.name, target: target[0]!, evidence: 'lighthouse-explicit-field',
    }, 'graphql-resolver');
  }
}

export function* rubyGraphql(source: BindingSource): IterableIterator<Binding> {
  // A concrete GraphQL object declares the field and an explicit resolver class.
  for (const mark of source.marks('field')) {
    const colon = source.next(mark);
    const field = source.next(colon);
    const comma = source.next(field);
    const key = source.next(comma);
    if (source.text(colon) !== ':' || source.text(comma) !== ',' || source.text(key) !== 'resolver' ||
        source.text(source.next(key)) !== ':') continue;
    const name = source.id(field);
    const type = source.names(source.next(source.next(key)), '::');
    if (!name || !type.parts.length || ['.', '(', '::'].includes(source.text(type.next))) continue;
    const owner = source.nodes.filter(node => node.kind === 'class' && node.startLine < source.line(mark) &&
      node.endLine >= source.line(mark)).sort((a, b) => b.startLine - a.startLine)[0];
    if (!owner) continue;
    const header = source.positionIndex(owner);
    if (header === undefined || source.text(header) !== 'class') continue;
    const base = source.names(source.next(header), '::');
    if (source.text(base.next) !== '<' ||
        source.names(source.next(base.next), '::').parts.join('::') !== 'GraphQL::Schema::Object') continue;
    const candidates = exactMethods(source, normalizedName(type.parts), 'resolve', 'ruby');
    if (candidates.length !== 1) continue;
    const target = candidates[0]!;
    const content = localSource(source.ctx, target.filePath);
    if (!content) continue;
    const targetSource = new BindingSource(source.ctx, target.filePath, content);
    const resolverClasses = targetSource.nodes.filter(node => node.kind === 'class' &&
      node.qualifiedName === type.parts.join('::') && node.startLine < target.startLine && target.endLine <= node.endLine);
    if (resolverClasses.length !== 1) continue;
    const declaration = targetSource.positionIndex(resolverClasses[0]!);
    if (declaration === undefined) continue;
    const resolver = targetSource.names(targetSource.next(declaration), '::');
    if (targetSource.text(resolver.next) !== '<' ||
        targetSource.names(targetSource.next(resolver.next), '::').parts.join('::') !== 'GraphQL::Schema::Resolver') continue;
    yield { owner: owner.name, member: camel(name), target, evidence: 'graphql-ruby-resolver-class' };
  }
}

export function* rubyGrpc(source: BindingSource): IterableIterator<Binding> {
  for (const mark of source.marks('class')) {
    const name = source.id(source.next(mark));
    const less = source.next(source.next(mark));
    if (!name || source.text(less) !== '<') continue;
    const base = source.names(source.next(less), '::');
    if (base.parts.at(-1) !== 'Service' || base.parts.length < 3 ||
        source.line(base.next) === source.line(mark)) continue;
    const candidates = source.ctx.getNodesByQualifiedName(base.parts.join('::')).filter(node =>
      node.kind === 'class' && node.language === 'ruby');
    if (candidates.length !== 1) continue;
    const service = candidates[0]!;
    const content = localSource(source.ctx, service.filePath);
    if (!content) continue;
    const serviceSource = new BindingSource(source.ctx, service.filePath, content);
    const inService = (i: number) => serviceSource.line(i) > service.startLine &&
      serviceSource.line(i) <= service.endLine;
    if (![...serviceSource.marks('include')].some(i => {
      const included = serviceSource.names(serviceSource.next(i), '::');
      return inService(i) && included.parts.join('::') === 'GRPC::GenericService' &&
        serviceSource.line(included.next) !== serviceSource.line(i);
    })) continue;
    const markers = [...serviceSource.marks('service_name')].filter(i =>
      inService(i) &&
      serviceSource.text(i - 1) === '.' && serviceSource.text(i - 2) === 'self' &&
      serviceSource.text(serviceSource.next(i)) === '=');
    if (markers.length !== 1) continue;
    const owner = /^(['"])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\1$/
      .exec(serviceSource.stringToken(serviceSource.next(serviceSource.next(markers[0]!))) ?? '')?.[2];
    if (!owner) continue;
    const names = new Set([...serviceSource.marks('rpc')].filter(i =>
      inService(i) &&
      serviceSource.text(serviceSource.next(i)) === ':')
      .map(i => serviceSource.id(serviceSource.next(serviceSource.next(i)))));
    const handler = source.nodeAt(mark, node => node.kind === 'class' && node.name === name);
    if (!handler) continue;
    for (const target of source.nodes) {
      const member = pascal(target.name);
      if (target.kind !== 'method' || ownerName(target) !== name || !names.has(member) ||
          target.startLine <= handler.startLine || target.endLine > handler.endLine) continue;
      yield { owner, member, target, evidence: 'ruby-grpc-service' };
    }
  }
}

export function* phpGrpc(source: BindingSource): IterableIterator<Binding> {
  for (const mark of source.marks('class')) {
    const name = source.id(source.next(mark));
    const implementsToken = source.next(source.next(mark));
    if (!name || source.text(implementsToken) !== 'implements') continue;
    const absolute = source.next(implementsToken);
    if (source.text(absolute) !== '\\') continue;
    const contract = source.names(source.next(absolute), '\\');
    const open = contract.next;
    if (source.text(open) !== '{') continue;
    const matches = source.ctx.getNodesByQualifiedName(contract.parts.join('::')).filter(node =>
      node.kind === 'interface' && node.language === 'php');
    if (matches.length !== 1) continue;
    const base = matches[0]!;
    const content = localSource(source.ctx, base.filePath);
    if (!content) continue;
    const definition = new BindingSource(source.ctx, base.filePath, content);
    const start = definition.positionIndex(base);
    if (start === undefined) continue;
    const extendsToken = definition.next(definition.next(start));
    if (definition.text(extendsToken) !== 'extends' || definition.text(definition.next(extendsToken)) !== '\\') continue;
    const parent = definition.names(definition.next(definition.next(extendsToken)), '\\');
    if (parent.parts.join('\\') !== 'Spiral\\RoadRunner\\GRPC\\ServiceInterface' || definition.text(parent.next) !== '{') continue;
    const serviceNames = [...definition.marks('NAME')].filter(i => definition.braceScope(i) === parent.next &&
      definition.text(i - 1) === 'const' && definition.text(definition.next(i)) === '=');
    if (serviceNames.length !== 1) continue;
    const owner = /^(['"])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\1$/
      .exec(definition.stringToken(definition.next(definition.next(serviceNames[0]!))) ?? '')?.[2];
    if (!owner) continue;
    const end = definition.end(parent.next);
    if (end === undefined) continue;
    const declared = new Set([...definition.marks('function')].filter(i => i > parent.next && i < end &&
      definition.braceScope(i) === parent.next).map(i => definition.id(definition.next(i))));
    for (const target of methods(source, name, open)) {
      if (declared.has(target.name)) yield { owner, member: target.name, target, evidence: 'php-grpc-service-interface' };
    }
  }
}
