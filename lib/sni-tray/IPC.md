# SNI Tray IPC v1

Defines the inter-process contract between `bin/ai-gauge-tray` (Bun parent process) and `lib/sni-tray/sni-helper.py` (Python child process) for the Linux SNI system-tray integration.

**Scope**: IPC v1 only. The WebSocket protocol between `bin/ai-gauge-server` and all clients is a separate versioning track, currently at protocolVersion 4 (see AGENTS.md — WebSocket Protocol section). IPC v1 is frozen for Wave 1 implementers. Future versions bump the version number in this document and optionally add a `protocolVersion` field to the `init` command for cross-version compatibility.

## Wire Format

- Encoding: UTF-8 only, both directions.
- Framing: newline-delimited JSON (`\n`). One JSON object per line.
- Max line size: 1 MB. Lines exceeding 1 MB are logged to stderr and dropped; the channel stays open.
- **Malformed line policy**: log to stderr, emit `{"event":"helper-error","reason":"parse-error","message":"<details>"}` on stdout, then continue. Do NOT crash or close the channel.
- Python helper MUST write every stdout line with `flush=True`. Bun's subprocess reader blocks until a newline + flush; omitting flush causes test timeouts.

## Commands (Bun → Python)

Sent over the helper's stdin. Commands MUST arrive after `init` (except `init` itself). Frozen for IPC v1 — no additions or removals in Wave 1.

### `init`
```json
{"cmd":"init","title":"AI Gauge","category":"ApplicationStatus","id":"ai-gauge"}
```
Must be the first command. Sets SNI `Title`, `Category`, and `Id` D-Bus properties. Helper registers with StatusNotifierWatcher immediately. On failure, emits `watcher-unavailable` and exits 2. Fields: `title` (string), `category` (string), `id` (string).

### `set-icon`
```json
{"cmd":"set-icon","name":"ai-gauge-normal"}
```
Sets SNI `IconName` and emits `NewIcon`. `name` must be one of the six values in the Icon Names enum. Unknown values cause `helper-error` with `reason:"unknown-icon"`; current icon unchanged.

### `set-status`
```json
{"cmd":"set-status","value":"Active"}
```
Sets SNI `Status` and emits `NewStatus`. `value` must be `"Active"`, `"Passive"`, or `"NeedsAttention"`. Other values cause `helper-error` with `reason:"invalid-status"`.

### `set-tooltip`
```json
{"cmd":"set-tooltip","title":"AI Gauge","body":"5-hour:  44%  (resets in 2h 31m)\nWeekly:  15%  (resets in 6d 17h 54m)"}
```
Sets SNI `ToolTip` and emits `NewToolTip`. `body` may contain `\n` line breaks. Plain text only — no HTML, no markup. See Tooltip Struct section.

### `set-menu`
```json
{"cmd":"set-menu","items":[{"id":"refresh-now","label":"Refresh now","type":"","enabled":true}]}
```
Full tree replacement of the DBusMenu at `/MenuBar`. Helper diffs internally and emits only necessary `ItemsPropertiesUpdated` / `LayoutUpdated` signals to avoid signal storms. `items` is an array of MenuItem objects (see Menu Item Struct).

### `shutdown`
```json
{"cmd":"shutdown"}
```
Graceful shutdown. Helper unregisters from StatusNotifierWatcher, releases D-Bus name, exits 0.

## Events (Python → Bun)

Written to stdout, one JSON object per line. Frozen for IPC v1.

### `activate`
```json
{"event":"activate","x":100,"y":200}
```
Left-click. `x`/`y` are screen coordinates from the D-Bus `Activate` method; may be `0` when the compositor omits them.

### `secondary-activate`
```json
{"event":"secondary-activate","x":100,"y":200}
```
Middle-click. Same coordinate semantics as `activate`.

### `context-menu`
```json
{"event":"context-menu","x":100,"y":200}
```
Emitted when the SNI `ContextMenu` D-Bus method is called directly. Plasma 6 normally queries `/MenuBar` via DBusMenu instead, so this is rarely seen — emit it regardless when the method is invoked.

### `menu-click`
```json
{"event":"menu-click","id":"refresh-now"}
```
User selected a menu item. `id` matches an ID from the Menu Item ID Enum. Disabled items and info rows must not emit this event.

### `menu-about-to-show`
```json
{"event":"menu-about-to-show","id":"set-token-source"}
```
A submenu is about to open. Bun may refresh dynamic content before the submenu renders.

