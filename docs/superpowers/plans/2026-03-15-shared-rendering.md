# Shared Rendering Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SPA imports the app's actual renderer modules with a `readOnly` flag, guaranteeing 1:1 visual parity between the desktop app and web view.

**Architecture:** Add a module-level `_readOnly` boolean to each renderer module (`skills.js`, `equipment.js`, `specializations.js`, `detail-panel.js`). When true, interactive behavior (pickers, drag, callbacks, Electron APIs) is suppressed. The SPA imports these modules, populates `state` from the serialized build, and calls the same render functions.

**Tech Stack:** Vanilla JS (ESM), Vite, imperative DOM

**Spec:** `docs/superpowers/specs/2026-03-15-shared-rendering-design.md`

---

## File Structure

**Modified (renderer modules — add readOnly guards):**
- `src/renderer/modules/detail-panel.js` — guard `selectDetail()`, `initDetailPanel()` click handlers
- `src/renderer/modules/specializations.js` — guard `renderCustomSelect`, trait/emblem clicks
- `src/renderer/modules/equipment.js` — guard all `openSlotPicker`, `makeUpgradeBtn` clicks, `_markEditorChanged`
- `src/renderer/modules/skills.js` — guard drag handlers, pickers, `renderCustomSelect`, preserve weapon swap + attunement toggle

**Modified (serialization):**
- `src/main/buildPublish.js` — add `professionWeapons` and `legendDisplay[].swap` to output; revert `RELIC_BY_LABEL` hack

**Rewritten (SPA):**
- `src/site/render-build.js` — import real renderers, add `populateStateFromBuild()` adapter
- `src/site/main.js` — import and call `setReadOnly(true)`

**Cleaned up (SPA):**
- `src/site/styles.css` — remove rendering-difference overrides

**Deleted (SPA — replaced by shared renderers):**
- `src/site/render-skills.js`
- `src/site/render-specs.js`
- `src/site/render-equipment.js`
- `src/site/render-detail.js`

**Kept (SPA-specific):**
- `src/site/render-reference.js` — SPA-only sticky reference panel

---

## Chunk 1: Serialization Prerequisites

These changes to `buildPublish.js` must land first — the shared renderers depend on this data.

### Task 1: Add `professionWeapons` to serialized output

**Files:**
- Modify: `src/main/buildPublish.js:529-546`

- [ ] **Step 1: Add `professionWeapons` to the return object**

In `serializeForPublish()`, `professionWeapons` is already available as a local variable (line 397: `const professionWeapons = catalog?.professionWeapons || {};`). Add it to the return object at line 529:

```js
  return {
    ...build,
    weaponSkills,
    professionMechanics: filteredMechanics,
    landSkills: result_landSkills,
    waterSkills: result_waterSkills,
    activeAttunement,
    professionIcon,
    petDisplay,
    legendDisplay,
    equipmentDisplay,
    equipmentIcons,
    computedStats,
    statModifiers,
    professionWeapons,   // ← ADD THIS
  };
```

- [ ] **Step 2: Verify app still builds**

