#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ROOT="$PACKAGE_ROOT/afyx-context"
ARTIFACT_TOOL="$PACKAGE_ROOT/scripts/afyx-context-artifact.mjs"
runtime_root="${AFYX_CONTEXT_RUNTIME_ROOT:-$HOME/.afyx/context}"
update=false; repair=false; verify=false; uninstall=false; validate_only=false
while (($#)); do
  case "$1" in
    --runtime-root) (($# >= 2)) || { printf '%s\n' '--runtime-root requires a value.' >&2; exit 2; }; runtime_root="$2"; shift 2 ;;
    --update) update=true; shift ;;
    --repair) repair=true; shift ;;
    --verify) verify=true; shift ;;
    --uninstall) uninstall=true; shift ;;
    --validate-only) validate_only=true; shift ;;
    -h|--help) printf '%s\n' 'Usage: install-afyx-context.sh [--runtime-root PATH] [--update|--repair|--verify|--uninstall|--validate-only]'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
recovery_root="${runtime_root}.afyx-old"

case "$runtime_root" in /*) ;; *) printf '%s\n' 'Afyx Context runtime root must be absolute.' >&2; exit 1 ;; esac
[[ "$runtime_root" != / ]] || { printf '%s\n' 'Afyx Context runtime root cannot be /.' >&2; exit 1; }
case "/$runtime_root/" in */../*) printf '%s\n' 'Afyx Context runtime root must not contain traversal segments.' >&2; exit 1 ;; esac
case "$runtime_root/" in "$SOURCE_ROOT/"*) printf '%s\n' 'Afyx Context runtime root must not overlap bundled source.' >&2; exit 1 ;; esac
case "$SOURCE_ROOT/" in "$runtime_root/"*) printf '%s\n' 'Afyx Context runtime root must not contain bundled source.' >&2; exit 1 ;; esac
for candidate in "$runtime_root" "$recovery_root"; do
  probe="$candidate"
  while [[ "$probe" != / && -n "$probe" ]]; do
    [[ ! -L "$probe" ]] || { printf 'Afyx Context runtime path must not traverse a symbolic link: %s\n' "$probe" >&2; exit 1; }
    probe="$(dirname "$probe")"
  done
done

sha256_file() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
json_value() { sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1; }
owned_runtime() {
  local root="$1" allow_modified="${2:-false}" metadata="$1/metadata.json" manifest="$1/integrity.sha256" identity="$1/current/identity.json" expected relative actual field
  [[ -f "$metadata" && -f "$manifest" && -f "$identity" ]] || return 1
  grep -q '"product_name"[[:space:]]*:[[:space:]]*"Afyx Context Engine"' "$metadata" || return 1
  grep -q '"ownership_class"[[:space:]]*:[[:space:]]*"AFYX"' "$metadata" || return 1
  for field in product_name product_version source_revision ownership_class build_provenance release_channel integration_default; do
    [[ "$(json_value "$metadata" "$field")" == "$(json_value "$identity" "$field")" ]] || return 1
  done
  [[ "$allow_modified" == true ]] && return 0
  expected="$(sed -n 's/.*"artifact_digest"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' "$metadata")"
  [[ ${#expected} -eq 64 && "$(sha256_file "$manifest")" == "$expected" ]] || return 1
  while IFS= read -r line; do
    expected="${line%%  *}"; relative="${line#*  }"
    [[ "$expected" =~ ^[0-9a-f]{64}$ && "$relative" == current/* && "$relative" != *../* ]] || return 1
    [[ -f "$root/$relative" && ! -L "$root/$relative" ]] || return 1
    actual="$(sha256_file "$root/$relative")"; [[ "$actual" == "$expected" ]] || return 1
  done < "$manifest"
}

if [[ -e "$recovery_root" ]]; then
  [[ ! -e "$runtime_root" ]] || { printf '%s\n' 'Interrupted Afyx Context transaction is ambiguous; runtime and recovery both exist.' >&2; exit 1; }
  owned_runtime "$recovery_root" || { printf '%s\n' 'Interrupted Afyx Context recovery ownership or integrity is invalid.' >&2; exit 1; }
  if "$validate_only" || "$verify" || "$uninstall"; then printf '%s\n' 'Afyx Context recovery is pending; read-only/uninstall operation will not mutate it.' >&2; exit 1; fi
  mv -- "$recovery_root" "$runtime_root"
  printf 'Recovered interrupted Afyx Context transaction at %s.\n' "$runtime_root"
fi
if [[ ! -e "$runtime_root" ]]; then state='NOT INSTALLED'
elif owned_runtime "$runtime_root"; then state=HEALTHY
elif owned_runtime "$runtime_root" true; then state=DRIFTED
else state=UNKNOWN; fi
if "$validate_only" || "$verify"; then
  printf 'Product: Afyx Context Engine\nState: %s\nRuntimeRoot: %s\n' "$state" "$runtime_root"
  "$verify" && [[ "$state" != HEALTHY ]] && exit 1
  exit 0
fi
if "$uninstall"; then
  [[ "$state" == 'NOT INSTALLED' ]] && { printf '%s\n' 'Afyx Context Engine is not installed.'; exit 0; }
  [[ "$state" == HEALTHY ]] || { printf 'Refusing to uninstall Afyx Context runtime with state %s.\n' "$state" >&2; exit 1; }
  rm -rf -- "$runtime_root"
  printf '%s\n' 'Afyx Context runtime removed; user state was not changed.'
  exit 0
fi
command -v node >/dev/null 2>&1 || { printf '%s\n' 'Node.js >=22.5.0 is required for Afyx Context.' >&2; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=5)?0:1)' || { printf 'Node.js >=22.5.0 is required; found %s.\n' "$(node --version)" >&2; exit 1; }
[[ "$state" != UNKNOWN ]] || { printf '%s\n' 'Refusing to replace foreign or unverified Afyx Context destination.' >&2; exit 1; }
[[ "$state" != DRIFTED || "$repair" == true ]] || { printf '%s\n' 'Modified Afyx Context runtime requires explicit repair.' >&2; exit 1; }
[[ "$state" != HEALTHY || "$update" == true || "$repair" == true ]] || { printf '%s\n' 'Afyx Context runtime is already healthy; unchanged.'; exit 0; }
if [[ "$state" == 'NOT INSTALLED' ]] && { "$update" || "$repair"; }; then
  printf '%s\n' 'Update/repair requires an existing Afyx Context runtime.' >&2
  exit 1
fi
revision="$(git -C "$PACKAGE_ROOT" rev-parse HEAD 2>/dev/null || true)"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { printf '%s\n' 'Exact Git source revision is required to install Afyx Context.' >&2; exit 1; }
provenance=LOCAL_SOURCE_CLEAN; [[ -n "$(git -C "$PACKAGE_ROOT" status --porcelain --untracked-files=no)" ]] && provenance=LOCAL_SOURCE_DIRTY
parent="$(dirname "$runtime_root")"; mkdir -p -- "$parent"
prepared="$(mktemp -d "$parent/.afyx-context-stage.XXXXXX")"; swapped=false
cleanup() {
  local status=$?
  if [[ -e "$prepared" ]]; then
    rm -rf -- "$prepared" || return $?
  fi
  return "$status"
}
trap cleanup EXIT
node "$ARTIFACT_TOOL" prepare --source "$SOURCE_ROOT" --target "$prepared/current" --metadata "$prepared/metadata.json" --manifest "$prepared/integrity.sha256" --revision "$revision" --provenance "$provenance"
owned_runtime "$prepared" || { printf '%s\n' 'Prepared Afyx Context artifact failed integrity validation.' >&2; exit 1; }
if [[ "$state" == HEALTHY ]]; then
  old_digest="$(sed -n 's/.*"artifact_digest"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' "$runtime_root/metadata.json")"
  new_digest="$(sed -n 's/.*"artifact_digest"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' "$prepared/metadata.json")"
  [[ "$old_digest" != "$new_digest" ]] || { printf '%s\n' 'Afyx Context runtime already matches the candidate; unchanged.'; exit 0; }
fi
[[ ! -e "$runtime_root" ]] || mv -- "$runtime_root" "$recovery_root"
if mv -- "$prepared" "$runtime_root"; then swapped=true; prepared="$parent/.afyx-context-stage-consumed"
else [[ ! -e "$recovery_root" ]] || mv -- "$recovery_root" "$runtime_root"; exit 1; fi
if ! owned_runtime "$runtime_root"; then
  "$swapped" && rm -rf -- "$runtime_root"
  [[ ! -e "$recovery_root" ]] || mv -- "$recovery_root" "$runtime_root"
  printf '%s\n' 'Installed Afyx Context runtime failed post-swap verification.' >&2; exit 1
fi
[[ ! -e "$recovery_root" ]] || rm -rf -- "$recovery_root"
printf 'Afyx Context Engine installed at %s; source revision %s; PATH and user state unchanged.\n' "$runtime_root" "$revision"
