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
- Never call Electron-only APIs (`window.desktopApi.*`)
- Still build the same DOM structure, same CSS classes, same visual output

The flag defaults to `false`, so the desktop app is completely unaffected.

### Per-Module Guard Coverage

**skills.js:**

Suppressed (editing):
- No `openSlotPicker()` calls on skill slots
- No drag-to-swap event handlers on utility skills
- No `renderCustomSelect()` calls (line 903) — skill slot dropdowns skipped entirely
- No `_markEditorChanged()` or `_renderEditor()` callbacks

Preserved (navigation):
- Weapon swap button click handler — toggles `state.editor.activeWeaponSet` and re-renders to show the other set
- Attunement toggle click handlers — swap `state.editor.activeAttunement` and re-render
- These handlers mutate state and call `renderSkills()` (self re-render) but the `_renderEditor()` callback no-ops since it's never injected

**equipment.js:**
- No `openSlotPicker()` on armor/weapon/trinket/consumable slots
- No stat package dropdown
- No rune/sigil/infusion picker overlays
- No `_markEditorChanged()` calls
- No click handlers on `makeUpgradeBtn()` (line 237) — rune/sigil/infusion buttons render visually but are inert
- Slots render as static `div`s instead of interactive `button`s

**specializations.js:**
- No `renderCustomSelect()` call (line 161) — spec selector dropdown skipped entirely
- No trait click-to-select handlers
- Trait buttons render `disabled`
- Emblem button renders `disabled`

**custom-select.js:**
- Not called in `readOnly` mode — all `renderCustomSelect()` call sites in `skills.js` and `specializations.js` are guarded. No changes needed to `custom-select.js` itself.

**detail-panel.js:**
- `bindHoverPreview()` still works (read-only by nature — shows info on hover)
- `selectDetail()` (line 438) guarded: skip `window.desktopApi.getWikiSummary()` call and wiki/detail modal rendering when `readOnly` is true
- No detail-modal or wiki-modal rendering

**Transitive dependencies (unchanged, audited):**
- `boon-coverage.js` — imported by `skills.js` (line 18), pure computation, no catalog or API dependencies. Works as-is.
- `profession-icons.js` — imported by `equipment.js`, uses `?raw` Vite imports from `gw2-class-icons` npm package. Works in both Vite contexts since npm packages resolve from project root `node_modules`.
- `editor.js` — NOT imported by any of the 4 renderer modules. No action needed.

### Implementation Pattern

```js
// Guard interactive bindings:
if (!_readOnly) {
  btn.addEventListener("click", () => openSlotPicker(...));
}

// Skip entire interactive components:
if (!_readOnly) {
  renderCustomSelect(selectHost, { ... });
}

// Disable interactive elements:
btn.disabled = _readOnly || someOtherCondition;

// Skip callback calls:
if (!_readOnly && _markEditorChanged) _markEditorChanged();

// Guard Electron-only APIs:
if (!_readOnly) {
  wiki = await window.desktopApi.getWikiSummary(entity.name);
}
```

## State Mapping

The app renderers read from `state.editor` (global singleton). The SPA receives a flat `build` object from `serializeForPublish`. A thin adapter bridges these.

### Adapter Function

`populateStateFromBuild(build)` in `render-build.js` maps published build data onto the `state` shape:

```js
function populateStateFromBuild(build) {
  // Core identity
  state.editor.profession         = build.profession;
  state.editor.gameMode           = build.gameMode || "pve";

  // Equipment
  state.editor.equipment          = build.equipment;

  // Specializations
  state.editor.specializations    = build.specializations;

  // Skills — land
  state.editor.skills             = build.landSkills.skills;
  state.editor.weaponSkills       = build.landSkills.weaponSkills;
  state.editor.professionMechanics = build.landSkills.professionMechanics;
  state.editor.attunements        = build.landSkills.attunementSkills;
  state.editor.activeAttunement   = build.activeAttunement || "Fire";

  // Skills — water
  state.editor.waterSkills        = build.waterSkills;
  state.editor.underwaterMode     = false;

  // Weapon swap
  state.editor.activeWeaponSet    = 1;

  // Kit/mode state
  state.editor.activeKit          = 0;
  state.editor.morphSkillIds      = build.morphSkillIds || {};

  // Revenant legends — uses actual field names from skills.js
  state.editor.selectedLegends            = build.selectedLegends || [];
  state.editor.selectedUnderwaterLegends  = build.selectedUnderwaterLegends || [];
  state.editor.activeLegendSlot           = build.activeLegendSlot || 0;

  // Ranger pets — uses actual field structure from skills.js
  // (state.editor.selectedPets.terrestrial1, .terrestrial2, .aquatic1, .aquatic2)
  state.editor.selectedPets        = build.selectedPets || {};

  // Initialize non-editor state used by renderers
  state.renderedSkillIconIds      = new Map();
  state.openCustomSelect          = null;
}
```

