# Changelog

All notable changes to ai-gauge are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] — 2026-04-21

### Fixed
- Z.ai provider: duplicate bucket bug when response contains only `unit=6` TOKENS_LIMIT — previously copied same bucket into both `five_hour` and `seven_day`; now correctly leaves `five_hour` null
- SSRF guard: IPv4 encoding bypass — now blocks decimal (`2130706433`), hex (`0x7f000001`), and octal (`0177.0.0.1`) encodings of private IPs
- Log safety: metadata fields (`tokenSource`, `source`, `provider`, `name`) no longer falsely masked as `***`
- Settings discovery: differentiates `permission-denied` and `not-a-file` from `invalid-json` for better diagnostics
- OpenCode credential read: non-ENOENT errors now logged (permission issues no longer silently swallowed)
- Cache invalidation: daemon now drops stale `usage.json` cache when `meta.tokenSource` or `meta.provider` doesn't match current config/credentials. Previously, switching providers or having failed fetches could cause stale data from old test runs or previous provider configurations to be broadcast indefinitely.

### Changed
- Provider adapters use shared `httpError()` helper (reduces boilerplate)
- `fetchUsage()` accepts config parameter (removes redundant disk read per polling cycle)
- Waybar/menubar: credit-balance providers with known total but unknown used now show "Balance: $X.XX available"

### Added
- JSDoc annotations on all provider adapters for API consistency
- AGENTS.md documentation for `balance.extras` schema (komilion-specific fields)
- Multi-provider token sources: `claude-settings:{name}` format for `~/.claude/settings*.json` files
- Provider adapters: Z.ai, MiniMax, OpenRouter, Komilion (credit-balance), Packy (stub), unknown (fallback)
- `listSettingsFiles` WebSocket command — on-demand discovery of settings files with provider detection
- `balance` field in broadcast for credit-based providers (OpenRouter, Komilion)
- `meta.provider` field in broadcast indicating active provider
- `lib/providers/` registry with `ProviderAdapter` interface
- `lib/settings-discovery.js` — secure discovery of `~/.claude/settings*.json` files
- `lib/ssrf-guard.js` — pre-fetch SSRF protection for user-controlled base URLs
- `lib/log-safe.js` — structured secret masking for daemon logs
- macOS menubar: dynamic source list from `listSettingsFiles` response
- macOS menubar: provider indicator suffix in menubar text (z.ai → `z`, etc.)
- macOS menubar: balance line in tooltip for credit-based providers
- macOS menubar: protocol-version gating banner for future protocol bumps

### Changed
- WebSocket protocol version bumped to 2 (additive; v1 clients unaffected)
- `tokenSource` config accepts `claude-settings:{name}` pattern (was binary enum)
- Log events now use structured JSON via `logJson()` with secret masking

### Security
- SSRF guard blocks HTTP, private IP ranges (RFC1918, link-local), and IPv6 loopback
- `apiKeyHelper` field in settings files: never executed, flagged as `supported: false`
- Symlinks in `~/.claude/` rejected during discovery (TOCTOU prevention)
- Token values masked in all daemon log output via `lib/log-safe.js`
- Path traversal blocked in `claude-settings:` tokenSource names

## [1.2.4] — 2026-04-21

### Fixed
- Restored `cmd_setup` dispatcher in `bin/ai-gauge` (was removed as a regression in 8f75262 when the `displayMode` default was added). Running `ai-gauge setup` no longer fails with "`cmd_setup: command not found`".
- Restored the macOS LaunchAgent install block inside `cmd_setup_macos` (plist generation + `launchctl bootstrap` for `com.ai-gauge.server` and `com.ai-gauge.menubar`). The Linux path is now a separate `cmd_setup_linux` function so the two don't interfere.

## [1.2.3] — 2026-04-20

