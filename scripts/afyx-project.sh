#!/usr/bin/env bash
set -euo pipefail

# Zero-model project context detector (read-only unless --write-cache is passed).
# Detects project root, project type, Odoo major version with its evidence, and
# likely addon roots. Evidence priority mirrors the Odoo Engineering skill:
#   strong: odoo/release.py > odoo.egg-info/PKG-INFO > odoo-bin --version (opt-in)
#   weak:   git branch/tag > __manifest__.py versions > dependency files
# Conflicting evidence is reported, never guessed. The optional
# .afyx/project.json cache is a hint only; runtime/source evidence always wins.
# Bash 3.2 compatible (macOS): no associative arrays, no mapfile.

path="$PWD"
format=json
allow_exec=false
write_cache=false
SUPPORTED_MIN=10
SUPPORTED_MAX=20
MANIFEST_CAP=200
TAB="$(printf '\t')"

usage() { printf '%s\n' 'Usage: afyx-project.sh [--path DIR] [--format json|text] [--allow-exec] [--write-cache]'; }
while (($#)); do
  case "$1" in
    --path) path="$2"; shift 2 ;;
    --format) format="$2"; shift 2 ;;
    --allow-exec) allow_exec=true; shift ;;
    --write-cache) write_cache=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$format" == json || "$format" == text ]] || { printf 'Invalid --format: %s\n' "$format" >&2; exit 2; }

in_range() { (($1 >= SUPPORTED_MIN && $1 <= SUPPORTED_MAX)); }
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
first_number() { grep -Eo '[0-9]+' | head -n 1; }

# Nearest ancestor (including the start directory) carrying a root marker wins.
start="$(cd -- "$path" && pwd)"
root="$start"; root_evidence=start-directory
cursor="$start"
while :; do
  if [[ -e "$cursor/.git" ]]; then root="$cursor"; root_evidence=.git; break; fi
  if [[ -f "$cursor/odoo/release.py" || -f "$cursor/odoo-bin" ]]; then root="$cursor"; root_evidence=odoo-source; break; fi
  parent="$(dirname "$cursor")"
  [[ "$parent" != "$cursor" ]] || break
  cursor="$parent"
done

# evidence rows: priority<TAB>source<TAB>strength<TAB>major<TAB>count
evidence=""
add_evidence() { evidence="${evidence}$1${TAB}$2${TAB}$3${TAB}$4${TAB}$5"$'\n'; }

