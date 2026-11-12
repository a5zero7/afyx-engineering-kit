import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';
import { PACKAGE_ROOT } from './afyx-npm-installer.mjs';

const stages = ['DETECT', 'SELECT', 'CONFIGURE', 'REVIEW / APPLY', 'FINISH'];
const supported = ['antigravity', 'claude', 'codex'];

export function terminalMode({ input = process.stdin, output = process.stdout, env = process.env, requested = 'auto' } = {}) {
  const interactive = Boolean(input.isTTY && output.isTTY && !env.CI);
  const ansi = interactive && !env.NO_COLOR && !env.AFYX_PLAIN_OUTPUT && env.TERM !== 'dumb' &&
    (output.columns || 80) >= 80 && (output.rows || 24) >= 24;
  if (requested === 'tui' && !ansi) throw new Error('--ui tui requires an interactive ANSI terminal at least 80 columns by 24 rows. Use --ui plain.');
  return requested === 'plain' ? 'plain' : ansi ? 'tui' : 'plain';
}

export function discoverHosts(pkgRoot = PACKAGE_ROOT) {
  try {
    const raw = execFileSync(process.execPath, [join(pkgRoot, 'scripts', 'afyx-provider-inventory.mjs'), '--json'], { encoding: 'utf8', timeout: 10000 });
    return JSON.parse(raw).filter((entry) => supported.includes(entry.id));
  } catch { return []; }
}

export function providerSelectable(entry, platform = process.platform) {
  const types = new Set((entry.products || []).map((product) => product.type));
  if (entry.id === 'antigravity') return types.has('CLI') || (platform === 'win32' && types.has('IDE/Desktop'));
  if (entry.id === 'codex' || entry.id === 'claude') return types.has('CLI') || types.has('VS Code Extension');
  return false;
}

export function presetComponents(preset, selected = [], pkgRoot = PACKAGE_ROOT) {
  const contract = JSON.parse(readFileSync(join(pkgRoot, 'scripts', 'components.json'), 'utf8'));
  return contract.components.filter((component) => preset === 'custom'
    ? selected.includes(component.id)
    : component.presets.split(';').includes(preset)).map((component) => component.id);
}

export function runtimeSupport(preset, platform = process.platform, arch = process.arch) {
  if (preset !== 'full') return { supported: true, reason: '' };
  if (platform === 'darwin') return { supported: false, reason: 'Full requires a verified macOS Graph archive; choose Recommended or Minimal.' };
  if (arch !== 'x64') return { supported: false, reason: `Full Graph archive is unavailable for ${platform}/${arch}.` };
  return { supported: true, reason: '' };
}