**Note:** The exact field names and shapes must match what `skills.js`, `equipment.js`, and `specializations.js` actually read from `state.editor`. The pseudocode above uses the correct field names verified against the source. During implementation, audit each `state.editor.*` access in the render paths and ensure the adapter populates it.

### Active Catalog Reconstruction

The renderers read `state.activeCatalog` extensively in their **render paths** (not just for interactivity). `renderSkills()` returns early if `activeCatalog` is null. Key accesses:

- `catalog.skillById` — resolve F-skills, toolbelt skills, flip-skill chains, profession mechanics (skills.js: 30+ calls)
- `catalog.weaponSkillById` — weapon skill resolution (skills.js: line 178)
- `catalog.specializationById` — spec metadata and trait resolution (specializations.js: lines 141, 147, 186; skills.js: lines 348, 959)
- `catalog.traitById` — trait data for rendering (specializations.js: lines 31, 272; detail-panel.js: lines 319, 339)
- `catalog.specializations` — full spec list (specializations.js: line 140)
- `catalog.professionWeapons` — two-hand weapon detection, sigil counts (equipment.js: lines 418, 572) — **affects visual output, cannot be readOnly-guarded**
- `catalog.profession` — profession metadata (skills.js: lines 128, 627, 633)

**Approach:** Reconstruct `activeCatalog` as a stub from the enriched build data. `serializeForPublish` already embeds full skill/trait/spec objects with names, icons, descriptions, and facts. The adapter builds Maps from this embedded data:

```js
// Collect all skill objects from the serialized build
function collectAllSkills(build) {
  const skills = [];
  for (const source of [build.landSkills, build.waterSkills]) {
    if (!source) continue;
    const ws = source.weaponSkills || {};
    for (const set of [ws.set1, ws.set2, ws.aquatic1, ws.aquatic2]) {
      if (Array.isArray(set)) skills.push(...set);
    }
    if (Array.isArray(source.professionMechanics)) skills.push(...source.professionMechanics);
    const sk = source.skills || {};
    if (sk.heal) skills.push(sk.heal);
    if (Array.isArray(sk.utility)) skills.push(...sk.utility.filter(Boolean));
    if (sk.elite) skills.push(sk.elite);
    // Attunement skills (Elementalist)
    if (source.attunementSkills) {
      for (const att of Object.values(source.attunementSkills)) {
        if (Array.isArray(att.set1)) skills.push(...att.set1);
        if (Array.isArray(att.set2)) skills.push(...att.set2);
        if (Array.isArray(att.professionMechanics)) skills.push(...att.professionMechanics);
      }
    }
  }
  // Legend swap skills (Revenant)
  for (const legend of (build.legendDisplay || [])) {
    if (legend.swap) skills.push(legend.swap);
  }
  return skills.filter(s => s && s.id);
}

const allSkills = collectAllSkills(build);

state.activeCatalog = {
  profession: { id: build.profession },

  // Flat skills array — needed by skills.js render path for toolbelt detection
  // (catalog.skills.some(s => s.toolbeltSkill > 0)) and getSkillOptionsByType()
  skills: allSkills,

  // Skill lookup Maps — needed for F-skill chains, flip-skills, hover previews
  skillById: new Map(allSkills.map(s => [s.id, s])),
  weaponSkillById: new Map(
    allSkills.filter(s => s.slot?.startsWith("Weapon_")).map(s => [s.id, s])
  ),

  // Specialization data — built from build.specializations (already includes full trait objects)
  specializations: build.specializations,
  specializationById: new Map(
    build.specializations.map(s => [s.id, s])
  ),
  // Flat traits array — needed by skills.js line 391 (catalog.traits.filter(...))
  // for elite-spec trait-gated F-skill resolution
  traits: build.specializations.flatMap(s =>
    [...(s.minorTraits || []), ...(s.majorTraitsByTier || []).flat()]
  ).filter(t => t && t.id),

  traitById: new Map(
    build.specializations.flatMap(s =>
      [...(s.minorTraits || []), ...(s.majorTraitsByTier || []).flat()]
    ).filter(t => t && t.id).map(t => [t.id, t])
  ),

  // Legends (Revenant) — from build.legendDisplay, needed in render path
  // (catalog.legends.length > 0 determines legend UI visibility)
  // NOTE: serializeForPublish must include `swap` (legend-swap skill ID) in legendDisplay
  legends: (build.legendDisplay || []).map(l => ({
    id: l.id, name: l.name, icon: l.icon, swap: l.swap || null,
  })),
  legendById: new Map(
    (build.legendDisplay || []).map(l => [l.id, l])
  ),

  // Pets (Ranger) — from build.petDisplay, needed in render path
  // (catalog.pets.length > 0 determines pet UI visibility)
  pets: (build.petDisplay || []).map(p => ({
    id: p.id, name: p.name, icon: p.icon,
  })),
  petById: new Map(
    (build.petDisplay || []).map(p => [p.id, p])
  ),

  // Weapon metadata — must be added to serializeForPublish output
  professionWeapons: build.professionWeapons || {},
};
```

