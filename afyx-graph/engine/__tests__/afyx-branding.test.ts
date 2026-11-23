import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  delete process.env.AFYX_GRAPH_DIR;
  delete process.env.AFYX_GRAPH_MCP_TOOLS;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('Afyx Graph native identity', () => {
  it('publishes the canonical MCP identity and tool prefix', async () => {
    const [{ SERVER_INFO }, { getStaticTools }] = await Promise.all([
      import('../src/mcp/session'),
      import('../src/mcp/tools'),
    ]);
    expect(SERVER_INFO.name).toBe('afyx_graph');
    expect(getStaticTools().length).toBeGreaterThan(0);
    expect(getStaticTools().every((tool) => tool.name.startsWith('afyx_graph_'))).toBe(true);
  });

  it('reads the state directory from AFYX_GRAPH_DIR', async () => {
    process.env.AFYX_GRAPH_DIR = '.canonical-state';
    const { afyxGraphDirName } = await import('../src/directory');
    expect(afyxGraphDirName()).toBe('.canonical-state');
  });

  it('recognises only its own state directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-state-'));
    try {
      const { getAfyxGraphDir, getDatabasePath, isInitialized } = await import('../src/directory');
      expect(getAfyxGraphDir(root)).toBe(path.join(root, '.afyx-graph'));

      const foreign = path.join(root, '.foreign-state');
      fs.mkdirSync(foreign);
      fs.writeFileSync(path.join(foreign, 'index.db'), 'foreign-bytes');
      expect(getAfyxGraphDir(root)).toBe(path.join(root, '.afyx-graph'));
      expect(isInitialized(root)).toBe(false);

      fs.mkdirSync(getAfyxGraphDir(root));
      fs.writeFileSync(getDatabasePath(root), '');
      expect(isInitialized(root)).toBe(true);
      expect(fs.readFileSync(path.join(foreign, 'index.db'), 'utf8')).toBe('foreign-bytes');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('classifies only .afyx-graph and its siblings as data directories', async () => {
    const { isAfyxGraphDataDir } = await import('../src/directory');
    expect(isAfyxGraphDataDir('.afyx-graph')).toBe(true);
    expect(isAfyxGraphDataDir('.afyx-graph-win')).toBe(true);
    for (const other of ['.git', '.foreign-state', '.afyx', 'afyx-graph', 'node_modules']) {
      expect(isAfyxGraphDataDir(other)).toBe(false);
    }
  });

  it('ships exactly one CLI binary, afyx-graph', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    expect(manifest.name).toBe('@a5zero7/afyx-graph');
    expect(manifest.bin).toEqual({ 'afyx-graph': './dist/bin/afyx-graph.js' });
  });
});