### Added
- **`displayMode`** config key for compact menubar/waybar display variants: `full` (default), `percent-only`, `bar-dots`, `number-bar`, `time-to-reset`. Display mode submenu in macOS menubar (**Display mode ▶**), Linux walker UI (`ai-gauge-config`), and right-click menu (`ai-gauge-menu`).
- **GitHub compare URLs in update notifications**: "View changelog" now opens `https://github.com/merely04/ai-gauge/compare/v{old}...v{new}` showing the actual diff (commits + file changes) between the user's version and the new one. Previously the link pointed to the single-tag release page with no context on what changed since the user's install. Falls back to the tag page when the previous version is unknown (equal or missing).
- **Automated GitHub Release publishing**: `.github/workflows/publish.yml` now creates a GitHub Release on each tag push, populating the body from the matching `## [X.Y.Z]` section of CHANGELOG.md (extracted via `awk`) and appending a "Full Changelog" compare URL footer. Uploads `bin/ai-gauge-menubar` and a tarball of `bin/AIGauge.app` as release assets.
- **`updateComplete` broadcast extended** with `fromVersion` (pre-update `packageVersion`) and `installedVersion` (the version just installed). The macOS menubar app uses both to construct a post-update compare URL, giving the user a direct diff from their old version to the new one.
- `lib/render-waybar.js` — extracted pure render function with injectable clock for deterministic testing.
- 25 fixture test cases + bun unit tests for all display variants (`test/render-waybar.test.js`, `test/config-schema.test.js`, `test/broadcast-displaymode.test.js`).
- 6 unit tests for `changelogUrlFor(fromVersion, toVersion)` covering compare/fallback logic (`test/changelog-url.test.js`).

### Fixed
- **Phantom update notification** ("v1.2.1 is available" when already on v1.2.1): `buildAvailablePayload()` now drops payloads whose cached `latestVersion <= packageVersion`; `rehydrateFromCache()` only adopts cached versions that are strictly newer; `doCheck()` no-update branch now clears both `state.lastNotifiedVersion` **and** `state.latestVersion` (previously the latter could leak across restarts when `autoCheckUpdates=false`).
- **About window overflow**: Credits.rtf description shortened and split across 3 narrower lines (≤43 chars each) so the text fits inside the About panel's rounded frame on macOS. The macOS standard About panel ignores RTF `\margl/\margr`, so the real fix was avoiding lines wider than the credits view.
- **Typo `github.com/mere1y/ai-gauge` → `github.com/merely04/ai-gauge`** across `lib/update-lifecycle.js` (production URL generator), `macos/AIGauge/Sources/AIGauge/AIGaugeApp.swift` (test hook), `CHANGELOG.md` footer, and `AGENTS.md` protocol example. The real GitHub repo lives at `merely04/ai-gauge` (confirmed via `git remote -v`); the old URLs were redirected by GitHub but showed the wrong canonical in address bar.

## [1.2.1] — 2026-04-19

### Fixed

- **About modal**: version was hard-coded to `1.0.0` in `Info.plist` and did
  not reflect the installed version. The build script now auto-stamps
  `CFBundleVersion` and `CFBundleShortVersionString` from `package.json`
  via `plutil`, so the About panel always matches the running version.
- **Credits text**: refreshed to describe current capabilities (5-hour +
  weekly countdowns, notifications, in-app updates) and correct repo link.
- **Menu alignment**: the inline "Auto-check for updates" Toggle rendered
  with a checkmark that horizontally offset the text of neighbouring menu
  items. Replaced with an On/Off submenu mirroring the "Change plan" and
  "Change token source" patterns — main menu items are now flush-aligned.

## [1.2.0] — 2026-04-19

### Added

- **Update notification system** — daemon polls npm registry every 24 hours
  (with a 30-second initial delay) and broadcasts update availability to all
  connected clients (waybar, macOS menubar, StreamDock plugin).
- **In-app update installer** — one-click "Update to vX.Y.Z" in the menu
  detects the install source (npm / bun / pnpm / brew / yarn) and runs the
  correct upgrade command. Failures fall back to copying the command to the
  clipboard.
- **Dismiss-per-version** — `dismissUpdate` WS command silences a specific
  version; auto-clears when a newer version appears.