# 1. odoo/release.py (strong)
release_file="$root/odoo/release.py"
if [[ -f "$release_file" ]]; then
  major="$(grep -Eo "version_info[[:space:]]*=[[:space:]]*\\([[:space:]]*['\"]?(saas~)?[0-9]+" "$release_file" | head -n 1 | grep -Eo '[0-9]+$' || true)"
  [[ -n "$major" ]] && add_evidence 1 'odoo/release.py' strong "$major" 1
fi
# 2. release metadata (strong)
pkg_info="$root/odoo.egg-info/PKG-INFO"
if [[ -f "$pkg_info" ]]; then
  major="$(grep -E '^Version:[[:space:]]*[0-9]+\.' "$pkg_info" | head -n 1 | sed -E 's/^Version:[[:space:]]*([0-9]+)\..*/\1/' || true)"
  [[ -n "$major" ]] && add_evidence 2 'odoo.egg-info/PKG-INFO' strong "$major" 1
fi
# 3. odoo-bin --version (strong, executes project code: opt-in only)
odoo_bin="$root/odoo-bin"
if "$allow_exec" && [[ -f "$odoo_bin" ]]; then
  python_bin="$(command -v python3 || command -v python || true)"
  if [[ -n "$python_bin" ]]; then
    output="$("$python_bin" "$odoo_bin" --version 2>/dev/null || true)"
    major="$(printf '%s' "$output" | grep -Eo 'Odoo Server[[:space:]]+(saas~)?[0-9]+' | head -n 1 | grep -Eo '[0-9]+$' || true)"
    [[ -n "$major" ]] && add_evidence 3 'odoo-bin --version' strong "$major" 1
  fi
fi
# 4. git branch / tag (weak)
branch_re='(^|[^0-9.])(1[0-9]|20)\.0([^0-9]|$)'
if [[ "$root_evidence" == .git ]] && command -v git >/dev/null 2>&1; then
  branch="$(git -C "$root" symbolic-ref --short -q HEAD 2>/dev/null || true)"
  if [[ "$branch" =~ $branch_re ]]; then add_evidence 4 'git branch' weak "${BASH_REMATCH[2]}" 1
  else
    tag="$(git -C "$root" describe --tags --abbrev=0 2>/dev/null || true)"
    if [[ "$tag" =~ $branch_re ]]; then add_evidence 4 'git tag' weak "${BASH_REMATCH[2]}" 1; fi
  fi
fi
# 5. __manifest__.py module versions (weak) and addon roots
manifest_list="$(find "$root" -maxdepth 5 \( -name .git -o -name node_modules -o -name .venv -o -name venv -o -name __pycache__ -o -name .tox -o -name dist -o -name build -o -name .afyx-graph \) -prune -o -type f -name __manifest__.py -print 2>/dev/null | LC_ALL=C sort | head -n "$MANIFEST_CAP")"
manifest_count=0
manifest_majors=""
addon_roots=""
while IFS= read -r manifest; do
  [[ -n "$manifest" ]] || continue
  manifest_count=$((manifest_count + 1))
  container="$(dirname "$(dirname "$manifest")")"
  if [[ "$container" == "$root" ]]; then addon_roots="${addon_roots}.
"; else relative="${container#"$root"/}"; addon_roots="${addon_roots}${relative}
"; fi
  version="$(grep -Eo "['\"]version['\"][[:space:]]*:[[:space:]]*['\"][0-9]{2}\\.0\\.[0-9]+\\.[0-9]+\\.[0-9]+['\"]" "$manifest" | head -n 1 | grep -Eo '[0-9]{2}' | head -n 1 || true)"
  if [[ -n "$version" ]] && in_range "$version"; then manifest_majors="${manifest_majors}${version}"$'\n'; fi
done <<EOF
$manifest_list
EOF
if [[ -n "$manifest_majors" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    count="${line%% *}"; major="${line#* }"
    add_evidence 5 '__manifest__.py' weak "$major" "$count"
  done <<EOF
$(printf '%s' "$manifest_majors" | LC_ALL=C sort | uniq -c | awk '{print $1, $2}')
EOF
fi
# 6. dependency files (weak)
for name in requirements.txt pyproject.toml Dockerfile docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
  file="$root/$name"
  [[ -f "$file" ]] || continue
  found=""
  found="$found$(grep -Ei '^[[:space:]]*odoo[[:space:]]*(==|~=|>=)[[:space:]]*[0-9]{2}\.0' "$file" | grep -Eio '(==|~=|>=)[[:space:]]*[0-9]{2}' | grep -Eo '[0-9]{2}' || true)"$'\n'
  found="$found$(grep -Eio "image:[[:space:]]*['\"]?odoo:[0-9]{2}" "$file" | grep -Eo '[0-9]{2}$' || true)"$'\n'
  found="$found$(grep -Ei '^[[:space:]]*FROM[[:space:]]+odoo:[0-9]{2}' "$file" | grep -Eo '[0-9]{2}' | head -n 1 || true)"$'\n'
  found="$found$(grep -Eio 'odoo(/odoo)?(\.git)?@[0-9]{2}\.0' "$file" | grep -Eo '@[0-9]{2}' | grep -Eo '[0-9]{2}' || true)"$'\n'
  for major in $(printf '%s' "$found" | grep -E '^[0-9]{2}$' | LC_ALL=C sort -un || true); do
    if in_range "$major"; then add_evidence 6 "$name" weak "$major" 1; fi
  done
done

# Resolve
sorted_evidence="$(printf '%s' "$evidence" | LC_ALL=C sort -t "$TAB" -k1,1n -k2,2 -k4,4n)"
strong_majors="$(printf '%s' "$sorted_evidence" | awk -F"$TAB" '$3=="strong"{print $4}' | LC_ALL=C sort -un)"
weak_majors="$(printf '%s' "$sorted_evidence" | awk -F"$TAB" '$3=="weak"{print $4}' | LC_ALL=C sort -un)"
count_lines() { if [[ -z "$1" ]]; then printf 0; else printf '%s\n' "$1" | grep -c .; fi; }
resolved=""; status=unknown
strong_count="$(count_lines "$strong_majors")"; weak_count="$(count_lines "$weak_majors")"
if ((strong_count == 1)); then resolved="$strong_majors"; status=proven
elif ((strong_count > 1)); then status=conflict
elif ((weak_count == 1)); then resolved="$weak_majors"; status=inferred
elif ((weak_count > 1)); then status=conflict; fi
if [[ -n "$resolved" ]] && ! in_range "$resolved"; then status=unsupported; fi

conflicts=""
if [[ "$status" == proven ]]; then
  conflicts="$(printf '%s' "$sorted_evidence" | awk -F"$TAB" -v r="$resolved" '$3=="weak" && $4!=r {print $2 "\t" $4}')"
fi

odoo_detected=false
if [[ -n "$evidence" ]] || ((manifest_count > 0)) || [[ -f "$odoo_bin" || -f "$release_file" ]]; then odoo_detected=true; fi
project_type=unknown
if "$odoo_detected"; then project_type=odoo
elif [[ -f "$root/pyproject.toml" || -f "$root/setup.py" || -f "$root/requirements.txt" ]]; then project_type=python
elif [[ -f "$root/package.json" ]]; then project_type=node; fi

sorted_roots="$(printf '%s' "$addon_roots" | grep . | LC_ALL=C sort -u | head -n 20 || true)"

# Optional cache (hint only)
cache_path="$root/.afyx/project.json"
cache_present=false; hint=""; agrees=null
if [[ -f "$cache_path" ]]; then
  cache_present=true
  hint="$(grep -Eo '"odoo_major"[[:space:]]*:[[:space:]]*[0-9]+' "$cache_path" | head -n 1 | grep -Eo '[0-9]+$' || true)"
  if [[ -n "$hint" && -n "$resolved" ]]; then if [[ "$hint" == "$resolved" ]]; then agrees=true; else agrees=false; fi; fi
fi

if "$write_cache"; then
  mkdir -p "$root/.afyx"
  printf '{\n  "note": "Hint only. Source and runtime evidence always win.",\n  "odoo_major": %s,\n  "version_status": "%s"\n}\n' "${resolved:-null}" "$status" > "$cache_path"
fi

if [[ "$format" == text ]]; then
  printf 'Project root: %s (%s)\nProject type: %s\n' "$root" "$root_evidence" "$project_type"
  if "$odoo_detected"; then
    if [[ -n "$resolved" ]]; then printf 'Odoo: detected; version %s (%s)\n' "$resolved" "$status"; else printf 'Odoo: detected; version %s\n' "$status"; fi
    printf '%s\n' "$sorted_evidence" | while IFS="$TAB" read -r _ source strength major _; do
      if [[ -n "$source" ]]; then printf '  evidence: %s = %s [%s]\n' "$source" "$major" "$strength"; fi
    done
    printf '%s\n' "$conflicts" | while IFS="$TAB" read -r source major; do
      if [[ -n "$source" ]]; then printf '  conflict: %s = %s\n' "$source" "$major"; fi
    done
    if [[ -n "$sorted_roots" ]]; then printf '  addon roots: %s\n' "$(printf '%s' "$sorted_roots" | paste -sd ',' - | sed 's/,/, /g')"; fi
  else printf 'Odoo: not detected\n'; fi
  exit 0
fi

# JSON
evidence_json=""
while IFS="$TAB" read -r _ source strength major count; do
  [[ -n "$source" ]] || continue
  evidence_json="${evidence_json:+$evidence_json,}{\"source\":\"$(json_escape "$source")\",\"strength\":\"$strength\",\"major\":$major,\"count\":$count}"
done <<EOF
$sorted_evidence
EOF
conflicts_json=""
while IFS="$TAB" read -r source major; do
  [[ -n "$source" ]] || continue
  conflicts_json="${conflicts_json:+$conflicts_json,}{\"source\":\"$(json_escape "$source")\",\"major\":$major}"
done <<EOF
$conflicts
EOF
roots_json=""
while IFS= read -r relative; do
  [[ -n "$relative" ]] || continue
  roots_json="${roots_json:+$roots_json,}\"$(json_escape "$relative")\""
done <<EOF
$sorted_roots
EOF
printf '{"schema_version":1,"project_root":"%s","root_evidence":"%s","project_type":"%s","odoo":{"detected":%s,"supported_range":"%s-%s","major_version":%s,"version_status":"%s","evidence":[%s],"conflicts":[%s],"addon_roots":[%s]},"cache":{"path":".afyx/project.json","present":%s,"hint_major":%s,"agrees":%s}}\n' \
  "$(json_escape "$root")" "$root_evidence" "$project_type" "$odoo_detected" "$SUPPORTED_MIN" "$SUPPORTED_MAX" "${resolved:-null}" "$status" \
  "$evidence_json" "$conflicts_json" "$roots_json" "$cache_present" "${hint:-null}" "$agrees"
