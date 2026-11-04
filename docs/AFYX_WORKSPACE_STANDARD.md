# Afyx Workspace Development Standard

Status: canonical development workspace standard

Owner: Afyx engineering maintainers

Effective: 2026-11-04 (updated post-AFYX-311 consolidation & Graph separation)

## Purpose

This standard separates canonical source, workspace-level Afyx Graph state,
daily-use source, acceptance evidence, active worktrees, reusable testing
assets, benchmarks, and administrative recovery records. It does not make
historical evidence or an installed product equivalent to the current
development source.

## Canonical layout

```text
D:\Project\workspace\afyx-codex-engineering-kit\
├── .afyx-graph\                  # workspace-level native Afyx Graph state
├── afyx-graph.json               # root-anchored Afyx Graph exclusion contract
├── afyx-codex-engineering-kit\   # canonical dev repository; dev owner (.git)
├── afyx-daily-source\            # independent daily-use source checkout
├── afyx-alpha\                   # explicit external-location record (EXTERNAL_LOCATION.txt)
├── _afyx-admin\
│   ├── reports\
│   ├── manifests\
│   ├── backups\
│   └── Test-AfyxWorkspaceHygiene.ps1
├── progres\                      # active/unmerged linked development worktrees
├── testing\
│   ├── smoke\                    # smoke test fixtures and outputs
│   ├── regression\               # regression test fixtures and outputs
│   └── integration\              # integration acceptance runs and outputs
└── benchmark\
    ├── datasets\                 # immutable benchmark datasets
    ├── runs\                     # raw benchmark execution artifacts
    └── results\                  # sanitized benchmark reports and summaries
```

Additional directories require a concrete ownership or product need. Do not add
empty hierarchy speculatively.

## Ownership and identity

- `afyx-codex-engineering-kit` owns canonical development and the `dev` worktree.
- `.afyx-graph` at the outer workspace root owns the native Afyx Graph SQLite
  index for the canonical workspace. Never initialize a duplicate `.afyx-graph`
  inside the nested `afyx-codex-engineering-kit` checkout or inside `progres/*`.
- `afyx-graph.json` at the outer workspace root enforces root-anchored exclusions
  (`/afyx-daily-source/`, `/progres/`, `/_afyx-admin/`, `/testing/`, `/benchmark/`,
  `/afyx-alpha/`) so that only canonical source under `afyx-codex-engineering-kit/`
  is indexed without duplicating symbols.
- `afyx-daily-source` is an independent Git checkout. Its commit must be recorded;
  its location does not prove the version installed into any provider.
- `afyx-alpha` is immutable acceptance/RC evidence by default (`D:\Project\afyx-alpha`,
  referenced via `afyx-alpha\EXTERNAL_LOCATION.txt`). When historical path identity
  matters, preserve it externally and store an explicit locator; never silently
  rewrite historical manifests.
