#!/usr/bin/env node
/**
 * Afyx Graph CLI
 *
 * Command-line interface for Afyx Graph code intelligence.
 *
 * Usage:
 *   afyx-graph                    Run interactive installer (when no args)
 *   afyx-graph install            Run interactive installer
 *   afyx-graph uninstall          Remove Afyx Graph from your agents
 *   afyx-graph init [path]        Initialize Afyx Graph in a project
 *   afyx-graph uninit [path]      Remove Afyx Graph from a project
 *   afyx-graph index [path]       Index all files in the project
 *   afyx-graph sync [path]        Sync changes since last index
 *   afyx-graph status [path]      Show index status
 *   afyx-graph query <search>     Search for symbols
 *   afyx-graph files [options]    Show project file structure
 *   afyx-graph context <task>     Build context for a task
 *   afyx-graph callers <symbol>   Find what calls a function/method
 *   afyx-graph callees <symbol>   Find what a function/method calls
 *   afyx-graph impact <symbol>    Analyze what code is affected by changing a symbol
 *   afyx-graph affected [files]   Find test files affected by changes
 *   afyx-graph ui [path]          Open the browser viewer for an indexed project (alias: web)
 *   afyx-graph upgrade [version]  Update Afyx Graph to the latest release
 */

// FIRST import, before anything else loads: capture process.ppid while our
// launcher is (almost certainly) still alive. A launcher killed mid-startup
// otherwise blinds the PPID watchdog forever (#1185) — see early-ppid.ts.
import '../mcp/early-ppid';
import { CLI_NAME, PRODUCT_NAME } from '../product';

// Persist V8 compile artifacts across runs (Node ≥22.8). Every invocation —
// and every worker thread, which re-requires the whole extraction module
// graph — skips recompiling unchanged sources. Worth hundreds of ms of
// worker-boot latency per bulk index; harmless no-op when unavailable.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (process.env.AFYX_GRAPH_STATE_DIR === undefined) {
    (require('node:module') as { enableCompileCache?: () => void }).enableCompileCache?.();
  }
} catch { /* cache is best-effort */ }

import { AfyxCli } from './cli-parser';
import * as path from 'path';
import * as fs from 'fs';
import { getAfyxGraphDir, isInitialized, unsafeIndexRootReason, findNearestAfyxGraphRoot, planFrontload, hasStructuralKeyword, extractCodeTokens, capPromptHookInjection, usesExternalStateDir } from '../directory';
import { extractProseCandidates } from '../search/identifier-segments';
import { detectWorktreeIndexMismatch, worktreeMismatchWarning } from '../sync/worktree';
import { createShimmerProgress } from '../ui/shimmer-progress';
import { getGlyphs } from '../ui/glyphs';
import { ansiColorsEnabled } from '../ui/color';
import { afyxTerminal, type AfyxTerminal } from '../runtime/terminal';

import { buildNodeTooOldBanner, isSupportedNodeVersion } from './node-version-check';
import { installFatalHandlers } from './fatal-handler';
import { installCommandSupervision } from './command-supervision';
import { EXTRACTION_VERSION } from '../extraction/extraction-version';
import {
  assertCliCatalog,
  cliAliases,
  cliCommand,
  cliCommandOptions,
  prepareCliInvocation,
} from './cli-registry';
import { resolveCliProjectPath as resolveProjectPath } from './cli-path';
import {
  cliDefinition,
  cliNode,
  createCliPresentation,
  formatCliDuration as formatDuration,
  formatCliNumber as formatNumber,
  formatCliSymbolNotFound as formatSymbolNotFound,
} from './cli-presentation';
// Value import, but dependency-free by design so `--help` text can name the
// default port without dragging node:http into every other subcommand; the
// server itself is loaded lazily inside the `ui` action. See ui-server/constants.
import { BROWSER_ENV, DEFAULT_UI_PORT } from '../ui-server/constants';
import type { UiServerHandle } from '../ui-server';
import { lookupSymbolNodes, describeSymbolNode, groupDefinitions } from '../graph/symbol-lookup';
import { analyzeAffectedTests, mergeSymbolImpact, computeAffectedTests, computeOdooImpact } from '../impact';
import type { Node, Edge } from '../types';
import { buildIndexHealth } from '../index-health';

// Decided once, before `--color`/`--no-color` are stripped from argv below
// (#1281). Piped/redirected stdout, NO_COLOR, or --no-color -> plain output.
const COLORS_ENABLED = ansiColorsEnabled();

// Lazy-load heavy modules (Afyx Graph, runInstaller) to keep CLI startup fast.
async function loadAfyxGraph(): Promise<typeof import('../index')> {
  try {
    return await import('../index');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const [red, reset] = COLORS_ENABLED ? ['\x1b[31m', '\x1b[0m'] : ['', ''];
    console.error(`${red}${getGlyphs().err}${reset} ${'Failed to load Afyx Graph modules.'}`);
    console.error(`\n  Node: ${process.version}  Platform: ${process.platform} ${process.arch}`);
    console.error(`\n  Error: ${msg}`);
    console.error('\n  Try reinstalling with: npm install -g @a5zero7/afyx-graph\n');
    process.exit(1);
  }
}

const nodeVersion = process.versions.node;
// Enforce the supported Node floor. `engines` in package.json only *warns* on
// install (unless engine-strict), so hard-block here to actually keep users off
// unsupported versions. See package.json `engines`.
if (!isSupportedNodeVersion(nodeVersion)) {
  process.stderr.write(buildNodeTooOldBanner(nodeVersion) + '\n');
  if (!process.env.AFYX_GRAPH_ALLOW_UNSAFE_NODE) {
    process.exit(1);
  }
  // Override active — banner shown for visibility, continuing.
}

// Last-resort fatal handlers: log a bounded line and exit non-zero. A fault
// that reaches here escaped every boundary, so the process is in an undefined
// state — keeping it alive is what let the detached MCP daemon orphan and pin a
// CPU core with no recovery (#799, #850). Installed before the command branch
// so it also covers a synchronous throw during startup. See ./fatal-handler.
installFatalHandlers();

