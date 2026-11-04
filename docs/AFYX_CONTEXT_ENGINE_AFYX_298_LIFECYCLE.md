# AFYX-298 — Native ACE Kit lifecycle

Status: **SOURCE IMPLEMENTED; ISOLATED INSTALLED ACCEPTANCE REQUIRES OWNER AUTHORIZATION**

## Contract

`afyx-context` is an AFYX-owned, optional runtime managed by the existing Kit
component plan. It has no membership in Minimal, Recommended, or Full. It is
selected only through `afyx-context=install|update|repair` or Custom with an
explicit `afyx-context` member.

The runtime root defaults to `~/.afyx/context` and can be overridden with
`AFYX_CONTEXT_RUNTIME_ROOT`, `-ContextRuntimeRoot`, or
`--context-runtime-root`. Installation never changes PATH, Codex/MCP
configuration, provider routing, Headroom, Graph output, or Graph–ACE's
default-OFF setting. ACE state supplied to the CLI remains user-owned and is
outside installation ownership; uninstall removes only a verified runtime.

## Identity and safety

The staged runtime records product version, exact Git source revision, build
provenance, release channel, ownership class, and SHA-256 artifact identity.
An independently hashed identity file binds those fields. A content manifest
binds every installed runtime file. Verification rejects missing, modified,
foreign, symlinked/reparse-point, relative, traversal, root, or source-overlap
destinations.

Promotion uses a same-parent staged directory and a bounded `.afyx-old`
recovery directory. A valid single recovery is restored before a mutating
operation. Ambiguous, foreign, or invalid recovery fails closed. Read-only
validation, verification, and uninstall never resolve pending recovery.

## Validation matrix

| Evidence | Result |
|---|---|
| Component schema and unchanged preset membership | PASS |
| PowerShell/Bash/Node/Python static syntax | PASS |
| Existing control-plane regression | PASS — 12/12 |
| Existing lifecycle regression | PASS — 8/8 |
| ACE clean build and standalone regression | PASS — 9 files; 53/53 |
| Windows disposable install/update/repair/recovery/uninstall | NOT_RUN — separate owner authorization required |
| Linux/macOS disposable lifecycle | NOT_RUN — exact-head CI requires publication authorization |
| Exact-head Windows/Linux/macOS CI | NOT_RUN — publication authorization required |

Historical AFYX-296 token evidence remains raw 34 and net 173 after recovery
(+139 regression). This lifecycle does not justify default-ON activation.
Dependency-security findings remain separate and are not reclassified by this
work.
