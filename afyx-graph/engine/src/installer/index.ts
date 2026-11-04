/**
 * Afyx Graph Interactive Installer
 *
 * Multi-target: writes MCP server config + instructions for the
 * agents the user picks (Claude Code, Cursor, Codex CLI, opencode,
 * Hermes Agent, Gemini CLI, Antigravity IDE, Kiro, and GitHub
 * Copilot in VS Code / the Copilot CLI / JetBrains IDEs).
 * Defaults to the Claude-only behavior for backwards compatibility
 * when no targets are explicitly chosen and nothing else is detected.
 *
 * Uses the bounded Afyx terminal UI; `runInstallerWithOptions`
 * is the non-interactive entry point used by the `--target` /
 * `--print-config` CLI flags.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  ALL_TARGETS,
  detectAll,
  getTarget,
  resolveTargetFlag,
} from './targets/registry';
import type { AgentTarget, Location, TargetId } from './targets/types';
import { applyInstallPlan, createInstallPlan, describeInstallPlan } from './plan';
// Import the lightweight submodules directly (not the ../sync barrel, which
// re-exports FileWatcher and would transitively pull in ../extraction — the
// installer must stay importable even when native modules can't load).
import { watchDisabledReason } from '../sync/watch-policy';
import { isGitRepo, isSyncHookInstalled, installGitSyncHook } from '../sync/git-hooks';
import { getAfyxGraphDir, afyxGraphDirName, usesExternalStateDir } from '../directory';
import { afyxTerminal, type AfyxTerminal } from '../runtime/terminal';

// Backwards-compat: keep these named exports — downstream code may
// import them. The shim in `config-writer.ts` continues to re-export
// them too.
export {
  writeMcpConfig,
  writePermissions,
  hasMcpConfig,
  hasPermissions,
} from './config-writer';
export type { InstallLocation } from './config-writer';

function getVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return '0.0.0';
  }
}

export interface RunInstallerOptions {
  /** Comma-separated target list, or `auto` / `all` / `none`. */
  target?: string;
  /** Skip the location prompt; use this value directly. */
  location?: Location;
  /** Skip the auto-allow prompt; use this value directly. */
  autoAllow?: boolean;
  /**
   * Skip every confirm and use defaults: location=global,
   * autoAllow=true, target=auto. For scripting / CI.
   */
  yes?: boolean;
  /** Inspect and render the plan without writing provider configuration. */
  dryRun?: boolean;
}

/**
 * Interactive entry point — preserves the historical UX (`afyx-graph
 * install` with no args goes through the prompts), but now starts
 * the targets multi-select pre-populated with detected agents.
 */
export async function runInstaller(): Promise<void> {
  return runInstallerWithOptions({});
}

