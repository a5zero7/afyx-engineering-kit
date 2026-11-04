#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

skills_root="${CODEX_SKILLS_ROOT:-$HOME/.agents/skills}"
skills_root_explicit=false
codex_home="${CODEX_HOME:-$HOME/.codex}"
config="$codex_home/config.toml"
graph_root="${AFYX_GRAPH_RUNTIME_ROOT:-$HOME/.afyx/graph}"
context_root="${AFYX_CONTEXT_RUNTIME_ROOT:-$HOME/.afyx/context}"
forge_root="${AFYX_FORGE_RUNTIME_ROOT:-$HOME/.afyx/forge}"
core_failure=false
preset=
custom_component_list=
provider_list=codex
provider_scope=global
workspace_root="$PWD"
gemini_home="${AFYX_GEMINI_HOME:-$HOME/.gemini}"

usage() {
  printf '%s\n' 'Usage: ./verify.sh [--skills-root PATH] [--context-runtime-root PATH] [--forge-runtime-root PATH] [--provider codex|antigravity[,..]] [--provider-scope global|workspace] [--workspace-root PATH] [--gemini-home PATH] [--preset minimal|recommended|full|custom] [--custom-component ID]'
}

while (($#)); do
  case "$1" in
    --skills-root) skills_root="$2"; skills_root_explicit=true; shift 2 ;;
    --context-runtime-root) context_root="$2"; shift 2 ;;
    --forge-runtime-root) forge_root="$2"; shift 2 ;;
    --preset) preset="$2"; shift 2 ;;
    --custom-component) custom_component_list="${custom_component_list:+$custom_component_list;}$2"; shift 2 ;;
    --provider) provider_list="$2"; shift 2 ;;
    --provider-scope) provider_scope="$2"; shift 2 ;;
    --workspace-root) workspace_root="$2"; shift 2 ;;
    --gemini-home) gemini_home="$2"; shift 2 ;;
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

result() {
  local state="$1" label="$2" detail="${3:-}"
  [[ -n "$detail" ]] && printf '[%s] %s — %s\n' "$state" "$label" "$detail" || printf '[%s] %s\n' "$state" "$label"
}

# One component truth: scripts/components.json, read through the shared library.
# shellcheck source=scripts/lib/afyx-components.sh
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/lib/afyx-components.sh"
# shellcheck source=scripts/lib/afyx-skill-lifecycle.sh
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/lib/afyx-skill-lifecycle.sh"
if [[ -n "$preset" ]] && ! afyx_preset_valid "$preset"; then printf 'Unknown preset: %s\n' "$preset" >&2; exit 2; fi
if [[ -n "$custom_component_list" && "$preset" != custom ]]; then printf '%s\n' '--custom-component requires --preset custom.' >&2; exit 2; fi
old_ifs=$IFS; IFS=';'
for custom_id in $custom_component_list; do
    case "$custom_id" in
      prompt-master|headroom) printf "Component '%s' is retired from Afyx Kit and remains externally/user managed; no changes were made.\n" "$custom_id" >&2; exit 2 ;;
      efficient-coding|odoo-engineering|afyx-engineering-expert|afyx-graph|afyx-context|afyx-forge|codex-usage-tracking) ;;
      *) printf 'Unknown custom component: %s\n' "$custom_id" >&2; exit 2 ;;
    esac
done
IFS=$old_ifs

verify_component_evaluate() {
  local id="$1" owner target
  afyx_component_evaluate "$id"
  if [[ -n "$preset" && "$(afyx_component_field "$id" type)" == skill && "$AFYX_STATE" != 'NOT INSTALLED' ]]; then
    owner="$(afyx_component_field "$id" ownership)"; target="$(afyx_component_root "$id")"
    afyx_classify_skill "$target" "$id" "$owner"
    case "$AFYX_OWNERSHIP_STATE" in
      AFYX_OWNED_UNMODIFIED|EXTERNAL_UPSTREAM) ;;
      AFYX_OWNED_MODIFIED) AFYX_STATE=DRIFTED; AFYX_DETAIL='Afyx ownership verified but installed content was modified' ;;
      *) AFYX_STATE=UNKNOWN; AFYX_DETAIL="installed ownership is $AFYX_OWNERSHIP_STATE" ;;
    esac
  fi
}

