#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/workspace/repo/afyx-graph/engine" "$fixture/bin"
repo="$fixture/workspace/repo"
git init -q "$repo"
git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.invalid commit -q --allow-empty -m baseline
cp "$source_root/.githooks/pre-push" "$repo/pre-push"
for command in python node npm; do
  printf '#!/bin/sh\nexit 0\n' > "$fixture/bin/$command"
  chmod +x "$fixture/bin/$command"
done
printf '#!/bin/sh\nprintf "MINGW64_NT\n"\n' > "$fixture/bin/uname"
chmod +x "$fixture/bin/uname"
printf '#!/bin/sh\nprintf "called\n" >> "$TEST_MARKER"\nexit "${FAKE_HYGIENE_EXIT:-0}"\n' > "$fixture/bin/powershell.exe"
chmod +x "$fixture/bin/powershell.exe"
export TEST_MARKER="$fixture/hygiene-called"

(cd "$repo" && PATH="$fixture/bin:$PATH" bash ./pre-push) > "$fixture/absent.log" 2>&1
grep -q 'optional workspace hygiene verifier unavailable' "$fixture/absent.log"
test ! -e "$TEST_MARKER"

mkdir -p "$fixture/workspace/_afyx-admin"
: > "$fixture/workspace/_afyx-admin/Test-AfyxWorkspaceHygiene.ps1"
(cd "$repo" && PATH="$fixture/bin:$PATH" bash ./pre-push) > "$fixture/present.log" 2>&1
test -s "$TEST_MARKER"
if (cd "$repo" && FAKE_HYGIENE_EXIT=1 PATH="$fixture/bin:$PATH" bash ./pre-push) > "$fixture/failing.log" 2>&1; then
  echo 'Required available hygiene verifier failure was ignored' >&2
  exit 1
fi

mkdir -p "$fixture/updater"
cp "$source_root/update.sh" "$fixture/updater/update.sh"
printf '#!/bin/bash\nprintf "INSTALLER_CALLED\\n"\n' > "$fixture/updater/install.sh"
git init -q "$fixture/updater"
git -C "$fixture/updater" add update.sh install.sh
git -C "$fixture/updater" -c user.name=Fixture -c user.email=fixture@example.invalid commit -q -m baseline
bash "$fixture/updater/update.sh" > "$fixture/no-upstream.log"
grep -q 'No upstream branch is configured' "$fixture/no-upstream.log"
grep -q 'INSTALLER_CALLED' "$fixture/no-upstream.log"
bash "$fixture/updater/update.sh" --offline > "$fixture/offline.log"
grep -q 'Offline mode: self-update skipped' "$fixture/offline.log"
bash "$fixture/updater/update.sh" --skip-self-update > "$fixture/skip.log"
grep -q 'Self-update skipped by --skip-self-update' "$fixture/skip.log"

mkdir -p "$fixture/home" "$fixture/project"
mv "$fixture/bin/uname" "$fixture/bin/uname-hook-fixture"
printf '#!/bin/sh\nprintf "agy fixture 1.0\\n"\n' > "$fixture/bin/agy"
chmod +x "$fixture/bin/agy"
CI=1 HOME="$fixture/home" PATH="$fixture/bin:/usr/bin:/bin" bash "$source_root/install.sh" \
  --preset minimal --skills-root "$fixture/skills" --offline --skip-provider-configuration > "$fixture/install.log"
if ! HOME="$fixture/home" PATH="$fixture/bin:/usr/bin:/bin" bash "$source_root/verify.sh" \
  --preset minimal --skills-root "$fixture/skills" --provider antigravity \
  --provider-scope workspace --workspace-root "$fixture/project" > "$fixture/antigravity.log"; then
  cat "$fixture/antigravity.log" >&2
  exit 1
fi
grep -q '\[OK\] Antigravity provider' "$fixture/antigravity.log"
HOME="$fixture/home" PATH="$fixture/bin:/usr/bin:/bin" bash "$source_root/verify.sh" \
  --preset minimal --skills-root "$fixture/skills" > "$fixture/component-only.log"
grep -q '\[OK\] Core readiness' "$fixture/component-only.log"
if HOME="$fixture/home" PATH="$fixture/bin:/usr/bin:/bin" bash "$source_root/verify.sh" \
  --preset minimal --skills-root "$fixture/skills" --provider codex > "$fixture/missing-codex.log"; then
  echo 'Explicitly selected missing Codex CLI was accepted' >&2
  exit 1
fi
grep -q '\[FAIL\] Codex provider' "$fixture/missing-codex.log"
printf 'PORTABILITY_PASS: hygiene, updater, alternative provider, component-only, and selected-host rejection\n'
