<h1 align="center">
  <img src="assets/icon.png" width="128" alt="AI Gauge" /><br>
  AI Gauge
</h1>

<p align="center">
  Real-time usage monitor for Claude Code, OpenCode and OpenAI Codex. Tracks rate limits with countdown timers and desktop notifications.<br>
  Runs on Linux (Waybar) and macOS (native menubar app).
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ai-gauge"><img src="https://img.shields.io/npm/v/ai-gauge.svg?color=cb3837&logo=npm" alt="npm version" /></a>
  <a href="https://github.com/merely04/ai-gauge/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="Platform: macOS | Linux" />
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-fbf0df?logo=bun&logoColor=black" alt="Runtime: Bun" /></a>
  <a href="https://github.com/merely04/ai-gauge/actions/workflows/publish.yml"><img src="https://github.com/merely04/ai-gauge/actions/workflows/publish.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/merely04/ai-gauge/discussions"><img src="https://img.shields.io/github/discussions/merely04/ai-gauge?logo=github&label=discussions" alt="Discussions" /></a>
</p>

```
✦ 44% 2h31m · 15%w
```

## Features

- **Waybar module** (Linux) — live 5-hour %, weekly %, reset countdown in your status bar
- **Native menubar app** (macOS) — Swift MenuBarExtra, same data in your menu bar
- **Desktop notifications** — alert at 80% usage, auto-clear below 50%
- **Right-click menu** — refresh, copy stats, change plan / token source with checkmarks (macOS), open settings
- **StreamDock plugin** — usage stats on a physical key (Fifine AmpliGame D6)
- **Multiple token sources** — Claude Code CLI, OpenCode, or OpenAI Codex CLI
- **OpenCode dual mode** — when OpenCode has both Anthropic and OpenAI OAuth logins, the tooltip shows Claude AND Codex usage side-by-side in a single view
- **Codex JSONL fallback** — if `chatgpt.com/wham/usage` is unreachable, parses `~/.codex/sessions/*.jsonl` for the latest rate-limit snapshot
- **WebSocket architecture** — one server broadcasts to all clients in real time
- **systemd / launchd service** — starts on login, auto-restarts on failure
- **Zero dependencies** — runs on Bun, no npm packages

## Why ai-gauge?

A few other tools do similar things. Which one fits depends on what you actually need, so here's an honest side-by-side.

| Feature | ai-gauge | [waybar-ai-usage] | [ai-quota-waybar] | [ClaudeBar] |
|---|---|---|---|---|
| Native macOS menubar app | ✅ Swift MenuBarExtra | — | — | — |
| Linux Waybar module | ✅ | ✅ | ✅ | ✅ |
| Real-time WebSocket push | ✅ (60s poll, instant broadcast) | — polling | — polling | — polling |
| Supported providers | 6 real + 2 stubs | 4 | 3 | 2 |
| GitHub Copilot support | ✅ | ✅ | — | — |
| Gemini CLI support | — | — | ✅ | — |
| Browser cookie auth (no API keys) | — | ✅ Chrome/Firefox | — | — |
| StreamDock physical-key plugin | ✅ Fifine D6 | — | — | — |
| Claude + Codex side-by-side view | ✅ OpenCode dual mode | — | — | — |
| Auto-update system | ✅ npm registry | — | — | — |
| Zero npm runtime dependencies | ✅ | — (browser_cookie3) | ✅ pure Bash | — |
| Stack | Bun JS + Swift | Python | Bash + jq | TypeScript + Bun |

[waybar-ai-usage]: https://github.com/NihilDigit/waybar-ai-usage
[ai-quota-waybar]: https://github.com/komagata/ai-quota-waybar
[ClaudeBar]: https://github.com/andresreibel/ClaudeBar

### Where ai-gauge is unique

- The only tool with a native macOS menubar app (Swift, no Electron, no browser window)
- Multi-provider unified view: Claude and Codex usage in a single tooltip when using OpenCode
- StreamDock plugin for physical hardware key display
- Provider registry covers Z.ai, MiniMax, OpenRouter, Komilion and others beyond the big two

