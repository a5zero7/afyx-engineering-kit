/** Copyright (c) 2026 Afyx */
import { posix } from 'node:path';
import type { Edge, Node } from '../types';
import type { MaybeYield } from './cooperative-yield';
import {
  BindingSource, JS_SOURCE, callable, groupBy, localSource, ownerName, schemaEdge,
  type Binding, type SchemaBindingContext,
} from './schema-binding-source';

export const GRPC_SYNTHESIS = 'grpc-service';

type Implementation = { scope: string; type: string; service: string; evidence: string };
type Handler = { scope: string; type: string; target: Node };

function* jsBindings(source: BindingSource, services: ReadonlySet<string>): IterableIterator<Binding> {
  for (const index of source.marks('addService')) {
    if (source.text(index - 1) !== '.' || source.text(source.next(index)) !== '(') continue;
    const [descriptor, handlers] = [...source.items(source.next(index))];
    if (!descriptor || !handlers) continue;
    const { parts, next } = source.qualified(descriptor.start);
    if (next !== descriptor.stop) continue;
    const name = parts.at(-1) ?? '';
    const candidates = name === 'service' ? [parts.at(-2) ?? ''] : [name, name.replace(/Service$/, '')];
    const owners = [...new Set(candidates)].filter(candidate => services.has(candidate));
    if (owners.length !== 1) continue;
    for (const field of source.properties(handlers.start)) {
      const target = source.propertyTarget(field);
      if (target) yield { owner: owners[0]!, member: field.key, target, evidence: 'add-service' };
    }
  }
  for (const annotation of source.annotations()) {
    if (annotation.name !== 'GrpcMethod') continue;
    const owner = source.literal(annotation.args[0] ?? -1);
    const target = source.declaration(annotation.after, callable);
    if (!owner || !target) continue;
    const member = annotation.args.length > 1 ? source.literal(annotation.args[1]!) : target.name;
    if (member) yield { owner, member, target, evidence: 'grpc-method-decorator' };
  }
}

function goScope(source: BindingSource): string | undefined {
  const keyword = source.marks('package').next().value;
  const name = keyword === undefined ? undefined : source.id(source.next(keyword));
  return name ? `${posix.dirname(source.file)}:${name}` : undefined;
}

function goLiteralType(source: BindingSource, start: number, stop?: number): string | undefined {
  const base = source.text(start) === '&' ? source.next(start) : start;
  const name = source.id(base);
  const open = source.next(base);
  const close = source.end(open);
  if (!name || source.text(open) !== '{' || close === undefined) return undefined;
  const after = source.next(close);
  const complete = stop !== undefined ? after === stop
    : source.line(after) !== source.line(close) || [';', '}'].includes(source.text(after));
  return complete ? name : undefined;
}

function* goImplementations(source: BindingSource, scope: string): IterableIterator<Implementation> {
  for (const index of source.marks('struct')) {
    const open = source.next(index);
    const close = source.end(open);
    const type = source.id(index - 1);
    if (!type || source.text(index - 2) !== 'type' || source.text(open) !== '{' || close === undefined) continue;
    for (let field = source.next(open); field < close; field = source.next(source.end(field) ?? field)) {
      if (field !== open + 1 && source.line(field) === source.line(field - 1) && source.text(field - 1) !== ';') continue;
      const base = source.qualified(source.text(field) === '*' ? source.next(field) : field);
      const name = base.parts.at(-1);
      if (!name || (base.next !== close && source.text(base.next) !== ';' && source.line(base.next) === source.line(base.next - 1))) continue;
      const service = /^(?:Unimplemented)?([A-Z]\w*)Server$/.exec(name)?.[1];
      if (service) yield { scope, type, service, evidence: 'go-server-embedding' };
    }
  }

  for (let index = 0; index < source.length; index++) {
    const marker = source.id(index);
    const service = marker && /^Register([A-Z]\w*)Server$/.exec(marker)?.[1];
    const open = source.next(index);
    if (!service || source.text(open) !== '(' || source.text(index - 1) === 'func') continue;
    const arg = [...source.items(open)][1];
    if (!arg) continue;
    let type = goLiteralType(source, arg.start, arg.stop);
    if (!type && source.next(arg.start) === arg.stop) {
      const name = source.id(arg.start);
      const assignments: string[] = [];
      if (!name) continue;
      // Only consider an unambiguous initialization in the same block.
      for (const binding of source.marks(name)) {
        if (binding >= index || source.text(binding - 1) === '.' ||
            source.braceScope(binding) !== source.braceScope(index)) continue;
        const assignment = source.next(binding);
        if (![':=', '='].includes(source.text(assignment))) continue;
        assignments.push(goLiteralType(source, source.next(assignment)) ?? '');
      }
      if (assignments.length === 1) type = assignments[0];
    }
    if (type) yield { scope, type, service, evidence: 'go-server-registration' };
  }
}

