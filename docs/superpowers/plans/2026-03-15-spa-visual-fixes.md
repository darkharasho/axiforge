# SPA Visual Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the published SPA build viewer to visually match the desktop app — resolve equipment IDs to names/icons, match the 3-column skill bar layout, add spec connector lines, and polish keybind labels.

**Architecture:** Extend `serializeForPublish` to also fetch the upgrade catalog and resolve all equipment IDs (runes, sigils, infusions, food, utility, enrichment) to `{ name, icon }` objects. Rewrite the SPA renderers to match the desktop DOM structure and layout using the enriched data.

**Tech Stack:** Node.js (CommonJS, main process), vanilla JS ES modules (SPA site), desktop CSS (shared via Vite imports).

**Spec:** Based on desktop app screenshots showing the exact visual target.

**Important context for implementers:**
- The desktop app is an Electron app with vanilla JS (no React/Vue)
- The SPA site files are in `src/site/` — ES modules built by Vite
- Main process modules are CommonJS in `src/main/`
- Equipment values in the build store are **string representations of numeric IDs** (e.g. `"24836"` for a rune item ID)
- The upgrade catalog (`getUpgradeCatalog()`) returns arrays with `byId` Maps for looking up `{ id, name, icon, ... }` by numeric ID
- The profession catalog (`getProfessionCatalog()`) has weapon data, skills, pets, legends
- Tests use Jest. Run with `npx jest --verbose`
- Build site with `npm run build:site`
- The SPA CSS imports desktop CSS files from `src/renderer/styles/` via Vite

---

## Chunk 1: Equipment Data Enrichment

### Task 1: Extend serializeForPublish to resolve equipment IDs

**Files:**
- Modify: `src/main/buildPublish.js`
- Modify: `src/main/index.js` (pass upgrade catalog to serializeForPublish)
- Modify: `tests/unit/buildPublish.test.js`

The build store saves equipment upgrade values as string IDs (e.g. `equipment.runes.head = "24836"`). The SPA currently displays these raw IDs. We need to resolve them to human-readable names and icons at publish time.

- [ ] **Step 1: Update `serializeForPublish` signature to accept upgrade catalog**

In `src/main/buildPublish.js`, change the function signature from:
```js
function serializeForPublish(build, catalog)
```
to:
```js
function serializeForPublish(build, catalog, upgradeCatalog)
```

Add a new `resolveEquipmentDisplay` function that resolves all equipment IDs:

```js
/**
 * Resolve equipment upgrade IDs to display objects with name + icon.
 * The build store saves rune/sigil/infusion/food/utility/enrichment as string IDs.
 * This resolves them using the upgrade catalog's byId maps.
 */
function resolveEquipmentDisplay(equipment, upgradeCatalog) {
  if (!equipment || !upgradeCatalog) return {};

  const runes = equipment.runes || {};
  const sigils = equipment.sigils || {};
  const infusions = equipment.infusions || {};

  // Resolve a single ID string to { id, name, icon }
  function resolveId(idStr, byIdMap) {
    if (!idStr || !byIdMap) return null;
    const id = Number(idStr);
    if (!id) return null;
    const item = byIdMap.get(id);
    return item ? { id: item.id, name: item.name, icon: item.icon } : null;
  }

  // Resolve rune IDs per armor slot
  const resolvedRunes = {};
  for (const [slot, idStr] of Object.entries(runes)) {
    resolvedRunes[slot] = resolveId(idStr, upgradeCatalog.runeById);
  }

  // Resolve sigil IDs per weapon slot
  const resolvedSigils = {};
  for (const [slot, value] of Object.entries(sigils)) {
    if (Array.isArray(value)) {
      resolvedSigils[slot] = value.map(id => resolveId(id, upgradeCatalog.sigilById));
    } else {
      resolvedSigils[slot] = [resolveId(value, upgradeCatalog.sigilById)];
    }
  }

  // Resolve infusion IDs per slot
  const resolvedInfusions = {};
  for (const [slot, value] of Object.entries(infusions)) {
    if (Array.isArray(value)) {
      resolvedInfusions[slot] = value.map(id => resolveId(id, upgradeCatalog.infusionById));
    } else {
      resolvedInfusions[slot] = resolveId(id, upgradeCatalog.infusionById);
    }
  }

  // Resolve consumables
  const resolvedFood = resolveId(equipment.food, upgradeCatalog.foodById);
  const resolvedUtility = resolveId(equipment.utility, upgradeCatalog.utilityById);
  const resolvedRelic = resolveId(equipment.relic, upgradeCatalog.sigilById); // relics use sigil catalog
  const resolvedEnrichment = resolveId(equipment.enrichment, upgradeCatalog.enrichmentById);

  return {
    runes: resolvedRunes,
    sigils: resolvedSigils,
    infusions: resolvedInfusions,
    food: resolvedFood,
    utility: resolvedUtility,
    relic: resolvedRelic,
    enrichment: resolvedEnrichment,
  };
}
```