Run: `npm run build:site`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/buildPublish.js
git commit -m "feat: include professionWeapons in serialized publish output"
```

### Task 2: Add `swap` skill object to `legendDisplay` entries

**Files:**
- Modify: `src/main/buildPublish.js:509-521`

- [ ] **Step 1: Include the full swap skill object in legendDisplay**

Currently (lines 509-521), `legendDisplay` only includes `{ id, name, icon }` where `icon` comes from the swap skill. Change it to also include the full swap skill object:

```js
  const legendDisplay = selectedLegends
    .filter(Boolean)
    .map((legendId) => {
      const legend = legendsArray.find((l) => l.id === legendId);
      if (!legend) return { id: legendId, name: "", icon: "", swap: null };
      const swapSkill = skillsArray.find((s) => s.id === legend.swap);
      return {
        id: legend.id,
        name: legend.name || "",
        icon: swapSkill?.icon || "",
        swap: swapSkill ? { id: swapSkill.id, name: swapSkill.name, icon: swapSkill.icon } : null,
      };
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/main/buildPublish.js
git commit -m "feat: include legend swap skill object in legendDisplay"
```

### Task 3: Revert RELIC_BY_LABEL hack

**Files:**
- Modify: `src/main/buildPublish.js:70-157, 286`

- [ ] **Step 1: Remove `RELIC_BY_LABEL` map and `resolveRelicByLabel` function**

Delete the `RELIC_BY_LABEL` constant (lines 70-137) and the `resolveRelicByLabel` function (lines 146-157).

- [ ] **Step 2: Restore relic resolution to use `resolveId` with a note**

Change line 286 back from `resolveRelicByLabel(equipment.relic)` to the original, but fix the lookup map. Since relics are stored by label (not numeric ID), and there's no `relicById` map in the upgrade catalog, resolve relic by looking up the label in a by-name map instead:

```js
    relic: resolveByName(equipment.relic, upgradeCatalog),
```

Add a helper function near `resolveId`:

```js
  function resolveByName(label, catalog) {
    if (!label || !catalog) return null;
    // Relics are stored by label string, not numeric ID.
    // Search runes/sigils/food/utility arrays as a fallback,
    // but primarily use the constants from the renderer.
    // For now, just pass through the label — the shared renderer
    // will resolve the icon from GW2_RELICS_BY_LABEL in constants.js.
    return { name: label, icon: "" };
  }
```

**Note:** This is a temporary measure. Once the SPA uses the shared `equipment.js` renderer, relic display goes through `GW2_RELICS_BY_LABEL` in `constants.js` (same as the desktop app), making this resolution unnecessary. The empty icon is fine because `equipment.js` does its own icon lookup from `GW2_RELICS_BY_LABEL`.

- [ ] **Step 3: Commit**

```bash
git add src/main/buildPublish.js
git commit -m "fix: revert RELIC_BY_LABEL hack, relic resolved via shared renderer"
```

---

## Chunk 2: readOnly Guards — detail-panel.js and specializations.js

Start with the simpler modules that have fewer guard points.

### Task 4: Add readOnly flag to detail-panel.js

**Files:**
- Modify: `src/renderer/modules/detail-panel.js`

- [ ] **Step 1: Add the readOnly flag and setter at module top**

After the existing imports (around line 5), add:

```js
let _readOnly = false;
export function setReadOnly(val) { _readOnly = val; }
```

- [ ] **Step 2: Guard `initDetailPanel` click handlers**

In `initDetailPanel()` (line 52), the click handlers at lines 57 and 63 open wiki modal / expand detail modal. Wrap them:

```js
  if (!_readOnly) {
    _el.detailHost.addEventListener("click", (e) => { /* existing wiki link handler */ });
    _el.expandBtn.addEventListener("click", () => { /* existing expand handler */ });
  }
```

- [ ] **Step 3: Guard `selectDetail` Electron API call**

In `selectDetail()` (line 416), guard the `window.desktopApi.getWikiSummary` call at line 438:

```js
  if (_readOnly) return;  // ← Add at top of selectDetail
```

Since `selectDetail` is only called from click handlers that are themselves guarded in other modules, this is a safety net.

- [ ] **Step 4: Verify app still works**

Run the app (`npm run dev`), hover over skills/traits — hover preview should still work. Click a trait — detail panel should still show.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/detail-panel.js
git commit -m "feat: add readOnly flag to detail-panel.js"
```

### Task 5: Add readOnly flag to specializations.js

**Files:**
- Modify: `src/renderer/modules/specializations.js`

- [ ] **Step 1: Add the readOnly flag and setter**

After imports, add:

```js
let _readOnly = false;
export function setReadOnly(val) { _readOnly = val; }
```

- [ ] **Step 2: Guard `renderCustomSelect` call**

At line 161, wrap the `renderCustomSelect` call:

```js
  if (!_readOnly) {
    renderCustomSelect(selectHost, { /* existing options */ });
  }
```

- [ ] **Step 3: Guard trait button onClick handlers**

In `renderSpecializations()`, where `makeTraitButton` is called for minor traits (around line 278) and major traits (around line 303), pass `null` as `onClick` when readOnly:

For minor traits:
```js
  const onClick = _readOnly ? null : () => selectDetail("trait", minorTrait);
  makeTraitButton(minorTrait, true, onClick, { /* options */ });
```

For major traits:
```js
  const onClick = _readOnly ? null : () => { /* existing trait selection + markEditorChanged logic */ };
  makeTraitButton(trait, isActive, onClick, { /* options */ });
```

- [ ] **Step 4: Guard emblem click handler**

At line 260, wrap the emblem click handler:

```js
  if (!_readOnly) {
    emblem.addEventListener("click", () => { /* existing handler */ });
  }
  emblem.disabled = _readOnly;
```

- [ ] **Step 5: Verify app works — spec cards render, trait clicks work**

Run the app, open a build, verify specializations render correctly and trait selection still works.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/specializations.js
git commit -m "feat: add readOnly flag to specializations.js"
```

---

## Chunk 3: readOnly Guards — equipment.js

### Task 6: Add readOnly flag to equipment.js

**Files:**
- Modify: `src/renderer/modules/equipment.js`

- [ ] **Step 1: Add the readOnly flag and setter**

After imports, add:

```js
let _readOnly = false;
export function setReadOnly(val) { _readOnly = val; }
```

- [ ] **Step 2: Guard `makeUpgradeBtn` click handler**

At line 237, wrap the click handler:

```js
  if (!_readOnly) {
    btn.addEventListener("click", (e) => { /* existing openSlotPicker handler */ });
  }
```

- [ ] **Step 3: Guard armor slot interactions**

In the armor rendering section, guard all `wrapper.addEventListener("click", doOpen)` calls (lines 344-345) and the stat combo `openSlotPicker` call (line 339):

```js
  if (!_readOnly) {
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { /* existing */ });
  }
```

- [ ] **Step 4: Guard weapon slot interactions**

Guard the weapon picker `addEventListener` calls at lines 506 and 532:

```js
  if (!_readOnly) {
    weaponBtn.addEventListener("click", () => { openSlotPicker(/* existing */); });
  }
```

And the armor stat picker at line 553:

```js
  if (!_readOnly) {
    statBtn.addEventListener("click", () => { openSlotPicker(/* existing */); });
  }
```

- [ ] **Step 5: Guard section header buttons (fill, clear)**

Guard the fill button (line 693), clear button (line 733), and clear-all button (line 755):

```js
  if (_readOnly) return null;  // Skip creating fill/clear buttons entirely
```

Or wrap their event listeners individually. The simpler approach: skip creating the section header action buttons when readOnly.

- [ ] **Step 6: Guard trinket slot interactions**

Guard the trinket combo click handlers at lines 879-880:

```js
  if (!_readOnly) {
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { /* existing */ });
  }
