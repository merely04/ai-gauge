# ai-gauge — LLM Agent Installation Guide

This guide covers installation on **Linux** (waybar module) and **macOS** (menubar app). Pick the section that matches the user's OS.

## Prerequisites

### Linux

Before proceeding, verify:
- Linux with waybar (Hyprland/Sway/etc.)
- `bash`, `jq` are available
- `bun` is installed ([bun.sh](https://bun.sh))
- An OAuth token source is available — one of:
  - Claude Code CLI authenticated via OAuth (`~/.claude/.credentials.json` with `claudeAiOauth.accessToken`)
  - OpenCode authenticated with Anthropic (`~/.local/share/opencode/auth.json` with `anthropic.access`)
  - Codex CLI authenticated (`~/.codex/auth.json` with `tokens.access_token` + `tokens.account_id`)
  - Custom Anthropic-compatible provider via `~/.claude/settings.<name>.json` (Z.ai, MiniMax, OpenRouter, Komilion, Packy)
  - GitHub Copilot (`tokenSource: github`) — requires `gh` CLI authenticated via `gh auth login`
- **`gh`** (GitHub CLI) — optional, required only for `tokenSource: github`. Without it, copy a `gho_*` OAuth token to `~/.config/ai-gauge/copilot-token` manually. Install: https://cli.github.com/

### macOS

Before proceeding, verify:
- macOS 13 Ventura or later
- `bun` is installed — via [bun.sh](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`) or Homebrew (`brew install bun`)
- `jq` is available — `brew install jq` or `sudo port install jq`
- An OAuth token source is available — same options as Linux above (on macOS, Claude Code CLI v2.0.14+ stores credentials in **Keychain** under service `Claude Code-credentials`; ai-gauge reads them via `/usr/bin/security` automatically and falls back to the legacy `~/.claude/.credentials.json` path for SSH/headless sessions)
- **`gh`** (GitHub CLI) — optional, required only for `tokenSource: github`. Install: `brew install gh`. Without it, copy a `gho_*` OAuth token to `~/.config/ai-gauge/copilot-token` manually.

## Install (npm package — only supported install path)

```bash
bun add -g ai-gauge
ai-gauge setup
```

**Do not** install ai-gauge by downloading `AIGauge.app` from GitHub Releases. The `.app` is a UI client only; without the npm-installed `ai-gauge-server` daemon it has nothing to display. As of v1.4.2, GitHub Releases only carry release notes — no `.app`/binary attachments.

On **Linux**, `ai-gauge setup`:
1. Resolves `bun` path and installs `ai-gauge-server` as a systemd user service
2. Starts the WebSocket server (`ws://localhost:19876`)
3. Installs StreamDock plugin if Wine + StreamDock are present
4. Creates default config at `~/.config/ai-gauge/config.json`
5. Adds `"custom/ai-gauge"` to `modules-center` in `~/.config/waybar/config.jsonc`
6. Adds CSS styling to `~/.config/waybar/style.css`
7. Restarts waybar

If the user's waybar config does not have `modules-center` or uses a different module layout, you may need to manually adjust placement in `config.jsonc` after install.

On **macOS**, `ai-gauge setup` installs two LaunchAgents (server + menubar) and the SwiftUI MenuBarExtra app — see the **macOS Installation** section below for details.

## Configure Token Source

Default is `claude-code`. If the user does not use Claude Code CLI, switch immediately after install:

```bash
ai-gauge-config set tokenSource opencode      # or codex, or claude-settings:<name>
ai-gauge-config set plan max                  # max | pro | team | enterprise | unknown
                                              # (or plus | pro | business | enterprise | edu for codex)
```

| tokenSource | Credential location | When to use |
|-------------|---------------------|-------------|
| `claude-code` | macOS: Keychain `Claude Code-credentials` (Claude Code v2.0.14+) → fallback `~/.claude/.credentials.json`<br>Linux: `~/.claude/.credentials.json` only | Claude Code CLI is installed and authenticated |
| `opencode` | `~/.local/share/opencode/auth.json` (Linux primary) or `~/Library/Application Support/opencode/auth.json` (macOS fallback) | OpenCode is the primary tool. If the same file also has an `openai` OAuth block, ai-gauge fetches Codex usage in parallel and shows both providers in the tooltip |
| `codex` | `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) — must be `cli_auth_credentials_store: "file"` mode (default), Keychain mode is not supported | ChatGPT Plus/Pro/Business/Enterprise/Edu subscriber using Codex CLI |
| `claude-settings:<name>` | `~/.claude/settings.<name>.json` with `env.ANTHROPIC_BASE_URL` + `env.ANTHROPIC_AUTH_TOKEN` | Custom Anthropic-compatible provider (Z.ai, MiniMax, OpenRouter, Komilion). Plain `sk-ant-*` API keys cannot fetch usage — only OAuth-bearing providers work |

The server restarts automatically after `ai-gauge-config set`.

## GitHub Copilot setup

```bash
# Authenticate with gh CLI (any storage mode works — Keychain, Secret Service, or plaintext)
gh auth login

# Configure ai-gauge to use Copilot credentials
ai-gauge-config set tokenSource github

# Restart the daemon
systemctl --user restart ai-gauge-server       # Linux
# macOS: launchctl kickstart -k gui/$(id -u)/com.ai-gauge.server
```

**Headless / CI mode**: If running without the `gh` binary, copy a `gho_*` OAuth token (NOT `ghp_*` classic PAT — it won't work) to `~/.config/ai-gauge/copilot-token` (single line plain text).

## Uninstall

```bash
ai-gauge uninstall
bun remove -g ai-gauge
```

Stops the service, cleans config/CSS, removes runtime state and config directory. Both setup and uninstall are idempotent.

## Verify

After install, the module should appear in the waybar center section showing `✦ ···` initially, then `✦ <percent>% <countdown> · <weekly>%w` after the first successful API fetch (up to 60 seconds).

If it stays `✦ ···` for more than 2 minutes, check:
- `systemctl --user status ai-gauge-server` — is the service active?
- `journalctl --user -u ai-gauge-server -n 10` — any errors?
- Token source is correctly configured: `ai-gauge-config get`
- The credential file exists and contains a valid token
- `bun` is in `$PATH`: `which bun`

## Troubleshooting

Common issues an LLM agent might encounter:

- **`bun: command not found`** — install bun: `curl -fsSL https://bun.sh/install | bash`, then re-run `ai-gauge setup`
- **`jq: command not found`** — install jq: `sudo pacman -S jq` (Arch) or `sudo apt install jq` (Debian/Ubuntu)
- **`credentials_missing` event in logs** — the token source's credential file/Keychain entry is absent. For `claude-code` on macOS, run `claude /login` to populate the Keychain (Claude Code v2.0.14+ no longer writes `~/.claude/.credentials.json`). For `opencode`/`codex`, ensure the respective CLI is logged in.
- **Service starts but no data, log shows `token_expired`** — check `journalctl --user -u ai-gauge-server -n 5`. The source CLI needs to refresh it (open Claude Code or OpenCode). Note: `fetchUsage` automatically retries once on HTTP 401/403 by re-reading credentials, so this only persists when the source CLI itself has not refreshed the token.
- **Waybar shows `✦ ···` permanently** — server has no data to send. Check service status and token validity.
- **Module not visible in waybar** — config.jsonc may not have `modules-center`. Add `"custom/ai-gauge"` to whichever module array is used.

---

## macOS Installation

ai-gauge on macOS runs as a LaunchAgent pair: `com.ai-gauge.server` (the WebSocket daemon) and `com.ai-gauge.menubar` (the menubar icon). There is no waybar on macOS; the menubar icon is the primary UI.

### Install

```bash
bun add -g ai-gauge
ai-gauge setup
```

What `ai-gauge setup` does on macOS:

1. Writes `~/Library/LaunchAgents/com.ai-gauge.server.plist` and loads it
2. Writes `~/Library/LaunchAgents/com.ai-gauge.menubar.plist` and loads it
3. Creates default config at `~/.config/ai-gauge/config.json`
4. Both agents start immediately — no reboot required

### First Launch

The menubar icon appears in the top-right corner of the menu bar. On first launch macOS may show a notification permission prompt — click **Allow** so usage alerts work.

The icon shows `✦ ···` while connecting, then switches to `✦ <percent>% <countdown> · <weekly>%w` after the first successful API fetch (up to 60 seconds).

### Configure Token Source

Same as Linux — see the **Configure Token Source** section above for the full table of options (`claude-code`, `opencode`, `codex`, `claude-settings:<name>`).

```bash
ai-gauge-config set tokenSource opencode      # or codex, or claude-settings:<name>
ai-gauge-config set plan max
```

**macOS note for `claude-code`**: Claude Code CLI v2.0.14+ stores OAuth tokens in **Keychain** (service `Claude Code-credentials`) instead of `~/.claude/.credentials.json`. ai-gauge reads via `/usr/bin/security find-generic-password` automatically — no extra setup. If a user reports `credentials_missing` in logs after migrating to a new Claude Code version, instruct them to run `claude /login` to repopulate the Keychain entry. Auto-update of Claude Code can also break the Keychain ACL — re-login fixes it.

### Check Status

```bash
ai-gauge status
launchctl print gui/$(id -u)/com.ai-gauge.server
launchctl print gui/$(id -u)/com.ai-gauge.menubar
```

Both should show `state = running`. If either shows `state = waiting` or an error, check the logs.

### Logs

The daemon writes structured JSON to **stderr**, which launchd routes to `*.err` files. The `*.log` files (stdout) are almost always empty — always read `.err` for actual events.

```bash
tail -f ~/Library/Logs/ai-gauge/server.err     # daemon: fetches, credential reads, errors
tail -f ~/Library/Logs/ai-gauge/menubar.err    # Swift app: WS connect/disconnect/messages
```

Useful greps:

```bash
grep credentials_missing ~/Library/Logs/ai-gauge/server.err  # token source has no creds
grep token_rotation_retry ~/Library/Logs/ai-gauge/server.err # 401 retry kicked in (Keychain rotation)
grep '\[setConfig\]' ~/Library/Logs/ai-gauge/server.err      # config mutations from menubar
```

### Gatekeeper Troubleshooting

If the first launch fails with "cannot verify developer" or "Apple cannot check it for malicious software":

**Option 1 — remove quarantine flag:**

```bash
xattr -dr com.apple.quarantine $(bun pm -g bin)/../lib/node_modules/ai-gauge/bin/AIGauge.app
```

**Option 2 — System Settings:**

System Settings → Privacy & Security → scroll to the blocked app entry → click **Allow Anyway**.

After either fix, reload the agents:

```bash
launchctl bootout gui/$(id -u)/com.ai-gauge.server
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ai-gauge.server.plist
launchctl bootout gui/$(id -u)/com.ai-gauge.menubar
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ai-gauge.menubar.plist
```

### Uninstall

```bash
ai-gauge uninstall
bun remove -g ai-gauge
```

This unloads and removes both LaunchAgent plists, cleans config/CSS, and removes runtime state. Both setup and uninstall are idempotent.

### macOS Troubleshooting

- **`bun: command not found`** — install bun: `curl -fsSL https://bun.sh/install | bash`, then open a new shell and re-run `ai-gauge setup`
- **`jq: command not found`** — `brew install jq` or `sudo port install jq`
- **Menubar icon never appears** — check `launchctl print gui/$(id -u)/com.ai-gauge.menubar` for errors; Gatekeeper may be blocking the binary (see Gatekeeper section above)
- **Tooltip says "ai-gauge daemon not running — install via `bun add -g ai-gauge`"** — the menubar app could not reach `ws://localhost:19876` for 7+ seconds after launch. Most common cause: user downloaded the standalone `.app` from somewhere (or copied an old one) without ever running `ai-gauge setup`. Run `bun add -g ai-gauge && ai-gauge setup`. If the npm package is already installed, the daemon LaunchAgent may have failed to load — check `launchctl print gui/$(id -u)/com.ai-gauge.server` and `tail ~/Library/Logs/ai-gauge/server.err`.
- **Icon stuck at `✦ ···` (but no "daemon not running" tooltip)** — daemon is running but cannot fetch usage. Check `launchctl print gui/$(id -u)/com.ai-gauge.server` and `tail ~/Library/Logs/ai-gauge/server.err`. Look for `credentials_missing` or `token_expired` events.
- **`credentials_missing` for `tokenSource: claude-code` after Claude Code update** — Claude Code v2.0.14+ moved tokens into Keychain. Auto-update may break the Keychain ACL, requiring re-login: run `claude /login` and the daemon will pick up the new Keychain entry on the next poll (within 60s).
- **Tooltip flickers between "Switching…" and real data on token-source switch** — fixed in v1.4.1 with optimistic-UI watchdog and `configError` handling. Upgrade if seeing this on older versions.
- **Token expired** — open Claude Code or OpenCode to refresh the OAuth token. The daemon retries once on 401 with a fresh credential read, so as soon as the source CLI rotates the token it gets picked up automatically.
- **Runtime state location** — macOS uses `$TMPDIR/ai-gauge/usage.json` (not `$XDG_RUNTIME_DIR`).
- **Quick daemon restart** — `launchctl kickstart -k gui/$(id -u)/com.ai-gauge.server`. For menubar app: `launchctl kickstart -k gui/$(id -u)/com.ai-gauge.menubar`.

### Security Posture on macOS (for LLM agents to understand)

ai-gauge for macOS ships as an **ad-hoc signed** `.app` bundle — it is NOT:
- Notarized by Apple (no Developer ID)
- Distributed via Mac App Store
- Registered with Apple's Transparency, Consent, and Control framework

What this means when advising users:

1. **XProtect (macOS built-in antivirus) does NOT flag ai-gauge** — the binary is not malware and contains no known signatures. No "virus detected" dialog is expected.

2. **Gatekeeper MAY show a first-launch warning** ("cannot verify developer"). `ai-gauge setup` automatically runs `xattr -dr com.apple.quarantine` on the `.app` bundle, which solves this in most cases. If it persists:
   - `xattr -l <path to AIGauge.app>/Contents/MacOS/AIGauge` shows if quarantine flag is still present
   - Run `xattr -dr com.apple.quarantine <path to AIGauge.app>` manually
   - As a last resort: System Settings → Privacy & Security → click **Allow Anyway**

3. **Lockdown Mode blocks ad-hoc signed apps entirely** — if the user has Lockdown Mode enabled (System Settings → Privacy & Security → Lockdown Mode), they must either disable it or use only notarized apps. ai-gauge cannot work under Lockdown Mode.

4. **"App Store only" Gatekeeper setting** — if `GKAssessLegacy` / `spctl` is set to reject non-App-Store apps, change to "App Store and identified developers".

5. **MDM / corporate-managed devices** — an admin's MDM profile may refuse unsigned or ad-hoc binaries. The user's IT must whitelist `com.ai-gauge.menubar` bundle identifier.

6. **No system-wide changes** — ai-gauge installs only to user directories: `~/Library/LaunchAgents/`, `~/Library/Logs/ai-gauge/`, `~/.config/ai-gauge/`, `$TMPDIR/ai-gauge/`. No root/sudo ever required.