printf 'Afyx Codex Engineering Kit — readiness verification (Linux/macOS Bash)\n'
for provider_id in $(afyx_provider_ids); do
  result INFO "Provider adapter: $(afyx_provider_field "$provider_id" name)" "primary=$(afyx_provider_field "$provider_id" primary); ownership=$(afyx_provider_field "$provider_id" ownership_class); capabilities=$(afyx_provider_field "$provider_id" capabilities); policy=$(afyx_provider_field "$provider_id" configuration_policy)"
done
if [[ -n "$preset" ]]; then
  result INFO 'Desired state plan' "$(afyx_control_plan_identity "$preset" "$custom_component_list" "$provider_list")"
  for plan_id in $(afyx_component_ids); do
    verify_component_evaluate "$plan_id"; plan_state="$AFYX_STATE"
    afyx_control_classify "$plan_id" "$plan_state" "$preset" "$custom_component_list" "$provider_list"
    if [[ "$AFYX_DRIFT" == IN_SYNC ]]; then result OK "Plan/$plan_id" IN_SYNC
    elif [[ "$AFYX_DRIFT" == NOT_APPLICABLE || "$AFYX_DESIRED" != true ]]; then result INFO "Plan/$plan_id" "$AFYX_DRIFT; preserved"
    else result FAIL "Plan/$plan_id" "$AFYX_DRIFT; ownership=$AFYX_ACTUAL_OWNERSHIP; repair=$AFYX_REPAIR"; core_failure=true; fi
  done
fi
for additional_root in ${additional_skill_roots[@]+"${additional_skill_roots[@]}"}; do
  for component_id in $(afyx_component_ids); do
    [[ "$(afyx_component_field "$component_id" type)" == skill && "$(afyx_component_field "$component_id" ownership)" == afyx ]] || continue
    target="$additional_root/$(afyx_component_field "$component_id" install_path)"
    desired=false
    if [[ -n "$preset" ]]; then afyx_component_desired "$component_id" "$preset" "$custom_component_list" "$provider_list" && desired=true || :; elif [[ -e "$target" ]]; then desired=true; fi
    afyx_classify_skill "$target" "$component_id" afyx
    if [[ "$AFYX_OWNERSHIP_STATE" == AFYX_OWNED_UNMODIFIED ]]; then result OK "Antigravity skill/$component_id" "$additional_root; ownership verified"
    elif [[ "$desired" == true ]]; then result FAIL "Antigravity skill/$component_id" "$additional_root; $AFYX_OWNERSHIP_STATE"; core_failure=true
    else result INFO "Antigravity skill/$component_id" "$additional_root; not selected"; fi
  done
done
case "$(uname -s)" in Darwin) verify_os=macOS ;; Linux) verify_os=Linux ;; *) verify_os="$(uname -s)"; core_failure=true ;; esac
result OK 'OS/architecture [REQUIRED]' "$verify_os / $(uname -m)"
result OK 'Platform shell [REQUIRED]' "Bash ${BASH_VERSION}"
if command -v git >/dev/null 2>&1; then result OK 'Git [REQUIRED]' "$(git --version)"; else result FAIL 'Git [REQUIRED]' 'missing; install Git with the documented OS package manager'; core_failure=true; fi
if command -v node >/dev/null 2>&1; then
  node_text="$(node --version 2>/dev/null || true)"; node_number="${node_text#v}"; node_major="${node_number%%.*}"; node_tail="${node_number#*.}"; node_minor="${node_tail%%.*}"
  if [[ "$node_major" =~ ^[0-9]+$ && "$node_minor" =~ ^[0-9]+$ ]] && ((node_major > 22 || (node_major == 22 && node_minor >= 5))); then result OK 'Node.js [COMPONENT_REQUIRED:Afyx Graph]' "$node_text"
  else result WARN 'Node.js [COMPONENT_REQUIRED:Afyx Graph]' "$node_text; requires >=22.5.0"; fi
