import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';
import { PACKAGE_ROOT } from './afyx-npm-installer.mjs';
import { createBackendAdapter, summarizeExecution } from './afyx-install-backend.mjs';

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

function wrapLines(lines, inner) {
  return lines.flatMap((line) => {
    const text = String(line).replace(/[\r\n\t]/g, ' ');
    if (!text) return [''];
    const chunks = [];
    for (let index = 0; index < text.length; index += inner) chunks.push(text.slice(index, index + inner));
    return chunks;
  });
}

function panel(title, lines, width, limit, offset = 0) {
  const inner = Math.max(16, width - 4);
  const top = `┌ ${fit(title, inner)} ${'─'.repeat(Math.max(0, inner - title.length))}┐`;
  let wrapped = wrapLines(lines, inner);
  if (limit && wrapped.length > limit) {
    const start = Math.max(0, Math.min(offset, wrapped.length - Math.max(1, limit - 1)));
    const total = wrapped.length;
    wrapped = [...wrapped.slice(start, start + Math.max(1, limit - 1)), fit(`Tab: focus activity; ↑/↓ scroll (${start + 1}/${total})`, inner)];
  }
  return [top, ...wrapped.map((line) => `│ ${line.padEnd(inner)} │`), `└${'─'.repeat(inner + 2)}┘`];
}

