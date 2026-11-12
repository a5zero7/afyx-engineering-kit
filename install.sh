#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUNDLED_EFFICIENT="$PACKAGE_ROOT/skills/efficient-coding"
BUNDLED_ODOO="$PACKAGE_ROOT/skills/odoo-engineering"
BUNDLED_EXPERT="$PACKAGE_ROOT/skills/afyx-engineering-expert"
skills_root="${CODEX_SKILLS_ROOT:-$HOME/.agents/skills}"
skills_root_explicit=false
graph_root="${AFYX_GRAPH_RUNTIME_ROOT:-$HOME/.afyx/graph}"
context_root="${AFYX_CONTEXT_RUNTIME_ROOT:-$HOME/.afyx/context}"
forge_root="${AFYX_FORGE_RUNTIME_ROOT:-$HOME/.afyx/forge}"
force=false
validate_only=false
dry_run=false
update_installed=false
component_actions=()
component_action_count=0
preset=
custom_component_list=
offline=false
no_build_fallback=false
allow_dirty_source=false
allow_downgrade=false
skip_graph_mcp=false
provider_list=codex
provider_explicit=false
provider_scope=global
workspace_root="$PWD"
gemini_home="${AFYX_GEMINI_HOME:-$HOME/.gemini}"
claude_home="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
claude_config_dir="${CLAUDE_CONFIG_DIR:-}"
skip_provider_configuration=false

usage() {
  printf '%s\n' 'Usage: ./install.sh [--skills-root PATH] [--context-runtime-root PATH] [--forge-runtime-root PATH] [--provider codex|antigravity|claude[,..]] [--provider-scope global|workspace] [--workspace-root PATH] [--gemini-home PATH] [--claude-home PATH] [--claude-config-dir PATH] [--skip-provider-configuration] [--preset minimal|recommended|full|custom] [--custom-component ID] [--component ID=skip|install|update|repair|adopt] [--update-installed] [--force] [--validate-only] [--dry-run]'
}

while (($#)); do
  case "$1" in
    --skills-root) (($# >= 2)) || { printf '%s\n' '--skills-root requires a value.' >&2; exit 2; }; skills_root="$2"; skills_root_explicit=true; shift 2 ;;
    --context-runtime-root) (($# >= 2)) || { printf '%s\n' '--context-runtime-root requires a value.' >&2; exit 2; }; context_root="$2"; shift 2 ;;
    --forge-runtime-root) (($# >= 2)) || { printf '%s\n' '--forge-runtime-root requires a value.' >&2; exit 2; }; forge_root="$2"; shift 2 ;;
    --force) force=true; shift ;;
    --component) (($# >= 2)) || { printf '%s\n' '--component requires a value.' >&2; exit 2; }; component_actions+=("$2"); component_action_count=$((component_action_count + 1)); shift 2 ;;
    --preset) (($# >= 2)) || { printf '%s\n' '--preset requires a value.' >&2; exit 2; }; preset="$2"; shift 2 ;;
    --custom-component) (($# >= 2)) || { printf '%s\n' '--custom-component requires a value.' >&2; exit 2; }; custom_component_list="${custom_component_list:+$custom_component_list;}$2"; shift 2 ;;
    --update-installed) update_installed=true; shift ;;
    --offline) offline=true; shift ;;
    --no-build-fallback) no_build_fallback=true; shift ;;
    --allow-dirty-source) allow_dirty_source=true; shift ;;
    --allow-downgrade) allow_downgrade=true; shift ;;
    --skip-graph-mcp) skip_graph_mcp=true; shift ;;
    --provider) (($# >= 2)) || { printf '%s\n' '--provider requires a value.' >&2; exit 2; }; provider_list="$2"; provider_explicit=true; shift 2 ;;
    --provider-scope) (($# >= 2)) || { printf '%s\n' '--provider-scope requires a value.' >&2; exit 2; }; provider_scope="$2"; shift 2 ;;
    --workspace-root) (($# >= 2)) || { printf '%s\n' '--workspace-root requires a value.' >&2; exit 2; }; workspace_root="$2"; shift 2 ;;
    --gemini-home) (($# >= 2)) || { printf '%s\n' '--gemini-home requires a value.' >&2; exit 2; }; gemini_home="$2"; shift 2 ;;
    --claude-home) (($# >= 2)) || { printf '%s\n' '--claude-home requires a value.' >&2; exit 2; }; claude_home="$2"; shift 2 ;;
    --claude-config-dir) (($# >= 2)) || { printf '%s\n' '--claude-config-dir requires a value.' >&2; exit 2; }; claude_config_dir="$2"; shift 2 ;;
    --skip-provider-configuration) skip_provider_configuration=true; shift ;;
    --validate-only) validate_only=true; shift ;;
    --dry-run) dry_run=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$provider_explicit" == false && -t 0 && -t 1 && -z "${CI:-}" ]]; then
  detected_providers=
  command -v codex >/dev/null 2>&1 && detected_providers=codex
  if command -v agy >/dev/null 2>&1 || command -v antigravity >/dev/null 2>&1; then detected_providers="${detected_providers:+$detected_providers,}antigravity"; fi
  if command -v claude >/dev/null 2>&1; then detected_providers="${detected_providers:+$detected_providers,}claude"; fi
  printf 'Provider hosts detected: %s\n' "${detected_providers:-none}"
  read -r -p 'Provider selection: [A] All detected / [R] Recommended Codex / [C] Custom / [S] Skip [A]: ' provider_choice || provider_choice=
  case "$provider_choice" in
    [aA]|[aA][lL][lL]) provider_list="${detected_providers:-codex}" ;;
    [cC]|[cC][uU][sS][tT][oO][mM]) read -r -p 'Provider ids (comma-separated): ' provider_list ;;
    [sS]|[sS][kK][iI][pP]) provider_list=codex; skip_provider_configuration=true ;;
    *) if [[ -n "$detected_providers" ]]; then provider_list="$detected_providers"; else provider_list=codex; skip_provider_configuration=true; fi ;;
  esac
fi

