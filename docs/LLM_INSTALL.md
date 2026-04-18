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

### macOS

Before proceeding, verify:
- macOS 13 Ventura or later
- `bun` is installed — via [bun.sh](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`) or Homebrew (`brew install bun`)
- `jq` is available — `brew install jq` or `sudo port install jq`
- An OAuth token source is available — same options as Linux above

## Install

```bash
bun add -g ai-gauge
ai-gauge setup
```

The setup command:
1. Resolves `bun` path and installs `ai-gauge-server` as a systemd user service
2. Starts the WebSocket server (`ws://localhost:19876`)
3. Installs StreamDock plugin if Wine + StreamDock are present
4. Creates default config at `~/.config/ai-gauge/config.json`
5. Adds `"custom/ai-gauge"` to `modules-center` in `~/.config/waybar/config.jsonc`
6. Adds CSS styling to `~/.config/waybar/style.css`
7. Restarts waybar

If the user's waybar config does not have `modules-center` or uses a different module layout, you may need to manually adjust placement in `config.jsonc` after install.

## Configure Token Source

Default is `claude-code`. If the user has OpenCode but not Claude Code CLI, switch immediately after install:

```bash
ai-gauge-config set tokenSource opencode
ai-gauge-config set plan max
```

| tokenSource | Credential file | When to use |
|-------------|----------------|-------------|
| `claude-code` | `~/.claude/.credentials.json` | Claude Code CLI is installed and authenticated |
| `opencode` | `~/.local/share/opencode/auth.json` | OpenCode is the primary tool |

The server restarts automatically after `ai-gauge-config set`.

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
- **Service starts but no data** — token is expired. Check `journalctl --user -u ai-gauge-server -n 5` for "token expired". The source CLI needs to refresh it (open Claude Code or OpenCode)
- **Waybar shows `✦ ···` permanently** — server has no data to send. Check service status and token validity
- **Module not visible in waybar** — config.jsonc may not have `modules-center`. Add `"custom/ai-gauge"` to whichever module array is used

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

Same as Linux — default is `claude-code`. Switch to OpenCode if needed:

```bash
ai-gauge-config set tokenSource opencode
ai-gauge-config set plan max
```

### Check Status

```bash
ai-gauge status
launchctl print gui/$(id -u)/com.ai-gauge.server
launchctl print gui/$(id -u)/com.ai-gauge.menubar
```

Both should show `state = running`. If either shows `state = waiting` or an error, check the logs.

### Logs

```bash
tail -f ~/Library/Logs/ai-gauge/*.log
```

Or check a specific agent:

```bash
tail -f ~/Library/Logs/ai-gauge/server.log
tail -f ~/Library/Logs/ai-gauge/menubar.log
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
- **Icon stuck at `✦ ···`** — server agent may not be running. Check `launchctl print gui/$(id -u)/com.ai-gauge.server` and `tail ~/Library/Logs/ai-gauge/server.log`
- **Token expired** — open Claude Code or OpenCode to refresh the OAuth token, then wait up to 60 seconds for the next poll
- **Runtime state location** — macOS uses `$TMPDIR/ai-gauge/usage.json` (not `$XDG_RUNTIME_DIR`)

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
