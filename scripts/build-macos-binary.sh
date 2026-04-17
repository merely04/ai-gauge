#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
source "$REPO_ROOT/lib/bash-helpers.sh"

is_macos || { echo "Error: This script is macOS only"; exit 1; }

xcode-select -p > /dev/null 2>&1 || {
  echo "Error: Install Xcode Command Line Tools: xcode-select --install"
  exit 1
}

echo "Building AIGauge for arm64..."
swift build --package-path "$REPO_ROOT/macos/AIGauge" -c release --arch arm64

echo "Building AIGauge for x86_64..."
swift build --package-path "$REPO_ROOT/macos/AIGauge" -c release --arch x86_64

echo "Creating universal binary with lipo..."
lipo -create \
  -output "$REPO_ROOT/bin/ai-gauge-menubar" \
  "$REPO_ROOT/macos/AIGauge/.build/arm64-apple-macosx/release/AIGauge" \
  "$REPO_ROOT/macos/AIGauge/.build/x86_64-apple-macosx/release/AIGauge"

chmod +x "$REPO_ROOT/bin/ai-gauge-menubar"

echo "Ad-hoc signing raw binary..."
codesign --force --sign - "$REPO_ROOT/bin/ai-gauge-menubar"

echo "Removing quarantine attribute..."
xattr -d com.apple.quarantine "$REPO_ROOT/bin/ai-gauge-menubar" 2>/dev/null || true

echo "Wrapping binary in .app bundle..."
APP_DIR="$REPO_ROOT/bin/AIGauge.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

cp "$REPO_ROOT/bin/ai-gauge-menubar" "$APP_DIR/Contents/MacOS/AIGauge"
chmod +x "$APP_DIR/Contents/MacOS/AIGauge"

cp "$REPO_ROOT/macos/AIGauge/Sources/AIGauge/Info.plist" "$APP_DIR/Contents/Info.plist"
plutil -lint "$APP_DIR/Contents/Info.plist"

echo "Ad-hoc signing .app bundle..."
codesign --force --deep --sign - "$APP_DIR"

xattr -dr com.apple.quarantine "$APP_DIR" 2>/dev/null || true

echo "Verifying..."
lipo -info "$REPO_ROOT/bin/ai-gauge-menubar"
lipo -info "$APP_DIR/Contents/MacOS/AIGauge"
codesign -dv "$APP_DIR" 2>&1 | grep -i "adhoc\|Signature\|Identifier" || true

echo "Done!"
echo "  Raw binary:     $REPO_ROOT/bin/ai-gauge-menubar"
echo "  App bundle:     $APP_DIR"
echo "  App executable: $APP_DIR/Contents/MacOS/AIGauge"