```

- [ ] **Step 7: Guard relic slot interactions**

Guard the relic click handlers at lines 1043-1044:

```js
  if (!_readOnly) {
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { /* existing */ });
  }
```

- [ ] **Step 8: Guard consumable slot interactions**

Guard food/utility slot interactions with the same pattern.

- [ ] **Step 9: Guard notes textarea**

Guard the notes textarea input handler at line 914:

```js
  if (_readOnly) {
    notesTA.readOnly = true;
  } else {
    notesTA.addEventListener("input", () => { /* existing */ });
  }
```

- [ ] **Step 10: Verify app works — equipment panel renders, all pickers work**

Run the app, open a build, verify equipment renders correctly and all slot pickers still open.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "feat: add readOnly flag to equipment.js"
```

---

## Chunk 4: readOnly Guards — skills.js

The largest module with the most guard points.

### Task 7: Add readOnly flag to skills.js

**Files:**
- Modify: `src/renderer/modules/skills.js`

- [ ] **Step 1: Add the readOnly flag and setter**

After imports, add:

```js
let _readOnly = false;
export function setReadOnly(val) { _readOnly = val; }
```

- [ ] **Step 2: Guard `renderCustomSelect` call**

At line 903, wrap the `renderCustomSelect` call:

```js
  if (!_readOnly) {
    renderCustomSelect(selectHost, { /* existing options */ });
  }
```

- [ ] **Step 3: Guard drag-and-drop handlers**

Guard the drag handlers at lines 845, 852, 861, 868, 874:

```js
  if (!_readOnly) {
    iconBtn.addEventListener("dragstart", (e) => { /* existing */ });
    iconBtn.addEventListener("dragend", () => { /* existing */ });
    slotEl.addEventListener("dragover", (e) => { /* existing */ });
    slotEl.addEventListener("dragleave", (e) => { /* existing */ });
    slotEl.addEventListener("drop", (e) => { /* existing */ });
  }
  iconBtn.draggable = !_readOnly;
```

