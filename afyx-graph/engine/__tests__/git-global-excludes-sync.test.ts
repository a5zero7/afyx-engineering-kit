import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import AfyxGraph from '../src/index';

describe('core.excludesFile sync scope', () => {
  let root = '';
  let graph: AfyxGraph | null = null;

  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

  const initialize = async (
    configuredPath: string,
    patterns: string,
    beforeIndex?: (fixtureRoot: string) => void,
  ): Promise<string> => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-global-excludes-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');

    const excludesPath = path.resolve(root, configuredPath);
    fs.mkdirSync(path.dirname(excludesPath), { recursive: true });
    fs.writeFileSync(excludesPath, patterns);
    git('config', 'core.excludesFile', configuredPath);

    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'visible.ts'), 'export const visible = 1;\n');
    beforeIndex?.(root);
    git('add', 'src/visible.ts');
    git('commit', '-q', '-m', 'initial');

    graph = AfyxGraph.initSync(root);
    await graph.indexAll();
    return excludesPath;
  };

  afterEach(() => {
    graph?.destroy();
    graph = null;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('honors a repository-relative core.excludesFile before the ignored directory exists', async () => {
    await initialize(path.join('config', 'global-ignore'), 'global-cache/\n');

    // Warm the scoped matcher before the ignored directory exists. The matcher
    // must derive the rule from core.excludesFile, not accidentally rely on an
    // already-present directory from `git ls-files --ignored --directory`.
    await graph!.sync({ paths: ['src/visible.ts'] });
    fs.mkdirSync(path.join(root, 'global-cache'));
    fs.writeFileSync(path.join(root, 'global-cache', 'hidden.ts'), 'export const hidden = 1;\n');

    const result = await graph!.sync({ paths: ['global-cache/hidden.ts'] });
    expect(result.filesAdded).toBe(0);
    expect(graph!.searchNodes('hidden')).toHaveLength(0);
  });

  it('refreshes scoped sync when the configured global-excludes file changes', async () => {
    const excludesPath = await initialize('global-ignore', 'cache-a/\n');
    git('config', 'core.excludesFile', excludesPath);

    await graph!.sync({ paths: ['src/visible.ts'] });
    fs.writeFileSync(excludesPath, 'cache-a/\ncache-b/\n');
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(excludesPath, future, future);
    fs.mkdirSync(path.join(root, 'cache-b'));
    fs.writeFileSync(path.join(root, 'cache-b', 'hidden.ts'), 'export const hidden = 1;\n');

    const result = await graph!.sync({ paths: ['cache-b/hidden.ts'] });
    expect(result.filesAdded).toBe(0);
    expect(graph!.searchNodes('hidden')).toHaveLength(0);
  });

  it('keeps all Git ignore sources excluded through lifecycle changes and reconciliation', async () => {
    await initialize('global-ignore', 'global-cache/\n', (fixtureRoot) => {
      fs.writeFileSync(path.join(fixtureRoot, '.gitignore'), 'scratch/\n');
      fs.appendFileSync(path.join(fixtureRoot, '.git', 'info', 'exclude'), '\nlocal-only/\n');
      for (const [dir, symbol] of [
        ['scratch', 'scratchHidden'],
        ['local-only', 'localHidden'],
        ['global-cache', 'globalHidden'],
      ]) {
        fs.mkdirSync(path.join(fixtureRoot, dir));
        fs.writeFileSync(path.join(fixtureRoot, dir, 'hidden.ts'), `export const ${symbol} = 1;\n`);
      }
    });

    expect(graph!.searchNodes('visible').length).toBeGreaterThan(0);
    expect(graph!.searchNodes('scratchHidden')).toHaveLength(0);
    expect(graph!.searchNodes('localHidden')).toHaveLength(0);
    expect(graph!.searchNodes('globalHidden')).toHaveLength(0);

    fs.writeFileSync(path.join(root, 'global-cache', 'hidden.ts'), 'export const globalChanged = 2;\n');
    fs.renameSync(
      path.join(root, 'global-cache', 'hidden.ts'),
      path.join(root, 'global-cache', 'renamed.ts'),
    );
    const ignoredChanges = await graph!.sync({
      paths: ['global-cache/hidden.ts', 'global-cache/renamed.ts'],
    });
    expect(ignoredChanges.filesAdded + ignoredChanges.filesModified + ignoredChanges.filesRemoved).toBe(0);
    expect(graph!.searchNodes('globalChanged')).toHaveLength(0);

    fs.writeFileSync(path.join(root, 'src', 'positive.ts'), 'export const positive = 1;\n');
    const positive = await graph!.sync({ paths: ['src/positive.ts'] });
    expect(positive.filesAdded).toBe(1);
    expect(graph!.searchNodes('positive').length).toBeGreaterThan(0);

    // Simulate a row admitted by an older/broken incremental path. A supported
    // full reconciliation must remove it without touching positive files.
    await graph!.indexFiles(['global-cache/renamed.ts']);
    expect(graph!.searchNodes('globalChanged').length).toBeGreaterThan(0);
    const healed = await graph!.sync();
    expect(healed.filesRemoved).toBe(1);
    expect(graph!.searchNodes('globalChanged')).toHaveLength(0);
    expect(graph!.searchNodes('positive').length).toBeGreaterThan(0);

    graph!.destroy();
    graph = AfyxGraph.openSync(root);
    const restarted = await graph.sync();
    expect(restarted.filesAdded).toBe(0);
    expect(graph.searchNodes('globalChanged')).toHaveLength(0);
    expect(graph.searchNodes('positive').length).toBeGreaterThan(0);

    fs.rmSync(path.join(root, 'global-cache', 'renamed.ts'));
    const deleted = await graph.sync({ paths: ['global-cache/renamed.ts'] });
    expect(deleted.filesRemoved).toBe(0);
  }, 30_000);

  it('fails open safely for unset, missing, and unreadable exclude configuration', async () => {
    await initialize('missing-ignore', 'unused/\n');
    fs.rmSync(path.join(root, 'missing-ignore'));
    await expect(graph!.sync({ paths: ['src/visible.ts'] })).resolves.toMatchObject({ filesAdded: 0 });

    git('config', '--unset', 'core.excludesFile');
    fs.writeFileSync(path.join(root, 'src', 'still-visible.ts'), 'export const stillVisible = 1;\n');
    await expect(graph!.sync({ paths: ['src/still-visible.ts'] })).resolves.toMatchObject({ filesAdded: 1 });
    expect(graph!.searchNodes('stillVisible').length).toBeGreaterThan(0);

    const configuredDirectory = path.join(root, 'not-an-exclude-file');
    fs.mkdirSync(configuredDirectory);
    git('config', 'core.excludesFile', configuredDirectory);
    fs.writeFileSync(path.join(root, 'src', 'also-visible.ts'), 'export const alsoVisible = 1;\n');
    await expect(graph!.sync({ paths: ['src/also-visible.ts'] })).resolves.toMatchObject({ filesAdded: 1 });
    expect(graph!.searchNodes('alsoVisible').length).toBeGreaterThan(0);
  }, 20_000);
});
