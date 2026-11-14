import { execFile } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { InstallerProgress, INSTALL_PROGRESS_PREFIX } from './afyx-install-progress.mjs';
import { join } from 'node:path';
import readline from 'node:readline';
import { PACKAGE_ROOT, getPackageVersion } from './afyx-npm-installer.mjs';
import { createBackendAdapter, summarizeExecution } from './afyx-install-backend.mjs';
import { GRAPH_PACKAGE_TARGETS } from './afyx-graph-targets.mjs';

const stages = ['DETECT', 'SELECT', 'CONFIGURE', 'REVIEW / APPLY', 'FINISH'];
const supported = ['antigravity', 'claude', 'codex'];

export function terminalMode({ input = process.stdin, output = process.stdout, env = process.env, requested = 'auto' } = {}) {
  const interactive = Boolean(input.isTTY && output.isTTY && !env.CI);
  const ansi = interactive && env.NO_COLOR === undefined && !env.AFYX_PLAIN_OUTPUT && env.TERM !== 'dumb' &&
    (output.columns || 80) >= 80 && (output.rows || 24) >= 24;
  if (requested === 'tui' && !ansi) throw new Error('--ui tui requires an interactive ANSI terminal at least 80 columns by 24 rows. Use --ui plain.');
  return requested === 'plain' ? 'plain' : ansi ? 'tui' : 'plain';
}

export function discoverHosts(pkgRoot = PACKAGE_ROOT, signal) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [join(pkgRoot, 'scripts', 'afyx-provider-inventory.mjs'), '--json'],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, signal }, (error, raw) => {
        if (error) { reject(new Error(`Provider discovery failed: ${error.message}`)); return; }
        try { const result = JSON.parse(raw); if (!Array.isArray(result)) throw new Error('Invalid inventory'); resolve(result); }
        catch (parseError) { reject(parseError); }
      });
  });
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
  if (!GRAPH_PACKAGE_TARGETS.includes(`${platform}-${arch}`)) return { supported: false, reason: `Full Graph archive is unavailable for ${platform}/${arch}.` };
  return { supported: true, reason: '' };
}

function fit(value, width) {
  const text = stripVTControlCharacters(String(value)).replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ');
  const characters = Array.from(text);
  return characters.length > width ? `${characters.slice(0, Math.max(0, width - 1)).join('')}…` : text;
}

function wrapLines(lines, inner) {
  return lines.flatMap((line) => {
    const text = stripVTControlCharacters(String(line)).replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ');
    if (!text) return [''];
    const chunks = [];
    const characters = Array.from(text);
    for (let index = 0; index < characters.length; index += inner) chunks.push(characters.slice(index, index + inner).join(''));
    return chunks;
  });
}

const tones = { cyan: '96', blue: '94', purple: '95', text: '97', muted: '90', success: '92', error: '91', warning: '93' };
const rgb = { cyan: '34;211;238', blue: '96;165;250', purple: '139;92;246', text: '229;242;255', muted: '147;164;187', success: '52;211;153', error: '251;113;133', warning: '251;191;36' };
const styled = (text, tone, color) => color ? `\x1b[${color === 24 ? `38;2;${rgb[tone]}` : tones[tone]}m${text}\x1b[0m` : text;
const plainOutputs = new WeakSet();
const previousFrames = new WeakMap();

export function recordInstallerDiagnostic(error) {
  const directory = mkdtempSync(join(tmpdir(), 'afyx-installer-diagnostic-'));
  const path = join(directory, 'diagnostic.log');
  writeFileSync(path, `${error?.stack || String(error)}\n`, { mode: 0o600 });
  return path;
}

