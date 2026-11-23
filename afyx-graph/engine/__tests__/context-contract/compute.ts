import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AfyxGraph from '../../src';
import {
  ContextBuilder, formatContextAsMarkdown, formatContextAsJson, LOW_CONFIDENCE_MARKER,
} from '../../src/context';
import { formatSubgraphTree, formatBytes } from '../../src/context/formatter';
import type { Node, Edge, Subgraph, TaskContext, CodeBlock } from '../../src/types';
import { createFakeBackend } from './fake-graph';
import { WORLDS, OPTION_VARIANTS, queriesFor, writeProject } from './worlds';

const digest = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `${text.length}:${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
};

const edgeKey = (edge: Edge): string => `${edge.source}>${edge.target}:${edge.kind}`;

function summarizeSubgraph(subgraph: Subgraph): Record<string, unknown> {
  return {
    roots: subgraph.roots,
    nodes: [...subgraph.nodes.keys()],
    edges: subgraph.edges.map(edgeKey),
    confidence: subgraph.confidence ?? null,
  };
}

function hashedSubgraph(subgraph: Subgraph): string {
  return digest([subgraph.roots, [...subgraph.nodes.keys()], subgraph.edges.map(edgeKey), subgraph.confidence ?? null]);
}

function summarizeContext(context: TaskContext): Record<string, unknown> {
  return {
    query: context.query,
    summary: context.summary,
    entryPoints: context.entryPoints.map((node) => node.id),
    nodes: [...context.subgraph.nodes.keys()],
    codeBlocks: context.codeBlocks.map((block: CodeBlock) => [block.node?.id ?? null, block.filePath, block.startLine, block.endLine, block.language, digest(block.content)]),
    relatedFiles: context.relatedFiles,
    stats: context.stats,
  };
}

const labelOf = (node: Node): string => `${node.kind}:${node.name}@${node.filePath}:${node.startLine}`;

async function fakeBackedWorlds(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-context-contract-'));
  try {
    for (const [name, make] of Object.entries(WORLDS)) {
      const world = make();
      // Files that must not resolve: one never written, one escaping the project root.
      const root = path.join(scratch, name);
      writeProject({ ...world, nodes: world.nodes.filter((node) => !node.filePath.startsWith('missing/') && !node.filePath.startsWith('..')) }, root);
      const { queries, traverser } = createFakeBackend(world);
      const builder = new ContextBuilder(root, queries, traverser);

      const records: unknown[] = [];
      for (const query of queriesFor(name)) {
        const subgraph = await builder.findRelevantContext(query);
        const record: Record<string, unknown> = { query, default: summarizeSubgraph(subgraph) };

        const variants: Record<string, string> = {};
        for (const variant of OPTION_VARIANTS) {
          variants[variant.name] = hashedSubgraph(await builder.findRelevantContext(query, variant.options));
        }
        record.variants = variants;

        const context = await builder.buildContext(query, { format: undefined as never }) as TaskContext;
        record.context = summarizeContext(context);
        const markdown = await builder.buildContext(query, { format: 'markdown' }) as string;
        const json = await builder.buildContext(query, { format: 'json' }) as string;
        const noCode = await builder.buildContext(query, { format: 'markdown', includeCode: false }) as string;
        const deep = await builder.buildContext(query, { format: 'markdown', traversalDepth: 8, maxNodes: 50, searchLimit: 3 }) as string;
        const tight = await builder.buildContext(query, { format: 'markdown', maxNodes: 5, maxCodeBlocks: 2, maxCodeBlockSize: 120, searchLimit: 2, traversalDepth: 2 }) as string;
        const titled = await builder.buildContext({ title: query, description: 'with a description' }, { format: 'json' }) as string;
        record.rendered = {
          markdown: digest(markdown), json: digest(json), noCode: digest(noCode), tight: digest(tight), deep: digest(deep), titled: digest(titled),
          lowConfidence: markdown.includes(LOW_CONFIDENCE_MARKER),
          callPaths: markdown.includes('## Call paths'),
          codeBlocks: (markdown.match(/^```/gm) ?? []).length / 2,
        };
        records.push(record);
      }

      const code: Record<string, string | null> = {};
      for (const node of world.nodes) code[node.id] = ((await builder.getCode(node.id)) ?? null) === null ? null : digest((await builder.getCode(node.id)) as string);
      code['missing-id'] = (await builder.getCode('does-not-exist')) === null ? null : 'unexpected';

      // Score oracle: stepping minScore through the score range reveals every entry point's final
      // score as the threshold at which it drops out. A candidate whose score equals a threshold
      // exactly is included at it and excluded just above it, so boundary handling and any change
      // in a scoring weight are both visible. The number of entry points only shrinks as minScore
      // grows, so the k-th entry point's threshold is found by bisection on a quarter-point grid.
      const sweep: Record<string, Array<number | null>> = {};
      const GRID = 4;
      const rootsAt = async (query: string, quarter: number, searchLimit: number): Promise<number> =>
        (await builder.findRelevantContext(query, { minScore: quarter / GRID, searchLimit })).roots.length;
      for (const query of queriesFor(name).filter((text) => text.trim())) {
        for (const searchLimit of [3, 8]) {
          const thresholds: Array<number | null> = [];
          const present = await rootsAt(query, 0, searchLimit);
          for (let k = 1; k <= present; k++) {
            let low = 0;
            let high = 120 * GRID;
            while (low < high) {
              const middle = Math.ceil((low + high) / 2);
              if ((await rootsAt(query, middle, searchLimit)) >= k) low = middle;
              else high = middle - 1;
            }
            thresholds.push(low / GRID);
          }
          sweep[`${query}#${searchLimit}`] = thresholds;
        }
      }

      out[name] = { sweep, labels: Object.fromEntries(world.nodes.map((node) => [node.id, labelOf(node)])), queries: records, code };
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  return out;
}