**New serialization fields (blocking prerequisites — must be implemented before the SPA can use shared renderers):**

`serializeForPublish` must add these fields to its output:
- `professionWeapons` — from the catalog. Weapon type metadata (one-hand vs two-hand, slot mappings). Without it, `equipment.js` renders wrong sigil counts and `skills.js` cannot resolve weapon skills at all (`getEquippedWeaponSkills()` returns all nulls).
- `legendDisplay[].swap` — the legend-swap skill object `{ id, name, icon }` for each Revenant legend. Without it, `skills.js` cannot render legend swap UI. The swap skill must also be collected by `collectAllSkills` so it appears in `catalog.skillById`.
- `selectedLegends`, `selectedUnderwaterLegends`, `activeLegendSlot` — Revenant legend slot state (skills.js reads these exact field names from `state.editor`).
- `selectedPets` — Ranger pet slot structure with `{ terrestrial1, terrestrial2, aquatic1, aquatic2 }` (skills.js reads `state.editor.selectedPets` with these exact keys).
- `morphSkillIds` — Evoker morph skill IDs (if applicable).

### Trait Button Click Guards

`specializations.js`'s `makeTraitButton()` (line 65) binds `onClick` handlers unconditionally. Since `disabled` on `<button>` elements does not reliably prevent JS click listeners from firing, the `readOnly` guard is applied at the call site: pass `null` as `onClick` when `_readOnly` is true. This prevents both `selectDetail()` calls and state-mutating trait selection from firing. Same pattern for emblem click handlers.

### Upgrade Catalog Stub

```js
state.upgradeCatalog = {
  runeById:       new Map(/* from build.equipmentDisplay.runes — map id → item */),
  sigilById:      new Map(/* from build.equipmentDisplay.sigils */),
  infusionById:   new Map(/* from build.equipmentDisplay.infusions */),
  enrichmentById: new Map(/* from build.equipmentDisplay — if present */),
  foodById:       new Map(/* from build.equipmentDisplay.food */),
  utilityById:    new Map(/* from build.equipmentDisplay.utility */),
  // foods/utilities arrays are only needed for picker item lists — guard behind readOnly
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
       │    └─ bindHoverPreview wires hover → reference panel
       │
       ├─ EQUIPMENT tab:
       │    ├─ initEquipment({ equipmentPanel })
       │    └─ renderEquipmentPanel()
       │
       └─ Tab switching logic
```

No `initXxxCallbacks()` calls needed. Since `readOnly` is true, renderers never try to call `markEditorChanged`, `renderEditor`, etc. Callbacks are simply never injected; any callback checks naturally no-op.

### Reference Panel

