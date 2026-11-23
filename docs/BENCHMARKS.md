# Benchmark methodology

This document defines the methodology for future Afyx benchmark campaigns. It is scaffolding only: smoke runs validate the harness, while comparative conclusions require a separately executed and reviewed benchmark campaign.

## Methodology

### Harness design

Scenarios are declared in `evals/manifest.json`. The agent receives only the scenario's `user_prompt`; evaluator assertions, forbidden patterns, validation commands, and allowed file scope remain evaluator-only. Each scenario/configuration/repetition cell runs in a fresh copy of its canonical fixture, and the harness verifies that the canonical fixture was not modified.

Runs produce machine-readable records under `evals/results/`. Correctness assertions and validation commands determine pass/fail before efficiency metrics are considered. Provider-reported token fields are retained as reported, derived token fields remain explicitly labeled, and unavailable observations are recorded as `null` rather than estimated. Raw artifacts are not committed.

Smoke mode uses one repetition to test isolation, fixture reset, capture, and serialization. Benchmark mode requires at least three repetitions and is the only mode intended for a comparative campaign.

### Activation semantics

The configurations `N`, `E`, `O`, `P`, `EO`, `PO`, and `CORE` control which Afyx skills are available in a run. The harness applies session-only `skills.config` overrides and copies only the selected frozen skills into the fresh fixture; it does not modify the user's installed skills or production configuration.

Availability is not treated as proof of activation. Each scenario explicitly declares required and forbidden skill reads. The evaluator records three independent conditions:

- every required skill read was observed;
- no forbidden skill read was observed;
- every observed Afyx skill read was available in the selected configuration.

A cell must satisfy its scenario-authored activation expectations. The full configuration skill list is not automatically required, because a skill may be available without being relevant to that scenario.

### Content-hash freezing

`evals/environment.json` records the repository commit, component versions, runtime selection, provider settings, and optional-tool availability without secrets. `evals/harness/freeze.py` computes deterministic SHA256 fingerprints from the sorted POSIX-relative file names and complete file bytes under the bundled Efficient Coding and Odoo Engineering skill directories.

Before constructing any run or making a model call, the harness recomputes those content hashes and compares the installed Prompt Master checkout SHA with the frozen value. A mismatch aborts the run. A campaign must use one frozen environment and repository revision throughout; any intentional input change starts a new fingerprint and a separate campaign rather than mixing incompatible records.

### Adaptive run strategy

Round 1 (discovery) executes exactly one repetition for every declared scenario/configuration cell. Cells are interleaved in deterministic, seed-recorded order so one configuration is not systematically favored by execution order.

Round 2 (confirmation) adds repetitions only for cells whose Round 1 result is ambiguous: either efficiency metrics are a near-tie between configurations, or a failure needs confirmation before it can trigger a skill-content change. Unambiguous cells are retained as directional evidence with `n=1` and are not re-run.

The combined total for Round 1 and Round 2 must not exceed 27 runs. The campaign log records which cells entered confirmation, the ambiguity trigger, added repetitions, exclusions, failures, and the stopping decision. Additional runs retain recorded seeds, fresh sessions, and fresh fixtures.

This adaptive policy controls evidence collection; it does not change assertions after results are observed, combine records from different frozen environments, or turn unavailable metrics into estimates.

## Results

### Campaign A: pending
