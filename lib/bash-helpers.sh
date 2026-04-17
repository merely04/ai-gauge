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