- [ ] **Step 4: Guard skill slot pickers**

Guard `_openSlotPicker` calls at lines 1429, 1692, 1714:

```js
  if (!_readOnly) {
    _openSlotPicker(iconBtn, /* existing args */);
  }
```

- [ ] **Step 5: Guard editing click handlers**

Guard all click handlers that mutate state + call `_markEditorChanged`:
- Line 832: badge toggle
- Line 953: icon click (opens picker)
- Line 992: container click (renderEditor)
- Line 1374: roll badge
- Line 1395: toggle badge
- Line 1410: icon click handler
- Line 1520: pet picker
- Line 1535: pet swap
- Line 1579: button click

For each: `if (!_readOnly) { btn.addEventListener("click", ...) }`

- [ ] **Step 6: Guard selectDetail click handlers**

Guard the `selectDetail` calls at lines 1231, 1439, 1443:

```js
  if (!_readOnly) {
    iconBtn.addEventListener("click", () => selectDetail(/* existing */));
  }
```

- [ ] **Step 7: Preserve weapon swap navigation**

The weapon swap handler at line 1617 should KEEP working in readOnly mode. It toggles `state.editor.activeWeaponSet` and re-renders. Do NOT guard this one — but DO guard the `_markEditorChanged` call inside it:

```js
  swapBtn.addEventListener("click", () => {
    state.editor.activeWeaponSet = state.editor.activeWeaponSet === 1 ? 2 : 1;
    renderSkills();
    if (!_readOnly && _markEditorChanged) _markEditorChanged();
  });
```

- [ ] **Step 8: Preserve attunement toggle navigation**

Similar to weapon swap — attunement toggle handlers should keep working for viewing. Guard only the `_markEditorChanged` and `_enforceEditorConsistency` calls inside them.

- [ ] **Step 9: Verify app works — full skills bar renders, all interactions work**

Run the app, test:
- Weapon swap works
- Attunement toggle works (Elementalist)
- Skill slot pickers open
- Drag-and-drop works
- F-skill details show

- [ ] **Step 10: Commit**

```bash
git add src/renderer/modules/skills.js
git commit -m "feat: add readOnly flag to skills.js"
```

---

## Chunk 5: SPA Integration

### Task 8: Rewrite render-build.js — import real renderers + state adapter

**Files:**
- Rewrite: `src/site/render-build.js`

- [ ] **Step 1: Write `collectAllSkills` helper**

This collects every skill object from the serialized build so we can build `catalog.skillById`:

```js
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
    if (source.attunementSkills) {
      for (const att of Object.values(source.attunementSkills)) {
        if (Array.isArray(att.set1)) skills.push(...att.set1);
        if (Array.isArray(att.set2)) skills.push(...att.set2);
        if (Array.isArray(att.professionMechanics)) skills.push(...att.professionMechanics);
      }
    }
  }
  for (const legend of (build.legendDisplay || [])) {
    if (legend.swap) skills.push(legend.swap);
  }
  return skills.filter(s => s && s.id);
}
```

- [ ] **Step 2: Write `populateStateFromBuild` adapter**

This maps the flat published build onto `state.editor`, `state.activeCatalog`, and `state.upgradeCatalog`:

