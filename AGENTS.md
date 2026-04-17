# AGENTS.md — ai-gauge

Compact guide for AI agents working in this repo. For user-facing docs see `README.md` and `docs/LLM_INSTALL.md`.

## Stack (unusual, read this first)

- **Runtime: Bun (not Node)** — `bin/ai-gauge-server` and `bin/ai-gauge-waybar` use `#!/usr/bin/env bun` and Bun-native APIs (`Bun.file`, `Bun.serve`, `Bun.spawn`). Do not rewrite as Node/ESM.
- **Three bash scripts** (`bin/ai-gauge`, `bin/ai-gauge-config`, `bin/ai-gauge-menu`) — all start with `set -euo pipefail`. Respect that when editing.
- **Plain JavaScript, no TypeScript.** No `tsconfig.json`, no build step, no bundler.
- **Zero npm runtime deps.** `package.json` has no `dependencies`/`devDependencies`/`scripts`. The WebSocket server and client are hand-rolled. Do not add a dep without discussing.
- **Linux-only**: `"os": ["linux"]` in `package.json`. Code assumes systemd user services, `$XDG_RUNTIME_DIR`, wl-copy, notify-send.
- **No tests**, no linter, no formatter config. Verification is manual: `systemctl --user status ai-gauge-server` and `journalctl --user -u ai-gauge-server -n 20`.

## Commands — there are no `npm run` targets

There is no test/lint/build. Interact via the five bin entries directly:

| Command | Language | Role |
|---|---|---|
| `bin/ai-gauge` | bash | User-facing CLI: `setup` / `uninstall` / `status` / `version` |
| `bin/ai-gauge-server` | Bun | WebSocket daemon on `ws://localhost:19876`; polls Anthropic `/api/oauth/usage` |
| `bin/ai-gauge-waybar` | Bun | Thin WS client — emits waybar JSON to stdout |
| `bin/ai-gauge-menu` | bash | Right-click menu (uses `omarchy-launch-walker` UI + `wl-copy` + `notify-send`) |
| `bin/ai-gauge-config` | bash | Settings CLI / walker UI; writes `~/.config/ai-gauge/config.json` and restarts the service |

Manual sanity checks after editing:

```bash
systemctl --user restart ai-gauge-server
journalctl --user -u ai-gauge-server -n 30 --no-pager
ai-gauge-waybar          # prints one waybar JSON line per server broadcast; Ctrl-C to stop
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

Token sources (config `tokenSource` field):

- `claude-code` (default): reads `~/.claude/.credentials.json` → `claudeAiOauth.accessToken` / `expiresAt`.
- `opencode`: reads `~/.local/share/opencode/auth.json` → `anthropic.access` / `anthropic.expires`.

State/config paths (never relocate without updating every script):

- Config: `~/.config/ai-gauge/config.json` (`{tokenSource, plan}`)
- Runtime state: `${XDG_RUNTIME_DIR:-/tmp}/ai-gauge/usage.json` (atomic write via temp + `renameSync`)
- systemd unit: `~/.config/systemd/user/ai-gauge-server.service`
- Waybar config patched: `~/.config/waybar/config.jsonc` + `~/.config/waybar/style.css`
- StreamDock install path (Wine): `~/.wine/drive_c/users/$USER/AppData/Roaming/HotSpot/StreamDock/plugins/com.ai-gauge.streamdock.sdPlugin`

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

## External tools the scripts assume

Not npm packages — system binaries. None are declared anywhere; if you add a new one, document it in `docs/LLM_INSTALL.md` under Prerequisites.

- **Required**: `bun`, `bash`, `jq`, `python3` (setup only), `systemctl` (user), `sed`, `readlink`.
- **Desktop integration**: `notify-send` (libnotify), `wl-copy` (wl-clipboard), `waybar`.
- **Optional, Omarchy distro**: `omarchy-launch-walker` (menu/settings UI), `omarchy-restart-waybar`. Scripts degrade gracefully when these are missing.
- **Optional, StreamDock path**: Wine + Fifine Control Deck + StreamDock app. `run.bat` hardcodes `C:\Program Files (x86)\fifine Control Deck\node\node20.exe` and sets `NODE_SKIP_PLATFORM_CHECK=1` — do not change this path, it is the Fifine-bundled Node the plugin host uses.

## Release / publish

- Trigger: `git tag vX.Y.Z && git push --tags`. CI is `.github/workflows/publish.yml`.
- CI uses **Node 22 + `npm publish`** (not Bun) with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. This is fine because publishing is just tarball upload — the code still runs on Bun at the user's machine.
- Published files (from `package.json` `files`): `bin/`, `lib/`, `README.md`, `docs/`. `assets/` and `.sisyphus/` are excluded via `.npmignore`.
- Bump `"version"` in `package.json` manually before tagging. The lib/streamdock-plugin/manifest.json `Version` field is separate — update it only when the StreamDock plugin protocol actually changes.

## Editing gotchas

- **Don't break the `lib/ai-gauge-server.service` template.** Placeholders `__BUN_PATH__` / `__SERVER_PATH__` are substituted with `sed` and any `|` in new paths would break the `sed` delimiter. Keep them.
- **Hardcoded port 19876** appears in at least 5 places — grep before renaming.
- **StreamDock plugin is a self-contained distributable**, not a library the Bun code imports. It lives under `lib/` only because it ships in the npm tarball. It runs under Wine, not Linux, using the Fifine-bundled Windows Node.
- **The `ai-gauge-server` sends desktop notifications** via spawning `notify-send` (`bin/ai-gauge-server:164`). On 80% usage it alerts once (`alerted80` flag) and resets below 50%. Do not convert this to a library call.
- **Setup's waybar JSON patch is fragile** — it uses string replacement on `config.jsonc`, not a real JSON parser (jsonc allows comments). Test changes against a real Omarchy/Hyprland waybar config.
- **`claudeVersion = '2.1.100'`** in `bin/ai-gauge-server:16` — this is a User-Agent value sent to the Anthropic usage endpoint. Bumping it without reason can break fetches if Anthropic validates it.
- **Commit style**: repo has no commit hooks, no CHANGELOG, no PR template. Keep commits small and focused; no tests to run.
- **`.gitignore` only ignores `.sisyphus/`** — be careful not to commit local editor junk.