### `watcher-unavailable`
```json
{"event":"watcher-unavailable","reason":"org.kde.StatusNotifierWatcher was not provided"}
```
Registration failed. Helper exits 2 immediately after emitting this. Bun retries every 60s, up to 5 attempts, then exits cleanly with code 0.

### `helper-error`
```json
{"event":"helper-error","reason":"parse-error","message":"invalid JSON on line 7: Unexpected token"}
```
Non-fatal. Helper continues. `reason` values are **extensible** — current set: `parse-error`, `unknown-command`, `dbus-import-failed`, `signal-emit-failed`, `unknown-icon`, `invalid-status`. `message` MUST be safe to log per `lib/log-safe.js` conventions (no tokens, no credentials). Use `logJson()` on the Bun side when forwarding to the daemon log.

### `test-echo`
```json
{"event":"test-echo","cmd":{"cmd":"set-icon","name":"ai-gauge-normal"}}
```
Emitted only when `AIGAUGE_SNI_TEST_MODE=1`. Echoes each received command back, allowing `test/sni-helper.test.js` to run without a live D-Bus session.

## Icon Names (FROZEN v1)

Exactly six names. No additions in Wave 1: `ai-gauge-normal`, `ai-gauge-waiting`, `ai-gauge-warning`, `ai-gauge-critical`, `ai-gauge-update-available`, `ai-gauge-updating`.

**Priority ladder** (highest wins when multiple states are active): `updating` > `critical` > `warning` > `update-available` > `normal`. `ai-gauge-waiting` is shown only when the WebSocket is disconnected — it replaces all other icons and does not participate in the ladder. Example: usage at 85% with an update available → show `ai-gauge-critical`.

## Status Semantics

- `Active` — normal operation; icon visible, data present.
- `Passive` — WebSocket disconnected; icon remains visible (Plasma may dim it).
- `NeedsAttention` — five-hour utilization ≥ 80%; Plasma 6 may render a breathing animation.

## Tooltip Struct

```
{"title": string, "body": string}
```

`body` is `\n`-separated plain text, no HTML, no markdown. The tray tooltip body MUST byte-match the Waybar tooltip body for the same broadcast. Both use `formatDuration(resetsAt)` (short: `2h31m`) and `formatDurationLong(resetsAt)` (long: `2d 9h 59m`) from `lib/render-waybar.js`. Shared computation lives in `lib/tray-menu.js:computeTooltip()`.

## Menu Item Struct

```typescript
{
  id?: string,           // omit for pure separators
  label: string,
  type?: "separator" | "menu" | "",  // "" or omitted = action item
  enabled?: boolean,     // default true
  visible?: boolean,     // default true
  toggleType?: "checkmark" | "radio" | null,
  toggleState?: 0 | 1,
  icon?: string,         // system theme icon name, optional
  children?: MenuItem[]  // only when type === "menu"
}
```

## Menu Item ID Enum

**Static IDs (FROZEN v1)** — no additions or removals in Wave 1, referenced byte-for-byte by Bun client, Python helper, and tests:

`refresh-now`, `restart-server`, `copy-summary`, `copy-raw`, `open-settings`, `quit`, `check-update`, `install-update`, `view-changelog`, `dismiss-update`, `toggle-auto-check-updates`

**Dynamic prefix IDs (FROZEN v1)** — format `<prefix>:<value>`:
- `set-token-source:<value>` — e.g. `set-token-source:opencode`
- `set-plan:<value>` — e.g. `set-plan:max`
- `set-display-mode:<value>` — e.g. `set-display-mode:bar-dots`

Valid values match the `setConfig` enums in AGENTS.md. The macOS Swift menubar uses the same logical IDs; see `macos/AIGauge/Sources/AIGauge/MenuBarView.swift` lines 10-23 for the canonical plan/source/displayMode lists.

**Reserved info-row IDs (FROZEN v1)** — always `enabled:false`, never emit `menu-click`:

`info:five-hour`, `info:weekly`, `info:sonnet`, `info:code-review`, `info:extra-usage`, `info:balance`, `info:provider`, `info:plan`, `info:secondary`, `info:copilot`

## Test-Mode Contract

When `AIGAUGE_SNI_TEST_MODE=1`, the helper skips all `dbus`/`gi` imports and runs an echo loop: for each stdin line, parse JSON, write `{"event":"test-echo","cmd":<parsed>}` to stdout with `flush=True`. Enables `test/sni-helper.test.js` on macOS and in CI.

