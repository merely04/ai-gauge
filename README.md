# cc-usage

Waybar module for Claude Code usage limits. Shows 5-hour session %, weekly %, countdown to reset.

```
✦ 44% 2h31m · 15%w
```

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
| expired | very dim | OAuth token expired, waiting for CC to refresh |

**Menu** (click): Refresh now, copy usage to clipboard, copy raw JSON.

## How it works

Polls `https://api.anthropic.com/api/oauth/usage` every 60 seconds using the OAuth token from `~/.claude/.credentials.json`. Sends `User-Agent: claude-code/<version>` to get real-time data from the correct rate-limit bucket.

Does not refresh expired tokens — waits for Claude Code CLI to do it.

## Files

| File | Purpose |
|------|---------|
| `ccusage-waybar` | Polling loop, JSON output for waybar |
| `ccusage-menu` | Right-click context menu via walker/dmenu |
| `install.sh` | Symlinks scripts, patches waybar config + CSS |
| `uninstall.sh` | Removes everything cleanly |

Both install and uninstall are idempotent.
