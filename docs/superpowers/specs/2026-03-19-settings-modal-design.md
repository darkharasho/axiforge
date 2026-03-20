# Settings Modal

**Date:** 2026-03-19
**Status:** Draft

## Overview

Add a Settings modal accessible from the workspace dropdown. Initially contains only the Discord webhook URL setting, with room for future settings sections.

## Layout

```
┌─────────────────────────────────────────┐
│  Settings                          ✕    │
│─────────────────────────────────────────│
│                                         │
│  Discord                                │
│  Webhook URL                            │
│  [https://discord.com/api/webhooks/...] │
│                                         │
│                          [Save]         │
└─────────────────────────────────────────┘
```

## Architecture

### Settings Modal — `src/renderer/modules/settings-modal.js`

Follows the confirm-modal pattern: singleton overlay, `initSettingsModal()` + `openSettingsModal()`.

- `initSettingsModal()` — Creates overlay + modal DOM, appends to body, wires close/escape handlers.
- `openSettingsModal()` — Loads current settings values via `window.desktopApi.getSetting()`, populates inputs, shows modal.

**Discord section:**
- Label "Discord" as section header
- "Webhook URL" label + text input
- Input pre-populated with current value on open
- Save button validates URL (same regex: `^https://(discord\.com|discordapp\.com)/api/webhooks/`), saves via `setSetting`, closes modal
- Empty input clears the setting (allows unsetting)
- Invalid URL shows inline validation error

### Workspace Dropdown — `src/renderer/modules/render-pages.js`

Add a "Settings" button in `renderAuth()` after the auth buttons. Uses existing `makeButton` helper. Clicking opens the settings modal.

### Renderer Init — `src/renderer/renderer.js`

Import and call `initSettingsModal()` alongside other modal inits.

### Comp Detail — `src/renderer/modules/comps/comp-detail.js`

Remove the inline webhook URL input logic. When no webhook URL is configured, `showDiscordStatus("Set webhook URL in Settings first", true)` and return.

### Styling — `src/renderer/styles/settings-modal.css`

Based on confirm-modal.css. Same overlay, header, close button patterns. Width 480px. Section headers styled as small caps labels. Input styled to match app theme.

## Files

| File | Action |
|------|--------|
| `src/renderer/modules/settings-modal.js` | Create |
| `src/renderer/styles/settings-modal.css` | Create |
| `src/renderer/modules/render-pages.js` | Modify — add Settings button |
| `src/renderer/renderer.js` | Modify — import + init |
| `src/renderer/modules/comps/comp-detail.js` | Modify — remove inline prompt |
