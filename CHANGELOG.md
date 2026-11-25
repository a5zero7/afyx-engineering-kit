# Changelog

## [Unreleased] — v1.1.0

- Opened the v1.1.0 development cycle on `dev` from `977b7af`.
- Archived completed engineering reports and added contributor verification
  and release-branch guidance.

## [1.0.2] — 2026-11-24

- Completed the release's AFYX-native Graph and UI rewrites. The distribution
  uses Afyx copyright, ships zero third-party notice files, and has zero external
  runtime dependencies.
- Expanded security auditor coverage for embedded credentials, unsafe YAML
  loading, interpolated SQL, and configuration secrets. Graph extraction now
  reports duplicate and out-of-root symlinks in index accounting.
- Changed `--purge-backups` to remove all completed, verified AFYX backups in
  scope. Added `--prune-backups` to retain the five newest per selected skill.
  Both preserve active rollback and foreign backups.
- Published from `bcfeae9`. Follow-up baseline `977b7af` completed six
  successful `dev` workflows, including CI on Windows, Linux, and macOS.

## [1.0.1] — 2026-11-24

- Published a Stable npm patch for the Kit.
- Fixed macOS terminal installer selection for extension-only providers and
  Bash 3.2 empty-array handling. Aligned version reporting and uninstall options.

## [1.0.0] — 2026-11-24

- Published the initial Stable npm release for the AFYX Engineering Kit,
  with the shared installer, updater, verifier, and uninstaller.
