#!/usr/bin/env bash
set -euo pipefail

readonly ENGINE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly CONTRACT="$ENGINE_ROOT/scripts/distribution-contract.mjs"
readonly ARCHIVE_BUILDER="$ENGINE_ROOT/scripts/deterministic-archive.mjs"
readonly ARTIFACT_IDENTITY="$ENGINE_ROOT/../../scripts/afyx-graph-artifact.mjs"
readonly TARGET="${1:?usage: build-bundle.sh <target>}"
readonly RELEASE_ROOT="$ENGINE_ROOT/release"
readonly TEMP_ROOT="$(mktemp -d)"
readonly FAMILY="${TARGET%-*}"
readonly BUNDLE_NAME="$(node "$CONTRACT" plan --target "$TARGET" --field bundleName)"
readonly STAGE="$TEMP_ROOT/$BUNDLE_NAME"
readonly SOURCE_REVISION="${AFYX_SOURCE_REVISION:-$(git -C "$ENGINE_ROOT" rev-parse HEAD 2>/dev/null || printf UNKNOWN)}"
readonly EXTRACTION_VERSION="$(sed -n 's/^export const EXTRACTION_VERSION = \([0-9][0-9]*\);/\1/p' "$ENGINE_ROOT/src/extraction/extraction-version.ts")"
ARCHIVE=""

cleanup() { rm -rf "$TEMP_ROOT"; }
trap cleanup EXIT

validate_target() {
  node "$CONTRACT" plan --target "$TARGET" >/dev/null
}

build_application() { echo "[bundle] building app from a clean dist"; (cd "$ENGINE_ROOT" && npm run build:clean >/dev/null); }

stage_application() {
  mkdir -p "$STAGE/lib" "$STAGE/bin"
  cp -R "$ENGINE_ROOT/dist" "$STAGE/lib/dist"
  cp "$ENGINE_ROOT/package.json" "$STAGE/lib/"
  cp "$ENGINE_ROOT/../afyx-graph.json" "$STAGE/metadata.json"
  node -e 'const fs=require("node:fs"); const metadata=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const product=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); metadata.release_channel=product.releaseChannel; fs.writeFileSync(process.argv[1], JSON.stringify(metadata,null,2)+"\n");' "$STAGE/metadata.json" "$ENGINE_ROOT/scripts/distribution-product.json"
  node "$ARTIFACT_IDENTITY" stamp --metadata "$STAGE/metadata.json" --target "$TARGET" --revision "$SOURCE_REVISION" --extraction-version "$EXTRACTION_VERSION" >/dev/null
  # Required attribution contract is owned by the artifact plan.
  while IFS='|' read -r source destination; do
    mkdir -p "$STAGE/$(dirname "$destination")"
    cp "$ENGINE_ROOT/$source" "$STAGE/$destination"
  done < <(node "$CONTRACT" legal-files)
}

write_launcher() {
  if [ "$FAMILY" = "win32" ]; then
    printf '@echo off\r\nwhere node >nul 2>&1\r\nif errorlevel 1 (\r\n  echo [Afyx Graph] Node.js was not found on PATH. Install Node.js 22.5.0 or newer: https://nodejs.org/ 1>&2\r\n  exit /b 1\r\n)\r\nnode --disable-warning=ExperimentalWarning "%%~dp0..\\lib\\dist\\bin\\afyx-graph.js" %%*\r\nexit /b %%ERRORLEVEL%%\r\n' > "$STAGE/bin/afyx-graph.cmd"
    return
  fi
  cat > "$STAGE/bin/afyx-graph" <<'LAUNCHER'
#!/bin/sh
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '[Afyx Graph] Node.js was not found on PATH. Install Node.js 22.5.0 or newer: https://nodejs.org/' >&2
  exit 1
fi
SELF="$0"
while [ -L "$SELF" ]; do
  link="$(readlink "$SELF")"
  case "$link" in /*) SELF="$link" ;; *) SELF="$(dirname "$SELF")/$link" ;; esac
done
BUNDLE_DIR="$(cd "$(dirname "$SELF")/.." && pwd)"
AFYX_GRAPH_HOST_PPID="${AFYX_GRAPH_HOST_PPID:-$PPID}"
export AFYX_GRAPH_HOST_PPID
exec node --disable-warning=ExperimentalWarning "$BUNDLE_DIR/lib/dist/bin/afyx-graph.js" "$@"
LAUNCHER
  chmod +x "$STAGE/bin/afyx-graph"
}

archive_bundle() {
  mkdir -p "$RELEASE_ROOT"
  if [ "$FAMILY" = "win32" ]; then
    ARCHIVE="$RELEASE_ROOT/$BUNDLE_NAME.zip"
  else
    ARCHIVE="$RELEASE_ROOT/$BUNDLE_NAME.tar.gz"
  fi
  node "$ARCHIVE_BUILDER" --source "$STAGE" --target "$TARGET" --output "$ARCHIVE" >/dev/null
  echo "[bundle] wrote $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
}

validate_target
echo "[bundle] target=$TARGET runtime=external-node"
build_application
stage_application
write_launcher
node "$CONTRACT" verify-bundle --root "$STAGE" --target "$TARGET" >/dev/null
archive_bundle