Then in `serializeForPublish`, after the existing enrichment, add:
```js
result.equipmentDisplay = resolveEquipmentDisplay(build.equipment, upgradeCatalog);
```

- [ ] **Step 2: Update the publish handler in `src/main/index.js` to fetch and pass upgrade catalog**

In the `builds:publish-build` handler (around line 304-310), update:
```js
    // Enrich build data for the SPA
    progress("encrypt");
    let enrichedBuild = build;
    try {
      const { getProfessionCatalog, getUpgradeCatalog } = require("./gw2Data");
      const [catalog, upgradeCatalog] = await Promise.all([
        getProfessionCatalog(build.profession, "en"),
        getUpgradeCatalog("en"),
      ]);
      enrichedBuild = serializeForPublish(build, catalog, upgradeCatalog);
    } catch {
      // Fall back to un-enriched build if catalog unavailable
    }
```

Note: `getUpgradeCatalog` is already exported from `src/main/gw2Data/index.js`.

- [ ] **Step 3: Update tests**

In `tests/unit/buildPublish.test.js`, update the mock catalog to include upgrade data and add tests verifying equipment ID resolution works. Add a mock upgrade catalog:

```js
function makeMockUpgradeCatalog() {
  return {
    runeById: new Map([[24836, { id: 24836, name: "Superior Rune of the Scholar", icon: "scholar.png" }]]),
    sigilById: new Map([[24615, { id: 24615, name: "Superior Sigil of Force", icon: "force.png" }]]),
    infusionById: new Map([[43254, { id: 43254, name: "+9 Agony Infusion", icon: "agony.png" }]]),
    enrichmentById: new Map([[87417, { id: 87417, name: "Mist Attunement Enrichment", icon: "mist.png" }]]),
    foodById: new Map([[91805, { id: 91805, name: "Bowl of Sweet and Spicy Butternut Squash Soup", icon: "soup.png" }]]),
    utilityById: new Map([[67528, { id: 67528, name: "Superior Sharpening Stone", icon: "stone.png" }]]),
  };
}
```

