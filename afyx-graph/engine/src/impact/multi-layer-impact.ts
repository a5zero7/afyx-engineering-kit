/**
 * AFYX Multi-Layer Cross-Domain Impact Analysis Engine
 *
 * Implements Track C Wave 3B C7 (AFYX-229, AFYX-230, AFYX-231):
 * - C7.1 (AFYX-229): Transitive symbol blast radius across polyglot languages & domains
 * - C7.2 (AFYX-230): Cross-domain impact: Source ↔ Build ↔ Container ↔ CI/CD ↔ DB ↔ API
 * - C7.3 (AFYX-231): Framework-specific navigation & cross-repo boundary propagation
 */

import type { Edge, Node } from '../types';

export interface MultiLayerImpactHost {
  getNode(id: string): Node | undefined;
  getIncomingEdges(nodeId: string): Edge[];
  getOutgoingEdges(nodeId: string): Edge[];
  getAllNodes?(): Iterable<Node>;
}

export interface MultiLayerImpactOptions {
  startNodeId?: string;
  startFilePath?: string;
  maxDepth?: number;
  traverseIncoming?: boolean;
  traverseOutgoing?: boolean;
}

export interface MultiLayerImpactResult {
  rootIds: string[];
  blastRadius: {
    symbols: Node[];
    files: string[];
    depths: Map<string, number>;
  };
  crossDomainImpact: {
    buildTargets: Node[];
    containers: Node[];
    cicdWorkflows: Node[];
    databaseSchemas: Node[];
    apiEndpoints: Node[];
  };
  frameworkImpact: {
    routes: Node[];
    navigationDestinations: Node[];
    crossRepoReferences: string[];
  };
  traversedEdges: Edge[];
  totalImpactedCount: number;
}

const BUILD_EXTENSIONS = new Set(['pom.xml', 'build.gradle', 'package.json', 'makefile', 'cmakelists.txt', '.csproj']);
const CONTAINER_EXTENSIONS = new Set(['dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']);
const CICD_KEYWORDS = ['.github/workflows/', '.gitlab-ci', 'jenkinsfile', 'azure-pipelines'];

export function computeMultiLayerImpact(
  host: MultiLayerImpactHost,
  options: MultiLayerImpactOptions = {}
): MultiLayerImpactResult {
  const maxDepth = options.maxDepth ?? 10;
  const traverseIncoming = options.traverseIncoming ?? true;
  const traverseOutgoing = options.traverseOutgoing ?? true;

  const rootIds: string[] = [];
  if (options.startNodeId) {
    rootIds.push(options.startNodeId);
  }

  const visitedNodeIds = new Set<string>();
  const depths = new Map<string, number>();
  const traversedEdges: Edge[] = [];
  const edgeKeys = new Set<string>();

  const impactedSymbols = new Map<string, Node>();
  const impactedFiles = new Set<string>();

  const buildTargets = new Map<string, Node>();
  const containers = new Map<string, Node>();
  const cicdWorkflows = new Map<string, Node>();
  const databaseSchemas = new Map<string, Node>();
  const apiEndpoints = new Map<string, Node>();
  const routes = new Map<string, Node>();
  const navigationDestinations = new Map<string, Node>();
  const crossRepoReferences = new Set<string>();

  const queue: Array<{ id: string; depth: number }> = [];

  for (const rootId of rootIds) {
    visitedNodeIds.add(rootId);
    depths.set(rootId, 0);
    queue.push({ id: rootId, depth: 0 });
    const rootNode = host.getNode(rootId);
    if (rootNode) {
      impactedSymbols.set(rootId, rootNode);
      impactedFiles.add(rootNode.filePath);
    }
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const node = host.getNode(id);
    if (!node) continue;

    const edgesToTraverse: Edge[] = [];
    if (traverseIncoming) {
      edgesToTraverse.push(...host.getIncomingEdges(id));
    }
    if (traverseOutgoing) {
      edgesToTraverse.push(...host.getOutgoingEdges(id));
    }

    for (const edge of edgesToTraverse) {
      const neighborId = edge.source === id ? edge.target : edge.source;
      const key = `${edge.source}->${edge.target}:${edge.kind}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        traversedEdges.push(edge);
      }

      if (!visitedNodeIds.has(neighborId)) {
        visitedNodeIds.add(neighborId);
        depths.set(neighborId, depth + 1);
        queue.push({ id: neighborId, depth: depth + 1 });

        const neighborNode = host.getNode(neighborId);
        if (neighborNode) {
          impactedSymbols.set(neighborId, neighborNode);
          impactedFiles.add(neighborNode.filePath);

          const fp = neighborNode.filePath.toLowerCase().replace(/\\/g, '/');
          const base = fp.split('/').pop() || '';

          // Classify Cross-Domain Impact
          if (BUILD_EXTENSIONS.has(base) || base.endsWith('.csproj') || base.endsWith('.gradle')) {
            buildTargets.set(neighborId, neighborNode);
          }
          if (CONTAINER_EXTENSIONS.has(base) || base.startsWith('dockerfile')) {
            containers.set(neighborId, neighborNode);
          }
          if (CICD_KEYWORDS.some(kw => fp.includes(kw))) {
            cicdWorkflows.set(neighborId, neighborNode);
          }
          if (fp.includes('schema') || fp.includes('migration') || fp.endsWith('.sql') || fp.endsWith('.proto') || fp.endsWith('.avsc')) {
            databaseSchemas.set(neighborId, neighborNode);
          }
          if (neighborNode.kind === 'route' || fp.includes('api/') || fp.includes('routes/')) {
            apiEndpoints.set(neighborId, neighborNode);
          }

          // Classify Framework & Navigation Impact
          if (neighborNode.kind === 'route') {
            routes.set(neighborId, neighborNode);
          }
          if (edge.kind === 'references' && edge.metadata && (edge.metadata as any).framework) {
            navigationDestinations.set(neighborId, neighborNode);
          }
          if (neighborNode.qualifiedName?.includes('::external::') || fp.startsWith('../')) {
            crossRepoReferences.add(neighborNode.qualifiedName || fp);
          }
        }
      }
    }
  }

  return {
    rootIds,
    blastRadius: {
      symbols: Array.from(impactedSymbols.values()),
      files: Array.from(impactedFiles),
      depths,
    },
    crossDomainImpact: {
      buildTargets: Array.from(buildTargets.values()),
      containers: Array.from(containers.values()),
      cicdWorkflows: Array.from(cicdWorkflows.values()),
      databaseSchemas: Array.from(databaseSchemas.values()),
      apiEndpoints: Array.from(apiEndpoints.values()),
    },
    frameworkImpact: {
      routes: Array.from(routes.values()),
      navigationDestinations: Array.from(navigationDestinations.values()),
      crossRepoReferences: Array.from(crossRepoReferences),
    },
    traversedEdges,
    totalImpactedCount: visitedNodeIds.size,
  };
}