case "$provider_scope" in global|workspace) ;; *) printf 'Unknown provider scope: %s\n' "$provider_scope" >&2; exit 2 ;; esac
old_ifs=$IFS; IFS=','
for provider_id in $provider_list; do case "$provider_id" in codex|antigravity|claude) ;; *) printf 'Unknown provider: %s\n' "$provider_id" >&2; exit 2 ;; esac; done
IFS=$old_ifs
if [[ "$skills_root_explicit" == false && "$provider_scope" == workspace && ",$provider_list," == *,antigravity,* ]]; then
  skills_root="$workspace_root/.agents/skills"
fi
additional_skill_roots=()
if [[ "$provider_scope" == global && ",$provider_list," == *,antigravity,* ]]; then
  antigravity_ide_skills="$gemini_home/config/skills"
  antigravity_cli_skills="$gemini_home/antigravity-cli/skills"
  if [[ "$skills_root_explicit" == false && "$provider_list" == antigravity ]]; then skills_root="$antigravity_ide_skills"; fi
  [[ "$skills_root" == "$antigravity_ide_skills" ]] || additional_skill_roots+=("$antigravity_ide_skills")
  [[ "$skills_root" == "$antigravity_cli_skills" ]] || additional_skill_roots+=("$antigravity_cli_skills")
fi
if [[ "$provider_scope" == global && ",$provider_list," == *,claude,* ]]; then
  claude_skills="$claude_home/skills"
  [[ "$skills_root" == "$claude_skills" ]] || additional_skill_roots+=("$claude_skills")
elif [[ "$provider_scope" == workspace && ",$provider_list," == *,claude,* ]]; then
  claude_skills="$workspace_root/.claude/skills"
  [[ "$skills_root" == "$claude_skills" ]] || additional_skill_roots+=("$claude_skills")
fi

printf 'Afyx Codex Engineering Kit — Linux/macOS installer (Bash)\n'

valid_manifest() { [[ -s "$1/SKILL.md" ]] && [[ "$(head -n 1 "$1/SKILL.md")" == '---' ]]; }
# One component truth: scripts/components.json, read through the shared library.
# shellcheck source=scripts/lib/afyx-components.sh
. "$PACKAGE_ROOT/scripts/lib/afyx-components.sh"
# shellcheck source=scripts/lib/afyx-skill-lifecycle.sh
. "$PACKAGE_ROOT/scripts/lib/afyx-skill-lifecycle.sh"
retired_component_error() {
  printf "Component '%s' is retired from Afyx Kit and remains externally/user managed; no changes were made.\n" "$1" >&2
  exit 2
}
if [[ -n "$preset" ]] && ! afyx_preset_valid "$preset"; then printf 'Unknown preset: %s\n' "$preset" >&2; exit 2; fi
if [[ -n "$custom_component_list" && "$preset" != custom ]]; then printf '%s\n' '--custom-component requires --preset custom.' >&2; exit 2; fi
if [[ -n "$preset" ]] && { ((component_action_count)) || [[ "$force" == true ]]; }; then
  printf '%s\n' 'A preset is immutable for one operation; do not combine it with --component or --force.' >&2; exit 2
fi
old_ifs=$IFS; IFS=';'
for custom_id in $custom_component_list; do
  case "$custom_id" in prompt-master|headroom) retired_component_error "$custom_id" ;; efficient-coding|odoo-engineering|afyx-engineering-expert|afyx-graph|afyx-context|afyx-forge|codex-usage-tracking) ;; *) printf 'Unknown custom component: %s\n' "$custom_id" >&2; exit 2 ;; esac
done
IFS=$old_ifs
for specification in ${component_actions[@]+"${component_actions[@]}"}; do
  case "$specification" in *=*) component_id="${specification%%=*}" ;; *) continue ;; esac
  case "$component_id" in prompt-master|headroom) retired_component_error "$component_id" ;; esac
done
component_state() {
  local id="$1" owner target
  afyx_component_evaluate "$id"
  if [[ "$(afyx_component_field "$id" type)" == skill && "$AFYX_STATE" != 'NOT INSTALLED' ]]; then
    owner="$(afyx_component_field "$id" ownership)"; target="$(afyx_component_root "$id")"
    afyx_classify_skill "$target" "$id" "$owner"
    case "$AFYX_OWNERSHIP_STATE" in
      AFYX_OWNED_UNMODIFIED|EXTERNAL_UPSTREAM) ;;
      AFYX_OWNED_MODIFIED) AFYX_STATE=DRIFTED; AFYX_DETAIL='Afyx ownership verified but installed content was modified' ;;
      *) AFYX_STATE=UNKNOWN; AFYX_DETAIL="installed ownership is $AFYX_OWNERSHIP_STATE" ;;
    esac
  fi
  printf '%s' "$AFYX_STATE"
}
component_version() { afyx_component_evaluate "$1"; printf '%s' "$AFYX_VERSION"; }
run() { if "$dry_run"; then printf '+ '; printf '%q ' "$@"; printf '\n'; else "$@"; fi; }
interactive=false
if [[ -t 0 && -z "${CI:-}" ]] && ! "$dry_run"; then interactive=true; fi

available_version() {
  case "$1" in
    efficient-coding) afyx_skill_version "$BUNDLED_EFFICIENT" ;;
    odoo-engineering) afyx_skill_version "$BUNDLED_ODOO" ;;
    afyx-engineering-expert) afyx_skill_version "$BUNDLED_EXPERT" ;;
    afyx-graph) sed -n 's/.*"product_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PACKAGE_ROOT/afyx-graph/afyx-graph.json" ;;
    afyx-context) sed -n 's/.*"product_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PACKAGE_ROOT/afyx-context/afyx-context.json" ;;
    afyx-forge) sed -n 's/.*"product_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PACKAGE_ROOT/afyx-forge/afyx-forge.json" ;;
    *) printf '' ;;
  esac
}

version_lt() {
  awk -v left="$1" -v right="$2" 'BEGIN {
    split(left, l, "."); split(right, r, ".");
    for (i=1; i<=4; i++) { if ((l[i]+0) < (r[i]+0)) exit 0; if ((l[i]+0) > (r[i]+0)) exit 1 }
    exit 1
  }'
}

