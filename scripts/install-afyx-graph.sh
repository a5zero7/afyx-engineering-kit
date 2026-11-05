#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
METADATA="$PACKAGE_ROOT/afyx-graph/afyx-graph.json"
DISTRIBUTION_PRODUCT="$PACKAGE_ROOT/afyx-graph/engine/scripts/distribution-product.json"
ARTIFACT_IDENTITY="$PACKAGE_ROOT/scripts/afyx-graph-artifact.mjs"
RELEASE_ROOT="${AFYX_GRAPH_RELEASE_ROOT:-$PACKAGE_ROOT/afyx-graph/engine/release}"
RUNTIME_ROOT="${AFYX_GRAPH_RUNTIME_ROOT:-$HOME/.afyx/graph}"
RECOVERY_ROOT="${RUNTIME_ROOT}.afyx-old"
BIN_DIR="${AFYX_GRAPH_BIN_DIR:-$HOME/.local/bin}"
mode=install
archive_path=
offline=false
no_build_fallback=false
allow_dirty_source=false
configure_mcp=false
skip_mcp=false
artifact_source=
source_revision=
requested_revision=UNKNOWN
artifact_revision=UNKNOWN
artifact_revision_status=UNKNOWN

usage() {
  printf '%s\n' 'Usage: scripts/install-afyx-graph.sh [--replace|--update|--validate-only|--uninstall] [--archive PATH] [--offline] [--no-build-fallback] [--allow-dirty-source] [--configure-mcp|--skip-mcp]'
}

while (($#)); do
  case "$1" in
    --replace) mode=replace; shift ;;
    --update) mode=update; shift ;;
    --validate-only) mode=validate; shift ;;
    --uninstall) mode=uninstall; shift ;;
    --archive) archive_path="$2"; shift 2 ;;
    --offline) offline=true; shift ;;
    --no-build-fallback) no_build_fallback=true; shift ;;
    --allow-dirty-source) allow_dirty_source=true; shift ;;
    --configure-mcp) configure_mcp=true; shift ;;
    --skip-mcp) skip_mcp=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

json_value() {
  sed -n 's/^[[:space:]]*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$METADATA" | head -n 1
}

VERSION="$(json_value product_version)"
CHANNEL="$(sed -n 's/^[[:space:]]*"releaseChannel"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$DISTRIBUTION_PRODUCT" | head -n 1)"
if command -v git >/dev/null 2>&1 && git -C "$PACKAGE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  requested_revision="$(git -C "$PACKAGE_ROOT" rev-parse HEAD 2>/dev/null || printf UNKNOWN)"
fi

node_version() {
  command -v node >/dev/null 2>&1 || return 1
  node --version 2>/dev/null | sed -n 's/^v\{0,1\}\([0-9][0-9.]*\).*/\1/p'
}

node_compatible() {
  local version major minor
  version="$(node_version)" || return 1
  major="${version%%.*}"; version="${version#*.}"; minor="${version%%.*}"
  [[ "$major" -gt 22 || ("$major" -eq 22 && "$minor" -ge 5) ]]
}

require_host_runtime() {
  local version
  version="$(node_version 2>/dev/null || true)"
  if [[ -z "$version" ]]; then
    printf 'REQUIRED: Node.js was not found on PATH. Afyx Graph requires Node.js 22.5.0 or newer. Install it from https://nodejs.org/ and retry.\n' >&2
    return 1
  fi
  if ! node_compatible; then
    printf 'REQUIRED: Node.js %s is incompatible. Afyx Graph requires Node.js 22.5.0 or newer.\n' "$version" >&2
    return 1
  fi
}