```js
function populateStateFromBuild(build) {
  // ── state.editor ──
  state.editor.profession              = build.profession;
  state.editor.gameMode                = build.gameMode || "pve";
  state.editor.equipment               = build.equipment;
  state.editor.specializations         = build.specializations;
  state.editor.skills                  = build.landSkills?.skills || {};
  state.editor.weaponSkills            = build.landSkills?.weaponSkills || {};
  state.editor.professionMechanics     = build.landSkills?.professionMechanics || [];
  state.editor.attunements             = build.landSkills?.attunementSkills || null;
  state.editor.activeAttunement        = build.activeAttunement || "Fire";
  state.editor.underwaterSkills        = build.waterSkills || null;
  state.editor.underwaterMode          = false;
  state.editor.activeWeaponSet         = 1;
  state.editor.activeKit               = 0;
  state.editor.morphSkillIds           = build.morphSkillIds || [0, 0, 0];
  state.editor.selectedLegends         = build.selectedLegends || [];
  state.editor.selectedUnderwaterLegends = build.selectedUnderwaterLegends || [];
  state.editor.activeLegendSlot        = build.activeLegendSlot || 0;
  state.editor.selectedPets            = build.selectedPets || {};
  state.editor.notes                   = build.notes || "";
  state.renderedSkillIconIds           = new Map();
  state.openCustomSelect               = null;

  // ── state.activeCatalog ──
  const allSkills = collectAllSkills(build);
  const allTraits = (build.specializations || []).flatMap(s =>
    [...(s.minorTraits || []), ...(s.majorTraitsByTier || []).flat()]
  ).filter(t => t && t.id);

  state.activeCatalog = {
    profession:         { id: build.profession },
    skills:             allSkills,
    skillById:          new Map(allSkills.map(s => [s.id, s])),
    weaponSkillById:    new Map(allSkills.filter(s => s.slot?.startsWith("Weapon_")).map(s => [s.id, s])),
    specializations:    build.specializations || [],
    specializationById: new Map((build.specializations || []).map(s => [s.id, s])),
    traits:             allTraits,
    traitById:          new Map(allTraits.map(t => [t.id, t])),
    legends:            (build.legendDisplay || []).map(l => ({
      id: l.id, name: l.name, icon: l.icon, swap: l.swap?.id || null,
    })),
    legendById:         new Map((build.legendDisplay || []).map(l => [l.id, {
      id: l.id, name: l.name, icon: l.icon, swap: l.swap?.id || null,
    }])),
    pets:               (build.petDisplay || []).map(p => ({ id: p.id, name: p.name, icon: p.icon })),
    petById:            new Map((build.petDisplay || []).map(p => [p.id, p])),
    professionWeapons:  build.professionWeapons || {},
  };

  // ── state.upgradeCatalog ──
  const eqd = build.equipmentDisplay || {};
  // Build Maps from the resolved display objects. Each value is { id, name, icon }.
  // Runes: eqd.runes is { head: { id, name, icon }, shoulders: ... }
  const runeEntries = Object.values(eqd.runes || {}).filter(Boolean);
  const sigilEntries = Object.values(eqd.sigils || {}).flat().filter(Boolean);
  const infusionEntries = Object.values(eqd.infusions || {}).flat().filter(Boolean);

  state.upgradeCatalog = {
    runeById:       new Map(runeEntries.map(r => [r.id, r])),
    sigilById:      new Map(sigilEntries.map(s => [s.id, s])),
    infusionById:   new Map(infusionEntries.map(i => [i.id, i])),
    enrichmentById: new Map(eqd.enrichment ? [[eqd.enrichment.id, eqd.enrichment]] : []),
    foodById:       new Map(eqd.food ? [[eqd.food.id, eqd.food]] : []),
    utilityById:    new Map(eqd.utility ? [[eqd.utility.id, eqd.utility]] : []),
  };
}
```

- [ ] **Step 3: Write `renderBuildPage` function**

The main orchestrator. Creates DOM containers that match what each renderer's `init*` function expects:

```js
import { state } from "../../renderer/modules/state.js";
import { initSkills, renderSkills } from "../../renderer/modules/skills.js";
import { initSpecializations, renderSpecializations } from "../../renderer/modules/specializations.js";
import { initEquipment, renderEquipmentPanel } from "../../renderer/modules/equipment.js";
import { initDetailPanel, bindHoverPreview } from "../../renderer/modules/detail-panel.js";
import { initReferencePanel, updateReferencePanel } from "./render-reference.js";
import { escapeHtml } from "./main.js";

export function renderBuildPage(container, build) {
  container.innerHTML = "";

  // ── Build header (SPA-specific) ──
  // ... same as current: profession icon, title, meta, tags ...

  // ── Tab bar (SPA-specific) ──
  // ... same as current: BUILD / EQUIPMENT buttons ...

  // ── Populate state from serialized build ──
  populateStateFromBuild(build);

  // ── BUILD tab content ──
  const buildContent = document.createElement("div");
  buildContent.className = "site-tab-content site-tab-content--active";

  // Skills bar — container must match initSkills({ skillsHost }) expectation
  const skillsSection = document.createElement("section");
  skillsSection.className = "panel panel--skillbar";
  const skillsHost = document.createElement("div");
  skillsHost.className = "skills-host";
  skillsSection.append(skillsHost);
  buildContent.append(skillsSection);

  initSkills({ skillsHost });
  renderSkills();

  // Specs + detail side-by-side
  const specsWithDetail = document.createElement("div");
  specsWithDetail.className = "specs-with-detail";

  const specsPanel = document.createElement("section");
  specsPanel.className = "panel specs-panel";
  const specsSectionHead = document.createElement("div");
  specsSectionHead.className = "section-head";
  const specsHeading = document.createElement("h2");
  specsHeading.textContent = "Specializations";
  specsSectionHead.append(specsHeading);
  specsPanel.append(specsSectionHead);
  const specializationsHost = document.createElement("div");
  specializationsHost.className = "specializations-host";
  specsPanel.append(specializationsHost);

  initSpecializations({ specializationsHost });
  renderSpecializations();

  // Detail/reference panel
  const detailPanel = document.createElement("section");
  detailPanel.className = "panel detail-panel";
  const detailSectionHead = document.createElement("div");
  detailSectionHead.className = "section-head";
  const detailHeading = document.createElement("h2");
  detailHeading.textContent = "Reference Panel";
  detailSectionHead.append(detailHeading);
  detailPanel.append(detailSectionHead);

  // Create DOM refs for detail panel
  const detailHost = document.createElement("div");
  detailHost.id = "detailHost";
  const hoverPreview = document.createElement("div");
  hoverPreview.className = "hover-preview spa-tooltip";
  detailPanel.append(detailHost);
  document.body.append(hoverPreview);

  initDetailPanel({ detailHost, hoverPreview, expandBtn: document.createElement("button") });
  initReferencePanel(detailPanel);

  specsWithDetail.append(specsPanel, detailPanel);
  buildContent.append(specsWithDetail);

  // Notes
  if (build.notes) {
    const notesHeading = document.createElement("h2");
    notesHeading.className = "site-section-heading";
    notesHeading.textContent = "Notes";
    buildContent.append(notesHeading);
    const notesEl = document.createElement("div");
    notesEl.className = "site-notes";
    notesEl.textContent = build.notes;
    buildContent.append(notesEl);
  }

  // Wire hover → reference panel
  buildContent.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-name][data-icon]");
    if (!target) return;
    let facts = [];
    try { facts = JSON.parse(target.dataset.facts || "[]"); } catch { /* ignore */ }
    updateReferencePanel({
      name: target.dataset.name || "",
      icon: target.dataset.icon || "",
      description: target.dataset.desc || "",
      meta: target.dataset.meta || "",
      facts,
    });
  });

  // ── EQUIPMENT tab content ──
  const equipContent = document.createElement("div");
  equipContent.className = "site-tab-content";
  const equipmentPanel = document.createElement("div");
  equipContent.append(equipmentPanel);

  initEquipment({ equipmentPanel });
  renderEquipmentPanel();

  container.append(buildContent, equipContent);

  // ── Tab switching (SPA-specific) ──
  // ... same as current ...
}
```

**DOM refs each `init*` expects** (verified from source):
- `initSkills({ skillsHost })` — a container div to render into
- `initSpecializations({ specializationsHost })` — a container div
- `initEquipment({ equipmentPanel })` — a container div
- `initDetailPanel({ detailHost, hoverPreview, expandBtn })` — detail container, hover tooltip element, expand button (can be a dummy element in SPA)

- [ ] **Step 4: Verify the SPA builds**

Run: `npm run build:site`
Expected: Build succeeds (may have runtime errors, but compilation should pass).

- [ ] **Step 5: Commit**

```bash
git add src/site/render-build.js
git commit -m "feat: rewrite render-build.js to use shared renderers"
```

### Task 9: Update main.js — call setReadOnly

**Files:**
- Modify: `src/site/main.js`

- [ ] **Step 1: Import setReadOnly from all renderer modules and call them**

At the top of `main.js`, add imports:

```js
import { setReadOnly as setSkillsReadOnly } from "../../renderer/modules/skills.js";
import { setReadOnly as setEquipmentReadOnly } from "../../renderer/modules/equipment.js";
import { setReadOnly as setSpecsReadOnly } from "../../renderer/modules/specializations.js";
import { setReadOnly as setDetailReadOnly } from "../../renderer/modules/detail-panel.js";
```

