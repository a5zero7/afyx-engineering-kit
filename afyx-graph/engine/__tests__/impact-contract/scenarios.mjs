// usage: node scenarios.mjs <cli.js> <project dir> <out.json>
// Impact/affected-tests real-CLI/MCP corpus over the synthetic fixture in fixture.ts.
// Records exact digests (and, where small, exact values) of every operation, so a
// byte-for-byte OLD golden can be compared against a byte-for-byte NEW result.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const [cli, project, out] = process.argv.slice(2);
const env = { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_NO_WATCH: '1', AFYX_GRAPH_ALLOW_UNSAFE_NODE: '1', NO_COLOR: '1' };
const sha = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `${text.length}:${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
};
// Strips content that varies by which Node.js major happens to be installed on the
// machine running the corpus, not by anything impact/affected observably does:
//  - the node-version-check.ts banner (printed whenever the LOCAL Node is >=25 or <20 —
//    e.g. present on a Windows box defaulting to Node 26, never on a Node 22 box);
//  - Node's own one-time-per-process runtime warnings (ExperimentalWarning for
//    node:sqlite, the typeless-package-json module warning) — process-startup noise,
//    not CLI output.
const scrub = (text) => text
  .replace(/\d+(\.\d+)? ?ms/g, '#ms')
  .replace(/-{72}\n\[Afyx Graph\] Unsupported Node\.js version:[^\n]*\n-{72}\n(?:(?!-{72})[\s\S])*?-{72}\n?/g, '')
  .split('\n')
  .filter((line) => !/^\(node:\d+\)|^\(Use `node --trace-warnings|^To eliminate this warning|^Reparsing as ES module/.test(line))
  .join('\n');
const record = {};

// ---- MCP over stdio: afyx_graph_impact ------------------------------------------------
const child = spawn(process.execPath, [cli, 'serve', '--mcp'], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
let stderrText = '';
child.stderr.on('data', (chunk) => { stderrText += chunk.toString(); });
const pending = new Map();
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); const w = pending.get(m.id); if (w) { pending.delete(m.id); w(m); } } catch { /* not a response */ }
  }
});
let nextId = 1;
const request = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => reject(new Error('timeout ' + method + ' stderr: ' + stderrText.slice(-500))), 120000);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

try {
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'impact-contract', version: '0' }, rootUri: 'file://' + project.replace(/\\/g, '/') });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

  const mcpImpact = async (label, args) => {
    const response = await request('tools/call', { name: 'afyx_graph_impact', arguments: args });
    const text = response.result?.content?.map((p) => p.text).join('\n') ?? JSON.stringify(response.error);
    record[`mcp impact ${label}`] = { digest: sha(scrub(text)), isError: Boolean(response.result?.isError) };
  };

  // Symbols across every world, at several depths (default omitted / 1 / 2 / 3 / 10 / beyond-reachable).
  const SYMBOLS = [
    'linearA', 'linearB', 'linearC', 'linearD',
    'diamondA', 'diamondB', 'diamondC', 'diamondD',
    'cycleA', 'cycleB', 'cycleC',
    'discX', 'discY', 'discP', 'discQ',
    'hubCentral', 'hubCaller1', 'hubCallee1',
    'MultiRelBase', 'MultiRelDerived',
    'faninTarget', 'faninUser1',
    'fanoutRoot', 'fanoutDep1',
    'testmapHelper', 'testmapSource',
    'multitestHelper',
    'nestedDeep3', 'nestedDeep2', 'nestedDeep1',
    'notestLeaf', 'notestMid', 'notestTop',
    'ambiguousShared',
    'nonexistentSymbolXyzAbc',
    'deepchainN0', 'deepchainN5',
    'dupcallTarget',
  ];
  const DEPTHS = [undefined, 1, 2, 3, 10, 500];
  for (const symbol of SYMBOLS) {
    for (const depth of DEPTHS) {
      const args = depth === undefined ? { symbol } : { symbol, depth };
      await mcpImpact(`${symbol} depth=${depth ?? 'default'}`, args);
    }
  }
  // File-narrowed lookups for the ambiguous case specifically.
  await mcpImpact('ambiguousShared file=one.ts', { symbol: 'ambiguousShared', file: 'src/ambiguous/one.ts' });
  await mcpImpact('ambiguousShared file=two.ts', { symbol: 'ambiguousShared', file: 'src/ambiguous/two.ts' });
  await mcpImpact('ambiguousShared file=nomatch.ts', { symbol: 'ambiguousShared', file: 'nomatch.ts' });
} finally {
  child.kill();
}

