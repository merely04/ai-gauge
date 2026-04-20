#!/usr/bin/env bash
set -euo pipefail

# scripts/validate-release.sh — pre-release version consistency validator.
# Invoked manually and by .githooks/pre-push.
#
# Flags:
#   --tag vX.Y.Z    Also assert that the given tag equals v<package.json version>.
# Env:
#   AIGAUGE_REPO_ROOT    Override repo root (for testing against fixtures).
#   AIGAUGE_SKIP_PLUTIL  Force python3 plistlib branch even when plutil is available
#                        (used by tests to exercise the Linux code path on macOS).
#
# Exit codes:
#   0  all versions match
#   1  validation mismatch (diff on stderr)
#   2  required file missing

usage() {
  cat <<EOF
Usage: bash scripts/validate-release.sh [--tag vX.Y.Z]

Validates that every version reference in the repo matches package.json:
  - bin/AIGauge.app/Contents/Info.plist (CFBundleShortVersionString, CFBundleVersion)
  - macos/AIGauge/Sources/AIGauge/Info.plist (same two keys)
  - CHANGELOG.md entry: ## [X.Y.Z] — YYYY-MM-DD (em-dash or hyphen accepted)
  - Optional: --tag vX.Y.Z matches v<package.json version>

Exit 0 on success, 1 on mismatch, 2 on missing file.
EOF
}

fail() { echo "ERROR: $*" >&2; exit 1; }
die_missing() { echo "ERROR: required file missing: $1" >&2; exit 2; }

diff_fail() {
  local file="$1" got="$2" expected="$3" key="$4"
  echo "ERROR: version mismatch in $file ($key)" >&2
  echo "  - $key: $expected  (expected, from package.json)" >&2
  echo "  + $key: $got       (actual)" >&2
  exit 1
}

read_plist_key() {
  local file="$1" key="$2"
  if [[ -z "${AIGAUGE_SKIP_PLUTIL:-}" ]] && command -v plutil >/dev/null 2>&1; then
    plutil -extract "$key" raw -o - "$file"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb"))[sys.argv[2]])' "$file" "$key"
  else
    fail "Need plutil (macOS) or python3 (Linux) to read $file"
  fi
}

TAG_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      [[ $# -ge 2 ]] || fail "--tag requires an argument"
      TAG_ARG="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0;;
    *) fail "unknown arg: $1";;
  esac
done

REPO_ROOT="${AIGAUGE_REPO_ROOT:-}"
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "$REPO_ROOT" ]] || fail "not a git repo and AIGAUGE_REPO_ROOT not set"
fi

PKG_JSON="$REPO_ROOT/package.json"
[[ -f "$PKG_JSON" ]] || die_missing "package.json"
command -v jq >/dev/null 2>&1 || fail "jq is required"
PKG_VERSION="$(jq -r .version "$PKG_JSON")"
[[ "$PKG_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "package.json .version '$PKG_VERSION' is not semver X.Y.Z"

if [[ -n "$TAG_ARG" ]]; then
  [[ "$TAG_ARG" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]] \
    || fail "tag '$TAG_ARG' is not vX.Y.Z"
  TAG_VERSION="${BASH_REMATCH[1]}"
  if [[ "$TAG_VERSION" != "$PKG_VERSION" ]]; then
    diff_fail "tag argument" "$TAG_ARG" "v$PKG_VERSION" "tag"
  fi
fi

for PLIST_REL in \
  "bin/AIGauge.app/Contents/Info.plist" \
  "macos/AIGauge/Sources/AIGauge/Info.plist"; do
  PLIST_ABS="$REPO_ROOT/$PLIST_REL"
  [[ -f "$PLIST_ABS" ]] || die_missing "$PLIST_REL"
  for KEY in CFBundleShortVersionString CFBundleVersion; do
    GOT="$(read_plist_key "$PLIST_ABS" "$KEY")"
    if [[ "$GOT" != "$PKG_VERSION" ]]; then
      diff_fail "$PLIST_REL" "$GOT" "$PKG_VERSION" "$KEY"
    fi
  done
done

CHG="$REPO_ROOT/CHANGELOG.md"
[[ -f "$CHG" ]] || die_missing "CHANGELOG.md"
VERSION_RE="${PKG_VERSION//./\\.}"
if ! grep -E "^## \[${VERSION_RE}\] [—-] [0-9]{4}-[0-9]{2}-[0-9]{2}" "$CHG" >/dev/null; then
  echo "ERROR: CHANGELOG.md missing entry: ## [${PKG_VERSION}] — YYYY-MM-DD" >&2
  echo "  expected a line matching: ## [${PKG_VERSION}] — YYYY-MM-DD  (em-dash or hyphen)" >&2
  exit 1
fi

echo "OK: all version references match $PKG_VERSION"
exit 0
