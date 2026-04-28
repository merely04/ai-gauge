# AGENTS.md — ai-gauge

Compact guide for AI agents working in this repo. For user-facing docs see `README.md` and `docs/LLM_INSTALL.md`.

## Stack (unusual, read this first)

- **Runtime: Bun (not Node)** — `bin/ai-gauge-server` and `bin/ai-gauge-waybar` use `#!/usr/bin/env bun` and Bun-native APIs (`Bun.file`, `Bun.serve`, `Bun.spawn`). Do not rewrite as Node/ESM.
- **Three bash scripts** (`bin/ai-gauge`, `bin/ai-gauge-config`, `bin/ai-gauge-menu`) — all start with `set -euo pipefail`. Respect that when editing.
- **Plain JavaScript, no TypeScript.** No `tsconfig.json`, no build step, no bundler.
- **Zero npm runtime deps.** `package.json` has no `dependencies`/`devDependencies`. The WebSocket server and client are hand-rolled. Do not add a dep without discussing.
- **Linux + macOS**: `"os": ["linux", "darwin"]` in `package.json`. Linux assumes systemd user services, `$XDG_RUNTIME_DIR`, wl-copy, notify-send. macOS uses launchd LaunchAgents, `$TMPDIR`, and a native Swift menubar app.
- **Tests**: `bun test` for new modules (macOS port). No TypeScript, no test runner deps. Existing Linux code untested by design. Verification also manual: `systemctl --user status ai-gauge-server` and `journalctl --user -u ai-gauge-server -n 20`.

## Commands — there are no `npm run` targets

There is no test/lint/build. Interact via the five bin entries directly:

| Command | Language | Role |
|---|---|---|
| `bin/ai-gauge` | bash | User-facing CLI: `setup` / `uninstall` / `status` / `version` |
| `bin/ai-gauge-server` | Bun | WebSocket daemon on `ws://localhost:19876`; polls Anthropic `/api/oauth/usage` |
| `bin/ai-gauge-waybar` | Bun | Thin WS client — emits waybar JSON to stdout (Linux) |
| `bin/ai-gauge-menubar` | Swift (binary) | Native macOS MenuBarExtra app — universal arm64+x86_64 (macOS) |
| `bin/ai-gauge-menu` | bash | Linux: right-click menu (`omarchy-launch-walker` + `wl-copy` + `notify-send`). macOS: prints guidance — menu lives in the Swift app instead. |
| `bin/ai-gauge-config` | bash | Settings CLI (`set <key> <value>`) / walker UI on Linux. On macOS prints guidance — settings are mutated via Swift menubar → server setConfig. Writes `~/.config/ai-gauge/config.json`. |

Manual sanity checks after editing:

```bash
systemctl --user restart ai-gauge-server
journalctl --user -u ai-gauge-server -n 30 --no-pager
ai-gauge-waybar          # prints one waybar JSON line per server broadcast; Ctrl-C to stop
bun test                 # runs test suite for new modules
```

## Runtime architecture

One Bun server, many clients. Everything talks over **hardcoded** `ws://localhost:19876`.

```
bin/ai-gauge-server (systemd --user, polls api.anthropic.com every 60s)
  ├── ws://localhost:19876 ──► bin/ai-gauge-waybar        (waybar module)
  ├── ws://localhost:19876 ──► lib/streamdock-plugin/...  (Fifine D6 via Wine)
  └── writes $XDG_RUNTIME_DIR/ai-gauge/usage.json         (consumed by bin/ai-gauge-menu via jq)
```

Key constants in `bin/ai-gauge-server` (change together if you touch the protocol):

- `WS_PORT = 19876` — also hardcoded in `bin/ai-gauge-waybar`, `bin/ai-gauge-menu`, `lib/streamdock-plugin/plugin/index.js`. Grep for `19876` before changing.
- `POLL_INTERVAL = 60_000` — normal poll cadence.
- `BACKOFF_INTERVAL = 300_000` — slower poll after a failed fetch.
- `API_URL = 'https://api.anthropic.com/api/oauth/usage'` — undocumented Anthropic endpoint, OAuth-token-authenticated.
- **Token rotation retry**: on HTTP `401`/`403` from the anthropic provider (only — not codex/zai/etc.) with a non-custom-baseUrl source, `fetchUsage` re-reads credentials once via `readCredentials` and retries with the fresh token if it differs from the original. Single retry, no recursion. This transparently handles Claude Code rotating the OAuth token between polls without us implementing OAuth refresh ourselves.

Token sources (config `tokenSource` field):

