# shellcheck shell=bash
# Canonical component model for the Afyx Codex Engineering Kit (Bash 3.2+).
# The data lives once in scripts/components.json; installer, updater,
# uninstaller, verifier and doctor all ask this library for component state.
# Read-only: nothing here writes, installs, or changes configuration.
#
# Callers set (or accept the defaults for): skills_root, graph_root, codex_home.
# afyx_component_evaluate <id> fills AFYX_STATE / AFYX_DETAIL / AFYX_VERSION /
# AFYX_PATH in the caller's shell (no subshell, so no lost globals).

AFYX_COMPONENTS_JSON="${AFYX_COMPONENTS_JSON:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/components.json}"
skills_root="${skills_root:-${CODEX_SKILLS_ROOT:-$HOME/.agents/skills}}"
graph_root="${graph_root:-${AFYX_GRAPH_RUNTIME_ROOT:-$HOME/.afyx/graph}}"
context_root="${context_root:-${AFYX_CONTEXT_RUNTIME_ROOT:-$HOME/.afyx/context}}"
forge_root="${forge_root:-${AFYX_FORGE_RUNTIME_ROOT:-$HOME/.afyx/forge}}"
codex_home="${codex_home:-${CODEX_HOME:-$HOME/.codex}}"

# One "id" per line, in contract order. The contract is one "key": "value" per line.
afyx_component_ids() {
  sed -n 's/^[[:space:]]*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$AFYX_COMPONENTS_JSON"
}

# afyx_component_field <id> <key> -> value ("" when absent)
afyx_component_field() {
  awk -v id="$1" -v key="$2" '
    /^[[:space:]]*\{[[:space:]]*$/ { inobj = 1; hit = 0; val = ""; next }
    inobj && /^[[:space:]]*\}[,]?[[:space:]]*$/ { if (hit) { print val; exit } inobj = 0; next }
    inobj {
      if ($0 ~ "^[[:space:]]*\"id\"[[:space:]]*:[[:space:]]*\"" id "\"") hit = 1
      if (match($0, "^[[:space:]]*\"" key "\"[[:space:]]*:[[:space:]]*\"[^\"]*\"")) {
        s = substr($0, RSTART, RLENGTH); sub(/^[^:]*:[[:space:]]*"/, "", s); sub(/"$/, "", s); val = s
      }
    }
  ' "$AFYX_COMPONENTS_JSON"
}

afyx_provider_ids() {
  sed -n 's/^[[:space:]]*"provider"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$AFYX_COMPONENTS_JSON"
}

afyx_provider_field() {
  awk -v provider="$1" -v key="$2" '
    /^[[:space:]]*\{[[:space:]]*$/ { inobj = 1; hit = 0; val = ""; next }
    inobj && /^[[:space:]]*\}[,]?[[:space:]]*$/ { if (hit) { print val; exit } inobj = 0; next }
    inobj {
      if ($0 ~ "^[[:space:]]*\"provider\"[[:space:]]*:[[:space:]]*\"" provider "\"") hit = 1
      if (match($0, "^[[:space:]]*\"" key "\"[[:space:]]*:[[:space:]]*\"[^\"]*\"")) {
        s = substr($0, RSTART, RLENGTH); sub(/^[^:]*:[[:space:]]*"/, "", s); sub(/"$/, "", s); val = s
      }
    }
  ' "$AFYX_COMPONENTS_JSON"
}

afyx_preset_valid() {
  case "$1" in minimal|recommended|full|custom) return 0 ;; *) return 1 ;; esac
}

afyx_component_desired() {
  local id="$1" preset="$2" custom="${3:-}" providers="${4:-codex}" memberships restriction provider
  afyx_preset_valid "$preset" || return 2
  if [[ "$preset" == custom ]]; then
    case ";$custom;" in *";$id;"*) ;; *) return 1 ;; esac
  else
    memberships="$(afyx_component_field "$id" presets)"
    case ";$memberships;" in *";$preset;"*) ;; *) return 1 ;; esac
  fi
  restriction="$(afyx_component_field "$id" providers)"
  [[ -z "$restriction" ]] && return 0
  local old_ifs="$IFS"; IFS=','
  for provider in $providers; do case ";$restriction;" in *";$provider;"*) IFS="$old_ifs"; return 0 ;; esac; done
  IFS="$old_ifs"; return 1
}