else result INFO 'Node.js [COMPONENT_REQUIRED:Afyx Graph]' 'missing; install from https://nodejs.org/ before selecting Afyx Graph'; fi
if command -v npm >/dev/null 2>&1; then result OK 'npm [BUILD_ONLY:Afyx Graph]' "$(npm --version)"; else result INFO 'npm [BUILD_ONLY:Afyx Graph]' 'missing; required only for local artifact fallback'; fi
if command -v tar >/dev/null 2>&1 && { command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1; }; then result OK 'Archive/checksum [COMPONENT_REQUIRED:Afyx Graph]' 'tar and SHA-256 tool available'; else result WARN 'Archive/checksum [COMPONENT_REQUIRED:Afyx Graph]' 'tar or SHA-256 tool missing'; fi
codex_detected=false
if command -v codex >/dev/null 2>&1; then
  codex_detected=true
  if version="$(codex --version 2>/dev/null)"; then result OK 'Codex CLI' "$version"; else result FAIL 'Codex CLI' 'version command failed'; core_failure=true; fi
else result INFO 'Codex CLI' 'not found'; fi
extension_detected=false
for extension in "$HOME"/.vscode/extensions/openai.chatgpt-*; do [[ -d "$extension" ]] && { extension_detected=true; break; }; done
if "$extension_detected"; then result OK 'VS Code extension' 'detected'; else result INFO 'VS Code extension' 'not detected'; fi
if ! "$codex_detected" && ! "$extension_detected"; then core_failure=true; fi

required_skill_ids='efficient-coding odoo-engineering'
if [[ -n "$preset" ]]; then
  required_skill_ids=
  for component_id in $(afyx_component_ids); do
    [[ "$(afyx_component_field "$component_id" type)" == skill ]] || continue
    afyx_component_desired "$component_id" "$preset" "$custom_component_list" "$provider_list" && required_skill_ids="${required_skill_ids:+$required_skill_ids }$component_id"
  done
fi
for component_id in $required_skill_ids; do
  verify_component_evaluate "$component_id"
  component_name="$(afyx_component_field "$component_id" name)"
  if [[ "$AFYX_STATE" == HEALTHY ]]; then result OK "$component_name" "$AFYX_DETAIL"
  else result FAIL "$component_name" "$AFYX_STATE: $AFYX_DETAIL"; core_failure=true; fi
done

verify_component_evaluate afyx-engineering-expert
case "$AFYX_STATE" in
  HEALTHY) result OK 'Afyx Engineering Expert' "$AFYX_VERSION; optional skill valid" ;;
  'NOT INSTALLED') result INFO 'Afyx Engineering Expert' 'not installed (optional)' ;;
  *) result WARN 'Afyx Engineering Expert' "$AFYX_STATE: $AFYX_DETAIL (optional)" ;;
esac

verify_component_evaluate afyx-graph
case "$AFYX_STATE" in
  'NOT INSTALLED') result INFO 'Afyx Graph' 'not installed (optional)' ;;
  HEALTHY)
    graph_cli="$AFYX_PATH/current/bin/afyx-graph"
    if graph_reported="$($graph_cli --version 2>/dev/null)" && [[ "$graph_reported" == *"$AFYX_VERSION"* ]] && "$graph_cli" help >/dev/null 2>&1; then
      result OK 'Afyx Graph' "$graph_reported; executable verification passed"
    else result FAIL 'Afyx Graph' 'metadata is healthy but executable verification failed'; core_failure=true; fi
    ;;
  INCOMPLETE) result WARN 'Afyx Graph' 'incomplete Afyx-owned runtime (optional)' ;;
  INVALID) result WARN 'Afyx Graph' 'invalid metadata (optional)' ;;
  *) result WARN 'Afyx Graph' "state $AFYX_STATE: $AFYX_DETAIL (optional)" ;;