export async function runInstallerWithOptions(opts: RunInstallerOptions): Promise<void> {
  const clack = afyxTerminal;

  clack.intro(`Afyx Graph v${getVersion()}`);

  // --yes implies all defaults; explicit flags still win.
  const useDefaults = opts.yes === true;

  // Step 1: which agent targets? Asked FIRST so the user knows what
  // they're committing to before we touch npm or disk. Detection
  // probes the user-provided location if known, else 'global' as the
  // most common default — labels are a hint, not load-bearing.
  const detectionLocation: Location = opts.location ?? 'global';
  const targets = await resolveTargets(clack, opts, detectionLocation, useDefaults);
  if (targets.length === 0) {
    clack.outro('No agent targets selected — nothing to do.');
    return;
  }

  // The MCP entries launch `afyx-graph`; the Afyx kit installs and updates that
  // CLI, so this command only wires agents.

  // Step 3: where the per-agent config files should land.
  let location: Location;
  if (opts.location) {
    location = opts.location;
  } else if (useDefaults) {
    location = 'global';
  } else {
    // If every selected target is global-only (e.g. the Copilot CLI), skip the
    // prompt and force user-wide — project-local would just produce
    // skip warnings.
    const allGlobalOnly = targets.every((t) => !t.supportsLocation('local'));
    if (allGlobalOnly) {
      location = 'global';
      clack.log.info('Writing user-wide configs (selected agents have no project-local config).');
    } else {
      const sel = await clack.select({
        message: 'Apply agent configs to all your projects, or just this one?',
        options: [
          { value: 'global' as const, label: 'All projects', hint: '~/.claude, ~/.cursor, etc.' },
          { value: 'local'  as const, label: 'Just this project', hint: './.claude, ./.cursor, etc.' },
        ],
        initialValue: 'global' as const,
      });
      if (clack.isCancel(sel)) {
        clack.cancel('Installation cancelled.');
        process.exit(0);
      }
      location = sel;
    }
  }

  // Step 4: auto-allow permissions (only meaningful for Claude;
  // skipped silently by other targets).
  let autoAllow: boolean;
  if (opts.autoAllow !== undefined) {
    autoAllow = opts.autoAllow;
  } else if (useDefaults) {
    autoAllow = true;
  } else if (targets.some((t) => t.id === 'claude')) {
    const ans = await clack.confirm({
      message: 'Auto-allow Afyx Graph commands? (Skips permission prompts in Claude Code)',
      initialValue: true,
    });
    if (clack.isCancel(ans)) {
      clack.cancel('Installation cancelled.');
      process.exit(0);
    }
    autoAllow = ans;
  } else {
    autoAllow = false;
  }

  // Step 4¾: front-load prompt hook (Claude Code only). A UserPromptSubmit hook
  // that runs `afyx-graph prompt-hook` — it injects afyx_graph_explore context on
  // structural ("how / where / trace / impact") prompts so the agent reliably
  // reaches for the graph instead of grepping. Opt-in, default-yes. Only Claude
  // Code has UserPromptSubmit, so it's offered only when Claude is a target;
  // other targets ignore the option. `undefined` (no Claude / not asked) leaves
  // any existing hook untouched.
  let promptHook: boolean | undefined;
  if (targets.some((t) => t.id === 'claude')) {
    if (useDefaults) {
      promptHook = true; // --yes → on
    } else {
      const ans = await clack.confirm({
        message:
          'Front-load Afyx Graph on “how / where / trace” prompts? Auto-injects structural context so answers need fewer steps (adds a moment to those prompts; Claude Code only).',
        initialValue: true,
      });
      if (clack.isCancel(ans)) {
        clack.cancel('Installation cancelled.');
        process.exit(0);
      }
      promptHook = ans; // false → opt out; install() strips any prior hook
    }
  }

  // Step 5: build one side-effect-free plan. Interactive and scripted installs
  // share the same apply/verify path; prompts never own config semantics.
  const plan = createInstallPlan(targets, location, { autoAllow, promptHook });
  if (opts.dryRun) {
    const preview = describeInstallPlan(plan);
    for (const target of preview.targets) {
      if (!target.supported) {
        clack.log.warn(`${target.displayName}: unsupported at --location=${location}`);
        continue;
      }
      clack.log.info(
        `${target.displayName}: ${target.operation}; ` +
        `${target.paths.length > 0 ? target.paths.map(tildify).join(', ') : 'no owned paths'}`,
      );
    }
    clack.outro('Dry run complete — no provider configuration was changed.');
    return;
  }

  for (const report of applyInstallPlan(plan)) {
    const target = report.entry;
    if (report.status === 'unsupported') {
      clack.log.warn(
        `${target.displayName}: skipped — does not support --location=${location}.`,
      );
      continue;
    }
    if (report.status === 'verification-failed' || report.result === null) {
      throw new Error(`${target.displayName}: install verification failed.`);
    }
    const result = report.result;
    for (const file of result.files) {
      const verb = file.action === 'unchanged'
        ? 'Unchanged'
        : file.action === 'created' ? 'Created'
          : file.action === 'removed' ? 'Removed'
            : 'Updated';
      clack.log.success(`${target.displayName}: ${verb} ${tildify(file.path)}`);
    }
    for (const note of result.notes ?? []) {
      clack.log.info(`${target.displayName}: ${note}`);
    }
  }

  // Step 6: install wires up agents only — it deliberately does NOT index.
  // Building the per-project graph is the user's explicit `afyx-graph init`
  // (or `index`), so they choose what gets indexed and when, and we never
  // index a surprise directory (e.g. a shell sitting in $HOME). Same next step
  // regardless of global/local scope.
  clack.note(
    (location === 'local'
      ? 'afyx-graph init        # build this project’s graph (one time; auto-syncs after)'
      : 'cd <your-project>\nafyx-graph init        # build a project’s graph (one time; auto-syncs after)') +
      '\n# (afyx-graph install --init does both steps in one command)',
    'Next: index a project',
  );

  const finalNote = targets.length > 0
    ? `Done! Restart your agent${targets.length > 1 ? 's' : ''} to use Afyx Graph.`
    : 'Done!';
  clack.outro(finalNote);
}

