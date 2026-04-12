# Themed Build Pages

Per-profession color themes for build pages, applied both in the Electron app and the SPA.

## Overview

A toggle setting enables profession-specific full themes on build pages. When active, navigating to a build in the editor swaps the entire UI color world (backgrounds, surfaces, accents, buttons) to match the build's core profession. All other pages retain the user's chosen cosmetic theme. Published SPA build pages bake the profession theme into the URL.

## Profession Theme Palettes

9 new full themes, one per core GW2 profession. Elite specializations inherit their core profession's theme.

| Profession | Theme ID | Primary Accent | Secondary Accent | Vibe |
|---|---|---|---|---|
| Guardian | `prof-guardian` | `#6ea8ff` (blue) | `#90c0ff` | Noble blue |
| Warrior | `prof-warrior` | `#ff9944` (orange) | `#ffb870` | Bold orange |
| Necromancer | `prof-necromancer` | `#4dca7a` (green) | `#40a0a0` | Toxic green |
| Engineer | `prof-engineer` | `#cc8844` (copper) | `#e0a860` | Warm copper |
| Ranger | `prof-ranger` | `#77cc55` (lime) | `#a0d878` | Bright lime |
| Thief | `prof-thief` | `#cc6677` (rose) | `#d8a0a8` | Dusky rose |
| Mesmer | `prof-mesmer` | `#b07acc` (purple) | `#c8a0e0` | Arcane purple |
| Elementalist | `prof-elementalist` | `#dd5555` (red) | `#e89070` | Ember red |
| Revenant | `prof-revenant` | `#b84848` (burgundy) | `#c87868` | Dark burgundy |

## Theme Architecture

### CSS Theme Definitions

Each profession gets a full `[data-theme="prof-*"]` block in `themes.css`, following the exact same structure as existing full themes (Molten Core, Frostforge, etc.). Each overrides the complete variable set:

- `--bg`, `--bg-2`
- `--panel`, `--panel-2`
- `--line`, `--line-soft`
- `--input-bg`, `--input-border`
- `--surface`, `--surface-hover`
- `--panel-gradient`
- `--accent-rgb`, `--accent-2-rgb`
- `--gold`
- `--btn-primary-from`, `--btn-primary-to`, `--btn-primary-from-hover`, `--btn-primary-to-hover`

The `prof-` prefix separates these from user-facing cosmetic themes. Profession themes do not appear in the Appearance settings palette picker.

### Profession-to-Theme Mapping

A `PROFESSION_THEMES` constant in `constants.js` (alongside existing `PROFESSION_WEIGHT`):

```js
export const PROFESSION_THEMES = {
  Guardian: "prof-guardian",
  Warrior: "prof-warrior",
  Necromancer: "prof-necromancer",
  Engineer: "prof-engineer",
  Ranger: "prof-ranger",
  Thief: "prof-thief",
  Mesmer: "prof-mesmer",
  Elementalist: "prof-elementalist",
  Revenant: "prof-revenant",
};
```

## Settings

### New Setting

- Key: `appearance.themedBuildPages`
- Type: boolean
- Default: `false`
- Storage: `settings.json` via existing settings system

### Settings Modal UI

A toggle switch in the Appearance section of the settings modal, below the existing theme palette grid. Label: "Themed build pages" with a short description like "Color build pages to match the profession."

## Navigation Integration (Electron App)

### Navigate to Editor

In `navigateToPage()`, when `page === "editor"`:

1. Check if `appearance.themedBuildPages` is enabled
2. If enabled, read the current build's profession from editor state
3. Look up `PROFESSION_THEMES[profession]` for the theme ID
4. Stash the current `data-theme` value for later restoration
5. Apply the profession theme with transition (see Transition Effect below)

### Navigate Away from Editor

When navigating away from the editor page:

1. If a profession theme is currently active, restore the stashed user theme
2. Apply the transition in reverse

### Switching Builds Within Editor

When loading a different build while on the editor page:

1. If the toggle is on and the new build has a different profession, transition to the new profession's theme

### Toggling the Setting

If the user toggles `appearance.themedBuildPages` while on the editor page, immediately apply or remove the profession theme.

## Transition Effect

CSS custom properties don't transition natively. Instead, use a transient `.theme-transitioning` class:

1. Add `.theme-transitioning` to `<html>` — this class applies `transition: background-color 200ms ease, color 200ms ease` to `body`, `.page`, panels, and other major surface elements
2. Swap `data-theme` to the target theme
3. After 200ms, remove `.theme-transitioning`

The ambient background gradient (`body::before`) already animates via `--accent-rgb` on a 60s loop, so changing the accent variables naturally blends into the gradient cycle.

The SPA does not need transitions — it loads directly into the profession theme from the URL parameter.

## SPA Integration

### Theme Acceptance

Add all 9 `prof-*` theme IDs to the `VALID_THEMES` set in `src/site/main.js`.

### Publishing

When publishing a build with `appearance.themedBuildPages` enabled, the publish flow uses `PROFESSION_THEMES[build.profession]` as the `?t=` URL parameter instead of the user's `appearance.theme` setting.

When the toggle is off, publishing works as today (uses the user's cosmetic theme).

## Scope

### In Scope

- 9 new full profession themes in `themes.css`
- `appearance.themedBuildPages` toggle in settings modal
- Theme swap on build editor navigation (Electron app)
- Theme swap on build page load (SPA via `?t=` param)
- 200ms transition effect in the Electron app
- `PROFESSION_THEMES` mapping constant in `constants.js`

### Not in Scope

- Comp pages — no profession theming, unchanged
- Elite specialization color variations — core profession colors only
- Profession themes in the Appearance palette picker — programmatic only
- Changes to existing cosmetic themes
