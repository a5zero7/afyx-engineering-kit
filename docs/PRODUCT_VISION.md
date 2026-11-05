# Afyx Product Vision

Status: maintained product contract for the current Technical Alpha source tree.

## Product identity

Afyx is a native **Engineering Intelligence & Assurance ecosystem**. It helps an
engineer build a defensible path from repository evidence to a scoped change and
then to an acceptance result. It is not defined by one model, provider, editor,
prompt format, or optimization technique.


The product philosophy is:

> **Individually Reliable. Collectively Solid.**

Every component must remain useful and diagnosable on its own. Integration may
add value, but it must not turn a healthy standalone component into a single
point of failure.

> **Best Verified Output. Maximum Accuracy & Precision. Peak Performance. Minimum Effort.**

Correctness and evidence come first. Performance and effort improvements are
valuable only when they preserve the result and make their measurement boundary
clear.

> **Standalone by Design. Integrated by Contract.**

Component coupling is explicit, versioned, optional where promised, and tested
at the boundary. Failure returns an authoritative fallback or fails closed; it
does not silently invent success.

## Six first-class products

The independently usable products are [Afyx Graph](../afyx-graph/engine/README.md),
[Afyx Forge](../afyx-forge/README.md),
[Afyx Efficient Coding](tool-guides/AFYX_EFFICIENT_CODING.md),
[Afyx Odoo Engineering](tool-guides/AFYX_ODOO_ENGINEERING.md),
[Afyx Context Engine](../afyx-context/README.md), and
[Afyx Engineering Expert](../skills/afyx-engineering-expert/README.md).
Their roles differ, but none is demoted from product status by its installer
preset or its implementation as an agent skill.

The Kit installer, verifier, doctor, and capability router are shared platform
infrastructure. Optional Windows Codex Usage Tracking is an additional
observability utility. Neither changes the six-product portfolio.

## Problems Afyx addresses

AI-assisted engineering often fails outside code generation itself:

1. The relevant repository structure and impact boundary are not established.
2. Source inspection is mistaken for runtime proof.
3. Product, security, data, operations, and QA decisions are handled as unrelated
   afterthoughts.
4. Optional integrations become hidden prerequisites.
5. Installation or update overwrites user-owned configuration or state.
6. Benchmarks report output reduction without accounting for recovery cost,
   correctness, or provenance.

Afyx addresses these gaps with structural intelligence, adaptive engineering
guidance, explicit evaluation contracts, conservative context handling, and a
transactional lifecycle.

## Product outcomes

| Outcome | Implemented mechanism | Verification boundary |
|---|---|---|
| Find the right code with fewer unrelated reads | Graph query, explore, node, files, inventory, callers/callees | Static index coverage and freshness; direct source remains authoritative |
| Understand likely blast radius | Graph impact and affected-test traversal | Structural relationships only; runtime/dynamic paths still require tests |
| Coordinate a complete engineering decision | Afyx Engineering Expert routing across 13 disciplines and six workflows | Instruction quality and task evidence; final D.6 acceptance is not claimed |
| Guide focused, evidence-based code changes | Afyx Efficient Coding: ground, locate, reproduce, change, validate, report | Instruction workflow; tests and edits must actually run to count as evidence |
| Apply verified Odoo-version conventions | Afyx Odoo Engineering with version-specific references for Odoo 10–20 | Actual source, runtime, edition, and database behavior take precedence |
| Plan engineering work proportionally | Forge Core v0.1.0 CLI/API, task classification, adaptive policy and bounded guidance | Technical Alpha assistive planning; no autonomous execution or acceptance implied |
| Compare engineering candidates consistently | Separate Forge B0–B5 manifests, fixtures, validators, controller and isolation work | Formal 36-cell campaign remains `NOT_RUN`; A8 has no GO |
| Reduce repeated context without losing originals | ACE conservative reduction and digest-verified retrieval | Local state, explicit ownership/session, measured workload; savings are not universal |
| Install and recover without taking over user assets | Shared component contract, ownership markers, staging, backup, rollback | Supported lifecycle paths and platform CI; external/user configuration is preserved |

## Architecture principles

### Local-first evidence

Graph indexes local repository content into project-owned or explicitly external
state. ACE stores content locally. Neither source inspection nor a local index is
presented as proof of runtime execution.