function drawScreen(output, screen) {
  if (plainOutputs.has(output)) { output.write(`${stripVTControlCharacters(screen)}\n`); return; }
  const rows = screen.split('\n');
  const before = previousFrames.get(output) || [];
  let patch = '\x1b[?25l';
  for (let row = 0; row < Math.max(rows.length, before.length); row++) {
    if (rows[row] !== before[row]) patch += `\x1b[${row + 1};1H\x1b[2K${rows[row] || ''}`;
  }
  if (patch.length > 6) output.write(patch);
  previousFrames.set(output, rows);
}

function panel(title, lines, width, limit, offset = 0, color = false, tone = 'cyan') {
  const inner = Math.max(16, width - 4);
  const caption = fit(title, width - 4);
  const top = `╭ ${caption} ${'─'.repeat(Math.max(0, width - caption.length - 4))}╮`;
  let wrapped = wrapLines(lines, inner);
  if (limit && wrapped.length > limit) {
    const start = Math.max(0, Math.min(offset, wrapped.length - Math.max(1, limit - 1)));
    const total = wrapped.length;
    wrapped = [...wrapped.slice(start, start + Math.max(1, limit - 1)), fit(`Tab: focus activity; ↑/↓ scroll (${start + 1}/${total})`, inner)];
  }
  return [styled(top, tone, color), ...wrapped.map((line) => {
    const state = /\b(FAILED|FAIL|BLOCKED)\b/.test(line) ? 'error' : /\b(PASS|COMPLETED|HEALTHY)\b/.test(line) ? 'success'
      : /\b(WARNING|RESTART)\b/.test(line) ? 'warning' : /COMING SOON|OTHER DETECTED/.test(line) ? 'purple'
      : /^›/.test(line) ? 'cyan' : /INDETERMINATE|RUNNING/.test(line) ? 'blue' : 'text';
    return `${styled('│', tone, color)} ${styled(line.padEnd(inner), state, color)} ${styled('│', tone, color)}`;
  }), styled(`╰${'─'.repeat(width - 2)}╯`, tone, color)];
}

