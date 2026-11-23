# shellcheck shell=bash
# Valued long options require a separate, nonempty argument.
afyx_require_option_value() {
  if [[ $# -lt 2 || -z "$2" || "$2" == -* ]]; then
    printf '%s requires a value.\n' "$1" >&2
    return 2
  fi
}


# Keep parser-local state supplied by the caller for Bash 3.2 compatibility.
afyx_require_single_option_value() {
  afyx_require_option_value "$@" || return 2
  case "$seen_value_options" in
    *" $1 "*) printf '%s may only be specified once.\n' "$1" >&2; return 2 ;;
  esac
  seen_value_options="$seen_value_options$1 "
}