build_local_archive() {
  "$no_build_fallback" && { printf 'COMPONENT_REQUIRED: no matching verified release artifact is available and local build fallback was disabled.\n' >&2; return 1; }
  require_host_runtime
  command -v npm >/dev/null 2>&1 || { printf 'BUILD_ONLY: npm was not found on PATH. It is required only because no verified release artifact was available.\n' >&2; return 1; }
  command -v git >/dev/null 2>&1 || { printf 'BUILD_ONLY: Git is required to validate the local source revision.\n' >&2; return 1; }
  git -C "$PACKAGE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { printf 'BUILD_ONLY: local fallback requires a validated Git checkout.\n' >&2; return 1; }
  source_revision="$(git -C "$PACKAGE_ROOT" rev-parse HEAD)"
  local branch dirty engine release
  branch="$(git -C "$PACKAGE_ROOT" branch --show-current)"
  dirty="$(git -C "$PACKAGE_ROOT" status --porcelain)"
  if [[ -n "$dirty" && "$allow_dirty_source" != true ]]; then
    printf 'BUILD_ONLY: local source has uncommitted changes. Refusing to build an unverifiable Technical Alpha artifact; commit the changes or explicitly use --allow-dirty-source.\n' >&2
    return 1
  fi
  engine="$PACKAGE_ROOT/afyx-graph/engine"
  [[ -f "$engine/package-lock.json" ]] || { printf 'BUILD_ONLY: afyx-graph/engine/package-lock.json is missing; local source is incomplete.\n' >&2; return 1; }
  printf 'Verified release unavailable; building Afyx Graph locally from %s on %s.\n' "$source_revision" "$branch"
  (cd "$engine" && npm ci && npm run build:clean && AFYX_SOURCE_REVISION="$source_revision" bash scripts/build-bundle.sh "$target") || {
    printf 'BUILD_ONLY: Afyx Graph local build failed; the existing installation was not changed.\n' >&2
    return 1
  }
  release="$RELEASE_ROOT"
  archive_path="$release/$asset"
  [[ -f "$archive_path" ]] || { printf 'BUILD_ONLY: local build did not produce %s.\n' "$asset" >&2; return 1; }
  if command -v shasum >/dev/null 2>&1; then
    (cd "$release" && shasum -a 256 "$asset" > SHA256SUMS)
  else
    (cd "$release" && sha256sum "$asset" > SHA256SUMS)
  fi
  artifact_source=local-build
}