explicit_action() {
  local wanted="$1" specification id action
  for specification in ${component_actions[@]+"${component_actions[@]}"}; do
    case "$specification" in *=*) id="${specification%%=*}"; action="${specification#*=}" ;; *) printf 'Invalid --component value: %s\n' "$specification" >&2; return 2 ;; esac
    case "$id" in prompt-master|headroom) retired_component_error "$id" ;; efficient-coding|odoo-engineering|afyx-engineering-expert|afyx-graph|afyx-context|afyx-forge|codex-usage-tracking) ;; *) printf 'Unknown selectable component: %s\n' "$id" >&2; return 2 ;; esac
    case "$action" in skip|install|update|repair|adopt) ;; *) printf 'Invalid action for %s: %s\n' "$id" "$action" >&2; return 2 ;; esac
    [[ "$id" == "$wanted" ]] && { printf '%s' "$action"; return 0; }
  done
  return 1
}

component_action() {
  local id="$1" label="$2" state="$3" installed="$4" available action= answer default
  available="$(available_version "$id")"
  if action="$(explicit_action "$id")"; then :
  elif [[ -n "$preset" ]]; then
    afyx_control_classify "$id" "$state" "$preset" "$custom_component_list" "$provider_list"
    if [[ "$AFYX_DESIRED" != true || "$AFYX_DRIFT" == NOT_APPLICABLE ]]; then action=skip
    elif [[ "$AFYX_REPAIR" == BLOCKED ]]; then printf '%s drift is %s with actual ownership %s; automatic takeover is forbidden.\n' "$label" "$AFYX_DRIFT" "$AFYX_ACTUAL_OWNERSHIP" >&2; return 2
    elif [[ "$AFYX_REPAIR" == INSTALL ]]; then action=install
    elif [[ "$AFYX_REPAIR" == REPAIR ]]; then action=repair
    elif [[ "$state" == HEALTHY && -n "$available" && -n "$installed" ]]; then
      if version_lt "$installed" "$available"; then action=update
      elif version_lt "$available" "$installed" && { "$allow_downgrade" || "$force"; }; then action=repair
      else action=skip; fi
    else action=skip; fi
  elif "$force"; then
    if [[ "$state" == UNKNOWN ]]; then printf '%s ownership is unknown; --force cannot take ownership.\n' "$label" >&2; return 2
    elif [[ "$state" == 'NOT INSTALLED' ]]; then action=install
    elif [[ "$state" == INCOMPLETE || "$state" == INVALID || "$state" == DRIFTED ]]; then action=repair
    else action=update; fi
  elif "$update_installed"; then
    if [[ "$state" == INCOMPLETE || "$state" == INVALID || "$state" == DRIFTED ]]; then action=repair
    elif [[ "$state" == HEALTHY && -n "$available" && -n "$installed" ]]; then
      if version_lt "$installed" "$available"; then action=update
      elif version_lt "$available" "$installed" && "$allow_downgrade"; then action=repair
      else action=skip; fi
    else action=skip; fi
  elif ! "$interactive" || "$dry_run"; then action=skip
  elif [[ "$state" == 'NOT INSTALLED' ]]; then
    read -r -p "$label is not installed. installed=$installed available=$available [I] Install / [S] Skip [S]: " answer || answer=
    case "$answer" in [iI]|[iI][nN][sS][tT][aA][lL][lL]) action=install ;; *) action=skip ;; esac
  elif [[ "$state" == HEALTHY ]]; then
    default=S; [[ -n "$available" && -n "$installed" ]] && version_lt "$installed" "$available" && default=U
    read -r -p "$label is healthy. installed=$installed available=$available [U] Update / [S] Skip [$default]: " answer || answer=
    case "$answer" in [uU]|[uU][pP][dD][aA][tT][eE]) action=update ;; '') [[ "$default" == U ]] && action=update || action=skip ;; *) action=skip ;; esac
  elif [[ "$state" == INCOMPLETE || "$state" == INVALID || "$state" == DRIFTED ]]; then
    read -r -p "$label is $state [R] Repair / [S] Skip [S]: " answer || answer=
    case "$answer" in [rR]|[rR][eE][pP][aA][iI][rR]) action=repair ;; *) action=skip ;; esac
  else
    read -r -p "$label ownership/health is unknown. [A] Adopt verified legacy install / [S] Skip [S]: " answer || answer=
    case "$answer" in [aA]|[aA][dD][oO][pP][tT]) action=adopt ;; *) action=skip ;; esac
  fi
  case "$state:$action" in
    'NOT INSTALLED':install|'NOT INSTALLED':skip|HEALTHY:update|HEALTHY:adopt|HEALTHY:skip|INCOMPLETE:repair|INCOMPLETE:skip|INVALID:repair|INVALID:skip|DRIFTED:repair|DRIFTED:skip|UNKNOWN:adopt|UNKNOWN:skip) ;;
    *) printf '%s state %s does not permit action %s.\n' "$label" "$state" "$action" >&2; return 2 ;;
  esac
  printf '%s' "$action"
}

replace_choice() {
  local label="$1" answer
  if "$force"; then printf Replace; return; fi
  if ! "$interactive"; then printf Skip; return; fi
  while :; do
    read -r -p "$label [S] Skip / [R] Replace [S]: " answer || answer=
    case "$answer" in ''|[sS]|[sS][kK][iI][pP]) printf Skip; return ;; [rR]|[rR][eE][pP][lL][aA][cC][eE]) printf Replace; return ;; esac
  done
}

install_choice() {
  local label="$1" answer
  if ! "$interactive"; then return 1; fi
  while :; do
    read -r -p "$label [Y/N] [N]: " answer || answer=
    case "$answer" in [yY]|[yY][eE][sS]) return 0 ;; ''|[nN]|[nN][oO]) return 1 ;; esac
  done
}

replacement_authorized() {
  local id="$1" specification
  "$force" && return 0
  if [[ -n "$preset" ]] && afyx_component_desired "$id" "$preset" "$custom_component_list" "$provider_list"; then return 0; fi
  for specification in ${component_actions[@]+"${component_actions[@]}"}; do
    [[ "$specification" == "$id="* && "$specification" != "$id=skip" ]] && return 0
  done
  return 1
}

safe_skill_install() {
  local component="$1" label="$2" source="$3" target="$4" replace="$5" parent stage version authorize=false
  if [[ -e "$target" && "$replace" != true ]]; then printf skipped; return; fi
  if "$dry_run"; then printf 'planned'; return; fi
  parent="$(dirname "$target")"; afyx_assert_skill_target "$skills_root" "$target"
  stage="$(mktemp -d "$parent/.skill-stage.XXXXXX")"
  if ! cp -a "$source/." "$stage/"; then rm -rf -- "$stage"; return 1; fi
  version="$(afyx_skill_version "$source")"
  replacement_authorized "$component" && authorize=true
  if ! afyx_promote_skill "$component" "$label" "$stage" "$target" afyx "$version" '' '' "$authorize"; then
    [[ -e "$stage" ]] && rm -rf -- "$stage"
    return 1
  fi
  if [[ "$replace" == true ]]; then printf replaced; else printf installed; fi
}