# afyx_control_classify <id> <actual-state> <preset> [custom-id;list] [provider-id,list]
# Sets a read-only desired-state comparison for callers; it never mutates disk.
afyx_control_classify() {
  local id="$1" actual="$2" preset="$3" custom="${4:-}" providers="${5:-codex}" declared platform type runtime_verified=true marker field value
  declared="$(afyx_component_field "$id" ownership_class)"
  platform="$(afyx_component_field "$id" platforms)"
  type="$(afyx_component_field "$id" type)"
  AFYX_DESIRED=false; afyx_component_desired "$id" "$preset" "$custom" "$providers" && AFYX_DESIRED=true
  AFYX_ACTUAL_OWNERSHIP="$declared"
  [[ "$actual" == UNKNOWN ]] && AFYX_ACTUAL_OWNERSHIP=USER
  [[ "$actual" == 'NOT INSTALLED' ]] && AFYX_ACTUAL_OWNERSHIP=NONE
  if [[ "$type" == runtime && "$actual" != 'NOT INSTALLED' ]]; then
    runtime_verified=false
    marker="$(afyx_component_root "$id")/$(afyx_component_field "$id" marker_file)"
    field="$(afyx_component_field "$id" marker_field)"; value="$(afyx_component_field "$id" marker_value)"
    if [[ -f "$marker" ]] && grep -q "\"$field\"[[:space:]]*:[[:space:]]*\"$value\"" "$marker"; then runtime_verified=true; fi
    [[ "$runtime_verified" == true ]] || AFYX_ACTUAL_OWNERSHIP=USER
  fi
  AFYX_REPAIR=NONE
  if [[ "$platform" == windows && "$(afyx_platform)" != windows ]]; then
    AFYX_DRIFT=NOT_APPLICABLE; return 0
  fi
  if [[ "$AFYX_DESIRED" != true ]]; then
    [[ "$actual" == 'NOT INSTALLED' ]] && AFYX_DRIFT=ABSENT || AFYX_DRIFT=EXTRA
    return 0
  fi
  if [[ "$runtime_verified" != true ]]; then AFYX_DRIFT=UNVERIFIED; AFYX_REPAIR=BLOCKED; return 0; fi
  case "$actual" in
    HEALTHY) AFYX_DRIFT=IN_SYNC ;;
    'NOT INSTALLED') AFYX_DRIFT=MISSING; AFYX_REPAIR=INSTALL ;;
    DRIFTED) AFYX_DRIFT=MODIFIED; [[ "$declared" == AFYX ]] && AFYX_REPAIR=REPAIR || AFYX_REPAIR=BLOCKED ;;
    INCOMPLETE|INVALID) AFYX_DRIFT=DEGRADED; [[ "$declared" == AFYX ]] && AFYX_REPAIR=REPAIR || AFYX_REPAIR=BLOCKED ;;
    *) AFYX_DRIFT=UNVERIFIED; AFYX_REPAIR=BLOCKED ;;
  esac
}

afyx_control_plan_identity() {
  local preset="$1" custom="${2:-}" providers="${3:-codex}" id desired= separator=
  afyx_preset_valid "$preset" || return 2
  for id in $(afyx_component_ids); do
    [[ "$(afyx_component_field "$id" type)" == detected-cli ]] && continue
    if afyx_component_desired "$id" "$preset" "$custom" "$providers"; then desired="${desired}${separator}${id}"; separator=,; fi
  done
  printf 'v1|%s|%s|%s' "$preset" "$providers" "$desired"
}

afyx_platform() {
  if [[ -n "${AFYX_PLATFORM:-}" ]]; then printf '%s' "$AFYX_PLATFORM"; return; fi
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) printf windows ;; *) printf unix ;; esac
}

afyx_component_root() {
  local root relative
  case "$(afyx_component_field "$1" install_root)" in
    skills_root) root="$skills_root" ;;
    afyx_graph_root) root="$graph_root" ;;
    afyx_context_root) root="$context_root" ;;
    afyx_forge_root) root="$forge_root" ;;
    codex_tools) root="$codex_home/tools" ;;
    *) root="" ;;
  esac
  [[ -n "$root" ]] || return 0
  relative="$(afyx_component_field "$1" install_path)"
  if [[ -n "$relative" ]]; then printf '%s/%s' "$root" "$relative"; else printf '%s' "$root"; fi
}

