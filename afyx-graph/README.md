# AFYX Graph

AFYX Graph is the native local structural code-intelligence engine of
[AFYX Engineering Kit](../README.md). It indexes eligible file and symbol
facts, resolves supported source-grounded relationships, and exposes query,
explore, impact, inventory, freshness, and MCP interfaces.

- [Engine README](engine/README.md): setup, public APIs, state, tests and limits
- [Graph UI](engine/ui/README.md): bundled local viewer, not a separate runtime
- [Component Guide](../docs/COMPONENTS.md#afyx-graph): usage and troubleshooting
- [Development Status](../docs/DEVELOPMENT_STATUS.md): actual `dev` and CI proof

The graph is a **static evidence system**. Dynamic runtime resolution and
unsupported syntactic constructs are explicitly limited, and registered
extensions are not a claim of universal extraction accuracy.
