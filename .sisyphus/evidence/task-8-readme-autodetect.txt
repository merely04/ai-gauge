238:On first install, `ai-gauge setup` auto-detects which token source to use by checking which credential files exist:
244:If multiple sources exist, the most recently modified one wins (with fixed priority `opencode > codex > claude-code` as a tiebreaker). Auto-detect runs **only on first install** — subsequent `ai-gauge setup` runs preserve your existing choice.
361:| `AIGAUGE_DETECT_SKIP_KEYCHAIN=1` | Skip macOS Keychain during auto-detect (useful in headless/SSH sessions) |
