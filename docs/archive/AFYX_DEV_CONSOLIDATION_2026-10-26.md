# AFYX DEV consolidation checkpoint — 2026-10-26

Status: **DEV CONSOLIDATION MERGED / HISTORICAL ACCEPTANCE RECOVERY PREPARED**

This report records the bounded reconciliation of existing repository work into
`dev`. It does not authorize a merge, branch deletion, Alpha promotion, build,
tag, release, publication, provider activation, or Forge campaign.

## Verified pre-consolidation baseline and immutable evidence

| Ref or evidence | Verified identity | Disposition |
|---|---|---|
| `origin/dev` | `aabbea7ddd64603e4c9c577ea81bdf01b7f0c610`, tree `0ee87ab17cbfcdabd2234cfd264a28c5f3950238` | Integration base |
| `origin/alpha` | `3b8360c44bd148739a6048b309898a41558e2141`, tree `0ee87ab17cbfcdabd2234cfd264a28c5f3950238` | Protected promotion branch; no mutation |
| `origin/main` | `ce1e020a89095cc32130056440245e2ef101448f`, tree `acfc2698c830f1c5d0ce5b12ad2137a57b535509` | Release/workflow branch; no mutation |
| Signed Alpha | source `3b8360c44bd148739a6048b309898a41558e2141`; run `40279559615` attempt 1; builder `cd3ffa59066ce4be5e7752bd920c852e8605a6b4`; artifact `12631346917` | Available, unexpired; container digest `sha256:03369e82265d421ae9da6d7e67abd909bfc810ee5a8e3ae9792ad0e4e56ca05b` |

The pre-consolidation exact-head CI evidence is Repository CI `40262854653`
and Graph Build `40262854623`, both successful on Windows, Linux, and macOS.

## Source and PR reconciliation

GitHub contained 108 PRs: 104 merged, one open, and three closed without
merge. The only open PR is Draft PR #105 at
`af315090abe4ff962aa5c183ff433db1096785f1`, targeting `main`; CI run
`40286088141` passed on all three operating systems.

| Work | Classification | Evidence and action |
|---|---|---|
| Merged product branches through PR #101 and later `dev` corrections | `IN_DEV` | Their tips are ancestors of `dev`; current product/tests are newer. No replay. |
| PR #77 Alpha/Adit handoff | `SUPERSEDED` | Closed without merge. Its only new file is a dated scheduling addendum. Current roadmap and component documents retain the accurate Adit `DEFERRED/NOT_RUN`, Expert D.6, and Forge `0/36` limitations with later evidence. No verbatim recovery. |
| PR #78 Forge A4–A8 handoff | `SUPERSEDED` | Closed without merge. Its seven-gate handoff is represented by the newer public-controller, E1, readiness, and canonical roadmap records. Formal campaign remains `0/36 NOT_RUN`; no A8 GO. |
| PRs #103/#104/#108 Alpha build and attestation | `MISSING_FROM_DEV` | Reconciled at source level by making `.github/workflows/graph-alpha-build-attest.yml` byte-identical to `main` blob `2663f86a696706ffba75852937e292ae070e7f39`. It pins the accepted `3b8360c` source/tree while retaining the historical local-candidate ledger as a distinct identity. |
| PR #106 stable release safety | `IN_DEV` (safer implementation retained) | `dev` already has deterministic builds, checksums, release manifest, pinned actions, and attestations without tag or GitHub Release commands. The older-main build-only file would remove those safeguards, so it is not copied. |
| PR #105 guarded publication | `RELEASE_ONLY` | The single added workflow is a future manual publication boundary for `main`; it is not product source and is not copied to `dev`. `verify-only` remains the default and no publication was run. |
| Local-only `ce3fb3e755683f3c64e24b0f519d0f7267efde8a` | `SUPERSEDED / RELEASE_ONLY` | Unpushed reviewer-dependent PR #105 correction in its own clean worktree. The current remote PR uses the later solo-owner contract. Preserve; do not integrate or delete. |
| Historical T03/T04 and Alpha convergence tips | `CONTENT_EQUIVALENT` or `SUPERSEDED` | Functional content is present in newer `dev`; the `ba7448b` promotion delta has no content difference from its merge base. No historical merge replay. |

### Historical PR #77 acceptance record

This is a provenance-only record of the owner decision dated
**2026-10-19 (Asia/Jakarta)** in closed, unmerged PR #77 at
`d765603ce98577d190d904078cfa4c891cb26ccb`. It preserves the historical
acceptance boundary and does not automatically describe or constrain current
`dev`.

- The isolated internal Windows Graph candidate was
  `b704790327fa12dfe0e92a237324c23054a2b0fb`; the owner decision was
  `ACCEPTED WITH DECLARED LIMITATIONS`.
- Installed-daemon lifecycle was `NOT_RUN`, publisher authenticity was
  `UNVERIFIED`, and a P3 diagnostic wording mismatch was nonblocking.
