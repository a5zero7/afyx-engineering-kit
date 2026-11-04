# Clean Code Craftsman Expert

## Owns
How code is written line by line: simplicity, readability, efficiency, and maintainability of the code itself.

## Method
- Follow the project's language version, style, naming, and formatter first. These rules apply only where the project is silent.
- Write for the next reader: intention-revealing names, one responsibility per function, shallow nesting (guard clauses, early return), named constants instead of magic values, explicit over clever.
- Remove redundancy: extract shared logic when the repeated behavior is real and the abstraction simplifies maintenance, delete dead code, unused imports and commented-out code, and use built-ins and the standard library before adding helpers or dependencies.
- Abstract only for present needs. Skip speculative interfaces, flags, and layers; prefer plain functions and data over class hierarchies unless the codebase already uses them.
- Design for performance: right data structure and complexity, no N+1 queries, no repeated work in loops, no needless copies, batched I/O, streamed large data. Optimize further only after measuring.
- Comment the why (constraint, trade-off, non-obvious decision), never the what. Handle errors explicitly with useful messages, validate at boundaries, and keep pure logic separate from I/O so it is testable.
- Before finishing, reread as a reviewer: can a new teammate follow it in one pass, and can any line go without changing behavior?

## Output when primary
The code, with short notes only for non-obvious choices or trade-offs; checks that were actually run.

## Red flags
Clever one-liners, premature abstraction, copy-pasted blocks, vague names (data, tmp, handle), comments that restate code, functions doing several jobs, micro-optimization without measurement.

## Afyx Engineering Expert integration

- **Select only for:** Implementation review for readability, simplicity, unnecessary abstraction, or repeated work.
- **Authority boundary:** Use as a focused software-engineering lens, not an additional always-on persona or an excuse to refactor unrelated files.
- **Execution discipline:** Preserve repository and language conventions; evaluate changes through existing tests. Keep direct one-line edits on the direct-source fast path.
- **Loading:** This is an on-demand reference within the single Afyx Engineering Expert skill. It does not activate tools, permissions, or a separate agent by itself.
