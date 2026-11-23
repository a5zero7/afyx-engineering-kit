# Afyx Context Engine — Agent Skill Companion

This skill is an **optional provider integration surface** for
[Afyx Context Engine (ACE)](../../afyx-context/README.md), not a separate
runtime or product. [SKILL.md](../../skills/afyx-context/SKILL.md) is the authoritative instruction
for on-demand activation, permission checks, original-content retention and
safe fallback.

## When to activate

Use ACE only for genuinely large or repeated **noncritical** tool output
where reducing presentation can help without losing required evidence. Keep
source code, security findings, stack traces and relevant diagnostics intact.

A healthy, explicitly installed ACE runtime may be discovered on demand by
supported providers. Respect `AFYX_CONTEXT_OPT_IN=0` and any user/provider
OFF setting; discovery does not imply eager execution.

## Example CLI

~~~bash
afyx-context reduce --state /absolute/owned/state --owner owner-a --session source-sha --input request.json --budget 16000
afyx-context get --state /absolute/owned/state --owner owner-a --session source-sha --reference 'ace:v1:...'
~~~

Exact recovery needs the original owner/session/state identity. On missing
data, an invalid digest or an unsafe lock, preserve/fall back to authoritative
original output. There is **no universal token savings guarantee** and this
skill does **not** automatically intercept Afyx Graph MCP.

**Skill version:** 0.1.0. ACE is absent from every implicit Kit preset;
install its runtime explicitly before using this companion.