export function renderFrame({ stage = 0, providers = [], providerSummary, selection = [], activity = [], width = 80, height = 24, activityOffset = 0, hint = '' } = {}) {
  const safeWidth = Math.max(40, width);
  const stepLine = stages.map((name, index) => `${index + 1} ${name}${index === stage ? ' ●' : ''}`).join(' → ');
  const providerLines = providerSummary || (providers.length ? providers.flatMap((entry) => {
    const products = (entry.products || []).map((product) => `${product.type}${product.version ? ` ${product.version}` : ''}`);
    const compact = `${entry.name}: ${products.join(', ') || 'not detected'}`;
    if (safeWidth < 112 && compact.length <= safeWidth - 4) return [compact];
    return [`${entry.name}: ${products.length ? 'detected' : 'not detected'}`, ...products.map((product) => `  ${product}`)];
  }) : ['No supported provider detected']);
  let body;
  if (safeWidth >= 112) {
    const columnWidth = Math.floor((safeWidth - 4) / 3);
    const panelLimit = Math.max(3, height - 8);
    const pad = (lines) => [...lines, ...Array(Math.max(0, panelLimit - lines.length)).fill('')];
    const columns = [
      panel('PROVIDERS / HOST', pad(providerLines), columnWidth, panelLimit),
      panel('SELECTION / STATUS', pad(selection), columnWidth, panelLimit),
      panel('PLAN / ACTIVITY', pad(activity), columnWidth, panelLimit, activityOffset),
    ];
    body = columns[0].map((_, index) => columns.map((column) => column[index]).join(' '));
  } else {
    const activityLimit = Math.max(3, height - 14 - wrapLines(providerLines, safeWidth - 4).length - wrapLines(selection, safeWidth - 4).length);
    body = [panel('PROVIDERS / HOST', providerLines, safeWidth), panel('SELECTION / STATUS', selection, safeWidth), panel('PLAN / ACTIVITY', activity, safeWidth, activityLimit, activityOffset)].flatMap((lines) => [...lines, '']);
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
  let activityOffset = 0;
  let activityFocus = false;
  const tooSmall = () => (output.columns || 80) < 80 || (output.rows || 24) < 24;
  const draw = () => {
    if (tooSmall()) {
      output.write('\x1b[H\x1b[0JResize the terminal to at least 80 columns by 24 rows. Esc cancels safely.\n');
      return;
    }
    const capacity = Math.max(3, Math.min(8, (output.rows || 24) - 21));
    const start = Math.max(0, Math.min(cursor - Math.floor(capacity / 2), options.length - capacity));
    const rows = options.slice(start, start + capacity).map((option, offset) => {
      const index = start + offset;
      return `${index === cursor ? '›' : ' '} ${multiple ? checks.has(index) ? '[x]' : '[ ]' : index === cursor ? '●' : '○'} ${option.label}`;
    });
    const screen = frame(rows, cursor, { activityOffset, activityFocus })
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
        if (tooSmall()) return;
        if (key.name === 'tab' || key.name === 'left' || key.name === 'right') activityFocus = !activityFocus;
        else if (activityFocus && (key.name === 'up' || key.name === 'k')) activityOffset = Math.max(0, activityOffset - 1);
        else if (activityFocus && (key.name === 'down' || key.name === 'j')) activityOffset++;
        else if (key.name === 'up' || key.name === 'k') { cursor = (cursor - 1 + options.length) % options.length; activityOffset = 0; }
        else if (key.name === 'down' || key.name === 'j') { cursor = (cursor + 1) % options.length; activityOffset = 0; }
        else if (multiple && key.name === 'space') { checks.has(cursor) ? checks.delete(cursor) : checks.add(cursor); }
        else if (key.name === 'return') { if (activityFocus) activityFocus = false; else { cleanup(); resolve(multiple ? [...checks].map((index) => options[index].id) : options[cursor].id); return; } }
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

export async function runMidnightCircuit({ input = process.stdin, output = process.stdout, pkgRoot = PACKAGE_ROOT, platform = process.platform, arch = process.arch, hosts, options = {}, backend = createBackendAdapter({ platform, pkgRoot }) } = {}) {
  const providers = hosts ?? discoverHosts(pkgRoot);
  const available = providers.filter((entry) => providerSelectable(entry, platform)).map((entry) => entry.id);
  const frame = (stage, selection, activity, hint, view = {}) => renderFrame({ stage, providers,
    providerSummary: stage >= 3 ? [`Selected: ${provider.join(', ') || 'skipped'}; scope: ${scope}`] : undefined,
    selection, activity, width: output.columns || 80, height: output.rows || 24, ...view,
    hint: `${hint}${view.activityFocus ? ' [ACTIVITY FOCUS]' : ''}` });
  let providerMode = available.length ? 'all' : 'skip';
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
      output.write(`\x1b[H\x1b[0J${frame(3, ['Reading the backend installation plan…'], ['Read-only inspection; no installation changes yet.'], '')}`);
      reviewedPlan = await backend.plan(backendOptions());
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
      output.write(`\x1b[H\x1b[0J${frame(3, ['Revalidating the reviewed plan…'], ['Owned program files and provider configuration must still match.'], '')}`);
      const currentPlan = await backend.plan(backendOptions());
      if (currentPlan.fingerprint !== reviewedPlan.fingerprint) {
        reviewNotice = 'PLAN CHANGED: installation state changed. Inspect and confirm the updated plan.';
        continue;
      }
      break;
    }
  }
  output.write(`\x1b[2J\x1b[H${frame(3, ['Applying confirmed plan…'], ['Platform installer output follows.'], '')}\n`);
  const finish = async (exitCode) => {
    try {
      output.write(`\x1b[H\x1b[0J${frame(4, ['Verifying installed components…'], [`Installer exit: ${exitCode}; awaiting backend verification.`], '')}`);
      const actual = await backend.plan(backendOptions());
      const verification = await backend.verify(backendOptions());
      const result = summarizeExecution(actual, verification, exitCode, reviewedPlan);
      const checks = verification.rows.filter((row) => /^(Afyx Graph MCP|Antigravity MCP|Claude Code MCP|Afyx workflow MCP|Provider MCP|Afyx Context Engine|Afyx Forge Core|Core readiness)$/.test(row.name));
      const receiptChoices = [
        ...result.components.map((item, index) => ({ id: `component:${index}`, label: `${item.name}: ${item.outcome}; ${item.version || 'n/a'}` })),
        ...checks.map((row, index) => ({ id: `check:${index}`, label: `${row.name}: ${row.state}` })),
        { id: 'close', label: `Finish — ${result.status}; verify exit=${verification.exitCode}` },
      ];
      const summary = [`Result: ${result.status}; installer exit=${exitCode}; verify exit=${verification.exitCode}`,
        `Provider configuration: ${provider.length ? 'see backend checks' : 'SKIPPED by user'}`,
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
              return frame(4, rows, detail, '↑/↓: inspect  Tab: focus activity  Enter: select  Esc: finish', view);
            } });
          if (choice === null || choice === 'close') break;
          selected = receiptChoices.findIndex((item) => item.id === choice);
        }
        } catch (error) {
          output.write(`\nReceipt closed: ${error.message} Verified result: ${result.status}.\n`);
          return /Ctrl\+C|SIGTERM/.test(error.message) ? 130 : 1;
        }
      } else output.write(`${frame(4, result.components.map((item) => `${item.name}: ${item.status}; ${item.version || 'n/a'}`), summary, '')}\n`);
      return result.status === 'PASS' ? 0 : 1;
    } catch (error) {
      output.write(`\x1b[2J\x1b[H${frame(4, ['Verification: NOT TESTED / FAILED'],
        [`Installer exit: ${exitCode}`, error.message, 'Run verify and resolve the backend diagnostic before retrying.'], '')}\n`);
      return 1;
    }
  };
  return { preset, provider: provider.join(','), providerScope: scope, customComponents: custom,
    skipProviderConfiguration: provider.length === 0, nonInteractive: true,
    expectedPlan: reviewedPlan.fingerprint, finish };
}
