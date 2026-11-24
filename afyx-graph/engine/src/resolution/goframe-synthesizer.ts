import type { Edge, Node } from '../types';
import type { ResolutionContext } from './types';
import type { MaybeYield } from './cooperative-yield';
import { GOFRAME_ROUTE_MARKER } from './frameworks/goframe';

const MAX_SYNTHESIZED_EDGES = 2000;
const POINTER_TYPE_PATTERN = /\*\s*(?:(\w+)\.)?([A-Z]\w*)\b/g;
const ADDON_SEGMENT_PATTERN = /(?:^|\/)addons\/([^/]+)\//;
const CONTROLLER_DIR_PATTERN = /\/controllers?\//;

function extractPointerParams(signature: string): string[] {
  const matches: string[] = [];
  POINTER_TYPE_PATTERN.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = POINTER_TYPE_PATTERN.exec(signature)) !== null) {
    const pkg = hit[1];
    const typeName = hit[2]!;
    if (pkg) matches.push(`${pkg}.${typeName}`);
    matches.push(typeName);
  }
  return matches;
}

function extractAddonNamespace(filePath: string): string {
  return ADDON_SEGMENT_PATTERN.exec(filePath)?.[1] ?? '';
}

function resolveUniqueHandler(candidates: readonly Node[], routeFilePath: string): Node | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const controllerScoped = candidates.filter((node) => CONTROLLER_DIR_PATTERN.test(node.filePath));
  const pool = controllerScoped.length > 0 ? controllerScoped : candidates;
  if (pool.length === 1) return pool[0]!;

  const routeAddon = extractAddonNamespace(routeFilePath);
  const namespaceMatched = pool.filter((node) => extractAddonNamespace(node.filePath) === routeAddon);
  return namespaceMatched.length === 1 ? namespaceMatched[0]! : null;
}

function appendBucket<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    map.set(key, [value]);
  }
}

export async function goframeRouteEdges(ctx: ResolutionContext, onYield: MaybeYield): Promise<Edge[]> {
  let ops = 0;
  const routesByKey = new Map<string, Node[]>();
  const lookupKeys = new Set<string>();

  const routeIter = ctx.iterateNodesByKind?.('route') ?? ctx.getNodesByKind('route');
  for (const route of routeIter) {
    if ((++ops & 63) === 0) await onYield();
    if (route.language !== 'go') continue;

    const markerPos = route.qualifiedName.indexOf(GOFRAME_ROUTE_MARKER);
    if (markerPos < 0) continue;

    const joinKey = route.qualifiedName.slice(markerPos + GOFRAME_ROUTE_MARKER.length);
    if (!joinKey) continue;

    appendBucket(routesByKey, joinKey, route);
    lookupKeys.add(joinKey);
    const dotPos = joinKey.lastIndexOf('.');
    if (dotPos >= 0) {
      lookupKeys.add(joinKey.slice(dotPos + 1));
    }
  }

  if (routesByKey.size === 0) return [];

  const handlersByKey = new Map<string, Node[]>();
  const methodIter = ctx.iterateNodesByKind?.('method') ?? ctx.getNodesByKind('method');
  for (const method of methodIter) {
    if ((++ops & 63) === 0) await onYield();
    if (method.language !== 'go' || !method.signature) continue;

    for (const typeKey of extractPointerParams(method.signature)) {
      if (lookupKeys.has(typeKey)) {
        appendBucket(handlersByKey, typeKey, method);
      }
    }
  }

  const edges: Edge[] = [];
  const emittedPairs = new Set<string>();

  for (const [joinKey, routes] of routesByKey) {
    const dotPos = joinKey.lastIndexOf('.');
    const bareType = dotPos >= 0 ? joinKey.slice(dotPos + 1) : joinKey;
    const candidates = handlersByKey.get(joinKey) ?? handlersByKey.get(bareType);
    if (!candidates || candidates.length === 0) continue;

    for (const route of routes) {
      if (edges.length >= MAX_SYNTHESIZED_EDGES) return edges;
      const handler = resolveUniqueHandler(candidates, route.filePath);
      if (!handler || route.id === handler.id) continue;

      const edgeKey = `${route.id}->${handler.id}`;
      if (emittedPairs.has(edgeKey)) continue;
      emittedPairs.add(edgeKey);

      edges.push({
        source: route.id,
        target: handler.id,
        kind: 'calls',
        line: route.startLine,
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'goframe-route',
          route: route.name,
          requestType: bareType,
          registeredAt: `${handler.filePath}:${handler.startLine}`,
        },
      });
    }
  }

  return edges;
}