// Check if running with no arguments - run installer
if (process.argv.length === 2) {
  import('../installer').then(({ runInstaller }) =>
    runInstaller()
  ).catch((err) => {
    console.error('Installation failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  // Normal CLI flow
  main();
}

function main() {

  const program = new AfyxCli();

// Version from package.json
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8')
);

// Make the version trivial to reach. Afyx CLI's `.version()` (below) wires up
// `--version` and `-V`; intercept the spellings it can't — lowercase `-v` and
// single-dash `-version` — before any parsing. (Afyx CLI's version short flag
// is the capital `-V`, and its parser rejects a multi-character single-dash
// flag.) The bare `afyx-graph version` subcommand is registered further down so
// the affordance also shows up in `afyx-graph --help`.
const invocation = prepareCliInvocation(process.argv);
if (invocation.versionShortcut) {
  console.log(packageJson.version);
  return;
}

// =============================================================================
// ANSI Color Helpers (avoid chalk ESM issues)
// =============================================================================

// `--color` / `--no-color` are global and position-independent — they were
// already read by ansiColorsEnabled() at module load, so strip them before
// Afyx CLI parses (a subcommand would otherwise reject the unknown flag).
process.argv = invocation.argv;

const { colors, chalk, success, error, info, warn } = createCliPresentation(COLORS_ENABLED);

program
    .product(CLI_NAME)
    .summary(`${PRODUCT_NAME} local structural code intelligence`)
    .release(packageJson.version)
  // Parsed manually before Afyx CLI runs (any argv position works); declared
  // here so they show up in --help. NO_COLOR / FORCE_COLOR env vars are also
  // honored, and piped output defaults to no color (#1281).
    .flag('--color', 'force ANSI colors even when stdout is not a TTY')
    .flag('--no-color', 'disable ANSI colors (NO_COLOR env is also honored)');

// =============================================================================
// Helper Functions
// =============================================================================

// Shimmer progress renderer (runs in a worker thread for smooth animation)
// Imported at top of file from '../ui/shimmer-progress'

/**
 * Create a plain-text progress callback for --verbose mode.
 * No animations, no ANSI tricks — just timestamped lines to stdout.
 */
function createVerboseProgress(): (progress: { phase: string; current: number; total: number; currentFile?: string }) => void {
  let lastPhase = '';
  let lastPct = -1;
  const startTime = Date.now();

  return (progress) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (progress.phase !== lastPhase) {
      lastPhase = progress.phase;
      lastPct = -1;
      console.log(`[${elapsed}s] Phase: ${progress.phase}`);
    }

    if (progress.total > 0) {
      const pct = Math.floor((progress.current / progress.total) * 100);
      // Log every 5% to keep output manageable
      if (pct >= lastPct + 5 || progress.current === progress.total) {
        lastPct = pct;
        console.log(`[${elapsed}s]   ${progress.current}/${progress.total} (${pct}%)${progress.currentFile ? ` ${getGlyphs().dash} ${progress.currentFile}` : ''}`);
      }
    } else if (progress.current > 0) {
      // Scanning phase (no total yet) — log periodically
      if (progress.current % 1000 === 0 || progress.current === 1) {
        console.log(`[${elapsed}s]   ${formatNumber(progress.current)} files found`);
      }
    }
  };
}

type IndexResult = {
  success: boolean;
  filesIndexed: number;
  filesSkipped: number;
  filesErrored: number;
  nodesCreated: number;
  edgesCreated: number;
  errors: Array<{ message: string; filePath?: string; severity: string; code?: string }>;
  durationMs: number;
  filesSkippedUnsupported?: number;
  topUnsupportedExtensions?: { ext: string; count: number }[];
  filesSeen?: number;
  filesEligible?: number;
  filesRetried?: number;
  filesRecovered?: number;
  filesFailedAfterRetry?: number;
};

/**
 * Print indexing results using clack log methods
 */
function printIndexResult(clack: AfyxTerminal, result: IndexResult, projectPath?: string): void {
  const hasErrors = result.filesErrored > 0;
  const parseWarnings = result.errors.filter((e) => e.code === 'parse_error' && e.severity === 'warning');

  // Surface non-file-level failures (e.g. lock-acquisition failure
  // when another indexer is running) before the file-count branches.
  // Without this the CLI falls through to "No files found to index",
  // which is actively misleading — the index DID run, it just couldn't
  // get the lock.
  //
  // If success is false but no severity:'error' entry exists in
  // `result.errors` (degenerate case — shouldn't happen in practice
  // but worth guarding because the result shape is plumbed through
  // multiple call sites), fall back to a generic message rather than
  // continuing to the misleading "No files found" branch or throwing.
  if (!result.success && !hasErrors && result.filesIndexed === 0) {
    const generic = result.errors.find((e) => e.severity === 'error');
    clack.log.error(generic?.message ?? `Indexing failed ${getGlyphs().dash} no further details available`);
    return;
  }

  if (result.filesIndexed > 0) {
    if (hasErrors) {
      clack.log.success(`Indexed ${formatNumber(result.filesIndexed)} files (${formatNumber(result.filesErrored)} could not be parsed)`);
    } else {
      clack.log.success(`Indexed ${formatNumber(result.filesIndexed)} files`);
    }
    clack.log.info(`${formatNumber(result.nodesCreated)} nodes, ${formatNumber(result.edgesCreated)} edges in ${formatDuration(result.durationMs)}`);
    if (result.filesSeen !== undefined && result.filesEligible !== undefined) {
      clack.log.info(
        `Extraction accounting: ${formatNumber(result.filesSeen)} discovered, ` +
        `${formatNumber(result.filesEligible)} eligible, ${formatNumber(result.filesIndexed)} indexed, ` +
        `${formatNumber(result.filesSkipped)} skipped, ${formatNumber(result.filesSkippedUnsupported ?? 0)} unsupported, ` +
        `${formatNumber(result.filesErrored)} failed; retries ${formatNumber(result.filesRecovered ?? 0)}/${formatNumber(result.filesRetried ?? 0)} recovered`
      );
    }
    // Warning-only parse failures keep indexing successful, but must be visible.
    for (const warning of parseWarnings) {
      clack.log.warn(warning.message);
    }
    // A PARTIAL index (files silently dropped mid-pipeline) must not pass
    // as a clean run — it's the difference between "indexed the repo" and
    // "indexed most of the repo, quietly". Only the completeness
    // reconciliation warning; per-file extractor warnings stay in the
    // error-code summary below.
    for (const w of result.errors.filter((e) => e.code === 'index_partial')) {
      clack.log.warn(w.message);
    }
    // Files salvaged from comment-stripped source after repeated parser
    // failures are indexed but possibly incomplete — say so here, or the run
    // reads as fully clean and the index quietly disagrees with a later
    // re-parse of the same bytes (#1565).
    const salvaged = result.errors.filter((e) => e.code === 'salvaged_stripped');
    if (salvaged.length > 0) {
      const sample = salvaged.slice(0, 3).map((e) => e.filePath).filter(Boolean).join(', ');
      const more = salvaged.length > 3 ? ', ...' : '';
      clack.log.warn(`${formatNumber(salvaged.length)} file(s) indexed from comment-stripped source after repeated parse failures ${getGlyphs().dash} symbols may be incomplete (${sample}${more})`);
    }
  } else if (hasErrors) {
    clack.log.error(`Indexing failed ${getGlyphs().dash} all ${formatNumber(result.filesErrored)} files had errors`);
  } else if (result.filesSkippedUnsupported) {
    // A project Afyx Graph has no grammar for used to be indistinguishable from
    // an empty one: same message, same `complete` state, same exit 0. Say which
    // files were there and that the graph is empty on purpose, so nobody — and
    // no agent trusting the graph — reads silence as "this code doesn't exist"
    // (#1502).
    const top = (result.topUnsupportedExtensions ?? [])
      .map(e => `${e.ext} (${formatNumber(e.count)})`)
      .join(', ');
    clack.log.warn(
      `No supported source files found ${getGlyphs().dash} ${formatNumber(result.filesSkippedUnsupported)} file(s) present, none in a language Afyx Graph indexes`
      + (top ? `: ${top}` : '')
    );
    clack.log.info(`${PRODUCT_NAME} is inactive for this workspace — searches will return nothing. Use your own file tools here.`);
  } else {
    clack.log.warn('No files found to index');
  }

  if (hasErrors) {
    const errorsByCode = new Map<string, number>();
    for (const err of result.errors) {
      if (err.severity === 'error') {
        const code = err.code || 'unknown';
        errorsByCode.set(code, (errorsByCode.get(code) || 0) + 1);
      }
    }

    const codeLabels: Record<string, string> = {
      parse_error: 'files failed to parse',
      read_error: 'files could not be read',
      size_exceeded: 'files exceeded size limit',
      path_traversal: 'blocked paths',
      unsupported_language: 'unsupported language',
      parser_error: 'parser initialization failures',
    };

    const breakdown = Array.from(errorsByCode)
      .map(([code, count]) => `${formatNumber(count)} ${codeLabels[code] || code}`)
      .join('\n');
    clack.note(breakdown, 'Error breakdown');

    if (projectPath) {
      writeErrorLog(projectPath, result.errors);
      clack.log.info(`See ${path.join(getAfyxGraphDir(projectPath), 'errors.log')} for details`);
    }

    if (result.filesIndexed > 0) {
      clack.log.info(`The index is fully usable ${getGlyphs().dash} only the failed files are missing.`);
    }
  } else if (projectPath) {
    // No hard errors. Salvaged-file warnings still belong in the log — it
    // carries the per-file detail behind the one-line summary above.
    if (result.errors.some((e) => e.code === 'salvaged_stripped')) {
      writeErrorLog(projectPath, result.errors);
      clack.log.info(`See ${path.join(getAfyxGraphDir(projectPath), 'errors.log')} for details`);
    } else {
      const logPath = path.join(getAfyxGraphDir(projectPath), 'errors.log');
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
      }
    }
  }
}

/**
 * When an `init`/`index` produced an EMPTY graph and the reason is that the
 * project's own `.gitignore` excludes nested git repositories — the "super-repo
 * gitignores its child repos" layout (#1156), where `init` at the parent
 * correctly indexes ~nothing while `init` inside each child works — name those
 * repos and offer to index them. An interactive terminal gets a yes/no prompt
 * that writes `includeIgnored` to afyx-graph.json and re-indexes; a
 * non-interactive run just prints the one-line opt-in snippet. The caller gates
 * this on `nodesCreated === 0`, so a project that DID index real content is
 * never nagged about the gitignored reference clones it deliberately keeps out
 * (#970, #1065). Best-effort throughout: detection never breaks the command.
 */
async function offerIndexIgnoredRepos(
  clack: AfyxTerminal,
  projectPath: string,
  reindex: () => Promise<IndexResult>,
  opts: { interactive: boolean },
): Promise<IndexResult | undefined> {
  let repos: string[];
  try {
    const { findUnindexedIgnoredRepos } = await import('../extraction');
    repos = findUnindexedIgnoredRepos(projectPath);
  } catch {
    return; // detection is advisory — never let it break the command
  }
  if (repos.length === 0) return;

  const { PROJECT_CONFIG_FILENAME } = await import('../project-config');
  const isOne = repos.length === 1;
  const SHOWN = 6;
  const names = repos.slice(0, SHOWN).map((r) => r.replace(/\/$/, ''));
  const extra = repos.length > SHOWN ? ` (+${formatNumber(repos.length - SHOWN)} more)` : '';
  const snippet = `{ "includeIgnored": [${repos.map((p) => JSON.stringify(p)).join(', ')}] }`;

  clack.log.warn(
    `Your .gitignore excludes ${isOne ? 'a nested git repository' : `${formatNumber(repos.length)} nested git repositories`} here, ` +
    `so ${isOne ? 'it was' : 'they were'} not indexed: ${names.join(', ')}${extra}.`,
  );

  const manualHint = () => {
    clack.log.info(
      `If ${isOne ? "it's" : "they're"} your code, add ${isOne ? 'it' : 'them'} to ${PROJECT_CONFIG_FILENAME} and re-index:`,
    );
    clack.log.info(`  ${snippet}`);
  };

  // External-state mode is explicitly read-only with respect to the corpus.
  // Never let the convenience prompt create/update afyx-graph.json there.
  if (usesExternalStateDir() || !opts.interactive || !process.stdin.isTTY) {
    manualHint();
    return;
  }

  const yes = await clack.confirm({
    message: `Index ${isOne ? 'it' : `these ${formatNumber(repos.length)}`} now? Adds ${isOne ? 'it' : 'them'} to ${PROJECT_CONFIG_FILENAME}.`,
    initialValue: true,
  });
  if (clack.isCancel(yes) || !yes) {
    manualHint();
    return;
  }

  let added: number;
  try {
    const { addIncludeIgnoredPatterns } = await import('../project-config');
    added = addIncludeIgnoredPatterns(projectPath, repos);
  } catch (err) {
    clack.log.error(`Could not update ${PROJECT_CONFIG_FILENAME}: ${err instanceof Error ? err.message : String(err)}`);
    manualHint();
    return;
  }
  clack.log.success(`Added ${formatNumber(added)} ${added === 1 ? 'entry' : 'entries'} to ${PROJECT_CONFIG_FILENAME} ${getGlyphs().dash} re-indexing…`);

  const result = await reindex();
  printIndexResult(clack, result, projectPath);
  return result;
}

/**
 * Write detailed error log to .afyx-graph/errors.log
 */
function writeErrorLog(projectPath: string, errors: Array<{ message: string; filePath?: string; severity: string; code?: string }>): void {
  const cgDir = getAfyxGraphDir(projectPath);
  if (!fs.existsSync(cgDir)) return;

  const logPath = path.join(cgDir, 'errors.log');

  // Group errors by file path
  const errorsByFile = new Map<string, Array<{ message: string; code?: string }>>();
  const noFileErrors: Array<{ message: string; code?: string }> = [];

  for (const err of errors) {
    if (err.severity !== 'error') continue;
    if (err.filePath) {
      let list = errorsByFile.get(err.filePath);
      if (!list) {
        list = [];
        errorsByFile.set(err.filePath, list);
      }
      list.push({ message: err.message, code: err.code });
    } else {
      noFileErrors.push({ message: err.message, code: err.code });
    }
  }

  const lines: string[] = [
    `${PRODUCT_NAME} Error Log - ${new Date().toISOString()}`,
    `${errorsByFile.size} files with errors`,
    '',
  ];

  for (const [filePath, fileErrors] of errorsByFile) {
    for (const err of fileErrors) {
      lines.push(`${filePath}: ${err.message}`);
    }
  }

  for (const err of noFileErrors) {
    lines.push(err.message);
  }

  fs.writeFileSync(logPath, lines.join('\n') + '\n');
}

// =============================================================================
// Commands
// =============================================================================

/**
 * The `init` flow — shared by `afyx-graph init` and `afyx-graph install --init`
 * (#1578): refuse an unsafe root, create `.afyx-graph/`, build the initial
 * index under supervision, then the post-index offers. `yes` makes every
 * offer non-interactive (defaults only), so a container / CI bootstrap never
 * blocks on a prompt. An unsafe root sets `process.exitCode = 1` and returns
 * (no `--force` is implied by any caller); an index failure exits 1.
 */
async function runInit(
  projectPath: string,
  options: { index?: boolean; force?: boolean; verbose?: boolean; yes?: boolean },
): Promise<void> {
  const clack = afyxTerminal;

  clack.intro(`Initializing ${PRODUCT_NAME}`);

  try {
    // Refuse to index your home directory / a filesystem root — it pulls in
    // caches, other projects, and your whole tree (a multi-GB index + watcher
    // churn, and on pre-1.0 macOS a machine-crashing fd blowup, #845).
    const unsafe = unsafeIndexRootReason(projectPath);
    if (unsafe && !options.force) {
      clack.log.error(`Refusing to initialize in ${projectPath} — it looks like ${unsafe}.`);
      clack.log.info('Run this inside a specific project directory, or pass --force if you really mean to index everything under it.');
      clack.outro('');
      process.exitCode = 1;
      return;
    }

    if (isInitialized(projectPath)) {
      clack.log.warn(`Already initialized in ${projectPath}`);
      clack.log.info('Use "afyx-graph index" to re-index or "afyx-graph sync" to update');
      try {
        const { offerWatchFallback } = await import('../installer');
        await offerWatchFallback(clack, projectPath, { yes: options.yes });
      } catch { /* non-fatal */ }
      clack.outro('');
      return;
    }

    const { default: AfyxGraph, getDatabasePath } = await loadAfyxGraph();
    const cg = await AfyxGraph.init(projectPath, { index: false });
    clack.log.success(`Initialized in ${projectPath}`);

    // Indexing runs by default now. The legacy -i/--index flag is still
    // accepted (so existing muscle memory and scripts don't break) but is a
    // no-op — initializing always builds the initial index.
    // Supervise the index: self-terminate if orphaned or wedged (#999).
    // The DB + WAL paths let the liveness watchdog tell a slow store on
    // degraded storage from a true wedge (#1231).
    // A closure so we can re-run the exact same supervised, progress-rendered
    // index if the user opts gitignored child repos in below (#1156).
    const dbPath = getDatabasePath(projectPath);
    const runIndex = async (): Promise<IndexResult> => {
      const supervision = installCommandSupervision('init', { progressPaths: [dbPath, `${dbPath}-wal`] });
      try {
        if (options.verbose) {
          return await cg.indexAll({ onProgress: createVerboseProgress(), verbose: true });
        }
        process.stdout.write(`${colors.dim}${getGlyphs().rail}${colors.reset}\n`);
        const progress = createShimmerProgress();
        const r = await cg.indexAll({ onProgress: progress.onProgress });
        await progress.stop();
        return r;
      } finally {
        supervision.stop();
      }
    };
    const result = await runIndex();
    printIndexResult(clack, result, projectPath);

    // An empty graph at a git super-repo usually means `.gitignore` excludes
    // the child repos that hold the code — surface them and offer to opt in
    // rather than leaving the user with a silent 0-node "Done". (#1156)
    // Under --yes the offer prints its one-line opt-in snippet instead of
    // prompting (same as a non-TTY run).
    if (result.nodesCreated === 0) {
      await offerIndexIgnoredRepos(clack, projectPath, runIndex, { interactive: !options.yes });
    }

    try {
      const { offerWatchFallback } = await import('../installer');
      await offerWatchFallback(clack, projectPath, { yes: options.yes });
    } catch { /* non-fatal */ }

    clack.outro('Done');
    cg.destroy();
  } catch (err) {
    clack.log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * afyx-graph init [path]
 */
program
   .route(cliCommand('init', '[path]'))
   .summary(`Initialize ${PRODUCT_NAME} in a project directory and build the initial index`)
   .flag('-i, --index', 'Deprecated: indexing now runs by default; flag accepted for backward compatibility')
   .flag('-f, --force', 'Initialize even if the path looks like your home directory or a filesystem root')
   .flag('-v, --verbose', 'Show detailed worker lifecycle and memory info')
   .flag('-y, --yes', 'Non-interactive: skip every prompt and take the defaults (for scripts / CI / container bootstraps)')
   .handle(async (pathArg: string | undefined, options: { index?: boolean; force?: boolean; verbose?: boolean; yes?: boolean }) => {
    await runInit(path.resolve(pathArg || process.cwd()), options);
  });

/**
 * afyx-graph uninit [path]
 */
program
   .route(cliCommand('uninit', '[path]'))
   .summary('Remove Afyx Graph from a project (deletes its effective state directory)')
   .flag('-f, --force', 'Skip confirmation prompt')
   .handle(async (pathArg: string | undefined, options: { force?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    try {
      if (!isInitialized(projectPath)) {
        warn(`Afyx Graph is not initialized in ${projectPath}`);
        return;
      }

      if (!options.force) {
        // Confirm with user
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            chalk.yellow(`${getGlyphs().warn} This will permanently delete all ${PRODUCT_NAME} data. Continue? (y/N) `),
            resolve
          );
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          info('Cancelled');
          return;
        }
      }

      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = AfyxGraph.openSync(projectPath);
      cg.uninitialize();

      // External-state mode promises a byte-stable source repository, including
      // .git/hooks. Local-state uninit preserves its historical hook cleanup.
      if (!usesExternalStateDir()) {
        try {
          const { removeGitSyncHook } = await import('../sync/git-hooks');
          const removed = removeGitSyncHook(projectPath);
          if (removed.installed.length > 0) {
            info(`Removed git ${removed.installed.join(', ')} sync hook${removed.installed.length > 1 ? 's' : ''}`);
          }
        } catch { /* non-fatal */ }
      }

      success(`Removed Afyx Graph from ${projectPath}`);

    } catch (err) {
      error(`Failed to uninitialize: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph index [path]
 */
program
   .route(cliCommand('index', '[path]'))
   .summary('Rebuild the full index from scratch (same result as a fresh init)')
   .flag('-f, --force', 'Index even if the path looks like your home directory or a filesystem root')
   .flag('-q, --quiet', 'Suppress progress output')
   .flag('-v, --verbose', 'Show detailed worker lifecycle and memory info')
   .handle(async (pathArg: string | undefined, options: { force?: boolean; quiet?: boolean; verbose?: boolean }) => {
    // An EXPLICIT path names the project to rebuild — it is never a hint to go
    // looking for one. resolveProjectPath walks up to the nearest initialized
    // ancestor, which is right for `afyx-graph query` run from a subdirectory,
    // but for a full re-index it silently rebuilt the parent's graph under a
    // normal "Done" when <path> had no index of its own (#1524). Only a bare
    // `afyx-graph index` (cwd) may resolve upward.
    const projectPath = pathArg ? path.resolve(pathArg) : resolveProjectPath();

    try {
      // Don't (re)index your home directory / a filesystem root (#845). --force
      // doubles as the override.
      const unsafe = unsafeIndexRootReason(projectPath);
      if (unsafe && !options.force) {
        error(`Refusing to index ${projectPath} — it looks like ${unsafe}. Pass --force to override.`);
        process.exit(1);
      }

      if (!isInitialized(projectPath)) {
        error(`Afyx Graph not initialized in ${projectPath}`);
        const ancestor = pathArg ? resolveProjectPath(pathArg) : projectPath;
        if (ancestor !== projectPath) {
          info(`The nearest initialized project is ${ancestor} — pass that path to rebuild it, or run "afyx-graph init" in ${projectPath} to index it on its own.`);
        } else {
          info('Run "afyx-graph init" first');
        }
        process.exit(1);
      }

      const { default: AfyxGraph, getDatabasePath } = await loadAfyxGraph();
      const { withFullReindexWriterLock } = await import('../mcp/writer-lock');
      // `index` is a FULL re-index — identical to a fresh `init`. RECREATE the
      // database from scratch (discard .afyx-graph/afyx-graph.db + its WAL) rather
      // than opening the old graph and DELETE-ing every row. The clear-then-index
      // approach reported "0 nodes" without the clear (#874); the recreate keeps
      // that fixed AND avoids the failure mode where, on a large or pre-fix
      // poisoned index, the per-row FTS delete churn wedged the main thread long
      // enough to trip the liveness watchdog before scanning even began (#1067).
      // recreate() hands back a fresh, empty instance — no clear() needed. For
      // fast incremental updates use `sync`.
      await withFullReindexWriterLock(projectPath, async () => {
        // Ownership is atomic and held before recreate unlinks SQLite. Keep it
        // through the complete rebuild so no daemon/direct writer can enter
        // between database replacement and index completion.
        const cg = await AfyxGraph.recreate(projectPath);

        // Supervise the indexer: self-terminate if orphaned (parent shim killed)
        // or if the main thread wedges — neither was guarded on this path (#999).
        // The DB + WAL paths let the liveness watchdog tell a slow store on
        // degraded storage from a true wedge (#1231).
        const dbPath = getDatabasePath(projectPath);
        const supervision = installCommandSupervision('index', { progressPaths: [dbPath, `${dbPath}-wal`] });
        try {
          if (options.quiet) {
            // Quiet mode: no UI, just run against the freshly-recreated graph.
            const result = await cg.indexAll();
            if (!result.success) process.exitCode = 1;
            return;
          }

          const clack = afyxTerminal;
          clack.intro('Indexing project');

        // A closure so a re-index (after opting gitignored child repos in, #1156)
        // renders identically. Supervision already wraps the whole command.
          const renderIndex = async (): Promise<IndexResult> => {
            if (options.verbose) {
              return await cg.indexAll({ onProgress: createVerboseProgress(), verbose: true });
            }
            process.stdout.write(`${colors.dim}${getGlyphs().rail}${colors.reset}\n`);
            const progress = createShimmerProgress();
            const r = await cg.indexAll({ onProgress: progress.onProgress });
            await progress.stop();
            return r;
          };

          const result = await renderIndex();

          printIndexResult(clack, result, projectPath);

        // Empty graph at a git super-repo → likely `.gitignore`d child repos;
        // name them and offer to opt in instead of a silent 0-node result (#1156).
          let finalResult = result;
          if (result.nodesCreated === 0) {
            finalResult = (await offerIndexIgnoredRepos(clack, projectPath, renderIndex, { interactive: true })) ?? result;
          }

          if (!finalResult.success) {
            process.exitCode = 1;
            return;
          }

          clack.outro('Done');
        } finally {
          supervision.stop();
          cg.destroy();
        }
      });
    } catch (err) {
      error(`Failed to index: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph sync [path]
 */
program
   .route(cliCommand('sync', '[path]'))
   .summary('Sync changes since last index')
   .flag('-q, --quiet', 'Suppress output (for git hooks)')
   .handle(async (pathArg: string | undefined, options: { quiet?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    try {
      if (!isInitialized(projectPath)) {
        if (!options.quiet) {
          error(`Afyx Graph not initialized in ${projectPath}`);
        }
        process.exit(1);
      }

      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = await AfyxGraph.open(projectPath);

      if (options.quiet) {
        await cg.sync();
        cg.destroy();
        return;
      }

      const clack = afyxTerminal;
      clack.intro(`Syncing ${PRODUCT_NAME}`);

      process.stdout.write(`${colors.dim}${getGlyphs().rail}${colors.reset}\n`);
      const progress = createShimmerProgress();

      const result = await cg.sync({
        onProgress: progress.onProgress,
      });

      await progress.stop();

      const totalChanges = result.filesAdded + result.filesModified + result.filesRemoved;

      if (totalChanges === 0) {
        clack.log.info('Already up to date');
      } else {
        clack.log.success(`Synced ${formatNumber(totalChanges)} changed files`);
        const details: string[] = [];
        if (result.filesAdded > 0) details.push(`Added: ${result.filesAdded}`);
        if (result.filesModified > 0) details.push(`Modified: ${result.filesModified}`);
        if (result.filesRemoved > 0) details.push(`Removed: ${result.filesRemoved}`);
        clack.log.info(`${details.join(', ')} ${getGlyphs().dash} ${formatNumber(result.nodesUpdated)} nodes in ${formatDuration(result.durationMs)}`);
      }

      clack.outro('Done');
      cg.destroy();
    } catch (err) {
      if (!options.quiet) {
        error(`Failed to sync: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

/**
 * afyx-graph status [path]
 */
program
   .route(cliCommand('status', '[path]'))
   .summary('Show index status and statistics')
   .flag('-j, --json', 'Output as JSON')
   .handle(async (pathArg: string | undefined, options: { json?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);
    // The directory the user actually ran from, before walking up to the index
    // root. Used to detect when the resolved index lives in a different git
    // working tree (e.g. a nested worktree borrowing the main checkout's index).
    const startPath = path.resolve(pathArg || process.cwd());
    const worktreeMismatch = detectWorktreeIndexMismatch(startPath, projectPath);
    const { getFreshness } = await import('../freshness');
    const freshness = getFreshness(projectPath);

    try {
      if (!isInitialized(projectPath)) {
        if (options.json) {
          console.log(JSON.stringify({
            initialized: false,
            version: packageJson.version,
            projectPath,
            indexPath: getAfyxGraphDir(projectPath),
            lastIndexed: null,
            freshness,
          }));
          return;
        }
        console.log(chalk.bold(`\n${PRODUCT_NAME} Status\n`));
        info(`Project: ${projectPath}`);
        warn('Not initialized');
        info('Run "afyx-graph init" to initialize');
        return;
      }

      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = await AfyxGraph.open(projectPath);
      const stats = cg.getStats();
      const changes = cg.getChangedFiles();
      const backend = cg.getBackend();
      const journalMode = cg.getJournalMode();

      const buildInfo = cg.getIndexBuildInfo();
      const reindexRecommended = cg.isIndexStale();
      const indexState = cg.getIndexState();
      // Zero on a healthy index; non-zero at rest means a resolution pass was
      // interrupted, so some files' call edges are missing (#1187).
      const pendingRefs = cg.getPendingReferenceCount();
      const accounting = cg.getIndexAccounting();
      const health = buildIndexHealth(cg, projectPath, {
        freshness,
        diskChanges: {
          added: changes.added.length,
          modified: changes.modified.length,
          removed: changes.removed.length,
        },
      });

      // JSON output mode
      if (options.json) {
        const lastIndexedMs = cg.getLastIndexedAt();
        console.log(JSON.stringify({
          initialized: true,
          version: packageJson.version,
          projectPath,
          indexPath: getAfyxGraphDir(projectPath),
          lastIndexed: lastIndexedMs != null ? new Date(lastIndexedMs).toISOString() : null,
          freshness,
          health,
          fileCount: stats.fileCount,
          nodeCount: stats.nodeCount,
          edgeCount: stats.edgeCount,
          dbSizeBytes: stats.dbSizeBytes,
          walSizeBytes: stats.walSizeBytes,
          backend,
          journalMode,
          nodesByKind: stats.nodesByKind,
          languages: Object.entries(stats.filesByLanguage).filter(([, count]) => count > 0).map(([lang]) => lang),
          pendingChanges: {
            added: changes.added.length,
            modified: changes.modified.length,
            removed: changes.removed.length,
          },
          worktreeMismatch: worktreeMismatch
            ? { worktreeRoot: worktreeMismatch.worktreeRoot, indexRoot: worktreeMismatch.indexRoot }
            : null,
          index: {
            builtWithVersion: buildInfo.version,
            builtWithExtractionVersion: buildInfo.extractionVersion,
            currentExtractionVersion: EXTRACTION_VERSION,
            reindexRecommended,
            // 'complete' | 'partial' (files silently dropped) | 'indexing'
            // (a run was killed mid-index — the index is truncated) |
            // 'failed' | null (predates the marker).
            state: indexState,
            accounting,
            // References awaiting resolution. Non-zero at rest means an
            // interrupted resolution pass left edges missing; the next
            // sync sweeps them (#1187).
            pendingRefs,
          },
        }));
        cg.destroy();
        return;
      }

      console.log(chalk.bold(`\n${PRODUCT_NAME} Status\n`));

      // Project info
      console.log(chalk.cyan('Project:'), projectPath);
      console.log(chalk.cyan('Freshness:'), `${freshness.state} — ${freshness.detail}`);
      if (worktreeMismatch) {
        warn(worktreeMismatchWarning(worktreeMismatch));
      }
      if (indexState === 'indexing') {
        warn('The last index run never finished (killed mid-index?) — the index is truncated. Re-run "afyx-graph index".');
      } else if (indexState === 'partial') {
        warn('The last index run silently dropped files — the index is partial. Re-run "afyx-graph index".');
      } else if (indexState === 'failed') {
        warn('The last index run failed — results may be incomplete. Re-run "afyx-graph index".');
      }
      if (pendingRefs > 0) {
        warn(`${formatNumber(pendingRefs)} references from an interrupted run are awaiting resolution — some callers/impact edges are missing. Run "afyx-graph sync" to resolve them.`);
      }
      if (accounting) {
        console.log(
          `Last extraction: ${formatNumber(accounting.discovered)} discovered, ` +
          `${formatNumber(accounting.eligible)} eligible, ${formatNumber(accounting.indexed)} indexed, ` +
          `${formatNumber(accounting.skipped)} skipped, ${formatNumber(accounting.unsupported)} unsupported, ` +
          `${formatNumber(accounting.failed)} failed; retries ` +
          `${formatNumber(accounting.retry.recoveredFiles)}/${formatNumber(accounting.retry.attemptedFiles)} recovered`
        );
        if (accounting.metadataIndexed !== null) {
          console.log(
            `  Catalog depth: ${formatNumber(accounting.metadataIndexed)} metadata-indexed, ` +
            `${formatNumber(accounting.contentIndexed ?? 0)} content-indexed, ` +
            `${formatNumber(accounting.structurallyIndexed ?? 0)} structurally indexed.`
          );
        }
        console.log('  Ignored paths are not enumerated (ignored count: unknown).');
      }
      console.log();

      // Index stats
      console.log(chalk.bold('Index Statistics:'));
      console.log(`  Files:     ${formatNumber(stats.fileCount)}`);
      console.log(`  Nodes:     ${formatNumber(stats.nodeCount)}`);
      console.log(`  Edges:     ${formatNumber(stats.edgeCount)}`);
      console.log(`  DB Size:   ${(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`);
      // Surface the WAL sidecar (#1431): a WAL that dwarfs the DB at rest is
      // the killed-session leak — invisible before this line, it only showed
      // up as a mysteriously full disk. open() above already kicked off the
      // automatic heal for the oversized case.
      if (stats.walSizeBytes > 0) {
        const { WAL_HEAL_THRESHOLD_BYTES } = await import('../db/index');
        const oversized = stats.walSizeBytes > Math.max(WAL_HEAL_THRESHOLD_BYTES, stats.dbSizeBytes);
        const walLabel = `${(stats.walSizeBytes / 1024 / 1024).toFixed(2)} MB`;
        console.log(`  WAL Size:  ${oversized ? chalk.yellow(walLabel) : walLabel}`);
        if (oversized) {
          warn('The write-ahead log is larger than the database — killed sessions left it behind. It is reclaimed automatically on open; if it persists across runs, another live Afyx Graph process is holding it.');
        }
      }
      // Surface the active SQLite backend (node:sqlite — Node's built-in real
      // SQLite, full WAL + FTS5, no native build).
      const backendLabel = chalk.green(`node:sqlite ${getGlyphs().dash} built-in (full WAL)`);
      console.log(`  Backend:   ${backendLabel}`);
      // Effective journal mode: 'wal' means concurrent reads never block on a
      // writer; anything else means they can ("database is locked"). node:sqlite
      // supports WAL everywhere, so a non-wal mode means the filesystem can't
      // (network mounts, WSL2 /mnt). See issue #238.
      const journalLabel = journalMode === 'wal'
        ? chalk.green('wal')
        : chalk.yellow(`${journalMode || 'unknown'} ${getGlyphs().dash} WAL inactive; reads can block on writes`);
      console.log(`  Journal:   ${journalLabel}`);
      console.log();

      // Node breakdown
      console.log(chalk.bold('Nodes by Kind:'));
      const nodesByKind = Object.entries(stats.nodesByKind)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]);
      for (const [kind, count] of nodesByKind) {
        console.log(`  ${kind.padEnd(15)} ${formatNumber(count)}`);
      }
      console.log();

      // Language breakdown
      console.log(chalk.bold('Files by Language:'));
      const filesByLang = Object.entries(stats.filesByLanguage)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]);
      for (const [lang, count] of filesByLang) {
        console.log(`  ${lang.padEnd(15)} ${formatNumber(count)}`);
      }
      console.log();

      // Pending changes
      const totalChanges = changes.added.length + changes.modified.length + changes.removed.length;
      if (totalChanges > 0) {
        console.log(chalk.bold('Pending Changes:'));
        if (changes.added.length > 0) {
          console.log(`  Added:     ${changes.added.length} files`);
        }
        if (changes.modified.length > 0) {
          console.log(`  Modified:  ${changes.modified.length} files`);
        }
        if (changes.removed.length > 0) {
          console.log(`  Removed:   ${changes.removed.length} files`);
        }
        info('Run "afyx-graph sync" to update the index');
      } else {
        success('Filesystem/content comparison is current');
      }
      console.log();

      console.log(chalk.bold('Index Health:'));
      console.log(`  Git snapshot:       ${health.gitFreshness.state} ${getGlyphs().dash} ${health.gitFreshness.detail}`);
      console.log(`  Filesystem/content: ${health.pendingChanges.state}${health.pendingChanges.count === null ? '' : ` (${health.pendingChanges.count} pending)`}`);
      console.log(`  Extraction:         ${health.extraction.state.toUpperCase()}`);
      console.log(`  Extraction version: ${health.compatibility.builtWithExtractionVersion ?? 'unknown'}/${health.compatibility.currentExtractionVersion}${health.compatibility.reindexRecommended ? ' (re-index recommended)' : ''}`);
      console.log(`  Pending references: ${health.pendingReferences}`);
      console.log(`  Watcher:            ${health.watcher.state} in this process${health.watcher.reason ? ` ${getGlyphs().dash} ${health.watcher.reason}` : ''}`);
      if (accounting?.skippedReasons && Object.keys(accounting.skippedReasons).length > 0) {
        console.log(`  Skipped reasons:    ${Object.entries(accounting.skippedReasons).map(([reason, count]) => `${reason}=${count}`).join(', ')}`);
      }
      if (accounting?.timings) {
        const timing = accounting.timings;
        console.log(`  Last full timing:   scan ${timing.scanMs}ms; parse/store ${timing.parseStoreMs}ms; resolve/link ${timing.resolutionLinkMs}ms; maintenance ${timing.maintenanceMs}ms; total ${timing.totalMs}ms`);
      } else {
        console.log('  Last full timing:   unavailable');
      }
      console.log();

      // Re-index hint: the index was built by an older engine than the one now
      // running, so a rebuild would add data a migration can't backfill.
      if (reindexRecommended) {
        const builtWith = buildInfo.version ? `v${buildInfo.version.replace(/^v/, '')}` : 'an earlier version';
        warn(`Index was built by ${builtWith}; re-index to pick up this engine's improvements.`);
        info('Run "afyx-graph index" (full rebuild) or "afyx-graph sync"');
        console.log();
      }

      cg.destroy();
    } catch (err) {
      error(`Failed to get status: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph query <search>
 */
program
   .route(cliCommand('query', '<search>'))
   .summary('Search for symbols in the codebase')
   .flag('-p, --path <path>', 'Project path')
   .flag('-l, --limit <number>', 'Maximum results', '10')
   .flag('-k, --kind <kind>', 'Filter by node kind (function, class, etc.)')
   .flag('-j, --json', 'Output as JSON')
   .handle(async (search: string, options: { path?: string; limit?: string; kind?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`Afyx Graph not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = await AfyxGraph.open(projectPath);

      const limit = parseInt(options.limit || '10', 10);
      const rawResults = cg.searchNodes(search, {
        // Fetch one extra row so the CLI can report a cut without changing the
        // long-standing bare-array contract of `query --json` (#1639).
        limit: limit + 1,
        kinds: options.kind ? [options.kind as any] : undefined,
      });

      // Mirror the MCP search down-rank so the CLI also surfaces the
      // hand-written implementation before protobuf/gRPC scaffolding
      // when both share a name. See extraction/generated-detection.ts.
      const isGen = cg.generatedFilePredicate(rawResults.map((r) => r.node.filePath));
      const rankedResults = [...rawResults].sort((a, b) => {
        const aGen = isGen(a.node.filePath) ? 1 : 0;
        const bGen = isGen(b.node.filePath) ? 1 : 0;
        return aGen - bGen;
      });
      const truncated = rankedResults.length > limit;
      const results = rankedResults.slice(0, limit);
      const truncationMessage = `Results truncated at ${limit}; pass --limit to widen.`;

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        if (truncated) console.error(truncationMessage);
      } else {
        if (results.length === 0) {
          info(`No results found for "${search}"`);
        } else {
          console.log(chalk.bold(`\nSearch Results for "${search}":\n`));

          // Results arrive already ranked by relevance, so the order conveys
          // it. We don't print the raw score: it's an unbounded BM25/FTS value
          // (relative-ranking only), and the old `(score * 100)%` rendered it
          // as nonsensical percentages like "12042%" (#1045). The MCP search
          // tool likewise shows no score. Raw `score` stays in --json output.
          for (const result of results) {
            const node = result.node;
            const location = `${node.filePath}:${node.startLine}`;

            console.log(
              chalk.cyan(node.kind.padEnd(12)) +
              chalk.white(node.name)
            );
            console.log(chalk.dim(`  ${location}`));
            if (node.signature) {
              console.log(chalk.dim(`  ${node.signature}`));
            }
            console.log();
          }
          if (truncated) console.log(chalk.dim(truncationMessage));
        }
      }

      cg.destroy();
    } catch (err) {
      error(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph inventory <declaration> <value>
 */
program
   .route(cliCommand('inventory', '<declaration> <value>'))
   .summary('Enumerate exact indexed Python class assignments (same output as afyx_graph_inventory)')
   .flag('-p, --path <path>', 'Project path')
   .flag('-s, --scope <path>', 'Project-relative inventory scope')
   .flag('--offset <number>', 'Zero-based page offset', '0')
   .flag('-l, --limit <number>', 'Maximum declarations to display (max 200)', '100')
   .handle(async (declaration: string, value: string, options: { path?: string; scope?: string; offset?: string; limit?: string }) => {
    const projectPath = resolveProjectPath(options.path);
    try {
      if (!isInitialized(projectPath)) {
        error(`Afyx Graph not initialized in ${projectPath}`);
        process.exit(1);
      }
      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = await AfyxGraph.open(projectPath);
      const { ToolHandler } = await import('../mcp/tools');
      const handler = new ToolHandler(cg);
      const result = await handler.execute('afyx_graph_inventory', {
        declaration,
        value,
        path: options.scope,
        offset: Number(options.offset ?? '0'),
        limit: Number(options.limit ?? '100'),
      });
      console.log(result.content[0]?.text ?? '');
      cg.destroy();
      if (result.isError) process.exit(1);
    } catch (err) {
      error(`Inventory failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph explore <query...>
 *
 * The CLI face of the MCP afyx_graph_explore tool — same handler, same
 * output (source of the relevant symbols grouped by file + the call path
 * among them). Exists so agents WITHOUT the MCP tools — Task-tool
 * subagents (which don't inherit MCP tools, #704) and non-MCP harnesses —
 * can reach the graph through a plain shell command.
 */
program
   .route(cliCommand('explore', '<query...>'))
   .summary('Explore an area: relevant symbols\' source + call paths in one shot (same output as the afyx_graph_explore MCP tool)')
   .flag('-p, --path <path>', 'Project path')
   .flag('--max-files <number>', 'Maximum number of files to include source from')
   .handle(async (queryParts: string[], options: { path?: string; maxFiles?: string }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
    error(`Afyx Graph isn't available here — no local or externally bound index exists for ${projectPath}. If you are an AI agent: continue with your usual tools; indexing is the user's decision, do not run it yourself. (The project owner can enable Afyx Graph with 'afyx-graph init'.)`);
        process.exit(1);
      }

      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = await AfyxGraph.open(projectPath);
      const { ToolHandler } = await import('../mcp/tools');
      const handler = new ToolHandler(cg);

      const args: Record<string, unknown> = { query: queryParts.join(' ') };
      if (options.maxFiles) args.maxFiles = parseInt(options.maxFiles, 10);
      const result = await handler.execute('afyx_graph_explore', args);

      console.log(result.content[0]?.text ?? '');
      cg.destroy();
      if (result.isError) process.exit(1);
    } catch (err) {
      error(`Explore failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph context <task...>
 *
 * The CLI face of the public `buildContext` API (ContextBuilder): FTS entry
 * points + graph expansion + code blocks, formatted as markdown or JSON.
 * Advertised in the usage header since the first release but never actually
 * registered (#1611); external integrations (e.g. Memorix) invoke it as
 * `afyx-graph context --path <root> --format json --max-nodes 8 --no-code <task>`.
 */
program
   .route(cliCommand('context', '<task...>'))
   .summary('Build context for a task: relevant symbols, relationships, and code blocks')
   .flag('-p, --path <path>', 'Project path')
   .flag('-f, --format <format>', 'Output format: markdown or json', 'markdown')
   .flag('-n, --max-nodes <number>', 'Maximum number of symbols to include')
   .flag('--no-code', 'Omit code blocks (structure only)')
   .handle(async (taskParts: string[], options: { path?: string; format?: string; maxNodes?: string; code?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    const format = options.format ?? 'markdown';
    if (format !== 'markdown' && format !== 'json') {
      error(`Unknown format "${options.format}" — use "markdown" or "json".`);
      process.exit(1);
    }
    let maxNodes: number | undefined;
    if (options.maxNodes !== undefined) {
      maxNodes = parseInt(options.maxNodes, 10);
      if (Number.isNaN(maxNodes) || maxNodes < 1) {
        error(`--max-nodes expects a positive integer, got "${options.maxNodes}".`);
        process.exit(1);
      }
    }

    try {
      if (!isInitialized(projectPath)) {
        error(`Afyx Graph not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = await AfyxGraph.open(projectPath);

      const result = await cg.buildContext(taskParts.join(' '), {
        format,
        includeCode: options.code !== false,
        ...(maxNodes !== undefined ? { maxNodes } : {}),
      });

      // Both supported formats return a formatted string; print it verbatim so
      // `--format json` stays machine-parseable on stdout (error()/warnings go
      // to stderr only).
      console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
      cg.destroy();
    } catch (err) {
      error(`Context build failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph prompt-hook  (hidden)
 *
 * A Claude Code `UserPromptSubmit` hook entry point. Reads `{prompt, cwd}` JSON
 * on stdin; for a structural/flow/impact prompt it runs `afyx_graph_explore` on
 * the indexed project and prints the result to stdout, which Claude injects into
 * the agent's context — so the agent's reflex grep/read has nothing left to find
 * and reliably uses Afyx Graph (the adoption problem). Installed by the installer
 * into Claude's settings.json (opt-in, default-yes).
 *
 * LOAD-BEARING: this must NEVER break the user's prompt. Every failure path —
 * kill-switch, non-structural prompt, no index, engine error — exits 0 with no
 * output. The only effect is additive context when it can confidently provide it.
 */
program
   .route(cliCommand('prompt-hook'), cliCommandOptions('prompt-hook'))
   .summary(`Claude UserPromptSubmit hook: inject ${PRODUCT_NAME} context for structural prompts (reads {prompt,cwd} JSON on stdin)`)
   .handle(async () => {
    try {
      // Kill-switch: lets a user disable the nudge without uninstalling /
      // editing settings.json (CI, low-power machines, personal preference).
      if (process.env.AFYX_GRAPH_NO_PROMPT_HOOK === '1' || process.env.AFYX_GRAPH_PROMPT_HOOK === '0') return;
      if (process.stdin.isTTY) return; // invoked by hand, no piped payload

      const raw = await new Promise<string>((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (c) => { data += c; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(data));
      });

      let input: { prompt?: string; cwd?: string } = {};
      try { input = JSON.parse(raw); } catch { return; }
      const prompt = String(input.prompt || '');

      // Gate, tiered by confidence (#994, #1126):
      //   HIGH   — a structural keyword (any covered language), or a code-shaped
      //            token verified in the index → full explore injection.
      //   MEDIUM — no keyword/token, but prose words match indexed symbol-name
      //            SEGMENTS ("state machine" → OrderStateMachine, in any
      //            language): inject a short list of the matching symbols and
      //            let the AGENT write the explore query — the graph-derived
      //            tier, no vocabulary involved.
      //   silent — nothing verified. Every other prompt ("fix this typo")
      //            stays a zero-cost no-op.
      // Keywords fire on their own; a token or prose word is only a CANDIDATE
      // verified against the graph below, so a tech brand ("JavaScript") that
      // merely looks like code doesn't inject spurious context.
      const keyworded = hasStructuralKeyword(prompt);
      const codeTokens = keyworded ? [] : extractCodeTokens(prompt);
      const proseWords = keyworded ? [] : extractProseCandidates(prompt);
      if (!keyworded && codeTokens.length === 0 && proseWords.length === 0) { return; }

      // Decide what to inject, shaped by WHERE the index(es) are: the nearest
      // indexed ancestor of cwd, or — when cwd is an un-indexed workspace root
      // whose indexed project(s) live in sub-dirs (the monorepo case, #964) —
      // the sub-project the prompt points at, plus a `projectPath` nudge for any
      // others. Without the down-scan the hook injected nothing at a monorepo
      // root (it only walked up), so the validated adoption lever never fired
      // exactly where the agent most needs it.
      const plan = planFrontload(String(input.cwd || process.cwd()), prompt);
      if (!plan.exploreRoot && plan.nudgeProjects.length === 0) { return; } // nothing reachable — the agent's normal tools apply

      // A "pass projectPath" line for indexed sub-projects we did NOT front-load.
      // Follow-up afyx_graph_explore calls against a sub-project (cwd isn't its
      // index root) need an explicit projectPath, so spell it out.
      const nudge = (projects: string[], lead: string): string =>
        `${lead}\n${projects.map((p) => `  - projectPath: "${p}"`).join('\n')}\n`;

      if (plan.exploreRoot) {
        const { default: AfyxGraph } = await loadAfyxGraph();
        const cg = await AfyxGraph.open(plan.exploreRoot);
        try {
          const others = plan.nudgeProjects.length
            ? `\n${nudge(plan.nudgeProjects, 'Other indexed projects in this workspace — pass projectPath to query them:')}`
            : '';

          // Tier decision against THIS index (issue #994 follow-up: candidates
          // must be real here — a brand name or prose about another domain
          // must not inject). Keyword-bearing prompts skip verification — the
          // keyword is signal enough.
          const tokenVerified = !keyworded && codeTokens.some((t) => cg.getNodesByName(t).length > 0);
          if (keyworded || tokenVerified) {
            const { ToolHandler } = await import('../mcp/tools');
            const handler = new ToolHandler(cg);
            const result = await handler.execute('afyx_graph_explore', { query: prompt });
            const text = result.content[0]?.text ?? '';
            if (!result.isError && text.trim()) {
              // Cap the injection so a large-repo explore can't flood the prompt.
              // Claude Code shows hook stdout inline only up to 10,000 characters;
              // above that it persists the output to a file and the model sees a
              // 2 KB preview (#1694). PROMPT_HOOK_INJECTION_MAX (9,000) leaves
              // room for the wrapper and the projectPath nudge lines below.
              const body = capPromptHookInjection(text);
              // For a front-loaded SUB-project, a follow-up explore needs its path.
              const more = plan.viaSubScan
                ? `call afyx_graph_explore with projectPath: "${plan.exploreRoot}" for more`
                : 'call afyx_graph_explore for more';
              process.stdout.write(
                `<afyx_graph_context note="Structural context from Afyx Graph for this prompt — treat returned source as already read; ${more}.">\n${body}${others}\n</afyx_graph_context>\n`,
              );
            }
            return;
          }

          // MEDIUM: prose words → symbol-name segments, co-occurrence/rarity
          // scored, each hit re-verified to exist (see getSegmentMatches). The
          // payload names the symbols but does NOT run explore — the agent owns
          // the query where the hook's confidence is only "these are related".
          //
          // A database indexed before the vocab table existed starts with it
          // EMPTY, and only sync() backfills it — which this hook never runs
          // (#1142). Heal it here: on a populated vocab this is one SELECT;
          // the actual backfill is a one-time batched pass whose cost the MCP
          // server's own catch-up sync usually pays first (it runs at every
          // session start). A distinct noop outcome keeps a dormant vocab
          // from polluting the noop-unverified recall signal.
          const vocabReady = await cg.healSegmentVocabIfEmpty().catch(() => false);
          if (!vocabReady) { return; }
          const related = cg.getSegmentMatches(proseWords);
          if (related.length === 0) { return; }
          const lines = related
            .map((m) => `  - ${m.name} (${m.kind} — ${m.filePath}:${m.startLine})`)
            .join('\n');
          const exampleQuery = related.slice(0, 3).map((m) => m.name).join(' ');
          const projectHint = plan.viaSubScan ? ` with projectPath: "${plan.exploreRoot}"` : '';
          process.stdout.write(
            `<afyx_graph_context note="Afyx Graph found indexed symbols matching this prompt — query the graph before searching files.">\n` +
            `This project's Afyx Graph index contains symbols matching this request:\n${lines}\n` +
            `Call afyx_graph_explore ONCE${projectHint} with the relevant names in one query (e.g. "${exampleQuery}") ` +
            `to get their source, call paths, and blast radius — cheaper and more complete than Read/Grep.\n${others}` +
            `</afyx_graph_context>\n`,
          );
                  } finally {
          cg.destroy();
        }
      } else {
        // Several indexed sub-projects, none a clear match — don't guess; tell
        // the agent they exist and how to query one.
        process.stdout.write(
          `<afyx_graph_context note="Afyx Graph is available for this workspace's indexed sub-projects — query one by passing projectPath to afyx_graph_explore.">\n` +
          nudge(plan.nudgeProjects, "This workspace's Afyx Graph indexes live in sub-projects. To use Afyx Graph, call afyx_graph_explore with the projectPath of the relevant one:") +
          `</afyx_graph_context>\n`,
        );
              }
    } catch {
      // Degradable by contract: never surface an error to the prompt pipeline.
    }
  });

/**
 * afyx-graph node [name]
 *
 * The CLI face of the MCP afyx_graph_node tool: one symbol's source +
 * caller/callee trail, or a whole file with line numbers + dependents
 * (Read-parity). Same subagent/non-MCP rationale as `explore`.
 *
 * `name` is OPTIONAL because `--file` (file-read mode) carries no symbol —
 * a required `<name>` made `afyx-graph node -f <file>` unreachable (#1044).
 */
program
   .route(cliCommand('node', '[name]'))
   .summary('One symbol\'s source + caller/callee trail, or read a file with line numbers + dependents (same output as the afyx_graph_node MCP tool)')
   .flag('-p, --path <path>', 'Project path')
   .flag('-f, --file <file>', 'Treat as file mode (or disambiguate a symbol to this file)')
   .flag('--offset <number>', 'File mode: 1-based start line')
   .flag('--limit <number>', 'File mode: maximum lines')
   .flag('--symbols-only', 'File mode: just the symbol map + dependents')
   .handle(async (name: string | undefined, options: { path?: string; file?: string; offset?: string; limit?: string; symbolsOnly?: boolean }) => {
    // Need a symbol (positional) OR a file (--file / a path-like positional).
    // With [name] optional, a bare `afyx-graph node` reaches here with neither
    // and must be told what to pass, rather than crashing downstream.
    if (!name && !options.file) {
      error("Pass a symbol name (e.g. 'afyx-graph node parseToken') or a file (e.g. 'afyx-graph node -f src/auth.ts', or 'afyx-graph node src/auth.ts').");
      process.exit(1);
    }

    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
    error(`Afyx Graph isn't available here — no local or externally bound index exists for ${projectPath}. If you are an AI agent: continue with your usual tools; indexing is the user's decision, do not run it yourself. (The project owner can enable Afyx Graph with 'afyx-graph init'.)`);
        process.exit(1);
      }

      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = await AfyxGraph.open(projectPath);
      const { ToolHandler } = await import('../mcp/tools');
      const handler = new ToolHandler(cg);

      // A name with a path separator is a file read; otherwise a symbol
      // (use --file for basename-only file reads or to pin an overload).
      // Both separators: Windows users type src\auth\session.ts. Symbols
      // never contain either ('/' isn't an identifier char anywhere we
      // index; C++ scope is '::', JS members '.').
      const args: Record<string, unknown> = {};
      if (options.file) {
        args.file = options.file;
        if (name && name !== options.file) {
          args.symbol = name;
          // Symbol mode pinned to a file is still symbol mode — the CLI
          // always wants the body, exactly like the bare-symbol branch
          // below. Omitting this printed location + trail with no source
          // (#1284).
          args.includeCode = true;
        }
      } else if (name && (name.includes('/') || name.includes('\\'))) {
        args.file = name.replace(/\\/g, '/');
      } else if (name) {
        args.symbol = name;
        args.includeCode = true;
      }
      if (options.offset) args.offset = parseInt(options.offset, 10);
      if (options.limit) args.limit = parseInt(options.limit, 10);
      if (options.symbolsOnly) args.symbolsOnly = true;

      const result = await handler.execute('afyx_graph_node', args);

      console.log(result.content[0]?.text ?? '');
      cg.destroy();
      if (result.isError) process.exit(1);
    } catch (err) {
      error(`Node lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph files [path]
 */
program
   .route(cliCommand('files'))
   .summary('Show project file structure from the index')
   .flag('-p, --path <path>', 'Project path')
   .flag('--filter <dir>', 'Filter to files under this directory')
   .flag('--pattern <glob>', 'Filter files matching this glob pattern')
   .flag('--format <format>', 'Output format (tree, flat, grouped)', 'tree')
   .flag('--max-depth <number>', 'Maximum directory depth for tree format')
   .flag('--no-metadata', 'Hide file metadata (language, symbol count)')
   .flag('-j, --json', 'Output as JSON')
   .handle(async (options: {
    path?: string;
    filter?: string;
    pattern?: string;
    format?: string;
    maxDepth?: string;
    metadata?: boolean;
    json?: boolean;
  }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`Afyx Graph not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = await AfyxGraph.open(projectPath);
      let files = cg.getFiles();

      if (files.length === 0) {
        info('No files indexed. Run "afyx-graph index" first.');
        cg.destroy();
        return;
      }

      // Filter by path prefix
      if (options.filter) {
        const filter = options.filter;
        files = files.filter(f => f.path.startsWith(filter) || f.path.startsWith('./' + filter));
      }

      // Filter by glob pattern
      if (options.pattern) {
        const regex = globToRegex(options.pattern);
        files = files.filter(f => regex.test(f.path));
      }

      if (files.length === 0) {
        info('No files found matching the criteria.');
        cg.destroy();
        return;
      }

      // JSON output
      if (options.json) {
        const output = files.map(f => ({
          path: f.path,
          language: f.language,
          nodeCount: f.nodeCount,
          size: f.size,
        }));
        console.log(JSON.stringify(output, null, 2));
        cg.destroy();
        return;
      }

      const includeMetadata = options.metadata !== false;
      const format = options.format || 'tree';
      const maxDepth = options.maxDepth ? parseInt(options.maxDepth, 10) : undefined;

      // Format output
      switch (format) {
        case 'flat':
          console.log(chalk.bold(`\nFiles (${files.length}):\n`));
          for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
            if (includeMetadata) {
              console.log(`  ${file.path} ${chalk.dim(`(${file.language}, ${file.nodeCount} symbols)`)}`);
            } else {
              console.log(`  ${file.path}`);
            }
          }
          break;

        case 'grouped':
          console.log(chalk.bold(`\nFiles by Language (${files.length} total):\n`));
          const byLang = new Map<string, typeof files>();
          for (const file of files) {
            const existing = byLang.get(file.language) || [];
            existing.push(file);
            byLang.set(file.language, existing);
          }
          const sortedLangs = [...byLang.entries()].sort((a, b) => b[1].length - a[1].length);
          for (const [lang, langFiles] of sortedLangs) {
            console.log(chalk.cyan(`${lang} (${langFiles.length}):`));
            for (const file of langFiles.sort((a, b) => a.path.localeCompare(b.path))) {
              if (includeMetadata) {
                console.log(`  ${file.path} ${chalk.dim(`(${file.nodeCount} symbols)`)}`);
              } else {
                console.log(`  ${file.path}`);
              }
            }
            console.log();
          }
          break;

        case 'tree':
        default:
          console.log(chalk.bold(`\nProject Structure (${files.length} files):\n`));
          printFileTree(files, includeMetadata, maxDepth, chalk);
          break;
      }

      console.log();
      cg.destroy();
    } catch (err) {
      error(`Failed to list files: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * Normalize a user-supplied file path to the project-relative, forward-slash
 * form Afyx Graph stores in the index. Accepts an absolute path, a `./`-prefixed
 * path, or Windows back-slashes; an empty string when the input is blank. Used
 * by `afyx-graph affected` so `./src/x.ts`, `/abs/repo/src/x.ts`, and
 * `src/x.ts` all match the same indexed file. (#825)
 */
function normalizeIndexPath(filePath: string, projectPath: string): string {
  let f = filePath.trim();
  if (!f) return '';
  if (path.isAbsolute(f)) f = path.relative(projectPath, f);
  // Collapse `.`/`..` segments, then force forward slashes and drop a leading
  // `./` (path.normalize already strips it on POSIX; explicit for Windows).
  f = path.normalize(f).replace(/\\/g, '/').replace(/^\.\//, '');
  return f;
}

/**
 * Convert glob pattern to regex
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(escaped);
}

/**
 * Print files as a tree
 */
function printFileTree(
  files: { path: string; language: string; nodeCount: number }[],
  includeMetadata: boolean,
  maxDepth: number | undefined,
  chalk: { dim: (s: string) => string; cyan: (s: string) => string }
): void {
  interface TreeNode {
    name: string;
    children: Map<string, TreeNode>;
    file?: { language: string; nodeCount: number };
  }

  const root: TreeNode = { name: '', children: new Map() };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      if (!current.children.has(part)) {
        current.children.set(part, { name: part, children: new Map() });
      }
      current = current.children.get(part)!;

      if (i === parts.length - 1) {
        current.file = { language: file.language, nodeCount: file.nodeCount };
      }
    }
  }

  const renderNode = (node: TreeNode, prefix: string, isLast: boolean, depth: number): void => {
    if (maxDepth !== undefined && depth > maxDepth) return;

    const glyphs = getGlyphs();
    const connector = isLast ? glyphs.treeLast : glyphs.treeBranch;
    const childPrefix = isLast ? '    ' : glyphs.treePipe;

    if (node.name) {
      let line = prefix + connector + node.name;
      if (node.file && includeMetadata) {
        line += chalk.dim(` (${node.file.language}, ${node.file.nodeCount} symbols)`);
      }
      console.log(line);
    }

    const children = [...node.children.values()];
    children.sort((a, b) => {
      const aIsDir = a.children.size > 0 && !a.file;
      const bIsDir = b.children.size > 0 && !b.file;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const nextPrefix = node.name ? prefix + childPrefix : prefix;
      renderNode(child, nextPrefix, i === children.length - 1, depth + 1);
    }
  };

  renderNode(root, '', true, 0);
}

/**
 * afyx-graph daemon — interactive manager for the background daemons. Arrow keys
 * to pick one (the current project's daemon floats to the top, auto-selected),
 * enter to stop it. Falls back to a plain list when output isn't a TTY.
 */
program
   .route(cliCommand('daemon'))
   .alternativeNames([...cliAliases('daemon')])
   .summary(`Manage running ${PRODUCT_NAME} background daemons — pick one and press enter to stop it`)
   .handle(async () => {
    const { listVerifiedDaemons, stopDaemonAt, stopAllDaemons } = await import('../mcp/daemon-registry');
    const { runDaemonPicker } = await import('../mcp/daemon-manager');

    // The per-project lock is authoritative. Include the current root even
    // when its best-effort global discovery record is missing or stale.
    let cwdRoot: string | null = null;
    const found = findNearestAfyxGraphRoot(process.cwd());
    if (found) { try { cwdRoot = fs.realpathSync(found); } catch { cwdRoot = found; } }
    const currentRoots = cwdRoot ? [cwdRoot] : [];
    const daemons = await listVerifiedDaemons({ roots: currentRoots });
    if (daemons.length === 0) {
      info('No verified Afyx Graph daemons are available. Any live candidates that could not be verified were left running with ownership artifacts intact.');
      return;
    }

    // No TTY (piped / CI / non-interactive) — can't do arrow-key selection, so
    // just print what's running instead of crashing on a prompt with no input.
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      for (const d of daemons) {
        console.log(`pid ${d.pid}  v${d.version}  up ${formatDuration(Date.now() - d.startedAt)}  ${d.root}`);
      }
      return;
    }

    const clack = afyxTerminal;
    clack.intro(`${PRODUCT_NAME} daemons`);
    await runDaemonPicker({
      list: () => listVerifiedDaemons({ roots: currentRoots }),
      stop: stopDaemonAt,
      stopAll: stopAllDaemons,
      cwdRoot,
      now: () => Date.now(),
      select: (opts) => clack.select(opts),
      isCancel: (v) => clack.isCancel(v),
      note: (m) => clack.log.success(m),
      done: (m) => clack.outro(m),
    });
  });

/**
 * Print the "no index here" guidance.
 *
 * The viewer READS an index; it never builds one — indexing stays the user's
 * decision, exactly as it is for the MCP tools. So a missing index is normal
 * input, not a failure to apologize for: say what is missing, say the one
 * command that fixes it, and never print a stack trace.
 */
function printNoIndexGuidance(projectPath: string): void {
  error(`No Afyx Graph index found for ${projectPath}`);
  console.error('');
  // getGlyphs() (not a literal em dash): a legacy Windows console decodes raw
  // UTF-8 with its OEM codepage and renders one as mojibake (#168).
  console.error(`  The viewer reads an index that already exists ${getGlyphs().dash} it never creates one.`);
  console.error('  To index this project:');
  console.error('');
  console.error(`    ${chalk.cyan(`${CLI_NAME} init`)}`);
  console.error('');
  console.error('  Already indexed somewhere else? Point the viewer at it:');
  console.error('');
  console.error(`    ${chalk.cyan(`${CLI_NAME} ui /path/to/indexed/project`)}`);
  console.error('');
}

/**
 * afyx-graph ui [path]  (alias: web)
 *
 * The browser reader: serves the built viewer (`dist/viewer/`) over loopback
 * and opens it. It opens the index for reading and never writes to it, never
 * indexes, and never changes a line of the project's code. The single thing it
 * writes is a trail the reader saved, as JSON under `.afyx-graph/ui/trails/`;
 * `--read-only` turns even that off.
 */
program
   .route(cliCommand('ui', '[path]'))
   .alternativeNames([...cliAliases('ui')])
   .summary(`Open the ${PRODUCT_NAME} viewer in your browser — read your indexed project as a graph`)
   .flag('--port <number>', `Port to listen on (default: ${DEFAULT_UI_PORT}, or the next free one)`)
   .flag('--no-open', 'Print the URL instead of opening a browser')
   .flag('--read-only', 'Refuse every write — saved trails can be opened but not saved or deleted')
   .helpText(
    'after',
    `
Examples:
  $ ${CLI_NAME} ui                    Read the project you're standing in
  $ ${CLI_NAME} ui ~/code/my-app      Read a specific indexed project
  $ ${CLI_NAME} ui --port 8080        Use one specific port (fails if it's taken)
  $ ${CLI_NAME} ui --no-open          Just print the URL (headless boxes, SSH)
  $ ${CLI_NAME} web                   Same command under its alias

Pick a symbol and you see who calls it on the left, its source in the middle,
and what it calls on the right at the height of the line that calls it. Search
with / (or Cmd-K), click a file path for the file's outline and its imports.

Ask "how does execute reach getFile" (or "execute -> getFile") in the search
box for the flow between two symbols: one card per hop, opened at the line that
makes the next call, with dynamic-dispatch hops drawn dashed and named. The Map
tab draws the whole project by module, with dependencies pointing down.

Never opened this codebase before? The Entry points tab lists the routes with
the symbols that serve them, the files that run something when they load, the
tests, and what the most code depends on — and starts a flow from any of them.

The page keeps up with the project while it is open: save a file and it says so
within about a third of a second, and whatever is on screen re-reads the graph
when something re-indexes it. It watches for that; it never polls.

Save a walk you want to keep: name the trail and it is written to
.afyx-graph/ui/trails/ (already gitignored) as plain JSON, listed on the empty
screen, and reopened at the symbol you left. Hops are remembered by name rather
than by position, so a saved trail survives re-indexing and says which hop moved
when one does. Pass --read-only to refuse every write.

The viewer listens on 127.0.0.1 only, so nothing on your network can reach it.
It opens an index that already exists, never indexes, and never changes a line
of your code — the one thing it writes is a trail you asked it to save.
Requests from any other host are refused, and nothing is sent anywhere: no code,
no paths, no analytics.

Without --port it takes ${DEFAULT_UI_PORT}, or the next free port if that one is busy.

Set ${BROWSER_ENV}=<command> to choose which browser opens, or
${BROWSER_ENV}=none to never open one.
`
  )
   .handle(async (pathArg: string | undefined, options: { port?: string; open?: boolean; readOnly?: boolean }) => {
    // An explicit --port stays explicit: a scripted `--port 8080` that quietly
    // lands on 8081 is worse than one that says the port is busy. The default
    // port is the only one we're free to walk away from.
    let requestedPort: number | undefined;
    if (options.port !== undefined) {
      requestedPort = Number(options.port);
      if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
        error(`--port must be a whole number between 0 and 65535 (got "${options.port}").`);
        process.exit(1);
      }
    }

    const projectPath = resolveProjectPath(pathArg);

    // Sensitive-directory refusal before anything opens: the same guard the MCP
    // entry points use, so `afyx-graph ui /etc` is turned away here rather than
    // becoming a browsable view of the system.
    const { validateProjectPath } = await import('../utils');
    const rootError = validateProjectPath(projectPath);
    if (rootError) {
      error(rootError);
      process.exit(1);
    }

    if (!isInitialized(projectPath)) {
      printNoIndexGuidance(projectPath);
      process.exit(1);
    }

    const { startUiServer, openBrowser, createGraphApi, ViewerMissingError } = await import(
      '../ui-server'
    );

    // The JSON API the viewer reads its screens from. It opens the index lazily
    // on the first request, so a slow first paint is the only cost of mounting
    // it here rather than after the browser connects.
    const readOnly = options.readOnly === true;
    const api = createGraphApi({
      projectRoot: projectPath,
      readOnly,
      readOnlyReason: readOnly
        ? 'This viewer was started with --read-only, so trails cannot be saved.'
        : undefined,
    });

    let handle: UiServerHandle;
    try {
      handle = await startUiServer({
        projectRoot: projectPath,
        port: requestedPort,
        portFallback: requestedPort === undefined,
        api: api.handler,
      });
    } catch (err) {
      api.close();
      // Both failure modes here (viewer assets missing, no port available) carry
      // their own remediation — print it plainly, never a stack trace.
      error(err instanceof ViewerMissingError || err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    console.log('');
    console.log(chalk.bold(`${PRODUCT_NAME} viewer`));
    console.log('');
    console.log(`  ${chalk.dim('Reading')}  ${projectPath}`);
    console.log(`  ${chalk.dim('URL')}      ${chalk.cyan(handle.url)}`);
    console.log(
      `  ${chalk.dim('Access')}   this machine only ${getGlyphs().dash} ` +
        (readOnly
          ? 'read-only, nothing leaves your computer'
          : 'nothing leaves your computer; saved trails are the only thing written')
    );
    console.log('');

    const opened = options.open === false ? false : openBrowser(handle.url);
    console.log(
      opened
        ? chalk.dim('  Opening your browser... press Ctrl+C to stop.')
        : chalk.dim('  Open that URL in a browser. Press Ctrl+C to stop.')
    );
    console.log('');

    // The http server keeps the event loop alive on its own; these just make
    // Ctrl-C hang up live sockets instead of waiting on browser keep-alives.
    const shutdown = (): void => {
      // Release the SQLite handle before the socket: the process should never
      // exit with a live connection to the user's index.
      api.close();
      void handle.close().then(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });

/**
 * afyx-graph serve
 */
program
  // Hidden from `--help`: this is the stdio entry point an AI agent launches
  // for itself (the installer wires `args: ['serve','--mcp']` into every
  // agent's MCP config), not a command a human runs. It still works when
  // invoked — hiding only removes it from the listing. See the interactive-TTY
  // guard below, which explains this to anyone who runs it by hand.
   .route(cliCommand('serve'), cliCommandOptions('serve'))
   .summary(`Start ${PRODUCT_NAME} as an MCP server for AI assistants`)
   .flag('-p, --path <path>', 'Project path (optional for MCP mode, uses rootUri from client)')
   .flag('--mcp', 'Run as MCP server (stdio transport)')
   .flag('--no-watch', 'Disable the file watcher (no auto-sync; useful on slow filesystems like WSL2 /mnt drives)')
   .handle(async (options: { path?: string; mcp?: boolean; watch?: boolean }) => {
    const projectPath = options.path ? resolveProjectPath(options.path) : undefined;

    // Afyx CLI sets watch=false when --no-watch is passed. Route it through
    // the same env-var chokepoint the watcher and MCP server already honor.
    if (options.watch === false) {
      process.env.AFYX_GRAPH_NO_WATCH = '1';
    }

    try {
      if (options.mcp) {
        // `serve --mcp` is the stdio MCP server an AI agent launches for itself,
        // not a command to run by hand. A human in a terminal would otherwise
        // see it hang waiting for JSON-RPC on stdin, which reads as broken. If
        // stdin is an interactive TTY, explain instead of hanging. The agent's
        // pipe and the detached daemon both have a non-TTY stdin, so this only
        // ever fires for a person who typed it.
        if (process.stdin.isTTY && !process.env.AFYX_GRAPH_DAEMON_INTERNAL) {
          console.error(chalk.bold(`\n${PRODUCT_NAME} MCP server\n`));
          console.error("This is the MCP server your AI agent (Claude Code, Cursor, Codex, opencode, …)");
          console.error("starts automatically — you don't run it yourself.");
          console.error(`\nIt's already wired up by ${chalk.cyan('afyx-graph install')}. To check on things:`);
          console.error(`  ${chalk.cyan(`${CLI_NAME} status`)}   ${chalk.dim('— is this project indexed and healthy?')}`);
          console.error(`  ${chalk.cyan('afyx-graph daemon')}   ${chalk.dim('— list or stop background MCP servers')}`);
          console.error(chalk.dim('\n(Running it directly only does something when an MCP client drives it over stdin.)'));
          return;
        }
        // Start MCP server - it handles initialization lazily based on rootUri from client
        const { MCPServer } = await import('../mcp/index');
        const server = new MCPServer(projectPath);
        await server.start();
        // Server will run until terminated
      } else {
        // Default: show info about MCP mode.
        // Use stderr so stdout stays clean for any piped/stdio usage.
        console.error(chalk.bold(`\n${PRODUCT_NAME} MCP Server\n`));
        console.error(chalk.blue(getGlyphs().info) + ' Use --mcp flag to start the MCP server');
        console.error('\nTo use with Claude Code, add to your MCP configuration:');
        console.error(chalk.dim(`
{
  "mcpServers": {
    "afyx-graph": {
      "command": "afyx-graph",
      "args": ["serve", "--mcp"]
    }
  }
}
`));
        console.error('Available tools:');
        console.error(chalk.cyan('  afyx_graph_explore') + '   - Primary: source of the relevant symbols for any question');
        console.error(chalk.cyan('  afyx_graph_inventory') + ' - Exact structural declaration inventory');
        console.error(chalk.cyan('  afyx_graph_search') + '    - Search for code symbols');
        console.error(chalk.cyan('  afyx_graph_callers') + '   - Find callers of a symbol');
        console.error(chalk.cyan('  afyx_graph_callees') + '   - Find what a symbol calls');
        console.error(chalk.cyan('  afyx_graph_impact') + '    - Analyze impact of changes');
        console.error(chalk.cyan('  afyx_graph_node') + '      - Get symbol details');
        console.error(chalk.cyan('  afyx_graph_files') + '     - Get project file structure');
        console.error(chalk.cyan('  afyx_graph_status') + '    - Get index status');
      }
    } catch (err) {
      error(`Failed to start server: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph unlock [path]
 */
program
   .route(cliCommand('unlock', '[path]'))
   .summary('Remove a stale lock file that is blocking indexing')
   .handle(async (pathArg: string | undefined) => {
    const projectPath = resolveProjectPath(pathArg);

    try {
      if (!isInitialized(projectPath)) {
        error(`Afyx Graph not initialized in ${projectPath}`);
        return;
      }

      const lockPath = path.join(getAfyxGraphDir(projectPath), 'afyx-graph.lock');
      let removed = false;
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        removed = true;
      }
      const { clearStaleDaemonArtifacts } = await import('../mcp/daemon-registry');
      removed = await clearStaleDaemonArtifacts(projectPath) || removed;
      if (removed) success('Removed stale lock artifacts. You can now run indexing again.');
      else info(`No stale lock files found ${getGlyphs().dash} nothing to do`);
    } catch (err) {
      error(`Failed to remove lock: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * CLI parity with MCP callers/callees: resolve once, then collect and limit
 * within each definition. The legacy JSON list remains an explicitly labeled
 * union, with its original total/limit/truncated contract (#1674).
 */
for (const direction of ['callers', 'callees'] as const) {
  const title = direction === 'callers' ? 'Callers' : 'Callees';
  program
     .route(cliCommand(direction, '<symbol>'))
     .summary(direction === 'callers'
      ? 'Find all functions/methods that call a specific symbol'
      : 'Find all functions/methods called by a specific symbol')
     .flag('-p, --path <path>', 'Project path')
     .flag('-f, --file <path>', 'Narrow definitions by file path or suffix (no match: show all with a note)')
     .flag('-l, --limit <number>', 'Maximum results per definition (also caps the JSON union)', '20')
     .flag('-j, --json', 'Output as JSON')
     .handle(async (symbol: string, options: { path?: string; file?: string; limit?: string; json?: boolean }) => {
      const projectPath = resolveProjectPath(options.path);

      try {
        if (!isInitialized(projectPath)) {
          error(`Afyx Graph not initialized in ${projectPath}`);
          process.exit(1);
        }

        const { default: AfyxGraph } = await loadAfyxGraph();
        const cg = await AfyxGraph.open(projectPath);
        try {
          const limit = parseInt(options.limit || '20', 10);
          const { nodes: targets } = lookupSymbolNodes(cg, symbol);
          if (targets.length === 0) {
            info(formatSymbolNotFound(symbol, cg.searchNodes(symbol, { limit: 5 }).map((m) => m.node.name)));
            return;
          }

          const { groups, filteredOut } = groupDefinitions(targets, options.file);
          const ambiguous = groups.length > 1;
          const note = filteredOut
            ? `no definition of "${symbol}" matches file "${options.file}" — showing all definitions instead.`
            : undefined;
          const collected = groups.map((group) => {
            const nodes = new Map<string, Node>();
            const edges = new Map<string, Edge>();
            for (const target of group) {
              const connections = direction === 'callers' ? cg.getCallers(target.id) : cg.getCallees(target.id);
              for (const { node, edge } of connections) {
                nodes.set(node.id, node);
                edges.set(`${edge.source}->${edge.target}:${edge.kind}`, edge);
              }
            }
            return { group, nodes: [...nodes.values()], edges: [...edges.values()] };
          });

          if (options.json) {
            const definitions = collected.map(({ group, nodes, edges }) => {
              const limited = nodes.slice(0, limit);
              const shown = new Set(limited.map((node) => node.id));
              return {
                ...cliDefinition(group),
                [direction]: limited.map((node) => ({ id: node.id, ...cliNode(node) })),
                edges: edges.filter((edge) => shown.has(direction === 'callers' ? edge.source : edge.target)),
                total: nodes.length,
                limit,
                truncated: nodes.length > limit,
              };
            });
            const union = new Map<string, Node>();
            for (const { nodes } of collected) {
              for (const node of nodes) union.set(node.id, node);
            }
            const total = union.size;
            console.log(JSON.stringify({
              symbol,
              targets: groups.flat().map((node) => cliDefinition([node]).definition),
              ambiguous,
              aggregation: ambiguous ? 'union' : 'definition',
              file: options.file,
              filteredOut,
              note,
              definitions,
              [direction]: [...union.values()].slice(0, limit).map(cliNode),
              total,
              limit,
              truncated: total > limit,
            }, null, 2));
          } else {
            if (note) warn(note);
            if (ambiguous) {
              console.log(chalk.bold(`\n${title} of "${symbol}" — ${groups.length} distinct definitions (narrow with --file):`));
            }
            for (const { group, nodes } of collected) {
              const limited = nodes.slice(0, limit);
              const total = nodes.length;
              const truncated = total > limit;
              const count = truncated ? `${limited.length} of ${total}` : String(total);
              if (ambiguous) {
                console.log(chalk.bold(`\n${describeSymbolNode(group[0]!)} (${count}):\n`));
              } else {
                console.log(chalk.bold(`\n${title} of "${symbol}" (${count}):\n`));
                console.log(chalk.dim(describeSymbolNode(group[0]!)));
              }
              if (total === 0) {
                if (ambiguous) console.log(chalk.dim(`  (no ${direction})`));
                else info(`No ${direction} found for "${symbol}"`);
              }
              for (const node of limited) {
                const loc = node.startLine ? `:${node.startLine}` : '';
                console.log(chalk.cyan(node.kind.padEnd(12)) + chalk.white(node.name));
                console.log(chalk.dim(`  ${node.filePath}${loc}`));
                console.log();
              }
              if (truncated) console.log(chalk.dim(`Showing ${limited.length} of ${total}; pass --limit to widen.`));
            }
          }
        } finally {
          cg.destroy();
        }
      } catch (err) {
        error(`${direction} failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

/**
 * afyx-graph impact <symbol> — one blast radius per distinct definition.
 */
program
   .route(cliCommand('impact', '<symbol>'))
   .summary('Analyze what code is affected by changing a symbol')
   .flag('-p, --path <path>', 'Project path')
   .flag('-f, --file <path>', 'Narrow definitions by file path or suffix (no match: show all with a note)')
   .flag('-d, --depth <number>', 'Traversal depth', '2')
   .flag('-j, --json', 'Output as JSON')
   .handle(async (symbol: string, options: { path?: string; file?: string; depth?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`Afyx Graph not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = await AfyxGraph.open(projectPath);
      try {
        const depth = Math.min(Math.max(parseInt(options.depth || '2', 10), 1), 10);
        const { nodes: targets } = lookupSymbolNodes(cg, symbol);
        if (targets.length === 0) {
          info(formatSymbolNotFound(symbol, cg.searchNodes(symbol, { limit: 5 }).map((m) => m.node.name)));
          return;
        }

        const { groups, filteredOut } = groupDefinitions(targets, options.file);
        const ambiguous = groups.length > 1;
        const note = filteredOut
          ? `no definition of "${symbol}" matches file "${options.file}" — showing all definitions instead.`
          : undefined;
        const collected = groups.map((group) => {
          const merged = mergeSymbolImpact(cg, group, depth, 'last-seen');
          const edges = new Map<string, Edge>();
          for (const edge of merged.edges) edges.set(`${edge.source}->${edge.target}:${edge.kind}`, edge);
          return { group, nodes: merged.nodes, edges };
        });

        if (options.json) {
          const unionNodes = new Map<string, Node>();
          const unionEdges = new Map<string, Edge>();
          const definitions = collected.map(({ group, nodes, edges }) => {
            for (const [id, node] of nodes) unionNodes.set(id, node);
            for (const [key, edge] of edges) unionEdges.set(key, edge);
            return {
              ...cliDefinition(group),
              nodeCount: nodes.size,
              edgeCount: edges.size,
              affected: [...nodes.values()].map((node) => ({ id: node.id, ...cliNode(node) })),
              edges: [...edges.values()],
            };
          });
          console.log(JSON.stringify({
            symbol,
            depth,
            targets: groups.flat().map((node) => cliDefinition([node]).definition),
            ambiguous,
            aggregation: ambiguous ? 'union' : 'definition',
            file: options.file,
            filteredOut,
            note,
            definitions,
            nodeCount: unionNodes.size,
            edgeCount: unionEdges.size,
            affected: [...unionNodes.values()].map(cliNode),
          }, null, 2));
        } else {
          if (note) warn(note);
          if (ambiguous) {
            console.log(chalk.bold(`\nImpact of changing "${symbol}" — ${groups.length} distinct definitions (each with its own blast radius; narrow with --file):`));
          }
          for (const { group, nodes } of collected) {
            if (ambiguous) {
              console.log(chalk.bold(`\n${describeSymbolNode(group[0]!)} — ${nodes.size} affected symbols:\n`));
            } else {
              console.log(chalk.bold(`\nImpact of changing "${symbol}" — ${nodes.size} affected symbols:\n`));
              console.log(chalk.dim(describeSymbolNode(group[0]!)));
            }
            const byFile = new Map<string, Node[]>();
            for (const node of nodes.values()) {
              const list = byFile.get(node.filePath) || [];
              list.push(node);
              byFile.set(node.filePath, list);
            }
            for (const [file, affected] of byFile) {
              console.log(chalk.cyan(file));
              for (const node of affected) {
                const loc = node.startLine ? `:${node.startLine}` : '';
                console.log(`  ${chalk.dim(node.kind.padEnd(12))}${node.name}${chalk.dim(loc)}`);
              }
              console.log();
            }
          }
        }
      } finally {
        cg.destroy();
      }
    } catch (err) {
      error(`impact failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph affected [files...]
 *
 * Find test files affected by the given source files.
 * Traces dependency edges transitively to find test files that depend on changed code.
 *
 * Usage:
 *   git diff --name-only | afyx-graph affected --stdin
 *   afyx-graph affected src/lib/components/Editor.svelte src/routes/+page.svelte
 */
program
   .route(cliCommand('affected', '[files...]'))
   .summary('Find test files affected by changed source files')
   .flag('-p, --path <path>', 'Project path')
   .flag('--stdin', 'Read file list from stdin (one per line)')
   .flag('-d, --depth <number>', 'Max dependency traversal depth', '5')
   .flag('-f, --filter <glob>', 'Custom glob filter for test files (e.g. "e2e/*.spec.ts")')
   .flag('-j, --json', 'Output as JSON')
    .flag('--explain', 'Explain an empty result using index coverage and freshness evidence')
   .flag('-q, --quiet', 'Only output file paths, no decoration')
    .handle(async (fileArgs: string[], options: { path?: string; stdin?: boolean; depth?: string; filter?: string; json?: boolean; explain?: boolean; quiet?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`Afyx Graph not initialized in ${projectPath}`);
        process.exit(1);
      }

      // Collect changed files from args or stdin
      let changedFiles: string[] = [...(fileArgs || [])];

      if (options.stdin) {
        const stdinData = fs.readFileSync(0, 'utf-8');
        const stdinFiles = stdinData.split('\n').map(f => f.trim()).filter(Boolean);
        changedFiles.push(...stdinFiles);
      }

      // Normalize inputs to the project-relative, forward-slash form the index
      // stores. Without this, `affected ./src/x.ts`, an absolute path (what a
      // wrapping script often passes), or a Windows back-slash path silently
      // matches nothing and reports 0 affected tests. (#825)
      changedFiles = changedFiles
        .map((f) => normalizeIndexPath(f, projectPath))
        .filter(Boolean);

      if (changedFiles.length === 0) {
        if (!options.quiet) info('No files provided. Use file arguments or --stdin.');
        process.exit(0);
      }

      const { default: AfyxGraph } = await loadAfyxGraph();
      const cg = await AfyxGraph.open(projectPath);
      const maxDepth = parseInt(options.depth || '5', 10);

      // Custom filter pattern
      let customFilter: RegExp | undefined;
      if (options.filter) {
        // Convert glob to regex: ** → .+, * → [^/]*, . → \.
        const regex = options.filter
          .replace(/[+[\]{}()^$|\\]/g, '\\$&')
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.+')
          .replace(/\*/g, '[^/]*');
        customFilter = new RegExp(regex);
      }

      // One notion of "a test" for the whole tool (#1507): the CLI used to keep
      // its own six regexes here, which knew `.test.` and `/tests/` but not Go's
      // `_test.go`, Python's `test_x.py` or the JVM's `FooTest.kt` — so
      // `affected` reported "no tests" for whole ecosystems while `search` and
      // the MCP tools counted those very files as tests. Shared with `search`/MCP via
      // `isTestPath`, unless `--filter` replaces it entirely.
      const affectedResult = computeAffectedTests(cg, changedFiles, {
        maxDepth,
        customFilter,
      });
      const { affectedTests: sortedTests, totalDependentsTraversed } = affectedResult;
      const odooImpact = computeOdooImpact(cg, changedFiles, { maxDepth });
      const combinedTests = Array.from(
        new Set([...sortedTests, ...(odooImpact.isOdooProject ? odooImpact.affectedTests : [])])
      ).sort();

      let affectedTestsAnalysis: ReturnType<typeof analyzeAffectedTests> | undefined;
      if (options.explain) {
        const diskChanges = cg.getChangedFiles();
        const diskChangeCounts = {
          added: diskChanges.added.length,
          modified: diskChanges.modified.length,
          removed: diskChanges.removed.length,
        };
        const { getFreshness } = await import('../freshness');
        affectedTestsAnalysis = analyzeAffectedTests(
          affectedResult,
          changedFiles,
          cg.getFiles(),
          buildIndexHealth(cg, projectPath, { diskChanges: diskChangeCounts, freshness: getFreshness(projectPath) }),
          customFilter,
        );
      }

      // Output
      if (options.json) {
        console.log(JSON.stringify({
          changedFiles,
          affectedTests: combinedTests,
          totalDependentsTraversed,
          ...(affectedTestsAnalysis ? { affectedTestsAnalysis } : {}),
          ...(odooImpact.isOdooProject ? { odooImpact } : {}),
        }, null, 2));
      } else if (options.quiet) {
        for (const t of combinedTests) console.log(t);
      } else {
        if (combinedTests.length === 0) {
          if (!affectedTestsAnalysis) {
            info('No test files affected by the changed files.');
          } else if (affectedTestsAnalysis.emptyReason === 'NO_INDEXED_TESTS') {
            info('No test files are indexed; affected tests cannot be identified until tests are indexed.');
          } else if (affectedTestsAnalysis.emptyReason === 'NO_REACHABLE_INDEXED_TESTS') {
            info('Indexed tests exist, but none are reachable from the changed files in the current graph. This is not proof that no tests are affected.');
          } else {
            info(`Affected tests are indeterminate because graph evidence is insufficient (${affectedTestsAnalysis.limitations.join(', ')}).`);
          }
        } else {
          console.log(chalk.bold(`\nAffected test files (${combinedTests.length}):\n`));
          for (const t of combinedTests) {
            console.log('  ' + chalk.cyan(t));
          }
          console.log();
        }

        if (odooImpact.isOdooProject) {
          if (odooImpact.affectedModels.length > 0) {
            console.log(chalk.bold(`Affected Odoo Models (${odooImpact.affectedModels.length}):`));
            for (const m of odooImpact.affectedModels) {
              const relLabel = m.relationship.replace(/_/g, ' ');
              console.log(`  ${chalk.cyan(m.name.padEnd(28))} ${chalk.dim(`[${relLabel}]`)} ${chalk.dim(`(${m.direction}, hop: ${m.hopCount})`)}`);
            }
            console.log();
          }

          if (odooImpact.affectedSecurityAssets.length > 0) {
            console.log(chalk.bold(`Affected Odoo Security Assets (${odooImpact.affectedSecurityAssets.length}):`));
            for (const s of odooImpact.affectedSecurityAssets) {
              console.log(`  ${chalk.yellow(s.ruleId.padEnd(32))} ${chalk.dim(s.semantics)} ${chalk.dim(`(${s.direction})`)}`);
            }
            console.log();
          }

          if (odooImpact.affectedModules.length > 0) {
            console.log(chalk.bold(`Affected Odoo Modules (${odooImpact.affectedModules.length}):`));
            for (const mod of odooImpact.affectedModules) {
              console.log(`  ${chalk.cyan(mod.moduleName.padEnd(28))} ${chalk.dim(`[${mod.reason.replace(/_/g, ' ')}]`)} ${chalk.dim(`(${mod.direction}, hop: ${mod.hopCount})`)}`);
            }
            console.log();
          }

          if (odooImpact.disclaimer) {
            console.log(chalk.dim(`Note: ${odooImpact.disclaimer}\n`));
          }
        }
      }

      cg.destroy();
    } catch (err) {
      error(`Affected analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * afyx-graph install
 */
program
   .route(cliCommand('install'))
   .summary('Install afyx-graph MCP server into one or more agents (Claude Code, Cursor, Codex CLI, opencode, Hermes Agent, Gemini CLI, Antigravity IDE, Kiro, GitHub Copilot)')
   .flag('-t, --target <ids>', 'Target agent(s): comma-separated ids, or "auto"|"all"|"none". Default: prompt')
   .flag('-l, --location <where>', 'Install location: "global" or "local". Default: prompt')
   .flag('-y, --yes', 'Non-interactive: defaults to --location=global --target=auto, auto-allow on')
   .flag('--dry-run', 'Inspect and print the provider plan without changing configuration')
   .flag('-i, --init', `After wiring agents, also run \`${CLI_NAME} init\` in the current directory — builds this project’s index, so install + index is one command (combine with --yes for an unattended bootstrap)`)
   .flag('--no-permissions', 'Skip writing the auto-allow permissions list (Claude Code only)')
   .flag('--print-config <id>', 'Print MCP config snippet for the named agent and exit (no file writes)')
   .flag('--refresh', 'Rewrite what previous installs configured, for already-configured agents only (never adds new ones). Run automatically by `afyx-graph upgrade`')
   .handle(async (opts: {
    target?: string;
    location?: string;
    yes?: boolean;
    init?: boolean;
    permissions?: boolean;
    printConfig?: string;
    refresh?: boolean;
    dryRun?: boolean;
  }) => {
    if (opts.dryRun && opts.refresh) {
      error('--dry-run cannot be combined with --refresh; refresh applies existing configuration.');
      process.exitCode = 1;
      return;
    }
    if (opts.printConfig) {
      const { getTarget, listTargetIds } = await import('../installer/targets/registry');
      const target = getTarget(opts.printConfig);
      if (!target) {
        const known = listTargetIds().join(', ');
        error(`Unknown target "${opts.printConfig}". Known: ${known}.`);
        process.exit(1);
      }
      const loc = (opts.location === 'local' ? 'local' : 'global') as 'global' | 'local';
      process.stdout.write(target.printConfig(loc));
      return;
    }

    // --refresh: non-interactive sweep that re-writes what previous
    // installs configured (instructions section, MCP entry, legacy-hook
    // cleanups) for already-configured agents, so those surfaces match
    // THIS binary's templates. Skips everything else — never a first
    // install, never touches permissions or the prompt hook. Sweeps both
    // locations unless --location narrows it.
    if (opts.refresh) {
      const { refreshTargets } = await import('../installer');
      const { ALL_TARGETS } = await import('../installer/targets/registry');
      if (opts.location && opts.location !== 'global' && opts.location !== 'local') {
        error(`--location must be "global" or "local" (got "${opts.location}").`);
        process.exit(1);
      }
      const locs: Array<'global' | 'local'> = opts.location
        ? [opts.location as 'global' | 'local']
        : ['global', 'local'];
      let changed = 0;
      for (const loc of locs) {
        for (const report of refreshTargets(ALL_TARGETS, loc)) {
          for (const p of report.changedPaths) {
            changed += 1;
            console.log(`  ${report.displayName}: refreshed ${p}`);
          }
        }
      }
      if (changed === 0) {
        console.log('All configured agent surfaces are already current.');
      }
      return;
    }

    const { runInstallerWithOptions } = await import('../installer');
    if (opts.location && opts.location !== 'global' && opts.location !== 'local') {
      error(`--location must be "global" or "local" (got "${opts.location}").`);
      process.exit(1);
    }
    try {
      // Afyx CLI's `--no-permissions` makes `opts.permissions === false`;
      // omitting the flag leaves it `true` (the positive-form default).
      // We MUST treat the default-true as "user did not override — let
      // the orchestrator prompt" and only forward an explicit `false`
      // (or `true` when --yes implies it). Otherwise the auto-allow
      // prompt is silently skipped on every interactive run.
      const explicitNoPermissions = opts.permissions === false;
      const autoAllow: boolean | undefined = explicitNoPermissions
        ? false
        : opts.yes
          ? true
          : undefined;

      await runInstallerWithOptions({
        target: opts.target,
        location: opts.location as 'global' | 'local' | undefined,
        autoAllow,
        yes: opts.yes,
        dryRun: opts.dryRun,
      });
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    // --init: the one-shot "wire agents AND build this project's index"
    // bootstrap (#1578). The installer itself never indexes implicitly (a
    // surprise index of $HOME is the thing we refuse) — an explicit flag is
    // the user choosing. Runs after a successful install, including the
    // `--target none` / nothing-detected case (the installer returns normally
    // there), and shares every guard with `afyx-graph init`: an unsafe root
    // is refused (exit 1, no implied --force), an already-initialized
    // project just says so. `--yes` flows through so no offer prompts.
    if (opts.init && !opts.dryRun) {
      await runInit(process.cwd(), { yes: opts.yes });
    }
  });

/**
 * afyx-graph uninstall
 *
 * Inverse of `install`. Removes the afyx-graph MCP server entry,
 * instructions block, and permissions from every agent (or a
 * `--target` subset). Prompts global-vs-local when not given. Does NOT
 * delete the `.afyx-graph/` index — that's `afyx-graph uninit`.
 */
program
   .route(cliCommand('uninstall'))
   .summary('Remove afyx-graph from your agents (Claude Code, Cursor, Codex CLI, opencode, Hermes Agent, Gemini CLI, Antigravity IDE, Kiro, GitHub Copilot)')
   .flag('-t, --target <ids>', 'Target agent(s): comma-separated ids, or "all". Default: all')
   .flag('-l, --location <where>', 'Uninstall location: "global" or "local". Default: prompt')
   .flag('-y, --yes', 'Non-interactive: defaults to --location=global --target=all')
   .handle(async (opts: {
    target?: string;
    location?: string;
    yes?: boolean;
  }) => {
    const { runUninstaller } = await import('../installer');
    if (opts.location && opts.location !== 'global' && opts.location !== 'local') {
      error(`--location must be "global" or "local" (got "${opts.location}").`);
      process.exit(1);
    }
    try {
      await runUninstaller({
        target: opts.target,
        location: opts.location as 'global' | 'local' | undefined,
        yes: opts.yes,
      });
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

/**
 * afyx-graph upgrade [version]
 *
 * Afyx Graph is installed and updated by the Afyx Codex Engineering Kit; this
 * command makes no network request and changes nothing. It reports the running
 * version and how to update it.
 */
program
   .route(cliCommand('upgrade', '[version]'))
   .summary(`Show how to update ${PRODUCT_NAME} (updates are managed by the Afyx Codex Engineering Kit)`)
   .flag('--check', 'Print the installed version and update instructions (no network access)')
   .flag('-f, --force', 'Accepted for compatibility; nothing is reinstalled by this command')
   .handle(() => {
    console.log(`${PRODUCT_NAME} ${packageJson.version}`);
    console.log('');
    console.log('Updates are managed by the Afyx Codex Engineering Kit. From your kit checkout, run:');
    console.log('  Windows:      .\\update.ps1');
    console.log('  Linux/macOS:  ./update.sh');
    console.log('');
    console.log('To re-wire agents after an update:  afyx-graph install --refresh');
  });

/**
 * afyx-graph version
 *
 * The bare-noun form of `--version`. Afyx CLI already provides `--version`
 * and `-V`, and the `-v` / `-version` spellings are intercepted before parse
 * (see top of main). This subcommand makes `afyx-graph version` work and lists
 * the version affordance in `afyx-graph --help`.
 */
program
   .route(cliCommand('version'))
   .summary(`Print the installed ${PRODUCT_NAME} version (also: -v, --version)`)
   .handle(() => {
    console.log(packageJson.version);
  });

// Parse and run
assertCliCatalog(program);
program.execute();

} // end main()