- Odoo XML semantic relationships and access CSV were unsupported; freshness
  for non-Git Odoo17 input was `UNKNOWN`.
- Adit T05 was deferred by owner choice. That deferral was not a T05 PASS and
  did not authorize distribution to or testing by Adit.
- The historical full/cross-platform T12 contract required T05. Without an
  actual T05 PASS, it could not be marked DONE. A separately labelled internal
  Windows integration slice could proceed only within its narrower accepted
  boundary; this historical record is not approval to reinterpret current T12
  scope.

No private evaluator bundle, credentials, raw customer source, report staging,
or owner-local artifact is included in the candidate.

## Active engineering status

| Capability | Classification | Current boundary |
|---|---|---|
| AFYX-5 native independence | `IN_DEV` | Afyx-owned native extraction routes and regression suites are present. No obsolete implementation was recovered from a branch. |
| AFYX-283 Engineering Expert | `ACCEPTANCE_PENDING` | Candidate, routing, isolation harness, and bounded Odoo composition are present. Independent D.6 substantive verdict and formal A1/B1 remain external/not run. |
| AFYX-53/56 provider and control plane | `IN_DEV` with accepted limitations | Unified component lifecycle, provider integration, MCP integration, ownership protection, and tests are present. Host-agent authentication/quota and IDE UI limitations remain separate. |
| AFYX-8 Phase 8 dogfood | `IN_DEV` for completed bounded scope | Source, sanitized evidence, and affected-test semantics are present. This does not close unrelated Phase 8 or optional capability work. |
| AFYX-12/88/92/93 Forge public engineering | `PARTIALLY_IMPLEMENTED / DEFERRED` | Public manifest, controller, orchestrator, portability, readiness, and synthetic tests are present. Private evaluator freeze, privileged isolation, budgets, and formal B0–B5 campaign remain owner/evaluator work; `0/36 NOT_RUN`, no A8 GO. |
| ACE/Context | `IN_DEV`, optional | Standalone component and integration contract are present; optional/default-OFF positioning and accepted real-consumer limitations remain. |

No reproducible integration defect was uncovered beyond the missing current
Alpha workflow pin. No new feature implementation is justified by this
reconciliation. Live Jira access was unavailable, so this report is Jira-ready
evidence only and claims no transition.

## Repository state inventory

- Local stashes: none.
- Canonical worktree remains on `afyx/integrated-alpha-provider-onboarding` at
  `b03ad891f5a19e7420089ab1b3ae42b2aa20a65a`; its pre-existing modified
  `.gitignore`, `.afyx-report-staging/`, and `debug.log` were not changed.
- Twelve registered detached worktrees under the user Temp directory remain
  heavily dirty (997–1123 status entries each) at tips `98c8033`, `afd1562`,
  `8e4ceaa`, `2794d20`, `fb93fea` (two worktrees), `049fbcf`, `9f08c10`,
  `ca74d6e`, `ebe34a2`, `aa2e52a`, and `14445f7`. They are preservation risks,
  not cleanup candidates.
- Clean detached evidence worktrees are retained at `b704790`, `077abe1`,
  `3b270f2`, `594452d`, and `943727d`.
- Clean branch worktrees are retained for `c149a72`, local-only `ce3fb3e`,
  `b44a510`, `f890590`, `4f9415f`, `aabbea7`, `046a86f`, and `c2c0519`.
- The integration candidate was prepared in a separate disposable clone; no
  owner worktree, installed runtime, Graph index, or provider configuration was
  modified.

## Cleanup manifest (no deletion authorized)

`Eligible after approval` means only that recorded source/content preservation
is sufficient; this task performs no deletion. A branch attached to a worktree
is not eligible even if its content is merged.

