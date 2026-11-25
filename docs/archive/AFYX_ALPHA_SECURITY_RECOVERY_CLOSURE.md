# AFYX-58/59 — Alpha-critical security and recovery closure

Date: 2026-10-21  
Baseline: `2d2875c5fd2e4adf677f65e8eb31c18921d03397`  
Scope: normal Technical Alpha use; no Alpha activation or runtime deployment

## Disposition

| Area | Result | Evidence and residual |
| --- | --- | --- |
| AFYX-58 Alpha-critical security | PASS (bounded scope) | Existing path/ownership, command, MCP, artifact-identity, tamper, and lifecycle guards passed affected regression. A disposable Windows ZIP traversal probe was rejected by `Expand-Archive` without an escaped write. Production dependency audit reports 0 advisories. Full audit reports one high `vite` advisory confined to the development/build dependency and `launch-editor`; it is not reachable from the installed CLI/MCP artifact. Publisher authenticity remains independently unverified where no external attestation exists. This is not a comprehensive security assessment of every development surface. |
| AFYX-59 Alpha-critical recovery | PASS after correction | Init/index, interrupted sync state, corrupt-index rebuild, stale/live locks, WAL healing/deferral, database-handle lifecycle, and transactional lifecycle regressions passed. The verified P1 was an interrupted Graph runtime swap: both official installers used a random backup name that a later retry could not discover. |
| AFYX-249 handoff | CONDITIONAL / separate owner decision | No verified open P0/P1 remains in this bounded AFYX-58/59 scope. Alpha entry still requires owner reconciliation of all other gate evidence and declared limitations; this report does not grant Alpha GO. |

## Correction

Both official Graph installers now use the deterministic sibling recovery path
`<runtime-root>.afyx-old`. Before an install/update retry they:

1. restore a missing runtime only when the recovery metadata proves Afyx Graph ownership;
2. refuse foreign/unverified recovery state;
3. refuse the ambiguous case where runtime and recovery paths both exist;
4. keep validation and uninstall non-mutating while interrupted state exists; and
5. retain rollback to the prior runtime when staging, swap, or post-swap verification fails.

The `product_name` field is an Afyx lifecycle ownership marker used to decide whether
the installer may move the recovery directory. It is not a cryptographic publisher
attestation and must not be reported as one.

If interruption leaves both the new runtime and the recovery path present, refusing
both paths for manual resolution is the designed fail-closed limitation; the installer
does not guess which copy is authoritative.

No Graph engine semantics, index format, user corpus, active runtime, MCP registration,
PATH, or global configuration changed.

## Validation

- Python lifecycle/artifact matrix: 19/19 PASS.
- Graph security/recovery matrix: 402 PASS, 5 platform-conditional skips.
- Full-index recovery suite, including an unreadable/corrupt SQLite file: 6/6 PASS.
- Clean TypeScript/UI production build: PASS.
- CLI/MCP smoke: 21/21 PASS.
- Identity, component, Engineering Assurance, and legacy-identity validators: PASS.
- `git diff --check`: PASS.
- `npm audit --omit=dev`: 0 production vulnerabilities across 3 production dependencies.
- `npm audit`: 1 high development-only `vite` advisory; no production finding.

The interrupted-swap regression constructs the exact owned post-interruption filesystem
state rather than killing an installer process at an instruction boundary. It proves retry,
non-mutating validation, ownership preservation, and ambiguous-state refusal on Windows;
Linux/macOS shell behavior remains subject to exact-head CI.

## Jira-ready update

AFYX-58: bounded Alpha-critical security closure PASS; no production-reachable dependency
advisory or verified P0/P1 found. Keep the development-only `vite` advisory and unattested
publisher authenticity as declared residuals. AFYX-59: P1 interrupted Graph installer swap
fixed with deterministic ownership-checked recovery and fail-closed ambiguous-state handling;
affected recovery evidence passes. AFYX-249: reassess separately after exact-head three-OS CI;
do not infer Alpha GO from this closure alone.

