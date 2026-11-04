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
| Coordinate a complete engineering decision | Engineering Expert routing across 13 disciplines and six workflows | Instruction quality and task evidence; final D.6 acceptance is not claimed |
| Compare engineering candidates consistently | Forge manifests, public fixtures, validators, controller and isolation work | Preparation exists; full authorized campaign/native acceptance remains incomplete |
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
| Expert → supporting skills | Composition guidance; Graph remains optional and Odoo Engineering owns release-specific Odoo facts |
| Forge → candidate/evidence | Versioned manifests, immutable identities, fail-closed readiness and evidence receipts |

## Current maturity and claim boundaries

| Area | Current status | Claim that is intentionally not made |
|---|---|---|
| Kit lifecycle | Implemented and regression-tested across supported scripts | No guarantee for an unverified foreign target or every host customization |
| Afyx Graph 1.0.0 | Technical Alpha runtime | Not Stable v1; publisher authenticity is not implied by checksum alone |
| Engineering Expert 0.1.1 | Usable instruction skill | No framework certification, SME sign-off, or final D.6 acceptance claim |
| Forge | Engineering/evaluation foundation | Not a fully accepted native production evaluator; campaign remains gated |
| ACE 0.1.0 | Standalone and Kit-managed explicit option | No universal token/context saving; no distributed coordination or production authentication |
| Odoo Engineering 1.2.0 | Stable reference coverage for Odoo 10–20 | No substitute for exact repository/runtime version evidence |
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

## Direction

Near-term development continues through real-repository dogfood, hardening, and
release engineering. A single workload is an increment, not completion of the
representative workload matrix. The detailed sequence and historical evidence
remain in the [Afyx v1 Master Roadmap](AFYX_V1_MASTER_ROADMAP.md).
