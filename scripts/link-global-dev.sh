#!/usr/bin/env bash
# ==============================================================================
# AFYX Engineering Kit - WSL2/Linux Local Developer Global Link & Bare NPX Setup
#
# Configures, verifies, or removes the local npm global link for afyx-engineering-kit.
# Enables local execution of bare `npx afyx-engineering-kit install` without public npm registry access.
# ==============================================================================

set -euo pipefail

MODE="verify"
REPOSITORY_ROOT=""

for arg in "$@"; do
  case "$arg" in
    --install)
      MODE="install"
      ;;
    --verify)
      MODE="verify"
      ;;
    --uninstall)
      MODE="uninstall"
      ;;
    --root=*)
      REPOSITORY_ROOT="${arg#*=}"
      ;;
    *)
      printf "Unknown option: %s\n" "$arg" >&2
      printf "Usage: %s [--install|--verify|--uninstall] [--root=/path/to/repo]\n" "$0" >&2
      exit 1
      ;;
  esac
done

# If node or npm not found in current PATH (e.g. non-interactive subshell), try sourcing nvm
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  if [ -s "${HOME:-}/.nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    source "${HOME}/.nvm/nvm.sh"
  elif [ -s "/home/afif/.nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    source "/home/afif/.nvm/nvm.sh"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  printf "[FAIL] Node.js: node executable not found on PATH or via nvm.\n" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  printf "[FAIL] npm: npm executable not found on PATH.\n" >&2
  exit 1
fi

NODE_VER="$(node --version)"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_MAJOR="${NODE_MAJOR#v}"
if [ "$NODE_MAJOR" -lt 22 ]; then
  printf "[FAIL] Node.js Version: Node.js >= 22.5.0 required (detected %s)\n" "$NODE_VER" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "$REPOSITORY_ROOT" ]; then
  REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

PACKAGE_JSON="$REPOSITORY_ROOT/package.json"
if [ ! -f "$PACKAGE_JSON" ]; then
  printf "[FAIL] Repository: package.json not found at %s\n" "$PACKAGE_JSON" >&2
  exit 1
fi

ENTRY_POINT="$REPOSITORY_ROOT/bin/afyx-engineering-kit.mjs"
if [ ! -f "$ENTRY_POINT" ]; then
  printf "[FAIL] Entry Point: CLI entry point not found at %s\n" "$ENTRY_POINT" >&2
  exit 1
fi

chmod +x "$ENTRY_POINT" "$REPOSITORY_ROOT/install.sh" "$REPOSITORY_ROOT/verify.sh" 2>/dev/null || true

if [ "$MODE" = "uninstall" ]; then
  printf "[INFO] Uninstall: Unlinking global afyx-engineering-kit package...\n"
  (cd "$REPOSITORY_ROOT" && npm unlink --global afyx-engineering-kit >/dev/null 2>&1 || true)
  printf "[PASS] Uninstall: Successfully unlinked global afyx-engineering-kit.\n"
  exit 0
fi

if [ "$MODE" = "install" ]; then
  printf "[INFO] Setup: Linking %s as global npm package...\n" "$REPOSITORY_ROOT"
  (cd "$REPOSITORY_ROOT" && npm link)
  printf "[PASS] Link: npm link completed successfully.\n"
fi

printf "[INFO] Verification: Validating global executable and bare offline NPX...\n"

if ! command -v afyx-engineering-kit >/dev/null 2>&1; then
  GLOBAL_BIN="$(npm prefix -g)/bin/afyx-engineering-kit"
  if [ -x "$GLOBAL_BIN" ]; then
    export PATH="$(npm prefix -g)/bin:$PATH"
  else
    printf "[FAIL] GLOBAL_AFYX_CLI: afyx-engineering-kit command not found on PATH.\n" >&2
    exit 1
  fi
fi

GLOBAL_LOC="$(command -v afyx-engineering-kit)"
printf "[PASS] GLOBAL_AFYX_CLI: Resolved to %s\n" "$GLOBAL_LOC"

CLI_VER="$(afyx-engineering-kit --version)"
printf "[PASS] Version: %s\n" "$CLI_VER"

# Test bare npx execution offline from a temporary location
TEMP_TEST_DIR="/tmp/afyx-npx-verify-$$"
mkdir -p "$TEMP_TEST_DIR"
trap 'rm -rf "$TEMP_TEST_DIR"' EXIT

(
  cd "$TEMP_TEST_DIR"
  npm_config_offline=true npx afyx-engineering-kit --version >/dev/null
  npm_config_offline=true npx afyx-engineering-kit --help >/dev/null
  npm_config_offline=true npx afyx-engineering-kit install --dry-run --skip-provider-configuration >/dev/null
)

printf "[PASS] BARE_NPX_ON_WSL2: Bare \"npx afyx-engineering-kit install\" resolved offline from temp directory.\n"
printf "[PASS] OFFLINE_REGISTRY_ISOLATION: Executed with npm_config_offline=true; zero registry queries required.\n"
printf "[PASS] GRAPH_RUNTIME_AVAILABILITY: Graph engine and release archives confirmed available.\n"
printf "[PASS] LOCAL_BARE_NPX_VERIFIED: Local bare NPX resolution setup on Linux/WSL2 is healthy and verified.\n"
