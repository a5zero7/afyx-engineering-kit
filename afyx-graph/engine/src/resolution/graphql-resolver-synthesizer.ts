/** Copyright (c) 2026 Afyx */
import { polyglotGraphql, rubyGraphql, lighthouseGraphql } from './polyglot-schema-bindings';
import { isGraphQLFile } from '../extraction/graphql-extractor';
import type { Edge, Node } from '../types';
import type { MaybeYield } from './cooperative-yield';
import {
  BindingSource, JS_SOURCE, callable, groupBy, localSource, ownerName, schemaEdge,
  type Binding, type SchemaBindingContext,
} from './schema-binding-source';

export const GRAPHQL_SYNTHESIS = 'graphql-resolver';
const ROOT_TYPES = new Map([['Query', 'Query'], ['Mutation', 'Mutation'], ['Subscription', 'Subscription']]);
const GO_RECEIVERS = new Map([
  ['queryResolver', 'Query'], ['mutationResolver', 'Mutation'], ['subscriptionResolver', 'Subscription'],
]);

function decoratorName(source: BindingSource, args: number[]): string | undefined {
  for (const arg of args) {
    const literal = source.literal(arg);
    if (literal) return literal;
    for (const property of source.properties(arg)) {
      if (property.key === 'name' && source.next(property.value) === property.stop) {
        return source.literal(property.value);
      }
    }
  }
  return undefined;
}

function resolverType(source: BindingSource, arg: number): string | undefined {
  const literal = source.literal(arg);
  if (literal) return literal;
  const end = source.end(arg);
  if (source.text(arg) !== '(' || end === undefined || source.next(arg) !== end) return undefined;
  const arrow = source.next(end);
  return source.text(arrow) === '=>' ? source.qualified(source.next(arrow)).parts.at(-1) : undefined;
}

function* jsBindings(source: BindingSource): IterableIterator<Binding> {
  for (const index of source.marks('resolvers')) {
    let equals = source.next(index);
    if (source.text(equals) === ':') {
      for (equals = source.next(equals); equals < source.length && source.line(equals) === source.line(index); equals = source.next(equals)) {
        if (['=', ';', ',', '{'].includes(source.text(equals))) break;
      }
    }
    if (source.text(equals) !== '=' || !source.nodeAt(index, node => node.kind === 'constant' || node.kind === 'variable')) continue;
    for (const parent of source.properties(source.next(equals))) {
      for (const field of source.properties(parent.value)) {
        const target = source.propertyTarget(field);
        if (target) yield { owner: parent.key, member: field.key, target, evidence: 'resolver-map' };
      }
    }
  }

  const annotations = [...source.annotations()];
  const resolverClasses = new Map<string, Array<{ node: Node; owner: string }>>();
  for (const annotation of annotations) {
    if (annotation.name !== 'Resolver' || annotation.args[0] === undefined) continue;
    const node = source.declaration(annotation.after, candidate => candidate.kind === 'class');
    const owner = resolverType(source, annotation.args[0]);
    if (node && owner) {
      const classes = resolverClasses.get(node.name) ?? [];
      classes.push({ node, owner });
      resolverClasses.set(node.name, classes);
    }
  }
  for (const annotation of annotations) {
    if (!ROOT_TYPES.has(annotation.name) && annotation.name !== 'ResolveField') continue;
    const target = source.declaration(annotation.after, callable);
    if (!target) continue;
    const parents = (resolverClasses.get(ownerName(target) ?? '') ?? []).filter(({ node }) =>
      target.startLine >= node.startLine && target.endLine <= node.endLine);
    const owner = annotation.name === 'ResolveField'
      ? (parents.length === 1 ? parents[0]?.owner : undefined) : ROOT_TYPES.get(annotation.name);
    if (owner) yield {
      owner, member: decoratorName(source, annotation.args) ?? target.name,
      target, evidence: 'resolver-decorator',
    };
  }
}