adopt_legacy_skill() {
  local component="$1" label="$2" target="$3" owner legacy_version legacy_digest repository revision provenance
  owner="$(afyx_component_field "$component" ownership)"
  legacy_version="$(afyx_component_field "$component" legacy_version)"
  legacy_digest="$(afyx_component_field "$component" legacy_content_digest_bash)"
  repository="$(afyx_component_field "$component" source)"
  revision="$(afyx_component_field "$component" source_revision)"
  afyx_classify_skill "$target" "$component" "$owner"
  if [[ "$AFYX_OWNERSHIP_STATE" == AFYX_OWNED_UNMODIFIED || "$AFYX_OWNERSHIP_STATE" == EXTERNAL_UPSTREAM ]]; then
    printf 'already adopted'; return 0
  fi
  afyx_legacy_skill_provenance "$target" "$component" "$owner" "$legacy_digest" "$legacy_version" "$repository" "$revision"
  provenance="$AFYX_LEGACY_PROVENANCE"
  [[ "$provenance" == MATCH ]] || { printf 'Refusing to adopt %s because legacy provenance is %s.\n' "$label" "$provenance" >&2; return 1; }
  if "$dry_run"; then printf 'planned adoption'; return 0; fi
  afyx_adopt_legacy_skill "$component" "$target" "$owner" "$legacy_version" "$legacy_digest" "$legacy_version" "$repository" "$revision"
}

valid_manifest "$BUNDLED_EFFICIENT" || { printf 'Bundled Efficient Coding is invalid.\n' >&2; exit 1; }
valid_manifest "$BUNDLED_ODOO" || { printf 'Bundled Odoo Engineering is invalid.\n' >&2; exit 1; }
valid_manifest "$BUNDLED_EXPERT" || { printf 'Bundled Afyx Engineering Expert is invalid.\n' >&2; exit 1; }
[[ -s "$PACKAGE_ROOT/afyx-graph/afyx-graph.json" ]] || { printf 'Bundled Afyx Graph metadata is missing.\n' >&2; exit 1; }
[[ -s "$PACKAGE_ROOT/afyx-context/afyx-context.json" ]] || { printf 'Bundled Afyx Context metadata is missing.\n' >&2; exit 1; }
[[ -s "$PACKAGE_ROOT/afyx-forge/afyx-forge.json" ]] || { printf 'Bundled Afyx Forge metadata is missing.\n' >&2; exit 1; }

efficient_target="$skills_root/efficient-coding"
odoo_target="$skills_root/odoo-engineering"
expert_target="$skills_root/afyx-engineering-expert"
efficient_state="$(component_state efficient-coding)"
odoo_state="$(component_state odoo-engineering)"
expert_state="$(component_state afyx-engineering-expert)"
afyx_graph_state="$(component_state afyx-graph)"
afyx_context_state="$(component_state afyx-context)"
afyx_forge_state="$(component_state afyx-forge)"

printf '\nComponent Inventory\n'
printf 'Efficient Coding: %s; installed=%s; available=%s; ownership=afyx\n' "$efficient_state" "$(component_version efficient-coding)" "$(available_version efficient-coding)"
printf 'Odoo Engineering: %s; installed=%s; available=%s; ownership=afyx\n' "$odoo_state" "$(component_version odoo-engineering)" "$(available_version odoo-engineering)"
printf 'Afyx Engineering Expert: %s; installed=%s; available=%s; ownership=afyx\n' "$expert_state" "$(component_version afyx-engineering-expert)" "$(available_version afyx-engineering-expert)"
printf 'Afyx Graph: %s; installed=%s; available=%s; ownership=afyx\n' "$afyx_graph_state" "$(component_version afyx-graph)" "$(available_version afyx-graph)"
printf 'Afyx Context Engine: %s; installed=%s; available=%s; ownership=afyx\n' "$afyx_context_state" "$(component_version afyx-context)" "$(available_version afyx-context)"
printf 'Afyx Forge Core: %s; installed=%s; available=%s; ownership=afyx\n' "$afyx_forge_state" "$(component_version afyx-forge)" "$(available_version afyx-forge)"
printf 'Usage Tracking: NOT INSTALLED (Windows-only runtime)\n'
if [[ -n "$preset" ]]; then
  printf '\nDesired State Plan: %s\n' "$(afyx_control_plan_identity "$preset" "$custom_component_list" "$provider_list")"
  for plan_id in $(afyx_component_ids); do
    plan_state="$(component_state "$plan_id")"
    afyx_control_classify "$plan_id" "$plan_state" "$preset" "$custom_component_list" "$provider_list"
    printf '%s: desired=%s; actual=%s; drift=%s; ownership=%s; repair=%s\n' "$plan_id" "$AFYX_DESIRED" "$plan_state" "$AFYX_DRIFT" "$AFYX_ACTUAL_OWNERSHIP" "$AFYX_REPAIR"
  done
fi
printf '\nProvider Plan\n'
if "$skip_provider_configuration"; then printf 'Provider configuration: skipped explicitly\n'; fi
old_ifs=$IFS; IFS=','
for provider_id in $provider_list; do
  if [[ "$provider_id" == codex ]]; then
    provider_name=Codex
    command -v codex >/dev/null 2>&1 && provider_detected=true || provider_detected=false
    provider_path="${CODEX_HOME:-$HOME/.codex}/config.toml"
  elif [[ "$provider_id" == antigravity ]]; then
    provider_name=Antigravity
    { command -v agy >/dev/null 2>&1 || command -v antigravity >/dev/null 2>&1; } && provider_detected=true || provider_detected=false
    [[ "$provider_scope" == workspace ]] && provider_path="$workspace_root/.agents/mcp_config.json" || provider_path="$gemini_home/config/mcp_config.json"
  elif [[ "$provider_id" == claude ]]; then
    provider_name="Claude Code"
    command -v claude >/dev/null 2>&1 && provider_detected=true || provider_detected=false
    if [[ "$provider_scope" == workspace ]]; then
      provider_path="$workspace_root/.mcp.json"
    else
      provider_path="${claude_config_dir:-$HOME}/.claude.json"
    fi
  fi
  printf '%s: detected=%s; scope=%s; planned-config=%s\n' "$provider_name" "$provider_detected" "$provider_scope" "$provider_path"
  if [[ "$provider_id" == antigravity ]]; then
    if [[ "$provider_scope" == workspace ]]; then provider_skills="$workspace_root/.agents/skills"; else provider_skills="$gemini_home/config/skills;$gemini_home/antigravity-cli/skills"; fi
    printf 'Antigravity planned skills: %s\n' "$provider_skills"
  elif [[ "$provider_id" == claude ]]; then
    if [[ "$provider_scope" == workspace ]]; then provider_skills="$workspace_root/.claude/skills"; else provider_skills="$claude_home/skills"; fi
    printf 'Claude Code planned skills: %s\n' "$provider_skills"
  fi