### Explicit ownership

The Kit distinguishes Afyx-owned, user-owned, and external targets. A known path
or component name alone does not prove ownership. Foreign, overlapping, aliased,
or ambiguous state fails closed.

### Layered verification

Evidence is classified by what it proves:

1. **Source identity:** Git commit/tree and clean tracked state.
2. **Static correctness:** schema, links, manifests, syntax, component contracts.
3. **Focused behavior:** unit and contract regressions.
4. **Integration behavior:** real CLI/MCP/consumer routes in isolated fixtures.
5. **Installed behavior:** packaged artifact at an isolated destination.
6. **Operational behavior:** intended host workload, restart, recovery, and state
   preservation.

Passing an earlier layer never silently substitutes for a later mandatory layer.

### Bounded optimization

Optimization is accepted only when the baseline and changed workload are
comparable, output correctness is preserved, and context/token accounting uses a
named tokenizer when available. Character reduction is not described as provider
billing savings. Negative-net findings are retained rather than hidden.

## Integration contracts

| Boundary | Current contract |
|---|---|
| Kit → components | `scripts/components.json`, control-plane schema v1 |
| Graph → MCP clients | MCP server `afyx_graph`, tools named `afyx_graph_*` |
| Graph → ACE | `graph.ace.consumer/v1`, explicit enablement, default OFF |
| ACE → optional consumers | `ace.integration/v1`, original-content fallback |
| Engineering Expert → Efficient Coding and Odoo Engineering | Optional skill composition; Graph remains optional and Odoo Engineering owns release-specific Odoo facts |
| Forge Core → engineering task | `afyx-forge-plan/v1`, assistive policy/plan; `doctor` inspects environment without changing source |
| Forge evaluation → candidate/evidence | Versioned B0–B5 manifests, immutable identities, fail-closed readiness and evidence receipts |

## Current maturity and claim boundaries

| Area | Current status | Claim that is intentionally not made |
|---|---|---|
| Kit lifecycle | Implemented and regression-tested across supported scripts | No guarantee for an unverified foreign target or every host customization |
| Afyx Graph 1.0.0 | Technical Alpha runtime | Not Stable v1; publisher authenticity is not implied by checksum alone |
| Afyx Engineering Expert 0.1.1 | Usable instruction skill | No framework certification, SME sign-off, or final D.6 acceptance claim |
| Forge Core 0.1.0 / formal Forge campaign | Standalone assistive planning runtime is available; formal B0–B5 campaign remains gated | No autonomous engineering execution, A8 GO, 36-cell benchmark PASS, or A12 acceptance |
| ACE 0.1.0 | Standalone and Kit-managed explicit option | No universal token/context saving; no distributed coordination or production authentication |
| Afyx Efficient Coding 1.2.1 | Independent coding-process instruction skill | No autonomous tool execution or assumed test PASS |
| Afyx Odoo Engineering 1.2.0 | Version-scoped reference coverage for Odoo 10–20 | No substitute for exact repository/runtime version evidence |
| Usage Tracking | Optional Windows toolset | API-equivalent estimates are not invoices or provider-authoritative billing |

No formal Alpha promotion, Stable v1 release, or universal provider support is
declared by this document.

## Change-impact discipline

A maintained Afyx change should answer:

- Which component and contract changed?
- Which callers, consumers, lifecycle paths, and states may be affected?
- Which source, static, focused, integration, installed, or operational evidence
  is required?
- What was measured, and what remains observation or NOT RUN?
- What user/external state must remain untouched?

The desired result is not the largest validation campaign. It is the smallest
set of evidence that makes the product decision safe and honest.

## Verified CI boundary (2026-11-05)

At `dev` commit `e332230a2c0ba162b447af1359cf591057ce26b6`, the
Windows Vitest setup/teardown timeout fix was merged and post-merge Graph,
Kit CI, Windows installer and representative Phase 8 dogfood workflows passed.
This verifies the declared automated CI boundary; it does not substitute for
formal Forge evaluation, independent installed-product acceptance, or Stable v1.

## Direction

Near-term development continues through real-repository dogfood, hardening, and
release engineering. A single workload is an increment, not completion of the
representative workload matrix. The detailed sequence and historical evidence
remain in the [Afyx v1 Master Roadmap](AFYX_V1_MASTER_ROADMAP.md).