/** Rendering functions on hand-built inputs. */
function formatters(): Record<string, unknown> {
  const node = (id: string, name: string, filePath: string, kind: Node['kind'] = 'function', extra: Partial<Node> = {}): Node => ({
    id, kind, name, qualifiedName: `${filePath}::${name}`, filePath, language: 'typescript', startLine: 4, endLine: 9, startColumn: 0, endColumn: 1, ...extra,
  });
  const entries = [node('e1', 'alpha', 'src/a.ts', 'function', { signature: 'alpha(x: number): string' }), node('e2', 'Gen', 'api/x.pb.go'), node('e3', 'beta', 'src/b.ts', 'method', { startLine: 0 }), node('e4', 'headerGen', 'src/hg.ts')];
  const related = Array.from({ length: 14 }, (_, index) => node(`r${index}`, `sym${index}`, index % 3 === 0 ? 'api/y.pb.go' : `src/f${index % 4}.ts`, 'function', { startLine: index + 1 }));
  const nodes = new Map<string, Node>([...entries, ...related].map((n) => [n.id, n]));
  const blocks: CodeBlock[] = [
    { content: 'generated()', filePath: 'api/x.pb.go', startLine: 1, endLine: 2, language: 'go', node: entries[1] },
    { content: 'const a = 1;', filePath: 'src/a.ts', startLine: 4, endLine: 9, language: 'typescript', node: entries[0] },
    { content: 'orphan', filePath: 'src/o.ts', startLine: 1, endLine: 1, language: 'typescript' },
    { content: 'const b = 2;', filePath: 'src/b.ts', startLine: 2, endLine: 3, language: 'typescript', node: entries[2] },
  ];
  const edge = (source: string, target: string, kind: Edge['kind'], extra: Partial<Edge> = {}): Edge => ({ source, target, kind, ...extra });
  const edges: Edge[] = [
    edge('e1', 'e3', 'calls', { line: 5, column: 2 }), edge('e3', 'r7', 'calls'), edge('e1', 'r8', 'references'), edge('e1', 'r9', 'references'), edge('e1', 'r10', 'references'), edge('e1', 'r11', 'references'), edge('e1', 'r1', 'calls'), edge('e1', 'r2', 'calls'), edge('e1', 'r4', 'calls'), edge('e1', 'r5', 'calls'),
    edge('e1', 'r3', 'extends'), edge('e1', 'r6', 'implements'), edge('e3', 'e1', 'imports'), edge('e3', 'ghost', 'references'), edge('r1', 'r2', 'contains'), edge('r2', 'r1', 'calls'),
  ];
  const context = (entryPoints: Node[], blockList: CodeBlock[], relatedNodes = nodes): TaskContext => ({
    query: 'a **markdown** query', subgraph: { nodes: relatedNodes, edges, roots: entryPoints.map((n) => n.id) }, entryPoints, codeBlocks: blockList,
    relatedFiles: ['src/a.ts', 'src/b.ts'], summary: 'Found things.', stats: { nodeCount: relatedNodes.size, edgeCount: edges.length, fileCount: 2, codeBlockCount: blockList.length, totalCodeSize: 20 },
  });
  const headerFlagged = (filePath: string): boolean => filePath === 'src/hg.ts' || filePath.endsWith('.pb.go');
  const tree = (entryPoints: Node[], nodeMap: Map<string, Node>, edgeList: Edge[]) => formatSubgraphTree({ nodes: nodeMap, edges: edgeList, roots: entryPoints.map((n) => n.id) }, entryPoints);
  const fewNodes = new Map([...nodes].slice(0, 6));
  return {
    markdownDefault: formatContextAsMarkdown(context(entries, blocks)),
    markdownHeaderPredicate: formatContextAsMarkdown(context(entries, blocks), headerFlagged),
    markdownNothingGenerated: formatContextAsMarkdown(context(entries, blocks), () => false),
    markdownNoEntries: formatContextAsMarkdown(context([], [], new Map())),
    markdownOnlyEntries: formatContextAsMarkdown(context([entries[0]!], [], new Map([[entries[0]!.id, entries[0]!]]))),
    markdownFewRelated: formatContextAsMarkdown(context(entries, [], fewNodes)),
    json: formatContextAsJson(context(entries, blocks)),
    jsonEmpty: formatContextAsJson(context([], [], new Map())),
    treeFull: tree(entries, nodes, edges),
    treeFew: tree([entries[0]!], fewNodes, edges),
    treeNone: tree([], new Map(), []),
    treeRemainingOverTen: tree([entries[0]!], nodes, []),
    treeLongSignature: tree([node('s1', 'sig', 'src/s.ts', 'function', { signature: 'x'.repeat(80) })], new Map([['s1', node('s1', 'sig', 'src/s.ts', 'function', { signature: 'x'.repeat(80) })]]), []),
    formatBytes: [0, 1, 1023, 1024, 1536, 1048575, 1048576, 5 * 1024 * 1024, 1.5, -1, Number.NaN].map(formatBytes),
    marker: LOW_CONFIDENCE_MARKER,
  };
}

