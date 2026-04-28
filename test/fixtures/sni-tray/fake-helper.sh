#!/usr/bin/env bash
set -euo pipefail

log_file="${FAKE_HELPER_LOG_FILE:-}"
inject_file="${FAKE_HELPER_INJECT_FILE:-}"
exit_after_init="${FAKE_HELPER_EXIT_AFTER_INIT:-0}"

append_log() {
  [[ -n "$log_file" ]] || return 0
  printf '%s\n' "$1" >> "$log_file"
}

emit_injected() {
  [[ -n "$inject_file" && -f "$inject_file" && -s "$inject_file" ]] || return 0
  while IFS= read -r inject; do
    [[ -n "$inject" ]] && printf '%s\n' "$inject"
  done < "$inject_file"
  : > "$inject_file"
}

if [[ -n "$inject_file" ]]; then
  (
    while true; do
      emit_injected
      sleep 0.05
    done
  ) &
  watcher_pid=$!
  trap 'kill "$watcher_pid" 2>/dev/null || true' EXIT
fi

while IFS= read -r line; do
  append_log "$line"
  printf '{"event":"test-echo","cmd":%s}\n' "$line"
  emit_injected
  if [[ "$line" == *'"cmd":"shutdown"'* ]]; then
    exit 0
  fi
  if [[ "$exit_after_init" == "1" && "$line" == *'"cmd":"init"'* ]]; then
    exit 9
  fi
done
