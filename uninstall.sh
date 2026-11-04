#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
skills_root="${CODEX_SKILLS_ROOT:-$HOME/.agents/skills}"
skills_root_explicit=false
remove_prompt_master=false
remove_afyx_graph=false
remove_afyx_context=false
remove_afyx_forge=false
context_root="${AFYX_CONTEXT_RUNTIME_ROOT:-$HOME/.afyx/context}"
forge_root="${AFYX_FORGE_RUNTIME_ROOT:-$HOME/.afyx/forge}"
dry_run=false
selected_components=()
selected_component_count=0
remove_provider_configuration=false
provider_list=codex
provider_scope=global
workspace_root="$PWD"
gemini_home="${AFYX_GEMINI_HOME:-$HOME/.gemini}"

printf 'Afyx Codex Engineering Kit — Linux/macOS uninstaller (Bash)\n'

usage() {
  printf '%s\n' 'Usage: ./uninstall.sh [--skills-root PATH] [--context-runtime-root PATH] [--forge-runtime-root PATH] [--component AFYX-SKILL-ID] [--remove-provider-configuration] [--provider codex|antigravity[,..]] [--provider-scope global|workspace] [--workspace-root PATH] [--gemini-home PATH] [--remove-afyx-graph] [--remove-afyx-context] [--remove-afyx-forge] [--dry-run]'
}

while (($#)); do
  case "$1" in
    --skills-root) (($# >= 2)) || { printf '%s\n' '--skills-root requires a value.' >&2; exit 2; }; skills_root="$2"; skills_root_explicit=true; shift 2 ;;
    --component) (($# >= 2)) || { printf '%s\n' '--component requires a value.' >&2; exit 2; }; selected_components+=("$2"); selected_component_count=$((selected_component_count + 1)); shift 2 ;;
    --context-runtime-root) (($# >= 2)) || { printf '%s\n' '--context-runtime-root requires a value.' >&2; exit 2; }; context_root="$2"; shift 2 ;;
    --forge-runtime-root) (($# >= 2)) || { printf '%s\n' '--forge-runtime-root requires a value.' >&2; exit 2; }; forge_root="$2"; shift 2 ;;
    --remove-prompt-master) remove_prompt_master=true; shift ;;
    --remove-afyx-graph) remove_afyx_graph=true; shift ;;
    --remove-afyx-context) remove_afyx_context=true; shift ;;
    --remove-afyx-forge) remove_afyx_forge=true; shift ;;
    --remove-provider-configuration) remove_provider_configuration=true; shift ;;
    --provider) provider_list="$2"; shift 2 ;;
    --provider-scope) provider_scope="$2"; shift 2 ;;
    --workspace-root) workspace_root="$2"; shift 2 ;;
    --gemini-home) gemini_home="$2"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done
case "$provider_scope" in global|workspace) ;; *) printf 'Unknown provider scope: %s\n' "$provider_scope" >&2; exit 2 ;; esac
old_ifs=$IFS; IFS=','
for provider_id in $provider_list; do case "$provider_id" in codex|antigravity) ;; *) printf 'Unknown provider: %s\n' "$provider_id" >&2; exit 2 ;; esac; done
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

# One component truth: scripts/components.json. Only Afyx-owned skills are removable.
# shellcheck source=scripts/lib/afyx-components.sh
. "$root/scripts/lib/afyx-components.sh"
. "$root/scripts/lib/afyx-skill-lifecycle.sh"
retired_component_error() {
  printf "Component '%s' is retired from Afyx Kit and remains externally/user managed; no changes were made.\n" "$1" >&2
  exit 2
}
"$remove_prompt_master" && retired_component_error prompt-master
component_selected() {
  local wanted="$1" selected
  ((selected_component_count == 0)) && return 0
  for selected in "${selected_components[@]}"; do [[ "$selected" == "$wanted" ]] && return 0; done
  return 1
}
if ((selected_component_count > 0)); then
  for selected in "${selected_components[@]}"; do
    case "$selected" in prompt-master|headroom) retired_component_error "$selected" ;; esac
    [[ "$(afyx_component_field "$selected" type)" == skill && "$(afyx_component_field "$selected" ownership)" == afyx ]] || {
      printf 'Unknown or non-removable Afyx skill component: %s\n' "$selected" >&2
      exit 2
    }
  done
fi
for component_id in $(afyx_component_ids); do
  [[ "$(afyx_component_field "$component_id" type)" == skill ]] || continue
  ownership="$(afyx_component_field "$component_id" ownership)"
  if [[ "$ownership" == afyx ]] && component_selected "$component_id"; then
    target="$(afyx_component_root "$component_id")"
    if "$dry_run"; then
      afyx_classify_skill "$target" "$component_id" "$ownership"
      case "$AFYX_OWNERSHIP_STATE" in
        NOT_INSTALLED) ;;
        AFYX_OWNED_UNMODIFIED|EXTERNAL_UPSTREAM) printf '+ ownership-verified remove %q\n' "$target" ;;
        *) printf 'Refusing to remove %s because installed ownership is %s.\n' "$target" "$AFYX_OWNERSHIP_STATE" >&2; exit 1 ;;
      esac
    else
      afyx_remove_skill "$component_id" "$target" "$ownership"
    fi
  fi
