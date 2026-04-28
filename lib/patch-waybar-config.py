#!/usr/bin/env python3
"""Patch ~/.config/waybar/config.jsonc to add (or migrate) the ai-gauge module.

Reads absolute binary paths from env vars to avoid relative-path PATH-freeze
bugs (waybar locks PATH at startup; bun/pnpm/mise upgrades that move
~/.bun/bin/ symlinks otherwise break the module silently).

Env:
    AI_GAUGE_WAYBAR_BIN — absolute path to ai-gauge-waybar binary
    AI_GAUGE_MENU_BIN   — absolute path to ai-gauge-menu binary

Argv:
    [1] — path to waybar config.jsonc

Behavior:
    - If config has no "custom/ai-gauge" block: inserts a new one after
      the notification-silencing-indicator anchor and appends a module
      definition before the trailing brace.
    - If config already contains "custom/ai-gauge": rewrites exec /
      on-click / on-click-right values to the current absolute paths
      (migrates legacy bare names AND stale absolute paths).

Stdout: one of "inserted" | "migrated" | "noop".
"""

import os
import re
import sys


def patch(text: str, waybar_bin: str, menu_bin: str) -> tuple[str, str]:
    if '"custom/ai-gauge"' in text:
        new_text = re.sub(
            r'("exec":\s*")[^"]*ai-gauge-waybar(")',
            lambda m: m.group(1) + waybar_bin + m.group(2),
            text,
        )
        new_text = re.sub(
            r'("on-click(?:-right)?":\s*")[^"]*ai-gauge-menu(")',
            lambda m: m.group(1) + menu_bin + m.group(2),
            new_text,
        )
        return new_text, ('migrated' if new_text != text else 'noop')

    new_text = text.replace(
        '"custom/notification-silencing-indicator"],',
        '"custom/notification-silencing-indicator", "custom/ai-gauge"],',
        1,
    )

    module_def = (
        '  "custom/ai-gauge": {\n'
        f'    "exec": "{waybar_bin}",\n'
        '    "return-type": "json",\n'
        '    "format": "{}",\n'
        '    "tooltip": true,\n'
        f'    "on-click": "{menu_bin}",\n'
        f'    "on-click-right": "{menu_bin}"\n'
        '  }'
    )

    last_brace = new_text.rfind('}')
    before = new_text[:last_brace].rstrip()
    if not before.endswith(','):
        before += ','
    new_text = before + '\n' + module_def + '\n' + new_text[last_brace:]
    return new_text, 'inserted'


def main() -> int:
    if len(sys.argv) != 2:
        print('usage: patch-waybar-config.py <config.jsonc>', file=sys.stderr)
        return 2

    waybar_bin = os.environ.get('AI_GAUGE_WAYBAR_BIN')
    menu_bin = os.environ.get('AI_GAUGE_MENU_BIN')
    if not waybar_bin or not menu_bin:
        print('AI_GAUGE_WAYBAR_BIN and AI_GAUGE_MENU_BIN must be set', file=sys.stderr)
        return 2

    config_path = sys.argv[1]
    with open(config_path, 'r') as f:
        text = f.read()

    new_text, action = patch(text, waybar_bin, menu_bin)
    if new_text != text:
        with open(config_path, 'w') as f:
            f.write(new_text)
    print(action)
    return 0


if __name__ == '__main__':
    sys.exit(main())