export interface RunUninstallerOptions {
  /**
   * Comma-separated target list, or `auto` / `all` / `none`. Defaults
   * to `all` — uninstall sweeps every known agent and reports which
   * ones it actually touched, so the user doesn't have to know where
   * they configured it.
   */
  target?: string;
  /** Skip the location prompt; use this value directly. */
  location?: Location;
  /** Non-interactive: location=global, target=all, no prompts. */
  yes?: boolean;
}

export type UninstallStatus = 'removed' | 'not-configured' | 'unsupported';

/**
 * Per-target outcome of an uninstall sweep. `removed` means we deleted
 * at least one thing; `not-configured` means the agent had no afyx-graph
 * config at this location (nothing to do); `unsupported` means the
 * agent has no config concept for this location (e.g. the Copilot CLI
 * is global-only, so a `local` uninstall skips it).
 */
export interface UninstallReport {
  id: TargetId;
  displayName: string;
  status: UninstallStatus;
  /** Absolute paths we actually edited/removed (action === 'removed'). */
  removedPaths: string[];
  /** Verbatim notes from the target (rare for uninstall). */
  notes: string[];
}

/**
 * Pure uninstall sweep — no prompts, no I/O beyond the targets' own
 * file edits. Exposed (and unit-tested) separately from the clack UI in
 * `runUninstaller` so the aggregation logic can be asserted directly.
 *
 * Each target's `uninstall()` is already safe to call when nothing was
 * installed (it returns `not-found` actions), so this is safe to run
 * across every target unconditionally.
 */
export function uninstallTargets(
  targets: readonly AgentTarget[],
  location: Location,
): UninstallReport[] {
  return targets.map((target) => {
    if (!target.supportsLocation(location)) {
      const only: Location = location === 'local' ? 'global' : 'local';
      return {
        id: target.id,
        displayName: target.displayName,
        status: 'unsupported' as const,
        removedPaths: [],
        notes: [`no ${location} config — this agent is ${only}-only`],
      };
    }
    const result = target.uninstall(location);
    const removedPaths = result.files
      .filter((f) => f.action === 'removed')
      .map((f) => f.path);
    return {
      id: target.id,
      displayName: target.displayName,
      status: removedPaths.length > 0 ? ('removed' as const) : ('not-configured' as const),
      removedPaths,
      notes: result.notes ?? [],
    };
  });
}

export type RefreshStatus = 'refreshed' | 'unchanged' | 'not-configured' | 'unsupported';

/**
 * Per-target outcome of a refresh sweep. `refreshed` means at least one
 * filesystem entry was created, updated, or removed; `unchanged` means the target was
 * already current (every write reported byte-identical); the other two
 * mirror `UninstallStatus`.
 */
export interface RefreshReport {
  id: TargetId;
  displayName: string;
  location: Location;
  status: RefreshStatus;
  /** Absolute paths created, updated, or removed by the refresh. */
  changedPaths: string[];
}

/**
 * Pure refresh sweep — re-runs `install()` for every target that is
 * ALREADY configured at `location`, so the surfaces a previous version
 * wrote (the marker-fenced instructions section, the MCP server entry,
 * the legacy-hook cleanups) match the binary that will serve them.
 * Without this, those files keep the wording — and the tool names — of
 * whatever version first wrote them, no matter how many upgrades later.
 *
 * Strictly a refresh, never a first install:
 *   - targets that aren't `alreadyConfigured` are skipped untouched;
 *   - permissions are not written (`autoAllow: false`) and the prompt
 *     hook is left as-is (`promptHook: undefined`), so choices the user
 *     made at install time — or by hand since — are preserved.
 *
 * Every write underneath is the targets' own idempotent upsert, so a
 * re-run on an already-current machine reports `unchanged` everywhere.
 * Exposed (and unit-tested) separately from the CLI wiring, same as
 * `uninstallTargets`.
 */
export function refreshTargets(
  targets: readonly AgentTarget[],
  location: Location,
): RefreshReport[] {
  return targets.map((target) => {
    const base = { id: target.id, displayName: target.displayName, location };
    if (!target.supportsLocation(location)) {
      return { ...base, status: 'unsupported' as const, changedPaths: [] };
    }
    if (!target.detect(location).alreadyConfigured) {
      return { ...base, status: 'not-configured' as const, changedPaths: [] };
    }
    const result = target.install(location, { autoAllow: false, promptHook: undefined });
    const changedPaths = result.files
      .filter((f) => f.action === 'created' || f.action === 'updated' || f.action === 'removed')
      .map((f) => f.path);
    return {
      ...base,
      status: changedPaths.length > 0 ? ('refreshed' as const) : ('unchanged' as const),
      changedPaths,
    };
  });
}

