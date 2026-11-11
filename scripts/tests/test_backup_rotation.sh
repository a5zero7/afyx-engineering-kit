#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

TEST_TEMP="$(mktemp -d /tmp/afyx-test-backup-rot-XXXXXX)"
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
printf '  -> PASS: Foreign directory untouched.\n'

printf '\nAll afyx-skill-lifecycle.sh backup rotation tests PASSED successfully.\n'