| Variable | Side | Effect |
|---|---|---|
| `AIGAUGE_SNI_TEST_MODE=1` | helper | Skip D-Bus imports, run echo loop |
| `AIGAUGE_SNI_LIVE_TESTS=1` | test runner | Opt in to live D-Bus tests (`test/sni-helper-live.test.js`) |
| `AIGAUGE_TRAY_HELPER_CMD=<cmd>` | Bun client | Override helper spawn command |
| `AIGAUGE_TRAY_RECONNECT_DELAY_MS=<ms>` | Bun client | Override WebSocket reconnect delay |
| `AIGAUGE_TRAY_HELPER_RESTART_INITIAL_DELAY_MS=<ms>` | Bun client | Override helper restart backoff |

## Worked Example

Full startup-to-interaction sequence. `→` denotes a message crossing the IPC boundary.

1. `bin/ai-gauge-tray` starts; no `ai-gauge-server` running. Bun spawns `lib/sni-tray/sni-helper.py`.
2. Bun → helper: `{"cmd":"init","title":"AI Gauge","category":"ApplicationStatus","id":"ai-gauge"}`. Helper registers with StatusNotifierWatcher.
3. Bun → helper: `{"cmd":"set-icon","name":"ai-gauge-waiting"}` + `{"cmd":"set-status","value":"Passive"}`. Tray icon appears dimmed.
4. `ai-gauge-server` starts. Bun connects to `ws://localhost:19876`, receives first broadcast (protocolVersion 4).
5. Bun parses broadcast: `five_hour.utilization` = 44 (normal). Sends in sequence:
   - → `{"cmd":"set-icon","name":"ai-gauge-normal"}`
   - → `{"cmd":"set-status","value":"Active"}`
   - → `{"cmd":"set-tooltip","title":"AI Gauge","body":"Claude Code Usage\n───────────────\n5-hour:  44%  (resets in 2h 31m)\nWeekly:  15%  (resets in 6d 17h 54m)"}`
   - → `{"cmd":"set-menu","items":[{"id":"info:five-hour","label":"5-hour: 44%","enabled":false},{"type":"separator"},{"id":"refresh-now","label":"Refresh now"}]}`
6. User right-clicks the tray icon. Plasma 6 queries `/MenuBar` via DBusMenu; helper serves the current tree.
7. Token-source submenu is hovered. Helper → Bun: `{"event":"menu-about-to-show","id":"set-token-source"}`. Bun may refresh the submenu items.
8. User clicks "Refresh now". Helper → Bun: `{"event":"menu-click","id":"refresh-now"}`.
9. Bun sends `{"type":"refresh"}` over WebSocket to `ai-gauge-server`, triggering an immediate poll.
10. Server broadcasts updated payload. Bun sends fresh `set-tooltip` + `set-menu` to helper. Cycle complete.
11. User closes the menu. No event emitted — DBusMenu close is handled entirely by Plasma.

## Failure Modes

| Failure | Helper exit code | Bun behavior |
|---|---|---|
| Helper crashes (SIGSEGV, unhandled exception) | non-zero (varies) | Exponential backoff restart: 1s initial, doubles each attempt, capped at 30s |
| Helper exits 2 (SNI watcher unavailable) | 2 | Retry every 60s, up to 5 attempts, then exit cleanly with code 0 |
| Helper exits 3 (D-Bus import failed) | 3 | Bun exits 3; systemd `Restart=on-failure` restarts — user must install `python3-dbus` |
| Malformed line from helper to Bun | helper alive | Bun logs and ignores the line; does not crash |
| Malformed line from Bun to helper | helper alive | Helper emits `helper-error:parse-error` and continues |
| WebSocket disconnect from `ai-gauge-server` | helper alive | Bun → `set-icon ai-gauge-waiting` + `set-status Passive`; schedules WS reconnect after 5s |

## Cross-References

- **WebSocket broadcast format** (protocolVersion 4) — AGENTS.md, "WebSocket Protocol" section
- **Tooltip formatting helpers** (`formatDuration`, `formatDurationLong`) — `lib/render-waybar.js` (exported at line 362)
- **Plan / token source / display mode enums** — `macos/AIGauge/Sources/AIGauge/MenuBarView.swift` lines 10-23
- **Safe logging** (`logJson`, `redact`) — `lib/log-safe.js`
- **SNI specification** — https://specifications.freedesktop.org/status-notifier-item/latest-single
- **DBusMenu specification** — https://github.com/gnustep/libs-dbuskit/blob/master/Bundles/DBusMenu/com.canonical.dbusmenu.xml
- **Reference implementation (Rust/ksni)** — https://github.com/iovxw/ksni