done
for additional_root in ${additional_skill_roots[@]+"${additional_skill_roots[@]}"}; do
  for component_id in $(afyx_component_ids); do
    [[ "$(afyx_component_field "$component_id" type)" == skill && "$(afyx_component_field "$component_id" ownership)" == afyx ]] || continue
    component_selected "$component_id" || continue
    target="$additional_root/$(afyx_component_field "$component_id" install_path)"
    if "$dry_run"; then
      afyx_classify_skill "$target" "$component_id" afyx
      case "$AFYX_OWNERSHIP_STATE" in NOT_INSTALLED) ;; AFYX_OWNED_UNMODIFIED) printf '+ ownership-verified remove %q\n' "$target" ;; *) printf 'Refusing to remove %s because installed ownership is %s.\n' "$target" "$AFYX_OWNERSHIP_STATE" >&2; exit 1 ;; esac
    else afyx_remove_skill "$component_id" "$target" afyx; fi
  done
done
if "$remove_provider_configuration"; then
  provider_args=("$root/scripts/afyx-provider-integration.mjs" --providers "$provider_list" --scope "$provider_scope" --workspace-root "$workspace_root" --gemini-home "$gemini_home" --codex-home "${CODEX_HOME:-$HOME/.codex}" --node "$(command -v node)" --entry "$graph_root/current/lib/dist/bin/afyx-graph.js" --uninstall)
  command -v codex >/dev/null 2>&1 && provider_args+=(--codex "$(command -v codex)")
  if "$dry_run"; then printf 'Dry-run: would remove only Afyx-owned provider MCP entries at %s scope.\n' "$provider_scope"
  else provider_json="$(node "${provider_args[@]}" --apply)" || { printf 'Provider removal failed: %s\n' "$provider_json" >&2; exit 1; }; fi
fi
if [[ -e "$graph_root" ]]; then
  if ! "$remove_afyx_graph" && [[ -t 0 && -z "${CI:-}" ]] && ! "$dry_run"; then
    read -r -p 'Afyx Graph detected. Remove Afyx Graph? [Y/N] [N]: ' answer || answer=
    case "$answer" in [yY]|[yY][eE][sS]) remove_afyx_graph=true ;; esac
  fi
  if "$remove_afyx_graph"; then
    if "$dry_run"; then printf '+ scripts/install-afyx-graph.sh --uninstall\n'; else "$root/scripts/install-afyx-graph.sh" --uninstall; fi
  else printf 'Afyx Graph: kept\n'; fi
fi
if "$remove_afyx_context"; then
  # Separate provider companion is removed only under the explicit Context
  # uninstall operation and only after existing Afyx ownership is verified.
  for context_skill_root in "$skills_root" ${additional_skill_roots[@]+"${additional_skill_roots[@]}"}; do
    context_skill_target="$context_skill_root/afyx-context"
    if "$dry_run"; then
      afyx_classify_skill "$context_skill_target" afyx-context afyx
      case "$AFYX_OWNERSHIP_STATE" in
        NOT_INSTALLED) ;;
        AFYX_OWNED_UNMODIFIED) printf '+ ownership-verified ACE companion remove %q\n' "$context_skill_target" ;;
        *) printf 'Refusing to remove ACE companion %s because ownership is %s.\n' "$context_skill_target" "$AFYX_OWNERSHIP_STATE" >&2; exit 1 ;;
      esac
    else
      (skills_root="$context_skill_root"; afyx_remove_skill afyx-context "$context_skill_target" afyx)
    fi
  done
  if "$dry_run"; then "$root/scripts/install-afyx-context.sh" --runtime-root "$context_root" --validate-only
  else "$root/scripts/install-afyx-context.sh" --runtime-root "$context_root" --uninstall; fi
elif [[ -e "$context_root" ]]; then printf 'Afyx Context Engine: kept\n'; fi
if "$remove_afyx_forge"; then
  for forge_skill_root in "$skills_root" ${additional_skill_roots[@]+"${additional_skill_roots[@]}"}; do
    forge_skill_target="$forge_skill_root/afyx-forge"
    if "$dry_run"; then
      afyx_classify_skill "$forge_skill_target" afyx-forge afyx
      case "$AFYX_OWNERSHIP_STATE" in
        NOT_INSTALLED) ;;
        AFYX_OWNED_UNMODIFIED) printf '+ ownership-verified Forge companion remove %q\n' "$forge_skill_target" ;;
        *) printf 'Refusing to remove Forge companion %s because ownership is %s.\n' "$forge_skill_target" "$AFYX_OWNERSHIP_STATE" >&2; exit 1 ;;
      esac
    else
      (skills_root="$forge_skill_root"; afyx_remove_skill afyx-forge "$forge_skill_target" afyx)
    fi
  done
  if "$dry_run"; then "$root/scripts/install-afyx-forge.sh" --runtime-root "$forge_root" --validate-only
  else "$root/scripts/install-afyx-forge.sh" --runtime-root "$forge_root" --uninstall; fi
elif [[ -e "$forge_root" ]]; then printf 'Afyx Forge Core: kept\n'; fi
printf 'ACE user state, project indexes, external software, and Codex configuration were not changed.\n'