done
IFS=$old_ifs
if ! "$skip_graph_mcp" && ! "$skip_provider_configuration" && [[ ",$provider_list," == *,antigravity,* ]] && command -v node >/dev/null 2>&1; then
  set +e
  preflight_json="$(node "$PACKAGE_ROOT/scripts/afyx-provider-integration.mjs" --providers antigravity --scope "$provider_scope" --workspace-root "$workspace_root" --gemini-home "$gemini_home" --node "$(command -v node)" --entry "$graph_root/current/lib/dist/bin/afyx-graph.js" 2>/dev/null)"; preflight_exit=$?
  set -e
  preflight_reason="$(printf '%s' "$preflight_json" | sed -n 's/.*"reason":"\([^"]*\)".*/\1/p')"
  if ((preflight_exit != 0)) && [[ "$preflight_reason" != GRAPH_RUNTIME_UNAVAILABLE ]]; then
    printf 'Antigravity provider plan is blocked before mutation: %s\n' "$preflight_json" >&2
    exit 1
  fi
fi
if ! "$skip_graph_mcp" && ! "$skip_provider_configuration" && [[ ",$provider_list," == *,claude,* ]] && command -v node >/dev/null 2>&1; then
  set +e
  claude_cmd="$(command -v claude || true)"
  claude_pre_args=("$PACKAGE_ROOT/scripts/afyx-provider-integration.mjs" --providers claude --scope "$provider_scope" --workspace-root "$workspace_root" --node "$(command -v node)" --entry "$graph_root/current/lib/dist/bin/afyx-graph.js")
  if [[ -n "$claude_cmd" ]]; then claude_pre_args+=(--claude "$claude_cmd"); elif "$claude_vscode_detected"; then claude_pre_args+=(--claude-extension); fi
  [[ -n "$claude_config_dir" ]] && claude_pre_args+=(--claude-config-dir "$claude_config_dir")
  preflight_json="$(node "${claude_pre_args[@]}" 2>/dev/null)"; preflight_exit=$?
  set -e
  preflight_reason="$(printf '%s' "$preflight_json" | sed -n 's/.*"reason":"\([^"]*\)".*/\1/p')"
  if ((preflight_exit != 0)) && [[ "$preflight_reason" != GRAPH_RUNTIME_UNAVAILABLE ]]; then
    printf 'Claude Code provider plan is blocked before mutation: %s\n' "$preflight_json" >&2
    exit 1
  fi
fi

codex_cli_detected=false; command -v codex >/dev/null 2>&1 && codex_cli_detected=true
antigravity_detected=false; { command -v agy >/dev/null 2>&1 || command -v antigravity >/dev/null 2>&1; } && antigravity_detected=true
claude_cli_detected=false; command -v claude >/dev/null 2>&1 && claude_cli_detected=true
claude_vscode_detected=false
for extension in "$HOME"/.vscode/extensions/anthropic.claude-code-*; do [[ -d "$extension" ]] && { claude_vscode_detected=true; break; }; done
vscode_extension_detected=false
for extension in "$HOME"/.vscode/extensions/openai.chatgpt-*; do [[ -d "$extension" ]] && { vscode_extension_detected=true; break; }; done

printf '\nPrerequisite Inventory\n'
printf '[REQUIRED] OS/architecture: %s / %s\n' "$(uname -s)" "$(uname -m)"
printf '[REQUIRED] Platform shell: Bash %s\n' "$BASH_VERSION"
if command -v git >/dev/null 2>&1; then printf '[REQUIRED] Git: %s\n' "$(git --version)"; else printf '[REQUIRED] Git: MISSING — install Git with the documented OS package manager\n'; fi
if "$codex_cli_detected" || "$vscode_extension_detected"; then printf '[REQUIRED] Codex host: detected\n'; else printf '[REQUIRED] Codex host: MISSING — install Codex CLI or the supported VS Code extension\n'; fi
if "$antigravity_detected"; then printf '[REQUIRED] Antigravity host: detected\n'; else printf '[REQUIRED] Antigravity host: not detected\n'; fi
if "$claude_cli_detected"; then printf '[REQUIRED] Claude Code host: detected (CLI)\n'; elif "$claude_vscode_detected"; then printf '[REQUIRED] Claude Code host: detected (VS Code extension)\n'; else printf '[REQUIRED] Claude Code host: not detected\n'; fi
if command -v node >/dev/null 2>&1; then printf '[COMPONENT_REQUIRED:Afyx Graph] Node.js >=22.5.0: %s\n' "$(node --version)"; else printf '[COMPONENT_REQUIRED:Afyx Graph] Node.js >=22.5.0: MISSING — install from https://nodejs.org/\n'; fi
if command -v npm >/dev/null 2>&1; then printf '[BUILD_ONLY:Afyx Graph] npm: %s\n' "$(npm --version)"; else printf '[BUILD_ONLY:Afyx Graph] npm: MISSING — needed only for automatic local fallback\n'; fi
printf '[COMPONENT_REQUIRED:Afyx Graph] Archive/checksum: tar + SHA-256 tool required\n'
if [ -e "$PACKAGE_ROOT/.git" ] && command -v git >/dev/null 2>&1 && git -C "$PACKAGE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  graph_channel="$(sed -n 's/^[[:space:]]*"releaseChannel"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PACKAGE_ROOT/afyx-graph/engine/scripts/distribution-product.json" | head -n 1)"
  printf 'Source: branch=%s; commit=%s; channel=%s\n' "$(git -C "$PACKAGE_ROOT" branch --show-current)" "$(git -C "$PACKAGE_ROOT" rev-parse HEAD)" "$graph_channel"
fi

if "$validate_only"; then
  graph_version="$(sed -n 's/.*"product_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PACKAGE_ROOT/afyx-graph/afyx-graph.json")"
  printf 'BundledEfficientCoding: true\nInstalledEfficientCoding: %s\nEfficientCodingState: %s\nEfficientCodingVersion: %s\n' "$([[ "$efficient_state" == HEALTHY ]] && echo true || echo false)" "$efficient_state" "$(component_version efficient-coding)"
  printf 'BundledOdooEngineering: true\nInstalledOdooEngineering: %s\nOdooEngineeringState: %s\nOdooEngineeringVersion: %s\n' "$([[ "$odoo_state" == HEALTHY ]] && echo true || echo false)" "$odoo_state" "$(component_version odoo-engineering)"
  printf 'BundledAfyxEngineeringExpert: true\nInstalledAfyxEngineeringExpert: %s\nAfyxEngineeringExpertState: %s\nAfyxEngineeringExpertVersion: %s\n' "$([[ "$expert_state" == HEALTHY ]] && echo true || echo false)" "$expert_state" "$(component_version afyx-engineering-expert)"
  printf 'BundledAfyxGraphSource: true\nInstalledAfyxGraph: %s\nAfyxGraphState: %s\nAfyxGraphVersion: %s\n' "$([[ "$afyx_graph_state" == HEALTHY ]] && echo true || echo false)" "$afyx_graph_state" "$graph_version"
  context_version="$(available_version afyx-context)"
  printf 'BundledAfyxContextSource: true\nInstalledAfyxContext: %s\nAfyxContextState: %s\nAfyxContextVersion: %s\nAfyxContextRuntimeRoot: %s\n' "$([[ "$afyx_context_state" == HEALTHY ]] && echo true || echo false)" "$afyx_context_state" "$context_version" "$context_root"
  forge_version="$(available_version afyx-forge)"
  printf 'BundledAfyxForgeSource: true\nInstalledAfyxForge: %s\nAfyxForgeState: %s\nAfyxForgeVersion: %s\nAfyxForgeRuntimeRoot: %s\n' "$([[ "$afyx_forge_state" == HEALTHY ]] && echo true || echo false)" "$afyx_forge_state" "$forge_version" "$forge_root"
  printf 'InstalledUsageTracker: false\nUsageTrackerState: NOT INSTALLED\nCodexCliDetected: %s\nVsCodeExtensionDetected: %s\n' "$codex_cli_detected" "$vscode_extension_detected"
  exit 0
fi

if [[ -n "$preset" ]]; then
  blocked_plan=
  for plan_id in $(afyx_component_ids); do
    plan_state="$(component_state "$plan_id")"
    afyx_control_classify "$plan_id" "$plan_state" "$preset" "$custom_component_list" "$provider_list"
    if [[ "$AFYX_DESIRED" == true && "$AFYX_REPAIR" == BLOCKED ]]; then
      blocked_plan="${blocked_plan:+$blocked_plan, }$plan_id:$AFYX_DRIFT:$AFYX_ACTUAL_OWNERSHIP"
    fi
  done
  [[ -z "$blocked_plan" ]] || { printf 'Desired-state plan is blocked before mutation: %s\n' "$blocked_plan" >&2; exit 1; }
fi

if ! "$skip_provider_configuration" && [[ ",$provider_list," == *,codex,* ]] && ! "$codex_cli_detected" && ! "$vscode_extension_detected"; then printf 'Selected Codex provider host was not detected.\n' >&2; exit 1; fi
if ! "$skip_provider_configuration" && [[ ",$provider_list," == *,antigravity,* ]] && ! "$antigravity_detected"; then printf 'Selected Antigravity provider host was not detected.\n' >&2; exit 1; fi
if ! "$skip_provider_configuration" && [[ ",$provider_list," == *,claude,* ]] && ! "$claude_cli_detected" && ! "$claude_vscode_detected"; then printf 'Selected Claude Code provider host was not detected.\n' >&2; exit 1; fi
command -v git >/dev/null 2>&1 || { printf 'Git is required for Afyx source validation and lifecycle updates.\n' >&2; exit 1; }
efficient_action="$(component_action efficient-coding 'Efficient Coding' "$efficient_state" "$(component_version efficient-coding)")"
odoo_action="$(component_action odoo-engineering 'Odoo Engineering' "$odoo_state" "$(component_version odoo-engineering)")"
expert_action="$(component_action afyx-engineering-expert 'Afyx Engineering Expert' "$expert_state" "$(component_version afyx-engineering-expert)")"
for additional_root in ${additional_skill_roots[@]+"${additional_skill_roots[@]}"}; do
  for skill_spec in "efficient-coding|$efficient_action" "odoo-engineering|$odoo_action" "afyx-engineering-expert|$expert_action"; do
    skill_id="${skill_spec%%|*}"; skill_action="${skill_spec#*|}"
    if [[ -n "$preset" ]] && afyx_component_desired "$skill_id" "$preset" "$custom_component_list" "$provider_list"; then skill_action=install; fi
    [[ "$skill_action" != skip && "$skill_action" != adopt ]] || continue
    target="$additional_root/$skill_id"
    afyx_classify_skill "$target" "$skill_id" afyx
    case "$AFYX_OWNERSHIP_STATE" in NOT_INSTALLED|AFYX_OWNED_UNMODIFIED|AFYX_OWNED_MODIFIED) ;; *) printf 'Provider skill plan is blocked at %s because ownership is %s.\n' "$target" "$AFYX_OWNERSHIP_STATE" >&2; exit 1 ;; esac
  done
done
run mkdir -p "$skills_root"
efficient_result=skipped
odoo_result=skipped
expert_result=skipped
if [[ "$efficient_action" == adopt ]]; then efficient_result="$(adopt_legacy_skill efficient-coding 'Efficient Coding' "$efficient_target")"
elif [[ "$efficient_action" != skip ]]; then efficient_result="$(safe_skill_install efficient-coding 'Efficient Coding' "$BUNDLED_EFFICIENT" "$efficient_target" "$([[ "$efficient_action" == install ]] && printf false || printf true)")"; fi
if [[ "$odoo_action" == adopt ]]; then odoo_result="$(adopt_legacy_skill odoo-engineering 'Odoo Engineering' "$odoo_target")"
elif [[ "$odoo_action" != skip ]]; then odoo_result="$(safe_skill_install odoo-engineering 'Odoo Engineering' "$BUNDLED_ODOO" "$odoo_target" "$([[ "$odoo_action" == install ]] && printf false || printf true)")"; fi
if [[ "$expert_action" == adopt ]]; then
  printf 'Afyx Engineering Expert has no trusted legacy provenance and cannot be adopted.\n' >&2
  exit 1
elif [[ "$expert_action" != skip ]]; then expert_result="$(safe_skill_install afyx-engineering-expert 'Afyx Engineering Expert' "$BUNDLED_EXPERT" "$expert_target" "$([[ "$expert_action" == install ]] && printf false || printf true)")"; fi

replicate_provider_skill() {
  local id="$1" label="$2" source="$3" action="$4" root target replace result
  if [[ -n "$preset" ]] && afyx_component_desired "$id" "$preset" "$custom_component_list" "$provider_list"; then action=install; fi
  [[ "$action" != skip && "$action" != adopt ]] || return 0
  for root in ${additional_skill_roots[@]+"${additional_skill_roots[@]}"}; do
    target="$root/$id"
    afyx_classify_skill "$target" "$id" afyx
    case "$AFYX_OWNERSHIP_STATE" in
      NOT_INSTALLED) replace=false ;;
      AFYX_OWNED_UNMODIFIED)
        if [[ "$(afyx_skill_version "$target")" == "$(afyx_skill_version "$source")" ]]; then printf '%s [%s]: skipped\n' "$label" "$root"; continue; fi
        replace=true
        ;;
      AFYX_OWNED_MODIFIED) replace=true ;;
      *) printf 'Refusing to replace %s at provider skill root %s because ownership is %s.\n' "$label" "$root" "$AFYX_OWNERSHIP_STATE" >&2; exit 1 ;;
    esac
    result="$(safe_skill_install "$id" "$label" "$source" "$target" "$replace")"
    printf '%s [%s]: %s\n' "$label" "$root" "$result"
  done
}
replicate_provider_skill efficient-coding 'Efficient Coding' "$BUNDLED_EFFICIENT" "$efficient_action"
replicate_provider_skill odoo-engineering 'Odoo Engineering' "$BUNDLED_ODOO" "$odoo_action"
replicate_provider_skill afyx-engineering-expert 'Afyx Engineering Expert' "$BUNDLED_EXPERT" "$expert_action"

