#!/usr/bin/env bash
set -euo pipefail

# Afyx Engineering Doctor (Linux/macOS, Bash 3.2+). Read-only: reports component
# health from the shared contract (scripts/components.json), the environment,
# and the current project. It never installs, repairs, or writes anything, and
# it never opens the Afyx Graph database.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_path="$PWD"

usage() { printf '%s\n' 'Usage: scripts/afyx-doctor.sh [--skills-root PATH] [--project PATH]'; }
while (($#)); do
  case "$1" in
    --skills-root) skills_root="$2"; shift 2 ;;
    --project) project_path="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

# shellcheck source=scripts/lib/afyx-components.sh
. "$script_dir/lib/afyx-components.sh"

failures=0
warnings=0
line() {
  local state="$1" name="$2" detail="${3:-}"
  [[ "$state" == FAIL ]] && failures=$((failures + 1))
  [[ "$state" == WARN ]] && warnings=$((warnings + 1))
  if [[ -n "$detail" ]]; then printf '[%s] %s — %s\n' "$state" "$name" "$detail"; else printf '[%s] %s\n' "$state" "$name"; fi
  return 0
}
tool_version() { command -v "$1" >/dev/null 2>&1 || return 1; "$@" 2>/dev/null | head -n 1 || true; }

# ---- Freshness: cheap local evidence only (never opens the database) -------------------
# .afyx-graph/freshness.json is written by Afyx Graph after each index/sync:
#   { "schema_version": 1, "indexed_at": ISO-8601, "git_head": "<sha>"|null, "tracked_clean": true|false|null }
# The same rules as src/freshness.ts in the engine.
graph_freshness() {
  local root="$1" state_dir="$1/${AFYX_GRAPH_DIR:-.afyx-graph}" db meta head recorded
  db="$state_dir/afyx-graph.db"; meta="$state_dir/freshness.json"
  if [[ ! -f "$db" ]]; then FRESH_STATE=MISSING; FRESH_DETAIL='no .afyx-graph/afyx-graph.db; run "afyx-graph init"'; return 0; fi
  if [[ "$(LC_ALL=C head -c 15 "$db" 2>/dev/null || true)" != 'SQLite format 3' ]]; then FRESH_STATE=INVALID; FRESH_DETAIL='database is not a SQLite file'; return 0; fi
  if [[ ! -f "$meta" ]]; then FRESH_STATE=UNKNOWN; FRESH_DETAIL='index metadata not recorded yet; run "afyx-graph sync" with a current release'; return 0; fi
  if ! grep -q '"schema_version"' "$meta"; then FRESH_STATE=INVALID; FRESH_DETAIL='freshness.json is not valid'; return 0; fi
  if ! command -v git >/dev/null 2>&1 || [[ ! -e "$root/.git" ]]; then FRESH_STATE=UNKNOWN; FRESH_DETAIL='not a git working tree; freshness cannot be proven cheaply'; return 0; fi
  recorded="$(sed -n 's/.*"git_head"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$meta" | head -n 1)"
  if [[ -z "$recorded" ]]; then FRESH_STATE=UNKNOWN; FRESH_DETAIL='index metadata has no git head'; return 0; fi
  head="$(git -C "$root" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$head" != "$recorded" ]]; then FRESH_STATE=STALE; FRESH_DETAIL='git HEAD changed since the last index'; return 0; fi
  if [[ -n "$(git -C "$root" status --porcelain --untracked-files=no 2>/dev/null || true)" ]]; then FRESH_STATE=STALE; FRESH_DETAIL='tracked files changed since the last index'; return 0; fi
  if ! grep -Eq '"tracked_clean"[[:space:]]*:[[:space:]]*true' "$meta"; then FRESH_STATE=STALE; FRESH_DETAIL='the index was built while tracked files had uncommitted changes'; return 0; fi
  FRESH_STATE=FRESH; FRESH_DETAIL='matches git HEAD with a clean tracked tree'
}

printf 'Afyx Engineering Doctor\n'

printf '\nCORE\n'
for id in efficient-coding odoo-engineering; do
  afyx_component_evaluate "$id"
  name="$(afyx_component_field "$id" name)"
  if [[ "$AFYX_STATE" == HEALTHY ]]; then line OK "$name" "$AFYX_VERSION"; else line FAIL "$name" "$AFYX_STATE: $AFYX_DETAIL"; fi
done

printf '\nOPTIONAL\n'
afyx_component_evaluate afyx-engineering-expert
case "$AFYX_STATE" in
  HEALTHY) line OK 'Afyx Engineering Expert' "$AFYX_VERSION" ;;
  'NOT INSTALLED') line INFO 'Afyx Engineering Expert' 'not installed (optional)' ;;
  *) line WARN 'Afyx Engineering Expert' "$AFYX_STATE: $AFYX_DETAIL" ;;
esac
afyx_component_evaluate afyx-graph
case "$AFYX_STATE" in
  HEALTHY) line OK 'Afyx Graph' "$AFYX_VERSION"; printf '     State: %s\n' "$AFYX_STATE" ;;
  'NOT INSTALLED') line INFO 'Afyx Graph' 'not installed (optional)' ;;
  *) line WARN 'Afyx Graph' "$AFYX_STATE: $AFYX_DETAIL" ;;
