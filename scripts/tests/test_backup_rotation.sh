#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

TEST_TEMP="$(mktemp -d /tmp/afyx-test-backup-rot-XXXXXX)"
# Resolve only our newly created fixture (macOS /tmp is an OS symlink).
TEST_TEMP="$(cd "$TEST_TEMP" && pwd -P)"
cleanup() {
  rm -rf -- "$TEST_TEMP" 2>/dev/null || true
}
trap cleanup EXIT

export AFYX_BACKUP_ROOT="$TEST_TEMP/backups"
export AFYX_BACKUP_LIMIT=5

# Source lifecycle library
# shellcheck source=scripts/lib/afyx-skill-lifecycle.sh
. "$PACKAGE_ROOT/scripts/lib/afyx-skill-lifecycle.sh"

FAKE_SKILL="$TEST_TEMP/fake-skill"
mkdir -p "$FAKE_SKILL"
printf -- '---\nname: test-skill\n---\n' > "$FAKE_SKILL/SKILL.md"

printf '[TEST 1] Creating 5 backups with limit 5 in bash...\n'
for i in {1..5}; do
  printf 'Iteration %s\n' "$i" > "$FAKE_SKILL/iteration.txt"
  dest="$(afyx_backup_skill test-skill "$FAKE_SKILL")"
  [[ -d "$dest" ]] || { printf 'Backup %s was not created!\n' "$i" >&2; exit 1; }
  sleep 0.05
done

count="$(find "$AFYX_BACKUP_ROOT/test-skill" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[[ "$count" -eq 5 ]] || { printf 'Expected 5 backups, got %s\n' "$count" >&2; exit 1; }
printf '  -> PASS: 5 backups created successfully.\n'

printf '[TEST 2] Creating 6th backup (rotation should prune oldest)...\n'
printf 'Iteration 6\n' > "$FAKE_SKILL/iteration.txt"
dest6="$(afyx_backup_skill test-skill "$FAKE_SKILL")"
[[ -d "$dest6" ]] || { printf '6th backup not created!\n' >&2; exit 1; }
count6="$(find "$AFYX_BACKUP_ROOT/test-skill" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[[ "$count6" -eq 5 ]] || { printf 'Expected 5 backups after 6th backup, got %s\n' "$count6" >&2; exit 1; }
grep -q 'Iteration 6' "$dest6/iteration.txt" || { printf 'Content mismatch in 6th backup!\n' >&2; exit 1; }
printf '  -> PASS: Oldest backup pruned, count maintained at 5, new backup valid.\n'

printf '[TEST 3] Multiple sequential rotations up to 12 iterations...\n'
for i in {7..12}; do
  printf 'Iteration %s\n' "$i" > "$FAKE_SKILL/iteration.txt"
  afyx_backup_skill test-skill "$FAKE_SKILL" >/dev/null
  sleep 0.05
done
count12="$(find "$AFYX_BACKUP_ROOT/test-skill" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[[ "$count12" -eq 5 ]] || { printf 'Expected 5 backups after 12 iterations, got %s\n' "$count12" >&2; exit 1; }
printf '  -> PASS: Count maintained at 5 across all iterations.\n'

printf '[TEST 4] Foreign directory preservation during rotation...\n'
FOREIGN_DIR="$AFYX_BACKUP_ROOT/test-skill/custom-manual-notes"
mkdir -p "$FOREIGN_DIR"
printf 'Important manual notes\n' > "$FOREIGN_DIR/notes.txt"

printf 'Iteration 13\n' > "$FAKE_SKILL/iteration.txt"
afyx_backup_skill test-skill "$FAKE_SKILL" >/dev/null

[[ -d "$FOREIGN_DIR" ]] || { printf 'Foreign directory was deleted during rotation!\n' >&2; exit 1; }
[[ "$(find "$AFYX_BACKUP_ROOT/test-skill" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" -eq 6 ]] || { printf 'Foreign entry consumed retention budget.\n' >&2; exit 1; }
printf '  -> PASS: Foreign directory untouched.\n'