/**
 * Interactive uninstaller — the inverse of `runInstallerWithOptions`.
 * Asks global-vs-local first (unless `--location`/`--yes` is given),
 * then sweeps every agent target (or the `--target` subset) and prints
 * one block per agent so the user sees exactly which providers it hit.
 *
 * Removes only what install wrote (MCP server entry, instructions
 * block, permissions) — never the `.afyx-graph/` index, which `afyx-graph
 * uninit` owns.
 */
export async function runUninstaller(opts: RunUninstallerOptions): Promise<void> {
  const clack = afyxTerminal;

  clack.intro(`Afyx Graph v${getVersion()} — uninstall`);

  const useDefaults = opts.yes === true;

  // Step 1: which location — asked FIRST, the one decision the user
  // must make. Global sweeps ~/.claude, ~/.codex, etc.; local sweeps
  // the configs in this project directory.
  let location: Location;
  if (opts.location) {
    location = opts.location;
  } else if (useDefaults) {
    location = 'global';
  } else {
    const sel = await clack.select({
      message: 'Remove Afyx Graph from all your projects, or just this one?',
      options: [
        { value: 'global' as const, label: 'All projects (global)', hint: '~/.claude, ~/.cursor, ~/.codex, ~/.config/opencode, ~/.hermes, ~/.gemini, ~/.kiro, ~/.copilot, ~/.config/github-copilot' },
        { value: 'local'  as const, label: 'Just this project (local)', hint: './.claude, ./.cursor, ./.vscode, ./opencode.jsonc, ./.gemini, ./.kiro' },
      ],
      initialValue: 'global' as const,
    });
    if (clack.isCancel(sel)) {
      clack.cancel('Uninstall cancelled.');
      process.exit(0);
    }
    location = sel;
  }

  // Step 2: which agents. Default is every agent, so the user doesn't
  // have to remember where they installed it — unconfigured agents are
  // reported as "nothing to remove" and left untouched. An explicit
  // --target subsets this.
  let targets: AgentTarget[];
  if (opts.target !== undefined) {
    targets = resolveTargetFlag(opts.target, location);
  } else {
    targets = [...ALL_TARGETS];
  }
  if (targets.length === 0) {
    clack.outro('No agent targets selected — nothing to do.');
    return;
  }

  // Step 3: sweep + per-agent feedback.
  const reports = uninstallTargets(targets, location);
  const removed = reports.filter((r) => r.status === 'removed');

  for (const r of reports) {
    if (r.status === 'removed') {
      for (const p of r.removedPaths) {
        clack.log.success(`${r.displayName}: removed ${tildify(p)}`);
      }
    } else if (r.status === 'not-configured') {
      clack.log.info(`${r.displayName}: not configured — nothing to remove`);
    } else {
      clack.log.info(`${r.displayName}: skipped — ${r.notes[0] ?? 'unsupported location'}`);
    }
  }

  // Step 4: for local uninstall, the index dir is separate — point at
  // `uninit` so the user knows it's still there (and how to remove it).
  if (location === 'local' && fs.existsSync(getAfyxGraphDir(process.cwd()))) {
    clack.log.info(`The ${afyxGraphDirName()}/ index for this project is still here. Run \`afyx-graph uninit\` to delete it.`);
  }

  // Step 5: summary.
  if (removed.length > 0) {
    const names = removed.map((r) => r.displayName).join(', ');
    clack.outro(
      `Removed Afyx Graph from ${removed.length} agent${removed.length > 1 ? 's' : ''}: ${names}. ` +
      `Restart ${removed.length > 1 ? 'them' : 'it'} to apply.`,
    );
  } else {
    clack.outro(`Afyx Graph was not configured in any ${location} agent — nothing to remove.`);
  }
}

/**
 * Replace home-directory prefix in a path with `~/` for cleaner log
 * lines. Pure cosmetic.
 */
function tildify(p: string): string {
  const home = require('os').homedir();
  if (p.startsWith(home + path.sep)) return '~' + p.substring(home.length);
  return p;
}

