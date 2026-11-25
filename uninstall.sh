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
non_interactive=false
purge_backups=false
prune_backups=false
selected_components=()
selected_component_count=0
remove_provider_configuration=false
provider_list=codex
provider_scope=global
workspace_root="$PWD"
codex_home="${CODEX_HOME:-$HOME/.codex}"
gemini_home="${AFYX_GEMINI_HOME:-$HOME/.gemini}"
claude_home="${CLAUDE_CONFIG_DIR:-${CLAUDE_HOME:-$HOME/.claude}}"
claude_config_dir="${CLAUDE_CONFIG_DIR:-}"

printf 'Afyx Engineering Kit v1.1.0 — Linux/macOS uninstaller (Bash)\n'

usage() {
  printf '%s\n' 'Usage: ./uninstall.sh [--skills-root PATH] [--context-runtime-root PATH] [--forge-runtime-root PATH] [--component AFYX-SKILL-ID] [--remove-provider-configuration] [--provider codex|antigravity|claude[,..]] [--provider-scope global|workspace] [--workspace-root PATH] [--gemini-home PATH] [--claude-home PATH] [--claude-config-dir PATH] [--remove-afyx-graph] [--remove-afyx-context] [--remove-afyx-forge] [--all] [--purge-backups | --prune-backups] [--non-interactive] [--dry-run]'
}

source "$root/scripts/lib/afyx-cli-options.sh"
seen_value_options=' '
while (($#)); do
  case "$1" in
    --skills-root|--context-runtime-root|--forge-runtime-root|--provider|--provider-scope|--workspace-root|--gemini-home|--claude-home|--claude-config-dir)
      afyx_require_single_option_value "$@" || exit 2
      ;;
  esac
  case "$1" in
    --skills-root) afyx_require_option_value "$@" || exit 2; skills_root="$2"; skills_root_explicit=true; shift 2 ;;
    --component) afyx_require_option_value "$@" || exit 2; selected="$2"; case "$selected" in efficient-coding|odoo-engineering) selected="afyx-$selected" ;; esac; selected_components+=("$selected"); selected_component_count=$((selected_component_count + 1)); shift 2 ;;
    --context-runtime-root) afyx_require_option_value "$@" || exit 2; context_root="$2"; shift 2 ;;
    --forge-runtime-root) afyx_require_option_value "$@" || exit 2; forge_root="$2"; shift 2 ;;
    --remove-prompt-master) remove_prompt_master=true; shift ;;
    --remove-afyx-graph) remove_afyx_graph=true; shift ;;
    --remove-afyx-context) remove_afyx_context=true; shift ;;
    --remove-afyx-forge) remove_afyx_forge=true; shift ;;
    --all) remove_afyx_graph=true; remove_afyx_context=true; remove_afyx_forge=true; shift ;;
    --remove-provider-configuration) remove_provider_configuration=true; shift ;;
    --provider) afyx_require_option_value "$@" || exit 2; provider_list="$2"; shift 2 ;;
    --provider-scope) afyx_require_option_value "$@" || exit 2; provider_scope="$2"; shift 2 ;;
    --workspace-root) afyx_require_option_value "$@" || exit 2; workspace_root="$2"; shift 2 ;;
    --gemini-home) afyx_require_option_value "$@" || exit 2; gemini_home="$2"; shift 2 ;;
    --claude-home) afyx_require_option_value "$@" || exit 2; claude_home="$2"; shift 2 ;;
    --claude-config-dir) afyx_require_option_value "$@" || exit 2; claude_config_dir="$2"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --non-interactive|-y|--yes) non_interactive=true; shift ;;
    --purge-backups) purge_backups=true; shift ;;
    --prune-backups) prune_backups=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done
case "$provider_scope" in global|workspace) ;; *) printf 'Unknown provider scope: %s\n' "$provider_scope" >&2; exit 2 ;; esac
old_ifs=$IFS; IFS=','
for provider_id in $provider_list; do case "$provider_id" in codex|antigravity|claude) ;; *) printf 'Unknown provider: %s\n' "$provider_id" >&2; exit 2 ;; esac; done
IFS=$old_ifs
if [[ "$skills_root_explicit" == false && "$provider_scope" == workspace && ",$provider_list," == *,antigravity,* ]]; then
  skills_root="$workspace_root/.agents/skills"
fi
additional_skill_roots=()
if [[ ",$provider_list," == *,codex,* ]]; then
  codex_home_skills="$codex_home/skills"
  [[ "$skills_root" == "$codex_home_skills" ]] || additional_skill_roots+=("$codex_home_skills")
fi
if [[ "$provider_scope" == global && ",$provider_list," == *,antigravity,* ]]; then
  antigravity_config_skills="$gemini_home/config/skills"
  antigravity_cli_skills="$gemini_home/antigravity-cli/skills"
  antigravity_ide_skills="$gemini_home/antigravity/skills"
  if [[ "$skills_root_explicit" == false && "$provider_list" == antigravity ]]; then skills_root="$antigravity_config_skills"; fi
  [[ "$skills_root" == "$antigravity_config_skills" ]] || additional_skill_roots+=("$antigravity_config_skills")
  [[ "$skills_root" == "$antigravity_cli_skills" ]] || additional_skill_roots+=("$antigravity_cli_skills")
  [[ "$skills_root" == "$antigravity_ide_skills" ]] || additional_skill_roots+=("$antigravity_ide_skills")
fi
if [[ "$provider_scope" == global && ",$provider_list," == *,claude,* ]]; then
  claude_skills="$claude_home/skills"
  [[ "$skills_root" == "$claude_skills" ]] || additional_skill_roots+=("$claude_skills")
