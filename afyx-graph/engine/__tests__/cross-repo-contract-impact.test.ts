import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { AfyxGraph } from '../src/index';
import { ToolHandler } from '../src/mcp/tools';

it('uses exact contract and repository identity, then follows bounded calls in fresh siblings', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'afyx-contract-impact-'));
  const graphs: AfyxGraph[] = [];
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  const init = async (name: string, files: Record<string, string>, consumes: unknown[] = []) => {
    const root = join(workspace, name);
    mkdirSync(root);
    for (const [file, source] of Object.entries(files)) writeFileSync(join(root, file), source);
    writeFileSync(join(root, 'afyx-contracts.json'), JSON.stringify({ repository: name, consumes }));
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'synthetic fixture');
    const graph = AfyxGraph.initSync(root);
    graphs.push(graph);
    expect((await graph.indexAll()).success).toBe(true);
    return graph;
  };
  const previousPeers = process.env.AFYX_GRAPH_PEER_ROOTS;
  const previousDiscovery = process.env.AFYX_GRAPH_PEER_DISCOVERY_ROOT;
  try {
    const api = await init('api', {
      'schema.graphql': 'type Query {\n get: String\n}',
      'api.proto': 'syntax = "proto3";\npackage api;\nservice Catalog {\n rpc Get (Req) returns (Res);\n}',
      'openapi.json': JSON.stringify({ openapi:'3.0.0', info:{ title:'API', version:'1' },
        paths:{'/catalog':{get:{operationId:'getCatalog',responses:{'200':{description:'ok'}}}}} }),
    });
    const use = (file: string, symbol: string, consumer: string, producer = 'api') => ({
      producer, contract: { file, symbol }, consumer: { file: 'use.ts', symbol: consumer },
    });
    const consumer = await init('consumer', {
      'package.json': '{"name":"fixture-consumer"}',
      'use.ts': 'export function loadGql() {}\nexport function loadRpc() {}\nexport function loadHttp() {}\nexport function route() { loadGql(); }\nexport function get() {}',
    }, [
      use('schema.graphql', 'Query.get', 'loadGql'),
      use('api.proto', 'api.Catalog.Get', 'loadRpc'),
      use('openapi.json', 'GET:/catalog', 'loadHttp'),
      use('schema.graphql', 'Query.get', 'get', 'different-service'),
      use('schema.graphql', 'Mutation.get', 'get'),
    ]);
    const peer = consumer.getProjectRoot();
    mkdirSync(join(workspace, 'unindexed'));
    const args = ['schema.graphql', 'Query.get', [peer, peer, 'missing', 'unindexed']] as const;
    const result = api.getCrossRepoContractImpact(...args, 2);
    expect(result.producer).toMatchObject({ repository: 'api', file: 'schema.graphql', line: 2 });
    expect(result.links.map(link => [link.provenance, link.to.symbol, link.depth])).toEqual([
      ['cross-repo-contract', 'loadGql', 1], ['indexed-call', 'route', 2],
    ]);
    expect(result.skipped).toEqual({ PEER_UNAVAILABLE_OR_STALE: 2 });
    expect(api.getCrossRepoContractImpact(...args, 1).links).toHaveLength(1);
    expect(api.getCrossRepoContractImpact('api.proto', 'api.Catalog.Get', [peer]).links[0]?.to.symbol).toBe('loadRpc');
    expect(api.getCrossRepoContractImpact('openapi.json', 'GET:/catalog', [peer]).links[0]?.to.symbol).toBe('loadHttp');

    const mcp = new ToolHandler(api);
    process.env.AFYX_GRAPH_PEER_ROOTS = JSON.stringify([peer]);
    process.env.AFYX_GRAPH_PEER_DISCOVERY_ROOT = workspace;
    const exactTarget = { file: 'schema.graphql', symbol: 'Query.get' };
    const auto = await mcp.execute('afyx_graph_impact', exactTarget);
    expect(JSON.parse(auto.content[0]!.text)).toMatchObject({ discovery: { candidates: 1, truncated: false }, links: result.links });
    const explicitlyEmpty = await mcp.execute('afyx_graph_impact', { ...exactTarget, peerProjectPaths: [] });
    expect(JSON.parse(explicitlyEmpty.content[0]!.text).links).toEqual([]);
    const merged = await mcp.execute('afyx_graph_impact', { ...exactTarget, peerProjectPaths: [peer], autoDiscoverPeers: true });
    expect(JSON.parse(merged.content[0]!.text).links).toEqual(result.links);
    for (const tool of ['afyx_graph_callers', 'afyx_graph_impact']) {
      const response = await mcp.execute(tool, { file: 'schema.graphql', symbol: 'Query.get', peerProjectPaths: [peer] });
      expect(response.isError).toBeFalsy();
      expect(JSON.parse(response.content[0]!.text).links[0].to.symbol).toBe('loadGql');
    }
    expect((await mcp.execute('afyx_graph_impact', {
      file: 'schema.graphql', symbol: 'Query.get', peerProjectPaths: ['unknown'],
    })).isError).toBe(true);

    const alias = join(workspace, 'alias');
    symlinkSync(peer, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const invalid = api.getCrossRepoContractImpact('schema.graphql', 'Query.get', [alias, tmpdir()]);
    expect(invalid.links).toEqual([]);
    writeFileSync(join(peer, 'use.ts'), 'export function get() {}');
    const stale = api.getCrossRepoContractImpact('schema.graphql', 'Query.get', [peer]);
    expect(stale.links).toEqual([]);
    expect(stale.skipped).toEqual({ PEER_UNAVAILABLE_OR_STALE: 1 });
  } finally {
    if (previousPeers === undefined) delete process.env.AFYX_GRAPH_PEER_ROOTS;
    else process.env.AFYX_GRAPH_PEER_ROOTS = previousPeers;
    if (previousDiscovery === undefined) delete process.env.AFYX_GRAPH_PEER_DISCOVERY_ROOT;
    else process.env.AFYX_GRAPH_PEER_DISCOVERY_ROOT = previousDiscovery;
    for (const graph of graphs) graph.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