archive_checksum_valid() {
  local path="$1" sums expected actual
  sums="$(dirname "$path")/SHA256SUMS"
  [[ -f "$path" && -f "$sums" ]] || return 1
  expected="$(awk -v asset="$asset" '$2 == asset || $2 == "*" asset { print $1; exit }' "$sums")"
  [[ ${#expected} -eq 64 && "$expected" != *[!0-9a-fA-F]* ]] || return 1
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$path" | awk '{print $1}')"
  else
    actual="$(sha256sum "$path" | awk '{print $1}')"
  fi
  [[ "$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')" ]]
}

archive_bundle_identity_valid() {
  local path="$1" probe bundle
  probe="$(mktemp -d "${TMPDIR:-/tmp}/afyx-graph-probe.XXXXXX")" || return 1
  if ! tar -xzf "$path" -C "$probe" >/dev/null 2>&1; then rm -rf -- "$probe"; return 1; fi
  bundle="$probe/afyx-graph-$target"
  [[ -f "$bundle/bin/afyx-graph" && -f "$bundle/metadata.json" && -f "$bundle/LICENSE" ]] &&
    grep -q '"product_name"[[:space:]]*:[[:space:]]*"Afyx Graph"' "$bundle/metadata.json" &&
    grep -q '"product_version"[[:space:]]*:[[:space:]]*"'"$VERSION"'"' "$bundle/metadata.json" &&
    grep -q '"release_channel"[[:space:]]*:[[:space:]]*"'"$CHANNEL"'"' "$bundle/metadata.json" &&
    grep -q '"'"$target"'"' "$bundle/metadata.json"
  local valid=$?
  rm -rf -- "$probe"
  return "$valid"
}

read_archive_identity() {
  local path="$1" probe bundle json
  probe="$(mktemp -d "${TMPDIR:-/tmp}/afyx-graph-identity.XXXXXX")" || return 1
  if ! tar -xzf "$path" -C "$probe" >/dev/null 2>&1; then rm -rf -- "$probe"; return 1; fi
  bundle="$probe/afyx-graph-$target"
  json="$(node "$ARTIFACT_IDENTITY" inspect --metadata "$bundle/metadata.json" --requested-revision "$requested_revision")" || {
    rm -rf -- "$probe"; return 1;
  }
  artifact_revision="$(printf '%s' "$json" | sed -n 's/.*"sourceRevision":"\([^"]*\)".*/\1/p')"
  artifact_revision_status="$(printf '%s' "$json" | sed -n 's/.*"revisionStatus":"\([^"]*\)".*/\1/p')"
  rm -rf -- "$probe"
}

graph_state() {
  if [[ ! -e "$RUNTIME_ROOT" ]]; then printf '%s' 'NOT INSTALLED'; return; fi
  if [[ ! -f "$RUNTIME_ROOT/metadata.json" || ! -x "$RUNTIME_ROOT/current/bin/afyx-graph" ]]; then
    printf '%s' 'INCOMPLETE'; return
  fi
  if ! grep -q '"product_name"[[:space:]]*:[[:space:]]*"Afyx Graph"' "$RUNTIME_ROOT/metadata.json"; then
    printf '%s' 'INVALID'; return
  fi
  printf '%s' 'HEALTHY'
}

graph_owned_at() {
  local root="$1"
  [[ -f "$root/metadata.json" ]] &&
    grep -q '"product_name"[[:space:]]*:[[:space:]]*"Afyx Graph"' "$root/metadata.json"
}

graph_owned() { graph_owned_at "$RUNTIME_ROOT"; }

if [[ -e "$RECOVERY_ROOT" ]]; then
  if [[ -e "$RUNTIME_ROOT" ]]; then
    printf 'Interrupted Graph transaction is ambiguous: both %s and %s exist. Refusing to modify either path.\n' "$RUNTIME_ROOT" "$RECOVERY_ROOT" >&2
    exit 1
  fi
  if [[ "$mode" == validate || "$mode" == uninstall ]]; then
    printf 'Interrupted Graph transaction found at %s. Retry the original install/update operation to restore it before validation or removal.\n' "$RECOVERY_ROOT" >&2
    exit 1
  fi
  graph_owned_at "$RECOVERY_ROOT" || {
    printf 'Refusing to restore %s because Afyx Graph ownership cannot be verified.\n' "$RECOVERY_ROOT" >&2
    exit 1
  }
  mv "$RECOVERY_ROOT" "$RUNTIME_ROOT"
  printf 'Recovered interrupted Afyx Graph transaction at %s.\n' "$RUNTIME_ROOT"
fi

state="$(graph_state)"
if [[ "$mode" == validate ]]; then
  installed_revision=
  installed_extraction=
  installed_provenance=
  installed_manifest_status=
  installed_publisher_authenticity=
  installed_build_provenance=
  installed_revision_status=
  if [[ -f "$RUNTIME_ROOT/metadata.json" ]]; then
    installed_revision="$(sed -n 's/.*"source_revision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RUNTIME_ROOT/metadata.json" | head -n 1)"
    installed_extraction="$(sed -n 's/.*"extraction_version"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$RUNTIME_ROOT/metadata.json" | head -n 1)"
    installed_provenance="$(sed -n 's/.*"artifact_provenance"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RUNTIME_ROOT/metadata.json" | head -n 1)"
    installed_manifest_status="$(sed -n 's/.*"release_manifest_status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RUNTIME_ROOT/metadata.json" | head -n 1)"
    installed_publisher_authenticity="$(sed -n 's/.*"publisher_authenticity"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RUNTIME_ROOT/metadata.json" | head -n 1)"
    installed_build_provenance="$(sed -n 's/.*"build_provenance"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RUNTIME_ROOT/metadata.json" | head -n 1)"
    installed_revision_status="$(sed -n 's/.*"revision_status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RUNTIME_ROOT/metadata.json" | head -n 1)"
  fi
  if [[ -n "$installed_revision" && "$requested_revision" != UNKNOWN ]]; then
    if [[ "$installed_revision" == "$requested_revision" ]]; then installed_revision_status=MATCH; else installed_revision_status=REVISION_MISMATCH; fi
  else installed_revision_status=UNKNOWN; fi
  printf 'Product: Afyx Graph\nState: %s\nRuntimeRoot: %s\nVersion: %s\nSourceRevision: %s\nExtractionVersion: %s\nProvenance: %s\nReleaseManifestStatus: %s\nPublisherAuthenticity: %s\nBuildProvenance: %s\nCurrentCheckoutRevision: %s\nRevisionStatus: %s\nUpdateAvailable: %s\n' "$state" "$RUNTIME_ROOT" "$VERSION" "${installed_revision:-UNKNOWN}" "${installed_extraction:-UNKNOWN}" "${installed_provenance:-UNKNOWN}" "${installed_manifest_status:-MISSING}" "${installed_publisher_authenticity:-UNVERIFIED}" "${installed_build_provenance:-UNVERIFIED}" "$requested_revision" "$installed_revision_status" "$([[ "$installed_revision_status" == REVISION_MISMATCH ]] && printf true || printf false)"
  if [[ "$installed_revision_status" == REVISION_MISMATCH ]]; then printf 'UPDATE AVAILABLE — REVISION MISMATCH\n'; fi
  [[ "$state" != INCOMPLETE && "$state" != INVALID ]]
  exit $?
fi

if [[ "$mode" == uninstall ]]; then
  if [[ "$state" == 'NOT INSTALLED' ]]; then printf 'Afyx Graph: not installed\n'; exit 0; fi
  graph_owned || { printf 'Refusing to remove %s because Afyx Graph ownership cannot be verified.\n' "$RUNTIME_ROOT" >&2; exit 1; }
  rm -rf -- "$RUNTIME_ROOT"
  if [[ -L "$BIN_DIR/afyx-graph" ]]; then
    link_target="$(readlink "$BIN_DIR/afyx-graph")"
    case "$link_target" in "$RUNTIME_ROOT"/*) rm -f -- "$BIN_DIR/afyx-graph" ;; esac
  fi
  printf 'Afyx Graph: removed; project .afyx-graph indexes were not changed.\n'
  exit 0
fi

if [[ "$state" != 'NOT INSTALLED' && "$mode" == install ]]; then
  printf 'Afyx Graph already exists at %s. Use --replace after inspecting it.\n' "$RUNTIME_ROOT" >&2
  exit 1
fi
if [[ "$state" != 'NOT INSTALLED' ]] && ! graph_owned; then
  printf 'Refusing to replace %s because Afyx Graph ownership cannot be verified.\n' "$RUNTIME_ROOT" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) printf 'Unsupported operating system: %s\n' "$(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac
target="$os-$arch"
asset="afyx-graph-$target.tar.gz"

require_host_runtime

parent="$(dirname "$RUNTIME_ROOT")"
mkdir -p "$parent"
transaction="$(mktemp -d "$parent/.graph-stage.XXXXXX")"
backup="$RECOVERY_ROOT"
cleanup() { rm -rf -- "$transaction"; }
trap cleanup EXIT

if [[ -z "$archive_path" ]]; then
  local_archive="$RELEASE_ROOT/$asset"
  if [[ -f "$local_archive" ]]; then
    if archive_checksum_valid "$local_archive" && archive_bundle_identity_valid "$local_archive" && read_archive_identity "$local_archive"; then
      if [[ "$requested_revision" != UNKNOWN && "$artifact_revision_status" != MATCH ]]; then
        printf 'Ignoring valid but stale local release cache (requested %s; artifact %s); rebuilding from validated source.\n' "$requested_revision" "$artifact_revision" >&2
        build_local_archive
      else
        archive_path="$local_archive"
        artifact_source=local-release-cache
        source_revision="$artifact_revision"
      fi
    else
      printf 'Ignoring invalid local release cache; rebuilding from validated source.\n' >&2
      build_local_archive
    fi
  else
    if [[ "$offline" != true ]] && command -v curl >/dev/null 2>&1; then
      archive_path="$transaction/$asset"
      url="https://github.com/a5zero7/afyx-codex-engineering-kit/releases/download/afyx-graph-v$VERSION/$asset"
      if curl -fsSL "$url" -o "$archive_path" &&
         curl -fsSL "https://github.com/a5zero7/afyx-codex-engineering-kit/releases/download/afyx-graph-v$VERSION/SHA256SUMS" -o "$transaction/SHA256SUMS" &&
         curl -fsSL "https://github.com/a5zero7/afyx-codex-engineering-kit/releases/download/afyx-graph-v$VERSION/RELEASE-MANIFEST.json" -o "$transaction/RELEASE-MANIFEST.json"; then
        artifact_source=github-release
        if ! archive_checksum_valid "$archive_path" || ! archive_bundle_identity_valid "$archive_path" || ! read_archive_identity "$archive_path"; then
          printf 'Downloaded release artifact failed integrity or identity validation; trying bounded local build fallback.\n' >&2
          rm -f -- "$archive_path" "$transaction/SHA256SUMS" "$transaction/RELEASE-MANIFEST.json"
          build_local_archive
        elif [[ "$requested_revision" != UNKNOWN && "$artifact_revision_status" != MATCH ]]; then
          printf 'Downloaded release revision %s does not match requested checkout %s; trying bounded local build fallback.\n' "$artifact_revision" "$requested_revision" >&2
          rm -f -- "$archive_path" "$transaction/SHA256SUMS" "$transaction/RELEASE-MANIFEST.json"
          build_local_archive
        else
          source_revision="$artifact_revision"
        fi
      else
        printf 'Verified GitHub release unavailable; trying bounded local build fallback.\n' >&2
        rm -f -- "$archive_path" "$transaction/SHA256SUMS" "$transaction/RELEASE-MANIFEST.json"
        archive_path=
        build_local_archive
      fi
    else
      [[ "$offline" == true ]] && printf 'Offline mode: skipping GitHub release lookup.\n'
      [[ "$offline" != true ]] && printf 'COMPONENT_REQUIRED: curl is unavailable; trying bounded local build fallback.\n' >&2
      build_local_archive
    fi
  fi
else
  artifact_source=explicit-archive
fi
[[ -f "$archive_path" ]] || { printf 'Archive not found: %s\n' "$archive_path" >&2; exit 1; }
sums="$(dirname "$archive_path")/SHA256SUMS"
[[ -f "$sums" ]] || { printf 'SHA256SUMS is required beside %s\n' "$archive_path" >&2; exit 1; }
expected="$(awk -v asset="$asset" '$2 == asset || $2 == "*" asset { print $1; exit }' "$sums")"
[[ ${#expected} -eq 64 && "$expected" != *[!0-9a-fA-F]* ]] || { printf 'No valid SHA256SUMS entry for %s\n' "$asset" >&2; exit 1; }
if command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$archive_path" | awk '{print $1}')"; else actual="$(sha256sum "$archive_path" | awk '{print $1}')"; fi
actual_lower="$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')"
expected_lower="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
[[ "$actual_lower" == "$expected_lower" ]] || { printf 'Checksum mismatch for %s\n' "$asset" >&2; exit 1; }

mkdir -p "$transaction/extract" "$transaction/prepared"
tar -xzf "$archive_path" -C "$transaction/extract"
bundle="$transaction/extract/afyx-graph-$target"
for required in bin/afyx-graph metadata.json LICENSE; do
  [[ -f "$bundle/$required" ]] || { printf 'Staged Afyx Graph bundle is incomplete: %s\n' "$required" >&2; exit 1; }
done
grep -q '"product_version"[[:space:]]*:[[:space:]]*"'"$VERSION"'"' "$bundle/metadata.json" || {
  printf 'Staged Afyx Graph version does not match metadata.\n' >&2; exit 1;
}
grep -q '"product_name"[[:space:]]*:[[:space:]]*"Afyx Graph"' "$bundle/metadata.json" || { printf 'Staged Afyx Graph identity is invalid.\n' >&2; exit 1; }
grep -q '"release_channel"[[:space:]]*:[[:space:]]*"'"$CHANNEL"'"' "$bundle/metadata.json" || { printf 'Staged Afyx Graph release channel is invalid.\n' >&2; exit 1; }
grep -q '"'"$target"'"' "$bundle/metadata.json" || { printf 'Staged Afyx Graph does not support %s.\n' "$target" >&2; exit 1; }
node "$PACKAGE_ROOT/afyx-graph/engine/scripts/distribution-contract.mjs" verify-bundle --root "$bundle" --target "$target" >/dev/null || {
  printf 'Afyx Graph staged bundle failed the distribution contract.\n' >&2
  exit 1
}
identity_json="$(node "$ARTIFACT_IDENTITY" inspect --metadata "$bundle/metadata.json" --requested-revision "$requested_revision")"
identity_extraction="$(printf '%s' "$identity_json" | sed -n 's/.*"extractionVersion":\([0-9][0-9]*\).*/\1/p')"
if [[ -n "$identity_extraction" ]]; then
  compiled_extraction="$(node -e 'process.stdout.write(String(require(process.argv[1]).EXTRACTION_VERSION))' "$bundle/lib/dist/extraction/extraction-version.js")"
  [[ "$compiled_extraction" == "$identity_extraction" ]] || { printf 'Installed artifact extraction identity mismatch: metadata %s, compiled runtime %s.\n' "$identity_extraction" "$compiled_extraction" >&2; exit 1; }
fi
release_manifest="$(dirname "$archive_path")/RELEASE-MANIFEST.json"
manifest_status=MISSING
publisher_authenticity=UNVERIFIED
build_provenance=UNVERIFIED
if [[ -f "$release_manifest" ]]; then
  node "$ARTIFACT_IDENTITY" verify-release-manifest --manifest "$release_manifest" --archive "$archive_path" --metadata "$bundle/metadata.json" >/dev/null || {
    printf 'Release manifest verification failed.\n' >&2; exit 1;
  }
  manifest_status=VERIFIED
  build_provenance=COMMIT_BOUND_MANIFEST
elif [[ "$artifact_source" == github-release ]]; then
  printf 'GitHub release is missing RELEASE-MANIFEST.json.\n' >&2
  exit 1
fi
if [[ "$artifact_source" == github-release ]] && command -v gh >/dev/null 2>&1; then
  gh attestation verify "$archive_path" --repo a5zero7/afyx-codex-engineering-kit >/dev/null 2>&1 || {
    printf 'GitHub publisher/build attestation verification failed.\n' >&2; exit 1;
  }
  publisher_authenticity=GITHUB_ATTESTED
  build_provenance=GITHUB_ATTESTED
fi
node "$ARTIFACT_IDENTITY" record-install --metadata "$bundle/metadata.json" --archive "$archive_path" --provenance "$artifact_source" --requested-revision "$requested_revision" --release-manifest-status "$manifest_status" --publisher-authenticity "$publisher_authenticity" --build-provenance "$build_provenance" >/dev/null
mv "$bundle" "$transaction/prepared/current"
cp "$transaction/prepared/current/metadata.json" "$transaction/prepared/metadata.json"

had_existing=false
if [[ -e "$RUNTIME_ROOT" ]]; then mv "$RUNTIME_ROOT" "$backup"; had_existing=true; fi
if ! mv "$transaction/prepared" "$RUNTIME_ROOT"; then
  "$had_existing" && mv "$backup" "$RUNTIME_ROOT"
  exit 1
fi
if [[ "$(graph_state)" != HEALTHY ]]; then
  rm -rf -- "$RUNTIME_ROOT"
  "$had_existing" && mv "$backup" "$RUNTIME_ROOT"
  printf 'Installed Afyx Graph failed post-swap validation; previous runtime restored.\n' >&2
  exit 1
fi
if ! version_output="$($RUNTIME_ROOT/current/bin/afyx-graph --version 2>&1)" || [[ "$version_output" != *"$VERSION"* ]]; then
  rm -rf -- "$RUNTIME_ROOT"
  "$had_existing" && mv "$backup" "$RUNTIME_ROOT"
  printf 'Installed Afyx Graph CLI verification failed: %s\n' "$version_output" >&2
  exit 1
fi
if ! "$RUNTIME_ROOT/current/bin/afyx-graph" help >/dev/null 2>&1; then
  rm -rf -- "$RUNTIME_ROOT"
  "$had_existing" && mv "$backup" "$RUNTIME_ROOT"
  printf 'Installed Afyx Graph help command failed; previous runtime restored.\n' >&2
  exit 1
fi
"$had_existing" && rm -rf -- "$backup"

mkdir -p "$BIN_DIR"
destination="$BIN_DIR/afyx-graph"
if [[ -e "$destination" && ! -L "$destination" ]]; then
  printf 'Existing afyx-graph executable left untouched at %s\n' "$destination"
elif [[ -L "$destination" ]]; then
  link_target="$(readlink "$destination")"
  case "$link_target" in
    "$RUNTIME_ROOT"/*) ln -sfn "$RUNTIME_ROOT/current/bin/afyx-graph" "$destination" ;;
    *) printf 'External afyx-graph symlink left untouched at %s\n' "$destination" ;;
  esac
else
  ln -s "$RUNTIME_ROOT/current/bin/afyx-graph" "$destination"
fi

mcp_state=MCP_NOT_CONFIGURED
if "$skip_mcp"; then
  printf 'Afyx Graph MCP: skipped explicitly.\n'
else
  codex_home="${CODEX_HOME:-$HOME/.codex}"
  mcp_args=("$PACKAGE_ROOT/scripts/afyx-mcp-integration.mjs" --node "$(command -v node)" --entry "$RUNTIME_ROOT/current/lib/dist/bin/afyx-graph.js" --codex-home "$codex_home")
  if command -v codex >/dev/null 2>&1; then mcp_args+=(--codex "$(command -v codex)"); fi
  "$configure_mcp" && mcp_args+=(--apply)
  set +e
  mcp_json="$(node "${mcp_args[@]}" 2>/dev/null)"; mcp_exit=$?
  set -e
  mcp_state="$(printf '%s' "$mcp_json" | sed -n 's/.*"mcp":"\([^"]*\)".*/\1/p')"
  mcp_detail="$(printf '%s' "$mcp_json" | sed -n 's/.*"detail":"\([^"]*\)".*/\1/p')"
  [[ -n "$mcp_state" ]] || mcp_state=MCP_BLOCKED
  printf 'Afyx Graph MCP: %s — %s\n' "$mcp_state" "$mcp_detail"
  if [[ "$configure_mcp" != true && "$mcp_state" == MCP_NOT_CONFIGURED ]]; then
    printf 'Registration available: rerun the selected Graph lifecycle with --configure-mcp (or use the main installer selection).\n'
  fi
  : "$mcp_exit"
fi

printf 'Afyx Graph %s [%s]: installed at %s\nArtifact source: %s; source revision: %s\nCLI: %s/afyx-graph\n' "$VERSION" "$CHANNEL" "$RUNTIME_ROOT" "$artifact_source" "${source_revision:-UNKNOWN}" "$BIN_DIR"
if "$skip_mcp"; then printf 'MCP configuration was not changed.\n'; fi
