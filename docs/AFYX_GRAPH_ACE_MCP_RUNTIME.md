# Native Graph–ACE MCP Runtime — Alpha Candidate

**Status:** source implemented; CI and installed-provider acceptance required. **Not** a release or T12 acceptance claim.

This optional integration joins the independently packaged Afyx Graph and Afyx Context Engine **at the native Graph MCP session boundary**, not by installing a second Graph service or redirecting all tools through ACE.

## Contract and execution

1. Graph executes each tool normally and returns an authoritative result.
2. A per-connection `McpAceRuntime` inspects that result. No ACE process/state is created unless the tool is a structural candidate (`inventory`, `callers`, `callees`, `impact`), text-only and non-error, within **24 KiB–1 MiB**, free of protected security/diagnostic terms and at least 15% repeated sufficiently long lines.
3. `explore`, `files`, `node`, `status`, short/unique output, unsupported inputs and explicit `AFYX_CONTEXT_OPT_IN=0` all bypass ACE, with exact original Graph output.
4. The installed runtime is discovered at `AFYX_CONTEXT_RUNTIME_ROOT/current/dist/graph-mcp-bridge.js` or `~/.afyx/context/current/dist/graph-mcp-bridge.js`. Metadata, identity and SHA-256 manifest entries are checked before execution. Missing, changed or unsupported ACE returns Graph's original result; no provider configuration is mutated.
5. A bounded native Node child handles ACE requests (no shell, no network, `windowsHide`, 5s parent deadline and kill fallback). It uses the existing `graph.ace.consumer/v1` and `ace.integration/v1` code, with isolated owner/session references and verified local recovery.
6. The default ACE state directory is `~/.afyx/state/context/graph` (outside the repository and separately owned from the installed ACE runtime). `AFYX_CONTEXT_STATE_ROOT` optionally changes it to an absolute safe root. Project/state overlap is refused after canonical realpath comparison—including macOS `/var` aliases. State is not deleted by uninstalling the engine.
7. When a result is genuinely reduced, its `ace:v1:...` references remain in the Graph MCP response. A separate optional MCP tool, `afyx_graph_ace_recover`, receives `{ reference, projectPath }` and retrieves the byte-exact original. The project must still have an Afyx Graph index and ACE must be installed, valid and enabled. References are scoped by the canonical project identity and the local user state; they remain available after a same-host restart if state persists. Recovery errors are explicit rather than fabricated content.
8. If ACE is absent, disabled, corrupt, invalid, timed out, unusable or returns no positive reduction, Graph's original result is emitted unmodified. Protected evidence and diagnostics are never compressed. Existing Graph routes remain unchanged; only a verified ACE installation adds the recovery tool to MCP `tools/list`.

## Important boundaries

- **Default available does not mean always invoked.** This native path requires no `AFYX_CONTEXT_OPT_IN=1`, but honors `AFYX_CONTEXT_OPT_IN=0`. The legacy artifact metadata `integration_default=OFF` remains a historical packaging policy until source+host acceptance and migration/explicit-user-OFF semantics are reviewed; it is **not** evidence of this runtime's effective enablement.
- The optional `afyx-context` provider skill can also invoke ACE directly on explicit tasks; it is not the native MCP bridge.
- The native bridge is a **candidate** until exact installed artifact identity, provider restart/readback, negative recovery, concurrency and real Windows E2E acceptance are observed. CI synthetic or fixture-based proof does not fulfill those installed-product gates.
- The same local account/project can recover its own prior graph-session references. This does not claim remote-user authorization, cross-device session transfer, or persistence after ACE user state is deleted.
- Never print or upload raw original source, customer data, MCP messages, owner state, or private telemetry to GitHub CI reports.

## Focused checks

```bash
node --test afyx-context/test/graph-mcp-bridge.test.js
cd afyx-graph/engine
npm ci
npm run build:clean
npm test
npm run test:smoke
```

The dedicated Graph Build workflow now runs for PRs targeting `dev` as well as `main` and `alpha`. Run all applicable CI and actual owner-host acceptance before PR promotion or merge.