export function renderFrame({ stage = 0, providers = [], providerSummary, selection = [], activity = [], width = 80, height = 24, activityOffset = 0, providerOffset = 0, hint = '', color = false, ascii = false, failed = false, installing = false, receipt = false, discovering = false, runtime = '' } = {}) {
  const safeWidth = Math.max(40, width);
  const labels = safeWidth < 112 ? ['DETECT', 'SELECT', 'CONFIG', 'APPLY', 'FINISH'] : stages;
  const stepLine = labels.map((name, index) => styled(`${index === stage ? '[' : ''}${String(index + 1).padStart(2, '0')} ${name}${index < stage ? ' +' : index === stage ? failed ? ' FAILED]' : ' *]' : ''}`, index < stage ? 'success' : index === stage ? failed ? 'error' : 'cyan' : 'muted', color)).join('  ');
  const ordered = [...providers].sort((a, b) => a.name.localeCompare(b.name));
  const inventoryLines = (entries) => entries.flatMap((entry) => {
    const products = (entry.products || []).map((product) => `${product.type}${product.version ? ` ${product.version}` : ''}`);
    return [`${entry.name}: ${entry.supported === false ? 'COMING SOON' : products.length ? 'detected' : 'not detected'}`, ...products.map((product) => `  ${product}`)];
  });
  const supportedLines = inventoryLines(ordered.filter((entry) => entry.supported !== false));
  const otherLines = inventoryLines(ordered.filter((entry) => entry.supported === false));
  const providerLines = [...(providerSummary || []), ...supportedLines, ...(otherLines.length ? ['OTHER DETECTED', ...otherLines] : [])];
  if (!providerLines.length) providerLines.push(discovering ? 'Discovery in progress' : 'No supported provider detected');
  const footer = wrapLines([hint], safeWidth).slice(0, 2);
  const budget = Math.max(9, height - 4 - footer.length);
  let body;
  if (safeWidth >= 80) {
    const providerWidth = Math.max(28, Math.floor((safeWidth - 1) * 0.30));
    const selectionWidth = safeWidth - providerWidth - 1;
    const contentLimit = Math.max(6, budget - 2);
    const choicesLimit = Math.max(3, Math.min(8, Math.floor(contentLimit * 0.5)));
    const recentLimit = Math.max(2, contentLimit - choicesLimit - 2);
    const activityLines = wrapLines(activity, selectionWidth - 4);
    const start = Math.max(0, Math.min(activityOffset, Math.max(0, activityLines.length - recentLimit)));
    const rightLines = [...selection.slice(0, choicesLimit).map((line) => fit(line, selectionWidth - 4)),
      '─'.repeat(selectionWidth - 4), `RECENT ACTIVITY${activityLines.length > recentLimit ? ` (${start + 1}/${activityLines.length}; Tab, ↑/↓)` : ''}`,
      ...activityLines.slice(start, start + recentLimit)];
    const left = panel('PROVIDERS / HOST', providerLines, providerWidth, contentLimit, providerOffset, color);
    const title = failed ? 'INSTALLATION FAILED' : installing ? 'INSTALLATION PROGRESS' : receipt ? 'VERIFIED RECEIPT'
      : stage === 3 ? 'REVIEW / APPLY' : stage === 4 ? 'FINISH / VERIFICATION' : 'SELECTION / CONFIGURATION';
    const right = panel(title, rightLines, selectionWidth, contentLimit, 0, color, 'purple');
    const rows = Math.max(left.length, right.length);
    body = Array.from({ length: rows }, (_, index) => `${left[index] || ' '.repeat(providerWidth)} ${right[index] || ' '.repeat(selectionWidth)}`);
  } else {
    const providerLimit = 2;
    const selectionLimit = Math.max(3, Math.floor((budget - 6 - providerLimit) / 2));
    const activityLimit = Math.max(2, budget - 6 - providerLimit - selectionLimit);
    body = [panel('PROVIDERS / HOST', providerLines, safeWidth, providerLimit, 0, color),
      panel('SELECTION / STATUS', selection, safeWidth, selectionLimit, 0, color, 'purple'),
      panel('PLAN / ACTIVITY', activity, safeWidth, activityLimit, activityOffset, color)].flat();
  }
  const screen = [
    styled('AFYX / ENGINEERING KIT', 'cyan', color),
    styled(fit(`Unified Installer | ${runtime || `v${getPackageVersion()}`} | I choose my path.`, safeWidth), 'purple', color),
    stripVTControlCharacters(stepLine).length <= safeWidth ? stepLine : fit(`STEP ${stage + 1}/5 ${stages[stage]}`, safeWidth),
    styled('─'.repeat(safeWidth), 'muted', color),
    ...body,
    ...footer.map((line) => styled(line, 'muted', color)),
  ].join('\n');
  return ascii ? stripVTControlCharacters(screen).replace(/[╭╮╰╯]/g, '+').replace(/─/g, '-').replace(/│/g, '|')
    .replace(/[›→]/g, '>').replace(/↑/g, '^').replace(/↓/g, 'v').replace(/●/g, '*').replace(/○/g, 'o')
    .replace(/[—–]/g, '-').replace(/…/g, '.').replace(/[^\x20-\x7e\n]/g, '?') : screen;
}

