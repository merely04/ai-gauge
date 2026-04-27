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
# Note: avoids jq `//` because it returns RHS for boolean `false` (null-ish).
read_config_field() {
  local key="$1" default="$2"
  local file="${3:-$HOME/.config/ai-gauge/config.json}"
  if [[ -f "$file" ]]; then
    jq -r --arg k "$key" --arg d "$default" \
      'if has($k) and (.[$k] != null) then (.[$k] | tostring) else $d end' \
      "$file" 2>/dev/null || printf '%s\n' "$default"
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

# Strip walker decorations: "✓ " prefix, 2-space prefix, " (provider)" suffix.
# Usage: clean=$(strip_walker_decorations "$raw")
strip_walker_decorations() {
  local val="$1"
  val="${val#✓ }"
  val="${val#  }"
  val="${val%% (*}"
  printf '%s\n' "$val"
}

# Ensure ~/.config/ai-gauge/config.json exists with auto-detected tokenSource.
# Idempotent: skipped if file already exists. Requires LIB_DIR env var pointing
# to the package's lib directory (so we can find detect-token-source.js).
# Usage: ensure_default_config "$CONFIG_FILE" "menubar 'Change token source'"
ensure_default_config() {
  local config_file="$1"
  local hint_path="$2"
  if [[ -f "$config_file" ]]; then
    echo "  Config already exists (skipped)"
    return 0
  fi
  local detected
  detected=$(bun "$LIB_DIR/detect-token-source.js" || echo claude-code)
  if ! [[ "$detected" =~ ^(claude-code|opencode|codex)$ ]]; then
    detected="claude-code"
  fi
  printf '{"tokenSource":"%s","plan":"unknown","displayMode":"full","autoCheckUpdates":true}\n' \
    "$detected" > "$config_file"
  echo "  Created default config → $config_file (tokenSource: $detected)"
  if [[ "$detected" != "claude-code" ]]; then
    echo "Auto-detected token source: $detected"
    echo "(switch later via $hint_path or: ai-gauge-config set tokenSource <source>)"
  fi
}
