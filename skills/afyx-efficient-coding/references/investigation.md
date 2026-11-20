# Investigation routing

## Ground the task

Before editing, identify the requested target, observable problem or expected outcome, material impact, and the validation signal that will distinguish success from an unverified change. Repository evidence overrides assumptions.

## Known target

Start at the named method, field, file, stack frame, or failing test. Inspect callers, dependencies, inheritance, configuration, and tests only when they can change the safe implementation or validation boundary. Do not begin with a repository-wide scan.

## Unknown target

Anchor on the observable signal: error text, missing UI element, request route, log window, or reproduction. Establish a reliable failure signal or behavioral baseline when feasible. Search for candidates, compare and narrow them, then read the authoritative implementation and trace only relevant relationships. Avoid opening every candidate in full.

## Cross-cutting or architectural

Find the source of truth before editing. Trace consumers, callers, inheritance, dependency paths, configuration, and persistence boundaries. State the impact boundary, preserve existing contracts, and validate representative downstream paths.

## Change and cost boundary

Make the smallest safe change supported by the evidence. Existing explicit user authorization is sufficient within its stated scope. Request approval before unapproved destructive operations, new dependencies, public API or schema changes, or material scope expansion.

When relevant, check algorithmic complexity, N+1 behavior, memory, I/O, and concurrency. Treat these as risk lenses, not mandatory ceremony for simple changes.

## Stopping rule

Stop gathering context when the source, behavior, impact, and validation boundary are sufficiently evidenced. More exploration is not safer when it only repeats established facts.
