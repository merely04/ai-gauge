# Changelog

All notable changes to ai-gauge are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.0] — 2026-04-28

### Added

- **GitHub Copilot provider** — monitors monthly premium-request quota for Individual plans (Free, Pro, Pro+). Three-tier auth resolution: (1) `gh auth token --hostname github.com` shell-out works for any gh storage backend (Keychain on macOS, Secret Service on Linux, `--insecure-storage` plaintext), (2) `~/.config/gh/hosts.yml` plaintext fallback when the `gh` binary is unavailable, (3) `~/.config/ai-gauge/copilot-token` file for headless/CI environments (must contain a `gho_*` OAuth token; classic `ghp_*` PATs and fine-grained `github_pat_*` tokens are rejected — they don't authenticate the internal Copilot API). Single-shot endpoint `/copilot_internal/v2/token`. New `tokenSource: github` config value. New top-level `copilot` field in the WS broadcast (shape: `{plan, premium_interactions: {utilization, used, limit, resets_at, overage_count, overage_permitted}}`; protocolVersion stays at 4 — additive field). Threshold notifications at 80%/95% extended to Copilot utilization.
- **OpenCode tri-mode (Anthropic + Codex + Copilot)** — when `tokenSource: opencode` and `~/.local/share/opencode/auth.json` contains a `github-copilot` OAuth block (populated by `opencode auth login github-copilot`), the daemon now fetches Copilot quota in parallel with Anthropic and Codex and broadcasts it via the existing top-level `copilot` field. The `secondary` field continues to carry Codex/OpenAI data, so all three providers can be displayed side-by-side in the tooltip without changing the broadcast schema or bumping protocolVersion. Auto-detected — no user configuration required beyond logging into OpenCode.

## [1.5.3] — 2026-04-27

### Fixed
- **Waybar module silently disappeared after some upgrades**: when `omarchy-restart-waybar` was unavailable (non-Omarchy systems, or systemd context where `command -v` doesn't see omarchy bin paths), the fallback used `killall -SIGUSR2 waybar`. SIGUSR2 reloads waybar's config but does NOT refresh the process's `PATH` — so if installed binary paths moved between waybar's start time and `ai-gauge setup` (e.g. bun's global install migrated from `~/.cache/.bun/bin/` to `~/.bun/bin/` after a mise upgrade, or stale symlinks were cleaned up), waybar would fail to find `ai-gauge-waybar` in PATH and the module would silently disappear from the bar. Replaced both fallback paths (in `cmd_setup_linux` and `cmd_uninstall`) with a hard restart (`pkill -x waybar` + `setsid waybar`) so the new process inherits the current PATH. Matches what `omarchy-restart-waybar` itself does (`pkill + setsid uwsm-app`).

## [1.5.2] — 2026-04-27

### Fixed
- **`ai-gauge setup` on Linux did not restart the daemon** when re-run after an upgrade. The setup function called `systemctl --user enable --now ai-gauge-server`, but `--now` only starts the service if it's currently stopped. A daemon already running with the **previous** `ExecStart` (e.g. pointing to a stale dev clone or an old install path) would keep running with the old code even though `daemon-reload` had loaded the new unit. The user-visible symptom: after `bun add -g ai-gauge@latest && ai-gauge setup`, `ai-gauge version` reported the new version, but the running daemon still used the old code — `setConfig` writes were ignored, broadcasts carried stale `meta.version`, and config.json could accumulate fields from old schemas (e.g. a `provider` key from pre-1.0 versions). Replaced with `systemctl --user enable ai-gauge-server` + `systemctl --user restart ai-gauge-server` so the new `ExecStart` is always picked up. `restart` also correctly handles the cold-start case (starts the daemon if it wasn't running), so behavior on first install is unchanged.

## [1.5.1] — 2026-04-27

### Fixed
- **Linux right-click menu had duplicated entries**: top-level "🔑 Token source", "📋 Plan", "🎨 Display mode" items shipped in 1.5.0 lived alongside an "⚙ Settings" entry that opened the same options inside another walker. This was a parity gap with the macOS Swift menubar (which has no Settings container — all options live at top level). Removed the "⚙ Settings" entry. The unique option inside it (`Auto-check updates`) is now also top-level as `🔄 Auto-check updates: ON/OFF` with click-to-toggle behavior matching the macOS On/Off submenu pattern.
- **Display mode submenu was broken**: handler used `omarchy-launch-walker --placeholder ...` (no `--dmenu` flag), so walker opened its application-launcher mode instead of reading display-mode options from stdin. Selection didn't work. This was a pre-existing bug from before 1.5.0. Fixed by switching to the same `--dmenu --width 200 -p "Display mode"` pattern used by the Token source and Plan handlers. Now also shows `✓` checkmark on the currently active mode (parity with the other submenus).
- **`read_config_field` returned default for boolean `false`**: jq's `//` operator treats `false` as null-ish, so `read_config_field autoCheckUpdates true` returned `"true"` for a config containing `"autoCheckUpdates": false`. Switched to `has($k) and (.[$k] != null)` so all JSON value types round-trip correctly. Affected only the new `autoCheckUpdates` reader (string fields like `tokenSource`/`plan`/`displayMode` were never `false` so dodged the bug).

### Changed
- 5 new menu integration tests covering Auto-check updates ON/OFF rendering, toggle behavior, Display mode submenu routing, and the absence of Settings entry.

## [1.5.0] — 2026-04-27

### Added
- **Auto-detect at first install** — `ai-gauge setup` now picks the right `tokenSource` automatically by probing credential files in order: `opencode` (`~/.local/share/opencode/auth.json`), `codex` (`~/.codex/auth.json`), `claude-code` (Keychain on macOS, `~/.claude/.credentials.json` on Linux). Multiple valid sources tiebreak by file mtime; equal mtimes fall back to fixed priority `opencode > codex > claude-code`. Runs only on first install — subsequent `ai-gauge setup` runs preserve the existing choice. Replaces the previous hardcoded `claude-code` default that caused users with OpenCode/Codex installed to start with the wrong source. Linux setup previously did not write `config.json` at all on first install, leaving the daemon to fall back to `claude-code` defaults — this is now fixed.
- **Top-level "🔑 Token source" and "📋 Plan" submenus in Linux right-click menu** (parity with macOS Swift menubar). Previously these were two clicks deep inside "⚙ Settings". Now they appear directly in the top-level walker menu showing the current selection (e.g., `🔑 Token source: opencode`, `📋 Plan: max`).
- **Walker checkmarks** — current selection is marked with `✓ ` prefix in Token Source / Plan / Display Mode submenus. Other items get a 2-space prefix for alignment. Matches the checkmark behavior already shipped in the macOS submenus.
- **Provider suffix for `claude-settings:*` entries** in Linux walker — e.g., `claude-settings:foo (zai)` instead of bare `claude-settings:foo`. Matches macOS submenu behavior. Provider is detected from `ANTHROPIC_BASE_URL` in the settings file via the existing provider registry (z.ai, MiniMax, OpenRouter, Komilion, Packy, etc.).
- New JS module `lib/detect-token-source.js` — pure ES module with full dependency injection (platform, env, paths, spawnImpl, fsImpl, isTokenValidImpl). CLI mode: `bun lib/detect-token-source.js` writes detected source to stdout, advisory message to stderr. Unified probe result shape with explicit `errorKind` (`enoent` / `malformed` / `eperm` / `unknown`) so the detector can distinguish "file missing" from "file corrupted".
- New CLI flag `--format=walker` on `lib/cli-list-settings.js` emits walker-formatted output (`claude-settings:NAME (provider)`) directly, eliminating duplicate awk pipelines in bash callers.
- Setup test harness env vars: `AIGAUGE_SETUP_DRY_RUN=1` (skips all side-effecting calls — systemctl, launchctl, waybar patching — but still writes config.json), `AIGAUGE_SETUP_PLATFORM=linux|darwin` (overrides platform detection so macOS dev machines can test the Linux path and vice versa), `AIGAUGE_DETECT_SKIP_KEYCHAIN=1` (skip macOS Keychain in detect — useful for headless/SSH sessions and CI).
- Walker test harness env var `SUBMENU_DRY_RUN=1` (combined with `DRY_RUN=1`): submenu handlers in `bin/ai-gauge-config` print options that would go to walker instead of invoking `omarchy-launch-walker`. Backward-compatible with existing `DRY_RUN=1` contract — without `SUBMENU_DRY_RUN`, handlers still emit `WOULD_SET: <key>`.
- 31 new tests: 22 in `test/detect-token-source.test.js` (DI happy paths, mtime tiebreaks, expired tokens, malformed JSON, Keychain timeout, env-driven `buildPaths`, fsImpl injection, 3-way priority middle), 9 in `test/menu-integration.test.js` (Bun.spawn integration tests for top-level menu items, routing, checkmarks, provider suffix, update-state rendering, backward compat).

### Changed
- Extracted 6 helpers to `lib/bash-helpers.sh` to remove ~80 lines of duplication across `bin/ai-gauge`, `bin/ai-gauge-menu`, `bin/ai-gauge-config`: `read_config_field`, `mark_current`, `strip_walker_decorations`, `ensure_default_config` (auto-detect block was duplicated 19 lines × 2 setup branches), plus `json_encode_value` (inline in `bin/ai-gauge-config`). The `lib/bash-helpers.sh` file grew from 23 to 88 lines but the call sites became one-liners.
- `bin/ai-gauge-menu` is_macos guard now bypassable with `DRY_RUN=1` — allows testing the Linux menu path on macOS dev machines.
- README documents auto-detect behavior, new top-level menu items, and the new test harness env vars.

### Fixed
- Replaced predictable `/tmp/aigauge-menu-opts.$$` temp file in `bin/ai-gauge-menu` Token source handler with direct `$(...)` variable capture (matches the adjacent Plan handler style). Eliminates symlink-attack vector on shared `/tmp`, removes UUOC `cat`, removes manual `rm -f` cleanup.
- `bin/ai-gauge` setup no longer silences detect module's stderr with `2>/dev/null`. Users now see the helpful "Auto-detected: opencode (also available: codex). Run 'ai-gauge-config' to switch." advisory when multiple credential sources are present.
- `test/menu-integration.test.js` `runScript` helper now sets `signal: AbortSignal.timeout(5000)` on `Bun.spawn` so a runaway script can't hang the test runner.

## [1.4.2] — 2026-04-25

### Fixed
- **Claude Code credentials on macOS** — Anthropic moved OAuth tokens from `~/.claude/.credentials.json` to **macOS Keychain** (service `Claude Code-credentials`) starting in Claude Code v2.0.14+, which made `tokenSource: claude-code` silently fail with `credentials_missing` for every macOS user who re-logged in after the migration. `readClaudeCodeCredentials()` now tries Keychain first via `/usr/bin/security find-generic-password` (with a 3s timeout to avoid hanging the daemon poll loop), accepts both the legacy `{claudeAiOauth: {...}}` wrapper and the newer flat `{accessToken, ...}` shape, and falls back to the legacy file for Linux + macOS SSH/headless sessions where Keychain access is denied with "User interaction is not allowed". Honors `CLAUDE_CONFIG_DIR` via the same `Claude Code-credentials-{sha256(dir)[:8]}` service-name scheme Claude Code itself uses.
- **Token rotation transparently handled**: `fetchUsage` now re-reads credentials once on HTTP 401/403 from the anthropic provider (only when `tokenSource` is set and `baseUrl` is not custom — i.e. claude-code/opencode flows) and retries with the fresh token if it differs. No proactive OAuth refresh — we let Claude Code itself rotate the token in Keychain/file and just pick up the new one. Other providers (codex JSONL fallback, claude-settings:* custom proxies) are unaffected.

### Added
- macOS menubar app now detects when the WebSocket server is unreachable for 7+ seconds after launch and shows clear install instructions in the tooltip ("ai-gauge daemon not running — install via `bun add -g ai-gauge && ai-gauge setup`") instead of staying in the indefinite "Connecting…" / "Waiting for data…" state. Solves the case where a user downloaded just the Swift `.app` and ran it without ever installing the npm package.
- Test hook `setReadCredentialsImpl(fn)` mirroring `setFetchImpl(fn)` so integration tests can deterministically exercise the 401-rotation-retry path without touching real Keychain/files.

### Changed
- **GitHub Releases no longer ship `AIGauge.app.tar.gz` or `ai-gauge-menubar`**. The `.app` bundle is a UI client only — it requires the daemon shipped inside the npm package. Users who downloaded the standalone `.app` ended up with a stuck menubar because there was no `ws://localhost:19876` to connect to. Canonical install is now `bun add -g ai-gauge && ai-gauge setup` for both macOS and Linux. The Release body now ends with an Installation footer pointing back to the README so users who land on the Release page get redirected to the right install path.
- 17 new tests covering Keychain happy path, legacy-vs-flat payload, exit-code-44 (item not found) → file fallback, "User interaction is not allowed" (SSH) → file fallback, malformed Keychain payload → file fallback, missing accessToken → file fallback, spawn ENOENT → file fallback, both unavailable → null, Linux platform skips spawn, Keychain priority over file, `CLAUDE_CONFIG_DIR`-derived service names (default + sha256-suffixed + stable hash + per-dir uniqueness), 401-rotation-retry happy path, no-retry when re-read returns same token, single-retry cap, and skip-retry for custom-baseUrl providers.

## [1.4.1] — 2026-04-25

### Fixed
- macOS menubar getting permanently stuck in **"Switching…"** state after clicking a different token source. Three-layer recovery introduced in 1.4.0's optimistic UI was missing:
  1. Server now sends `{type:"configError",key,value,reason}` to the requesting WebSocket client whenever `setConfig` validation/persistence fails (previously silent return → optimistic clients sat in "Switching…" forever).
  2. Server's `open()` handler now sends an empty broadcast to (re)connecting clients when `cachedData` is `null` so optimistic state can clear without waiting for the next 60s poll. Previously a WebSocket reconnect mid-switch left clients with no broadcast at all until the next successful fetch.
  3. macOS menubar `applyOptimisticTokenSource()` now starts an 8-second watchdog. If no broadcast or `configError` arrives in that window, the tooltip switches to a clear "Switch timed out" message instead of staying frozen.

### Added
- WebSocket message type `configError` (server → requester only). Client-targeted, not broadcast — other clients are unaffected. See AGENTS.md for the full schema and emission triggers.
- `ConfigErrorPayload` decoder + `onConfigError` callback in the macOS Swift WebSocket client.
- 5 integration tests in `test/integration/setconfig-recovery-flow.test.js` covering: malformed `tokenSource` → configError, invalid `plan` → configError, configError targeting only the requester, empty broadcast on first connect, and reconnecting client receiving fresh meta after a tokenSource switch.

## [1.4.0] — 2026-04-24

### Added
- Codex (ChatGPT Plus/Pro/Business/Enterprise/Edu) usage monitoring via new `tokenSource: "codex"` — reads `~/.codex/auth.json`, fetches `chatgpt.com/backend-api/wham/usage`
- JSONL session fallback for Codex when HTTP endpoint is unreachable (parses `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`); also kicks in when `~/.codex/auth.json` is missing but recent sessions are on disk
- Plan values `plus`, `business`, `edu` for Codex subscription tiers
- Top-level broadcast field `code_review` (Codex code review rate limit window)
- Top-level broadcast field `secondary` — when `tokenSource: "opencode"` and the OpenCode auth.json carries both an Anthropic AND an OpenAI OAuth block, the daemon fetches both providers in parallel and the menubar/waybar tooltip shows Claude AND Codex usage in a single view
- "Codex" entry in macOS menubar "Change token source" submenu
- `chatgpt.com` added to SSRF known-provider host allowlist
- Optimistic UI for menubar token-source switching: checkmark and tooltip update immediately, server force-refetches with the new credentials, in-flight HTTP fetches are aborted via `AbortController` to prevent stale-broadcast races

### Changed
- WebSocket `protocolVersion` bumped from `2` → `4` (additive — v2/v3 clients ignore the new `code_review` and `secondary` fields)
- Codex JSONL fallback narrowed to HTTP 401/403/5xx and network errors only (404/429 do NOT trigger fallback)

### Security
- `account_id` and `refresh_token` now redacted (`***`) in daemon structured logs via `lib/log-safe.js`
- Codex JSONL walker rejects symlinks at every directory level (`lstat`-based) to prevent reading arbitrary user-readable files via a malicious symlinked `~/.codex/sessions`
- JWT parser hardened with 16KB total / 8KB payload size limits and defensive type checks on the `https://api.openai.com/auth` claim

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
