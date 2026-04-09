# AxiForge Design Modernization

**Direction**: Cool Midnight + Clean Orange
**Scope**: Full visual + layout overhaul — colors, typography, navigation, components, and motion

## Design Principles

- Clean, intuitive, modern — nothing cluttered or dated
- Cool neutral base with warm accent pops (not warm-tinted everything)
- Motion as polish, not decoration — every animation serves a purpose
- Game-specific UI (traits, equipment, specs) keeps its structure; the chrome around it modernizes

## Color System

### Core Palette

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `#090a10` | Base background (cool midnight) |
| `--bg-2` | `#0d0e16` | Slightly lifted background |
| `--panel` | `#14161e` | Panel/card surfaces |
| `--panel-2` | `#10121a` | Darker panel variant |
| `--text` | `#e4e6ee` | Primary text (cool neutral white) |
| `--text-light` | `#b0b4c0` | Secondary text |
| `--text-dim` | `#6a6e80` | Muted/tertiary text |
| `--muted` | `#8890a6` | Disabled state color |

### Accents

| Token | Value | Role |
|-------|-------|------|
| `--accent` | `#f09040` | Primary accent (clean orange) |
| `--accent-2` | `#64aaf0` | Secondary accent (cool blue) |
| `--gold` | `#e8b050` | Elite specs, highlights (brighter gold) |
| `--danger` | `#c5485f` | Error/destructive states (unchanged) |
| `--danger-text` | `#f87171` | Error text (unchanged) |

### Interactive States

| Token | Value |
|-------|-------|
| `--hover-subtle` | `rgba(255, 255, 255, 0.05)` |
| `--hover-accent` | `rgba(240, 144, 64, 0.12)` |
| `--hover-accent-strong` | `rgba(240, 144, 64, 0.2)` |
| `--focus-ring` | `rgba(240, 144, 64, 0.26)` |

### Surfaces & Borders

| Token | Value |
|-------|-------|
| `--line` | `#1e2030` |
| `--line-soft` | `#181a26` |
| `--input-bg` | `#0c0e16` |
| `--input-border` | `#252838` |
| `--surface` | `rgba(10, 12, 18, 0.92)` |
| `--surface-hover` | `rgba(14, 16, 24, 0.95)` |
| `--panel-gradient` | `linear-gradient(180deg, rgba(20, 22, 30, 0.95), rgba(16, 18, 26, 0.95))` |

### Body Background Gradient

Replace the current green/blue radial gradient wash with:

```css
body {
  background:
    radial-gradient(1300px 550px at -5% -10%, rgba(240, 144, 64, 0.08), transparent 55%),
    radial-gradient(1000px 550px at 110% 0%, rgba(100, 170, 240, 0.08), transparent 55%),
    var(--bg);
}
```

Subtle orange (bottom-left) and blue (top-right) ambient glow.

## Typography

### Font Stack

| Role | Current | New |
|------|---------|-----|
| Brand (titlebar) | Cinzel | **Cinzel** (no change) |
| Display/headings | Cinzel | **Outfit** (weights: 500, 600, 700) |
| Body text | Exo 2 | **DM Sans** (weights: 400, 500, 600, 700) |
| Monospace | IBM Plex Mono | **IBM Plex Mono** (no change) |

### Application

- Titlebar brand "AxiForge Editor": Cinzel, stays exactly as-is
- Panel headings (h1, h2): Outfit, same sizes as current
- Panel subtitles, labels: Outfit at smaller weights
- Body text, inputs, buttons: DM Sans
- Build codes: IBM Plex Mono

Font sizes remain unchanged — the current scale is already appropriate.

## Navigation & Layout

### Sidebar

| Property | Current | New |
|----------|---------|-----|
| Width | 100px | 54px |
| Content | Icon + label stacked | Icon only, tooltip on hover |
| Active state | Color change | Orange background tint + left edge bar (3px) |
| Hover | Background tint | Lift + subtle glow |

### Subnav Tabs

| Property | Current | New |
|----------|---------|-----|
| Style | Button-style tabs | Pill/segment control |
| Container | No visible container | Rounded container (`border-radius: 10px`) with subtle bg |
| Active state | Bold text | Orange-tinted background pill |
| Height | 76px | Same structure, more compact visual weight |

### Grid

App layout changes from `100px | 1fr` to `54px | 1fr`.

### Titlebar

Same 42px height, same structure. Updated to new color tokens. Cinzel brand text unchanged.

## Component Updates

### Panels & Cards

- Border radius stays at 14px
- Borders: `--line` (`#1e2030`) — subtler, less colored than current blue-tinted borders
- Backgrounds: new `--panel` tokens
- No structural changes

