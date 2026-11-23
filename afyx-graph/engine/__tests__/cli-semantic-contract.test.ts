import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AfyxGraph } from '../src';
import { buildNodeTooOldBanner, isSupportedNodeVersion } from '../src/bin/node-version-check';
import { CLI_COMMANDS, prepareCliInvocation } from '../src/bin/cli-registry';

const BIN = path.resolve(__dirname, '../dist/bin/afyx-graph.js');
const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
).version as string;
const ROOT_HELP_SHA256 = '2d60cf29026867dcb1404400689db24f0bc3522e554a4d6a21b7cb6278b6daed';
const QUERY_HELP_SHA256 = '0ce2d5d2c93401f903871589a0db50b588e969524eb405253488bc81618b8bcd';

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  error: Error | undefined;
}

function nodePrerequisiteBanner(): string {
  const version = process.versions.node;
  if (!isSupportedNodeVersion(version)) return `${buildNodeTooOldBanner(version)}\n`;
  return '';
}

function runCli(
  args: string[],
  options: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): CliRun {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeout ?? 20_000,
    windowsHide: true,
    env: {
      ...process.env,
      AFYX_GRAPH_ALLOW_UNSAFE_NODE: '1',
      AFYX_GRAPH_NO_DAEMON: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      ...options.env,
    },
  });
  const prerequisite = nodePrerequisiteBanner();
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: prerequisite ? (result.stderr ?? '').replace(prerequisite, '') : result.stderr ?? '',
    signal: result.signal,
    error: result.error,
  };
}