graph_result=skipped
graph_action="$(component_action afyx-graph 'Afyx Graph' "$afyx_graph_state" "$(component_version afyx-graph)")"
if [[ "$graph_action" != skip ]]; then
  graph_args=()
  [[ "$graph_action" == update ]] && graph_args+=(--update)
  [[ "$graph_action" == repair ]] && graph_args+=(--replace)
  "$offline" && graph_args+=(--offline)
  "$no_build_fallback" && graph_args+=(--no-build-fallback)
  "$allow_dirty_source" && graph_args+=(--allow-dirty-source)
  if "$skip_graph_mcp" || "$skip_provider_configuration" || [[ ",$provider_list," != *,codex,* ]]; then graph_args+=(--skip-mcp); else graph_args+=(--configure-mcp); fi
  "$dry_run" && graph_args+=(--validate-only)
  bash "$PACKAGE_ROOT/scripts/install-afyx-graph.sh" "${graph_args[@]}"
  graph_result="$graph_action"
fi

if ! "$skip_graph_mcp" && ! "$skip_provider_configuration" && [[ ",$provider_list," == *,antigravity,* ]]; then
  node_cmd="$(command -v node || command -v node.exe || true)"
  if "$dry_run"; then printf 'Dry-run: would configure Antigravity MCP at %s scope.\n' "$provider_scope"
  elif [[ -z "$node_cmd" ]]; then printf 'Node.js is required for Antigravity provider configuration.\n' >&2; exit 1
  elif [[ -f "$graph_root/current/lib/dist/bin/afyx-graph.js" ]]; then
    provider_args=("$PACKAGE_ROOT/scripts/afyx-provider-integration.mjs" --providers antigravity --scope "$provider_scope" --workspace-root "$workspace_root" --gemini-home "$gemini_home" --node "$node_cmd" --entry "$graph_root/current/lib/dist/bin/afyx-graph.js")
    provider_json="$("$node_cmd" "${provider_args[@]}" --apply)" || { printf 'Antigravity provider configuration failed: %s\n' "$provider_json" >&2; exit 1; }
    printf 'Antigravity provider: %s\n' "$(printf '%s' "$provider_json" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
  elif [[ "$graph_action" != skip ]]; then printf 'Installed Graph entry is unavailable for Antigravity configuration.\n' >&2; exit 1
  fi
