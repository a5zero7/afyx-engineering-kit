#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ROOT="$PACKAGE_ROOT/afyx-forge"
ARTIFACT_STAGER="$PACKAGE_ROOT/scripts/afyx-forge-artifact.mjs"
runtime_root="${AFYX_FORGE_RUNTIME_ROOT:-$HOME/.afyx/forge}"
source_revision=""
update=false; repair=false; verify=false; uninstall=false; validate_only=false

while (($#)); do
  case "$1" in
    --runtime-root) (($# >= 2)) || { printf '%s\n' '--runtime-root requires a value.' >&2; exit 2; }; runtime_root="$2"; shift 2 ;;
    --source-revision) (($# >= 2)) || { printf '%s\n' '--source-revision requires a value.' >&2; exit 2; }; source_revision="$2"; shift 2 ;;
    --update) update=true; shift ;;
    --repair) repair=true; shift ;;
    --verify) verify=true; shift ;;
    --uninstall) uninstall=true; shift ;;
    --validate-only) validate_only=true; shift ;;
    -h|--help) printf '%s\n' 'Usage: install-afyx-forge.sh [--runtime-root PATH] [--source-revision SHA] [--update|--repair|--verify|--uninstall|--validate-only]'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

recovery_root="${runtime_root}.afyx-old"

