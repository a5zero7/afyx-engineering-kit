# Afyx Efficient Coding

**Quality-first engineering workflow · Skill v1.2.1**

Efficient Coding is an independent, instruction-only Afyx skill for coding,
debugging, refactoring, and code investigation. It prefers correctness,
source-backed evidence, minimal safe changes, and focused validation. It is
**not** a runtime, a mandatory Forge stage, or a general-chat instruction.

## When to use it

Use for actual code work when the source, defect, change boundary or validation
needs to be established. Skip it for plain conversation, general prompt writing
and unrelated documents.

The core flow, defined by [SKILL.md](SKILL.md), is:

1. **GROUND** — establish the outcome and validation signal.
2. **LOCATE** — inspect the known target directly; expand only for uncertainty.
3. **REPRODUCE** — establish a bug signal before changing code when feasible.
4. **CHANGE** — make the smallest safe, authorized change.
5. **VALIDATE** — start with focused checks and expand for real regression risk.
6. **REPORT** — state the result and actual evidence, not imagined PASS.

The reference files are progressively loaded **only when needed**:
`references/investigation.md`, `references/tool-routing.md`, and
`references/token-efficiency.md`.

## Installation and activation

- Component ID: `efficient-coding`.
- Kit presets: `minimal`, `recommended` and `full`.
- Installation is via the Kit's component/skill lifecycle or the appropriate
  host's native skill directory.
- No model subscription, Graph index, Forge daemon or Context Engine is required
  for the skill itself. Actual tests need the target project toolchain.

For relationship/impact work, prefer a **healthy, authorized, relevant**
Afyx Graph capability if it genuinely saves effort. A known file or simple edit
should be handled directly without unnecessary indexing. If Graph is missing or
stale, return to direct source evidence. Read
[tool routing](references/tool-routing.md) for precise fallback and permission
boundaries.

## Limits and acceptance

This skill supplies execution discipline, **not execution evidence**. Do not
claim successful tests unless they ran. Do not skip required security, schema,
data integrity, or runtime checks just to minimize tokens. Preserve existing
architecture and obtain authorization for out-of-scope or destructive actions.

**Component status:** standalone instruction skill implemented at v1.2.1.
The Kit as a whole remains Technical Alpha on the reviewed 2026-11-05 `dev`
baseline. See [Component Guide](../../docs/COMPONENTS.md#efficient-coding).