elif [[ "$provider_scope" == workspace && ",$provider_list," == *,claude,* ]]; then
  claude_skills="$workspace_root/.claude/skills"
  [[ "$skills_root" == "$claude_skills" ]] || additional_skill_roots+=("$claude_skills")
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
  for selected in ${selected_components[@]+"${selected_components[@]}"}; do [[ "$selected" == "$wanted" ]] && return 0; done
  return 1
}
if ((selected_component_count > 0)); then
  for selected in ${selected_components[@]+"${selected_components[@]}"}; do
    case "$selected" in prompt-master|headroom) retired_component_error "$selected" ;; esac
    [[ "$(afyx_component_field "$selected" type)" == skill && "$(afyx_component_field "$selected" ownership)" == afyx ]] || {
      printf 'Unknown or non-removable Afyx skill component: %s\n' "$selected" >&2
      exit 2
    }
  done
fi
if "$purge_backups" && "$prune_backups"; then
  printf 'Choose either --purge-backups or --prune-backups.\n' >&2
  exit 2
fi
if "$purge_backups" && ! "$dry_run" && ! "$non_interactive" && [[ "${AFYX_NONINTERACTIVE:-}" != 1 ]]; then
  if [[ ! -t 0 ]]; then
    printf 'Use --non-interactive to authorize backup purge without a terminal.\n' >&2
    exit 2
  fi
  printf 'Remove all completed, verified AFYX backups in scope? [y/N] '
  read -r answer
  [[ "$answer" == y || "$answer" == Y ]] || exit 2
fi
if "$purge_backups" || "$prune_backups"; then
  afyx_assert_backup_path "$afyx_backup_root" || exit 1
  if [[ -e "$afyx_backup_root" ]]; then
    backup_root_physical="$(cd -- "$afyx_backup_root" && pwd -P)" || exit 1
    if [[ "$backup_root_physical" == / || "$backup_root_physical" =~ ^/[a-zA-Z]$ ]]; then
      printf 'Refusing unsafe backup purge root.\n' >&2
      exit 1
    fi
  fi
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
    else (skills_root="$additional_root"; afyx_remove_skill "$component_id" "$target" afyx); fi
  done
done
if "$remove_provider_configuration"; then
  provider_args=("$root/scripts/afyx-provider-integration.mjs" --providers "$provider_list" --scope "$provider_scope" --workspace-root "$workspace_root" --gemini-home "$gemini_home" --codex-home "$codex_home" --node "$(command -v node)" --entry "$graph_root/current/lib/dist/bin/afyx-graph.js" --uninstall)
  command -v codex >/dev/null 2>&1 && provider_args+=(--codex "$(command -v codex)")
  if command -v claude >/dev/null 2>&1; then provider_args+=(--claude "$(command -v claude)"); else
    for extension in "$HOME"/.vscode/extensions/anthropic.claude-code-*; do [[ -d "$extension" ]] && { provider_args+=(--claude-extension); break; }; done
  fi
  [[ -n "$claude_config_dir" ]] && provider_args+=(--claude-config-dir "$claude_config_dir")
  if "$dry_run"; then printf 'Dry-run: would remove only Afyx-owned provider MCP entries at %s scope.\n' "$provider_scope"
  else provider_json="$(node ${provider_args[@]+"${provider_args[@]}"} --apply)" || { printf 'Provider removal failed: %s\n' "$provider_json" >&2; exit 1; }; fi
fi
if [[ -e "$graph_root" ]]; then
  if ! "$remove_afyx_graph" && ! "$non_interactive" && [[ -t 0 && -z "${CI:-}" ]] && ! "$dry_run"; then
    read -r -p 'Afyx Graph detected. Remove Afyx Graph? [Y/N] [N]: ' answer || answer=
    case "$answer" in [yY]|[yY][eE][sS]) remove_afyx_graph=true ;; esac
  fi
  if "$remove_afyx_graph"; then
    if "$dry_run"; then printf '+ scripts/install-afyx-graph.sh --uninstall\n'; else bash "$root/scripts/install-afyx-graph.sh" --uninstall; fi
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
  if "$dry_run"; then bash "$root/scripts/install-afyx-context.sh" --runtime-root "$context_root" --validate-only
  else bash "$root/scripts/install-afyx-context.sh" --runtime-root "$context_root" --uninstall; fi
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
  if "$dry_run"; then bash "$root/scripts/install-afyx-forge.sh" --runtime-root "$forge_root" --validate-only
  else bash "$root/scripts/install-afyx-forge.sh" --runtime-root "$forge_root" --uninstall; fi
elif [[ -e "$forge_root" ]]; then printf 'Afyx Forge Core: kept\n'; fi
if "$purge_backups" || "$prune_backups"; then
  backup_keep=0
  if "$prune_backups"; then backup_keep=5; fi
  for component_id in $(afyx_component_ids); do
    [[ "$(afyx_component_field "$component_id" type)" == skill && "$(afyx_component_field "$component_id" ownership)" == afyx ]] || continue
    component_selected "$component_id" || continue
    afyx_purge_skill_backups "$component_id" "$dry_run" "$backup_keep"
  done
fi

preserved_dirs=()
[[ -e "$graph_root" ]] && preserved_dirs+=("$graph_root")
[[ -e "$context_root" ]] && preserved_dirs+=("$context_root")
[[ -e "$forge_root" ]] && preserved_dirs+=("$forge_root")
[[ -e "$afyx_backup_root" ]] && preserved_dirs+=("$afyx_backup_root")
if ((${#preserved_dirs[@]} > 0)); then
  printf 'Preserved directories: %s\n' "${preserved_dirs[*]}"
  printf 'For a complete wipe, run: npx afyx-engineering-kit uninstall --all --purge-backups\n'
fi

printf 'ACE user state, project indexes, external software, and Codex configuration were not changed.\n'
