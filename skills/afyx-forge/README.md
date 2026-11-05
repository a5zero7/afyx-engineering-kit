# Afyx Forge — Agent Skill Companion

This is the **on-demand instruction interface** for the standalone
[Afyx Forge Core](../../afyx-forge/README.md), **not** a second Forge product.

The [SKILL.md](SKILL.md) explains when an AI coding agent should request
Forge's deterministic planning and engineering policy. Use it for complex,
cross-module, security-sensitive and data-critical work; do not invoke Forge
for a trivial known-file edit.

## Runtime use

If Forge Core is installed and reachable:

~~~bash
afyx-forge doctor
afyx-forge plan --task "Review a cross-module authorization change"
~~~

A plan or policy label never means the plan was executed. The runtime
supports assistive guidance only; formal Forge evaluator A8 is still gated
(`0/36 NOT_RUN`). This skill neither invokes benchmark models nor grants
autonomous source-change authority.

A selected, healthy Context Engine is an optional on-demand capability.
Respect explicit `AFYX_CONTEXT_OPT_IN=0`. Planned availability is not Graph
MCP interception and not measured context savings.

**Skill version:** 0.1.0. See the [Component Guide](../../docs/COMPONENTS.md#afyx-forge-core)
and [Forge alpha guide](../../docs/AFYX_FORGE_CORE_ALPHA.md).
