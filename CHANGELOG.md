# Changelog

All notable changes to ai-gauge are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.3] — 2026-04-20

### Added
- **`displayMode`** config key for compact menubar/waybar display variants: `full` (default), `percent-only`, `bar-dots`, `number-bar`, `time-to-reset`. Display mode submenu in macOS menubar (**Display mode ▶**), Linux walker UI (`ai-gauge-config`), and right-click menu (`ai-gauge-menu`).
- **GitHub compare URLs in update notifications**: "View changelog" now opens `https://github.com/merely04/ai-gauge/compare/v{old}...v{new}` showing the actual diff (commits + file changes) between the user's version and the new one. Previously the link pointed to the single-tag release page with no context on what changed since the user's install. Falls back to the tag page when the previous version is unknown (equal or missing).
- **Automated GitHub Release publishing**: `.github/workflows/publish.yml` now creates a GitHub Release on each tag push, populating the body from the matching `## [vX.Y.Z]` section of CHANGELOG.md (extracted via `awk`) and appending a "Full Changelog" compare URL footer. Uploads `bin/ai-gauge-menubar` and a tarball of `bin/AIGauge.app` as release assets.
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
