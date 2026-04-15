# cc-usage

Real-time Claude Code usage monitor for Waybar on Linux. Tracks 5-hour and weekly API rate limits with countdown timers, desktop notifications, and a StreamDock plugin for physical stream decks.

```
✦ 44% 2h31m · 15%w
```

## Features

- **Waybar module** — live 5-hour %, weekly %, reset countdown in your status bar
- **Desktop notifications** — alert at 80% usage, auto-clear below 50%
- **Right-click menu** — refresh, copy stats, open settings
- **StreamDock plugin** — usage stats on a physical key (Fifine AmpliGame D6)
- **Multiple token sources** — Claude Code CLI or OpenCode
- **WebSocket architecture** — one server broadcasts to all clients in real time
- **systemd service** — starts on login, auto-restarts on failure
- **Zero dependencies** — runs on Bun, no npm packages

## LLM Agent Install

```
Read and follow the installation guide:
https://raw.githubusercontent.com/merely04/cc-usage/master/docs/LLM_INSTALL.md
```

## Install

```bash
git clone https://github.com/merely04/cc-usage.git ~/dev/cc-usage
bash ~/dev/cc-usage/install.sh
```

To uninstall: `bash ~/dev/cc-usage/uninstall.sh`

Requires [Bun](https://bun.sh) and a Linux desktop with Waybar (Hyprland, Sway, or any wlroots compositor).

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
───────────────
Plan: max
```

![tooltip](assets/tooltip.png)

**States**:

| State | Color | Condition |
|-------|-------|-----------|
| normal | dimmed | < 50% |
| warning | yellow | 50-79% |
| critical | red | >= 80% (sends desktop notification once) |
| waiting | very dim | Connecting to server (starting up or server down) |

**Menu** (click): Refresh now, copy usage, raw JSON, settings.

## Configuration

Config file: `~/.config/ccusage/config.json`

```json
{"tokenSource": "claude-code", "plan": "max"}
```

| Field | Values | Description |
|-------|--------|-------------|
| `tokenSource` | `claude-code` (default), `opencode` | OAuth token source |
| `plan` | `max`, `pro`, `team`, `enterprise`, `unknown` | Subscription plan (shown in tooltip) |

Change settings via UI (menu → ⚙ Settings) or CLI:

```bash
ccusage-config set tokenSource opencode
ccusage-config set plan max
ccusage-config get
```

## StreamDock (Fifine D6)

The plugin shows usage stats on a physical key of the Fifine AmpliGame D6 stream controller.

![deck](assets/deck.jpg)

**Requirements**: Fifine D6 + StreamDock app running via Wine on Linux.

**Setup**: `install.sh` copies the plugin automatically. Open StreamDock → find **CC Usage** in the action list → drag it onto a key.

The button connects to `ccusage-server` via WebSocket and updates in real time. If the server is not running, the button shows `--`.

## How it works

`ccusage-server` runs as a systemd user service, polling the Anthropic usage API (`/api/oauth/usage`) every 60 seconds. It reads the OAuth token from either Claude Code CLI or OpenCode credentials and broadcasts results to all connected WebSocket clients on `ws://localhost:19876`.

`ccusage-waybar` is a thin WebSocket client that renders each update as waybar-compatible JSON. On disconnect it shows a waiting state and reconnects automatically.

The server writes `usage.json` atomically to `$XDG_RUNTIME_DIR/ccusage/` so other tools can read it too.

## Files

| File | Purpose |
|------|---------|
| `ccusage-server` | WebSocket server — fetches Anthropic API, broadcasts to clients (port 19876) |
| `ccusage-server.service` | systemd user service unit |
| `ccusage-waybar` | Thin WS client — renders waybar JSON from server data |
| `ccusage-menu` | Click menu — refresh, copy, settings |
| `ccusage-config` | Settings CLI/UI — token source, plan name |
| `streamdock-plugin/` | StreamDock (Fifine D6) button plugin |
| `install.sh` | Installs service + symlinks + plugin, patches waybar config + CSS |
| `uninstall.sh` | Removes everything cleanly |

Both install and uninstall are idempotent.
