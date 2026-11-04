import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyInstallPlan,
  createInstallPlan,
  describeInstallPlan,
} from '../src/installer/plan';
import { getTarget } from '../src/installer/targets/registry';
import type {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from '../src/installer/targets/types';

function fakeTarget(overrides: Partial<AgentTarget> = {}) {
  const calls: string[] = [];
  let configured = false;
  const target: AgentTarget = {
    id: 'claude',
    displayName: 'Test provider',
    supportsLocation(location: Location) {
      calls.push(`supports:${location}`);
      return true;
    },
    detect(location: Location): DetectionResult {
      calls.push(`detect:${location}`);
      return { installed: true, alreadyConfigured: configured, configPath: '/config.json' };
    },
    install(location: Location, _options: InstallOptions): WriteResult {
      calls.push(`install:${location}`);
      configured = true;
      return { files: [{ path: '/config.json', action: 'created' }] };
    },
    uninstall(): WriteResult {
      calls.push('uninstall');
      configured = false;
      return { files: [] };
    },
    printConfig(): string {
      calls.push('print');
      return '{}';
    },
    describePaths(location: Location): string[] {
      calls.push(`paths:${location}`);
      return ['/config.json'];
    },
    ...overrides,
  };
  return { target, calls };
}

describe('Afyx installer plan', () => {
  const temporaryDirectories: string[] = [];
  const previousClaudeConfig = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    if (previousClaudeConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfig;
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps inspect/describe separate from apply and verifies after mutation', () => {
    const { target, calls } = fakeTarget();
    const plan = createInstallPlan([target], 'global', { autoAllow: true });

    expect(calls).toEqual(['supports:global', 'detect:global', 'paths:global']);
    expect(describeInstallPlan(plan)).toEqual({
      location: 'global',
      options: { autoAllow: true },
      targets: [{
        id: 'claude',
        displayName: 'Test provider',
        location: 'global',
        operation: 'create',
        supported: true,
        detection: { installed: true, alreadyConfigured: false, configPath: '/config.json' },
        paths: ['/config.json'],
      }],
    });

    const reports = applyInstallPlan(plan);
    expect(calls).toEqual([
      'supports:global', 'detect:global', 'paths:global',
      'install:global', 'detect:global',
    ]);
    expect(reports[0]?.status).toBe('configured');
    expect(reports[0]?.verification.alreadyConfigured).toBe(true);
  });

  it('does not inspect, describe or apply an unsupported location', () => {
    const { target, calls } = fakeTarget({ supportsLocation: () => false });
    const plan = createInstallPlan([target], 'local', { autoAllow: false });

    expect(calls).toEqual([]);
    expect(plan.entries[0]).toMatchObject({
      operation: 'unsupported',
      supported: false,
      paths: [],
    });
    expect(applyInstallPlan(plan)[0]?.status).toBe('unsupported');
    expect(calls).toEqual([]);
  });

  it('does not back up malformed Claude config until the apply step', () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-installer-plan-'));
    temporaryDirectories.push(profile);
    process.env.CLAUDE_CONFIG_DIR = profile;
    const config = path.join(profile, '.claude.json');
    fs.writeFileSync(config, '{ malformed');

    const claude = getTarget('claude')!;
    const plan = createInstallPlan([claude], 'global', { autoAllow: false });

    expect(fs.readFileSync(config, 'utf8')).toBe('{ malformed');
    expect(fs.existsSync(`${config}.backup`)).toBe(false);
    expect(plan.entries[0]?.operation).toBe('create');

    const report = applyInstallPlan(plan)[0]!;
    expect(report.status).toBe('configured');
    expect(fs.readFileSync(`${config}.backup`, 'utf8')).toBe('{ malformed');
    expect(JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers.afyx_graph).toBeDefined();
  });
});