fi

if ! "$skip_graph_mcp" && ! "$skip_provider_configuration" && [[ ",$provider_list," == *,claude,* ]]; then
  node_cmd="$(command -v node || command -v node.exe || true)"
  if "$dry_run"; then printf 'Dry-run: would configure Claude Code MCP at %s scope.\n' "$provider_scope"
  elif [[ -z "$node_cmd" ]]; then printf 'Node.js is required for Claude Code provider configuration.\n' >&2; exit 1
  elif [[ -f "$graph_root/current/lib/dist/bin/afyx-graph.js" ]]; then
    claude_cmd="$(command -v claude || true)"
    claude_args=("$PACKAGE_ROOT/scripts/afyx-provider-integration.mjs" --providers claude --scope "$provider_scope" --workspace-root "$workspace_root" --node "$node_cmd" --entry "$graph_root/current/lib/dist/bin/afyx-graph.js")
    if [[ -n "$claude_cmd" ]]; then claude_args+=(--claude "$claude_cmd"); elif "$claude_vscode_detected"; then claude_args+=(--claude-extension); fi
    [[ -n "$claude_config_dir" ]] && claude_args+=(--claude-config-dir "$claude_config_dir")
    provider_json="$("$node_cmd" "${claude_args[@]}" --apply)" || { printf 'Claude Code provider configuration failed: %s\n' "$provider_json" >&2; exit 1; }
    printf 'Claude Code provider: %s\n' "$(printf '%s' "$provider_json" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
  elif [[ "$graph_action" != skip ]]; then printf 'Installed Graph entry is unavailable for Claude Code configuration.\n' >&2; exit 1
  fi
