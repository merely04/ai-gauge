#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WAYBAR_CONFIG="$HOME/.config/waybar/config.jsonc"
WAYBAR_STYLE="$HOME/.config/waybar/style.css"
SYMLINKS=(ai-gauge-waybar ai-gauge-menu ai-gauge-server ai-gauge-config)

echo "Installing ai-gauge waybar module..."

mkdir -p "$HOME/.local/bin"
for name in "${SYMLINKS[@]}"; do
    chmod +x "$SCRIPT_DIR/$name"
    ln -sf "$SCRIPT_DIR/$name" "$HOME/.local/bin/$name"
    echo "  Linked $name → ~/.local/bin/$name"
done

# Resolve bun path at install time
BUN_PATH=$(which bun 2>/dev/null || true)
if [[ -z "$BUN_PATH" ]]; then
    echo "Error: bun not found in PATH. Install bun first: https://bun.sh"
    exit 1
fi
echo "  Found bun at $BUN_PATH"

# Create default config if missing
CONFIG_DIR="$HOME/.config/ai-gauge"
CONFIG_FILE="$CONFIG_DIR/config.json"
mkdir -p "$CONFIG_DIR"
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo '{"tokenSource": "claude-code", "plan": "unknown"}' > "$CONFIG_FILE"
    echo "  Created default config → $CONFIG_FILE"
else
    echo "  Config already exists (skipped)"
fi

# Install systemd service
SYSTEMD_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_DIR"
SERVICE_SRC="$SCRIPT_DIR/ai-gauge-server.service"
SERVICE_DST="$SYSTEMD_DIR/ai-gauge-server.service"

# Copy and substitute placeholders
sed -e "s|__BUN_PATH__|$BUN_PATH|g" \
    -e "s|__SERVER_PATH__|$SCRIPT_DIR/ai-gauge-server|g" \
    "$SERVICE_SRC" > "$SERVICE_DST"

echo "  Installed ai-gauge-server.service → $SERVICE_DST"

systemctl --user daemon-reload
systemctl --user enable --now ai-gauge-server 2>/dev/null || true
echo "  Enabled ai-gauge-server systemd service"

# Post-install verification (non-fatal)
sleep 2
if systemctl --user is-active --quiet ai-gauge-server; then
    echo "  ai-gauge-server is active"
else
    echo "  Warning: ai-gauge-server not yet active (may need a moment to start)"
fi

# Install StreamDock plugin (if Wine + StreamDock are present)
STREAMDOCK_PLUGINS="$HOME/.wine/drive_c/users/$USER/AppData/Roaming/HotSpot/StreamDock/plugins"
PLUGIN_NAME="com.ai-gauge.streamdock.sdPlugin"
PLUGIN_SRC="$SCRIPT_DIR/streamdock-plugin"
if [[ -d "$STREAMDOCK_PLUGINS" ]] && [[ -d "$PLUGIN_SRC" ]]; then
    PLUGIN_DST="$STREAMDOCK_PLUGINS/$PLUGIN_NAME"
    mkdir -p "$PLUGIN_DST"
    cp -r "$PLUGIN_SRC/"* "$PLUGIN_DST/"
    echo "  Installed StreamDock plugin → $PLUGIN_DST"
else
    echo "  StreamDock not found (skipped plugin install)"
fi

if [[ -f "$WAYBAR_CONFIG" ]] && ! grep -q '"custom/ai-gauge"' "$WAYBAR_CONFIG"; then
    python3 -c "
import sys

path = sys.argv[1]
with open(path) as f:
    text = f.read()

# Add to modules-center (last element, before closing bracket)
# Find: ...\"custom/notification-silencing-indicator\"]
# Replace with: ...\"custom/notification-silencing-indicator\", \"custom/ai-gauge\"]
text = text.replace(
    '\"custom/notification-silencing-indicator\"],',
    '\"custom/notification-silencing-indicator\", \"custom/ai-gauge\"],',
    1
)

# Add module definition before final }
module_def = '''  \"custom/ai-gauge\": {
    \"exec\": \"ai-gauge-waybar\",
    \"return-type\": \"json\",
    \"format\": \"{}\",
    \"tooltip\": true,
    \"on-click\": \"ai-gauge-menu\",
    \"on-click-right\": \"ai-gauge-menu\"
  }'''

last_brace = text.rfind('}')
before = text[:last_brace].rstrip()
if not before.endswith(','):
    before += ','
text = before + '\n' + module_def + '\n' + text[last_brace:]

with open(path, 'w') as f:
    f.write(text)
" "$WAYBAR_CONFIG"
    echo "  Patched waybar config.jsonc"
else
    echo "  Config already patched (skipped)"
fi

if [[ -f "$WAYBAR_STYLE" ]] && ! grep -q '#custom-ai-gauge' "$WAYBAR_STYLE"; then
    cat >> "$WAYBAR_STYLE" << 'CSS'

/* ai-gauge-start */
#custom-ai-gauge {
  min-width: 12px;
  margin-left: 5px;
  margin-right: 0;
  font-size: 11px;
}

#custom-ai-gauge.normal {
  opacity: 0.7;
}

#custom-ai-gauge.warning {
  color: #c5a555;
}

#custom-ai-gauge.critical {
  color: #a55555;
}

#custom-ai-gauge.expired {
  opacity: 0.3;
}

#custom-ai-gauge.waiting {
  opacity: 0.4;
}
/* ai-gauge-end */
CSS
    echo "  Patched waybar style.css"
else
    echo "  CSS already patched (skipped)"
fi

if command -v omarchy-restart-waybar &>/dev/null; then
    omarchy-restart-waybar
else
    killall -SIGUSR2 waybar 2>/dev/null || (killall waybar 2>/dev/null; waybar &disown) || true
fi
echo "  Restarted waybar"

echo "Done!"