async function choosePlain({ input, output, frame, options, selected, multiple }) {
  const rows = options.map((option, index) => `${index + 1}. ${option.label}`);
  // Plain terminals have no panel scrolling: show every numbered option after
  // the context frame, including choices below the terminal's visible height.
  drawScreen(output, frame([], selected, { activityOffset: 0, activityFocus: false }));
  output.write(rows.map((row) => fit(row, Number.MAX_SAFE_INTEGER).replace(/[—–]/g, '-').replace(/[^\x20-\x7e]/g, '?')).join('\n') + '\n');
  const reader = readline.createInterface({ input, output, terminal: false });
  try {
    for (;;) {
      const answer = await new Promise((resolve) => {
        const closed = () => resolve('q');
        reader.once('close', closed);
        reader.question(multiple ? 'Select numbers separated by commas (empty = none; q = back): ' : `Select number (Enter = ${selected + 1}; q = back): `, (value) => {
          reader.off('close', closed); resolve(value.trim());
        });
      });
      if (/^(q|quit|back)$/i.test(answer)) return null;
      if (!answer) return multiple ? [] : options[selected].id;
      const indices = answer.split(',').map((value) => /^\d+$/.test(value.trim()) ? Number(value.trim()) - 1 : -1);
      if (indices.some((index) => index < 0 || index >= options.length) || (!multiple && indices.length !== 1)) {
        output.write('Invalid selection; use the displayed numbers.\n'); continue;
      }
      return multiple ? [...new Set(indices)].map((index) => options[index].id) : options[indices[0]].id;
    }
  } finally { reader.close(); }
}