/** A small real index. Only order-insensitive facts are recorded: database iteration order is not part of the contract. */
async function realIndex(): Promise<Record<string, unknown>> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-context-real-'));
  const sorted = (values: string[]): string[] => [...values].sort();
  try {
    const files: Record<string, string> = {
      'src/parser.ts': 'export function parseToken(raw: string) { return raw.trim(); }\nexport function tokenize(raw: string) { return raw.split(" ").map(parseToken); }\n',
      'src/service.ts': "import { parseToken } from './parser';\nexport class BaseService { authenticate(raw: string) { return parseToken(raw); } }\nexport class ApiService extends BaseService { handle(raw: string) { return this.authenticate(raw); } }\n",
      'src/cache.ts': 'export class CacheBuilder { build() { return new Map(); } evict(key: string) { return key; } }\nexport function cacheKey(a: string, b: string) { return a + b; }\n',
      'src/main.ts': "import { ApiService } from './service';\nimport { CacheBuilder } from './cache';\nexport function main() { const s = new ApiService(); return new CacheBuilder().build() && s.handle('x'); }\n",
      'test/service.test.ts': "import { ApiService } from '../src/service';\nexport function testApi() { return new ApiService().handle('a'); }\n",
    };
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    const graph = await AfyxGraph.init(root);
    await graph.indexAll();
    const results: unknown[] = [];
    for (const query of ['parseToken', 'ApiService authenticate', 'how does caching work', 'CacheBuilder evict', 'authenticate a token with parseToken', 'main', 'test api', 'nothing here', '']) {
      const subgraph = await graph.findRelevantContext(query, { searchLimit: 5, traversalDepth: 1 });
      const context = await graph.buildContext(query, { format: undefined as never }) as TaskContext;
      const markdown = await graph.buildContext(query, { format: 'markdown' }) as string;
      const json = JSON.parse(await graph.buildContext(query, { format: 'json' }) as string);
      const label = (id: string): string => { const found = subgraph.nodes.get(id) ?? context.subgraph.nodes.get(id); return found ? `${found.kind}:${found.name}@${found.filePath}` : id; };
      results.push({
        query,
        roots: sorted(subgraph.roots.map(label)),
        nodes: sorted([...subgraph.nodes.values()].map((n) => `${n.kind}:${n.name}@${n.filePath}`)),
        edgeKinds: sorted(subgraph.edges.map((e) => `${e.kind}`)),
        confidence: subgraph.confidence ?? null,
        entryPoints: sorted(context.entryPoints.map((n) => `${n.kind}:${n.name}@${n.filePath}`)),
        relatedFiles: context.relatedFiles,
        stats: { nodes: context.stats.nodeCount, files: context.stats.fileCount, codeBlocks: context.stats.codeBlockCount },
        codeBlockFiles: sorted(context.codeBlocks.map((block) => `${block.filePath}:${block.startLine}-${block.endLine}`)),
        markdownSections: (markdown.match(/^#{2,4} .*/gm) ?? []).map((line) => line.replace(/\(.*\)$/, '').trim()).sort(),
        jsonKeys: Object.keys(json),
        jsonNodeCount: json.nodes.length,
      });
    }
    graph.close();
    return { results };
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export async function computeContextContract(): Promise<Record<string, unknown>> {
  return { worlds: await fakeBackedWorlds(), formatters: formatters(), realIndex: await realIndex() };
}
