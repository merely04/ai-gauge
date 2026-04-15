# ai-gauge — LLM Agent Installation Guide

You are installing a waybar module that displays Claude Code usage limits (5-hour session %, weekly %, countdown to reset) on a Linux desktop with waybar.

## Prerequisites

Before proceeding, verify:
- Linux with waybar (Hyprland/Sway/etc.)
- `bash`, `jq` are available
- `bun` is installed ([bun.sh](https://bun.sh))
- An OAuth token source is available — one of:
  - Claude Code CLI authenticated via OAuth (`~/.claude/.credentials.json` with `claudeAiOauth.accessToken`)
  - OpenCode authenticated with Anthropic (`~/.local/share/opencode/auth.json` with `anthropic.access`)

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