esac
if [[ "$AFYX_STATE" == HEALTHY ]] && command -v node >/dev/null 2>&1 && command -v codex >/dev/null 2>&1; then
  set +e
  integration_json="$(node "$PACKAGE_ROOT/scripts/afyx-mcp-integration.mjs" --node "$(command -v node)" --entry "$AFYX_PATH/current/lib/dist/bin/afyx-graph.js" --codex "$(command -v codex)" --codex-home "$codex_home" 2>/dev/null)"
  set -e
  integration_state="$(printf '%s' "$integration_json" | sed -n 's/.*"mcp":"\([^"]*\)".*/\1/p')"
  integration_detail="$(printf '%s' "$integration_json" | sed -n 's/.*"detail":"\([^"]*\)".*/\1/p')"
  case "$integration_state" in MCP_REACHABLE) level=OK ;; MCP_NOT_CONFIGURED) level=INFO ;; *) level=WARN ;; esac
  result "$level" 'Afyx Graph MCP' "${integration_state:-MCP_BLOCKED}: ${integration_detail:-integration status unavailable}"
elif ! command -v codex >/dev/null 2>&1; then result INFO 'Afyx Graph MCP' 'MCP_BLOCKED: Codex CLI unavailable'
elif [[ "$AFYX_STATE" != HEALTHY ]]; then result INFO 'Afyx Graph MCP' 'MCP_BLOCKED: Graph runtime unavailable'
else result INFO 'Afyx Graph MCP' 'MCP_NOT_CONFIGURED'; fi
if [[ ",$provider_list," == *,antigravity,* && "$AFYX_STATE" == HEALTHY ]] && command -v node >/dev/null 2>&1; then
  set +e
  provider_json="$(node "$PACKAGE_ROOT/scripts/afyx-provider-integration.mjs" --providers antigravity --scope "$provider_scope" --workspace-root "$workspace_root" --gemini-home "$gemini_home" --node "$(command -v node)" --entry "$AFYX_PATH/current/lib/dist/bin/afyx-graph.js" 2>/dev/null)"; provider_exit=$?
  set -e
  provider_state="$(printf '%s' "$provider_json" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
  case "$provider_state" in READY|CONFIGURED_RESTART_REQUIRED) result OK 'Antigravity MCP' "$provider_state" ;; BLOCKED) result FAIL 'Antigravity MCP' "$provider_json"; core_failure=true ;; *) result INFO 'Antigravity MCP' "${provider_state:-UNAVAILABLE}" ;; esac
  : "$provider_exit"
fi

verify_component_evaluate afyx-context
case "$AFYX_STATE" in
  'NOT INSTALLED') result INFO 'Afyx Context Engine' 'not installed (optional; explicit selection only)' ;;
  HEALTHY)
    context_cli="$AFYX_PATH/current/bin/afyx-context"
    if context_reported="$($context_cli --version 2>/dev/null)" && [[ "$context_reported" == *"$AFYX_VERSION"* ]] && "$context_cli" --help >/dev/null 2>&1; then
      result OK 'Afyx Context Engine' "$context_reported; integrity and executable verification passed; Graph integration remains OFF"
    else result FAIL 'Afyx Context Engine' 'metadata is healthy but executable verification failed'; core_failure=true; fi
    ;;
  *) result WARN 'Afyx Context Engine' "$AFYX_STATE: $AFYX_DETAIL (optional)" ;;
esac

verify_component_evaluate afyx-forge
case "$AFYX_STATE" in
  'NOT INSTALLED') result INFO 'Afyx Forge Core' 'not installed (optional; selectable via custom preset)' ;;
  HEALTHY)
    forge_cli="$AFYX_PATH/bin/afyx-forge"
    if "$PACKAGE_ROOT/scripts/install-afyx-forge.sh" --runtime-root "$AFYX_PATH" --verify >/dev/null 2>&1 && forge_reported="$("$forge_cli" --version 2>/dev/null)" && [[ "$forge_reported" == *"$AFYX_VERSION"* ]] && "$forge_cli" doctor >/dev/null 2>&1; then
      result OK 'Afyx Forge Core' "$forge_reported; integrity and executable verification passed; A8 gate remains EVALUATION_GATED"
    else result FAIL 'Afyx Forge Core' 'metadata is healthy but integrity or executable verification failed'; core_failure=true; fi
    ;;
  *) result WARN 'Afyx Forge Core' "$AFYX_STATE: $AFYX_DETAIL (optional)" ;;
esac
result INFO 'Usage Tracking' 'not installed; Windows-only runtime'
if [[ -f "$config" ]]; then result OK 'Codex config' 'read-only check completed'; else result WARN 'Codex config' 'not found; optional MCP entries unavailable'; fi

if "$core_failure"; then result FAIL 'Core readiness'; exit 1; fi
result OK 'Core readiness' 'ready; optional enhancement warnings do not affect this result'
