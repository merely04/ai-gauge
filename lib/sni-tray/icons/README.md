# SNI Tray Icons

Six hand-authored SVGs that ship to the user via the npm tarball and are loaded by the Plasma 6 system tray (and any other StatusNotifierWatcher implementation) through the `IconName` D-Bus property emitted by `lib/sni-tray/sni-helper.py`. Filenames match the `Icon Names` enum in `../IPC.md` byte-for-byte.

## Color Mapping

| State | Primary hex | Source of truth | Semantic intent |
|---|---|---|---|
| `ai-gauge-normal` | `#FF9500` → `#FF3B30` (gradient) | brand `scripts/generate-icon.swift` | low utilization, calm — brand orange-to-red gauge fill at ~30% sweep |
| `ai-gauge-waiting` | `#888888` @ opacity 0.4 | tray convention (dimmed) | WebSocket disconnected — entire icon greyed, no urgency encoded |
| `ai-gauge-warning` | `#c5a555` | `bin/ai-gauge` waybar CSS | 50–79% utilization — muted yellow gauge fill at ~60% sweep |
| `ai-gauge-critical` | `#a55555` | `bin/ai-gauge` waybar CSS | ≥80% utilization — muted red, gauge fully filled, needle pegged right |
| `ai-gauge-update-available` | `#43A047` (badge) | task spec | new daemon version on npm — green corner dot overlaid on `normal` gauge |
| `ai-gauge-updating` | `#29B6F6` (spinner) | `bin/ai-gauge` waybar CSS | install-in-progress — static 270° spinner glyph overlaid on `normal` gauge |

The five non-grey hex codes are byte-identical to the Waybar CSS palette in `bin/ai-gauge` (`_patch_waybar_style`, lines ~310-340) so a user glancing at the tray and the waybar at once sees the **same color for the same state** — even though the two render paths share no code.

The brand gradient stops `#FF9500` and `#FF3B30` are lifted directly from `scripts/generate-icon.swift` (lines 79–80), keeping the tray icon visually continuous with the macOS `.icns` app icon.

## ViewBox & Rendering Targets

All six SVGs use `viewBox="0 0 24 24"` — the de-facto system tray convention, matching Material symbols, Breeze monochrome, and Adwaita's tray glyphs. Plasma 6 renders the tray icon at the user's configured panel height; common sizes are **16, 22, 32, and 48 px**. Stroke widths (2.4 for the gauge arc, 1.4 for the needle) and the badge radius (~2.4 — the green-dot / spinner overlay in the corner) were tuned so the silhouette stays readable down to 16 px without sub-pixel mush, and stays clean at 48 px without looking under-detailed.

The pivot sits at `(12, 14)` so the semicircle arc occupies the **upper portion of the viewport** — mirroring the macOS app-icon composition where the gauge pivot is at `y=424` of a 1024×1024 canvas.

## Why Colored, Not `-symbolic`

Freedesktop convention says system tray icons should be `-symbolic`: monochrome, single-path, recolored by the toolkit to match the active theme's text color. We **deliberately deviate** from that convention.

The whole purpose of the six-state ladder is **color-encoded urgency**. A `-symbolic` icon would erase that — Plasma would repaint warning yellow, critical red, the update-available green badge, and the updating blue spinner all to the same theme foreground color, leaving the user with five visually identical icons. The shape alone (gauge fill at 30%/60%/100%, badge presence, spinner presence) does carry _some_ signal, but at 16 px the differences between 30% and 60% fill are easy to miss in peripheral vision. Color is the redundant cue that makes the ladder _glanceable_.

Trade-off: the icons are not fully theme-adaptive. The `#888888` track at opacity 0.35 is the one element designed to read on both light and dark backdrops; everything else is brand-tuned. See **Theme Readability** below for the full discussion.

## Priority Ladder

When multiple states are active, the highest-priority state wins. From `../IPC.md`:

```
updating > critical > warning > update-available > normal
```

`ai-gauge-waiting` is **outside the ladder** — it is shown only while the WebSocket is disconnected and is replaced the instant a broadcast arrives. Example: usage at 85 % with an update available → icon is `ai-gauge-critical`, not `ai-gauge-update-available`.

Selection logic lives on the Bun side (`bin/ai-gauge-tray`), not in the icon files themselves. The icons are pure visual leaves of that decision tree.

## Plasma 6 Bug 479712 — Defense in Depth

Plasma 6 has a known regression where the `IconName` D-Bus property is sometimes **not honored** when the named icon is not in the global theme search path — the tray slot stays blank or shows the previous icon. Workarounds shipped by other SNI clients (KeePassXC, Telegram Desktop, qBittorrent) all follow the same pattern: **populate `IconPixmap` from in-process bytes as a fallback**, so Plasma always has _something_ to render even if the named lookup fails.