# afyx_skill_manifest_check <dir> <require_version:true|false> -> 0 ok; AFYX_DETAIL says why not
afyx_skill_manifest_check() {
  local manifest="$1/SKILL.md"
  [[ -f "$manifest" ]] || { AFYX_DETAIL='SKILL.md missing'; return 1; }
  [[ -s "$manifest" ]] || { AFYX_DETAIL='SKILL.md is empty'; return 1; }
  [[ "$(head -n 1 "$manifest")" == '---' ]] || { AFYX_DETAIL='frontmatter delimiters missing or malformed'; return 1; }
  grep -Eq '^name:[[:space:]]*[a-z0-9-]+[[:space:]]*$' "$manifest" || { AFYX_DETAIL='valid name missing'; return 1; }
  grep -Eq '^description:[[:space:]]*[^[:space:]].*$' "$manifest" || { AFYX_DETAIL='description missing'; return 1; }
  if [[ "$2" == true ]]; then
    grep -Eq '^metadata:[[:space:]]*$' "$manifest" || { AFYX_DETAIL='metadata.version missing'; return 1; }
    grep -Eq '^[[:space:]]+version:[[:space:]]*[^[:space:]].*$' "$manifest" || { AFYX_DETAIL='metadata.version missing'; return 1; }
  fi
  return 0
}

afyx_skill_version() {
  sed -n 's/^[[:space:]]*version:[[:space:]]*"\{0,1\}\([^"[:space:]]*\).*/\1/p' "$1/SKILL.md" 2>/dev/null | head -n 1
}