printf '[TEST 5] Default limit 20, protected, modified and legacy backups...\n'
afyx_backup_limit=20
mkdir -p "$FAKE_SKILL/.git" "$FAKE_SKILL/empty" "$FAKE_SKILL/folder with spaces"
printf 'unicode payload' >"$FAKE_SKILL/folder with spaces/café.txt"
printf 'git recovery\n' >"$FAKE_SKILL/.git/config"
printf '{"ownership":"fixture"}\n' >"$FAKE_SKILL/.afyx-install.json"
pinned="$(afyx_backup_skill default-limit "$FAKE_SKILL" true)"
default_root="$AFYX_BACKUP_ROOT/default-limit"
legacy="$default_root/20000101-000000-unverified"
mkdir "$legacy"
modified="$(afyx_backup_skill default-limit "$FAKE_SKILL")"
printf 'user-modified history\n' >"$modified/.git/config"
for ((i=1; i<=22; i++)); do latest="$(afyx_backup_skill default-limit "$FAKE_SKILL")"; done
[[ "$(find "$default_root" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" -eq 23 ]] || { printf 'Expected 20 completed plus pinned/modified/legacy.\n' >&2; exit 1; }
[[ -d "$pinned" && -d "$modified" && -d "$legacy" && -d "$latest/empty" ]] || exit 1
cmp "$latest/.afyx-install.json" "$FAKE_SKILL/.afyx-install.json"

printf '[TEST 6] Copy and verification failure keep all recoverable history...\n'
find "$default_root" -mindepth 1 -maxdepth 1 -type d >"$TEST_TEMP/history"
cp() { return 77; }
if afyx_backup_skill default-limit "$FAKE_SKILL" >"$TEST_TEMP/failure-output"; then printf 'Copy failure accepted.\n' >&2; exit 1; fi
unset -f cp
while IFS= read -r path; do [[ -d "$path" ]] || { printf 'History pruned before copy.\n' >&2; exit 1; }; done <"$TEST_TEMP/history"
cp() { command cp "$@" || return; printf 'corruption' >"${@: -1}/.afyx-install.json"; }
if afyx_backup_skill default-limit "$FAKE_SKILL" >"$TEST_TEMP/failure-output"; then printf 'Read-back corruption accepted.\n' >&2; exit 1; fi
unset -f cp
while IFS= read -r path; do [[ -d "$path" ]] || { printf 'History pruned before verification.\n' >&2; exit 1; }; done <"$TEST_TEMP/history"

printf '[TEST 7] Real overlap fails closed and the first operation completes...\n'
cp() { printf 'active' >"$TEST_TEMP/copy-active"; sleep 2; command cp "$@"; }
afyx_backup_skill concurrent "$FAKE_SKILL" >"$TEST_TEMP/concurrent-result" &
backup_pid=$!
for ((i=0; i<200; i++)); do [[ ! -f "$TEST_TEMP/copy-active" ]] || break; sleep 0.025; done
[[ -f "$TEST_TEMP/copy-active" ]] || { printf 'Concurrent copy did not start.\n' >&2; exit 1; }
if afyx_backup_skill concurrent "$FAKE_SKILL" >/dev/null; then printf 'Concurrent lock bypassed.\n' >&2; exit 1; fi
wait "$backup_pid"
unset -f cp
[[ -d "$(cat "$TEST_TEMP/concurrent-result")" ]] || exit 1

printf '[TEST 8] Symlink payload, ancestor and special file rejected safely...\n'
mkdir "$TEST_TEMP/external"
printf 'preserve' >"$TEST_TEMP/external/owner-data"
ln -s "$TEST_TEMP/external" "$FAKE_SKILL/linked"
if afyx_backup_skill default-limit "$FAKE_SKILL" >/dev/null; then printf 'Linked payload accepted.\n' >&2; exit 1; fi
rm "$FAKE_SKILL/linked"
ln -s "$AFYX_BACKUP_ROOT" "$TEST_TEMP/linked-backups"
original_root="$afyx_backup_root"; afyx_backup_root="$TEST_TEMP/linked-backups/nested"
if afyx_backup_skill test-skill "$FAKE_SKILL" >/dev/null; then printf 'Linked ancestor accepted.\n' >&2; exit 1; fi
afyx_backup_root="$original_root"
mkfifo "$FAKE_SKILL/fifo"
if afyx_backup_skill default-limit "$FAKE_SKILL" >/dev/null; then printf 'Special file accepted.\n' >&2; exit 1; fi
rm "$FAKE_SKILL/fifo"
[[ "$(cat "$TEST_TEMP/external/owner-data")" == preserve ]] || exit 1
while IFS= read -r path; do [[ -d "$path" ]] || { printf 'History removed on unsafe source.\n' >&2; exit 1; }; done <"$TEST_TEMP/history"

printf '\nAll afyx-skill-lifecycle.sh backup rotation tests PASSED successfully.\n'