Add tests:
```js
test("resolves rune IDs to names and icons", () => {
  const build = makeMockBuild();
  build.equipment.runes = { head: "24836", shoulders: "24836" };
  const result = serializeForPublish(build, makeMockCatalog(), makeMockUpgradeCatalog());
  expect(result.equipmentDisplay.runes.head).toEqual({ id: 24836, name: "Superior Rune of the Scholar", icon: "scholar.png" });
});

test("handles missing upgrade catalog gracefully", () => {
  const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
  expect(result.equipmentDisplay).toEqual({});
});
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/buildPublish.test.js --verbose`
Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/buildPublish.js src/main/index.js tests/unit/buildPublish.test.js
git commit -m "feat: resolve equipment upgrade IDs to names and icons at publish time"
```

---

## Chunk 2: Equipment Renderer Overhaul

### Task 2: Rewrite equipment renderer to match desktop layout

**Files:**
- Modify: `src/site/render-equipment.js` (full rewrite)

The equipment renderer currently shows a 2-column armor grid with raw IDs. It needs to match the desktop: vertical armor list with icons, stat breakdown, and resolved upgrade names.

Key changes from screenshots:
- **Armor**: Vertical list (not 2-col grid), each row shows: slot icon + slot name + stat name (e.g. "Berserker's") + stat attributes (Power · Precision · Ferocity) + rune/infusion upgrade badges
- **Weapons**: Each weapon row shows: weapon icon + weapon name + stat name + stat attributes + sigil badges
- **Trinkets**: 4-column grid (row 1: Back, Accessory 1, Accessory 2, Relic; row 2: Amulet, Ring 1, Ring 2) matching desktop
- **Rune/Infusion summaries**: Show resolved names instead of IDs
- **Consumables**: Show resolved names with icons

- [ ] **Step 1: Rewrite `src/site/render-equipment.js`**

The rewrite should:

1. Use `build.equipmentDisplay` for resolved upgrade names/icons
2. Change armor from 2-col grid to vertical list matching desktop
3. Show stat breakdown text (e.g. "Power · Precision · Ferocity") — use a hardcoded stat-name-to-attributes map for common stat packages (Berserker, Viper, Ritualist, etc.)
4. Show resolved rune names in summary instead of IDs
5. Show resolved infusion names instead of IDs
6. Show resolved food/utility/enrichment/relic names
7. Match the desktop's `equip-slot` structure: icon div + info div (label + value + optional stat breakdown)

Reference the desktop's `src/renderer/modules/equipment.js` for exact DOM class usage. Keep using `document.createElement` (no innerHTML with user data).

- [ ] **Step 2: Build and verify**

Run: `npm run build:site`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/site/render-equipment.js
git commit -m "feat: rewrite equipment renderer to match desktop layout with resolved upgrades"
```

---

## Chunk 3: Skills Layout Overhaul

### Task 3: Restructure skills to match desktop 3-column bar

**Files:**
- Modify: `src/site/render-skills.js` (significant rewrite)
- Modify: `src/site/styles.css` (add health orb styles for SPA)

The desktop skills section has a horizontal 3-column layout:
- **Left**: Weapon skills (1-5) + weapon swap visual + profession mechanics bar (F1-F5)
- **Center**: Health orb showing HP value
- **Right**: Heal (6) + Utilities (7,8,9) + Elite (0)

The SPA currently stacks everything vertically. This task restructures it to match.

- [ ] **Step 1: Rewrite `src/site/render-skills.js`**

Key structural changes:

1. Wrap everything in a 3-column `skills-bar` container
2. **Left column** (`skills-bar__weapon-col`):
   - Weapon skills in a row (skill-group with 5 slots)
   - Keybind labels (1-5) below each weapon skill icon using `skill-icon-large__keylabel`
   - Profession mechanics bar below weapons (`profession-mechanics-bar`)
   - For Revenant: legend slot buttons (`legend-slot-btn`) with swap icons
   - For Ranger: pet slot buttons (`pet-slot-btn`) with pet icons
3. **Center column** (`skills-bar__orb-col`):
   - Health orb div (`health-orb`) showing `build.healthPool` or a default
   - F5 slot above orb if applicable
4. **Right column** (`skills-bar__util-col`):
   - Heal/utility/elite as a vertical skill group
   - Keybind labels (6, 7, 8, 9, 0) below each icon

Legend and pet display should use proper icon buttons matching the desktop DOM:
- Legends: `<button class="legend-slot-btn">` with swap icon image
- Pets: `<div class="pet-slot-wrapper">` with `pet-slot-btn` containing pet icon image

- [ ] **Step 2: Add health orb SPA styles to `src/site/styles.css`**

The health orb CSS is in `src/renderer/styles/skills.css` which is already imported. However, the SPA may need a few overrides:

