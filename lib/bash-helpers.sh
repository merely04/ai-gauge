#!/bin/bash
# Cross-platform bash helpers for ai-gauge
# Usage: source lib/bash-helpers.sh; if is_macos; then ...; fi

is_macos() {
  [[ "$OSTYPE" == "darwin"* ]]
}

resolve_path() {
  if is_macos; then
    python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"
  else
    readlink -f "$1"
  fi
}

sed_inplace() {
  if is_macos; then
    sed -i '' -e "$1" "$2"
  else
    sed -i -e "$1" "$2"
  fi
}

# Read a single field from ai-gauge config.json with a fallback default.
# Usage: read_config_field <key> <default> [file]
# Example: source=$(read_config_field tokenSource claude-code)
read_config_field() {
  local key="$1" default="$2"
  local file="${3:-$HOME/.config/ai-gauge/config.json}"
  if [[ -f "$file" ]]; then
    jq -r ".$key // \"$default\"" "$file" 2>/dev/null || printf '%s\n' "$default"
  else
    printf '%s\n' "$default"
  fi
}

# Print items prefixed with "✓ " if they match current selection,
# or two spaces otherwise. Strips " (provider)" suffix before comparison
# so claude-settings:foo (zai) still matches current="claude-settings:foo".
# Usage: mark_current <current> <item1> <item2> ...
mark_current() {
  local current="$1"; shift
  local item bare
  for item in "$@"; do
    bare="${item%% (*}"
    if [[ "$bare" == "$current" ]]; then
      printf '✓ %s\n' "$item"
    else
      printf '  %s\n' "$item"
    fi
  done
}