function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function* pythonBindings(source: BindingSource): IterableIterator<Binding> {
  for (const annotation of source.annotations()) {
    const [receiver, decorator] = annotation.name.split('.');
    const match = /^(query|mutation|subscription)\.field$/.exec(annotation.name);
    if (!match && !/^strawberry\.(field|mutation|subscription)$/.test(annotation.name)) continue;
    const target = source.declaration(annotation.after, callable);
    if (!target) continue;
    const owner = match
      ? match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1)
      : ROOT_TYPES.get(ownerName(target) ?? '');
    if (!owner || (receiver === 'strawberry' && decorator !== 'field' && owner.toLowerCase() !== decorator)) continue;
    const explicit = decoratorName(source, annotation.args);
    const namedArg = annotation.args.find(arg => source.id(arg) === 'name' && source.text(source.next(arg)) === '=');
    const member = explicit ?? (namedArg === undefined ? (match ? undefined : camel(target.name))
      : source.literal(source.next(source.next(namedArg))));
    if (member) yield { owner, member, target, evidence: match ? 'python-field-binding' : 'strawberry-field' };
  }
}

function* goBindings(source: BindingSource): IterableIterator<Binding> {
  for (const target of source.nodes) {
    if (target.kind !== 'method') continue;
    const owner = GO_RECEIVERS.get(ownerName(target) ?? '');
    if (owner) yield {
      owner, member: target.name.charAt(0).toLowerCase() + target.name.slice(1),
      target, evidence: 'gqlgen-receiver',
    };
  }
}

export async function graphqlResolverEdges(
  ctx: SchemaBindingContext, files: readonly string[], yieldToLoop: MaybeYield,
): Promise<Edge[]> {
  const schemaFiles = files.filter(isGraphQLFile);
  if (schemaFiles.length === 0) return [];
  const fields = groupBy(schemaFiles.flatMap(file => {
    const nodes = ctx.getNodesInFile(file);
    const owners = new Set(nodes.filter(node => node.kind === 'class' && /^(?:extend\s+)?type\s/.test(node.signature ?? ''))
      .map(node => node.qualifiedName));
    return nodes.filter(node => node.kind === 'property' && owners.has(node.qualifiedName.slice(0, node.qualifiedName.lastIndexOf('.'))));
  }), node => node.qualifiedName.slice(node.qualifiedName.lastIndexOf('#') + 1));
  if (fields.size === 0) return [];

  const edges: Edge[] = [];
  for (const file of schemaFiles) {
    const content = localSource(ctx, file);
    if (content?.includes('@field')) edges.push(...lighthouseGraphql(new BindingSource(ctx, file, content)));
  }
  for (const file of files) {
    const js = JS_SOURCE.test(file);
    const python = /\.py$/i.test(file);
    const go = /\.go$/i.test(file);
    const polyglot = /\.(?:cs|rs|rb)$/.test(file);
    if (!js && !python && !go && !polyglot) continue;
    await yieldToLoop();
    const content = localSource(ctx, file);
    const marker = js ? /\bresolvers\b|@\s*(?:Query|Mutation|Subscription|ResolveField)\b/
      : python ? /@\s*(?:query|mutation|subscription|strawberry)\s*\./ : /\b(?:query|mutation|subscription)Resolver\b/;
    if (!content || !(polyglot ? /Object|Subscription|QueryType|MutationType|resolver:/.test(content) : marker.test(content))) continue;
    const source = new BindingSource(ctx, file, content);
    const bindings = js ? jsBindings(source) : python ? pythonBindings(source) : go ? goBindings(source)
      : file.endsWith('.rb') ? rubyGraphql(source) : polyglotGraphql(source);
    for (const binding of bindings) {
      const matches = fields.get(`${binding.owner}.${binding.member}`);
      if (matches?.length === 1) edges.push(schemaEdge(matches[0]!, binding, GRAPHQL_SYNTHESIS));
    }
  }
  return edges;
}