- `claude-code` (default): on macOS reads from **Keychain** first (service name `Claude Code-credentials`, or `Claude Code-credentials-{sha256(CLAUDE_CONFIG_DIR)[:8]}` when `CLAUDE_CONFIG_DIR` is set — matches Claude Code's own scheme as of v2.0.14+). Falls back to `~/.claude/.credentials.json` on Keychain miss, "User interaction is not allowed" (SSH/headless sessions), spawn timeout (3s), or malformed payload. On Linux: file only. Both formats accepted: `{ claudeAiOauth: { accessToken, expiresAt, subscriptionType } }` (legacy nested) and flat `{ accessToken, expiresAt, refreshToken, subscriptionType }`.
- `opencode`: reads `~/.local/share/opencode/auth.json` → `anthropic.access` / `anthropic.expires`. If the same file ALSO contains an `openai` block with `type: "oauth"`, `access`, and `accountId`, the daemon makes a parallel fetch to `https://chatgpt.com/backend-api/wham/usage` and broadcasts the result under the top-level `secondary` field (best-effort — primary broadcast still succeeds when secondary fails).
- `codex`: reads `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) → `tokens.access_token` / `tokens.account_id`. Fetches `https://chatgpt.com/backend-api/wham/usage` (undocumented endpoint; reverse-engineered, may change). Falls back to JSONL session parsing at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` on HTTP 4xx/5xx or network failure.
- `github`: reads credentials via three tiers in order. Tier 1: `gh auth token --hostname github.com` (works for Keychain, Secret Service, and plaintext stores). Tier 2: `~/.config/gh/hosts.yml` plaintext fallback. Tier 3: `~/.config/ai-gauge/copilot-token` file (accepts `gho_*` OAuth tokens only). Fetches `/copilot_internal/v2/token` (single-shot, short-lived token exchange). Plan auto-detected from the `limit` field in the response: 50 = free, 300 = pro, 1500 = pro-plus.

State/config paths (never relocate without updating every script):

- Config: `~/.config/ai-gauge/config.json` (`{tokenSource, plan, displayMode, autoCheckUpdates}`)
- Runtime state: `${XDG_RUNTIME_DIR:-/tmp}/ai-gauge/usage.json` (atomic write via temp + `renameSync`)
- `${stateDir}/update-state.json` — latest update availability (read by `bin/ai-gauge-menu`)
- `${cacheDir}/update-check.json` — last check result with 24h TTL
- systemd unit: `~/.config/systemd/user/ai-gauge-server.service`
- Waybar config patched: `~/.config/waybar/config.jsonc` + `~/.config/waybar/style.css`
- StreamDock install path (Wine): `~/.wine/drive_c/users/$USER/AppData/Roaming/HotSpot/StreamDock/plugins/com.ai-gauge.streamdock.sdPlugin`

## Provider Registry

`lib/providers/index.js` exports the provider registry:
- `getProvider(name)` → ProviderAdapter (throws if unknown)
- `detectProviderByBaseUrl(url)` → provider name string (`"anthropic"` for null/undefined, `"unknown"` for unrecognized hosts)
- `registerProvider(adapter)` — called by each provider module on import
- `PROVIDER_NAMES` — array of 7 supported provider names

### ProviderAdapter Interface

Each adapter exports a default object with:

```js
{
  name: string,                          // e.g. "zai"
  kind: "oauth" | "api-key" | "credit-balance" | "stub",
  buildRequest(creds, options) → { url, method, headers },
  parseResponse(json, status) → { rateLimits?, balance?, error? }
}
```

Providers: `anthropic` (OAuth), `zai`, `minimax` (api-key), `openrouter`, `komilion` (credit-balance), `packy`, `unknown` (stub), `copilot` (OAuth, single-shot internal): `lib/providers/copilot.js`; fetches `/copilot_internal/v2/token`, returns `copilot` field.

### Settings Discovery

`lib/settings-discovery.js` exports:
- `discoverSettingsFiles(claudeDir)` → `Array<PublicSettingsFile>` — for UI/WS. Does NOT include tokens or paths.
- `readSettingsFileForCreds(claudeDir, name)` → `CredentialBundle | null` — for credential dispatcher.

Security: symlinks rejected, apiKeyHelper never executed, files >1MB rejected, settings.local.json excluded, names validated with `/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/`.

Token source pattern for `claude-settings:` sources: `^(claude-code|opencode|codex|github|claude-settings:[a-zA-Z0-9_][a-zA-Z0-9_.-]*)$`

## macOS specifics

macOS uses launchd instead of systemd and a native Swift app instead of Waybar.

**Daemon management** (launchd equivalents):

```bash
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/ai-gauge-server.plist   # start
launchctl bootout  gui/$UID ~/Library/LaunchAgents/ai-gauge-server.plist    # stop
launchctl list | grep ai-gauge                                               # status
```

**Plist templates** (substituted by `ai-gauge setup` via `sed -e "s|__X__|value|g"`):

- `lib/ai-gauge-server.plist.template` — LaunchAgent for the Bun server. Placeholders: `__BUN_PATH__`, `__SERVER_PATH__`, `__LOG_DIR__`, `__HOME__`.
- `lib/ai-gauge-menubar.plist.template` — LaunchAgent for the Swift menubar app. Placeholders: `__MENUBAR_APP_EXEC__` (path inside `.app` bundle), `__LOG_DIR__`, `__HOME__`.

**Swift app**:

- Source: `macos/AIGauge/` (SPM project, swift-tools-version 5.9, macOS 13+ target, no external deps)
- Ships as `bin/AIGauge.app` — proper macOS `.app` bundle (required for `UNUserNotificationCenter`, which crashes if loaded from a raw Mach-O without `mainBundle.bundleURL`)
- Bundle structure: `bin/AIGauge.app/Contents/{Info.plist, MacOS/AIGauge, Resources/{AppIcon.icns, Credits.rtf}, _CodeSignature}`
- The raw universal binary is also kept at `bin/ai-gauge-menubar` for completeness (not used by the LaunchAgent)
- Connects to `ws://localhost:19876` (`URLSessionWebSocketTask`) and renders usage via SwiftUI `MenuBarExtra`
- Rebuild with `bash scripts/build-macos-binary.sh` — does `swift build --arch arm64` + `--arch x86_64`, `lipo -create`, ad-hoc `codesign --deep`, wraps into `.app` bundle, copies `Info.plist` + `AppIcon.icns` + `Credits.rtf`
- Icon: `macos/AIGauge/assets/AppIcon.icns`, regenerated by `scripts/generate-icon.sh` (drives a Swift + Core Graphics procedural renderer; replaceable by dropping a 1024×1024 PNG and running `sips` + `iconutil`)

**macOS state paths**:

- Runtime state: `$TMPDIR/ai-gauge/usage.json` (vs `$XDG_RUNTIME_DIR` on Linux)
- Logs: `~/Library/Logs/ai-gauge/` (server and menubar app write here)
- LaunchAgent plists installed to: `~/Library/LaunchAgents/`

## WebSocket Protocol

Port `19876` (hardcoded). All clients connect to `ws://localhost:19876`.

### Existing broadcast (server → all clients, every poll)

Server broadcasts the **raw Anthropic API response** merged with a `meta` field — clients are responsible for formatting it into display-friendly form. (Earlier revisions of this doc incorrectly described the waybar-client output as the broadcast format; that is wrong, `bin/ai-gauge-waybar` PRODUCES that shape, it doesn't receive it.)

```json
{
  "five_hour": {"utilization": 100, "resets_at": "2026-04-17T22:00:00.410733+00:00"},
  "seven_day": {"utilization": 16, "resets_at": "2026-04-24T03:00:00.410753+00:00"},
  "seven_day_oauth_apps": null,
  "seven_day_opus": null,
  "seven_day_sonnet": {"utilization": 4, "resets_at": "2026-04-24T04:00:00.410758+00:00"},
  "seven_day_cowork": null,
  "seven_day_omelette": {"utilization": 0, "resets_at": null},
  "extra_usage": {"is_enabled": true, "monthly_limit": 20000, "used_credits": 18752, "utilization": 93.76, "currency": "USD"},
  "code_review": null,
  "balance": {"total_cents": 10000, "used_cents": 3500, "currency": "USD"},
  "meta": {"plan": "unknown", "tokenSource": "opencode", "provider": "anthropic", "displayMode": "full", "fetchedAt": "2026-04-17T20:27:38.885Z", "version": "1.4.0", "protocolVersion": 3, "autoCheckUpdates": true}
}
```

Field notes:
- `five_hour.utilization` and `seven_day.utilization` are percentages (0–100+), sometimes non-integer.
- `resets_at` is ISO-8601 with **microsecond precision and `+00:00` timezone** — Swift's `ISO8601DateFormatter` with `.withFractionalSeconds` only handles milliseconds, so the Swift client has a fallback parser (see `UsageModel.parseISODate`).
- `extra_usage.monthly_limit` and `used_credits` are in cents; divide by 100 for dollars.
- `balance` — present only for credit-based providers (OpenRouter, Komilion). `total_cents` and `used_cents` are integers; divide by 100 for dollars. Absent (or `null`) for rate-limit-only providers like Anthropic.
- `code_review` — top-level rate-limit window for Codex code-review feature. `null` for non-Codex providers; `null` on Codex Plus (only present on tiers that have code review enabled). Same shape as `five_hour`/`seven_day`. Added in protocolVersion 3.
- `secondary` — optional second-provider snapshot, emitted only when `tokenSource: "opencode"` and the OpenCode auth.json contains an OAuth `openai` block. Shape: `{ provider, five_hour, seven_day, code_review, balance }`. `null` for all other tokenSources or when no OpenAI OAuth credentials are present. Added in protocolVersion 4.
- `copilot` — optional top-level Copilot quota object. `null` for non-github tokenSources. Shape: `{plan: string, premium_interactions: {utilization: number (0-200), used: number, limit: number, resets_at: ISO string, overage_count: number, overage_permitted: bool}}`. Added in protocolVersion 4 (additive, no bump needed).
- `balance.extras` — provider-specific extension fields. For `komilion`: `{trial_credits_cents: number, is_low_balance: boolean}`. Other providers: absent.
- `meta.plan`, `meta.tokenSource`, and `meta.fetchedAt` are injected by the server from `config.json` / the current state (not upstream Anthropic fields). `tokenSource` is re-broadcast on every poll and immediately after a `setConfig` mutation so clients can reflect the current selection (used by the macOS menubar for checkmarks).
- `meta.provider` — active provider name as detected by `lib/providers/index.js` (e.g. `"anthropic"`, `"zai"`, `"openrouter"`). Injected by the server; not an upstream field.
- `meta.version` — the daemon's own ai-gauge version (from `package.json`).
- `meta.protocolVersion` — currently `4` (bumped from 3 when the `secondary` top-level field was added so OpenCode users with both Anthropic and OpenAI OAuth see both providers' usage). Additive change; v3 clients ignore the new field.
- `meta.autoCheckUpdates` — current value of the `autoCheckUpdates` config key.
- `meta.displayMode` — current display mode: `full` (default), `percent-only`, `bar-dots`, `number-bar`, `time-to-reset`. Clients fall back to `full` if absent or unrecognized.
- Any of the `seven_day_*` windows may be `null`.

Client formatting responsibilities:
- `bin/ai-gauge-waybar` → `render(data)` transforms to `{text, class, tooltip}` waybar JSON.
- `macos/AIGauge/…/UsageModel.swift` → `update(from:)` ports the same logic to compute `text`, `tooltip`, `urgency` for the menubar.

Urgency thresholds (shared across clients, based on `five_hour.utilization`):

| Urgency | Waybar `class` | Swift `Urgency` | Condition |
|---|---|---|---|
| normal | `"normal"` | `.ok` | `< 50` |
| warning | `"warning"` | `.warning` | `50 ≤ x < 80` |
| critical | `"critical"` | `.critical` | `≥ 80` |
| waiting | `"waiting"` | (N/A, shows `--`) | No server / connecting |

### notify message (server → all clients, at threshold transitions)

Broadcast when usage crosses 80% or 95% threshold (`pending=false → true`). Resets below 50%.

```json
{"type":"notify","threshold":80,"percentage":82,"message":"Usage at 80%, ~N days remaining"}
```

- `threshold`: `80` or `95`
- `percentage`: actual current value
- `message`: human-readable string for notification body

### setConfig command (client → server)

Client sends to mutate `~/.config/ai-gauge/config.json`. Server validates, writes atomically, re-broadcasts.

```json
{"type":"setConfig","key":"plan","value":"team"}
{"type":"setConfig","key":"tokenSource","value":"opencode"}
{"type":"setConfig","key":"displayMode","value":"bar-dots"}
```

- key/value pairs: `plan` → `max`, `pro`, `team`, `enterprise`, `unknown`, `plus` (Codex), `business` (Codex), `edu` (Codex); `tokenSource` → `claude-code`, `opencode`, `codex`, `github`; `autoCheckUpdates` → `true`, `false`; `displayMode` → `full`, `percent-only`, `bar-dots`, `number-bar`, `time-to-reset`
- `tokenSource` also accepts `claude-settings:{name}` values matching `^(claude-code|opencode|codex|github|claude-settings:[a-zA-Z0-9_][a-zA-Z0-9_.-]*)$`
- Server **rejects** any value outside the canonical enum (logs warning, sends `{type:"configError",...}` to the requesting client, config unchanged)
- For `tokenSource` changes the server invalidates `cachedData`, broadcasts an empty payload to all clients with `meta.tokenSource` set to the new value (so optimistic clients can clear their "Switching…" state immediately), then runs `fetchAndHandleBroadcast({force:true})` to fetch fresh usage. On fetch failure, a second empty broadcast is emitted and the requester gets a `configError` with the failure reason.
- Do NOT change the raw-broadcast shape without updating both `bin/ai-gauge-waybar` and `macos/AIGauge/Sources/AIGauge/UsageModel.swift` in the same commit.

### setConfig error response (server → requester only)

Sent only to the WebSocket client that issued the offending `setConfig` command. Lets the menubar abort its optimistic "Switching…" state immediately instead of waiting for the watchdog timeout.

```json
{"type":"configError","key":"tokenSource","value":"not a valid src","reason":"invalid tokenSource=not a valid src: must match /^(claude-code|opencode|codex|github|claude-settings:[a-zA-Z0-9_][a-zA-Z0-9_.-]*)$/"}
```

Emitted when:
- `validateConfigChange()` rejects the value (e.g. malformed `claude-settings:` name, unknown plan, wrong displayMode);
- `applyConfigChange()` reports `applied=false` or throws while writing `~/.config/ai-gauge/config.json` (permission, disk full, IO error);
- For `tokenSource` only: the post-switch forced fetch (`fetchAndHandleBroadcast({force:true})`) throws after the empty broadcast has already been sent. In this case the server also re-broadcasts an empty payload to all clients so they can recover.

Note: This is **client-targeted**, not broadcast. Other clients see only the empty broadcast (or, on success, the next usage broadcast).

### Update message types (server → all clients)

Broadcast when the daemon detects or performs updates.

#### `updateAvailable`
```json
{"type":"updateAvailable","currentVersion":"1.1.1","latestVersion":"2.0.0","changelogUrl":"https://github.com/merely04/ai-gauge/compare/v1.1.1...v2.0.0"}
```

- `changelogUrl` — GitHub compare URL between the user's `currentVersion` and the incoming `latestVersion`. Opens a view showing all commits and diffs added since the user's install. If `currentVersion === latestVersion` or `currentVersion` is missing, falls back to the single-tag release page. Format: `https://github.com/merely04/ai-gauge/compare/v{currentVersion}...v{latestVersion}`.

#### `updateInstalling`
```json
{"type":"updateInstalling","latestVersion":"2.0.0"}
```

#### `updateFailed`
```json
{"type":"updateFailed","reason":"permission","command":"npm install -g ai-gauge","clipboardCopied":true}
```
`reason` values: `permission`, `tool-missing`, `timeout`, `not-found`, `network`, `unknown`, `manual-required`

#### `updateComplete`
```json
{"type":"updateComplete","reason":"completed","fromVersion":"1.1.1","installedVersion":"2.0.0"}
```
- `fromVersion` — the pre-update `packageVersion` (i.e. the version the user was running immediately before this update cycle started). Used by clients (macOS menubar) to generate a compare URL linking to the diff between the old and new versions.
- `installedVersion` — the version the daemon just installed. Matches `state.latestVersion` at the moment of broadcast.
After this broadcast, daemon calls `process.exit(0)`. systemd/launchd restart it automatically.

#### `updateCheckFailed`
```json
{"type":"updateCheckFailed","reason":"timeout"}
```

#### `updateAlreadyInProgress`
```json
{"type":"updateAlreadyInProgress"}
```

### Client → Server commands (inbound)

#### `doUpdate`
```json
{"type":"doUpdate"}
```
Triggers daemon to detect install source, spawn the update command, and broadcast state transitions.

#### `checkUpdate`
```json
{"type":"checkUpdate"}
```
Triggers immediate manual update check (bypasses `autoCheckUpdates` setting but respects `NO_UPDATE_NOTIFIER`).

#### `dismissUpdate`
```json
{"type":"dismissUpdate","version":"2.0.0"}
```
Silences `updateAvailable` broadcasts for the given version. `version` is optional — if omitted, dismisses the currently-notified version. Persisted in `update-check.json` cache; auto-clears when a newer version is released.

#### `undismissUpdate`
```json
{"type":"undismissUpdate"}
```
Clears the dismiss marker and triggers a fresh `checkUpdate` so the notification can return.

#### `listSettingsFiles`
```json
{"type":"listSettingsFiles"}
```
Requests on-demand discovery of `~/.claude/settings*.json` files. Server responds with:
```json
{"type":"settingsFiles","files":[{"name":"myprovider","provider":"zai"},{"name":"work","provider":"anthropic"}]}
```
- `name` — the settings file name without the `settings.` prefix and `.json` suffix (e.g. `myprovider` for `settings.myprovider.json`)
- `provider` — detected provider name from `lib/providers/index.js` based on `ANTHROPIC_BASE_URL` in the file's `env` block
- Used by the macOS menubar to populate the dynamic "Change token source" submenu

### Update system env vars

- `NO_UPDATE_NOTIFIER=1` — disable all update checks (also respected by CI auto-detection)
- `CI` / `CONTINUOUS_INTEGRATION` / `GITHUB_ACTIONS` / `GITLAB_CI` / `CIRCLECI` / `JENKINS_HOME` / `BUILDKITE` / `DRONE` / `TRAVIS` — any truthy value disables update checks
- `AIGAUGE_REGISTRY_URL` — override npm registry URL (testing only, default: `https://registry.npmjs.org`)
- `AIGAUGE_INSTALL_SOURCE` — override detected install source: `npm|bun|pnpm|brew|yarn` (testing only)
- `AIGAUGE_NPM_COMMAND` — override npm binary path (testing only, e.g., `/tmp/fake-npm.sh`)
- `AIGAUGE_UPDATING=1` — set by daemon during spawn; cleared on restart
- `AIGAUGE_UPDATE_CHECK_INITIAL_DELAY_MS` — override initial check delay (testing)
- `AIGAUGE_UPDATE_CHECK_INTERVAL_MS` — override check interval (testing)
- `AIGAUGE_UPDATE_SPAWN_TIMEOUT_MS` — override update spawn timeout (default 120000)
- `AIGAUGE_UPDATE_FETCH_TIMEOUT_MS` — override registry fetch timeout (default 10000)
- `AIGAUGE_LOG_FORMAT=json` — switches daemon logs from human-readable text to structured JSON (one record per line: `ts`, `level`, `component`, `event`, extra fields)
- `AIGAUGE_TEST_UPDATE_AVAILABLE=1` — macOS menubar test hook: injects fake update available state (also set `AIGAUGE_TEST_LATEST_VERSION=x.y.z`)
- `AIGAUGE_TEST_UPDATE_INSTALLING=1` — macOS menubar test hook: injects installing state
- `AIGAUGE_TEST_UPDATE_FAILED=<reason>` — macOS menubar test hook: injects failed state
- `AIGAUGE_MENU_STATE_PATH` — macOS menubar: when set, app writes JSON state snapshot on every update
- `AIGAUGE_TEST_PROTOCOL_VERSION` — integer, triggers `protocolMismatch` check in Swift app
- `AIGAUGE_TEST_PROVIDER` — string, synthesizes test broadcast with given provider name
- `AIGAUGE_TEST_FIVE_HOUR` — integer 0-100, five_hour.utilization for test broadcast
- `AIGAUGE_TEST_SEVEN_DAY` — integer 0-100, seven_day.utilization for test broadcast
- `AIGAUGE_TEST_BALANCE_TOTAL_CENTS` — integer, balance.total_cents for test broadcast
- `AIGAUGE_TEST_BALANCE_USED_CENTS` — integer, balance.used_cents for test broadcast

Note: launch `.app` directly via `bin/AIGauge.app/Contents/MacOS/AIGauge` for env hooks to work (not via `open bin/AIGauge.app`).

### Update system architecture

```
Update Check Flow:

bin/ai-gauge-server
  ├── checks registry.npmjs.org every 24h (30s initial delay)
  ├── broadcasts {type:"updateAvailable",...} to all WS clients
  │     ├── bin/ai-gauge-waybar → shows ⬆ in waybar text, CSS class update-available
  │     └── bin/AIGauge.app → shows Update badge + "Update to vX.Y.Z" menu item
  └── on doUpdate command:
        ├── detects install source (npm/bun/pnpm/brew)
        ├── spawns install command (or clipboard fallback for brew)
        └── broadcasts updateInstalling → updateComplete/updateFailed
              └── daemon self-restarts via process.exit(0) on success
```

## Setup / uninstall — non-obvious details

`ai-gauge setup` (in `bin/ai-gauge`) does, in order:

1. Resolves `bun` from `$PATH` and `ai-gauge-server` from `$PATH` (via `readlink -f`).
2. `sed`-substitutes `__BUN_PATH__` and `__SERVER_PATH__` into the template `lib/ai-gauge-server.service` and installs to `~/.config/systemd/user/`. Both placeholders must stay intact in the template.
3. `systemctl --user daemon-reload && enable --now ai-gauge-server`.
4. Copies `lib/streamdock-plugin/` into the Wine StreamDock plugins path **only if that path already exists**. Silent skip otherwise.
5. **Patches waybar `config.jsonc` with an inline `python3 -c "..."` script** — this requires `python3` to be installed even though nothing else in the repo is Python. The patch looks for the literal string `"custom/notification-silencing-indicator",` to anchor insertion; it is an Omarchy-specific default. On non-Omarchy configs the module array insertion may silently no-op while the module definition still gets appended before the final `}`.
6. Appends CSS between `/* ai-gauge-start */` and `/* ai-gauge-end */` markers in `~/.config/waybar/style.css`. Uninstall uses these markers to strip the block.
7. Restarts waybar via `omarchy-restart-waybar` if available, otherwise `killall -SIGUSR2 waybar`, otherwise hard restart.

Both setup and uninstall are idempotent — they guard with `grep -q` before patching. Preserve this when editing.

### macOS setup flow (when `is_macos`)

`cmd_setup_macos` in `bin/ai-gauge` short-circuits the Linux path and does:

1. Resolves `bun` (`command -v bun` → `resolve_path`) and paths to `$BIN_DIR/ai-gauge-server`, `$BIN_DIR/AIGauge.app/Contents/MacOS/AIGauge`.
2. If the `.app` bundle is missing, runs `scripts/build-macos-binary.sh` locally.
3. `xattr -dr com.apple.quarantine` on `bin/AIGauge.app` (handles Gatekeeper on freshly downloaded npm tarballs).
4. Substitutes placeholders into both plist templates → writes `~/Library/LaunchAgents/com.ai-gauge.{server,menubar}.plist`, validates with `plutil -lint`.
5. `launchctl bootout gui/$UID/label` (ignore failure) + `launchctl bootstrap gui/$UID plist` for idempotent re-registration — NOT `launchctl load` (legacy syntax, avoid).
6. Logs live at `~/Library/Logs/ai-gauge/{server,menubar}.{log,err}`; state at `$TMPDIR/ai-gauge/usage.json`.

`cmd_uninstall` on macOS: `bootout` both agents, delete both plists, `rm -rf $TMPDIR/ai-gauge`. Preserves `~/.config/ai-gauge/config.json` (user setting, survives reinstall).

## External tools the scripts assume

Not npm packages — system binaries. None are declared anywhere; if you add a new one, document it in `docs/LLM_INSTALL.md` under Prerequisites.

- **Required (all platforms)**: `bun`, `bash`, `jq`, `sed`, `readlink`.
- **Required (Linux)**: `python3` (waybar setup; pre-release validator for `Info.plist` parsing via `plistlib`), `systemctl` (user).
- **Required (macOS)**: `launchctl`, `plutil`, `codesign`, `sips`, `iconutil`, `lipo` (all built into macOS). Xcode Command Line Tools (for `swift build`) required only when rebuilding the Swift binary locally; users installing the published npm package get the pre-built `bin/AIGauge.app`.
- **Desktop integration (Linux)**: `notify-send` (libnotify), `wl-copy` (wl-clipboard), `waybar`.
- **Optional, `tokenSource: github`**: `gh` (GitHub CLI) — required at runtime for Tier 1 credential resolution (`gh auth token --hostname github.com`). Falls back to file-based tiers if absent.
- **Optional, Omarchy distro**: `omarchy-launch-walker` (menu/settings UI), `omarchy-restart-waybar`. Scripts degrade gracefully when these are missing.
- **Optional, StreamDock path**: Wine + Fifine Control Deck + StreamDock app. `run.bat` hardcodes `C:\Program Files (x86)\fifine Control Deck\node\node20.exe` and sets `NODE_SKIP_PLATFORM_CHECK=1` — do not change this path, it is the Fifine-bundled Node the plugin host uses.

## Release / publish

- Trigger: `git tag vX.Y.Z && git push --tags`. CI is `.github/workflows/publish.yml`.
- CI uses **Node 22 + `npm publish`** (not Bun) with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. This is fine because publishing is just tarball upload — the code still runs on Bun at the user's machine.
- Published files (from `package.json` `files`): `bin/` (including the full `bin/AIGauge.app/**` bundle for macOS), `lib/`, both `*.plist.template` files, `README.md`, `docs/`. `assets/`, `macos/` sources, and `.sisyphus/` are excluded.
- **GitHub Releases ship release notes only — no `.app`/binary attachments** (since v1.4.2). The macOS menubar app is a UI client only and is useless without the daemon shipped inside the npm package; attaching `AIGauge.app.tar.gz` to Releases caused users to drag it into `/Applications` and end up with a stuck menubar. The canonical install is `bun add -g ai-gauge && ai-gauge setup` for both macOS and Linux. The `create-github-release` job creates the Release with `gh release create` (no asset arguments) and appends an Installation footer pointing back to the README.
- Bump `"version"` in `package.json` manually before tagging. The lib/streamdock-plugin/manifest.json `Version` field is separate — update it only when the StreamDock plugin protocol actually changes. **See Pre-release checklist below for the full procedure, including CHANGELOG and `Info.plist` sync.**

### Pre-release checklist

Before tagging a release, run through this list in order. The pre-push hook will catch violations, but fixing them pre-push is cheaper than reverting a pushed tag.

1. **Bump `package.json` version** — edit `"version"` to the new `X.Y.Z`.
2. **Update `CHANGELOG.md`** — promote the content currently under `## [Unreleased]` into a new `## [X.Y.Z] — YYYY-MM-DD` section (use em-dash `—`, the repo style). Leave a fresh empty `## [Unreleased]` on top.
3. **Sync the macOS `Info.plist` files** — on macOS, run `bash scripts/build-macos-binary.sh`. It stamps BOTH `macos/AIGauge/Sources/AIGauge/Info.plist` and the rebuilt `bin/AIGauge.app/Contents/Info.plist` from `package.json` (source is stamped first, then copied into the bundle). On Linux (no Swift toolchain), manually edit both plist files — update both `CFBundleShortVersionString` and `CFBundleVersion`.
4. **Run the validator** — `bash scripts/validate-release.sh`. Must exit 0. If it fails, fix the mismatch it reports and re-run.
5. **Commit the bump** — `git commit -am "release: vX.Y.Z"`.
6. **Tag and push** — `git tag vX.Y.Z && git push origin master --tags`. The pre-push hook re-runs the validator with `--tag vX.Y.Z` and aborts the push on mismatch.
7. **Post-push** — CI builds the macOS binary, publishes to npm, and creates a GitHub Release from the matching CHANGELOG entry.

### Hook activation

The pre-push hook lives at `.githooks/pre-push` and is activated by `git config core.hooksPath .githooks`.

- **Automatic**: `package.json` has a `prepare` script (`git config core.hooksPath .githooks || true`) that runs on `bun install` / `npm install` after cloning.
- **Manual** (if `prepare` didn't run): `git config core.hooksPath .githooks`. Verify with `git config --get core.hooksPath` — expected output: `.githooks`.
- **Bypass** (use sparingly): `git push --no-verify`. Only acceptable when the validator itself is broken and blocks a necessary push. If you reach for `--no-verify` regularly, the validator is wrong — fix it.

### Validator usage

- **Standalone** (check current repo state): `bash scripts/validate-release.sh` or `bun run validate-release`.
- **With explicit tag** (also asserts the tag matches `v<package.json version>`): `bash scripts/validate-release.sh --tag v1.2.3`.
- **Exit codes**: `0` success, `1` version mismatch (diff on stderr), `2` required file missing.
- **Test override**: `AIGAUGE_REPO_ROOT=/path/to/fixture bash scripts/validate-release.sh` — point at a fixture root. Used by `test/validate-release.test.js`.
- **Linux fallback override**: `AIGAUGE_SKIP_PLUTIL=1 bash scripts/validate-release.sh` — forces the python3 `plistlib` branch even on macOS (exercises the Linux code path).

## Editing gotchas

- **Don't break the `lib/ai-gauge-server.service` template.** Placeholders `__BUN_PATH__` / `__SERVER_PATH__` are substituted with `sed` and any `|` in new paths would break the `sed` delimiter. Keep them.
- **Hardcoded port 19876** appears in at least 5 places — grep before renaming.
- **StreamDock plugin is a self-contained distributable**, not a library the Bun code imports. It lives under `lib/` only because it ships in the npm tarball. It runs under Wine, not Linux, using the Fifine-bundled Windows Node.
- **The `ai-gauge-server` sends threshold notifications** through `systemNotify()` from `lib/notify.js`. On Linux that shells out to `notify-send`; on macOS it no-ops (stderr log) because the Swift menubar handles it via `UNUserNotificationCenter` after receiving the `{type:"notify",...}` WS broadcast. The `alerted80` flag still gates duplicate alerts on the server side, resetting below 50%.
- **Setup's waybar JSON patch is fragile** — it uses string replacement on `config.jsonc`, not a real JSON parser (jsonc allows comments). Test changes against a real Omarchy/Hyprland waybar config.
- **`claudeVersion` at the top of `bin/ai-gauge-server`** (currently `'2.1.100'`) is the User-Agent value sent to the Anthropic usage endpoint. Auto-updated from a real Claude install if available. Bumping the fallback without reason can break fetches if Anthropic validates it.
- **Commit style**: repo has no PR template. Keep commits small and focused. Tests live under `test/` and run via `bun test`. `CHANGELOG.md` is required — every release needs a matching `## [X.Y.Z] — YYYY-MM-DD` section (see Pre-release checklist).
- **Pre-push hook lives at `.githooks/pre-push`** and is activated by `git config core.hooksPath .githooks`. The hook validates version consistency ONLY when the push includes a `vX.Y.Z` tag — regular branch pushes are untouched. Activated automatically via `package.json` `prepare` script (triggered by `bun install` / `npm install`). Bypass with `git push --no-verify` only if the validator itself is broken.
- **`.gitignore` ignores `.sisyphus/`, `node_modules/`, `bun.lock*`** — `bun link` creates `node_modules/.bin/` symlinks during local dev, don't commit them.
- **`lib/ssrf-guard.js`** — SSRF protection on all user-controlled `baseUrl` fetches. Blocks HTTP, private IP ranges (RFC1918, link-local), and IPv6 loopback. Call it before any `fetch()` that uses a URL from config or a settings file.
- **`lib/log-safe.js`** — secret masking for daemon logs. Use `logJson()` for structured events; never log raw tokens or credential values. The masker redacts anything matching `TOKEN|KEY|SECRET|CREDENTIAL|AUTH|PASSWORD|PASSPHRASE`.
- **Hardcoded VS Code Copilot ext headers in `lib/providers/copilot.js`** — FRAGILE, see `codex.js` precedent. Update procedure: bump headers when GitHub deprecates them en masse. Check https://marketplace.visualstudio.com/items?itemName=GitHub.copilot for current version. No automated detection.