| Branch/ref | Recorded tip | Disposition / preservation evidence | Deletion eligibility |
|---|---|---|---|
| `origin/dev` / local `dev` | `aabbea7ddd64603e4c9c577ea81bdf01b7f0c610` | Canonical development baseline; local worktree attached | Never in this cleanup |
| `origin/alpha` | `3b8360c44bd148739a6048b309898a41558e2141` | Protected Alpha source and signed-artifact identity | Never in this cleanup |
| local stale `alpha` | `760778e709ec99e85fded58d10a0efc0350abaa9` | Historical local branch name; remote Alpha differs | No; reconcile protected ref separately |
| `origin/main` | `ce1e020a89095cc32130056440245e2ef101448f` | Canonical release/workflow branch | Never in this cleanup |
| local stale `main` | `5349c4a184e539f0ac0752d895ff3262c6326e29` | Historical local branch name; remote main differs | No; reconcile protected ref separately |
| `origin/afyx/afyx-249-alpha-3b8360c-attestation-pin` | `8e306bc6de06cbaedb51b78a36c6a7f7601cd39a` | PR #108 merged into main; source-level delta reconciled here | Eligible after approval |
| `origin/afyx/afyx-249-attestation-download-layout-fix` | `5258a0b04a71f4eeadf7c02e2c4498ab015567c1` | PR #104 merged into main; included in final workflow blob | Eligible after approval |
| `origin` + local `afyx/afyx-249-alpha-safe-attestation` | `c149a72712db9a935f9c3d247a8aa44f3cf911e3` | PR #103 merged; clean worktree attached | No while worktree exists |
| `origin/afyx/afyx-249-guarded-technical-alpha-publication` | `af315090abe4ff962aa5c183ff433db1096785f1` | Active Draft PR #105 | No |
| local PR #105 branch | `ce3fb3e755683f3c64e24b0f519d0f7267efde8a` | Unpushed superseded commit; clean worktree attached | No |
| `origin/afyx/release-safety-stable-build-only` + local | `c2c051950d9544e6ffa5e27e520807ded880547c` | PR #106 merged; clean worktree attached | No while worktree exists |
| `origin/afyx/afyx-249-technical-alpha-promotion-3b270f2` | `ba7448bfbe608d0fdbc18903887bf080276cadb0` | Promotion content superseded by current Alpha/dev | Eligible after approval |
| local `afyx/alpha-main-convergence-prep` | `b44a51048fc5caf8723d501c10aa4a8b2f3ee818` | Historical preparation; clean worktree attached | No while worktree exists |
| `origin/afyx/afyx-300-external-component-retirement` | `feb5537fd18281d56a0366c3cf1b25a3eaceec4a` | Ancestor of dev | Eligible after approval |
| `origin` + local `afyx/afyx-64-phase8-dogfood-optimization` | `f89059094fa065392cfcaed4bef406294d1b7f42` | Ancestor of dev; clean evidence worktree attached | No while worktree exists |
| `origin` + local `afyx/afyx-73-reproducible-graph-artifacts` | `4f9415fb4a5735b96c4d12b7f53850fb00ff6a25` | Ancestor of dev; clean evidence worktree attached | No while worktree exists |
| `origin` + local `afyx/forge-a5-public-orchestrator` | `046a86f3bde6645925ace5d24a86718924a25a95` | Ancestor of dev; clean evidence worktree attached | No while worktree exists |
| `origin` + local `afyx/graph-affected-tests-empty-semantics` | `99466ca3fee73024e6e733d88bc476e90963b3c3` | Ancestor of dev; no worktree | Eligible after approval |
| `origin/afyx/multi-provider-secondary-root-repair` | `6de1652c431c495771d440a320267344c941972a` | Ancestor of dev; PR #101 merged | Eligible after approval |
| `origin/afyx/integrated-alpha-provider-onboarding` | `42d7e54049e35a33562c7c6688711876c4d0a10c` | Ancestor of dev, but canonical worktree uses older local tip and is dirty | No |
| local `afyx/integrated-alpha-provider-onboarding` | `b03ad891f5a19e7420089ab1b3ae42b2aa20a65a` | Owner worktree attached with uncommitted files | No |
| `origin/afyx/alpha-no-adit-development-handoff-20261019` | `d765603ce98577d190d904078cfa4c891cb26ccb` | Closed PR #77; accurate limits preserved by newer roadmap | Eligible after approval |
| `origin` + local `afyx/t09-a4-a8-gate-handoff-20261019` | `592f770ba1eea17c1032d0cf27c05e503fda0919` | Closed PR #78; current Forge documents supersede it | Eligible after approval |
| local `afyx/t03-r1-graph-alpha-promotion` | `a2ce8055e8c2bef7e83056303669e9e5306257f6` | Remote gone; implementation superseded in dev | Eligible after approval |
| local `afyx/t03-r1-c1-packaging-wal-closure` | `7f5ca4f753fe559031f34754f9b896b2d38ddb3b` | Remote gone; implementation superseded in dev | Eligible after approval |
| local `afyx/t04-external-graph-state` | `5c1c0e51e34a663f3cfc5bde7cd6fbb6c487d163` | Remote gone; implementation superseded in dev | Eligible after approval |

The detached dirty Temp worktrees and clean evidence worktrees require their own
exact owner-approved cleanup manifest before removal. No reflog expiry, garbage
collection, reset, clean, branch deletion, or worktree removal occurred.

## Promotion readiness and next work

Future DEV → Alpha readiness is **CONDITIONAL** until this consolidation PR is
reviewed and exact-head CI is green. After merge, a promotion review must bind a
new Alpha commit/tree and must not relabel artifact `12631346917`; a changed
source requires its own exact-source build and attestation.

The highest-value existing product work remains capability-specific, not another
repository audit: Engineering Expert D.6 independent acceptance when an eligible
review boundary exists, or the next reproducible Graph/provider correctness issue.
Forge formal execution, Adit, private evaluator operations, and publication stay
deferred pending their explicit authority.