### Buttons

| Variant | Current | New |
|---------|---------|-----|
| Primary | Blue gradient | Orange gradient (`#f09040` → `#e07020`) + glow shadow |
| Default | `--panel` bg, `--line` border | Same structure, new neutral tokens |
| Danger | Red-tinted | Unchanged |
| Padding | `7px 10px` | `8px 14px` (slightly larger hit targets) |

### Inputs & Selects

- Background: `--input-bg` (`#0c0e16`)
- Border: `--input-border` (`#252838`)
- Focus: orange border + orange glow ring
- Same border radius, same sizing

### Tags & Badges

- Tag pills: shift from blue-tinted to orange-tinted (`rgba(240, 144, 64, 0.18)` bg, `rgba(240, 144, 64, 0.35)` border)
- Role badges: keep all profession-specific colors unchanged (game-defined)

### Modals

- Updated surface colors via tokens
- Add entrance/exit animations (see Motion section)
- Same structure and sizing

### Scrollbars

- Thumb color: `rgba(240, 144, 64, 0.3)` → hover `rgba(240, 144, 64, 0.5)`
- Track: transparent (unchanged)
- Width: 6px (unchanged)

## Motion & Animation

All CSS-only. No JS animation libraries.

### Page & Panel Transitions

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Panel/card entrance | Staggered fade-up (`opacity 0→1`, `translateY(8px→0)`) | 0.25s | ease-out |
| Stagger delay | 40ms between sibling items | — | — |
| Page content swap | Crossfade + subtle slide | 0.2s | ease-out |

### Interactive Micro-animations

| Element | Animation | Duration |
|---------|-----------|----------|
| Buttons hover | `scale(1.02)` + color transition | 0.15s |
| Nav icons hover | Gentle lift + glow | 0.2s |
| Tab switch | Active indicator slides to new position | 0.2s |
| Dropdown/menu open | Slide-down + fade | 0.15s |
| Modal entrance | Scale from 0.96 + fade-in | 0.2s ease-out |
| Modal exit | Fade-out + scale to 0.98 | 0.15s ease-in |
| Tooltip entrance | Fade + translateY(4px→0) | 0.12s |

### Feedback Animations

| Trigger | Animation |
|---------|-----------|
| Save success | Brief green pulse + checkmark icon flash |
| Copy action | Subtle bounce + color flash |

### Ambient

| Element | Animation | Duration |
|---------|-----------|----------|
| Body gradient wash | Very slow drift/pulse | 60s+ cycle |
| Skeleton loaders | Unchanged (existing pulse at 1.8s) | — |

### Timing Constraints

- All interactive transitions ≤ 0.3s (nothing sluggish)
- Entrance animations ≤ 0.25s
- Exit animations ≤ 0.15s (exits should feel snappier than entrances)

## Files Affected

All 21 CSS files in `src/renderer/`:

| File | Changes |
|------|---------|
| `base.css` | All design token values, font imports, body background |
| `layout.css` | Sidebar width (100px → 54px), grid template, nav icon styles, active states |
| `buttons.css` | Primary button gradient, padding, hover animations |
| `forms.css` | Input/select token updates, focus ring color |
| `cards.css` | Border/surface token updates, entrance animations |
| `custom-select.css` | Token updates, dropdown open animation |
| `specializations.css` | Token updates (game-specific structure unchanged) |
| `skills.css` | Token updates |
| `equipment.css` | Token updates |
| `detail-panel.css` | Token updates |
| `detail-modal.css` | Token updates, entrance/exit animations |
| `confirm-modal.css` | Token updates, entrance/exit animations |
| `wiki-modal.css` | Token updates, entrance/exit animations |
| `import-conflict-modal.css` | Token updates, entrance/exit animations |
| `settings-modal.css` | Token updates, entrance/exit animations |
| `skeleton.css` | No changes (existing animations are good) |
| `notes.css` | Token updates |
| `library.css` | Token updates, card entrance animations |
| `comps.css` | Token updates |
| `mini-build-card.css` | Token updates |
| `role-badge.css` | No changes (profession colors are game-defined) |

Additionally, `src/renderer/index.html` needs updated Google Font imports (add Outfit, DM Sans; keep Cinzel, IBM Plex Mono; remove Exo 2).

## What Does NOT Change

- Game-specific UI patterns (trait hexagons, spec cards, equipment slots, skill grids)
- Role badge profession colors
- Skeleton loader animations
- IBM Plex Mono for build codes
- Cinzel for the AxiForge brand in the titlebar
- Modal sizing and structure
- Z-index scale
- Shadow scale (values may shift slightly but same 3-tier system)
