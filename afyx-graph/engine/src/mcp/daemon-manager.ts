/**
 * Interactive picker driving `afyx-graph daemon` / `daemons`: list the running
 * daemons, let the operator choose one (or "stop all"), stop it, and loop
 * until nothing is left or the operator backs out.
 *
 * The CLI owns the real `the Afyx terminal` wiring (the actual TTY select box);
 * everything here takes that behind a small injected interface instead, so
 * the whole selection/stop loop runs against a fake `select` in tests — no
 * TTY, no clack, no real daemon processes.
 */
import type { DaemonRecord, StopResult } from './daemon-registry';
import { daemonProjectComparisonKey } from './daemon-paths';

/** Picker option values that aren't real project roots, so a real root can never collide with them. */
export const STOP_ALL = '__stop_all__';
export const CANCEL = '__cancel__';

export interface PickItem {
  value: string;
  label: string;
  hint?: string;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** Compact uptime, coarsest useful unit only: `45s`, `12m`, `3h 5m`. */
export function formatUptime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  if (totalMinutes < MINUTES_PER_HOUR) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const remainderMinutes = totalMinutes % MINUTES_PER_HOUR;
  return `${hours}h ${remainderMinutes}m`;
}

/** Ranks a daemon for the picker's ordering: the cwd's own daemon first, then newest-started first. */
function sameDaemonProject(left: string, right: string): boolean {
  try { return daemonProjectComparisonKey(left) === daemonProjectComparisonKey(right); }
  catch { return false; }
}

function pickerRank(daemon: DaemonRecord, cwd: string | null): [boolean, number] {
  const isCurrentProject = cwd !== null && sameDaemonProject(daemon.root, cwd);
  return [isCurrentProject, daemon.startedAt];
}

/**
 * Build the ordered, UI-ready option list: the current project's daemon
 * first (so it's the auto-selected default), the rest newest-first, then
 * "Stop all" (only past a single daemon) and "Cancel".
 */
export function buildPickItems(daemons: DaemonRecord[], cwdRoot: string | null, now: number): PickItem[] {
  const cwd = cwdRoot;

  const ordered = [...daemons].sort((a, b) => {
    const [aCurrent, aStartedAt] = pickerRank(a, cwd);
    const [bCurrent, bStartedAt] = pickerRank(b, cwd);
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    return bStartedAt - aStartedAt;
  });

  const daemonItems: PickItem[] = ordered.map((daemon) => {
    const isCurrentProject = cwd !== null && sameDaemonProject(daemon.root, cwd);
    const label = isCurrentProject ? `${daemon.root}  (current project)` : daemon.root;
    const uptime = formatUptime(now - daemon.startedAt);
    return { value: daemon.root, label, hint: `pid ${daemon.pid} · up ${uptime} · Running` };
  });

  const trailingItems: PickItem[] = [];
  if (daemonItems.length > 1) trailingItems.push({ value: STOP_ALL, label: 'Stop all', hint: '' });
  trailingItems.push({ value: CANCEL, label: 'Cancel', hint: '' });

  return [...daemonItems, ...trailingItems];
}

export interface PickerDeps {
  list: () => DaemonRecord[] | Promise<DaemonRecord[]>;
  stop: (root: string) => Promise<StopResult>;
  stopAll: () => Promise<StopResult[]>;
  /** Realpath'd root of the current project's daemon, or null. */
  cwdRoot: string | null;
  now: () => number;
  /** Render the picker; resolves to the chosen value or a cancel sentinel. */
  select: (opts: { message: string; options: PickItem[]; initialValue: string }) => Promise<unknown>;
  isCancel: (v: unknown) => boolean;
  /** Per-action note (e.g. "Stopped daemon …"). */
  note: (msg: string) => void;
  /** Final line + teardown (clack outro). */
  done: (msg: string) => void;
}

/** One line describing a single-daemon stop outcome, matching `choice` for context. */
function describeStopOutcome(result: StopResult, choice: string): string {
  switch (result.outcome) {
    case 'unverified':
      return `Could not verify daemon (pid ${result.pid}); left it running with its artifacts intact${result.detail ? ` — ${result.detail}` : ''} — ${choice}`;
    case 'permission-denied':
      return `Permission denied stopping daemon (pid ${result.pid}); run the manager under the same Windows account/integrity context as the daemon. Artifacts were preserved${result.detail ? ` — ${result.detail}` : ''} — ${choice}`;
    case 'shutdown-failed':
      return `Daemon (pid ${result.pid}) acknowledged shutdown but did not exit; no force-kill was attempted and artifacts were preserved${result.detail ? ` — ${result.detail}` : ''} — ${choice}`;
    case 'not-running':
      return `Daemon was no longer running; removed stale artifacts — ${choice}`;
    case 'no-daemon':
      return `No daemon was found — ${choice}`;
    case 'term':
      return `Stopped daemon gracefully (pid ${result.pid}) — ${choice}`;
  }
}

/**
 * Pick a daemon → stop it → re-prompt with what's left, until the operator
 * cancels (Esc / Ctrl-C / "Cancel"), picks "Stop all", or nothing remains.
 */
export async function runDaemonPicker(deps: PickerDeps): Promise<void> {
  while (true) {
    const daemons = await deps.list();
    if (daemons.length === 0) {
      deps.done('No verified daemons are available. Any live candidates that could not be verified were left running with ownership artifacts intact.');
      return;
    }

    const items = buildPickItems(daemons, deps.cwdRoot, deps.now());
    const defaultChoice = items[0]?.value ?? CANCEL; // daemons.length > 0 here, so items[0] is a daemon
    const choice = await deps.select({
      message: 'Select a daemon to stop',
      options: items,
      initialValue: defaultChoice,
    });

    if (deps.isCancel(choice) || choice === CANCEL) {
      deps.done('Cancelled.');
      return;
    }

    if (choice === STOP_ALL) {
      const results = await deps.stopAll();
      const stoppedCount = results.filter((r) => r.outcome === 'term').length;
      deps.note(`Stopped ${stoppedCount} daemon${stoppedCount === 1 ? '' : 's'}.`);
      deps.done('Done.');
      return;
    }

    const root = String(choice);
    const result = await deps.stop(root);
    deps.note(describeStopOutcome(result, root));
    // Every outcome loops back the same way: the next iteration re-lists, and
    // either re-prompts with what's left or, once empty, reports done above.
  }
}