fi

context_result=skipped
context_action="$(component_action afyx-context 'Afyx Context Engine' "$afyx_context_state" "$(component_version afyx-context)")"
if [[ "$context_action" != skip ]]; then
  context_args=(--runtime-root "$context_root")
  [[ "$context_action" == update ]] && context_args+=(--update)
  [[ "$context_action" == repair ]] && context_args+=(--repair)
  "$dry_run" && context_args+=(--validate-only)
  bash "$PACKAGE_ROOT/scripts/install-afyx-context.sh" "${context_args[@]}"
  context_result="$context_action"
fi

# Provider companion: visible on installed supported skill surfaces and invoked
# only when Context optimization is useful. This does not intercept Graph MCP.
context_companion_desired=false
if [[ "$skip_provider_configuration" == false && "${AFYX_CONTEXT_OPT_IN:-}" != 0 ]]; then
  if [[ -n "$preset" ]]; then
    afyx_component_desired afyx-context "$preset" "$custom_component_list" "$provider_list" && context_companion_desired=true
  elif [[ "$context_action" != skip ]]; then context_companion_desired=true; fi
fi
if "$context_companion_desired" && { [[ "$context_action" != skip ]] || [[ "$afyx_context_state" == HEALTHY ]]; }; then
  context_skill_source="$PACKAGE_ROOT/skills/afyx-context"
  valid_manifest "$context_skill_source" || { printf 'Invalid Afyx Context provider companion.\n' >&2; exit 1; }
  for context_skill_root in "$skills_root" ${additional_skill_roots[@]+"${additional_skill_roots[@]}"}; do
    context_skill_target="$context_skill_root/afyx-context"
    afyx_classify_skill "$context_skill_target" afyx-context afyx
    case "$AFYX_OWNERSHIP_STATE" in
      NOT_INSTALLED) context_skill_replace=false ;;
      AFYX_OWNED_UNMODIFIED)
        if [[ "$(afyx_skill_version "$context_skill_target")" == "$(afyx_skill_version "$context_skill_source")" ]]; then
          printf 'Afyx Context Companion [%s]: skipped\n' "$context_skill_root"
          continue
        fi
        context_skill_replace=true
        ;;
      *) printf 'Refusing automatic ACE companion replacement at %s because ownership is %s.\n' "$context_skill_target" "$AFYX_OWNERSHIP_STATE" >&2; exit 1 ;;
    esac
    # safe_skill_install uses skills_root for its ownership boundary; override
    # it only in the subshell for the currently selected provider root.
    context_skill_result="$(skills_root="$context_skill_root"; safe_skill_install afyx-context 'Afyx Context Companion' "$context_skill_source" "$context_skill_target" "$context_skill_replace")"
    printf 'Afyx Context Companion [%s]: %s\n' "$context_skill_root" "$context_skill_result"
  done
fi

forge_result=skipped
forge_action="$(component_action afyx-forge 'Afyx Forge Core' "$afyx_forge_state" "$(component_version afyx-forge)")"
if [[ "$forge_action" != skip ]]; then
  forge_args=(--runtime-root "$forge_root")
  [[ "$forge_action" == update ]] && forge_args+=(--update)
  [[ "$forge_action" == repair ]] && forge_args+=(--repair)
  "$dry_run" && forge_args+=(--validate-only)
  bash "$PACKAGE_ROOT/scripts/install-afyx-forge.sh" "${forge_args[@]}"
  forge_result="$forge_action"
fi

forge_companion_desired=false
if [[ "$skip_provider_configuration" == false ]]; then
  if [[ -n "$preset" ]]; then
    afyx_component_desired afyx-forge "$preset" "$custom_component_list" "$provider_list" && forge_companion_desired=true
  elif [[ "$forge_action" != skip ]]; then forge_companion_desired=true; fi
fi
if "$forge_companion_desired" && { [[ "$forge_action" != skip ]] || [[ "$afyx_forge_state" == HEALTHY ]]; }; then
  forge_skill_source="$PACKAGE_ROOT/skills/afyx-forge"
  valid_manifest "$forge_skill_source" || { printf 'Invalid Afyx Forge provider companion.\n' >&2; exit 1; }
  for forge_skill_root in "$skills_root" ${additional_skill_roots[@]+"${additional_skill_roots[@]}"}; do
    forge_skill_target="$forge_skill_root/afyx-forge"
    afyx_classify_skill "$forge_skill_target" afyx-forge afyx
    case "$AFYX_OWNERSHIP_STATE" in
      NOT_INSTALLED) forge_skill_replace=false ;;
      AFYX_OWNED_UNMODIFIED)
        if [[ "$(afyx_skill_version "$forge_skill_target")" == "$(afyx_skill_version "$forge_skill_source")" ]]; then
          printf 'Afyx Forge Companion [%s]: skipped\n' "$forge_skill_root"
          continue
        fi
        forge_skill_replace=true
        ;;
      *) printf 'Refusing automatic Forge companion replacement at %s because ownership is %s.\n' "$forge_skill_target" "$AFYX_OWNERSHIP_STATE" >&2; exit 1 ;;
    esac
    forge_skill_result="$(skills_root="$forge_skill_root"; safe_skill_install afyx-forge 'Afyx Forge Companion' "$forge_skill_source" "$forge_skill_target" "$forge_skill_replace")"
    printf 'Afyx Forge Companion [%s]: %s\n' "$forge_skill_root" "$forge_skill_result"
  done
fi

printf '\nInstallation Summary\n[%s] Efficient Coding\n[%s] Odoo Engineering\n[%s] Afyx Engineering Expert\n[%s] Afyx Graph\n[%s] Afyx Context Engine\n[%s] Afyx Forge Core\n[SKIPPED] Usage Tracking (Windows-only)\n' "$efficient_result" "$odoo_result" "$expert_result" "$graph_result" "$context_result" "$forge_result"
"$dry_run" && printf 'Dry-run completed; no files or configuration were changed.\n' || printf 'Start a new Codex session to load installed components.\n'
