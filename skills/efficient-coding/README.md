# AFYX Efficient Coding

**Version:** 1.2.1 (see [SKILL.md](SKILL.md) for the authoritative contract).

An evidence-first instruction skill for implementing, debugging, reviewing,
and refactoring code. It is not a separate agent model or executable service.

## Workflow

`GROUND → LOCATE → REPRODUCE → CHANGE → VALIDATE → REPORT`

The skill narrows investigation to the relevant source, reproduces failures
when feasible, and expands regression checks only when the change warrants it.
Use `references/investigation.md`, `tool-routing.md`, and
`token-efficiency.md` only where relevant to the task.

## Availability

Included in Kit `minimal`, `recommended`, and `full` presets. Install via
[Kit lifecycle](../../docs/INSTALLATION.md); inspect the active host's skill
lookup scope. No standalone runtime, implicit network call, or guarantee of
provider-specific token savings is implied.