// ---- CLI: impact (JSON mode, exact structural comparison) -----------------------------
function cliImpact(label, args) {
  const result = spawnSync(process.execPath, [cli, 'impact', ...args, '--path', project], { encoding: 'utf8', env, timeout: 60000 });
  record[`cli impact ${label}`] = { exit: result.status, stdout: sha(scrub(result.stdout ?? '')), stderr: sha(scrub(result.stderr ?? '')) };
}
cliImpact('linearA json d2', ['linearA', '--json', '--depth', '2']);
cliImpact('linearA json d1', ['linearA', '--json', '--depth', '1']);
cliImpact('linearA text default', ['linearA']);
cliImpact('diamondA json d3', ['diamondA', '--json', '--depth', '3']);
cliImpact('diamondA text default', ['diamondA']);
cliImpact('cycleA json d10', ['cycleA', '--json', '--depth', '10']);
cliImpact('hubCentral json d1', ['hubCentral', '--json', '--depth', '1']);
cliImpact('hubCallee1 json d2', ['hubCallee1', '--json', '--depth', '2']);
cliImpact('MultiRelBase json d2', ['MultiRelBase', '--json', '--depth', '2']);
cliImpact('ambiguousShared json default', ['ambiguousShared', '--json']);
cliImpact('ambiguousShared text default', ['ambiguousShared']);
cliImpact('ambiguousShared json file=one', ['ambiguousShared', '--json', '--file', 'src/ambiguous/one.ts']);
cliImpact('ambiguousShared json file=nomatch', ['ambiguousShared', '--json', '--file', 'nomatch.ts']);
cliImpact('nonexistent json', ['nonexistentSymbolXyzAbc', '--json']);
cliImpact('depth clamp above10', ['deepchainN0', '--json', '--depth', '999']);
cliImpact('depth clamp below1', ['deepchainN0', '--json', '--depth', '0']);
cliImpact('deepchain json d10', ['deepchainN0', '--json', '--depth', '10']);
cliImpact('deepchain json d15', ['deepchainN0', '--json', '--depth', '15']);
cliImpact('deepchain json d500', ['deepchainN0', '--json', '--depth', '500']);

// ---- CLI: affected (quiet mode = pure file list; json mode = full structure) -----------
function cliAffected(label, args) {
  const result = spawnSync(process.execPath, [cli, 'affected', ...args, '--path', project], { encoding: 'utf8', env, timeout: 60000 });
  record[`cli affected ${label}`] = { exit: result.status, stdout: sha(scrub(result.stdout ?? '')), stderr: sha(scrub(result.stderr ?? '')) };
}
// Single changed source file, default depth, per world.
cliAffected('testmap source', ['src/testmap/source.ts', '--json']);
cliAffected('testmap helper', ['src/testmap/helper.ts', '--json']);
cliAffected('multitest helper', ['src/multitest/helper.ts', '--json']);
cliAffected('multitest source', ['src/multitest/source.ts', '--json']);
cliAffected('nested deep3', ['src/nested/deep3.ts', '--json']);
cliAffected('nested deep2', ['src/nested/deep2.ts', '--json']);
cliAffected('nested deep1', ['src/nested/deep1.ts', '--json']);
cliAffected('notest leaf', ['src/notest/leaf.ts', '--json']);
cliAffected('notest top', ['src/notest/top.ts', '--json']);
cliAffected('fanin target', ['src/fanin/target.ts', '--json']);
cliAffected('fanout dep1', ['src/fanout/dep1.ts', '--json']);
// File-diamond convergence: at maxDepth=3 (default 5 also), a shortest-path-correct BFS
// still discovers the converged test; a depth-first order landing on the longer path
// first would not (see fixture.ts's world comment).
cliAffected('filediamond root default', ['src/filediamond/root.ts', '--json']);
cliAffected('filediamond root depth3', ['src/filediamond/root.ts', '--json', '--depth', '3']);
cliAffected('filediamond root depth2', ['src/filediamond/root.ts', '--json', '--depth', '2']);
// Test-chain: a test dependent is terminal — traversal must not continue past it to reach
// the OTHER test file that merely imports the first one.
cliAffected('testchain base', ['src/testchain/base.ts', '--json']);
// A changed file that is itself a test.
cliAffected('changed is test', ['src/testmap/source.test.ts', '--json']);
cliAffected('changed is test multitest a', ['src/multitest/a.test.ts', '--json']);
// Depth boundary around nested's 2-hop chain (deep1 -> deep2 -> deep3 -> deep3.test.ts is 3 hops).
cliAffected('nested deep1 depth1', ['src/nested/deep1.ts', '--json', '--depth', '1']);
cliAffected('nested deep1 depth2', ['src/nested/deep1.ts', '--json', '--depth', '2']);
cliAffected('nested deep1 depth3', ['src/nested/deep1.ts', '--json', '--depth', '3']);
cliAffected('nested deep1 depth4', ['src/nested/deep1.ts', '--json', '--depth', '4']);
cliAffected('nested deep1 depth0', ['src/nested/deep1.ts', '--json', '--depth', '0']);
// Multiple changed inputs (union behavior).
cliAffected('multi input testmap+multitest', ['src/testmap/helper.ts', 'src/multitest/helper.ts', '--json']);
cliAffected('multi input nested+notest', ['src/nested/deep3.ts', 'src/notest/leaf.ts', '--json']);
// Custom --filter glob overriding the shared classifier.
cliAffected('filter override matches nothing', ['src/testmap/source.ts', '--json', '--filter', '*.spec.ts']);
cliAffected('filter override custom match', ['src/testmap/source.ts', '--json', '--filter', '*.test.ts']);
// Invalid / missing inputs.
cliAffected('nonexistent file', ['src/does/not/exist.ts', '--json']);
cliAffected('no files quiet', ['--quiet']);
cliAffected('no files verbose', []);
// --stdin path.
{
  const result = spawnSync(process.execPath, [cli, 'affected', '--stdin', '--json', '--path', project], {
    encoding: 'utf8', env, timeout: 60000, input: 'src/testmap/helper.ts\nsrc/multitest/helper.ts\n',
  });
  record['cli affected stdin two files'] = { exit: result.status, stdout: sha(scrub(result.stdout ?? '')), stderr: sha(scrub(result.stderr ?? '')) };
}
// Human-readable (non-JSON, non-quiet) rendering for one representative case each way.
cliAffected('human readable with results', ['src/testmap/helper.ts']);
cliAffected('human readable no results', ['src/notest/leaf.ts']);

fs.writeFileSync(out, JSON.stringify(record));
console.log(`recorded ${Object.keys(record).length} operations`);
