import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import { AfyxGraph } from '../src/index';

export async function schemaFixture(
  files: Record<string, string>,
  use: (fixture: {
    graph: AfyxGraph;
    write(file: string, text: string): void;
    remove(file: string): void;
    symbol(file: string, name: string): string;
    targets(file: string, name: string): string[];
  }) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'afyx-schema-dispatch-'));
  let graph: AfyxGraph | undefined;
  try {
    const write = (file: string, text: string) => {
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text.trimStart());
    };
    for (const [file, text] of Object.entries(files)) write(file, text);
    const candidate = graph = AfyxGraph.initSync(root);
    expect((await candidate.indexAll()).success).toBe(true);
    const symbol = (file: string, name: string) => {
      const matches = candidate.getNodesInFile(file).filter(node =>
        node.qualifiedName === name || node.qualifiedName.endsWith('#' + name));
      expect(matches.map(node => node.qualifiedName), file + ' :: ' + name).toHaveLength(1);
      return matches[0]!.id;
    };
    await use({
      graph: candidate, write, remove: file => rmSync(join(root, file)), symbol,
      targets: (file, name) => candidate.getCallees(symbol(file, name))
        .filter(({ edge }) => ['graphql-resolver', 'grpc-service'].includes(String(edge.metadata?.synthesis)))
        .map(({ node }) => node.filePath + ':' + node.qualifiedName)
        .sort(),
    });
  } finally {
    graph?.close();
    rmSync(root, { recursive: true, force: true });
  }
}
