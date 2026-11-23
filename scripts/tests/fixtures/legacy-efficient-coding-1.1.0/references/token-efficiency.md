# Large-context guidance

Use this reference only when repository exploration or tool output is large enough to create avoidable context overhead.

## Exploration strategy

For a known target, begin with that definition or failing path, then inspect only the relationships and behavior needed to establish impact. For an unknown target, search to identify candidates, compare the relevant ones, then narrow before reading implementations in depth. A repository-wide search is appropriate only when the question itself is repository-wide.

Do not repeat an unchanged search, reread unchanged material, or request a full file when the relevant symbol or section is sufficient. Preserve a compact record of established facts rather than recreating the same investigation.

## Tool boundaries

Use Afyx Graph when resolving relationships is the efficient way to answer a structural question. Prefer direct search or focused reads for known locations and simple textual facts.

Use Headroom for genuinely large logs, test output, search results, JSON, API responses, database output, or generated tool output when compression preserves the needed meaning. Do not compress small results by default. Retrieve the original output before relying on an exact line, value, order, or detail that compression could omit.

Efficiency applies to wasted context only: retain every piece of evidence needed to make and validate a correct change.
