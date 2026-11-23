#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { probeMcp } from './afyx-mcp-integration.mjs';

const kit = fileURLToPath(new URL('../', import.meta.url));
const sha = (data) => createHash('sha256').update(data).digest('hex');
const write = (file, content) => writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
const json = (file, value) => write(file, JSON.stringify(value, null, 2) + '\n');
const prompt = 'Jelaskan hubungan createProject dengan seluruh pemanggil langsung. Cantumkan path, baris, dan simbol sumber yang mendukung jawaban. Gunakan alat yang tersedia sesuai izin sesi. Jangan ubah kode. Jawab dalam Bahasa Indonesia.\n';

const fixture = {
  'src/db.ts': 'export function createProject(name: string) { return { name }; }\n',
  'src/actions.ts': Array.from({ length: 53 }, (_, i) => ({
    1: "import { createProject } from './db';",
    3: 'export function createProjectAction(name: string, preview: boolean) {',
    39: '  if (preview) return createProject(name.trim());',
    52: '  return createProject(name);',
    53: '}',
  })[i + 1] ?? '').join('\n') + '\n',
};

function command(executable, args, cwd, env, timeout = 20_000) {
  return execFileSync(executable, args, { cwd, env, timeout, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 }).trim();
}

export async function prepareInteractiveDogfood({ graphArchive, model, effort } = {}) {
  const sourceRevision = command('git', ['rev-parse', 'HEAD'], kit, process.env);
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) throw new Error('SHA sumber tidak dapat diverifikasi.');
  if (command('git', ['status', '--porcelain', '--untracked-files=no'], kit, process.env)) {
    throw new Error('Commit perubahan tracked sebelum menyiapkan sesi yang dapat direproduksi.');
  }
  const archive = graphArchive && realpathSync(graphArchive);
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-interactive-dogfood-'));
  const installRoot = join(root, 'install');
  const evidence = join(root, 'reviewer');
  mkdirSync(evidence, { mode: 0o700 });
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'no-global.gitconfig'),
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  for (const key of Object.keys(gitEnv)) {
    if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_|CONFIG_VALUE_)/.test(key)) delete gitEnv[key];
  }

  const runs = {};
  for (const name of ['jit', 'off', 'on']) {
    const home = join(root, name, 'home');
    const project = join(root, name, 'project');
    const codexHome = join(home, '.codex');
    mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    mkdirSync(join(project, 'src'), { recursive: true });
    for (const [file, content] of Object.entries(fixture)) write(join(project, file), content);
    const git = (...args) => command('git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=' + join(root, 'no-hooks'),
      '-c', 'user.name=AFYX Fixture', '-c', 'user.email=fixture@example.invalid', ...args], project, gitEnv);
    git('init', '-q', '--template=');
    git('add', '--', 'src/db.ts', 'src/actions.ts');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture AFYX');
    const env = { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome, APPDATA: join(home, 'appdata'),
      LOCALAPPDATA: join(home, 'localappdata'), AFYX_INSTALL_ROOT: installRoot, AFYX_GRAPH_STATE_DIR: join(root, name, 'graph-state'),
      AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_NO_WATCH: '1', AFYX_CONTEXT_OPT_IN: '0',
      AFYX_AFYX_GRAPH_ENABLED: name === 'off' ? '0' : '1' };
    const args = [join(kit, 'scripts', 'afyx-host-bridge.mjs'), 'serve', '--mcp', '--install-root', installRoot,
      '--project-root', project, '--provider', 'codex', '--authorize', 'afyx-graph', '--host-timeout-ms', '30000'];
    const settings = ['approval_policy = "on-request"', 'sandbox_mode = "read-only"'];
    if (model) settings.push('model = ' + JSON.stringify(model));
    if (effort) settings.push('model_reasoning_effort = ' + JSON.stringify(effort));
    if (name !== 'off') settings.push('', '[mcp_servers.afyx_workflow_fixture]', 'command = ' + JSON.stringify(process.execPath),
      'args = ' + JSON.stringify(args), 'tool_timeout_sec = 30');
    write(join(codexHome, 'config.toml'), settings.join('\n') + '\n');
    runs[name] = { project, env, codexArgs: ['--no-daemon', '-C', project], bridgeArgs: name === 'off' ? null : args,
      fixtureRevision: git('rev-parse', 'HEAD'), promptPath: join(root, name + '-prompt.txt') };
    write(runs[name].promptPath, name === 'jit' ? prompt +
      'Gunakan afyx_workflow dengan taskType callers dan payload.symbol string createProject. Lakukan satu permintaan relasional pertama. Laporkan DEFERRED atau kegagalan bila muncul. Bila berhasil, ulangi sekali untuk mengamati reuse warm.\n' : prompt);
  }

  let graph = { status: 'ARCHIVE_REQUIRED' };
  if (archive) {
    const runtime = join(installRoot, 'graph');
    const env = { ...process.env, ...gitEnv, ...runs.jit.env, AFYX_GRAPH_RUNTIME_ROOT: runtime,
      AFYX_GRAPH_BIN_DIR: join(root, 'bin') };
    if (process.platform === 'win32') {
      command('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(kit, 'scripts', 'install-afyx-graph.ps1'),
        '-ArchivePath', archive, '-RuntimeRoot', runtime, '-SkipPathUpdate', '-SkipMcp', '-Offline', '-NoBuildFallback'], root, env, 120_000);
    } else {
      command('bash', [join(kit, 'scripts', 'install-afyx-graph.sh'), '--archive', archive, '--offline',
        '--no-build-fallback', '--skip-mcp'], root, env, 120_000);
    }
    const metadata = JSON.parse(readFileSync(join(runtime, 'metadata.json'), 'utf8'));
    const probe = await probeMcp(process.execPath, runs.jit.bridgeArgs[0], { args: runs.jit.bridgeArgs, tool: 'afyx_workflow' });
    if (!probe.ok) throw new Error('Discovery MCP gagal pada fixture disposable: ' + probe.detail);
    graph = { status: 'DISCOVERED', sourceRevision: metadata.source_revision ?? null,
      artifactSha256: metadata.artifact_sha256 ?? null,
      entrySha256: sha(readFileSync(join(runtime, 'current', 'lib', 'dist', 'bin', 'afyx-graph.js'))) };
  }

  if (Object.values(runs).some(({ project, env }) => existsSync(join(project, '.afyx-graph')) || existsSync(env.AFYX_GRAPH_STATE_DIR))) {
    throw new Error('Fixture tidak lagi cold.');
  }
  const fixtureSha256 = sha(JSON.stringify(fixture));
  json(join(evidence, 'oracle.json'), { fixtureSha256, symbol: 'createProject',
    caller: 'createProjectAction', definition: ['src/db.ts', 1], callsites: [39, 52].map((line) => ['src/actions.ts', line]) });
  json(join(evidence, 'paired-readiness.json'), { status: 'NOT_RUN', taskSha256: sha(prompt), fixtureSha256,
    sourceRevision: runs.off.fixtureRevision, model: model ?? null, effort: effort ?? null,
    conditions: ['OFF', 'ON'], verifier: join(kit, 'scripts', 'phase8-paired-evidence.mjs'),
    metrics: { tokens: null, wallMs: null, humanInterventions: null, rework: null } });
  const manifest = { contract: 'AfyxInteractiveDogfoodPreparation/v1', root, sourceRevision,
    fixtureSha256, graph, fixtureCold: true, agentAcceptance: 'NOT_RUN', phase8Acceptance: 'NOT_RUN', runs };
  json(join(root, 'session.json'), manifest);
  return { root, manifestPath: join(root, 'session.json'), graph: graph.status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { 'graph-archive': { type: 'string' }, model: { type: 'string' },
    effort: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) console.log('node scripts/prepare-interactive-dogfood-session.mjs [--graph-archive PATH] [--model MODEL --effort LEVEL]');
  else console.log(JSON.stringify(await prepareInteractiveDogfood({ graphArchive: values['graph-archive'], model: values.model, effort: values.effort })));
}