afyx_component_evaluate() {
  local id="$1" type platforms path list item present total platform marker_file field value
  AFYX_STATE=UNKNOWN; AFYX_DETAIL=''; AFYX_VERSION=''; AFYX_PATH=''
  type="$(afyx_component_field "$id" type)"
  platforms="$(afyx_component_field "$id" platforms)"
  platform="$(afyx_platform)"

  if [[ "$type" == detected-cli ]]; then
    if command -v "$(afyx_component_field "$id" detect_command)" >/dev/null 2>&1; then
      AFYX_STATE=HEALTHY; AFYX_DETAIL='externally managed; detected'
    else AFYX_STATE='NOT INSTALLED'; AFYX_DETAIL='externally managed; not detected'; fi
    return 0
  fi
  if [[ "$platforms" == windows && "$platform" != windows ]]; then
    AFYX_STATE='NOT INSTALLED'; AFYX_DETAIL='Windows-only runtime'; return 0
  fi

  path="$(afyx_component_root "$id")"; AFYX_PATH="$path"
  [[ -n "$path" ]] || { AFYX_DETAIL='component root is not defined'; return 0; }

  list="$(afyx_component_field "$id" required_files)"
  local extra="$(afyx_component_field "$id" "required_files_$platform")"
  [[ -n "$extra" ]] && list="${list:+$list;}$extra"

  case "$type" in
    skill)
      if [[ ! -e "$path" ]]; then AFYX_STATE='NOT INSTALLED'; AFYX_DETAIL='not installed'; return 0; fi
      if ! afyx_skill_manifest_check "$path" "$(afyx_component_field "$id" version_required)"; then AFYX_STATE=INVALID; return 0; fi
      local IFS=';'
      for item in $list; do
        [[ -n "$item" ]] || continue
        if [[ ! -f "$path/$item" ]]; then AFYX_STATE=INCOMPLETE; AFYX_DETAIL="reference missing: $item"; return 0; fi
        if [[ "$item" != SKILL.md && ! -s "$path/$item" ]]; then AFYX_STATE=INCOMPLETE; AFYX_DETAIL="reference empty: $item"; return 0; fi
      done
      unset IFS
      AFYX_STATE=HEALTHY; AFYX_DETAIL='frontmatter and required references valid'; AFYX_VERSION="$(afyx_skill_version "$path")"
      ;;
    runtime)
      if [[ ! -e "$path" ]]; then AFYX_STATE='NOT INSTALLED'; AFYX_DETAIL='not installed'; return 0; fi
      if [[ -L "$path" ]]; then AFYX_STATE=UNKNOWN; AFYX_DETAIL='runtime root is a symbolic link'; return 0; fi
      if [[ ! -r "$path" ]]; then AFYX_STATE=UNKNOWN; AFYX_DETAIL='access denied while inspecting component'; return 0; fi
      local IFS=';' unix_list
      unix_list=";$(afyx_component_field "$id" required_files_unix);"
      for item in $list; do
        [[ -n "$item" ]] || continue
        if [[ ! -f "$path/$item" ]]; then AFYX_STATE=INCOMPLETE; AFYX_DETAIL="missing: $item"; return 0; fi
        case "$unix_list" in *";$item;"*) if [[ "$platform" == unix && ! -x "$path/$item" ]]; then AFYX_STATE=INCOMPLETE; AFYX_DETAIL="not executable: $item"; return 0; fi ;; esac
      done
      unset IFS
      marker_file="$path/$(afyx_component_field "$id" marker_file)"
      field="$(afyx_component_field "$id" marker_field)"; value="$(afyx_component_field "$id" marker_value)"
      if ! grep -q "\"$field\"[[:space:]]*:[[:space:]]*\"$value\"" "$marker_file"; then AFYX_STATE=INVALID; AFYX_DETAIL='ownership marker mismatch'; return 0; fi
      field="$(afyx_component_field "$id" version_source)"; field="${field#*#}"
      AFYX_VERSION="$(sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$marker_file" | head -n 1)"
      if [[ "$(afyx_component_field "$id" version_required)" == true && -z "$AFYX_VERSION" ]]; then AFYX_STATE=INVALID; AFYX_DETAIL="$field missing from metadata"; return 0; fi
      local integrity_manifest expected_digest actual_digest line expected_hash relative actual_hash
      integrity_manifest="$(afyx_component_field "$id" integrity_manifest_file)"
      if [[ -n "$integrity_manifest" ]]; then
        expected_digest="$(sed -n 's/.*"artifact_digest"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' "$marker_file")"
        if command -v sha256sum >/dev/null 2>&1; then actual_digest="$(sha256sum "$path/$integrity_manifest" | awk '{print $1}')"
        else actual_digest="$(shasum -a 256 "$path/$integrity_manifest" | awk '{print $1}')"; fi
        if [[ ${#expected_digest} -ne 64 || "$actual_digest" != "$expected_digest" ]]; then AFYX_STATE=DRIFTED; AFYX_DETAIL='Afyx ownership verified but runtime integrity differs'; return 0; fi
        while IFS= read -r line; do
          expected_hash="${line%%  *}"; relative="${line#*  }"
          if [[ ! "$expected_hash" =~ ^[0-9a-f]{64}$ || "$relative" != current/* || "$relative" == *../* || ! -f "$path/$relative" || -L "$path/$relative" ]]; then AFYX_STATE=DRIFTED; AFYX_DETAIL='Afyx ownership verified but runtime integrity differs'; return 0; fi
          if command -v sha256sum >/dev/null 2>&1; then actual_hash="$(sha256sum "$path/$relative" | awk '{print $1}')"
          else actual_hash="$(shasum -a 256 "$path/$relative" | awk '{print $1}')"; fi
          if [[ "$actual_hash" != "$expected_hash" ]]; then AFYX_STATE=DRIFTED; AFYX_DETAIL='Afyx ownership verified but runtime integrity differs'; return 0; fi
        done < "$path/$integrity_manifest"
        local identity_file identity_field metadata_value identity_value
        identity_file="$(afyx_component_field "$id" identity_file)"
        if [[ -n "$identity_file" ]]; then
          [[ -f "$path/$identity_file" ]] || { AFYX_STATE=DRIFTED; AFYX_DETAIL='Afyx ownership verified but runtime identity is missing'; return 0; }
          for identity_field in product_name product_version source_revision ownership_class build_provenance release_channel integration_default; do
            metadata_value="$(sed -n 's/.*"'"$identity_field"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$marker_file" | head -n 1)"
            identity_value="$(sed -n 's/.*"'"$identity_field"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$path/$identity_file" | head -n 1)"
            if [[ "$metadata_value" != "$identity_value" ]]; then AFYX_STATE=DRIFTED; AFYX_DETAIL='Afyx ownership verified but runtime identity differs'; return 0; fi
          done
        fi
      fi
      AFYX_STATE=HEALTHY; AFYX_DETAIL='Afyx-owned runtime valid'
      ;;
    toolset)
      present=0; total=0
      local IFS=';'
      for item in $list; do
        [[ -n "$item" ]] || continue
        total=$((total + 1)); [[ -f "$path/$item" ]] && present=$((present + 1))
      done
      unset IFS
      if ((present == 0)); then AFYX_STATE='NOT INSTALLED'; AFYX_DETAIL='not installed'
      elif ((present == total)); then AFYX_STATE=HEALTHY; AFYX_DETAIL='runtime files installed'
      else AFYX_STATE=INCOMPLETE; AFYX_DETAIL="$present of $total runtime files present"; fi
      ;;
    *) AFYX_DETAIL="unsupported component type: $type" ;;
  esac
  return 0
}