function fit(value, width) {
  const text = String(value).replace(/[\r\n\t]/g, ' ');
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

function panel(title, lines, width) {
  const inner = Math.max(16, width - 4);
  const top = `┌ ${fit(title, inner)} ${'─'.repeat(Math.max(0, inner - title.length))}┐`;
  return [top, ...lines.map((line) => `│ ${fit(line, inner).padEnd(inner)} │`), `└${'─'.repeat(inner + 2)}┘`];
}

export function renderFrame({ stage = 0, providers = [], selection = [], activity = [], width = 80, hint = '' } = {}) {
  const safeWidth = Math.max(40, width);
  const stepLine = stages.map((name, index) => `${index + 1} ${name}${index === stage ? ' ●' : ''}`).join(' → ');
  const providerLines = providers.length ? providers.flatMap((entry) => {
    const products = (entry.products || []).map((product) => `${product.type}${product.version ? ` ${product.version}` : ''}`);
    const compact = `${entry.name}: ${products.join(', ') || 'not detected'}`;
    if (safeWidth < 112 && compact.length <= safeWidth - 4) return [compact];
    return [`${entry.name}: ${products.length ? 'detected' : 'not detected'}`, ...products.map((product) => `  ${product}`)];
  }) : ['No supported provider detected'];
  let body;
  if (safeWidth >= 112) {
    const columnWidth = Math.floor((safeWidth - 4) / 3);
    const height = Math.max(providerLines.length, selection.length, activity.length, 3);
    const columns = [
      panel('PROVIDERS / HOST', [...providerLines, ...Array(height - providerLines.length).fill('')], columnWidth),
      panel('SELECTION / STATUS', [...selection, ...Array(height - selection.length).fill('')], columnWidth),
      panel('PLAN / ACTIVITY', [...activity, ...Array(height - activity.length).fill('')], columnWidth),
    ];
    body = columns[0].map((_, index) => columns.map((column) => column[index]).join(' '));
  } else {
    body = [panel('PROVIDERS / HOST', providerLines, safeWidth), panel('SELECTION / STATUS', selection, safeWidth), panel('PLAN / ACTIVITY', activity, safeWidth)].flatMap((lines) => [...lines, '']);
  }
  return [
    'AFYX / ENGINEERING KIT',
    'MIDNIGHT CIRCUIT | ALPHA INSTALLER',
    fit(stepLine, safeWidth),
    '',
    ...body,
    fit(hint, safeWidth),
  ].join('\n');
}

async function choose({ input, output, frame, options, selected = 0, multiple = false }) {
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  const checks = new Set();
  let cursor = selected;
  const draw = () => {
    const rows = options.map((option, index) => `${index === cursor ? '›' : ' '} ${multiple ? checks.has(index) ? '[x]' : '[ ]' : index === cursor ? '●' : '○'} ${option.label}`);
    const screen = frame(rows)
      .replace(/^›[^\n]*/gm, (line) => `\x1b[1;36m${line}\x1b[0m`)
      .replace(/\b(PASS|FAILED|SKIPPED|NOT SUPPORTED)\b/g, (status) => `\x1b[${status === 'PASS' ? '32' : status === 'FAILED' ? '31' : '33'}m${status}\x1b[0m`);
    output.write(`\x1b[H\x1b[0J${screen}`);
  };
  draw();
  try {
    return await new Promise((resolve, reject) => {
      const onKey = (_text, key = {}) => {
        if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('Installer canceled (Ctrl+C).')); return; }
        if (key.name === 'escape') { cleanup(); resolve(null); return; }
        if (key.name === 'up' || key.name === 'left' || key.name === 'k') cursor = (cursor - 1 + options.length) % options.length;
        else if (key.name === 'down' || key.name === 'right' || key.name === 'j' || key.name === 'tab') cursor = (cursor + 1) % options.length;
        else if (multiple && key.name === 'space') { checks.has(cursor) ? checks.delete(cursor) : checks.add(cursor); }
        else if (key.name === 'return') { cleanup(); resolve(multiple ? [...checks].map((index) => options[index].id) : options[cursor].id); return; }
        draw();
      };
      const onResize = () => draw();
      const onEnd = () => { cleanup(); reject(new Error('Terminal input closed before confirmation.')); };
      const onTerm = () => { cleanup(); reject(new Error('Installer interrupted (SIGTERM).')); };
      const cleanup = () => {
        input.off('keypress', onKey);
        input.off('end', onEnd);
        output.off('resize', onResize);
        process.off('SIGTERM', onTerm);
      };
      input.on('keypress', onKey);
      input.on('end', onEnd);
      output.on('resize', onResize);
      process.on('SIGTERM', onTerm);
    });
  } finally {
    input.setRawMode(false);
    input.pause();
    output.write('\n');
  }
}