```css
/* SPA: make health orb non-interactive */
.health-orb { cursor: default; }
```

- [ ] **Step 3: Build and verify**

Run: `npm run build:site`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/site/render-skills.js src/site/styles.css
git commit -m "feat: restructure skills to desktop 3-column layout with health orb"
```

---

## Chunk 4: Specialization Connector Lines

### Task 4: Add animated connector SVG lines to spec cards

**Files:**
- Modify: `src/site/render-specs.js`

The desktop renders animated SVG connector lines between minor→major traits across the 3 tiers. The SPA currently omits these. Since the SPA is static (no trait selection), we can draw the connectors immediately after rendering.

- [ ] **Step 1: Add connector drawing to `src/site/render-specs.js`**

After appending all spec cards to the DOM, iterate over each `.spec-card__body` and draw the connector SVG. The connector connects: emblem center → minor-1 → selected-major-1 → minor-2 → selected-major-2 → minor-3 → selected-major-3.

Add `data-connector-role` attributes to the relevant buttons:
- Minor buttons: `data-connector-role="minor-1"`, `minor-2`, `minor-3`
- Selected major buttons: `data-connector-role="major-1"`, `major-2`, `major-3`

Then implement a `drawConnector(body)` function matching the desktop's `drawSpecConnector`:

```js
function drawConnector(body) {
  const bodyRect = body.getBoundingClientRect();
  if (bodyRect.width === 0) return;

  const roles = ["minor-1", "major-1", "minor-2", "major-2", "minor-3", "major-3"];
  const points = [];
  for (const role of roles) {
    const node = body.querySelector(`[data-connector-role="${role}"]`);
    if (!node) continue;
    const r = node.getBoundingClientRect();
    points.push({ x: r.left + r.width / 2 - bodyRect.left, y: r.top + r.height / 2 - bodyRect.top });
  }
  if (points.length < 2) return;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "spec-connector");
  svg.setAttribute("viewBox", `0 0 ${bodyRect.width} ${bodyRect.height}`);
  // ... core path + animated flow paths (match desktop exactly)
}
```

Call this after a double-rAF to ensure layout is computed:
```js
requestAnimationFrame(() => requestAnimationFrame(() => {
  for (const body of host.querySelectorAll(".spec-card__body")) {
    drawConnector(body);
  }
}));
```

- [ ] **Step 2: Build and verify**

Run: `npm run build:site`

- [ ] **Step 3: Commit**

```bash
git add src/site/render-specs.js
git commit -m "feat: add animated connector SVG lines to spec cards"
```

---

## Chunk 5: Polish Pass

### Task 5: Keybind labels, tooltip fixes, final cleanup

**Files:**
- Modify: `src/site/render-skills.js` (if keybind labels weren't added in Task 3)
- Modify: `src/site/render-specs.js` (remove redundant inline opacity)
- Modify: `src/site/styles.css` (any final SPA-specific style fixes)

- [ ] **Step 1: Ensure weapon skill keybind labels (1-5)**

In the weapon skill slots, add a `skill-icon-large__keylabel` span with the slot number:
```js
const keylabel = document.createElement("span");
keylabel.className = "skill-icon-large__keylabel";
keylabel.textContent = String(index + 1);
icon.append(keylabel);
```

- [ ] **Step 2: Ensure heal/utility/elite keybind labels (6-0)**

Map: Heal=6, Utility 1=7, Utility 2=8, Utility 3=9, Elite=0.

- [ ] **Step 3: Remove redundant inline opacity from spec renderer**

In `render-specs.js`, remove `traitBtn.style.opacity = "0.45"` — the CSS `.trait-btn:disabled` already handles this.

- [ ] **Step 4: Build site and run full test suite**

```bash
npm run build:site
npx jest --verbose
```

Expected: Build succeeds, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/site/render-skills.js src/site/render-specs.js src/site/styles.css
git commit -m "fix: add keybind labels, remove redundant opacity, polish SPA styles"
```
