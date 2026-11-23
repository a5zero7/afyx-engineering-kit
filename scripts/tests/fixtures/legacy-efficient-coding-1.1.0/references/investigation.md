# Investigation routing

## Known target

Start at the named method, field, file, stack frame, or failing test. Inspect callers, dependencies, inheritance, configuration, and tests only when they can change the safe implementation or validation boundary. Do not begin with a repository-wide scan.

## Unknown target

Anchor on the observable signal: error text, missing UI element, request route, log window, or reproduction. Search for candidates, compare and narrow them, then read the authoritative implementation and trace only relevant relationships. Avoid opening every candidate in full.

## Cross-cutting or architectural

Find the source of truth before editing. Trace consumers, callers, inheritance, dependency paths, configuration, and persistence boundaries. State the impact boundary, preserve existing contracts, and validate representative downstream paths.

## Stopping rule

Stop gathering context when the source, behavior, impact, and validation boundary are sufficiently evidenced. More exploration is not safer when it only repeats established facts.
