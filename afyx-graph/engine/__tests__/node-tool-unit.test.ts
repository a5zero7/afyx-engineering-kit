import { describe, expect, it, vi } from 'vitest';
import type AfyxGraph from '../src/index';
import type { Edge, Node } from '../src/types';
import { executeNodeTool, type NodeToolHost } from '../src/mcp/node-tool';
import { textToolResult } from '../src/mcp/tool-results';

const definition: Node = {
  id: 'demo',
  kind: 'function',
  name: 'demo',
  qualifiedName: 'demo',
  filePath: 'src/demo.ts',
  language: 'typescript',
  startLine: 3,
  endLine: 4,
  startColumn: 0,
  endColumn: 1,
};

function source(overrides: Record<string, unknown> = {}): AfyxGraph {
  return {
    getFiles: () => [],
    getNodesInFile: () => [],
    getFileDependents: () => [],
    getNodesByName: () => [],
    searchNodes: () => [],
    generatedFilePredicate: () => () => false,
    getCode: async () => null,
    getChildren: () => [],
    getCallers: () => [],
    getCallees: () => [],
    ...overrides,
  } as unknown as AfyxGraph;
}

function host(overrides: Partial<NodeToolHost> = {}): NodeToolHost {
  return {
    validateSymbol: (value) => typeof value === 'string' && value.trim()
      ? value.trim()
      : textToolResult('symbol must be a non-empty string'),
    isFileStale: () => false,
    readCurrentFile: () => null,
    numberSourceLines: (body, start) => body.split('\n').map((line, index) => `${start + index}\t${line}`).join('\n'),
    synthEdgeLabel: (_edge: Edge) => null,
    isContainerKind: () => false,
    ...overrides,
  };
}

describe('MCP Node adapter seam', () => {
  it('orchestrates a symbol lookup and passes the rendered result through', async () => {
    const getNodesByName = vi.fn(() => [definition]);
    const getCode = vi.fn(async () => 'function demo() {}');
    const result = await executeNodeTool(
      source({ getNodesByName, getCode }),
      { symbol: 'demo', includeCode: true },
      host(),
    );

    expect(getNodesByName).toHaveBeenCalledWith('demo');
    expect(getCode).toHaveBeenCalledWith('demo');
    expect(result.content[0]!.text).toContain('3\tfunction demo() {}');
  });

  it('selects file mode without invoking generic symbol validation', async () => {
    const validateSymbol = vi.fn(() => {
      throw new Error('file mode must not validate symbol');
    });
    const readCurrentFile = vi.fn(() => 'alpha\nbeta\n');
    const result = await executeNodeTool(
      source({
        getFiles: () => [{ path: 'src/demo.ts', language: 'typescript', nodeCount: 1 }],
        getNodesInFile: () => [definition],
      }),
      { file: 'demo.ts', offset: 2, limit: 1 },
      host({ validateSymbol, readCurrentFile }),
    );

    expect(validateSymbol).not.toHaveBeenCalled();
    expect(readCurrentFile).toHaveBeenCalledWith('src/demo.ts');
    expect(result.content[0]!.text).toContain('2\tbeta');
  });

  it('keeps stale configuration values out of symbol results', async () => {
    const configNode: Node = {
      ...definition,
      id: 'secret',
      name: 'api_key',
      qualifiedName: 'api_key',
      filePath: 'config/app.properties',
      language: 'properties',
      kind: 'constant',
      startLine: 1,
      endLine: 1,
    };
    const result = await executeNodeTool(
      source({ getNodesByName: () => [configNode] }),
      { symbol: 'api_key', includeCode: true },
      host({
        isFileStale: () => true,
        readCurrentFile: () => 'api_key=DO_NOT_LEAK',
      }),
    );

    expect(result.content[0]!.text).not.toContain('DO_NOT_LEAK');
    expect(result.content[0]!.text).toContain('body is omitted');
  });

  it('returns the host validation result unchanged', async () => {
    const invalid = textToolResult('invalid symbol');
    const getNodesByName = vi.fn(() => [definition]);
    const result = await executeNodeTool(
      source({ getNodesByName }),
      { symbol: 42 },
      host({ validateSymbol: () => invalid }),
    );

    expect(result).toBe(invalid);
    expect(getNodesByName).not.toHaveBeenCalled();
  });
});
