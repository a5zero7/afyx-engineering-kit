#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const valueAfter = (flag, fallback = null) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const bin = path.resolve(valueAfter('--bin', 'dist/bin/afyx-graph.js'));
const project = path.resolve(valueAfter('--project', '.'));
const rounds = Number(valueAfter('--rounds', '5'));
const outputPath = valueAfter('--out');

if (!Number.isInteger(rounds) || rounds < 1) {
  throw new Error('--rounds must be a positive integer');
}
if (!fs.existsSync(bin)) throw new Error(`CLI binary does not exist: ${bin}`);
if (!fs.existsSync(path.join(project, '.afyx-graph', 'afyx-graph.db'))) {
  throw new Error(`Benchmark project is not indexed: ${project}`);
}

const unindexed = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-cli-benchmark-unindexed-'));
const env = {
  ...process.env,
  AFYX_GRAPH_ALLOW_UNSAFE_NODE: '1',
  AFYX_GRAPH_NO_DAEMON: '1',
  NO_COLOR: '1',
  FORCE_COLOR: '0',
};

const scenarios = [
  { name: 'help', args: ['--help'] },
  { name: 'version', args: ['--version'] },
  { name: 'unknownCommand', args: ['definitely-not-a-command'] },
  { name: 'missingArgument', args: ['query'] },
  {
    name: 'invalidNumericArgument',
    args: ['context', 'task', '--max-nodes', 'zero', '--path', unindexed],
  },
  { name: 'notIndexed', args: ['query', 'needle', '--path', unindexed] },
  { name: 'humanQuery', args: ['query', 'benchmarkCliFixture', '--path', project, '--limit', '3'] },
  { name: 'jsonQuery', args: ['query', 'benchmarkCliFixture', '--path', project, '--limit', '3', '--json'] },
  {
    name: 'closedStdin',
    args: ['affected', '--stdin', '--quiet', '--path', project],
    input: '',
  },
];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const normalize = (value) => value
  .split(project).join('<PROJECT>')
  .split(unindexed).join('<UNINDEXED>')
  .replaceAll('\\', '/');

function runScenario(scenario) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [bin, ...scenario.args], {
    cwd: project,
    env,
    input: scenario.input,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  const wallTimeMs = performance.now() - started;
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${scenario.name} exited by signal ${result.signal}`);
  const stdout = normalize(result.stdout ?? '');
  const stderr = normalize(result.stderr ?? '');
  return {
    wallTimeMs,
    contract: {
      exitCode: result.status,
      stdout,
      stderr,
      stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
      stderrBytes: Buffer.byteLength(stderr, 'utf8'),
    },
  };
}

try {
  const samples = Object.fromEntries(scenarios.map(({ name }) => [name, []]));
  const contract = {};
  for (let round = 0; round < rounds; round += 1) {
    const order = round % 2 === 0 ? scenarios : [...scenarios].reverse();
    for (const scenario of order) {
      const result = runScenario(scenario);
      samples[scenario.name].push(result.wallTimeMs);
      if (!(scenario.name in contract)) contract[scenario.name] = result.contract;
      else if (JSON.stringify(contract[scenario.name]) !== JSON.stringify(result.contract)) {
        throw new Error(`Non-deterministic CLI contract for ${scenario.name}`);
      }
    }
  }

  const timingSummaryMs = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => [name, {
      median: median(values),
      min: Math.min(...values),
      max: Math.max(...values),
      samples: values,
    }]),
  );
  const report = {
    generatedBy: 'scripts/benchmark-cli.mjs',
    node: process.version,
    platform: process.platform,
    bin,
    project,
    rounds,
    normalizations: [
      'indexed project path -> <PROJECT>',
      'unindexed temporary path -> <UNINDEXED>',
      'path separators -> forward slashes',
    ],
    timingSummaryMs,
    contract,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), serialized);
  process.stdout.write(serialized);
} finally {
  fs.rmSync(unindexed, { recursive: true, force: true });
}
