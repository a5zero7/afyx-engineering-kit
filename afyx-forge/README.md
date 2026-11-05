# AFYX Forge Core

**Status:** native standalone engineering-guidance core v0.1.0; formal Forge
evaluation campaigns and acceptance gates are separate and remain gated.

Forge Core turns a task description into a bounded, adaptive engineering plan.
It has CLI commands `plan`, `doctor`, `version`, and `help` and exposes
`createForgePlan` through `src/index.js`. It does **not** replace tests,
authorize external evaluator/model runs, or automatically install a provider.

## Run locally

```bash
cd afyx-forge
node bin/afyx-forge.js doctor
node bin/afyx-forge.js plan --task "Investigate a failing API regression"
node bin/afyx-forge.js plan --task-file ./task.md --format markdown
node bin/afyx-forge.js --version
npm test
```

`plan` defaults to JSON, supports `--output <path>`, and refuses empty task
input. `doctor` reports environment/component availability; it does not install
or repair dependencies. Some host integrations or task policies may be unavailable
and must be reported rather than simulated.

## Evaluation foundation is separate

The formal candidate/evidence machinery lives under [`evals/forge/`](../evals/README.md).
Deterministic, model-free preparation commands include:

```bash
python evals/forge/validate.py --check-fixtures
python evals/forge/validate.py --print-order-digest
python evals/forge/validate.py --campaign-ready
```

Run those Python commands from the **repository root**. `--campaign-ready`
can intentionally fail closed while authorization, isolation, runtime, or
acceptance gates remain unsatisfied. A passing unit suite is not an authorized
comparative evaluator campaign.

## Kit integration and licensing

Forge Core exists in source but is **not a default Kit preset component**;
check [the component guide](../docs/COMPONENTS.md#afyx-forge) and
[current development status](../docs/DEVELOPMENT_STATUS.md) for the applicable
integration boundary. `afyx-forge/package.json` currently declares
`Apache-2.0`; do not infer the license of this package from the root MIT file.