async function choose({ input, output, frame, options, selected = 0, multiple = false }) {
  if (plainOutputs.has(output)) return choosePlain({ input, output, frame, options, selected, multiple });
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  const checks = new Set();
  let cursor = selected;
  let activityOffset = 0;
  let activityFocus = false;
  let providerOffset = 0;
  let providerFocus = false;
  const tooSmall = () => (output.columns || 80) < 80 || (output.rows || 24) < 24;
  const draw = () => {
    if (tooSmall()) {
      output.write('\x1b[H\x1b[0JResize the terminal to at least 80 columns by 24 rows. Esc cancels safely.\n');
      return;
    }
      const capacity = Math.max(3, Math.min(8, Math.floor(((output.rows || 24) - 8) / 2)));
    const start = Math.max(0, Math.min(cursor - Math.floor(capacity / 2), options.length - capacity));
    const rows = options.slice(start, start + capacity).map((option, offset) => {
      const index = start + offset;
      const width = output.columns || 80;
      const paneWidth = width >= 80 ? width - Math.max(28, Math.floor((width - 1) * 0.30)) - 1 : width;
      return fit(`${index === cursor ? '›' : ' '} ${multiple ? checks.has(index) ? '[x]' : '[ ]' : index === cursor ? '●' : '○'} ${option.label}`, paneWidth - 4);
    });
      const screen = frame(rows, cursor, { activityOffset, activityFocus, providerOffset, providerFocus });
      drawScreen(output, screen);
  };
  draw();
  try {
    return await new Promise((resolve, reject) => {
      const onKey = (_text, key = {}) => {
        if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('Installer canceled (Ctrl+C).')); return; }
        if (key.name === 'escape') { cleanup(); resolve(null); return; }
        if (tooSmall()) return;
        if (key.name === 'tab' || key.name === 'left' || key.name === 'right') {
          if (activityFocus) { activityFocus = false; providerFocus = true; }
          else if (providerFocus) providerFocus = false;
          else activityFocus = true;
        }
        else if (providerFocus && (key.name === 'up' || key.name === 'k')) providerOffset = Math.max(0, providerOffset - 1);
        else if (providerFocus && (key.name === 'down' || key.name === 'j')) providerOffset++;
        else if (key.name === 'home' && !activityFocus && !providerFocus) cursor = 0;
        else if (key.name === 'end' && !activityFocus && !providerFocus) cursor = options.length - 1;
        else if (activityFocus && (key.name === 'up' || key.name === 'k')) activityOffset = Math.max(0, activityOffset - 1);
        else if (activityFocus && (key.name === 'down' || key.name === 'j')) activityOffset++;
        else if (key.name === 'up' || key.name === 'k') { cursor = (cursor - 1 + options.length) % options.length; activityOffset = 0; }
        else if (key.name === 'down' || key.name === 'j') { cursor = (cursor + 1) % options.length; activityOffset = 0; }
        else if (multiple && key.name === 'space' && !activityFocus && !providerFocus) { checks.has(cursor) ? checks.delete(cursor) : checks.add(cursor); }
        else if (key.name === 'return') { if (activityFocus || providerFocus) { activityFocus = false; providerFocus = false; } else { cleanup(); resolve(multiple ? [...checks].map((index) => options[index].id) : options[cursor].id); return; } }
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
    output.write('\x1b[0m\x1b[?25h');
  }
}

export async function runMidnightCircuit({ input = process.stdin, output = process.stdout, pkgRoot = PACKAGE_ROOT, platform = process.platform, arch = process.arch, hosts, options = {}, plain = false, backend = createBackendAdapter({ platform, pkgRoot }) } = {}) {
  if (plain) plainOutputs.add(output); else plainOutputs.delete(output);
  previousFrames.delete(output);
  let providers = hosts ?? [];
  let available = [];
  const progressModel = new InstallerProgress({ reducedMotion: process.env.AFYX_REDUCED_MOTION === '1' });
  const frame = (stage, selection, activity, hint, view = {}) => renderFrame({ stage, providers,
    providerSummary: stage >= 3 ? [`Selected: ${provider.join(', ') || 'skipped'}; scope: ${scope}`] : undefined,
    selection, activity, width: output.columns || 80, height: plain ? Math.max(40, 20 + providers.length * 6 + selection.length + activity.length) : output.rows || 24, ...view,
    color: !plain && process.env.NO_COLOR === undefined ? output.getColorDepth?.() >= 24 ? 24 : 16 : false, ascii: plain,
    runtime: `v${getPackageVersion()} | ${platform}/${arch} | Node ${process.versions.node}`,
    discovering: [...progressModel.operations.values()].some((item) => item.phase === 'discovery' && item.state === 'running'),
    hint: `${hint}${view.activityFocus ? ' [ACTIVITY FOCUS]' : view.providerFocus ? ' [PROVIDERS FOCUS]' : ''}` });
  let providerMode = 'skip';
  let preset = 'recommended';
  let provider = [];
  let scope = 'global';
  let custom = [];
  let step = 0;
  let reviewedPlan;
  let reviewNotice = '';
  const backendOptions = () => ({ ...options, preset, provider: provider.join(','), providerScope: scope,
    customComponents: custom, skipProviderConfiguration: provider.length === 0, nonInteractive: true });
  const selectedComponents = () => presetComponents(preset, custom, pkgRoot)
    .filter((id) => id !== 'codex-usage-tracking' || (platform === 'win32' && provider.includes('codex')));
  if (!plain) output.write('\x1b[2J\x1b[H');
  const operation = async (phase, message, stage, action) => {
    const id = progressModel.begin(phase, message);
    const show = () => drawScreen(output, frame(stage, [progressModel.current()], progressModel.activity.slice(-5), 'Working — Ctrl+C interrupts safely.'));
    show();
    const timer = !plain ? setInterval(show, progressModel.reducedMotion ? 1000 : 80) : null;
    const controller = new AbortController();
    const cancel = () => { controller.abort(); progressModel.stop('cancelled'); if (!plain) output.write('\x1b[0m\x1b[?25h'); };
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try { const result = await action(controller.signal); progressModel.end(id); return result; }
    catch (error) { progressModel.end(id, controller.signal.aborted ? 'cancelled' : 'failed', `${message}: ${String(error.message).split('\n')[0].slice(0, 512)}`); throw error; }
    finally { if (timer) clearInterval(timer); process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
  };
  providers = hosts ?? await operation('discovery', 'Discovering CLI, IDE and extension inventory', 0, (signal) => discoverHosts(pkgRoot, signal));
  available = providers.filter((entry) => providerSelectable(entry, platform)).map((entry) => entry.id);
  providerMode = available.length ? 'all' : 'skip';
  const plan = async (phase = 'planning') => {
    try { return await operation(phase, phase === 'revalidation' ? 'Revalidating plan fingerprint' : 'Generating read-only installation plan', 3, (signal) => backend.plan(backendOptions(), { signal })); }
    catch (error) {
      const diagnostic = recordInstallerDiagnostic(error);
      drawScreen(output, frame(3, ['FAILED — backend plan unavailable'],
        [String(error.message).split('\n')[0], `Diagnostic log: ${diagnostic}`, 'No installation has been applied.'], 'Run again after resolving the diagnostic.', { failed: true }));
      throw new Error(`Backend plan failed. Diagnostic log: ${diagnostic}`);
    }
  };
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
      const chosen = await choose({ input, output, frame: (rows) => frame(1, rows, ['Choose a component preset.'], '↑/↓: move  Enter: choose  Esc: back'), options: choices, selected: choices.findIndex((x) => x.id === preset) });
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
      drawScreen(output, frame(3, ['Reading the backend installation plan…'], ['Read-only inspection; no installation changes yet.'], ''));
      reviewedPlan = await plan();
      const items = reviewedPlan.components;
      const choices = items.map((item) => ({ id: item.id, label: `${item.name}: ${item.backendAction.toUpperCase()} (${item.currentState})` }));
      choices.push({ id: 'apply', label: 'Apply exactly this reviewed plan' }, { id: 'cancel', label: 'Cancel without changes' });
      const confirmation = await choose({ input, output, frame: (rows, cursor, view) => {
        const item = items[cursor];
        const details = item ? [
          `${item.id}: current=${item.currentState}; desired=${item.desired}; action=${item.backendAction}`,
          `Target: ${item.target}`,
          ...(reviewedPlan.additionalTargets || []).filter((target) => target.id === item.id).map((target) => `Provider target: ${target.target}`),
          `Ownership: ${item.ownership}; platform: ${item.compatibility}`,
          `Version: ${item.version || 'none'} → ${item.availableVersion || 'n/a'}; ${item.detail}`,
          `Prerequisites: ${(item.prerequisites || []).map((requirement) => requirement.key).join(', ') || 'none declared'}`,
        ] : [reviewNotice || 'Backend state and owned files are fingerprinted before confirmation.',
          ...(reviewedPlan.blockers || []).map((reason) => `BLOCK: ${reason}`),
          ...items.filter((entry) => entry.desired && entry.backendAction === 'blocked').map((entry) => `BLOCK: ${entry.name}: ${entry.detail}`)];
        return frame(3, rows, details, '↑/↓: inspect  Tab: focus activity  Enter: choose  Esc: back', view);
      }, options: choices, selected: items.length });
      if (confirmation === null) { step = 3; continue; }
      if (confirmation === 'cancel') return null;
      if (confirmation !== 'apply') continue;
      if ((reviewedPlan.blockers || []).length || items.some((item) => item.desired && item.backendAction === 'blocked')) {
        reviewNotice = 'The backend plan is BLOCKED. Resolve the displayed ownership/prerequisite issue first.';
        continue;
      }
      drawScreen(output, frame(3, ['Revalidating the reviewed plan…'], ['Owned program files and provider configuration must still match.'], ''));
      const currentPlan = await plan('revalidation');
      if (currentPlan.fingerprint !== reviewedPlan.fingerprint) {
        reviewNotice = 'PLAN CHANGED: installation state changed. Inspect and confirm the updated plan.';
        continue;
      }
      break;
    }
  }
  const tracePath = join(mkdtempSync(join(tmpdir(), 'afyx-installer-execution-')), 'backend.log');
  writeFileSync(tracePath, `Source root: ${pkgRoot}\nPlan: ${reviewedPlan.fingerprint}\n`, { mode: 0o600 });
  const applyId = progressModel.begin('install', 'Applying confirmed installation plan');
  const selectedItems = reviewedPlan.components.filter((item) => item.desired);
  const plannedOperations = new Set(selectedItems.filter((item) => item.backendAction !== 'skip').map((item) => item.id));
  const completedOperations = new Set();
  if (plannedOperations.size) progressModel.accept({ operationId: applyId, phase: 'install', state: 'running', completed: 0, total: plannedOperations.size, message: 'Component operations; final verification pending' });
  const buffers = new Map();
  const showProgress = () => {
    const known = new Map([...progressModel.operations.values()].filter((item) => item.componentId).map((item) => [item.componentId, item]));
    const lines = selectedItems.map((item) => `${item.name}: ${known.has(item.id) ? progressModel.describe(known.get(item.id)) : item.backendAction === 'skip' ? 'UNCHANGED; VERIFY PENDING' : 'QUEUED'}`);
    drawScreen(output, frame(3, lines, [progressModel.current(), 'Final installation verification is pending.', ...progressModel.activity.slice(-5), `Backend log: ${tracePath}`], 'Ctrl+C: interrupt safely; completed changes require verification.', { installing: true }));
  };
  const consume = (raw) => {
    const line = stripVTControlCharacters(raw).trim();
    if (line.startsWith(INSTALL_PROGRESS_PREFIX)) {
      try {
        const event = JSON.parse(line.slice(INSTALL_PROGRESS_PREFIX.length));
        if (event.componentId && !reviewedPlan.components.some((item) => item.id === event.componentId)) throw new Error('Unknown progress component');
        const accepted = progressModel.accept(event);
        if (plannedOperations.has(accepted.componentId) && accepted.state === 'completed' && ['install', 'update', 'repair'].includes(accepted.phase)) {
          completedOperations.add(accepted.componentId);
          progressModel.accept({ operationId: applyId, phase: 'install', state: 'running', completed: completedOperations.size,
            total: plannedOperations.size, message: 'Component operations; final verification pending' });
        }
      } catch {
        progressModel.activity.push('WARNING: malformed backend progress; see complete backend log.');
      }
    } else if (/\b(error|failed|warning|rollback|recovery)\b/i.test(line)) {
      progressModel.activity.push(`Backend diagnostic: ${line.slice(0, 512)}`);
    }
    if (progressModel.activity.length > 64) progressModel.activity.splice(0, progressModel.activity.length - 64);
  };
  let lastPlainActivity = '';
  const onOutput = (chunk, stream = 'stdout') => {
    appendFileSync(tracePath, chunk);
    const lines = ((buffers.get(stream) || '') + chunk).split(/\r?\n/);
    buffers.set(stream, lines.pop().slice(-65_536));
    for (const line of lines) consume(line);
    if (plain && progressModel.activity.at(-1) !== lastPlainActivity) {
      lastPlainActivity = progressModel.activity.at(-1);
      output.write(`${lastPlainActivity}\n`);
    }
  };
  showProgress();
  let animation = null;
  const startProgress = () => {
    if (!animation && !plain) animation = setInterval(showProgress, progressModel.reducedMotion ? 1000 : 80);
  };
  const finish = async (exitCode) => {
    if (animation) clearInterval(animation);
    for (const pending of buffers.values()) if (pending) consume(pending);
    progressModel.accept({ operationId: applyId, phase: 'install', state: exitCode === 0 ? 'completed' : 'failed',
      completed: completedOperations.size === plannedOperations.size && plannedOperations.size ? completedOperations.size : null,
      total: completedOperations.size === plannedOperations.size && plannedOperations.size ? plannedOperations.size : null,
      message: 'Backend execution ended; final verification determines installation status' });
    if (exitCode !== 0) progressModel.stop('failed');
    try {
      drawScreen(output, frame(4, ['Verifying installed components…'], [`Installer exit: ${exitCode}; awaiting backend verification.`], ''));
      const actual = await operation('validation', 'Inspecting installed component state', 4, (signal) => backend.plan(backendOptions(), { signal }));
      const verification = await operation('verify', 'Verifying installed components and provider configuration', 4, (signal) => backend.verify(backendOptions(), { signal }));
      const result = await operation('receipt', 'Generating verified installation receipt', 4, () => summarizeExecution(actual, verification, exitCode, reviewedPlan));
      const checks = verification.rows.filter((row) => /^(Afyx Graph MCP|Antigravity MCP|Claude Code MCP|Afyx workflow MCP|Provider MCP|Afyx Context Engine|Afyx Forge Core|Core readiness)$/.test(row.name));
      const receiptChoices = [
        ...result.components.map((item, index) => ({ id: `component:${index}`, label: `${item.name}: ${item.outcome}; ${item.version || 'n/a'}` })),
        ...checks.map((row, index) => ({ id: `check:${index}`, label: `${row.name}: ${row.state}` })),
        { id: 'close', label: `Finish — ${result.status}; verify exit=${verification.exitCode}` },
      ];
      const summary = [`Result: ${result.status}; installer exit=${exitCode}; verify exit=${verification.exitCode}`,
        `Provider configuration: ${provider.length ? 'see backend checks' : 'SKIPPED by user'}`,
        `Backend log: ${tracePath}`, provider.length ? 'Provider MCP changes may require restarting the agent host.' : 'No provider registration requested.',
        'Inspect component versions and backend checks with ↑/↓.',
        result.status === 'PASS' ? 'Maintenance: use verify, update, or selective uninstall.'
          : 'Recovery: resolve the displayed backend failures, repair the affected component, then verify.'];
      if (input.isTTY && output.isTTY) {
        let selected = receiptChoices.length - 1;
        try {
        while (true) {
          const choice = await choose({ input, output, options: receiptChoices, selected,
            frame: (rows, cursor, view) => {
              let detail = summary;
              if (cursor < result.components.length) {
                const item = result.components[cursor];
                const state = actual.components[cursor];
                detail = [`${item.name}: ${item.status}; outcome=${item.outcome}; version=${item.version || 'none'}`,
                  `Target: ${state.target}`, `Ownership: ${state.ownership}; state=${state.currentState}`, state.detail];
              } else if (cursor < receiptChoices.length - 1) {
                const row = checks[cursor - result.components.length];
                detail = [`${row.name}: ${row.state}`, row.detail];
              }
              return frame(4, rows, detail, '↑/↓: inspect  Tab: focus activity  Enter: select  Esc: finish', { ...view, failed: result.status !== 'PASS', receipt: result.status === 'PASS' });
            } });
          if (choice === null || choice === 'close') break;
          selected = receiptChoices.findIndex((item) => item.id === choice);
        }
        } catch (error) {
          output.write(`\nReceipt closed: ${error.message} Verified result: ${result.status}.\n`);
          return /Ctrl\+C|SIGTERM/.test(error.message) ? 130 : 1;
        }
      } else drawScreen(output, frame(4, result.components.map((item) => `${item.name}: ${item.status}; ${item.version || 'n/a'}`), summary, '', { failed: result.status !== 'PASS', receipt: result.status === 'PASS' }));
      if (!plain) output.write('\x1b[0m\x1b[?25h\n');
      return result.status === 'PASS' ? 0 : 1;
    } catch (error) {
      const diagnostic = recordInstallerDiagnostic(error);
      drawScreen(output, frame(4, ['Verification: NOT TESTED / FAILED'],
        [`Installer exit: ${exitCode}`, String(error.message).split('\n')[0], `Diagnostic log: ${diagnostic}`, `Backend log: ${tracePath}`], 'Run verify and resolve the backend diagnostic before retrying.', { failed: true }));
      if (!plain) output.write('\x1b[0m\x1b[?25h\n');
      return 1;
    }
  };
  return { preset, provider: provider.join(','), providerScope: scope, customComponents: custom,
    skipProviderConfiguration: provider.length === 0, nonInteractive: true,
    expectedPlan: reviewedPlan.fingerprint, finish, onOutput, startProgress };
}