In the `init()` function, before rendering, call:

```js
setSkillsReadOnly(true);
setEquipmentReadOnly(true);
setSpecsReadOnly(true);
setDetailReadOnly(true);
```

- [ ] **Step 2: Remove old SPA-only imports**

Remove any imports of the old `render-detail.js` (e.g., `initDetailTooltip`).

- [ ] **Step 3: Commit**

```bash
git add src/site/main.js
git commit -m "feat: set readOnly on all renderer modules in SPA"
```

### Task 10: Delete old SPA renderer files

**Files:**
- Delete: `src/site/render-skills.js`
- Delete: `src/site/render-specs.js`
- Delete: `src/site/render-equipment.js`
- Delete: `src/site/render-detail.js`

- [ ] **Step 1: Delete the files**

```bash
git rm src/site/render-skills.js src/site/render-specs.js src/site/render-equipment.js src/site/render-detail.js
```

- [ ] **Step 2: Verify no remaining imports reference them**

Search for `render-skills`, `render-specs`, `render-equipment`, `render-detail` in `src/site/`. The only remaining reference should be `render-reference.js` (which is kept).

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: delete old SPA renderer files replaced by shared modules"
```

### Task 11: Clean up styles.css

**Files:**
- Modify: `src/site/styles.css`

- [ ] **Step 1: Remove SPA rendering overrides**

Remove any CSS that was compensating for rendering differences between the old SPA and app (e.g., `.spa-tooltip` overrides if the shared `detail-panel.js` handles tooltips). Keep:
- Navbar styles (`.site-navbar*`)
- App container (`#app`)
- Landing page (`.site-landing`)
- Loading/error states
- Build header (`.build-header*`)
- Tab styles (`.site-tabs`, `.site-tab*`)
- Section headings, notes
- Reference panel sticky positioning
- All `@import` directives for desktop CSS

- [ ] **Step 2: Commit**

```bash
git add src/site/styles.css
git commit -m "chore: clean up SPA styles, remove rendering-difference overrides"
```

---

## Chunk 6: Build, Verify, Fix

### Task 12: Build and verify SPA

- [ ] **Step 1: Build the SPA**

Run: `npm run build:site`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Fix any build errors**

Common issues:
- Missing imports (e.g., `detail-panel.js` expecting DOM refs that don't exist in SPA)
- Vite failing to resolve `?raw` imports — verify `gw2-class-icons` is in `node_modules`
- Circular dependency warnings

- [ ] **Step 3: Run the app and verify desktop still works**

Run: `npm run dev`
Test: Open a build in the editor. Verify skills, specs, equipment all render and interact normally. The `readOnly` flag defaults to `false`, so nothing should change.

- [ ] **Step 4: Test the SPA with a published build**

Open a published build URL in the browser. Compare side-by-side with the same build in the desktop app. Check:
- Skills bar layout matches
- Weapon swap button appears and toggles sets
- Attunement toggle works (Elementalist)
- Specialization cards match (backgrounds, trait icons, connector lines)
- Equipment grid matches (armor, weapons, trinkets, consumables, stats)
- Relic slot shows correctly
- Health orb shows correct HP
- Reference panel updates on hover
- No console errors

- [ ] **Step 5: Test across professions**

Test at minimum:
- **Elementalist** — attunement toggle, F-skills per attunement
- **Revenant** — legend display, legend swap icons
- **Ranger** — pet display
- **Standard profession** (e.g., Guardian) — basic skills, specs, equipment

- [ ] **Step 6: Fix any visual discrepancies or runtime errors**

Iterate on fixes. Common issues:
- Missing `state.activeCatalog` fields — add to adapter's catalog stub
- State field name mismatches — audit `state.editor.*` access in renderers
- DOM container expectations — renderers may expect specific container structure

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "fix: resolve SPA integration issues after shared renderer migration"
```

---

## Implementation Order Summary

1. **Serialization** (Tasks 1-3) — must come first, adds data the shared renderers need
2. **readOnly guards** (Tasks 4-7) — can be done in parallel per module
3. **SPA integration** (Tasks 8-11) — depends on tasks 1-7
4. **Verification** (Task 12) — final integration testing
