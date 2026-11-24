import type AfyxGraph from '../../index';
import type { Edge, Node } from '../../types';

export interface RouteRoot {
  node: Node;
  inline: boolean;
}

const VALID_HANDLER_KINDS = new Set<Node['kind']>([
  'function',
  'method',
  'class',
  'component',
  'constant',
  'variable',
]);

const JS_TS_LANGUAGES = new Set<string>(['javascript', 'typescript', 'tsx', 'jsx']);

export function looksLikeComponent(node: Node): boolean {
  if (node.kind === 'component') return true;
  if (node.kind !== 'function') return false;
  return JS_TS_LANGUAGES.has(node.language) && /^[A-Z]/.test(node.name);
}

function handlerPriority(kind: Node['kind']): number {
  switch (kind) {
    case 'function':
    case 'method':
      return 0;
    case 'component':
      return 1;
    case 'class':
      return 2;
    default:
      return 3;
  }
}

function findNamedHandler(
  edges: readonly Edge[],
  targets: ReadonlyMap<string, Node>,
  routeId: string,
): Node | null {
  const matches: Node[] = [];
  for (const edge of edges) {
    if (edge.kind !== 'references') continue;
    const target = targets.get(edge.target);
    if (target && target.id !== routeId && VALID_HANDLER_KINDS.has(target.kind)) {
      matches.push(target);
    }
  }
  matches.sort((a, b) => handlerPriority(a.kind) - handlerPriority(b.kind) || a.startLine - b.startLine);
  return matches[0] ?? null;
}

function findRenderedComponent(
  edges: readonly Edge[],
  targets: ReadonlyMap<string, Node>,
  routeId: string,
): Node | null {
  const components: Node[] = [];
  for (const edge of edges) {
    if (edge.kind !== 'calls' && edge.kind !== 'instantiates') continue;
    const target = targets.get(edge.target);
    if (target && target.id !== routeId && looksLikeComponent(target)) {
      components.push(target);
    }
  }
  components.sort((a, b) => a.startLine - b.startLine);
  return components[0] ?? null;
}

export function routeRoots(cg: AfyxGraph, routes: readonly Node[]): Map<string, RouteRoot> {
  const resolved = new Map<string, RouteRoot>();
  if (routes.length === 0) return resolved;

  const edges = cg.getOutgoingEdgesFrom(
    routes.map((route) => route.id),
    ['references', 'calls', 'instantiates'],
  );
  if (edges.length === 0) return resolved;

  const targets = cg.getNodesByIds(edges.map((edge) => edge.target));
  const edgesByRoute = new Map<string, Edge[]>();
  for (const edge of edges) {
    const group = edgesByRoute.get(edge.source);
    if (group) group.push(edge);
    else edgesByRoute.set(edge.source, [edge]);
  }

  for (const route of routes) {
    const outgoing = edgesByRoute.get(route.id);
    if (!outgoing || outgoing.length === 0) continue;

    const named = findNamedHandler(outgoing, targets, route.id);
    if (named) {
      resolved.set(route.id, { node: named, inline: false });
      continue;
    }

    const component = findRenderedComponent(outgoing, targets, route.id);
    if (component) {
      resolved.set(route.id, { node: component, inline: false });
      continue;
    }

    const hasInlineCall = outgoing.some(
      (edge) => edge.kind === 'calls' && targets.get(edge.target)?.kind !== 'file',
    );
    if (hasInlineCall) {
      resolved.set(route.id, { node: route, inline: true });
    }
  }

  return resolved;
}
