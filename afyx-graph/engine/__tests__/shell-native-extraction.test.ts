import { describe, expect, it } from 'vitest';
import { extractFromSource } from '../src/extraction/extract';
import { detectLanguage, isSourceFile } from '../src/extraction/grammars';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AfyxGraph from '../src/index';

describe('native Shell extraction', () => {
  it('registers POSIX shell extensions for normal indexing', () => {
    for (const extension of ['sh', 'bash', 'zsh']) {
      expect(detectLanguage(`scripts/tool.${extension}`)).toBe('shell');
      expect(isSourceFile(`scripts/tool.${extension}`)).toBe(true);
    }
  });

  it('grounds function boundaries and a unique local call', () => {
    const source = 'function greet() {\n  echo hello\n}\ngreet\n';
    const result = extractFromSource('scripts/main.sh', source);
    const functionNode = result.nodes.find((node) => node.kind === 'function' && node.name === 'greet');
    expect(functionNode).toMatchObject({ startLine: 1, endLine: 3, language: 'shell' });
    expect(result.edges).toContainEqual(expect.objectContaining({
      source: 'file:scripts/main.sh', target: functionNode?.id, kind: 'calls',
    }));
    expect(result.errors).toEqual([]);
  });

  it('records static sourced and executed scripts, including quoted spaces', () => {
    const source = 'source "./helper file.sh"\n. ./common.sh\n./run.sh\nbash ./other.sh\n';
    const result = extractFromSource('scripts/main.sh', source);
    expect(result.unresolvedReferences.filter((ref) => ref.referenceKind === 'imports')
      .map((ref) => ref.referenceName)).toEqual([
      './helper file.sh', './common.sh', './run.sh', './other.sh',
    ]);
  });

  it('extracts exported static bindings without executing shell source', () => {
    const result = extractFromSource('scripts/config.bash', 'export ROOT=here\nreadonly LIMIT=2\n');
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'variable', name: 'ROOT', isExported: true }),
      expect.objectContaining({ kind: 'constant', name: 'LIMIT' }),
    ]));
    expect(result.edges.some((edge) => edge.kind === 'exports')).toBe(true);
  });

  it('does not derive calls from strings, comments, here-documents, or dynamics', () => {
    const source = [
      'greet() { :; }', '# greet', 'echo "greet"',
      'cat <<EOF', 'greet', 'phantom() { greet; }', 'EOF',
      '"greet"', '$dynamic', 'greet',
    ].join('\n');
    const result = extractFromSource('scripts/main.zsh', source);
    expect(result.nodes.filter((node) => node.kind === 'function').map((node) => node.name)).toEqual(['greet']);
    expect(result.edges.filter((edge) => edge.kind === 'calls')).toHaveLength(1);
  });

  it('leaves ambiguous duplicate function names without a call edge', () => {
    const result = extractFromSource('scripts/main.sh', 'run() { :; }\nrun() { :; }\nrun\n');
    expect(result.nodes.filter((node) => node.kind === 'function')).toHaveLength(2);
    expect(result.edges.filter((edge) => edge.kind === 'calls')).toHaveLength(0);
  });

  it('handles POSIX and Bash function forms, multiline bodies, and pipelines', () => {
    const source = 'first()\n{\n  :\n}\nfunction second { first | cat; }\nsecond\n';
    const result = extractFromSource('bin/tool.bash', source);
    expect(result.nodes.filter((node) => node.kind === 'function')
      .map((node) => [node.name, node.startLine, node.endLine]))
      .toEqual([['first', 1, 4], ['second', 5, 5]]);
    expect(result.edges.filter((edge) => edge.kind === 'calls')).toHaveLength(2);
  });

  it('leaves dynamic source paths unresolved without a fabricated import edge', () => {
    const result = extractFromSource('main.sh', 'source "$LIB/file.sh"\n. "$dynamic"\n');
    expect(result.unresolvedReferences.filter((ref) => ref.referenceKind === 'imports')).toEqual([]);
    expect(result.edges.filter((edge) => edge.kind === 'imports')).toEqual([]);
  });

  it('does not mistake quoted or commented here-document markers for operators', () => {
    const source = 'echo "literal <<EOF"\n# <<STOP\nreal() { :; }\nreal\n';
    const result = extractFromSource('main.sh', source);
    expect(result.nodes).toContainEqual(expect.objectContaining({ kind: 'function', name: 'real' }));
    expect(result.edges.filter((edge) => edge.kind === 'calls')).toHaveLength(1);
  });

  it('repeats stable symbol and relationship identities', () => {
    const source = 'task() { :; }\ntask\n';
    const shape = () => {
      const result = extractFromSource('task.sh', source);
      return {
        nodes: result.nodes.map(({ id, kind, startLine, endLine }) => ({ id, kind, startLine, endLine })),
        edges: result.edges,
      };
    };
    expect(shape()).toEqual(shape());
  });

  it('indexes a sourced script as an actual Graph import edge', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-shell-graph-'));
    let graph: AfyxGraph | undefined;
    try {
      fs.writeFileSync(path.join(root, 'helper.sh'), 'helper() { :; }\n');
      fs.writeFileSync(path.join(root, 'main.sh'), 'source ./helper.sh\nhelper\n');
      graph = await AfyxGraph.init(root);
      await graph.indexAll();
      await graph.resolveReferences();
      expect(graph.searchNodes('helper').some(({ node }) => node.kind === 'function')).toBe(true);
      expect(graph.getOutgoingEdgesFrom(['file:main.sh'], ['imports']))
        .toContainEqual(expect.objectContaining({ target: 'file:helper.sh' }));
      fs.writeFileSync(path.join(root, 'main.sh'), 'source ./helper.sh\nupdated() { :; }\n');
      const incremental = await graph.indexFiles(['main.sh']);
      expect(incremental.filesIndexed).toBe(1);
      expect(graph.searchNodes('updated').some(({ node }) => node.kind === 'function')).toBe(true);
    } finally {
      await graph?.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
