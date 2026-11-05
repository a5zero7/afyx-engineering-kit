# AFYX Graph UI

The local Graph viewer is a **private** UI workspace bundled by
[AFYX Graph](../README.md). It is not a standalone installer, separately
published package, remote SaaS interface, or independent source of truth.

## Development

From `afyx-graph/engine`:

```bash
npm ci
npm run build:ui
npm run build:clean
```

The UI package also declares `npm run check` and `npm run dev`; run these
from `afyx-graph/engine/ui` when working on the viewer directly. Use the
engine's test suite for source/graph correctness and the packaged viewer
checks for bundle integrity.

## Trust and status

The UI presents structural facts and diagnostics returned by Graph. It does
not independently prove runtime behavior or justify marking unresolved
references as confirmed calls. Freshness, partial coverage, and unsupported
constructs must remain visible. The current `dev` integration baseline and
post-merge Windows CI fix are recorded in
[Development Status](../../../docs/DEVELOPMENT_STATUS.md).
