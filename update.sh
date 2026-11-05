#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
printf 'Afyx Codex Engineering Kit — Linux/macOS updater (Bash)\n'
skip_self_update=false
dry_run=false
offline=false
args=()
while (($#)); do
  case "$1" in
    --skip-self-update) skip_self_update=true; shift ;;
    --dry-run) dry_run=true; args+=("--dry-run"); shift ;;
    --offline) offline=true; args+=("--offline"); shift ;;
    *) args+=("$1"); shift ;;
  esac
done

previous=
for argument in "${args[@]}"; do
  if [[ "$previous" == --custom-component ]]; then
    case "$argument" in prompt-master|headroom) printf "Component '%s' is retired from Afyx Kit and remains externally/user managed; no changes were made.\n" "$argument" >&2; exit 2 ;; esac
  elif [[ "$previous" == --component ]]; then
    case "$argument" in prompt-master=*|headroom=*) component="${argument%%=*}"; printf "Component '%s' is retired from Afyx Kit and remains externally/user managed; no changes were made.\n" "$component" >&2; exit 2 ;; esac
  fi
  case "$argument" in --custom-component|--component) previous="$argument" ;; *) previous= ;; esac
done

if "$offline"; then
  printf 'Offline mode: self-update skipped; using the current local source intentionally.\n'
elif "$skip_self_update"; then
  printf 'Self-update skipped by --skip-self-update; using current local source intentionally.\n'
else
  if ! command -v git >/dev/null 2>&1; then
    printf '[ERROR] Git executable not found. Self-update cannot be performed. Re-run with --skip-self-update only if using the current checkout intentionally.\n' >&2
    exit 1
  fi
  if ! git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '[INFO] Self-update unavailable: source directory is not a Git repository. Continuing with current source.\n'
  else
    if ! status="$(git -C "$root" status --porcelain)"; then
      printf '[ERROR] Unable to inspect Git worktree status; updater aborted.\n' >&2
      exit 1
    fi
    if [[ -n "$status" ]]; then
      printf '[ERROR] Local changes detected. Self-update and installation aborted. Run git status to handle local changes, or intentionally use ./update.sh --skip-self-update.\n' >&2
      exit 1
    fi
    if "$dry_run"; then
      printf 'Dry-run: skipping git pull --ff-only; repository will not be modified.\n'
    else
      if ! git -C "$root" pull --ff-only; then
        printf '[ERROR] Self-update failed; installer was not run.\n' >&2
        exit 1
      fi
    fi
  fi
fi

set +e
"$root/install.sh" --update-installed "${args[@]}"
installer_exit_code=$?
set -e
if ((installer_exit_code != 0)); then exit "$installer_exit_code"; fi
exit 0
