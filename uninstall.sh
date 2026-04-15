#!/usr/bin/env bash
set -euo pipefail

WAYBAR_CONFIG="$HOME/.config/waybar/config.jsonc"
WAYBAR_STYLE="$HOME/.config/waybar/style.css"
SYMLINKS=(ai-gauge-waybar ai-gauge-menu ai-gauge-server ai-gauge-config)

echo "Uninstalling ai-gauge waybar module..."

# Stop and disable systemd service first
systemctl --user stop ai-gauge-server 2>/dev/null || true
systemctl --user disable ai-gauge-server 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/ai-gauge-server.service"
systemctl --user daemon-reload 2>/dev/null || true
echo "  Stopped and removed ai-gauge-server service"

for name in "${SYMLINKS[@]}"; do
    rm -f "$HOME/.local/bin/$name"
    echo "  Removed ~/.local/bin/$name"
done

if [[ -f "$WAYBAR_CONFIG" ]] && grep -q '"custom/ai-gauge"' "$WAYBAR_CONFIG"; then
    python3 -c "
import sys, json, re

path = sys.argv[1]
with open(path) as f:
    text = f.read()

text = text.replace(', \"custom/ai-gauge\"', '', 1)
text = text.replace('\"custom/ai-gauge\", ', '', 1)

lines = text.splitlines(True)
result = []
skip = False
depth = 0
for line in lines:
    if not skip and '\"custom/ai-gauge\"' in line and ':' in line:
        skip = True
        depth = line.count('{') - line.count('}')
        for j in range(len(result) - 1, -1, -1):
            stripped = result[j].rstrip()
            if stripped.endswith(','):
                result[j] = stripped[:-1] + '\n'
                break
            elif stripped:
                break
        continue
    if skip:
        depth += line.count('{') - line.count('}')
        if depth <= 0:
            skip = False
        continue
    result.append(line)

with open(path, 'w') as f:
    f.writelines(result)
" "$WAYBAR_CONFIG"
    echo "  Cleaned waybar config.jsonc"
else
    echo "  Config not patched (skipped)"
fi

if [[ -f "$WAYBAR_STYLE" ]] && grep -q 'ai-gauge-start' "$WAYBAR_STYLE"; then
    sed -i '/\/\* ai-gauge-start \*\//,/\/\* ai-gauge-end \*\//d' "$WAYBAR_STYLE"
    echo "  Cleaned waybar style.css"
else
    echo "  CSS not patched (skipped)"
fi

rm -rf "${XDG_RUNTIME_DIR:-/tmp}/ai-gauge"
echo "  Cleaned runtime state"

rm -rf "$HOME/.config/ai-gauge"
echo "  Removed config"

STREAMDOCK_PLUGINS="$HOME/.wine/drive_c/users/$USER/AppData/Roaming/HotSpot/StreamDock/plugins"
PLUGIN_DST="$STREAMDOCK_PLUGINS/com.ai-gauge.streamdock.sdPlugin"
if [[ -d "$PLUGIN_DST" ]]; then
    rm -rf "$PLUGIN_DST"
    echo "  Removed StreamDock plugin"
fi

if command -v omarchy-restart-waybar &>/dev/null; then
    omarchy-restart-waybar
else
    killall -SIGUSR2 waybar 2>/dev/null || (killall waybar 2>/dev/null; waybar &disown) || true
fi
echo "  Restarted waybar"

echo "Done!"