describe('CLI public semantic contract', () => {
  let project: string;
  let isolatedHome: string;

  beforeAll(async () => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-cli-contract-project with spaces-'));
    isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-cli-contract-home-'));
    fs.mkdirSync(path.join(project, 'src'));
    fs.writeFileSync(
      path.join(project, 'src', 'contract.ts'),
      'export function cliContractNeedle(value: number): number { return value + 1; }\n',
    );
    fs.writeFileSync(
      path.join(project, 'src', 'contract.test.ts'),
      "import { cliContractNeedle } from './contract';\n" +
        'export const cliContractResult = cliContractNeedle(1);\n',
    );
    const graph = AfyxGraph.initSync(project);
    await graph.indexAll();
    graph.close();
  }, 60_000);

  afterAll(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  it('keeps the Afyx-native command registry and global invocation semantics explicit', () => {
    expect(CLI_COMMANDS.map(({ name }) => name)).toEqual([
      'init', 'uninit', 'index', 'sync', 'status', 'query', 'inventory', 'explore', 'context',
      'prompt-hook', 'node', 'files', 'daemon', 'ui', 'serve', 'unlock', 'callers',
      'callees', 'impact', 'affected', 'install', 'uninstall', 'upgrade', 'version',
    ]);
    expect(CLI_COMMANDS.find(({ name }) => name === 'daemon')?.aliases).toEqual(['daemons']);
    expect(CLI_COMMANDS.find(({ name }) => name === 'ui')?.aliases).toEqual(['web']);
    expect(CLI_COMMANDS.filter(({ hidden }) => hidden).map(({ name }) => name)).toEqual([
      'prompt-hook', 'serve',
    ]);
    expect(prepareCliInvocation(['node', 'afyx-graph', '-v', '--color'])).toEqual({
      argv: ['node', 'afyx-graph', '-v'],
      versionShortcut: true,
    });
    expect(prepareCliInvocation(['node', 'afyx-graph', 'index', '-v', '--no-color'])).toEqual({
      argv: ['node', 'afyx-graph', 'index', '-v'],
      versionShortcut: false,
    });
  });

  it('freezes root help, visible commands, aliases, and hidden internal commands', () => {
    const result = runCli(['--help']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(createHash('sha256').update(result.stdout).digest('hex')).toBe(ROOT_HELP_SHA256);
    expect(result.stdout).toContain('daemon|daemons');
    expect(result.stdout).toContain('ui|web');
    expect(result.stdout).not.toMatch(/^\s+(?:serve|prompt-hook)\b/m);
    expect(result.stdout.endsWith('\n')).toBe(true);

    const queryHelp = runCli(['query', '--help']);
    expect(queryHelp.code).toBe(0);
    expect(queryHelp.stderr).toBe('');
    expect(createHash('sha256').update(queryHelp.stdout).digest('hex')).toBe(QUERY_HELP_SHA256);
  });

  it('keeps every version spelling stdout-only with exit zero', () => {
    for (const spelling of ['version', '-v', '-version', '--version', '-V']) {
      const result = runCli([spelling]);
      expect(result).toMatchObject({ code: 0, stdout: `${PACKAGE_VERSION}\n`, stderr: '' });
    }
  });

  it('keeps no-argument invocation as the interactive installer entrypoint', () => {
    const result = runCli([], {
      cwd: isolatedHome,
      timeout: 15_000,
      env: { HOME: isolatedHome, USERPROFILE: isolatedHome },
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Afyx Graph v${PACKAGE_VERSION}`);
  });

  it('routes unknown commands and Afyx CLI parse errors to stderr with exit one', () => {
    const cases = [
      { args: ['definitely-not-a-command'], message: "error: unknown command 'definitely-not-a-command'" },
      { args: ['query'], message: "error: missing required argument 'search'" },
      { args: ['query', 'needle', '--definitely-invalid'], message: "error: unknown option '--definitely-invalid'" },
    ];
    for (const contract of cases) {
      const result = runCli(contract.args);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe(contract.message);
    }
  });

  it('rejects an invalid numeric option before engine access', () => {
    const result = runCli(['context', 'task', '--max-nodes', 'zero', '--path', isolatedHome]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--max-nodes expects a positive integer');
  });

  it('reports missing option values and honors the option terminator', () => {
    const missing = runCli(['query', 'needle', '--path']);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr.trim()).toBe("error: option '--path' argument missing");

    const terminated = runCli(['query', '--', 'cliContractNeedle'], { cwd: project });
    expect(terminated.code).toBe(0);
    expect(terminated.stderr).toBe('');
    expect(terminated.stdout).toContain('cliContractNeedle');
  });

  it('keeps not-indexed diagnostics on stderr with exit one', () => {
    const result = runCli(['query', 'needle', '--path', isolatedHome]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Afyx Graph not initialized in ${isolatedHome}`);
  });

  it('preserves human output and JSON purity for an absolute path containing spaces', () => {
    const human = runCli(['query', 'cliContractNeedle', '--path', project, '--limit', '3']);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('Search Results for "cliContractNeedle"');
    expect(human.stdout).toContain('cliContractNeedle');
    expect(human.stdout).not.toMatch(/\x1b\[/);
    expect(human.stdout.endsWith('\n')).toBe(true);

    const positionedColors = runCli([
      'query', 'cliContractNeedle', '--path', project, '--color', '--no-color',
    ]);
    expect(positionedColors.code).toBe(0);
    expect(positionedColors.stdout).not.toMatch(/\x1b\[/);

    const machine = runCli(['query', 'cliContractNeedle', '--path', project, '--limit', '3', '--json']);
    expect(machine.code).toBe(0);
    const parsed = JSON.parse(machine.stdout) as Array<{ node?: { name?: string }; score?: number }>;
    expect(parsed[0]?.node?.name).toBe('cliContractNeedle');
    expect(typeof parsed[0]?.score).toBe('number');
  });

  it('handles valid and closed empty stdin deterministically for affected --stdin', () => {
    const valid = runCli(['affected', '--stdin', '--quiet', '--path', project], {
      input: 'src/contract.ts\n',
    });
    expect(valid.code).toBe(0);
    expect(valid.stdout).toBe('src/contract.test.ts\n');

    const empty = runCli(['affected', '--stdin', '--quiet', '--path', project], { input: '' });
    expect(empty.code).toBe(0);
    expect(empty.stdout).toBe('');
  });
});