The reference panel is SPA-specific UI — the desktop app uses `selectDetail()` to show info in a detail panel on click, while the SPA shows a sticky sidebar updated on hover. `render-reference.js` is kept as a thin SPA-only wrapper that listens for hover events and displays the hovered entity's data. It consumes `bindHoverPreview` from the shared `detail-panel.js` for tooltip behavior.

## File Changes

### Deleted
- `src/site/render-skills.js`
- `src/site/render-specs.js`
- `src/site/render-equipment.js`
- `src/site/render-detail.js`

### Kept (SPA-specific)
- `src/site/render-reference.js` — SPA-only reference panel, consumes shared hover preview system

### Modified
- `src/renderer/modules/skills.js` — add `readOnly` flag + guards
- `src/renderer/modules/equipment.js` — add `readOnly` flag + guards
- `src/renderer/modules/specializations.js` — add `readOnly` flag + guards
- `src/renderer/modules/detail-panel.js` — add `readOnly` flag + guards (especially `selectDetail`)
- `src/site/render-build.js` — rewrite: import real renderers, add `populateStateFromBuild()` adapter
- `src/site/main.js` — import `setReadOnly`, call during init
- `src/site/styles.css` — remove overrides compensating for rendering differences (keep navbar, tabs, landing)
- `src/main/buildPublish.js` — revert `RELIC_BY_LABEL` hack (relic resolution goes through shared renderer); add `professionWeapons` to serialized output

### Unchanged
- `src/site/index.html` — keep inline SVG logo fix
- All `src/renderer/styles/*.css` — untouched (SPA already imports them via `@import` in `styles.css`)
- `src/renderer/renderer.js` — app orchestrator, untouched
- `src/renderer/modules/state.js` — SPA imports and populates it
- `src/renderer/modules/constants.js` — SPA can import if needed
- `src/renderer/modules/custom-select.js` — not called in readOnly mode, no changes needed
- `src/renderer/modules/boon-coverage.js` — pure computation, works as-is
- `src/renderer/modules/profession-icons.js` — `?raw` SVG imports work in both Vite contexts
- `src/renderer/modules/editor.js` — not imported by renderers, no action needed
- `src/renderer/modules/detail-modal.js` — injected via callback, not statically imported by SPA
- `src/renderer/modules/wiki-modal.js` — injected via callback, not statically imported by SPA

### CSS Strategy

The SPA already imports all desktop CSS via `@import` directives in `src/site/styles.css`:
```css
@import "../renderer/styles/base.css";
@import "../renderer/styles/layout.css";
/* ... 7 more desktop CSS files ... */
```
This is unchanged. Since the SPA now renders the same DOM as the app, the same CSS classes apply automatically. SPA-specific styles (navbar, tabs, landing page, reference panel sticky positioning) remain in `styles.css`.

## Risks

**Catalog access gaps:** A renderer may read `state.activeCatalog` in a way that the enriched build data doesn't cover. Mitigated by auditing each catalog access during implementation and either populating the stub or guarding behind `if (!_readOnly)`.

**Electron API calls:** `detail-panel.js` calls `window.desktopApi.getWikiSummary()` in `selectDetail()`. Mitigated by guarding behind `if (!_readOnly)`. Any other `window.desktopApi` calls must be audited and guarded similarly.

**Vite `?raw` imports:** `profession-icons.js` uses `import ... from "gw2-class-icons/...?raw"`. This works in both the desktop Vite build and the SPA Vite build since `gw2-class-icons` resolves from the project root's `node_modules`. Verified that the SPA's Vite config does not restrict module resolution.

**State initialization:** The adapter must initialize `state.renderedSkillIconIds = new Map()` and `state.openCustomSelect = null` to prevent stale state from causing subtle bugs (unnecessary animations, undefined property access).

## Testing

- Build the SPA (`npm run build:site`), open a published build, visually compare against the same build in the app
- Verify the app still works identically — `readOnly` defaults to `false`, so no behavior change unless explicitly set
- Test across professions: Elementalist (attunements), Revenant (legends), Ranger (pets), standard professions
- Test weapon swap and attunement toggle work as read-only navigation in the SPA
- Verify no console errors from `window.desktopApi` or missing catalog lookups
