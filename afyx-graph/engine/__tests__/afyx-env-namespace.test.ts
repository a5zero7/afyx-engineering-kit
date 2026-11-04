import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NAMESPACE = 'AFYX_GRAPH_';

// Host and platform variables the engine may read besides its own namespace.
const PLATFORM_ENV = new Set([
  'APPDATA',
  'CI',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'COPILOT_HOME',
  'FORCE_COLOR',
  'HERMES_HOME',
  'LOCALAPPDATA',
  'NODE_ENV',
  'NO_COLOR',
  'PATH',
  'TERM',
  'VITEST',
  'WSL_DISTRO_NAME',
  'WSL_INTEROP',
  'XDG_CONFIG_HOME',
]);

// The optional Graph-to-ACE MCP boundary may read only these three ACE
// lifecycle variables. The allowlist is deliberately bound to one source
// file: no other Graph module may read another component's configuration.
const ACE_BRIDGE_ENV = new Set([
  'AFYX_CONTEXT_OPT_IN',
  'AFYX_CONTEXT_RUNTIME_ROOT',
  'AFYX_CONTEXT_STATE_ROOT',
]);
const ACE_BRIDGE_FILE = 'mcp/ace-runtime.ts';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  for (const name of Object.keys(process.env)) {
    if (name.startsWith(NAMESPACE)) delete process.env[name];
  }
});

afterEach(() => {
  process.env = { ...originalEnv };
});

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('Afyx Graph environment namespace', () => {
  it('AFYX_GRAPH_DIR configures the state directory', async () => {
    process.env.AFYX_GRAPH_DIR = '.afyx-graph-win';
    const { afyxGraphDirName } = await import('../src/directory');
    expect(afyxGraphDirName()).toBe('.afyx-graph-win');
  });

  it('the state directory defaults to .afyx-graph when no override is set', async () => {
    const { afyxGraphDirName } = await import('../src/directory');
    expect(afyxGraphDirName()).toBe('.afyx-graph');
  });

  it('AFYX_GRAPH_MCP_TOOLS selects the exposed tools', async () => {
    const { getStaticTools } = await import('../src/mcp/tools');
    expect(getStaticTools().map((tool) => tool.name)).toEqual(['afyx_graph_inventory', 'afyx_graph_explore']);

    process.env.AFYX_GRAPH_MCP_TOOLS = 'search';
    expect(getStaticTools().map((tool) => tool.name)).toEqual(['afyx_graph_search']);
  });

  it('importing the product identity adds no environment variables', async () => {
    process.env.AFYX_GRAPH_NO_DAEMON = '1';
    const before = new Set(Object.keys(process.env));
    await import('../src/product');
    await import('../src/directory');
    expect(Object.keys(process.env).filter((name) => !before.has(name))).toEqual([]);
  });

  it('the engine source reads only AFYX_GRAPH_* and known platform variables', () => {
    const srcRoot = path.resolve(__dirname, '../src');
    const readPattern = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g;
    const unexpected = new Set<string>();
    for (const file of sourceFiles(srcRoot)) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(readPattern)) {
        const name = match[1] ?? match[2];
        const relative = path.relative(srcRoot, file).split(path.sep).join('/');
        const bridgeException = relative === ACE_BRIDGE_FILE && ACE_BRIDGE_ENV.has(name);
        if (!name.startsWith(NAMESPACE) && !PLATFORM_ENV.has(name) && !bridgeException) {
          unexpected.add(`${name} (${relative})`);
        }
      }
    }
    expect([...unexpected]).toEqual([]);
  });
});
