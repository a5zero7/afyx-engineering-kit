# Afyx Graph UI

**Bundled local viewer for Afyx Graph — not a separate Afyx product.**

This UI workspace contains the viewer source that the Graph engine packages for
local use. It is compiled together with the native Graph engine and inherits its
Technical Alpha lifecycle, source identity, and security boundary. The UI is not
an independently managed installer component or a substitute for Graph's CLI/MCP
or repository evidence.

## Development and validation

From the parent `afyx-graph/engine` directory:

```bash
npm ci
npm run build:ui
npm run build:clean
npm run test:smoke
```

Use the engine's normal CLI/daemon/viewer lifecycle and a healthy project index.
The viewer must not present unindexed/stale data or source relationships as
runtime guarantees. See the [Graph Engine README](../README.md),
[Component Guide](../../../docs/COMPONENTS.md#afyx-graph), and
[UI Architecture](../../../docs/AFYX_GRAPH_UI_ARCHITECTURE.md).

**Release boundary:** the viewer is included in an Afyx Graph distribution;
its completion does not independently promote the entire Kit to Stable v1.
