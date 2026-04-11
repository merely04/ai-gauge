# cc-usage — LLM Agent Installation Guide

You are installing a waybar module that displays Claude Code usage limits (5-hour session %, weekly %, countdown to reset) on a Linux desktop with waybar.

## Prerequisites

Before proceeding, verify:
- The system runs Linux with waybar (Hyprland/Sway/etc.)
- `bash`, `curl`, `jq` are available
- Claude Code CLI is installed and authenticated via OAuth (`~/.claude/.credentials.json` must exist with `claudeAiOauth.accessToken`)

## Install

```bash
git clone https://github.com/merely04/cc-usage.git ~/dev/cc-usage && bash ~/dev/cc-usage/install.sh
```

The install script:
1. Symlinks `ccusage-waybar` and `ccusage-menu` to `~/.local/bin/`
2. Adds `"custom/ccusage"` as the last element of `modules-center` in `~/.config/waybar/config.jsonc`
3. Adds CSS styling to `~/.config/waybar/style.css`
4. Restarts waybar

If the user's waybar config does not have `modules-center` or uses a different module layout, you may need to manually adjust placement in `config.jsonc` after install.

## Uninstall

```bash
bash ~/dev/cc-usage/uninstall.sh
```

Removes symlinks, cleans config.jsonc and style.css, removes runtime state. Both install and uninstall are idempotent.

## Verify

After install, the module should appear in the waybar center section showing `✦ ···` initially, then `✦ <percent>% <countdown> · <weekly>%w` after the first successful API poll (up to 60 seconds).

If it shows `✦ ···` with dim opacity for more than 2 minutes, check:
- `~/.claude/.credentials.json` exists and contains a valid `claudeAiOauth` block
- `curl` can reach `https://api.anthropic.com`
- `ccusage-waybar` is in `$PATH`: `which ccusage-waybar`