function* classImplementations(source: BindingSource, python: boolean): IterableIterator<Implementation> {
  for (const index of source.marks('class')) {
    const type = source.id(source.next(index));
    const header = source.next(source.next(index));
    if (!type) continue;
    if (python && source.text(header) === '(') {
      for (const base of source.items(header)) {
        const qualified = source.qualified(base.start);
        if (qualified.next !== base.stop) continue;
        const service = /^([A-Z]\w*)Servicer$/.exec(qualified.parts.at(-1) ?? '')?.[1];
        if (service) yield { scope: source.file, type, service, evidence: 'python-servicer-base' };
      }
    } else if (!python && source.text(header) === 'extends') {
      const base = source.qualified(source.next(header)).parts;
      const service = /^([A-Z]\w*)ImplBase$/.exec(base.at(-1) ?? '')?.[1];
      if (service) yield { scope: source.file, type, service, evidence: 'java-service-base' };
    }
  }
  if (!python) return;
  for (let index = 0; index < source.length; index++) {
    const marker = source.id(index);
    const service = marker && /^add_([A-Z]\w*)Servicer_to_server$/.exec(marker)?.[1];
    const open = source.next(index);
    if (!service || source.text(open) !== '(') continue;
    const arg = source.items(open).next().value;
    if (!arg) continue;
    const construct = (start: number, stop?: number): string | undefined => {
      const name = source.id(start);
      const open = source.next(start);
      const close = source.end(open);
      if (!name || source.text(open) !== '(' || close === undefined) return undefined;
      const after = source.next(close);
      const complete = stop !== undefined ? after === stop
        : source.line(after) !== source.line(close) || source.text(after) === ';';
      return complete ? name : undefined;
    };
    const variable = source.id(arg.start);
    let type = construct(arg.start, arg.stop);
    if (!type && variable && source.next(arg.start) === arg.stop) {
      const assignments = [...source.marks(variable)].filter(binding =>
        binding < index && source.line(binding - 1) !== source.line(binding) && source.text(source.next(binding)) === '=' &&
        source.pythonScope(binding) === source.pythonScope(index));
      if (assignments.length === 1) type = construct(source.next(source.next(assignments[0]!)));
    }
    if (type) yield { scope: source.file, type, service, evidence: 'python-servicer-registration' };
  }
}

export async function grpcServiceEdges(
  ctx: SchemaBindingContext, files: readonly string[], yieldToLoop: MaybeYield,
): Promise<Edge[]> {
  const schemaFiles = files.filter(file => /\.proto$/i.test(file));
  if (schemaFiles.length === 0) return [];
  const declarations = schemaFiles.flatMap(file => ctx.getNodesInFile(file));
  const serviceGroups = groupBy(declarations.filter(node => node.kind === 'interface' &&
    /^service\s/.test(node.signature ?? '')), node => node.name);
  const services = new Set([...serviceGroups].filter(([, nodes]) => nodes.length === 1).map(([name]) => name));
  const rpcMethods = groupBy(declarations.filter(node => node.kind === 'method' &&
    /^rpc\s/.test(node.signature ?? '')), node => node.qualifiedName);
  if (rpcMethods.size === 0) return [];
  const edges: Edge[] = [];
  const addBinding = (binding: Binding) => {
    if (!services.has(binding.owner)) return;
    const service = serviceGroups.get(binding.owner)![0]!;
    const pascal = binding.member.charAt(0).toUpperCase() + binding.member.slice(1);
    const matches = [...new Set([binding.member, pascal])].flatMap(name =>
      rpcMethods.get(`${service.qualifiedName}.${name}`) ?? []);
    if (matches.length === 1) edges.push(schemaEdge(matches[0]!, binding, GRPC_SYNTHESIS));
  };

  const implementations: Implementation[] = [];
  const handlers: Handler[] = [];
  for (const file of files) {
    const js = JS_SOURCE.test(file);
    const go = /\.go$/i.test(file);
    const python = /\.py$/i.test(file);
    if (!js && !go && !python && !/\.java$/i.test(file)) continue;
    await yieldToLoop();
    const content = localSource(ctx, file);
    if (!content || (js && !/\b(?:addService|GrpcMethod)\b/.test(content)) ||
        (python && !/Servicer\b|Servicer_to_server\b/.test(content)) ||
        (!js && !go && !python && !/ImplBase\b/.test(content))) continue;
    const source = new BindingSource(ctx, file, content);
    if (js) {
      for (const binding of jsBindings(source, services)) addBinding(binding);
      continue;
    }

    const scope = go ? goScope(source) : file;
    if (!scope) continue;
    const bindings = go ? goImplementations(source, scope) : classImplementations(source, python);
    for (const binding of bindings) if (services.has(binding.service)) implementations.push(binding);
    for (const target of source.nodes) {
      const type = ownerName(target);
      if (target.kind === 'method' && type) handlers.push({ scope, type, target });
    }
  }

  const byType = groupBy(handlers, handler => `${handler.scope}:${handler.type}`);
  for (const impl of implementations) {
    for (const { target } of byType.get(`${impl.scope}:${impl.type}`) ?? []) {
      addBinding({ owner: impl.service, member: target.name, target, evidence: impl.evidence });
    }
  }
  return edges;
}
