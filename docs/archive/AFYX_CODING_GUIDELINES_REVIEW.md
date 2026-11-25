# AFYX Coding Guidance Review — 2026-11-07

**Input:** four-section `CLAUDE.md` text supplied by the project owner in chat. It is a behavioral guideline, not a runtime dependency, a required filename, or an accepted third-party source license. This review adapts its general ideas in AFYX's own wording; it does not copy the source document into the repository.

## Decision: REFINE an existing skill, not REPLACE or CREATE

| Input principle | Existing AFYX coverage | Action |
|---|---|---|
| Think before coding; surface ambiguity and tradeoffs | `efficient-coding` GROUND/LOCATE, `references/investigation.md`, Engineering Expert activation and evidence rules | **Refine**: explicitly surface material assumptions and simpler tradeoffs. Do not force questions for trivial or already-authorized work. |
| Keep solutions simple and avoid speculative features | `efficient-coding` CHANGE + change contract; Engineering Expert `workflows/implementation.md` | **Refine**: avoid speculative layers/flags/dependencies. Reuse existing contracts. |
| Surgical edits, preserve style, remove your own orphans | Existing scoped changes / no unrelated refactors, Expert software-engineer review | **Refine**: prohibit adjacent cleanup; remove only code made unused by the current change. |
| Verifiable goals and implementation loop | `efficient-coding` GROUND→REPRODUCE→CHANGE→VALIDATE; Expert implementation/debugging workflows | **Refine**: a short measurable plan and explicit PASS/FAIL/NOT RUN for multistep tasks. |

### Change applied

`skills/efficient-coding/SKILL.md` version `1.2.1 → 1.2.2`, adding three short, original, provider-neutral paragraphs under *Change contract*. Existing routing, activation boundary, architecture, and seven-component product inventory remain unchanged. No new skill, duplicate persona, hook, or external dependency.

### Why the other choices were rejected

- **New skill:** would duplicate `efficient-coding`, increase trigger ambiguity and unnecessary content loading.
- **Replace current skill:** would throw away AFYX-first tool routing, risk-based validation and tested implementation conventions.
- **Copy entire CLAUDE.md:** ties a provider-neutral product to a noncanonical filename, adds repetition and could create avoidable source provenance questions.
- **Apply the instruction to ask every time there is ambiguity:** conflicts with efficient execution when the uncertainty is immaterial, the scope is already authorized, or a safe bounded assumption is possible.

### Verification and rollout limits

- Source review confirms coverage in `skills/efficient-coding/references/investigation.md`, `references/tool-routing.md`, `references/token-efficiency.md` and `skills/afyx-engineering-expert/workflows/implementation.md`.
- This edit is Markdown-only. The user's Windows **64/64 Node PASS + seven-component validator PASS** was on the prior PR #13 SHA `0da88db7326360b367069508c5de415be4ab78ce`; do not relabel it as executed against the new documentation SHA.
- An installed provider skill is not automatically updated when GitHub source changes. Apply the owner-approved AFYX installer/update flow and verify content ownership separately; do not overwrite a customized local skill profile without inspecting its digest.
- The new wording is an AFYX-owned synthesis of high-level coding practices. This audit does not replace the broader independent ownership/license clearance for the full repository.

## Acceptance

After an authorized local provider update, a coding task should use direct source for known targets, surface only material unknowns, keep the diff within requested scope, and report exact tests/outcomes without inventing PASS. A simple task should not acquire new ceremonies, extra roles, or forced questioning.