### Where competitors are stronger

- **NihilDigit/waybar-ai-usage** is the right pick if you want browser-cookie auth (no credential files to manage, works with Chrome/Firefox sessions out of the box)
- **komagata/ai-quota-waybar** is the right pick if you use Gemini CLI and want a zero-dependency pure Bash solution with no Bun requirement
- **andresreibel/ClaudeBar** has a clean click-to-toggle UX between Claude and Codex and handles 429 backoff gracefully with cached payloads

## LLM Agent Install

```
Read and follow the installation guide:
https://raw.githubusercontent.com/merely04/ai-gauge/master/docs/LLM_INSTALL.md
```

## Install

```bash
bun add -g ai-gauge
ai-gauge setup
```

To uninstall:

```bash
ai-gauge uninstall
bun remove -g ai-gauge
```

**Linux**: requires [Bun](https://bun.sh) and a desktop with Waybar (Hyprland, Sway, or any wlroots compositor).

**macOS**: requires [Bun](https://bun.sh) and macOS 13+. `ai-gauge setup` installs a native Swift menubar app and a launchd LaunchAgent instead of Waybar and systemd.

> **Note**: GitHub Releases do not ship a standalone `.app` download. The macOS menubar app is a UI client only — it requires the `ai-gauge-server` daemon which lives inside the npm package and is configured by `ai-gauge setup`. Always install via `bun add -g ai-gauge`.

### macOS Gatekeeper — if the menubar icon doesn't appear

The `.app` bundle is **ad-hoc signed** (not notarized with an Apple Developer ID). `ai-gauge setup` automatically runs `xattr -dr com.apple.quarantine` to let macOS launch it, but a few edge cases may still trigger "cannot verify developer":

<details>
<summary><strong>Fix: one-liner that handles most cases</strong></summary>

```bash
xattr -dr com.apple.quarantine "$(bun pm -g bin)/../lib/node_modules/ai-gauge/bin/AIGauge.app"
launchctl bootout gui/$(id -u)/com.ai-gauge.menubar 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ai-gauge.menubar.plist
```

</details>

<details>
<summary><strong>Still blocked? → System Settings → Privacy & Security</strong></summary>

1. Open **System Settings → Privacy & Security**
2. Scroll to the bottom — if you see a `"AIGauge" was blocked…` notice, click **Allow Anyway**
3. Reload the menubar agent (one-liner above)

</details>

<details>
<summary><strong>Check if quarantine is still set</strong></summary>

```bash
xattr -l "$(bun pm -g bin)/../lib/node_modules/ai-gauge/bin/AIGauge.app/Contents/MacOS/AIGauge"
```

If you see `com.apple.quarantine` in the output, the flag is still present — run the fix above.

</details>

<details>
<summary><strong>Edge cases (rare)</strong></summary>

- **Lockdown Mode** (System Settings → Privacy & Security → Lockdown Mode): ad-hoc signed apps are refused. Disable Lockdown Mode to use ai-gauge, or use only notarized software.
- **"Allow applications downloaded from: App Store only"**: change to **App Store and identified developers** in System Settings → Privacy & Security.
- **MDM / corporate device**: your admin may block unsigned binaries. Ask them to whitelist `com.ai-gauge.menubar`, or install a local build from source.

</details>

## What it shows

**Bar**: `✦ <5h%> <countdown> · <weekly%>w`

![bar](assets/bar.png)

**Tooltip** (hover):

```
Claude Code Usage
───────────────
5-hour:  44%  (resets in 2h 31m)
Weekly:  15%  (resets in 6d 17h 54m)
Sonnet:  0%
───────────────
Extra: $171.22/$200 (86%)
```

When `tokenSource: opencode` and your OpenCode auth file carries both Anthropic and OpenAI OAuth, you see both providers in one tooltip:

![multi-provider tooltip](assets/macos-multi-provider.png)

```
Claude
───────────────
5-hour:  31%  (resets in 2h 29m)
Weekly:  16%  (resets in 2d 9h 59m)
Sonnet:   2%  (resets in 2d 9h 59m)
───────────────
Extra: $204.10/$200 (100%)
───────────────
Codex
5-hour:  24%  (resets in 4h 12m)
Weekly:  15%  (resets in 3d 11h 44m)
```

The current plan and token source are reflected as **checkmarks in the submenu** (macOS) and in the Linux tooltip footer.

![tooltip](assets/tooltip.png)

**States**:

| State | Color | Condition |
|-------|-------|-----------|
| normal | system text color | < 50% |
| warning | yellow | 50-79% |
| critical | red | >= 80% (sends desktop notification once) |
| waiting | very dim | Connecting to server (starting up or server down) |

## macOS — Native Menu Bar

Same data, native Mac UI. Lives in the menu bar (no Dock icon thanks to `LSUIElement`).

**In the menu bar:**

![macOS menu bar](assets/macos-menubar.png)

**Click to open the full menu** — usage breakdown on top, actions below:

![macOS menu](assets/macos-menu.png)

**Submenus** show current selection with a checkmark — change plan or token source on the fly:

![macOS submenu](assets/macos-submenu.png)

**About panel** — standard macOS About with version, license, GitHub link:

![macOS about](assets/macos-about.png)

**Menu** (right-click on Linux, click on macOS):

- Copy usage summary (clipboard)
- Raw data (clipboard)
- 🔑 Token source: \<current\> ▸ (Linux: direct one-click to source selection with checkmarks)
- 📋 Plan: \<current\> ▸ (Linux: direct one-click to plan selection with checkmarks)
- 🎨 Display mode: \<current\> ▸ (inline submenu)
- Change plan ▸ (macOS submenu — current marked with ✓)
- Change token source ▸ (macOS submenu — current marked with ✓)
- ⚙ Settings (advanced configuration)
- ↻ Refresh now
- Restart server
- Reveal Config in Finder (macOS) / Open settings (Linux)
- About AI Gauge (macOS — shows version, license, GitHub link)
- Quit

## Configuration

Config file: `~/.config/ai-gauge/config.json`

```json
{"tokenSource": "claude-code", "plan": "max"}
```

On first install, `ai-gauge setup` auto-detects which token source to use by checking which credential files exist:

1. **OpenCode** (`~/.local/share/opencode/auth.json` on Linux, `~/Library/Application Support/opencode/auth.json` on macOS)
2. **OpenAI Codex** (`~/.codex/auth.json` or `$CODEX_HOME/auth.json`)
3. **Claude Code** (Keychain on macOS, `~/.claude/.credentials.json` on Linux)

If multiple sources exist, the most recently modified one wins (with fixed priority `opencode > codex > claude-code` as a tiebreaker). Auto-detect runs **only on first install** — subsequent `ai-gauge setup` runs preserve your existing choice.

To switch later, use the menu (macOS submenu / Linux right-click → "🔑 Token source") or CLI:

```bash
ai-gauge-config set tokenSource opencode
```

| Field | Values | Description |
|-------|--------|-------------|
| `tokenSource` | `claude-code` (default), `opencode`, `codex`, `github`, `claude-settings:<name>` | OAuth credential source |
| `plan` | `max`, `pro`, `team`, `enterprise`, `unknown` (Anthropic) <br> `plus`, `pro`, `business`, `enterprise`, `edu` (Codex) | Subscription plan (shown in tooltip) |
| `displayMode` | `full` (default), `percent-only`, `bar-dots`, `number-bar`, `time-to-reset` | Display format for menubar/waybar |

Change settings via menu (macOS submenu / Linux walker UI) or CLI (works on both):

```bash
ai-gauge-config set tokenSource opencode
ai-gauge-config set plan max
ai-gauge-config get
```

## GitHub Copilot

ai-gauge can monitor your Copilot monthly premium-request quota for Individual plans (Free, Pro, Pro+).

```bash
# Works with default gh storage (Keychain on macOS, Secret Service on Linux, or --insecure-storage plaintext)
gh auth login
ai-gauge-config set tokenSource github
systemctl --user restart ai-gauge-server   # Linux
# macOS: launchctl kickstart -k gui/$(id -u)/com.ai-gauge.server
```

ai-gauge calls `gh auth token --hostname github.com` at each poll, so any gh storage backend (Keychain on macOS, Secret Service on Linux, or `--insecure-storage` plaintext) works out of the box.

**Headless / CI mode**: If `gh` binary is unavailable, copy a `gho_*` OAuth token (obtained via `gh auth token --hostname github.com` on a workstation) into `~/.config/ai-gauge/copilot-token` (single-line plain text file). The daemon falls back to this file when both Tier 1 (shell-out) and Tier 2 (hosts.yml plaintext) fail.

> **Important — PAT compatibility**: Classic Personal Access Tokens (`ghp_*`) and fine-grained PATs (`github_pat_*`) **do not work** for Copilot quota monitoring — the `/copilot_internal/v2/token` endpoint requires the OAuth token (`gho_*`) issued by `gh auth login`. ai-gauge will reject any other token format with a clear error log.

**Limitations**: v1 supports Individual plans only (Free/Pro/Pro+). Business/Enterprise quotas deferred to v1.1. GitHub Enterprise Server not supported. Multi-account gh CLI uses first `github.com:` block only.

> Note: ai-gauge mirrors official VS Code Copilot extension headers to authenticate the internal API. If GitHub changes their internal API contract, ai-gauge may break temporarily — please file an issue.

## OpenAI Codex (ChatGPT subscription)

ai-gauge can monitor Codex CLI usage from a ChatGPT Plus / Pro / Business / Enterprise / Edu subscription.

![Codex submenu](assets/macos-codex-submenu.png)

```bash
# Make sure Codex CLI is logged in (if you haven't already):
codex auth login

# Tell ai-gauge to read from ~/.codex/auth.json:
ai-gauge-config set tokenSource codex
```

The daemon will fetch `https://chatgpt.com/backend-api/wham/usage` (the same endpoint Codex CLI itself uses) once a minute. The tooltip then shows 5-hour and weekly windows, plus the code-review window and credit balance when present.

> **Note**: `/wham/usage` is an undocumented internal endpoint. We mirror Codex CLI's headers (`Authorization: Bearer ...`, `ChatGPT-Account-Id: ...`, `User-Agent: codex_cli_rs/...`). If the endpoint changes upstream, ai-gauge falls back to parsing `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` for the latest `token_count` event so you still see something.

### `codex` requirements

- Codex CLI installed and logged in (`codex` will create `~/.codex/auth.json` on first login)
- Credentials stored in **file mode** — the default. If you set `cli_auth_credentials_store: "macOS_keychain"` in `~/.codex/config.toml`, ai-gauge cannot read your tokens (background launchd agents can't show interactive Keychain prompts) and will degrade to JSONL session parsing.
- Plain OpenAI API keys (`sk-...`) are **not supported** — the `/wham/usage` endpoint requires the OAuth `access_token` from `codex auth login`.

## Using a Different Claude Provider

You can monitor usage from alternative Claude API providers by creating a settings file in `~/.claude/`:

```bash
# Create a settings file for your provider
cat > ~/.claude/settings.myprovider.json << 'EOF'
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.yourprovider.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "your-token-here"
  }
}
EOF

# Set it as your token source
ai-gauge-config set tokenSource claude-settings:myprovider
```

Then restart the server: `systemctl --user restart ai-gauge-server` (Linux) or `launchctl kickstart -k gui/$(id -u)/com.ai-gauge.server` (macOS).

### Supported Providers

| Provider | `ANTHROPIC_BASE_URL` | Auth | Balance |
|----------|---------------------|------|---------|
| Z.ai | `https://api.z.ai/api/anthropic` | Token (no Bearer) | Rate limits |
| MiniMax | `https://api.minimax.io/api/anthropic` | Bearer token | Rate limits |
| OpenRouter | _(fixed URL)_ | Bearer token | Credit balance |
| Komilion | _(fixed URL)_ | Bearer token | Wallet balance |
| Packy | _(no public API)_ | — | — |

### Notes

- **Anthropic API keys** (`sk-ant-*`) cannot fetch usage via this tool. The usage endpoint requires OAuth tokens (from Claude Code CLI or OpenCode). Settings files with a plain Anthropic API key will show the source as `unknown` with no quota data.
- **Packy** has no public balance API. Selecting it will show the provider name but no usage data.
- File names must match `[a-zA-Z0-9_][a-zA-Z0-9_.-]*` (e.g. `settings.z.json`, `settings.mywork.json`).
- `settings.local.json` is excluded from discovery (reserved for local overrides).

## Update Notifications

ai-gauge automatically checks for updates every 24 hours (with a 30-second initial delay after startup) and notifies you via the menubar/waybar.

### What you'll see

**macOS**: An orange dot appears in the menu bar icon. Click to open the menu — an "Update to vX.Y.Z" item appears at the top. Click it to update. You'll also get a native notification.

**Linux (Waybar)**: The waybar text gains a ⬆ suffix and turns yellow (`update-available` CSS class). Use the right-click menu → "✨ Update to vX.Y.Z" to trigger the update.

If the automatic update fails (e.g., due to permissions), the install command is copied to your clipboard.

### Manual check

- **macOS**: Menu → "Check for updates now"
- **Linux**: Right-click menu → "🔍 Check for updates"
- **CLI**: `echo '{"type":"checkUpdate"}' | bun lib/send-ws.js`

### Disable update checks

**Permanently** (per-machine):
```bash
ai-gauge-config set autoCheckUpdates false
```

**Session**: Set `NO_UPDATE_NOTIFIER=1` in the environment before starting the daemon.

**CI environments**: Update checks are automatically skipped when any of these env vars are set: `CI`, `CONTINUOUS_INTEGRATION`, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `JENKINS_HOME`, `BUILDKITE`, `DRONE`, `TRAVIS`.

**Testing / development env vars** (not for production use):

| Variable | Effect |
|----------|--------|
| `AIGAUGE_DETECT_SKIP_KEYCHAIN=1` | Skip macOS Keychain during auto-detect (useful in headless/SSH sessions) |
| `AIGAUGE_SETUP_DRY_RUN=1` | Run setup without side effects — creates `~/.config/ai-gauge/config.json` only, skips systemctl/launchctl/waybar patching |
| `AIGAUGE_SETUP_PLATFORM=<linux\|darwin>` | Override platform detection in setup scripts (testing only) |

### Dismiss a specific version

To silence a specific version without disabling checks entirely:

```bash
echo '{"type":"dismissUpdate","version":"2.0.0"}' | bun lib/send-ws.js
```

The notification is suppressed until a newer version appears or you run:

```bash
echo '{"type":"undismissUpdate"}' | bun lib/send-ws.js
```

### Running without a service manager (Docker, minimal Linux)

ai-gauge is designed around systemd (Linux) and launchd (macOS). After a successful update, the daemon calls `process.exit(0)` and relies on the service manager to restart it.

If you run the daemon in an environment without a service manager — e.g. a Docker container, `tmux` session, or PID 1 of a minimal Linux install — the process will terminate on update and **not** come back automatically. Either:

- Disable auto-update: `ai-gauge-config set autoCheckUpdates false`
- Wrap the daemon in your own restart loop (supervisord, runit, `while true; do ai-gauge-server; sleep 1; done`)

The update still works in the sense that the new version is installed via `npm`/`bun`/`pnpm`, but the running process is not replaced until you manually start it again.

## StreamDock (Fifine D6)

The plugin shows usage stats on a physical key of the Fifine AmpliGame D6 stream controller.

![deck](assets/deck.jpg)

**Requirements**: Fifine D6 + StreamDock app running via Wine on Linux.

**Setup**: `ai-gauge setup` copies the plugin automatically. Open StreamDock → find **AI Gauge** in the action list → drag it onto a key.

The button connects to `ai-gauge-server` via WebSocket and updates in real time. If the server is not running, the button shows `--`.

## How it works

`ai-gauge-server` runs as a background daemon (systemd on Linux, launchd on macOS) and polls the relevant provider's usage API every 60 seconds:

- **Claude Code / OpenCode (Anthropic OAuth)** → `https://api.anthropic.com/api/oauth/usage`
- **OpenAI Codex** → `https://chatgpt.com/backend-api/wham/usage` (with JSONL fallback to `~/.codex/sessions/`)
- **OpenCode dual mode** → both endpoints in parallel, broadcast carries a top-level `secondary` field for the second provider's data
- **GitHub Copilot** → `https://api.github.com/copilot_internal/v2/token` (authenticated via `gh auth token` shell-out → fallback to `~/.config/gh/hosts.yml` → fallback to `~/.config/ai-gauge/copilot-token`)
- **Custom `claude-settings:*` providers** → whatever `ANTHROPIC_BASE_URL` you configure (Z.ai, MiniMax, OpenRouter, Komilion, Packy)

Results are broadcast to all connected WebSocket clients on `ws://localhost:19876`.

On **Linux**, `ai-gauge-waybar` is a thin WebSocket client that renders each update as waybar-compatible JSON. On disconnect it shows a waiting state and reconnects automatically.

On **macOS**, `bin/ai-gauge-menubar` is a native Swift app using MenuBarExtra. It connects to the same WebSocket server and shows usage in the system menu bar.

The server writes `usage.json` atomically to `$XDG_RUNTIME_DIR/ai-gauge/` on Linux or `$TMPDIR/ai-gauge/` on macOS, so other tools can read it too.

## Files

| File | Purpose |
|------|---------|
| `bin/ai-gauge` | Main CLI — setup, uninstall, status |
| `bin/ai-gauge-server` | WebSocket server — fetches Anthropic API, broadcasts to clients (port 19876) |
| `bin/ai-gauge-waybar` | Thin WS client — renders waybar JSON from server data (Linux) |
| `bin/ai-gauge-menubar` | Native Swift menubar app binary — universal arm64+x86_64 (macOS) |
| `bin/ai-gauge-menu` | Click menu — refresh, copy, settings |
| `bin/ai-gauge-config` | Settings CLI/UI — token source, plan name |
| `lib/ai-gauge-server.service` | systemd user service unit template (Linux) |
| `lib/ai-gauge-server.plist.template` | launchd LaunchAgent plist template (macOS) |
| `lib/ai-gauge-menubar.plist.template` | launchd plist for the menubar app (macOS) |
| `bin/AIGauge.app/` | Pre-built macOS app bundle (universal arm64+x86_64, ad-hoc signed) |
| `macos/AIGauge/` | Swift source for the native menubar app (SPM project) |
| `scripts/build-macos-binary.sh` | Reproducible build: `swift build` + `lipo` + `codesign --deep` + bundle wrap |
| `scripts/generate-icon.sh` + `generate-icon.swift` | Procedural app icon renderer (Swift Core Graphics → `.icns`) |
| `lib/notify.js` | Cross-platform notification helper (notify-send on Linux, no-op on macOS) |
| `lib/bash-helpers.sh` | Portable `is_macos`, `resolve_path`, `sed_inplace` for bash scripts |
| `lib/streamdock-plugin/` | StreamDock (Fifine D6) button plugin |

Both setup and uninstall are idempotent.

## Community & Feedback

ai-gauge is early — first users still arriving. Feedback at any level helps:

- **Questions, install issues, "how do I do X"** → [Discussions / Q&A](https://github.com/merely04/ai-gauge/discussions/categories/q-a)
- **Feature ideas, brainstorming** → [Discussions / Ideas](https://github.com/merely04/ai-gauge/discussions/categories/ideas)
- **Confirmed bugs with repro steps** → [Open an Issue](https://github.com/merely04/ai-gauge/issues/new?template=bug_report.yml)
- **Request a new AI provider** (DeepSeek, Groq, Gemini, Copilot, etc.) → [Provider Request](https://github.com/merely04/ai-gauge/issues/new?template=provider_request.yml)
- **Show off your setup** → [Discussions / Show and tell](https://github.com/merely04/ai-gauge/discussions/categories/show-and-tell)

Read the [welcome post](https://github.com/merely04/ai-gauge/discussions/3) for the full triage map.
