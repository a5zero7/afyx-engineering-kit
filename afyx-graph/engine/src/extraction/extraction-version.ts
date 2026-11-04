/**
 * Extraction version
 *
 * A monotonically-increasing integer that identifies the *shape and depth* of
 * what the extractor writes into the graph. Unlike `CURRENT_SCHEMA_VERSION`
 * (which tracks the SQLite table layout and is migrated in place), this tracks
 * the EXTRACTED CONTENT — node kinds, edges, synthesizers, resolver coverage.
 *
 * When an index was built by an older engine whose `EXTRACTION_VERSION` is
 * below the running engine's, the data on disk is structurally fine but
 * *stale*: it's missing whatever a newer extractor would now produce. A schema
 * migration can't backfill that — only a re-index can. So this is the signal
 * `afyx-graph status` uses to recommend a re-index, and the reason `afyx-graph
 * upgrade` reminds users to refresh their projects.
 *
 * BUMP THIS when a release changes extraction output enough that existing
 * indexes should be rebuilt to benefit — e.g. a new language/framework
 * extractor, a new dynamic-dispatch synthesizer, a new node/edge kind, or a
 * resolver fix that materially changes which edges exist. Do NOT bump for
 * pure bug fixes, CLI/UX changes, or schema-only migrations. Over-bumping
 * turns the re-index hint into noise — keep it honest (see CLAUDE.md, "Honesty
 * in the product is load-bearing").
 */
// v27: long single-line JavaScript bundles that previously exhausted the parse
// budget now contribute their nodes/edges, so existing indexes may be missing
// material extracted content and should be rebuilt.
// v28: supported Python class-level static string assignments now contribute
// source-located property facts for exact structural inventories.
// v29: added native Odoo security and configuration asset extractors:
// __manifest__.py (module metadata & dependencies), ir.model.access.csv (ACL
// model grants), and security XML (record rules, security groups & category definitions).
export const EXTRACTION_VERSION = 29;
