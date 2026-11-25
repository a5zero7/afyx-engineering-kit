# Contributing to AFYX Engineering Kit

Develop on `dev`. Use a branch based on `origin/dev` when a change needs
review. Keep `main` for verified releases and follow the release gates before
promotion. Keep one coherent change per commit, with a concise conventional or
bracketed subject and no AI attribution trailers.

## Source and distribution

Contribute original AFYX-native implementations under the applicable AFYX
package license, with `Copyright (c) 2026 Afyx`. The distribution policy
requires zero external runtime dependencies and zero third-party notice files.
Review source ownership before bringing material into the repository. Update the
reviewed SHA-256 entries in `scripts/native-source-ownership.json` when changing
covered production files. Compute the digest from the source with CRLF converted
to LF.

## Verify before pushing

Run `npm test` from the repository root and run the suites relevant to the
change. Run the five repository gates:

```text
node scripts/verify-native-source-ownership.mjs
python scripts/audit-legacy-identity.py
python scripts/validate-afyx-graph.py
python scripts/validate-components.py
pwsh -NoProfile -File ../_afyx-admin/Test-AfyxWorkspaceHygiene.ps1 -RunSelfTests
```

The workspace hygiene command uses the canonical Windows layout described in
the [workspace standard](docs/AFYX_WORKSPACE_STANDARD.md). Check
`git diff --check`, use the normal pre-push hook, and report any platform
checks that could not run. Use disposable fixtures for provider and lifecycle
tests so everyday profiles and workspaces stay isolated.
