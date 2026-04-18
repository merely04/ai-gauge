#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
source "$REPO_ROOT/lib/bash-helpers.sh"

is_macos || { echo "Error: generate-icon.sh is macOS only (uses iconutil)"; exit 1; }

command -v swift >/dev/null     || { echo "Error: swift not found (install Xcode CLT)"; exit 1; }
command -v iconutil >/dev/null  || { echo "Error: iconutil not found"; exit 1; }

ASSETS_DIR="$REPO_ROOT/macos/AIGauge/assets"
ICONSET_DIR="$ASSETS_DIR/AppIcon.iconset"
ICNS_OUT="$ASSETS_DIR/AppIcon.icns"

mkdir -p "$ASSETS_DIR"
rm -rf "$ICONSET_DIR"

swift "$SCRIPT_DIR/generate-icon.swift" "$ICONSET_DIR"

iconutil -c icns "$ICONSET_DIR" -o "$ICNS_OUT"

rm -rf "$ICONSET_DIR"

echo "Icon written to: $ICNS_OUT"
