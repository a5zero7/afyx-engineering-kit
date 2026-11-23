# Afyx evaluation foundation

This directory contains the deterministic Phase 3 benchmark foundation. Phase 3A validates isolation, fixture reset, capture, and serialization only; it does not provide product conclusions.

## Frozen environment

`environment.json` preserves the historical Phase 3A fingerprint, and
`environment-expert-v0.1.0.json` preserves the AFYX-283 Codex 0.156.1 evidence.
`environment-expert-v0.1.0-codex-0.162.1.json` preserves the initial 0.162.1
legacy-sandbox evidence, and `environment-expert-v0.1.1-codex-0.162.1-mxc.json`
preserves the prior AFYX-283D.4 candidate evidence. The active manifest points to
`environment-expert-v0.1.1-specialists-codex-0.162.1-mxc.json`, which captures the
AFYX-310 specialist expansion content hash while preserving the verified MXC
permission-profile boundary. The runner
uses the recorded `gpt-5.6-sol`, medium reasoning, and direct `openai` provider
settings explicitly. It does not read or store authentication secrets.

Before a benchmark series, compare installed component versions with the fingerprint. Do not update a skill or tool during the series. If a mismatch is found, stop and create a new fingerprint rather than mixing results.

Freeze repository skill content before the first run:

```text
python evals/harness/freeze.py
```

The freezer hashes the sorted POSIX-relative file list and full bytes of every
file under Efficient Coding, Odoo Engineering, and Afyx Engineering Expert.
Every runner invocation recomputes those hashes and verifies Prompt Master's
commit, origin, and clean checkout before constructing a run or calling a
model. Any mismatch aborts with exit code 2. The freezer updates only the
environment selected by the manifest; the historical Phase 3A fingerprint is
not silently rewritten.

Validate only the frozen inputs without constructing runs or calling a model:

```text
python evals/harness/run.py --mode smoke --preflight-only
```

Validate the manifest, fixture references, configuration references, and Odoo reference dates without network or model calls:

```text
python evals/harness/validate.py
```

## Genuine skill isolation

Codex officially supports per-skill enablement through `skills.config`. Every invocation:

1. uses `--ignore-user-config` and explicit model/provider/reasoning arguments;
2. disables all four personal Afyx skill paths with a session-only `-c skills.config=...` override;
3. copies only the selected frozen skill sources into the fresh fixture's repository-local `.agents/skills` directory;
4. places the evaluated workspace under the operating-system temporary root,
   outside the evaluator/source repository and its answer-bearing ancestors;
5. runs an ephemeral Codex session with the `afyx-evaluation` permission
   profile: root and OS-temp reads denied, minimal runtime paths readable,
   only the evaluated workspace writable, network disabled, and no approval
   escalation;
6. selects native MXC on Windows. It does not pass legacy `--sandbox`, because
   that mode disables permission-profile enforcement.

This preserves `N`, `E`, `O`, `P`, `EO`, `PO`, and `CORE`, and adds `X`
(Expert only) plus `CORE_X` (CORE + Expert). Formal aliases are `A0=N`,
`A1=CORE`, `B0=X`, and `B1=CORE_X`; A0/B0 are diagnostic while A1/B1 are the
primary comparison. The harness neither renames/deletes personal skills nor
edits production config. Authentication remains in the existing `CODEX_HOME`;
the harness never copies or serializes it.

Before any evaluated cell, an actual-session canary attempts one exact read of
an evaluator-only file. A run proceeds only when the attempt is observable,
blocked, and the random canary content is absent from all returned events. A
timeout, missing read event, successful read, or exposed marker fails closed.

```text
python evals/harness/run.py --isolation-canary-only
```

The actual-session preflight first runs a no-skill child health probe, then an
allowed synthetic read from the same external disposable workspace constructor
used by evaluation cells and four evaluator-only reads outside that boundary.
It records bounded, canary-redacted JSONL/stderr diagnostics. A timeout kills
only the owned child process tree. Provider health, command-tool availability,
positive workspace access, and evaluator-file denial are separate gates; a
textual denial from the model is never sufficient evidence.

Any observed evaluator-only read success or randomized canary exposure is an
isolation `FAIL`, even when the positive control is missing or the child later
times out. `positive_control.attempt_observed` records only an actual positive
control event, not unrelated command-tool activity.

On Windows, npm may resolve `codex` to a `.CMD` shim that cannot be passed
directly to Python `Popen(shell=False)`. The runner resolves its sibling
`codex.ps1` and invokes it through PowerShell `-File` with a discrete argv; it
never concatenates a shell command. Frozen preflight verifies the installed CLI
version and required non-model command options before model execution.
Child-health and isolation evidence share a `control_run_id`; blocked health
overwrites current isolation evidence with `NOT_EXECUTED`, preventing reuse of
a stale result.

`environment-expert-v0.1.1-specialists-codex-0.162.1-mxc.json` is the distinct AFYX-310
candidate fingerprint capturing the 16 selective specialist references for the
engineering expert skill on subject commit `3737aee44920d7239c42f22813536d55b0bd2869`.
Historical v0.1.0 and prior v0.1.1 files remain immutable historical evidence;
candidate results must not be associated with older benchmark commits. Formal evaluation
benchmarks for this candidate remain unexecuted.