export async function runMidnightCircuit({ input = process.stdin, output = process.stdout, pkgRoot = PACKAGE_ROOT, platform = process.platform, arch = process.arch, hosts } = {}) {
  const providers = hosts ?? discoverHosts(pkgRoot);
  const available = providers.filter((entry) => providerSelectable(entry, platform)).map((entry) => entry.id);
  const frame = (stage, selection, activity, hint) => renderFrame({ stage, providers, selection, activity, width: output.columns || 80, hint });
  let providerMode = available.length ? 'all' : 'skip';
  let preset = 'recommended';
  let provider = [];
  let scope = 'global';
  let custom = [];
  let step = 0;
  const selectedComponents = () => presetComponents(preset, custom, pkgRoot)
    .filter((id) => id !== 'codex-usage-tracking' || (platform === 'win32' && provider.includes('codex')));
  output.write('\x1b[2J\x1b[H');
  while (true) {
    if (step === 0) {
      const result = await choose({ input, output, frame: (rows) => frame(0, rows, ['Inspecting supported host installations.', 'No configuration changes before confirmation.'], 'Enter: continue  Esc: cancel  Ctrl+C: cancel'), options: [{ id: 'continue', label: 'Continue to selection' }] });
      if (result === null) return null;
      step = 1;
    } else if (step === 1) {
      const options = [
        { id: 'all', label: `All detected (${available.join(', ') || 'none'})` },
        { id: 'recommended', label: 'Recommended provider' },
        { id: 'custom', label: 'Custom provider selection' },
        { id: 'skip', label: 'Skip provider integration' },
      ];
      const chosen = await choose({ input, output, frame: (rows) => frame(1, rows, ['Provider selection is separate from component installation.'], '↑/↓: move  Enter: choose  Esc: back'), options, selected: options.findIndex((x) => x.id === providerMode) });
      if (chosen === null) { step = 0; continue; }
      providerMode = chosen;
      if (chosen === 'custom' && available.length) {
        const customHosts = await choose({ input, output, frame: (rows) => frame(1, rows, ['Space: toggle available providers.'], '↑/↓: move  Space: toggle  Enter: confirm  Esc: back'), options: providers.filter((entry) => providerSelectable(entry, platform)).map((entry) => ({ id: entry.id, label: entry.name })), multiple: true });
        if (customHosts === null) continue;
        provider = customHosts;
      } else provider = chosen === 'skip' ? [] : chosen === 'recommended' ? available.slice(0, 1) : [...available];
      step = 2;
    } else if (step === 2) {
      const choices = ['recommended', 'minimal', 'full', 'custom'].map((id) => ({ id, label: `${id[0].toUpperCase()}${id.slice(1)} — ${id === 'full' ? 'all applicable components' : id === 'custom' ? 'select exact components' : id === 'recommended' ? 'core skills + Engineering Expert' : 'core engineering skills'}` }));
      const chosen = await choose({ input, output, frame: (rows) => frame(2, rows, ['Choose a component preset.'], '↑/↓: move  Enter: choose  Esc: back'), options: choices, selected: choices.findIndex((x) => x.id === preset) });
      if (chosen === null) { step = 1; continue; }
      preset = chosen;
      const support = runtimeSupport(preset, platform, arch);
      if (!support.supported) { output.write(`${support.reason}\n`); continue; }
      if (preset === 'custom') {
        const all = JSON.parse(readFileSync(join(pkgRoot, 'scripts', 'components.json'), 'utf8')).components
          .filter((entry) => (entry.platforms === 'all' || (platform === 'win32' && entry.platforms === 'windows')) &&
            (entry.id !== 'codex-usage-tracking' || provider.includes('codex')));
        const selected = await choose({ input, output, frame: (rows) => frame(2, rows, ['Space: toggle components.'], '↑/↓: move  Space: toggle  Enter: confirm  Esc: back'), options: all.map((entry) => ({ id: entry.id, label: entry.name || entry.id })), multiple: true });
        if (selected === null || selected.length === 0) continue;
        if (selected.includes('afyx-graph') && !runtimeSupport('full', platform, arch).supported) {
          output.write(`${runtimeSupport('full', platform, arch).reason}\n`);
          continue;
        }
        custom = selected;
      }
      step = 3;
    } else if (step === 3) {
      const scopeOptions = [{ id: 'global', label: 'Global provider scope' }];
      if (!provider.includes('codex')) scopeOptions.push({ id: 'workspace', label: 'Workspace provider scope' });
      const chosen = await choose({ input, output, frame: (rows) => frame(2, rows, [`Preset: ${preset}`, `Components: ${selectedComponents().join(', ')}`, `Provider: ${provider.join(', ') || 'skipped'}`], '↑/↓: move  Enter: choose  Esc: back'), options: scopeOptions, selected: Math.max(0, scopeOptions.findIndex((item) => item.id === scope)) });
      if (chosen === null) { step = 2; continue; }
      scope = chosen;
      step = 4;
    } else if (step === 4) {
      const confirmation = await choose({ input, output, frame: (rows) => frame(3, rows, [`Preset: ${preset}`, `Components: ${selectedComponents().join(', ')}`, `Provider: ${provider.join(', ') || 'skipped'}`, `Scope: ${scope}`], 'Enter: apply  Esc: back'), options: [
        { id: 'apply', label: 'Apply installation plan' },
        { id: 'cancel', label: 'Cancel without changes' },
      ] });
      if (confirmation === null) { step = 3; continue; }
      if (confirmation === 'cancel') return null;
      break;
    }
  }
  output.write(`\x1b[2J\x1b[H${frame(3, ['Applying confirmed plan…'], ['Platform installer output follows.'], '')}\n`);
  const components = selectedComponents();
  const finish = (exitCode) => {
    const status = (id) => components.includes(id) ? 'NOT TESTED in UI' : 'SKIPPED';
    const activity = [
      `Components selected: ${components.join(', ')}`,
      `Provider: ${provider.join(', ') || 'skipped'}`,
      `Graph MCP: ${status('afyx-graph')}`,
      `Context: ${status('afyx-context')}`,
      `Forge: ${status('afyx-forge')}`,
      'Run afyx-engineering-kit verify for detailed status.',
    ];
    output.write(`\x1b[2J\x1b[H${frame(4, [`Installer: ${exitCode === 0 ? 'PASS' : 'FAILED'} (exit ${exitCode})`], activity, '')}\n`);
  };
  return { preset, provider: provider.join(','), providerScope: scope, customComponents: custom,
    skipProviderConfiguration: provider.length === 0, nonInteractive: true, finish };
}
