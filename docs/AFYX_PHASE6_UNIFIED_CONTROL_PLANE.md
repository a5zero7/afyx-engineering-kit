# Phase 6 — Unified Kit & Provider Control Plane

Status: **IMPLEMENTED / LOCAL VALIDATION PASS / EXACT-HEAD 3OS CI PASS / OWNER MERGE DECISION PENDING**

Development baseline: `dev` at `dcebee5a08d3b958d757d056336a3eef7e9653e9`.
This is a development contract only. It does not activate Alpha, replace an active
runtime, authorize Forge, or promote a release.

## Authoritative model

`scripts/components.json` remains the single component truth. Version 1 of the
control-plane extension declares:

- ordered component membership for `minimal`, `recommended`, `full`, and `custom`;
- declared ownership classes `AFYX` and `EXTERNAL`, with `USER` reserved for
  unverified actual installations;
- a provider/agent adapter registry with Codex as the primary v1 adapter;
- merge-only ownership for Afyx Codex entries and observe-only Headroom handling.

PowerShell and Bash resolve the same deterministic plan identity:

```text
v1|<preset>|codex|<ordered-component-ids>
```

The plan is resolved before mutation. Components outside the plan are reported as
`EXTRA` and preserved; desired-state convergence never treats absence from a preset
as uninstall authorization. A preset cannot be combined with legacy per-component
action or force flags in the same operation; use `custom` for an exact alternative
selection.

## Presets

The table below includes the Phase 7 frozen-v1 policy amendment proposed for owner
review: Prompt Master is retired from default presets but remains an explicit Custom
EXTERNAL component. This stacked change does not rewrite the reviewed Phase 6 commit.

| Preset | Desired components |
|---|---|
| Minimal | Efficient Coding, Odoo Engineering |
| Recommended | Minimal plus Afyx Engineering Expert |
| Full | Recommended plus Afyx Graph and platform-applicable Usage Tracking |
| Custom | Exact ordered subset supplied by the operator; may explicitly include external Prompt Master |

Windows-only components resolve as `NOT_APPLICABLE` on Linux/macOS. Headroom is an
external observed adapter and is not silently installed by any preset.

## Desired versus actual state

| Drift | Meaning | Control-plane action |
|---|---|---|
| `IN_SYNC` | Desired component is healthy | None, except a proven newer Afyx version may update |
| `MISSING` | Desired component is absent | Install through its existing lifecycle path |
| `MODIFIED` | Afyx marker proves ownership but content changed | Bounded repair with backup and transaction rollback |
| `DEGRADED` | Afyx component is incomplete or invalid | Bounded repair when ownership permits |
| `UNVERIFIED` | Actual ownership cannot be established | `BLOCKED`; never automatic takeover |
| `EXTRA` | Installed but not selected | Preserve unchanged |
| `ABSENT` | Not selected and absent | None |
| `NOT_APPLICABLE` | Unsupported on this platform | None |

`AFYX_OWNED_MODIFIED` is represented as `DRIFTED`, not conflated with foreign/user
ownership. `FOREIGN_UNPROVEN`, unsafe paths, and unknown installations cannot be
repaired with `--force`, `-Force`, or an explicit repair action. Prompt Master remains
upstream-owned and Headroom remains external; neither becomes Afyx source or a Forge
replacement.

## Entry points

PowerShell:

```powershell
.\install.ps1 -Preset minimal
.\update.ps1 -SkipSelfUpdate -Preset recommended
.\verify.ps1 -Preset full
.\install.ps1 -Preset custom -CustomComponent efficient-coding -CustomComponent afyx-graph
```

Bash:

```bash
./install.sh --preset minimal
./update.sh --skip-self-update --preset recommended
./verify.sh --preset full
./install.sh --preset custom --custom-component efficient-coding --custom-component afyx-graph
```

Omitting a preset preserves the existing interactive/component-action interface, except
that Prompt Master defaults to Skip and requires an explicit Custom or component action.
Update forwards the selected plan to the same installer, while verification uses the
same plan and state classifier read-only.

## Achieved versus pending

| Requirement | Result |
|---|---|
| Immutable ordered component plan | PASS |
| Desired/actual state and drift vocabulary | PASS |
| AFYX / EXTERNAL / USER ownership behavior | PASS |
| Codex-primary provider/capability registry | PASS |
| Minimal / Recommended / Full / Custom presets | PASS |
| Ownership-aware repair and foreign takeover denial | PASS |
| Install/update/verify convergence | PASS |
| Unrelated configuration preservation | PASS on disposable synthetic configuration |
| Interrupted transaction recovery and rollback | PASS, reused affected lifecycle regression |
| Windows local focused/regression validation | PASS |
| Full repository suite on native Windows | FAIL: 25 environment errors in three POSIX/WSL Forge modules; no Phase 6 assertion failure |
| Exact-head CI run `39227026045` | PASS on Windows, Linux, and macOS for `b7fddb76264244803d723cca5537f9e2ddc0238c` |
| Owner-supplied isolated Windows install/post-install/idempotency evidence | NOT VERIFIED in the public PR evidence available to this review |
| Independent review and merge to `dev` | PENDING |
| Active-runtime replacement, Alpha activation, stable release | NOT AUTHORIZED |

Local evidence before review: control plane 10/10, component contract 9/9, lifecycle
8/8, ownership transactions 6/6, legacy adoption 4/4, static component validation,
PowerShell import/syntax, and Bash syntax all PASS. Exact-head remote CI is recorded
separately above and is not inferred from these local results.

The broader repository run executed 227 tests and returned FAIL with 25 environment
errors: three synthetic-image cases rejected a non-absolute compiler executable,
15 WSL-container cases called POSIX-only `os.getuid()` on native Windows, and seven
WSL-lab cases failed for the same POSIX-only identity call. These failures are
preserved, are outside this control-plane diff, and are not relabeled PASS.