`lib/sni-tray/sni-helper.py` (Wave 1) implements that fallback: when `set-icon` is received, it sets `IconName` _and_ rasterizes the matching SVG from this directory into ARGB32 pixmap data attached to `IconPixmap`. Plasma uses whichever it can resolve first.

That redundancy is why these SVGs ship inside the npm tarball at a **stable relative path** (`lib/sni-tray/icons/`) rather than being installed into a user-level icon theme — the helper reads them directly from disk. Keep this directory layout intact.

## Regeneration

These SVGs are **hand-authored**, not procedurally generated.

This is a deliberate departure from the macOS app icon, which is rendered procedurally by `scripts/generate-icon.swift` driving Core Graphics. A `1024×1024` raster benefits from procedural code (gradients, anti-aliased ticks, sub-pixel needle); a 24-unit viewBox does not. The trade-off:

- macOS app icon — many sizes, many effects, easier to procedurally generate from one Swift source than to hand-edit 12 PNG assets.
- Tray icons — six tiny static glyphs, six urgency variations, edited by humans for visual balance at 16 px. Procedural generation here would add a build step and obscure the simple geometry.

**To replace any icon**: edit the `.svg` file directly with a text editor or vector tool, validate with `xmllint --noout <file>`, and confirm the file stays ≤ 4 KB and ≤ 80 lines. No rebuild step. No procedural script. Gradient `id` values must remain unique across files (`aig-grad-normal`, `aig-grad-update-available`, `aig-grad-updating`) so the Plasma SVG cache cannot collide multiple icons onto a single gradient.

Do **not** add `<animate>`, `<animateTransform>`, CSS `@keyframes`, or `<script>` — Plasma caches resolved icons; an animated SVG would be sampled at a single arbitrary frame and look broken. Any "spinning" effect in the updating state must come from the Bun client cycling icon names, which is explicitly out of scope for IPC v1.

## Theme Readability

Each color was sanity-checked against the two Plasma 6 default themes:

- **Breeze Light** — tray backdrop ≈ `#EFF0F1` (cool light grey, not pure white).
- **Breeze Dark**  — tray backdrop ≈ `#2A2E32` (cool dark grey, near `#1A1A22`).

Notes per element:

- **Track** (`#888888` @ opacity 0.35) — the one neutral element. Sits ~40 % between `#EFF0F1` and `#2A2E32`, so it shows on both themes as a faint gauge silhouette. This is the cue that the icon _has_ a gauge shape even before the urgency fill registers.
- **Hub** (white core + 0.4 px `#1A1A22` outline) — the white circle pops on dark backdrops; the dark hairline keeps it defined on light backdrops. Without the hairline, the hub vanishes on Breeze Light.
- **Needle** (`#FFFFFF`) — biased toward dark themes. On Breeze Light, the white needle is subtle but the colored fill arc is the primary urgency cue regardless. The needle is supporting brand identity, not the primary signal.
- **Brand orange/red** (`#FF9500` → `#FF3B30`) — vivid on dark backdrops; lower contrast on Breeze Light but unmistakable as "warm gauge" — fits the brand vocabulary.
- **Warning yellow** (`#c5a555`), **critical red** (`#a55555`) — muted on purpose to match waybar; readable on dark, slightly washed on Breeze Light.
- **Update-available green** (`#43A047`), **updating blue** (`#29B6F6`) — corner badges sit in the empty top-right of the viewport, so they get full backdrop contrast independent of the gauge fill underneath.

## Rough WCAG Contrast Notes

These are **mental estimates**, not measured ratios — and they are for icon legibility, not WCAG text compliance (icons have a lower bar). Backdrop assumptions: `#FFFFFF` (worst-case Breeze Light) and `#1A1A22` (Breeze Dark / matches the brand icon backdrop):

| Hex | on `#FFFFFF` | on `#1A1A22` | Notes |
|---|---|---|---|
| `#FF9500` | ~3.0 : 1 | ~7.5 : 1 | brand orange — strong on dark, acceptable on light |
| `#FF3B30` | ~4.0 : 1 | ~5.5 : 1 | brand red gradient terminus |
| `#c5a555` | ~2.3 : 1 | ~6.7 : 1 | warning yellow — weakest on light, by spec |
| `#a55555` | ~4.5 : 1 | ~3.5 : 1 | critical red — readable on both |
| `#43A047` | ~3.4 : 1 | ~4.5 : 1 | update-available green — readable on both |
| `#29B6F6` | ~2.4 : 1 | ~6.5 : 1 | updating blue — strong on dark, soft on light |
| `#888888` | ~3.5 : 1 | ~4.5 : 1 | neutral track — designed as the bridge color |

The two weakest pairings (`#c5a555` and `#29B6F6` on white) are deliberately accepted: keeping the palette identical across waybar and tray was prioritized over per-theme contrast tuning. A future v2 may ship Breeze-Light-tuned variants if user reports indicate the trade-off was wrong.