The C.8 host acceptance uses Codex's supported permission-profile path rather
than universal command rejection. On Windows, the profile is enforced by MXC.
The trusted evaluator controller keeps evaluator-only inputs outside both the
evaluated and developer workspace roots; both agent roles must run with the
same root-deny profile. A1 and B1 use identical permissions. Synthetic host
controls proved workspace read/write, four evaluator-only read denials, and an
evaluator-only write denial without marker exposure, timeout, or orphan cleanup.

## Scenario and evaluator separation

`manifest.json` stores scenario prompts and evaluator-only fields: assertions,
forbidden patterns, validation command, allowed/expected file scope, and pilot
rubrics. The harness sends only `user_prompt` to the agent. The external
fixture copy contains no manifest, rubric, private holdout, or answer-bearing
repository ancestor.

Each scenario defines:

- `scenario_id`, category, fixture, user prompt, and configurations;
- explicit required and forbidden skill reads for activation assertions;
- binary expected assertions and forbidden patterns;
- optional XML-specific forbidden patterns for typed contamination counts;
- a validation command or `null`;
- allowed and expected file scope;
- coding or generated-prompt output type.

Phase 3A includes only three neutral smoke fixtures: a Python bug, an Odoo version trap, and a prompt-authoring request.

AFYX-283 adds five explicitly DEVELOPMENT-only pilot scenarios. They are rubric
calibration inputs, not private holdouts and not a formal A1/B1 campaign.

## Fresh fixtures

Every cell copies its canonical fixture to a unique disposable directory under
the operating-system temporary root. Run events/results remain in the ignored
`evals/results/<run-id>` evidence directory. The runner hashes the canonical
tree before and after the run and fails `canonical_fixture_unchanged` if it
changes. File-diff metrics exclude injected `.agents/skills` content.

## Running

Smoke once per declared cell:

```text
python evals/harness/run.py --mode smoke
```

Run the bounded development-pilot calibration (only after the canary passes):

```text
python evals/harness/run.py --mode pilot
```

Benchmark mode enforces at least three repetitions:

```text
python evals/harness/run.py --mode benchmark --repetitions 3
```

Cells are deterministically shuffled with the recorded seed, interleaving configurations and scenarios. Override it explicitly with `--seed`. Each cell starts a fresh session and fresh fixture.

Summarize captured records:

```text
python evals/harness/analyze.py
```

## Metrics

Each `result.json` follows a stable machine-readable shape. Provider-reported
tokens are captured when present. Wall time, tool/search/read calls observable
in Codex JSON events, modified files, validation commands, failed tools,
critical assertions, and version-contamination counters are recorded.
Activation evidence separately records availability, discovery/read attempt,
successful `SKILL.md` content observation, blocked/failed read, and
`ACTIVATION_NOT_OBSERVABLE`. A command that merely mentions `SKILL.md` is not a
successful activation observation.

Unavailable fields are `null`; the harness never estimates tokens or file-read counts. Provider `total_tokens` remains untouched and nullable. `derived_input_output_tokens` and `derived_uncached_input_tokens` are separately labeled arithmetic diagnostics, never substitutes for provider totals. Character or word counts are not substitutes for tokens. Correctness assertions gate PASS before efficiency can be considered.

Raw run directories are ignored. `latest-summary.json` is a sanitized, bounded summary intended for reproducibility checks, not a final benchmark conclusion.

## Smoke versus benchmark

Smoke mode uses one repetition to validate mechanics and fixtures. It is not evidence for configuration recommendations. Benchmark mode requires at least three independent repetitions and is reserved for later Phase 3 work with a complete scenario library.

## Current limitations

- Tool/read/search metrics depend on the event detail exposed by the installed Codex CLI.
- General file-open and duplicate-read counts remain unavailable. For Expert
  evaluation only, completed successful tool traces record normalized unique
  `references/*.md` and `workflows/*.md` paths; the Architecture scenario fails
  when more than three Expert references are observed or when reference-path
  telemetry is unavailable. Missing telemetry is stored as `null`, never as an
  observed zero. This bounded gate does not claim that every filesystem read is
  visible.
- Phase 3A does not evaluate Afyx Graph, Headroom, end-to-end Prompt Master value, or comparative skill effectiveness.
- The current fixtures validate the harness only and must not be used to claim benchmark superiority.
- An actual-session canary or pilot can be BLOCKED by host/model availability;
  deterministic harness tests do not convert that condition into isolation or
  product PASS evidence.
- AFYX-283B confirmed the child model/provider is healthy, but its nested
  canary used a different workspace location from actual cells and therefore
  could not establish workload-equivalent isolation. AFYX-283C.1 corrects that
  parity and result precedence deterministically. Actual host isolation remains
  NOT VERIFIED until the corrected procedure is executed directly from a
  trusted PowerShell host. Development pilots and formal A1/B1 remain not run.