- **`autoCheckUpdates` config toggle** — disable automatic checks without
  shutting off notifications entirely.
- **Structured logging** — set `AIGAUGE_LOG_FORMAT=json` to emit JSON log lines
  (ts, level, component, event, fields) instead of human-readable text.
- **`send-ws.js --wait-for TYPE`** — request/response helper for CLI scripts
  that need to wait for a specific WebSocket message type.
- **Protocol metadata** — usage broadcasts now include `meta.version`,
  `meta.protocolVersion`, and `meta.autoCheckUpdates` for forward-compat and
  client-side feature detection.

### Changed

- **Server refactor** — `bin/ai-gauge-server` split into focused modules:
  `lib/broadcast.js`, `lib/config.js`, `lib/threshold-notify.js`,
  `lib/update-lifecycle.js`, `lib/semver.js`, `lib/atomic-write.js`,
  `lib/logger.js`. Server shrunk from ~660 LOC to ~320.
- **Atomic file writes** — unified through `atomicWriteJSON`; removes four
  duplicated temp-file + rename implementations.
- **Install-source detection** — narrower path patterns to avoid false
  positives on user project directories containing `pnpm`, `yarn`, etc.
- **Registry `latestVersion` validation** — strict semver format check before
  the value is used in broadcasts or changelog URLs.
- **Child process env scrubbing** — `runUpdate` spawn filters out
  `TOKEN|KEY|SECRET|CREDENTIAL|AUTH|PASSWORD|PASSPHRASE` variables so OAuth
  tokens are not leaked to `npm install` postinstall scripts.
- **Port probe** — replaced the bespoke `net.connect` probe with native
  `Bun.listen` try/catch.

### Fixed

- Waybar no longer renders `0%` garbage when the server sends a typed
  message (`notify`, `update*`). Typed messages are now routed to their
  handler; raw usage broadcasts render.
- `bin/ai-gauge-menu` resolves `send-ws.js` via `$SCRIPT_DIR` so it works
  when launched from a walker outside the package cwd.
- `do-update.js` reads stderr in parallel with `proc.exited`, preventing the
  stream from closing before the error classifier sees it.
- `do-update.js` catches the `proc.exited` rejection after a kill, removing
  an unhandled-rejection warning.
- Server clears `lastNotifiedVersion` when the registry rolls a version back
  so stale "update available" banners disappear.
- Server re-sends `updateAvailable` to reconnecting clients after a daemon
  restart (previously blocked until the next 24-hour scheduled check).
- Server cancels and restarts the update scheduler live when
  `autoCheckUpdates` is toggled via `setConfig`.
- Waybar resets its local `lastUpdateState` on reconnect so stale indicators
  don't stick after the daemon restarts.
- Clipboard helper tolerates `EPIPE` when `pbcopy`/`wl-copy` closes stdin
  early.
- Stale `update-state.json` is cleared on startup when the cache's
  `currentVersion` does not match the installed `package.json` version.

### Documentation

- README: added "Update Notifications" section (user-facing flow, manual
  check, dismiss, disable, CI behaviour) and a "Running without a service
  manager" note for Docker / minimal Linux users.
- AGENTS.md: documented the new WebSocket message types
  (`updateAvailable`, `updateInstalling`, `updateFailed`, `updateComplete`,
  `updateCheckFailed`, `updateAlreadyInProgress`, `doUpdate`, `checkUpdate`)
  and the update-related environment variables
  (`AIGAUGE_REGISTRY_URL`, `AIGAUGE_INSTALL_SOURCE`, `AIGAUGE_NPM_COMMAND`,
  `AIGAUGE_UPDATE_CHECK_INITIAL_DELAY_MS`, `AIGAUGE_UPDATE_CHECK_INTERVAL_MS`,
  `NO_UPDATE_NOTIFIER`).

## [1.1.1] — previous releases

Earlier versions are documented in the [GitHub Releases page](https://github.com/merely04/ai-gauge/releases).
