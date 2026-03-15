# Shared Rendering: SPA Imports App Renderers with `readOnly` Flag

**Date:** 2026-03-15
**Status:** Approved

## Problem

The SPA (`src/site/`) and desktop app (`src/renderer/`) maintain two separate rendering codebases that produce the same visual output. They drift apart — the SPA has relic bugs, missing weapon swap buttons, different consumable layouts, and other discrepancies. Every future app change requires a manual SPA update.

## Solution

The SPA imports the app's actual renderer modules (`skills.js`, `equipment.js`, `specializations.js`, `detail-panel.js`) from `src/renderer/modules/`. A `readOnly` flag disables all interactive behavior (pickers, drag handlers, editing callbacks) while preserving identical DOM output.

## Core Mechanism

### readOnly Flag

Each renderer module gains a module-level boolean and setter:

```js
let _readOnly = false;
export function setReadOnly(val) { _readOnly = val; }
```

When `_readOnly` is true, renderers:
- Skip binding click/drag/change event handlers
- Skip creating picker overlays, custom selects, drag handles
- Render interactive elements as `disabled`
- Never call injected callbacks (`markEditorChanged`, `renderEditor`, etc.)
- Still build the same DOM structure, same CSS classes, same visual output

The flag defaults to `false`, so the desktop app is completely unaffected.

### Per-Module Guard Coverage

**skills.js:**
- No `openSlotPicker()` calls on skill slots
- No drag-to-swap event handlers on utility skills
- No weapon swap click handler (button renders disabled but visible)
- No attunement/legend/pet click-to-select handlers
- Attunement toggle and weapon swap button still work for viewing different sets (read-only navigation)

**equipment.js:**
- No `openSlotPicker()` on armor/weapon/trinket/consumable slots
- No stat package dropdown
- No rune/sigil/infusion picker overlays
- No `_markEditorChanged()` calls
- Slots render as static `div`s instead of interactive `button`s

**specializations.js:**
- No spec selector overlay (custom-select dropdown)
- No trait click-to-select handlers
- Trait buttons render `disabled`
- Emblem button renders `disabled`

**detail-panel.js:**
- `bindHoverPreview()` still works (read-only by nature)
- No "click to open wiki modal" behavior
- No detail-modal rendering

### Implementation Pattern

```js
// Guard interactive bindings:
if (!_readOnly) {
  btn.addEventListener("click", () => openSlotPicker(...));
}

// Disable interactive elements:
btn.disabled = _readOnly || someOtherCondition;

// Skip callback calls:
if (!_readOnly && _markEditorChanged) _markEditorChanged();
```

## State Mapping

The app renderers read from `state.editor` (global singleton). The SPA receives a flat `build` object from `serializeForPublish`. A thin adapter bridges these.

### Adapter Function

`populateStateFromBuild(build)` in `render-build.js` maps published build data onto the `state` shape:

```js
function populateStateFromBuild(build) {
  state.editor.profession         = build.profession;
  state.editor.elite              = build.eliteSpec;
  state.editor.equipment          = build.equipment;
  state.editor.specializations    = build.specializations;
  state.editor.skills             = build.landSkills.skills;
  state.editor.weaponSkills       = build.landSkills.weaponSkills;
  state.editor.professionMechanics = build.landSkills.professionMechanics;
  state.editor.attunements        = build.landSkills.attunementSkills;
  state.editor.waterSkills        = build.waterSkills;
  state.editor.legends            = /* from build.legendDisplay */;
  state.editor.pets               = /* from build.petDisplay */;
  // etc.
}
```

### Catalog Stub

Renderers also read `state.activeCatalog` and `state.upgradeCatalog`. Since `serializeForPublish` already enriches the build with all resolved data (skill icons, trait objects, computed stats, equipment display), we populate minimal stubs from the enriched data:

```js
state.upgradeCatalog = {
  runeById:    new Map(/* from build.equipmentDisplay.runes */),
  sigilById:   new Map(/* from build.equipmentDisplay.sigils */),
  foodById:    new Map(/* from build.equipmentDisplay.food */),
  // etc.
};
```

Where a renderer does a catalog lookup only for interactive features (e.g., listing available specs to swap to), it's guarded behind `if (!_readOnly)`.

`serializeForPublish` is the single source of truth for what data the SPA can display. If something isn't serialized, it won't render.

## SPA Bootstrap Flow

```
main.js: init()
  ├─ Parse URL hash, fetch & decrypt build blob
  ├─ Import renderer modules from ../../renderer/modules/
  ├─ Call setReadOnly(true) on each module
  │
  └─ render-build.js: renderBuildPage(container, build)
       ├─ Build header (title, profession icon, tags)
       ├─ Build tab bar (BUILD / EQUIPMENT)
       │
       ├─ populateStateFromBuild(build)
       │
       ├─ BUILD tab:
       │    ├─ initSkills({ skillsHost })
       │    ├─ renderSkills()
       │    ├─ initSpecializations({ specializationsHost })
       │    ├─ renderSpecializations()
       │    ├─ initDetailPanel({ detailHost, hoverPreview })
       │    └─ Wire hover → reference panel
       │
       ├─ EQUIPMENT tab:
       │    ├─ initEquipment({ equipmentPanel })
       │    └─ renderEquipmentPanel()
       │
       └─ Tab switching logic
```

No `initXxxCallbacks()` calls needed. Since `readOnly` is true, renderers never try to call `markEditorChanged`, `renderEditor`, etc. Callbacks are simply never injected; any callback checks naturally no-op.

## File Changes

### Deleted
- `src/site/render-skills.js`
- `src/site/render-specs.js`
- `src/site/render-equipment.js`
- `src/site/render-detail.js`
- `src/site/render-reference.js`

### Modified
- `src/renderer/modules/skills.js` — add `readOnly` flag + guards
- `src/renderer/modules/equipment.js` — add `readOnly` flag + guards
- `src/renderer/modules/specializations.js` — add `readOnly` flag + guards
- `src/renderer/modules/detail-panel.js` — add `readOnly` flag + guards
- `src/site/render-build.js` — rewrite: import real renderers, add `populateStateFromBuild()` adapter
- `src/site/main.js` — import `setReadOnly`, call during init
- `src/site/styles.css` — remove overrides compensating for rendering differences (keep navbar, tabs, landing)
- `src/main/buildPublish.js` — revert `RELIC_BY_LABEL` hack (relic resolution goes through shared renderer)

### Unchanged
- `src/site/index.html` — keep inline SVG logo fix
- All `src/renderer/styles/*.css` — untouched
- `src/renderer/renderer.js` — app orchestrator, untouched
- `src/renderer/modules/state.js` — SPA imports and populates it
- `src/renderer/modules/constants.js` — SPA can import if needed

## Risks

**Catalog access gaps:** A renderer may read `state.activeCatalog` in a way that the enriched build data doesn't cover. Mitigated by auditing each catalog access during implementation and either populating the stub or guarding behind `if (!_readOnly)`.

**Renderer side effects:** Some renderer code may assume Electron APIs or app-specific globals. Mitigated by testing the SPA build and fixing any runtime errors.

## Testing

- Build the SPA (`npm run build:site`), open a published build, visually compare against the same build in the app
- Verify the app still works identically — `readOnly` defaults to `false`, so no behavior change unless explicitly set
- Test across professions: Elementalist (attunements), Revenant (legends), Ranger (pets), standard professions