# Path Safety & Canonical Ownership Validation
case "$runtime_root" in
  /*|[A-Za-z]:/*|[A-Za-z]:\\*) ;;
  *) printf '%s\n' 'Afyx Forge runtime root must be absolute.' >&2; exit 1 ;;
esac

case "$runtime_root" in
  /|[A-Za-z]:/|[A-Za-z]:\\|[A-Za-z]:) printf '%s\n' 'Afyx Forge runtime root cannot be a filesystem root.' >&2; exit 1 ;;
esac

case "$runtime_root" in
  *\.\.*|*\\..\\*|*/../*) printf '%s\n' 'Afyx Forge runtime root must not contain traversal segments.' >&2; exit 1 ;;
esac

normalize_path() {
  local p="$1"
  if [[ -d "$p" ]]; then
    (cd "$p" && pwd)
  else
    local parent
    parent="$(dirname "$p")"
    if [[ -d "$parent" ]]; then
      printf '%s/%s\n' "$(cd "$parent" && pwd)" "$(basename "$p")"
    else
      printf '%s\n' "$p"
    fi
  fi
}

host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s\n' "$1"
  fi
}

CANONICAL_SOURCE="$(normalize_path "$SOURCE_ROOT")"
CANONICAL_RUNTIME="$(normalize_path "$runtime_root")"

case "$CANONICAL_RUNTIME/" in "$CANONICAL_SOURCE/"*) printf '%s\n' 'Afyx Forge runtime root must not overlap bundled source.' >&2; exit 1 ;; esac
case "$CANONICAL_SOURCE/" in "$CANONICAL_RUNTIME/"*) printf '%s\n' 'Afyx Forge runtime root must not contain bundled source.' >&2; exit 1 ;; esac

for candidate in "$runtime_root" "$recovery_root"; do
  probe="$candidate"
  while [[ "$probe" != / && "$probe" != . && -n "$probe" && ! "$probe" =~ ^[A-Za-z]:[/\\]?$ ]]; do
    if [[ "$probe" == "/var" || "$probe" == "/tmp" || "$probe" == "/etc" ]]; then
      break
    fi
    [[ ! -L "$probe" ]] || { printf 'Afyx Forge runtime path must not traverse a symbolic link: %s\n' "$probe" >&2; exit 1; }
    next_probe="$(dirname "$probe")"
    [[ "$next_probe" != "$probe" ]] || break
    probe="$next_probe"
  done
done

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

json_value() {
  sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1
}

resolve_source_revision() {
  if [[ -n "$source_revision" ]]; then
    printf '%s\n' "$source_revision"
    return 0
  fi
  if [[ -f "$PACKAGE_ROOT/.afyx-source-revision" ]]; then
    tr -d '\r\n' < "$PACKAGE_ROOT/.afyx-source-revision"
    printf '\n'
    return 0
  fi
  if [[ -e "$PACKAGE_ROOT/.git" ]] && command -v git >/dev/null 2>&1; then
    local rev
    rev="$(git -C "$PACKAGE_ROOT" rev-parse HEAD 2>/dev/null || true)"
    if [[ -n "$rev" ]]; then
      printf '%s\n' "$rev"
      return 0
    fi
  fi
  printf '%s\n' 'unknown'
}

resolve_source_provenance() {
  if [[ -f "$PACKAGE_ROOT/.afyx-source-revision" ]]; then
    printf '%s\n' 'RELEASE_CANDIDATE_SNAPSHOT'
    return 0
  fi
  if [[ -e "$PACKAGE_ROOT/.git" ]] && command -v git >/dev/null 2>&1 && git -C "$PACKAGE_ROOT" rev-parse HEAD >/dev/null 2>&1; then
    local dirty
    dirty="$(git -C "$PACKAGE_ROOT" status --porcelain -- afyx-forge 2>/dev/null || true)"
    if [[ -n "$dirty" ]]; then
      printf '%s\n' 'LOCAL_SOURCE_DIRTY'
    else
      printf '%s\n' 'LOCAL_SOURCE_CLEAN'
    fi
    return 0
  fi
  printf '%s\n' 'LOCAL_SOURCE_UNVERIFIED'
}

owned_runtime() {
  local root="$1" metadata="$1/metadata.json"
  [[ -f "$metadata" ]] || return 1
  grep -q '"product_name"[[:space:]]*:[[:space:]]*"Afyx Forge Core"' "$metadata" || return 1
  grep -q '"ownership_class"[[:space:]]*:[[:space:]]*"AFYX"' "$metadata" || return 1
  return 0
}

healthy_runtime() {
  local root="$1" metadata="$1/metadata.json" manifest="$1/integrity.sha256" identity="$1/current/identity.json"
  local expected relative actual field line
  owned_runtime "$root" || return 1
  [[ -f "$root/current/bin/afyx-forge.js" && -f "$root/current/bin/afyx-forge" && -f "$root/current/LICENSE" ]] || return 1
  [[ -f "$root/bin/afyx-forge" && -f "$identity" && -f "$manifest" ]] || return 1
  for field in product_name product_version source_revision ownership_class build_provenance release_channel runtime_mode governance_state; do
    [[ "$(json_value "$metadata" "$field")" == "$(json_value "$identity" "$field")" ]] || return 1
  done
  expected="$(json_value "$metadata" "artifact_digest")"
  [[ ${#expected} -eq 64 && "$(sha256_file "$manifest")" == "$expected" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -n "$line" ]] || continue
    expected="${line%%  *}"
    relative="${line#*  }"
    [[ "$expected" =~ ^[0-9a-f]{64}$ && "$relative" == current/* && "$relative" != *../* ]] || return 1
    [[ -f "$root/$relative" && ! -L "$root/$relative" ]] || return 1
    actual="$(sha256_file "$root/$relative")"
    [[ "$actual" == "$expected" ]] || return 1
  done < "$manifest"
  return 0
}

# Transaction Recovery Check
if [[ -e "$recovery_root" ]]; then
  [[ ! -e "$runtime_root" ]] || { printf '%s\n' 'Interrupted Afyx Forge transaction is ambiguous; runtime and recovery both exist.' >&2; exit 1; }
  owned_runtime "$recovery_root" || { printf '%s\n' 'Interrupted Afyx Forge recovery ownership is invalid.' >&2; exit 1; }
  if "$validate_only" || "$verify" || "$uninstall"; then printf '%s\n' 'Afyx Forge recovery is pending; read-only/uninstall operation will not mutate it.' >&2; exit 1; fi
  mv -- "$recovery_root" "$runtime_root"
  printf 'Recovered interrupted Afyx Forge transaction at %s.\n' "$runtime_root"
fi

# Determine Current State
if [[ ! -e "$runtime_root" ]]; then
  state='NOT INSTALLED'
elif healthy_runtime "$runtime_root"; then
  state='HEALTHY'
elif owned_runtime "$runtime_root"; then
  state='BROKEN'
else
  state='UNKNOWN'
fi

if "$validate_only" || "$verify"; then
  rev_out=""
  digest_out=""
  if [[ "$state" == HEALTHY || "$state" == BROKEN ]] && [[ -f "$runtime_root/metadata.json" ]]; then
    rev_out="$(json_value "$runtime_root/metadata.json" "source_revision")"
    digest_out="$(json_value "$runtime_root/metadata.json" "artifact_digest")"
  fi
  printf 'Component: afyx-forge\nState: %s\nRuntimeRoot: %s\nVersion: 0.1.0\nSourceRevision: %s\nArtifactDigest: %s\n' "$state" "$runtime_root" "$rev_out" "$digest_out"
  "$verify" && [[ "$state" != HEALTHY ]] && exit 1
  exit 0
fi

if "$uninstall"; then
  [[ "$state" == 'NOT INSTALLED' ]] && { printf '%s\n' 'Afyx Forge Core is already not installed.'; exit 0; }
  [[ "$state" == HEALTHY || "$state" == BROKEN ]] || { printf 'Refusing to uninstall foreign or unverified directory at %s (state: %s).\n' "$runtime_root" "$state" >&2; exit 1; }
  rm -rf -- "$runtime_root"
  printf 'Afyx Forge Core: uninstalled from %s\n' "$runtime_root"
  exit 0
fi

command -v node >/dev/null 2>&1 || { printf '%s\n' 'Node.js is required for Afyx Forge Core.' >&2; exit 1; }

[[ "$state" != UNKNOWN ]] || { printf 'Refusing to replace foreign or unowned directory at %s.\n' "$runtime_root" >&2; exit 1; }
if [[ "$state" == BROKEN && "$update" != true && "$repair" != true ]]; then
  printf 'Installed Afyx Forge Core at %s is BROKEN (integrity or file drift detected). Use --repair or --update to restore it.\n' "$runtime_root" >&2
  exit 1
fi
[[ "$state" != HEALTHY || "$update" == true || "$repair" == true ]] || { printf 'Afyx Forge Core: already installed and HEALTHY at %s. Use --update or --repair to reinstall.\n' "$runtime_root"; exit 0; }
if [[ "$state" == 'NOT INSTALLED' ]] && { "$update" || "$repair"; }; then
  printf '%s\n' 'Update/repair requires an existing Afyx Forge runtime.' >&2
  exit 1
fi

resolved_revision="$(resolve_source_revision)"
resolved_provenance="$(resolve_source_provenance)"
installed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

parent="$(dirname "$runtime_root")"
mkdir -p -- "$parent"
prepared="$(mktemp -d "$parent/.forge-stage.XXXXXX")"
swapped=false

cleanup() {
  local status=$?
  if [[ -e "$prepared" ]]; then
    rm -rf -- "$prepared" || true
  fi
  return "$status"
}
trap cleanup EXIT

node "$(host_path "$ARTIFACT_STAGER")" \
  --source-root "$(host_path "$SOURCE_ROOT")" \
  --stage-dir "$(host_path "$prepared")" \
  --runtime-root "$(host_path "$CANONICAL_RUNTIME")" \
  --revision "$resolved_revision" \
  --provenance "$resolved_provenance" \
  --installed-at "$installed_at"

# Pre-swap verification
healthy_runtime "$prepared" || { printf '%s\n' 'Staged Afyx Forge runtime failed integrity validation.' >&2; exit 1; }

# Swap with fail-closed recovery
if [[ -e "$runtime_root" ]]; then
  mv -- "$runtime_root" "$recovery_root"
fi

if mv -- "$prepared" "$runtime_root"; then
  swapped=true
  prepared="$parent/.forge-stage-consumed"
else
  [[ ! -e "$recovery_root" ]] || mv -- "$recovery_root" "$runtime_root"
  printf '%s\n' 'Failed to swap staged Afyx Forge runtime into destination.' >&2
  exit 1
fi

# Post-swap verification
if ! healthy_runtime "$runtime_root"; then
  "$swapped" && rm -rf -- "$runtime_root"
  [[ ! -e "$recovery_root" ]] || mv -- "$recovery_root" "$runtime_root"
  printf '%s\n' 'Installed Afyx Forge runtime failed post-swap verification; previous state preserved.' >&2
  exit 1
fi

[[ ! -e "$recovery_root" ]] || rm -rf -- "$recovery_root"

printf 'Afyx Forge Core 0.1.0: successfully installed at %s (revision=%s)\n' "$runtime_root" "$resolved_revision"
exit 0