esac
afyx_component_evaluate codex-usage-tracking
case "$AFYX_STATE" in
  HEALTHY) line OK 'Codex Usage Tracking' ;;
  'NOT INSTALLED') if [[ "$AFYX_DETAIL" == 'not installed' ]]; then line INFO 'Codex Usage Tracking' 'not installed (optional)'; else line INFO 'Codex Usage Tracking' "$AFYX_DETAIL"; fi ;;
  *) line WARN 'Codex Usage Tracking' "$AFYX_STATE: $AFYX_DETAIL" ;;
esac
printf '\nENVIRONMENT\n'
codex_version="$(tool_version codex --version || true)"
extension_detected=false
for extension in "$HOME"/.vscode/extensions/openai.chatgpt-*; do [[ -d "$extension" ]] && { extension_detected=true; break; }; done
if [[ -n "$codex_version" ]]; then line OK 'Codex CLI' "$codex_version"; else line INFO 'Codex CLI' 'not found'; fi
if "$extension_detected"; then line OK 'VS Code extension' 'detected'; else line INFO 'VS Code extension' 'not detected'; fi
if [[ -z "$codex_version" ]] && ! "$extension_detected"; then line FAIL 'Codex host' 'neither Codex CLI nor the ChatGPT/Codex VS Code extension was detected'; fi
git_version="$(tool_version git --version || true)"
if [[ -n "$git_version" ]]; then line OK 'Git' "$git_version"; else line WARN 'Git' 'not found; required for source and freshness checks'; fi
python_version="$(tool_version python3 --version || tool_version python --version || true)"
if [[ -n "$python_version" ]]; then line OK 'Python' "$python_version (optional: validators and evals)"; else line INFO 'Python' 'not found (optional: validators and evals)'; fi
line OK 'Bash' "${BASH_VERSION:-unknown} ($(afyx_platform))"

printf '\nPROJECT\n'
project_json="$("$script_dir/afyx-project.sh" --path "$project_path" --format json)"
jget() { printf '%s' "$project_json" | grep -Eo "\"$1\":(\"[^\"]*\"|[^,}]*)" | head -n 1 | sed -E "s/^\"$1\"://; s/^\"//; s/\"$//"; }
project_root="$(jget project_root)"
printf '     Root: %s (%s)\n' "$project_root" "$(jget root_evidence)"
if [[ "$(jget detected)" == true ]]; then
  line OK 'Odoo detected'
  major="$(jget major_version)"
  case "$(jget version_status)" in
    proven) line OK "Version: $major" 'proven by source evidence' ;;
    inferred) line OK "Version: $major" 'inferred from repository evidence; confirm before version-specific work' ;;
    conflict) line WARN 'Version' 'conflicting evidence; do not guess (see scripts/afyx-project.sh --format text)' ;;
    unsupported) line WARN 'Version' 'outside the supported Odoo 10-20 range' ;;
    *) line WARN 'Version' 'no version evidence found' ;;
  esac
  conflicts="$(printf '%s' "$project_json" | sed -E 's/.*"conflicts":\[([^]]*)\].*/\1/' | grep -Eo '\{"source":"[^"]*","major":[0-9]+\}' || true)"
  if [[ -n "$conflicts" ]]; then
    printf '%s\n' "$conflicts" | while IFS= read -r item; do
      source="$(printf '%s' "$item" | sed -E 's/.*"source":"([^"]*)".*/\1/')"; other="$(printf '%s' "$item" | sed -E 's/.*"major":([0-9]+).*/\1/')"
      printf '[WARN] Version evidence disagrees — %s says %s\n' "$source" "$other"
    done
    warnings=$((warnings + $(printf '%s\n' "$conflicts" | grep -c .)))
  fi
  roots="$(printf '%s' "$project_json" | sed -E 's/.*"addon_roots":\[([^]]*)\].*/\1/' | tr -d '"' | sed 's/,/, /g')"
  [[ -n "$roots" ]] && printf '     Addon roots: %s\n' "$roots"
else
  line INFO "Project type: $(jget project_type)" 'no Odoo project detected'
fi
graph_freshness "$project_root"
case "$FRESH_STATE" in
  FRESH) line OK 'Afyx Graph index: FRESH' "$FRESH_DETAIL" ;;
  MISSING) line INFO 'Afyx Graph index: MISSING' "$FRESH_DETAIL" ;;
  STALE) line WARN 'Afyx Graph index: STALE' "$FRESH_DETAIL" ;;
  INVALID) line WARN 'Afyx Graph index: INVALID' "$FRESH_DETAIL" ;;
  *) line INFO "Afyx Graph index: $FRESH_STATE" "$FRESH_DETAIL" ;;
esac

printf '\n'
if ((failures > 0)); then printf 'NOT READY\n'; exit 1; fi
if ((warnings > 0)); then printf 'READY (with warnings)\n'; exit 0; fi
printf 'READY\n'
