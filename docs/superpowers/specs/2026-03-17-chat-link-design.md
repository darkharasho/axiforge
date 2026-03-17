# GW2 In-Game Chat Link Generation

## Overview

Add support for generating GW2 in-game build template chat links (`[&...]` format) from axiforge builds. Users can copy chat links from the build editor and from the library context menu, then paste them directly into GW2's chat to share builds in-game.

## Integration Strategy

Install the existing `gw2buildlink` npm package (https://github.com/darkharasho/gw2buildlink) as a dependency. This library handles the binary encoding of build templates and resolves names/IDs via the GW2 API.

- **Online-only**: The library calls `api.guildwars2.com/v2` at encode time. No offline fallback.
- **Best-effort encoding**: Missing fields (no ranger pets, no revenant legends, no weapons) encode as zeros. The GW2 client renders empty slots gracefully.

## Data Mapping

Axiforge builds already store the data needed for chat link generation. The mapping from axiforge's build format to `gw2buildlink`'s `BuildTemplateInput`:

| Axiforge field | BuildTemplateInput field | Notes |
|---|---|---|
| `profession` (string, e.g. "Guardian") | `profession` | Direct pass-through |
| `specializations[].id` | `specializations[].id` | Numeric spec ID |
| `specializations[].majorChoices` `{1: traitId, 2: traitId, 3: traitId}` | `specializations[].traits` `[traitId, traitId, traitId]` | Library resolves trait IDs to position choices |
| `skills.heal.id` | `skills.terrestrial.heal` | Numeric skill ID |
| `skills.utility[].id` | `skills.terrestrial.utilities[]` | Array of up to 3 skill IDs |
| `skills.elite.id` | `skills.terrestrial.elite` | Numeric skill ID |
| `underwaterSkills.heal/utility/elite` | `skills.aquatic.*` | Same structure as terrestrial |
| `selectedLegends` (e.g. `["Legend1", "Legend7"]`) | `revenantLegends` | Parse digit from string → numeric code |
| `selectedUnderwaterLegends` | `revenantLegends` (aquatic pair) | Same mapping as terrestrial legends |
| `selectedPets` `{terrestrial1, terrestrial2, aquatic1, aquatic2}` | `rangerPets` `[t1, t2, a1, a2]` | Already numeric IDs |
| `equipment.weapons` `{mainhand1: "Sword", ...}` | `weapons` | String weapon names, library resolves to IDs |

### Legend ID mapping

Axiforge stores revenant legends as `"Legend1"` through `"Legend8"`. The `gw2buildlink` library expects numeric codes 1–8. The mapping is: parse the trailing digit from the string (e.g. `"Legend7"` → `7`).

The four `revenantLegends` slots in the binary format are: `[terrestrial active, terrestrial inactive, aquatic active, aquatic inactive]`. Map from `selectedLegends[0]`, `selectedLegends[1]`, `selectedUnderwaterLegends[0]`, `selectedUnderwaterLegends[1]`.

## Persistence Fix

The following fields are currently tracked in the editor state and serialized by `serializeEditorToBuild()`, but are **stripped by `normalizeBuild()` in `buildStore.js`** on save. They must be added to `normalizeBuild()` so they persist to disk:

- `selectedLegends` — array of 2 legend ID strings
- `selectedUnderwaterLegends` — array of 2 legend ID strings
- `activeLegendSlot` — number (0 or 1)
- `selectedPets` — object with `terrestrial1`, `terrestrial2`, `aquatic1`, `aquatic2` (numbers)
- `morphSkillIds` — array of 3 numbers

This ensures the library context menu can generate chat links from saved builds (not just from the active editor state).

## Architecture

### New module: `src/main/buildChatLink.js`

Single exported function:

```
async function generateChatLink(build) → string
```

Responsibilities:
1. Map axiforge build object to `BuildTemplateInput`
2. Instantiate `DefaultGw2ApiClient`
3. Call `encodeBuildTemplate(input, { api })`
4. Return the `[&...]` chat link string

Error handling: Let exceptions propagate — the renderer catches and shows the error state.

### IPC handler

In `src/main/index.js`, register:

```javascript
ipcMain.handle("builds:generate-chat-link", async (_e, build) => {
  const { generateChatLink } = require("./buildChatLink.js");
  return generateChatLink(build);
});
```

### Preload bridge

In `src/preload/index.js`, add:

```javascript
generateChatLink: (build) => ipcRenderer.invoke("builds:generate-chat-link", build),
```

## UI: Build Editor

### Placement

A "Chat Link" button fused to the right edge of the Build Title input field, forming an input group. The existing 3-column grid (`toolbar-grid`) is unchanged — the button is inside the title label's column.

### HTML structure

Inside the Build Title `<label>`, wrap the existing `<input>` and a new `<button>` in a flex container:

```html
<label>
  Build Title
  <div class="title-input-group">
    <input id="editorTitle" type="text" maxlength="140" placeholder="Power Reaper Roamer" />
    <button id="chatLinkBtn" class="title-input-group__btn" type="button" title="Copy Chat Link">
      <svg><!-- link icon --></svg>
      Chat Link
    </button>
  </div>
</label>
```

### CSS

```css
.title-input-group {
  display: flex;
}
.title-input-group input {
  border-radius: var(--radius) 0 0 var(--radius);
  border-right: none;
  flex: 1;
  min-width: 0;
}
.title-input-group__btn {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 0 var(--radius) var(--radius) 0;
  color: var(--muted);
  padding: 0 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  white-space: nowrap;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}
```

### Feedback states

On click, the button temporarily changes appearance for ~2 seconds:

- **Success**: Green border, green text, checkmark icon, label changes to "Copied!"
- **Error**: Red border, red text, X icon, label changes to "Failed"

After the timeout, the button reverts to its normal state. Implementation: toggle a CSS class (`--success` or `--error`) and remove it after a `setTimeout`.

### Click handler

```javascript
chatLinkBtn.addEventListener("click", async () => {
  const build = serializeEditorToBuild();
  try {
    const link = await window.desktopApi.generateChatLink(build);
    await window.desktopApi.writeClipboardText(link);
    // Show success state
  } catch (err) {
    // Show error state
  }
});
```

## UI: Library Context Menu

### Placement

In `showBuildMenu()` in `context-menu.js`, add a new menu item after "Copy JSON":

```javascript
_item(linkIcon, "Copy Chat Link", null, () => _callbacks.onCopyChatLink?.(buildId)),
```

### Callback wiring

In `library.js`, add a new callback `onCopyChatLink` that:
1. Looks up the build by ID from the builds list
2. Calls `window.desktopApi.generateChatLink(build)`
3. Copies the result to clipboard via `window.desktopApi.writeClipboardText(link)`

No visual feedback beyond the menu closing (consistent with other context menu actions).

### Icon

Use the Heroicons `link` icon (already in the icon set used by the context menu). Add a `linkIcon` export to `heroicons.js`.

## Dependencies

- `gw2buildlink` — npm install as a production dependency
- No new dev dependencies needed

## Testing

### Manual test plan

1. **Editor — basic build**: Open a Guardian build with specs/traits/skills set. Click "Chat Link". Verify `[&...]` string is copied to clipboard. Paste into GW2 chat and verify it loads correctly.
2. **Editor — empty build**: New build with no profession selected. Click "Chat Link". Verify error state shows briefly.
3. **Editor — Revenant**: Open a Revenant build with two legends selected. Generate chat link. Verify legends appear in-game.
4. **Editor — Ranger**: Open a Ranger build with pets selected. Generate chat link. Verify pets appear in-game.
5. **Editor — underwater skills**: Build with underwater skills set. Generate chat link. Verify aquatic skills encode.
6. **Library context menu**: Right-click a saved build in the library. Click "Copy Chat Link". Verify link is copied.
7. **Persistence**: Save a Revenant build with legends. Close and reopen the app. Right-click in library → Copy Chat Link. Verify legends are still included (tests the `normalizeBuild` fix).
8. **Offline**: Disconnect from internet. Click "Chat Link". Verify error state shows (not a crash).
