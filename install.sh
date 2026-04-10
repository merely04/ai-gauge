#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WAYBAR_CONFIG="$HOME/.config/waybar/config.jsonc"
WAYBAR_STYLE="$HOME/.config/waybar/style.css"
SYMLINKS=(ccusage-waybar ccusage-menu)

echo "Installing cc-usage waybar module..."

for name in "${SYMLINKS[@]}"; do
    chmod +x "$SCRIPT_DIR/$name"
    ln -sf "$SCRIPT_DIR/$name" "$HOME/.local/bin/$name"
    echo "  Linked $name → ~/.local/bin/$name"
done

if [[ -f "$WAYBAR_CONFIG" ]] && ! grep -q '"custom/ccusage"' "$WAYBAR_CONFIG"; then
    python3 -c "
import sys

path = sys.argv[1]
with open(path) as f:
    text = f.read()

# Add to modules-center (last element, before closing bracket)
# Find: ...\"custom/notification-silencing-indicator\"]
# Replace with: ...\"custom/notification-silencing-indicator\", \"custom/ccusage\"]
text = text.replace(
    '\"custom/notification-silencing-indicator\"],',
    '\"custom/notification-silencing-indicator\", \"custom/ccusage\"],',
    1
)

# Add module definition before final }
module_def = '''  \"custom/ccusage\": {
    \"exec\": \"ccusage-waybar\",
    \"return-type\": \"json\",
    \"format\": \"{}\",
    \"tooltip\": true,
    \"on-click\": \"ccusage-menu\",
    \"on-click-right\": \"ccusage-menu\"
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

if [[ -f "$WAYBAR_STYLE" ]] && ! grep -q '#custom-ccusage' "$WAYBAR_STYLE"; then
    cat >> "$WAYBAR_STYLE" << 'CSS'

/* ccusage-start */
#custom-ccusage {
  min-width: 12px;
  margin-left: 5px;
  margin-right: 0;
  font-size: 11px;
}

#custom-ccusage.normal {
  opacity: 0.7;
}

#custom-ccusage.warning {
  color: #c5a555;
}

#custom-ccusage.critical {
  color: #a55555;
}

#custom-ccusage.expired {
  opacity: 0.3;
}

#custom-ccusage.waiting {
  opacity: 0.4;
}
/* ccusage-end */
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
