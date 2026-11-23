# Security Policy

AFYX Engineering Kit is an open-source, local-first engineering toolkit designed for AI-assisted software engineering. Security and integrity are central design tenets. This document details the threat model, security boundaries, vulnerability reporting procedure, and best practices for safe operation.

---

## Supported Versions

During the Technical Alpha phase, only the latest published Alpha release and the active `dev` branch receive security patches and vulnerability evaluations.

| Version | Status | Supported |
|---|---|---|
| `0.1.0-alpha.*` (latest) | Technical Alpha | Yes |
| Historical Alpha (< latest) | Superseded | No (upgrade required) |
| `< 0.1.0` | Prototype / Pre-Alpha | No |

---

## Reporting a Vulnerability

We take vulnerabilities seriously. If you discover a security flaw, unauthorized privilege escalation, path traversal, injection vulnerability, or credential leak in AFYX Engineering Kit:

1. **Do not disclose publicly:** Do not open a public issue, discussion, or pull request on GitHub.
2. **Contact:** Report via GitHub Private Vulnerability Reporting at:
   `https://github.com/a5zero7/afyx-engineering-kit/security/advisories/new`
   or contact the repository maintainers through the official security contact mechanism designated on the repository homepage.
3. **Include details:**
   - Affected component(s) and version.
   - Operating system and shell environment.
   - Minimal proof-of-concept (PoC) or reproduction steps.
   - Potential impact and threat assessment.
4. **Response time:** The maintainers will acknowledge receipt within 48 hours and coordinate remediation before public disclosure.

---

## Threat Model and Trust Boundaries

### 1. Model Context Protocol (MCP) Boundaries

- **Local-first execution:** AFYX Graph provides an optional stdio MCP server (`afyx_graph`) that executes locally on the operator's machine.
- **Untrusted MCP Servers:** AFYX components interact only with explicitly configured, authorized MCP servers. The toolkit enforces strict schema validation and will never execute foreign binaries or connect to unregistered network endpoints on behalf of unauthenticated third parties.
- **Prompt Injection Defense:** MCP tool outputs (graph exploration, file contents, symbols, call paths) return repository data that may originate from untrusted repositories. Agents consuming AFYX tool outputs must treat returned source code and docstrings as passive data, never as higher-priority system instructions.

### 2. Credential and Provider Authentication Boundaries

- **Zero credential custody:** AFYX does not broker, intercept, store, or transmit API keys, tokens, or credentials for AI coding hosts (Anthropic Claude Code, OpenAI Codex, Google Antigravity).
- **Independent provider state:** The installer and updater never mutate provider-private state, credentials, or session history. Provider configuration merges only AFYX-owned entries into host configuration files (`~/.claude.json`, `<workspace>/.mcp.json`, `mcp_config.json`, etc.) while strictly preserving unrelated entries.
- **Environment isolation:** AFYX does not read or expose host environment variables containing secrets or private tokens unless explicitly provided through designated configuration arguments.

### 3. File System & Path Traversal Security

- **Path containment:** All archive extraction routines, path sanitizers, and installer scripts validate that target paths remain strictly inside intended installation roots.
- **Reparse points and symlinks:** Archive extraction rejects directory traversal sequences (`..`), absolute paths, and Windows junction/reparse points or Unix symlinks that could escape designated directories.
- **Transactional modifications:** Configuration and skill file updates perform pre-modification backups and atomic writes (`atomicJson` / transactional swap) to prevent partial writes or corruption upon unexpected interruption.

### 4. Package & Archive Provenance

- **Precompiled archive verification:** All precompiled Graph binaries are validated against an authoritative `RELEASE-MANIFEST.json` and `SHA256SUMS`.
- **Integrity verification:** Checksums are computed and verified before extraction. Corrupted, truncated, or tampered archives trigger immediate fail-closed aborts without executing fallback compilations or executing untrusted code.
- **Deterministic source revision stamping:** Every official release candidate contains a validated `.afyx-source-revision` matching the exact Git commit from which it was built.

### 5. Package Lifecycle Scripts

- **No arbitrary postinstall execution:** The npm package does not execute invasive postinstall scripts that modify system PATH, install daemons, or mutate user files without explicit invocation.
- **Explicit user command:** Installation and updates execute only when the operator explicitly invokes `npx afyx-engineering-kit install` or related CLI commands.

---

## Operational Recommendations (Least Privilege)

1. **Run with least privilege:** Do not run AFYX installers, CLI commands, or MCP servers as `Administrator` (Windows) or `root` (Linux/macOS). User-level permissions are sufficient.
2. **Review repository sources:** When indexing third-party repositories with AFYX Graph, be aware that static analysis reads repository files. Ensure repositories from untrusted sources do not contain malicious executable files or exploit payloads.
3. **Review provider scopes:** Prefer workspace-scoped MCP configuration (`<workspace>/.mcp.json` or `.agents/mcp_config.json`) when working on isolated repositories to minimize the surface area of global host configuration.
4. **Keep runtimes updated:** Ensure Node.js is kept up to date with the latest LTS security releases.