async function resolveTargets(
  clack: AfyxTerminal,
  opts: RunInstallerOptions,
  location: Location,
  useDefaults: boolean,
): Promise<AgentTarget[]> {
  // Explicit --target flag wins.
  if (opts.target !== undefined) {
    return resolveTargetFlag(opts.target, location);
  }

  // --yes implies auto-detect.
  if (useDefaults) {
    return resolveTargetFlag('auto', location);
  }

  // Interactive multi-select.
  const detected = detectAll(location);
  const initialValues = detected
    .filter(({ detection }) => detection.installed)
    .map(({ target }) => target.id);
  // If nothing detected, default to Claude alone (matches the
  // historical default and the smallest-surprise outcome).
  const initial = initialValues.length > 0 ? initialValues : ['claude'];

  const choice = await clack.multiselect<string>({
    message: 'Which agents should Afyx Graph configure?',
    options: ALL_TARGETS.map((t) => {
      const det = detected.find(({ target }) => target.id === t.id)!.detection;
      const flag = det.installed ? '(detected)' : '(not found)';
      const globalOnly = !t.supportsLocation('local') ? ' — global only' : '';
      return {
        value: t.id,
        label: `${t.displayName} ${flag}${globalOnly}`,
      };
    }),
    initialValues: initial,
    required: false,
  });

  if (clack.isCancel(choice)) {
    clack.cancel('Installation cancelled.');
    process.exit(0);
  }

  return choice
    .map((id) => getTarget(id))
    .filter((t): t is AgentTarget => t !== undefined);
}


/**
 * When the live file watcher will be disabled for this project (e.g. WSL2
 * /mnt drives, or AFYX_GRAPH_NO_WATCH), the index would silently go stale.
 * Explain that, and offer to keep it fresh automatically via git hooks
 * (commit / pull / checkout) instead of manual `afyx-graph sync`.
 *
 * No-op on environments where the watcher runs normally, so it's safe to
 * call unconditionally after init.
 */
export async function offerWatchFallback(
  clack: AfyxTerminal,
  projectPath: string,
  opts: { yes?: boolean } = {},
): Promise<void> {
  const reason = watchDisabledReason(projectPath);
  if (!reason) return; // Watcher runs normally — nothing to set up.

  clack.log.warn(`Live file watching is disabled here — ${reason}.`);
  clack.log.info('Until you re-sync, the Afyx Graph index stays frozen — it will not pick up edits on its own.');

  // An external state binding is the read-only-corpus contract. Git hooks live
  // under the corpus repository, so even inspecting an existing managed hook
  // must never lead to an install/update from this workflow.
  if (usesExternalStateDir()) {
    clack.log.info('External-state mode does not modify source Git hooks. Run `afyx-graph sync` after changing files to refresh the index.');
    return;
  }

  // No git repo → the commit-hook path doesn't apply; point at manual sync.
  if (!isGitRepo(projectPath)) {
    clack.log.info('Run `afyx-graph sync` after changing files to refresh the index.');
    return;
  }

  // Already wired up on a previous run — confirm and move on without nagging.
  if (isSyncHookInstalled(projectPath)) {
    clack.log.info('Git sync hooks are already installed — the index refreshes after commit / pull / checkout.');
    return;
  }

  let choice: 'hook' | 'manual';
  if (opts.yes) {
    choice = 'hook';
  } else {
    const sel = await clack.select({
      message: 'How should Afyx Graph keep its index fresh?',
      options: [
        { value: 'hook' as const, label: 'Sync on git commit / pull / checkout', hint: 'installs git hooks (recommended)' },
        { value: 'manual' as const, label: 'I\'ll run `afyx-graph sync` myself', hint: 'fully manual' },
      ],
      initialValue: 'hook' as const,
    });
    if (clack.isCancel(sel)) {
      clack.log.info('Skipped — run `afyx-graph sync` after changes to refresh the index.');
      return;
    }
    choice = sel;
  }

  if (choice === 'manual') {
    clack.log.info('Run `afyx-graph sync` after changing files to refresh the index.');
    return;
  }

  const result = installGitSyncHook(projectPath);
  if (result.installed.length > 0) {
    clack.log.success(
      `Installed git ${result.installed.join(', ')} hook${result.installed.length > 1 ? 's' : ''} — ` +
      'the index refreshes in the background after each.',
    );
    clack.log.info('Run `afyx-graph sync` anytime to refresh immediately.');
  } else {
    clack.log.warn(
      `Could not install git hooks${result.skipped ? ` (${result.skipped})` : ''}. ` +
      'Run `afyx-graph sync` after changes instead.',
    );
  }
}
