# Native Bash 3.2 adapter for the shared installer progress protocol.
if [[ "${AFYX_INSTALL_PROGRESS:-0}" == 1 ]]; then exec 3>&1; fi
afyx_progress_escape() {
  local text="$1"
  text="${text//\\/\\\\}"; text="${text//\"/\\\"}"
  text="${text//$'\n'/\\n}"; text="${text//$'\r'/\\r}"; text="${text//$'\t'/\\t}"
  printf '%s' "$text"
}
afyx_progress_event() {
  [[ "${AFYX_INSTALL_PROGRESS:-0}" == 1 ]] || return 0
  local operation="$1" component="$2" phase="$3" state="$4" message="$5" encoded_component=null error=null completed=null total=null
  [[ -z "$component" ]] || encoded_component="\"$(afyx_progress_escape "$component")\""
  [[ "$state" != failed ]] || error='"BACKEND_OPERATION_FAILED"'
  if [[ "$state" == completed ]]; then completed=1; total=1; fi
  printf 'AFYX_PROGRESS {"contract":"AfyxInstallerProgress/v1","operationId":"%s","componentId":%s,"phase":"%s","state":"%s","completed":%s,"total":%s,"message":"%s","timestamp":"%s","errorCode":%s}\n' \
    "$operation" "$encoded_component" "$phase" "$state" "$completed" "$total" "$(afyx_progress_escape "$message")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$error" >&3
}
afyx_run_install_operation() {
  local component="$1" phase="$2" message="$3" operation="native:$RANDOM:$RANDOM" status
  shift 3
  case "$phase" in install|update|repair|configure|verify|cleanup|rollback) ;; *) phase=install ;; esac
  afyx_progress_event "$operation" "$component" "$phase" running "$message"
  if "$@"; then
    afyx_progress_event "$operation" "$component" "$phase" completed "$message"
  else
    status=$?
    afyx_progress_event "$operation" "$component" "$phase" failed "$message"
    return "$status"
  fi
}
