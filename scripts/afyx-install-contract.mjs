import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const inside = (root, path) => { const part = relative(root, path); return part === '' || (!part.startsWith('..') && !isAbsolute(part)); };

// Snapshot owned program files only. Runtime indexes, backups and old releases
// are deliberately outside current/. No component-state decisions live here.
export function targetFingerprint(target, type) {
  const hash = createHash('sha256');
  let count = 0;
  let bytes = 0;
  const activeLinks = new Set();
  const visit = (path, label, boundary) => {
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update(`${label}:MISSING\n`); return;
    }
    if (stat.isSymbolicLink()) {
      hash.update(`${label}:LINK:${readlinkSync(path)}\n`);
      const actual = realpathSync(path);
      if (!inside(boundary, actual)) throw new Error(`Plan snapshot refuses a link outside its component: ${path}`);
      if (activeLinks.has(actual)) throw new Error(`Plan snapshot refuses a link cycle: ${path}`);
      activeLinks.add(actual);
      try { visit(actual, `${label}/resolved`, boundary); } finally { activeLinks.delete(actual); }
      return;
    }
    if (++count > 20000) throw new Error('Plan snapshot file limit exceeded');
    if (stat.isDirectory()) {
      hash.update(`${label}:DIRECTORY\n`);
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${label}/${name}`, boundary);
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > 256 * 1024 * 1024) throw new Error('Plan snapshot byte limit exceeded');
      hash.update(`${label}:${stat.size}:`).update(readFileSync(path)).update('\n');
    } else throw new Error(`Unsupported component filesystem entry: ${path}`);
  };
  const root = resolve(target);
  // Canonicalize parent aliases such as macOS /var -> /private/var, while
  // retaining the existing rejection of a component root that is itself a link.
  const boundary = existsSync(root) && !lstatSync(root).isSymbolicLink() ? realpathSync(root) : root;
  if (type === 'runtime') {
    for (const name of ['metadata.json', 'integrity.sha256', 'current']) visit(join(root, name), name, boundary);
  } else visit(root, '.', boundary);
  return hash.digest('hex');
}

export function createInstallPlan(input) {
  if (!input || !Array.isArray(input.components) || !input.sourceRoot) throw new Error('Invalid backend install plan');
  const contract = JSON.parse(readFileSync(join(input.sourceRoot, 'scripts/components.json'), 'utf8'));
  const configureProviders = input.configureProviders === true || input.configureProviders === 'true';
  const providers = String(input.providers || '').split(',').filter(Boolean);
  const components = input.components.map((entry) => ({
    id: String(entry.id), name: String(entry.name), type: String(entry.type),
    currentState: String(entry.currentState), desired: entry.desired === true || entry.desired === 'true',
    backendAction: String(entry.backendAction).toLowerCase(), target: resolve(entry.target),
    ownership: String(entry.ownership), version: String(entry.version || ''),
    availableVersion: String(entry.availableVersion || ''), compatibility: String(entry.compatibility),
    detail: String(entry.detail || ''),
    prerequisites: (contract.prerequisites || []).filter((requirement) =>
      (!requirement.component || requirement.component === entry.id) &&
      (requirement.key !== 'codex-or-vscode' || (configureProviders && providers.includes('codex')))),
    snapshot: targetFingerprint(entry.target, entry.type),
  }));
  const configPaths = [...new Set(input.configurationPaths || [])].map((path) => resolve(path)).sort();
  const configuration = configPaths.map((path) => ({ path,
    snapshot: existsSync(path) ? digest(readFileSync(path)) : 'MISSING' }));
  const seenTargets = new Set(components.map((entry) => entry.target));
  const additionalTargets = (input.additionalTargets || []).filter((entry) => {
    const target = resolve(entry.target);
    if (seenTargets.has(target)) return false;
    seenTargets.add(target); return true;
  }).map((entry) => ({ id: entry.id, target: resolve(entry.target), type: entry.type,
    snapshot: targetFingerprint(entry.target, entry.type) }));
  const source = ['install.ps1', 'install.sh', 'verify.ps1', 'verify.sh', 'scripts/components.json',
    'scripts/afyx-install-contract.mjs', 'scripts/afyx-npm-installer.mjs']
    .map((path) => [path, digest(readFileSync(join(input.sourceRoot, path)))]);
  const plan = { schema: 'AfyxInstallPlan/v1', preset: input.preset,
    providers, scope: input.scope, configureProviders,
    workspaceRoot: resolve(input.workspaceRoot), platform: input.platform,
    components, additionalTargets, configuration, source, warnings: input.warnings || [], blockers: input.blockers || [],
    policy: { contextOptIn: process.env.AFYX_CONTEXT_OPT_IN ?? '' } };
  return { ...plan, fingerprint: digest(JSON.stringify(plan)) };
}

export function encodeContract(value) {
  return `AFYX_CONTRACT=${Buffer.from(JSON.stringify(value)).toString('base64')}`;
}

export function decodeContract(output, schema) {
  const matches = [...String(output).matchAll(/^AFYX_CONTRACT=([A-Za-z0-9+/=]+)\r?$/gm)];
  if (matches.length !== 1) throw new Error('Backend did not return exactly one structured contract');
  const value = JSON.parse(Buffer.from(matches[0][1], 'base64').toString('utf8'));
  if (value.schema !== schema) throw new Error(`Unexpected backend contract: ${value.schema}`);
  return value;
}

function main(args) {
  const mode = args.shift();
  if (mode === 'plan') {
    const input = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    const plan = createInstallPlan(input);
    if (input.expectedFingerprint && input.expectedFingerprint !== plan.fingerprint) throw new Error('PLAN_CHANGED: installation state changed; review a new plan before applying');
    process.stdout.write(`${encodeContract(plan)}\n`);
  } else if (mode === 'plan-rows') {
    const [preset, providers, scope, configureProviders, workspaceRoot, sourceRoot, platform, expectedFingerprint, ...rest] = args;
    const input = { preset, providers, scope, configureProviders, workspaceRoot, sourceRoot, platform, expectedFingerprint, components: [], additionalTargets: [], configurationPaths: [], blockers: [] };
    while (rest.length) {
      const kind = rest.shift();
      if (kind === '--config') input.configurationPaths.push(rest.shift());
      else if (kind === '--block') input.blockers.push(rest.shift());
      else if (kind === '--extra-target') {
        const [id, type, target] = rest.splice(0, 3);
        if (!target) throw new Error('Incomplete additional target');
        input.additionalTargets.push({ id, type, target });
      }
      else if (kind === '--component') {
        if (rest.length < 12) throw new Error('Incomplete backend component row');
        const [id, name, type, currentState, desired, backendAction, target, ownership, version, availableVersion, compatibility, detail] = rest.splice(0, 12);
        input.components.push({ id, name, type, currentState, desired, backendAction, target, ownership, version, availableVersion, compatibility, detail });
      } else throw new Error(`Unknown plan row: ${kind}`);
    }
    const plan = createInstallPlan(input);
    if (expectedFingerprint && expectedFingerprint !== plan.fingerprint) throw new Error('PLAN_CHANGED: installation state changed; review a new plan before applying');
    process.stdout.write(`${encodeContract(plan)}\n`);
  } else if (mode === 'verification') {
    const rows = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    process.stdout.write(`${encodeContract({ schema: 'AfyxVerification/v1', rows })}\n`);
  } else if (mode === 'verification-rows') {
    if (args.length % 3) throw new Error('Incomplete verification row');
    const rows = [];
    while (args.length) { const [state, name, detail] = args.splice(0, 3); rows.push({ state, name, detail }); }
    process.stdout.write(`${encodeContract({ schema: 'AfyxVerification/v1', rows })}\n`);
  } else throw new Error('Unknown install contract operation');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 3; }
}
