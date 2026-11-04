/**
 * Deterministic in-memory store for the graph contract.
 *
 * Implements exactly the query surface the graph core consumes, with fully specified
 * ordering (adjacency in insertion order, fresh edge objects per call, unknown ids
 * simply absent), so what the recorded results characterize is the graph logic.
 */
import type { Edge, EdgeKind, Node, NodeKind } from '../../src/types';
import type { QueryBuilder } from '../../src/db/queries';

export interface World {
  nodes: Node[];
  edges: Edge[];
}

export class GraphWorld {
  readonly nodes: Node[] = [];
  readonly edges: Edge[] = [];

  /** Node whose id is its name, so recorded results read naturally. */
  node(kind: NodeKind, name: string, filePath = 'src/main.ts', extra: Partial<Node> = {}): Node {
    const node: Node = {
      id: name, kind, name, qualifiedName: `${filePath}::${name}`, filePath, language: 'typescript',
      startLine: this.nodes.length + 1, endLine: this.nodes.length + 2, startColumn: 0, endColumn: 1, ...extra,
    };
    this.nodes.push(node);
    return node;
  }

  edge(source: string, target: string, kind: EdgeKind, line?: number, column?: number): void {
    this.edges.push({ source, target, kind, ...(line !== undefined ? { line } : {}), ...(column !== undefined ? { column } : {}) });
  }

  world(): World {
    return { nodes: this.nodes, edges: this.edges };
  }
}

export function createFakeStore(world: World): QueryBuilder {
  const byId = new Map(world.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  for (const edge of world.edges) {
    (outgoing.get(edge.source) ?? outgoing.set(edge.source, []).get(edge.source)!).push(edge);
    (incoming.get(edge.target) ?? incoming.set(edge.target, []).get(edge.target)!).push(edge);
  }
  const pick = (list: Edge[] | undefined, kinds?: EdgeKind[]): Edge[] =>
    (list ?? []).filter((edge) => !kinds || kinds.length === 0 || kinds.includes(edge.kind)).map((edge) => ({ ...edge }));
  const fileOf = (id: string): string | undefined => byId.get(id)?.filePath;

  const store = {
    getNodeById: (id: string): Node | null => byId.get(id) ?? null,
    getNodesByIds: (ids: string[]): Map<string, Node> => {
      const found = new Map<string, Node>();
      for (const id of ids) {
        const node = byId.get(id);
        if (node) found.set(id, node);
      }
      return found;
    },
    getOutgoingEdges: (id: string, kinds?: EdgeKind[]): Edge[] => pick(outgoing.get(id), kinds),
    getIncomingEdges: (id: string, kinds?: EdgeKind[]): Edge[] => pick(incoming.get(id), kinds),
    getNodesByFile: (filePath: string): Node[] => world.nodes.filter((node) => node.filePath === filePath),
    getNodesByKind: (kind: NodeKind): Node[] => world.nodes.filter((node) => node.kind === kind),
    getAllFiles: (): Array<{ path: string }> => [...new Set(world.nodes.map((node) => node.filePath))].map((path) => ({ path })),
    /** Files this file's symbols point at through resolved cross-file edges, first seen first. */
    getDependencyFilePaths: (filePath: string): string[] => {
      const files: string[] = [];
      for (const edge of world.edges) {
        if (edge.kind === 'contains') continue;
        const from = fileOf(edge.source);
        const to = fileOf(edge.target);
        if (from === filePath && to && to !== filePath && !files.includes(to)) files.push(to);
      }
      return files;
    },
    getDependentFilePaths: (filePath: string): string[] => {
      const files: string[] = [];
      for (const edge of world.edges) {
        if (edge.kind === 'contains') continue;
        const from = fileOf(edge.source);
        const to = fileOf(edge.target);
        if (to === filePath && from && from !== filePath && !files.includes(from)) files.push(from);
      }
      return files;
    },
  };
  return store as unknown as QueryBuilder;
}