- `progres` contains linked worktrees with active, unique, unmerged, or review-bound work.
- `testing` contains retained reproducible fixtures and test outputs separated strictly
  into `testing\smoke\`, `testing\regression\`, and `testing\integration\`.
- `benchmark` separates immutable `benchmark\datasets\`, raw `benchmark\runs\`, and
  sanitized `benchmark\results\`.
- `_afyx-admin` contains migration manifests, receipts, recovery instructions,
  hygiene validators, archives, and backups. It is not product source.

## Mandatory workspace hygiene & artifact placement policies

1. **Development worktrees**: Every new development worktree must be created via
   `git -C D:\Project\workspace\afyx-codex-engineering-kit\afyx-codex-engineering-kit worktree add`
   inside `D:\Project\workspace\afyx-codex-engineering-kit\progres\<worktree-name>`.
2. **Smoke test outputs**: All retained smoke test fixtures, logs, and outputs must
   be placed under `D:\Project\workspace\afyx-codex-engineering-kit\testing\smoke\`.
3. **Regression test outputs**: All retained regression test fixtures and outputs must
   be placed under `D:\Project\workspace\afyx-codex-engineering-kit\testing\regression\`.
4. **Integration test outputs**: All retained integration and RC acceptance runs must
   be placed under `D:\Project\workspace\afyx-codex-engineering-kit\testing\integration\`.
5. **Benchmark artifacts**:
   - Datasets must go under `D:\Project\workspace\afyx-codex-engineering-kit\benchmark\datasets\`.
   - Raw execution runs must go under `D:\Project\workspace\afyx-codex-engineering-kit\benchmark\runs\`.
   - Sanitized reports and results must go under `D:\Project\workspace\afyx-codex-engineering-kit\benchmark\results\`.
6. **Temporary files**: Ephemeral build, test, or scratch files must use the OS
   temporary directory (`$env:TEMP` / `[System.IO.Path]::GetTempPath()`) and clean
   up in a `finally` block rather than writing to `D:\Project`, `D:\Project\workspace`,
   or the canonical workspace root.
7. **Project-independent repositories**: Separate products and unrelated repositories
   (such as `afyx-codepilot`, `afyx-wa-plus`, `kasir-barber`, `rancangin`) must remain
   outside `D:\Project\workspace\afyx-codex-engineering-kit`.
8. **No unregistered worktrees or uncontrolled directories**: Do not create
   unregistered Git clones, ad-hoc backup folders, or loose files at `D:\Project`
   or `D:\Project\workspace`. Only the 22 allowlisted historical `PRESERVE_IN_PLACE`
   worktrees and independent non-kit projects may reside at `D:\Project\workspace`.
9. **Artifact lifecycle, ownership, and retention**:
   - Every generated artifact directory under `testing\`, `benchmark\`, or
     `_afyx-admin\backups\` must have a clear owner/task identifier, timestamp,
     and provenance record (`manifest.json` or `SHA256SUMS`).
   - Obsolete or superseded artifacts must be moved to reversible quarantine under
     `_afyx-admin\backups\quarantine-<YYYYMMDD>\` with recorded source paths,
     checksums, and restore commands before requesting owner approval for
     permanent deletion.

## Worktree rules

1. Create linked worktrees through `git worktree add`; never copy a worktree.
2. Use `git worktree move` for relocation and `git worktree repair` after the main
   repository or common directory moves.
3. On Windows, inspect and re-target any internal NTFS junctions (`ReparsePoint`)
   immediately after relocating a worktree so `node_modules` workspace links do
   not become dangling.
4. One checked-out branch may have only one owning worktree.
5. Detached worktrees must retain an explicit evidence/testing classification.
6. Before moving anything, record path, owner, branch, HEAD, dirty/untracked/
   ignored state, unique commits versus `origin/dev`, and active process use.
7. Unique commits and ambiguous ignored data are preservation gates, not cleanup
   candidates.

## Cleanup gates

A worktree or artifact may be permanently removed only when all conditions are
independently verified:

- its code is integrated into the accepted `dev` baseline;
- required PR/CI/evidence remains available;
- tracked, untracked, and ignored content contains no unique data;
- no IDE, agent, watcher, MCP server, or process uses its path;
- it is not Alpha, benchmark, backup, recovery, or private evidence;
- for worktrees, `git worktree remove` succeeds without force and its branch can
  be removed with `git branch -d` without overriding Git safety;
- for non-worktree artifacts, the item has been inventoried in reversible
  quarantine and explicitly approved by the workspace owner.

Never use forced worktree removal, forced branch deletion, blind recursive
cleanup, history rewriting, or garbage collection as part of workspace cleanup.

## Automated hygiene verification

Run the zero-dependency workspace hygiene and path validator before and after
workspace maintenance:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Project\workspace\afyx-codex-engineering-kit\_afyx-admin\Test-AfyxWorkspaceHygiene.ps1" -RunSelfTests
```
