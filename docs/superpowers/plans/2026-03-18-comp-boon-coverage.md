# Comp Boon Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible boon coverage section to the comp detail view showing how many builds in the squad (and per line) provide each of the 12 GW2 boons, with hover tooltips listing which builds contribute.

**Architecture:** A new `comp-boon-coverage.js` module in the comps folder owns both the data computation (`computeCompBoonCoverage`) and the HTML rendering (`buildBoonCoverageHTML`). The comp detail view renders a synchronous placeholder, then patches in the real content via an async IIFE after `bindDetailEvents`. `getCatalog` is exported from `renderer.js` and threaded through the callbacks chain.

**Tech Stack:** Vanilla JS ES modules, Jest (unit tests), existing `computeBoonCoverage` + `resolveEquippedWeaponSkills` utilities.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/renderer/modules/comps/comp-boon-coverage.js` | `computeCompBoonCoverage` (async) + `buildBoonCoverageHTML` + `bindBoonCoverageEvents` |
| **Create** | `tests/unit/renderer/comp-boon-coverage.test.js` | Unit tests for `computeCompBoonCoverage` |
| **Modify** | `src/renderer/modules/state.js:40-44` | Add `boonCoverageCollapsed: false` to `compPrefs` |
| **Modify** | `src/renderer/renderer.js:461` | Export `getCatalog`; pass it via `initComps` call |
| **Modify** | `src/renderer/modules/comps/comps.js:62-70` | Forward `getCatalog` to `initCompDetail` |
| **Modify** | `src/renderer/modules/comps/comp-detail.js` | Accept `getCatalog`, add placeholder, async IIFE, collapse toggle |
| **Modify** | `src/renderer/styles/comps.css` | Styles for coverage section, icon badges, tooltips |

---

## Task 1: Add state field

**Files:**
- Modify: `src/renderer/modules/state.js:40-44`

- [ ] **Step 1: Add `boonCoverageCollapsed` to `compPrefs`**

In `state.js`, the `compPrefs` block currently looks like:
```js
compPrefs: {
  sortField: "updatedAt",
  sortDirection: "desc",
  activeFilters: {},
},
```
Change it to:
```js
compPrefs: {
  sortField: "updatedAt",
  sortDirection: "desc",
  activeFilters: {},
  boonCoverageCollapsed: false,
},
```

- [ ] **Step 2: Commit**
```bash
git add src/renderer/modules/state.js
git commit -m "feat: add boonCoverageCollapsed to compPrefs state"
```

---

## Task 2: Export `getCatalog` and wire through callbacks

**Files:**
- Modify: `src/renderer/renderer.js:461`
- Modify: `src/renderer/renderer.js:314-318`
- Modify: `src/renderer/modules/comps/comps.js:6-70`
- Modify: `src/renderer/modules/comps/comp-detail.js:88-90`

- [ ] **Step 1: Export `getCatalog` from `renderer.js`**

In `renderer.js`, line 461, change:
```js
async function getCatalog(professionId, gameMode = "pve") {
```
to:
```js
export async function getCatalog(professionId, gameMode = "pve") {
```

- [ ] **Step 2: Pass `getCatalog` to `initComps` in `renderer.js`**

The `initComps` call (around line 314) currently passes:
```js
initComps({
  navigateToPage,
  loadBuildIntoEditor,
  confirmDiscardDirty,
});
```
Change to:
```js
initComps({
  navigateToPage,
  loadBuildIntoEditor,
  confirmDiscardDirty,
  getCatalog,
});
```

- [ ] **Step 3: Forward `getCatalog` from `comps.js` to `initCompDetail`**

In `comps.js`, the `initCompDetail` call (line 62) currently is:
```js
initCompDetail({
  onRerender: () => renderComps(),
  onOpenBuild: (build) => {
    if (!build) return;
    if (_app.confirmDiscardDirty && !_app.confirmDiscardDirty("Load another build")) return;
    _app.loadBuildIntoEditor?.(build);
    _app.navigateToPage?.("editor");
  },
});
```
Change to:
```js
initCompDetail({
  onRerender: () => renderComps(),
  getCatalog: _app.getCatalog,
  onOpenBuild: (build) => {
    if (!build) return;
    if (_app.confirmDiscardDirty && !_app.confirmDiscardDirty("Load another build")) return;
    _app.loadBuildIntoEditor?.(build);
    _app.navigateToPage?.("editor");
  },
});
```

- [ ] **Step 4: Commit**
```bash
git add src/renderer/renderer.js src/renderer/modules/comps/comps.js
git commit -m "feat: export getCatalog and thread through initComps/initCompDetail"
```

---

## Task 3: `computeCompBoonCoverage` — TDD

**Files:**
- Create: `tests/unit/renderer/comp-boon-coverage.test.js`
- Create: `src/renderer/modules/comps/comp-boon-coverage.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/renderer/comp-boon-coverage.test.js`:

```js
"use strict";

// computeCompBoonCoverage is in comp-boon-coverage.js which imports from
// boon-coverage.js (which imports from constants.js etc). Jest handles
// ES module transpilation via babel — same as the existing boon-coverage tests.
const { computeCompBoonCoverage } = require("../../../src/renderer/modules/comps/comp-boon-coverage");

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeComp(partyLines = []) {
  return { id: "comp-1", partyLines };
}

function makeLine(id, slots = []) {
  return { id, slots, capacity: 5 };
}

function makeBuild(id, profession, overrides = {}) {
  return {
    id,
    title: overrides.title || id,
    profession,
    gameMode: overrides.gameMode || "pve",
    specializations: [],
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    equipment: { weapons: {} },
    underwaterMode: false,
    activeWeaponSet: 1,
    ...overrides,
  };
}

// A catalog that produces Might from heal skill 100
function makeCatalog(skillsById = new Map()) {
  return {
    skillById: skillsById,
    traitById: new Map(),
    weaponSkillById: new Map(),
    specializationById: new Map(),
    skills: [],
    professionWeapons: {},
    legendById: new Map(),
    petById: new Map(),
  };
}

function makeMightSkill() {
  return {
    id: 100, name: "Healing Surge",
    description: "Heal yourself.",
    facts: [{ type: "Buff", status: "Might", duration: 10, apply_count: 5 }],
    type: "Heal",
  };
}

function makeFurySkill() {
  return {
    id: 200, name: "Signet of Fury",
    description: "Grant Fury to allies.",
    facts: [{ type: "Buff", status: "Fury", duration: 6, apply_count: 0 }],
    type: "Utility",
  };
}

// Fake getCatalog: warms the catalogCache Map with the provided catalog
function makeGetCatalog(catalogCache, catalog) {
  return async (profession, gameMode) => {
    const key = `${profession}_${gameMode}`;
    if (!catalogCache.has(key)) catalogCache.set(key, catalog);
    return catalogCache.get(key);
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("computeCompBoonCoverage", () => {
  test("returns empty squad and empty lines when comp has no partyLines", async () => {
    const comp = makeComp([]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [], new Map(), async () => null);
    expect(squad.size).toBe(0);
    expect(lines).toHaveLength(0);
  });

  test("returns empty squad when all lines have empty slots", async () => {
    const comp = makeComp([makeLine("l1", []), makeLine("l2", [])]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [], new Map(), async () => null);
    expect(squad.size).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0].boons.size).toBe(0);
    expect(lines[0].hasFilledSlots).toBe(false);
  });

  test("counts one boon from one build in one line", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);

    expect(squad.get("Might")).toMatchObject({ count: 1 });
    expect(squad.get("Might").providers).toHaveLength(1);
    expect(squad.get("Might").providers[0]).toMatchObject({
      buildId: "b1",
      buildName: "b1",
      lineLabel: "P1",
    });

    expect(lines[0].label).toBe("P1");
    expect(lines[0].hasFilledSlots).toBe(true);
    expect(lines[0].boons.get("Might")).toMatchObject({ count: 1 });
    expect(lines[0].boons.get("Might").providers[0]).toMatchObject({ buildId: "b1" });
  });

  test("aggregates the same boon from two builds in one line", async () => {
    const b1 = makeBuild("b1", "Guardian");
    b1.skills.healId = 100;
    const b2 = makeBuild("b2", "Guardian");
    b2.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1", "b2"])]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [b1, b2], catalogCache, getCatalog);

    expect(squad.get("Might").count).toBe(2);
    expect(squad.get("Might").providers).toHaveLength(2);
    expect(lines[0].boons.get("Might").count).toBe(2);
  });

  test("aggregates boons across two lines into squad total", async () => {
    const b1 = makeBuild("b1", "Guardian");
    b1.skills.healId = 100;
    const b2 = makeBuild("b2", "Ranger");
    b2.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"]), makeLine("l2", ["b2"])]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [b1, b2], catalogCache, getCatalog);

    expect(squad.get("Might").count).toBe(2);
    expect(squad.get("Might").providers[0].lineLabel).toBe("P1");
    expect(squad.get("Might").providers[1].lineLabel).toBe("P2");
    expect(lines[0].boons.get("Might").count).toBe(1);
    expect(lines[1].boons.get("Might").count).toBe(1);
  });

  test("different boons from different builds appear separately in squad", async () => {
    const b1 = makeBuild("b1", "Guardian");
    b1.skills.healId = 100;
    const b2 = makeBuild("b2", "Guardian");
    b2.skills.utilityIds = [200, 0, 0];
    const catalog = makeCatalog(new Map([[100, makeMightSkill()], [200, makeFurySkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1", "b2"])]);
    const { squad } = await computeCompBoonCoverage(comp, [b1, b2], catalogCache, getCatalog);

    expect(squad.get("Might").count).toBe(1);
    expect(squad.get("Fury").count).toBe(1);
  });

  test("skips build IDs not found in builds array", async () => {
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["ghost-build-id"])]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [], catalogCache, getCatalog);

    expect(squad.size).toBe(0);
    expect(lines[0].hasFilledSlots).toBe(false);
  });

  test("skips builds whose catalog is not available", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    // getCatalog returns null — catalog never makes it into catalogCache
    const catalogCache = new Map();
    const getCatalog = async () => null;

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);

    expect(squad.size).toBe(0);
  });

  test("uses build.title as buildName when available", async () => {
    const build = makeBuild("b1", "Guardian", { title: "My Firebrand" });
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);

    expect(squad.get("Might").providers[0].buildName).toBe("My Firebrand");
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
npx jest tests/unit/renderer/comp-boon-coverage.test.js --no-coverage 2>&1 | tail -20
```

Expected: `Cannot find module '../../../src/renderer/modules/comps/comp-boon-coverage'`

- [ ] **Step 3: Create `src/renderer/modules/comps/comp-boon-coverage.js`**

```js
// Comp-level boon coverage — aggregates computeBoonCoverage across all builds in a comp.
// Kept in the comps/ folder to avoid circular imports (boon-coverage.js ← skills.js ← equipment-weapon-skills.js).

import { computeBoonCoverage } from "../boon-coverage.js";
import { resolveEquippedWeaponSkills } from "../equipment-weapon-skills.js";
import { BOON_DISPLAY_ORDER, BOON_CONDITION_ICONS } from "../constants.js";
import { getProfessionSvg } from "../profession-icons.js";
import { escapeHtml } from "../utils.js";

/**
 * Compute boon coverage for all filled slots in a comp, squad-wide and per-line.
 *
 * @param {object} comp - The active comp (partyLines: [{id, slots, capacity}])
 * @param {object[]} builds - state.builds
 * @param {Map} catalogCache - state.catalogCache
 * @param {Function} getCatalog - async (professionId, gameMode) => catalog
 * @returns {Promise<{
 *   squad: Map<string, {count: number, providers: {buildId, buildName, lineLabel}[]}>,
 *   lines: {lineId: string, label: string, hasFilledSlots: boolean,
 *           boons: Map<string, {count: number, providers: {buildId, buildName}[]}>}[]
 * }>}
 */
export async function computeCompBoonCoverage(comp, builds, catalogCache, getCatalog) {
  const lines = comp.partyLines || [];
  const buildMap = new Map(builds.map((b) => [b.id, b]));

  // Pre-warm catalog cache for every (profession, gameMode) pair in this comp
  const profKeys = new Set();
  for (const line of lines) {
    for (const buildId of line.slots || []) {
      const b = buildMap.get(buildId);
      if (b?.profession) profKeys.add(`${b.profession}|${b.gameMode || "pve"}`);
    }
  }
  await Promise.all(
    [...profKeys].map((key) => {
      const [profession, gameMode] = key.split("|");
      return getCatalog(profession, gameMode);
    })
  );

  // squad: boonName → { count, providers: [{buildId, buildName, lineLabel}] }
  const squadMap = new Map();
  const lineResults = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = `P${i + 1}`;
    // lineBoonMap: boonName → { count, providers: [{buildId, buildName}] }
    const lineBoonMap = new Map();
    let hasFilledSlots = false;

    for (const buildId of line.slots || []) {
      const build = buildMap.get(buildId);
      if (!build || !build.profession) continue;

      const cacheKey = `${build.profession}_${build.gameMode || "pve"}`;
      const catalog = catalogCache.get(cacheKey);
      if (!catalog) continue;

      hasFilledSlots = true;
      const weaponSkills = resolveEquippedWeaponSkills(catalog, build);
      const coverage = computeBoonCoverage(catalog, build, weaponSkills);
      const buildName = build.title || build.id;

      for (const boon of coverage.boons) {
        if (!lineBoonMap.has(boon.name)) {
          lineBoonMap.set(boon.name, { count: 0, providers: [] });
        }
        const lineEntry = lineBoonMap.get(boon.name);
        lineEntry.count++;
        lineEntry.providers.push({ buildId, buildName });

        // Accumulate into squad
        if (!squadMap.has(boon.name)) {
          squadMap.set(boon.name, { count: 0, providers: [] });
        }
        const squadEntry = squadMap.get(boon.name);
        squadEntry.count++;
        squadEntry.providers.push({ buildId, buildName, lineLabel: label });
      }
    }

    lineResults.push({ lineId: line.id, label, hasFilledSlots, boons: lineBoonMap });
  }

  return { squad: squadMap, lines: lineResults };
}

// ── HTML rendering ────────────────────────────────────────────────────────────

/**
 * Render the inner HTML for the boon coverage section body.
 * Pure function — no side effects.
 *
 * @param {{ squad: Map, lines: Array }} data - from computeCompBoonCoverage
 * @returns {string} HTML
 */
export function buildBoonCoverageHTML(data) {
  const { squad, lines } = data;

  const squadIcons = _renderIconRow(squad, "squad", "22", null);

  const lineRowsHtml = lines
    .filter((l) => l.hasFilledSlots)
    .map(
      (line) => `
      <div class="comp-boon-cov__line-row">
        <span class="comp-boon-cov__line-label">${escapeHtml(line.label)}</span>
        <div class="comp-boon-cov__icons">
          ${_renderIconRow(line.boons, "line", "17", line.label)}
        </div>
      </div>`
    )
    .join("");

  return `
    <div class="comp-boon-cov__squad-label">SQUAD</div>
    <div class="comp-boon-cov__icons comp-boon-cov__icons--squad">${squadIcons}</div>
    ${lineRowsHtml ? `<div class="comp-boon-cov__lines">${lineRowsHtml}</div>` : ""}
  `;
}

function _renderIconRow(boonMap, scope, size, lineLabel) {
  return BOON_DISPLAY_ORDER.map((boonName) => {
    const entry = boonMap.get(boonName);
    const count = entry?.count || 0;
    const covered = count > 0;
    const icon = BOON_CONDITION_ICONS[boonName] || "";

    // Encode providers as JSON for event handlers to read
    const providersJson = covered
      ? escapeHtml(JSON.stringify(entry.providers))
      : "[]";

    return `
      <div class="comp-boon-cov__icon ${covered ? "" : "comp-boon-cov__icon--uncovered"}"
           data-scope="${scope}"
           data-boon-name="${escapeHtml(boonName)}"
           data-count="${count}"
           data-providers="${providersJson}"
           ${lineLabel ? `data-line-label="${escapeHtml(lineLabel)}"` : ""}>
        <img src="${escapeHtml(icon)}" width="${size}" height="${size}"
             class="comp-boon-cov__img" alt="${escapeHtml(boonName)}" />
        ${covered ? `<span class="comp-boon-cov__badge">&times;${count}</span>` : ""}
      </div>`;
  }).join("");
}

// ── Tooltip event binding ─────────────────────────────────────────────────────

let _activeBoonTooltip = null;

function _closeBoonTooltip() {
  if (_activeBoonTooltip) {
    _activeBoonTooltip.remove();
    _activeBoonTooltip = null;
  }
}

/**
 * Wire mouseenter/mouseleave on each boon icon to show a floating tooltip.
 * Call this after patching the section's innerHTML.
 *
 * @param {HTMLElement} container - The #comp-boon-coverage-body element
 */
export function bindBoonCoverageEvents(container) {
  container.querySelectorAll(".comp-boon-cov__icon").forEach((iconEl) => {
    iconEl.addEventListener("mouseenter", () => {
      _closeBoonTooltip();
      const boonName  = iconEl.dataset.boonName;
      const count     = Number(iconEl.dataset.count) || 0;
      const scope     = iconEl.dataset.scope;
      const lineLabel = iconEl.dataset.lineLabel || null;
      let providers   = [];
      try { providers = JSON.parse(iconEl.dataset.providers || "[]"); } catch (_) { /* ignore */ }

      const tip = document.createElement("div");
      tip.className = "comp-boon-tooltip";
      tip.innerHTML = _buildTooltipHTML(boonName, count, providers, scope, lineLabel);
      document.body.appendChild(tip);
      _activeBoonTooltip = tip;

      // Position above the icon, clamped to viewport
      const ir = iconEl.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      const vw = window.innerWidth;
      let top  = ir.top - tr.height - 6;
      let left = ir.left + ir.width / 2 - tr.width / 2;
      if (top < 4)              top  = ir.bottom + 6;
      if (left < 4)             left = 4;
      if (left + tr.width > vw - 4) left = vw - tr.width - 4;
      tip.style.top  = `${top}px`;
      tip.style.left = `${left}px`;
    });

    iconEl.addEventListener("mouseleave", _closeBoonTooltip);
  });
}

function _buildTooltipHTML(boonName, count, providers, scope, lineLabel) {
  const icon = BOON_CONDITION_ICONS[boonName] || "";
  const headerLabel = count > 0
    ? `${count} ${count === 1 ? "build" : "builds"}`
    : "Not covered";

  if (count === 0) {
    return `
      <div class="comp-boon-tooltip__header">
        <img src="${escapeHtml(icon)}" width="14" height="14" alt="${escapeHtml(boonName)}" />
        <span class="comp-boon-tooltip__name">${escapeHtml(boonName)}</span>
        <span class="comp-boon-tooltip__count">Not covered</span>
      </div>`;
  }

  if (scope === "line") {
    // Flat list of builds in this line
    const rows = providers.map((p) => {
      const profSvg = _getProfSvgForBuild(p.buildId);
      return `<div class="comp-boon-tooltip__row">
        <span class="comp-boon-tooltip__prof">${profSvg}</span>
        <span class="comp-boon-tooltip__build-name">${escapeHtml(p.buildName)}</span>
      </div>`;
    }).join("");
    return `
      <div class="comp-boon-tooltip__header">
        <img src="${escapeHtml(icon)}" width="14" height="14" alt="${escapeHtml(boonName)}" />
        <span class="comp-boon-tooltip__name">${escapeHtml(boonName)}</span>
        <span class="comp-boon-tooltip__count">${escapeHtml(headerLabel)}</span>
      </div>
      <div class="comp-boon-tooltip__sep"></div>
      <div class="comp-boon-tooltip__providers">${rows}</div>`;
  }

  // Squad scope — group providers by lineLabel
  const byLine = new Map();
  for (const p of providers) {
    if (!byLine.has(p.lineLabel)) byLine.set(p.lineLabel, []);
    byLine.get(p.lineLabel).push(p);
  }
  const lineGroups = [...byLine.entries()].map(([lbl, lProviders]) => {
    const rows = lProviders.map((p) => {
      const profSvg = _getProfSvgForBuild(p.buildId);
      return `<div class="comp-boon-tooltip__row">
        <span class="comp-boon-tooltip__prof">${profSvg}</span>
        <span class="comp-boon-tooltip__build-name">${escapeHtml(p.buildName)}</span>
      </div>`;
    }).join("");
    return `<div class="comp-boon-tooltip__line-group">
      <div class="comp-boon-tooltip__line-label">${escapeHtml(lbl)}</div>
      ${rows}
    </div>`;
  }).join("");

  return `
    <div class="comp-boon-tooltip__header">
      <img src="${escapeHtml(icon)}" width="14" height="14" alt="${escapeHtml(boonName)}" />
      <span class="comp-boon-tooltip__name">${escapeHtml(boonName)}</span>
      <span class="comp-boon-tooltip__count">${escapeHtml(headerLabel)}</span>
    </div>
    <div class="comp-boon-tooltip__sep"></div>
    <div class="comp-boon-tooltip__providers">${lineGroups}</div>`;
}

// Reads from state.builds to get profession — avoids passing builds to every render call.
// Lazy import to avoid circular dep (state is module-level singleton).
function _getProfSvgForBuild(buildId) {
  try {
    const { state } = require("../state.js"); // CJS fallback for test compatibility
    const build = state.builds?.find((b) => b.id === buildId);
    if (!build) return "";
    return getProfessionSvg(build.profession || "") || "";
  } catch (_) {
    return "";
  }
}
```

> **Note on `_getProfSvgForBuild`:** In actual ESM runtime, `require` is not available; replace this with a static import at the top and access `state.builds` directly. The `try/catch` with `require` is only here as a CJS shim for Jest compatibility (same pattern used in other renderer modules under test). In the browser context, `state` is imported at module top — see Step 5 below where we update the import.

- [ ] **Step 4: Fix the ESM import of `state` in `comp-boon-coverage.js`**

Replace the `_getProfSvgForBuild` function's `require` shim with a proper static import. At the top of `comp-boon-coverage.js`, add:

```js
import { state } from "../state.js";
```

And replace the `_getProfSvgForBuild` function body with:

```js
function _getProfSvgForBuild(buildId) {
  const build = state.builds?.find((b) => b.id === buildId);
  if (!build) return "";
  return getProfessionSvg(build.profession || "") || "";
}
```

> This means `_getProfSvgForBuild` only works in the browser (where `state.builds` is populated). In unit tests it will always return `""` since `state.builds` is empty in the test environment — which is acceptable since tooltip SVGs are not under test.

- [ ] **Step 5: Run the tests — confirm they pass**

```bash
npx jest tests/unit/renderer/comp-boon-coverage.test.js --no-coverage 2>&1 | tail -30
```

Expected: all 8 tests pass.

- [ ] **Step 6: Commit**
```bash
git add src/renderer/modules/comps/comp-boon-coverage.js tests/unit/renderer/comp-boon-coverage.test.js
git commit -m "feat: add computeCompBoonCoverage with unit tests"
```

---

## Task 4: Integrate into `comp-detail.js`

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js`

- [ ] **Step 1: Add imports at the top of `comp-detail.js`**

After the existing imports (around line 8), add:

```js
import { computeCompBoonCoverage, buildBoonCoverageHTML, bindBoonCoverageEvents } from "./comp-boon-coverage.js";
```

- [ ] **Step 2: Add boon coverage placeholder to `renderPartyLines`**

The `renderPartyLines` function (line 463) currently returns:

```js
return `
  ${lineRows}
  <div class="comp-line comp-line--add ${canAdd ? "" : "comp-line--disabled"}"
       data-action="add-line">
    <span class="comp-line__add-text">+ Add Line</span>
  </div>
  <div class="comp-line-trash">
    <span class="comp-line-trash__text">Remove</span>
  </div>
`;
```

Change to:

```js
const collapsed = state.compPrefs.boonCoverageCollapsed;
return `
  ${lineRows}
  <div class="comp-line comp-line--add ${canAdd ? "" : "comp-line--disabled"}"
       data-action="add-line">
    <span class="comp-line__add-text">+ Add Line</span>
  </div>
  <div class="comp-line-trash">
    <span class="comp-line-trash__text">Remove</span>
  </div>
  <div class="comp-boon-cov">
    <div class="comp-boon-cov__header" data-action="toggle-boon-coverage">
      <span class="comp-boon-cov__chevron">${collapsed ? "▸" : "▾"}</span>
      <span class="comp-boon-cov__title">BOON COVERAGE</span>
    </div>
    <div class="comp-boon-cov__body${collapsed ? " comp-boon-cov__body--hidden" : ""}"
         id="comp-boon-coverage-body">
    </div>
  </div>
`;
```

- [ ] **Step 3: Add async IIFE to `renderCompDetail` after event binding**

In `renderCompDetail` (line 344), inside the function body, after the `wireCompDragDrop({...})` call and before the closing `}` of `renderCompDetail`, add:

```js
// Async patch: compute boon coverage and patch into the placeholder
if (_callbacks.getCatalog) {
  const compIdAtRender = comp.id;
  (async () => {
    let data;
    try {
      data = await computeCompBoonCoverage(
        comp, state.builds, state.catalogCache, _callbacks.getCatalog
      );
    } catch (err) {
      console.error("[comp-boon-coverage] computation failed", err);
      return;
    }
    // Guard: bail if user navigated away or opened a different comp
    if (state.activeComp?.id !== compIdAtRender) return;
    const bodyEl = container.querySelector("#comp-boon-coverage-body");
    if (!bodyEl) return;
    bodyEl.innerHTML = buildBoonCoverageHTML(data);
    bindBoonCoverageEvents(bodyEl);
  })();
}
```

- [ ] **Step 4: Run the existing test suite to confirm nothing broke**

```bash
npx jest tests/unit/renderer/ --no-coverage 2>&1 | tail -20
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**
```bash
git add src/renderer/modules/comps/comp-detail.js
git commit -m "feat: integrate boon coverage section into comp detail view"
```

---

## Task 5: Wire collapse toggle

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js` (inside `bindDetailEvents`)

- [ ] **Step 1: Add the collapse toggle handler in `bindDetailEvents`**

In `bindDetailEvents(container, comp)` (line 787), add after the existing event bindings (before the pool events at the end):

```js
// ── Boon coverage collapse toggle ──────────────────────────────────────────
container.querySelector("[data-action='toggle-boon-coverage']")?.addEventListener("click", () => {
  state.compPrefs.boonCoverageCollapsed = !state.compPrefs.boonCoverageCollapsed;
  const collapsed = state.compPrefs.boonCoverageCollapsed;
  // Toggle body visibility
  const bodyEl = container.querySelector("#comp-boon-coverage-body");
  if (bodyEl) {
    bodyEl.classList.toggle("comp-boon-cov__body--hidden", collapsed);
  }
  // Update chevron
  const chevronEl = container.querySelector(".comp-boon-cov__chevron");
  if (chevronEl) chevronEl.textContent = collapsed ? "▸" : "▾";
});
```

- [ ] **Step 2: Run tests to confirm nothing broke**

```bash
npx jest tests/unit/renderer/ --no-coverage 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 3: Commit**
```bash
git add src/renderer/modules/comps/comp-detail.js
git commit -m "feat: wire collapse toggle for boon coverage section"
```

---

## Task 6: CSS

**Files:**
- Modify: `src/renderer/styles/comps.css`

- [ ] **Step 1: Add styles at the end of `comps.css`**

Append after the last existing rule:

```css
/* ── Comp Boon Coverage Section ─────────────────────────────────────── */

.comp-boon-cov {
  border-top: 1px solid #1a1a3a;
  margin-top: 4px;
}

.comp-boon-cov__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px 6px;
  cursor: pointer;
  user-select: none;
  color: #556;
  font-size: 10px;
  letter-spacing: .05em;
}

.comp-boon-cov__header:hover {
  color: #889;
}

.comp-boon-cov__chevron {
  font-size: 9px;
  line-height: 1;
}

.comp-boon-cov__body {
  padding: 0 12px 12px;
}

.comp-boon-cov__body--hidden {
  display: none;
}

.comp-boon-cov__squad-label {
  font-size: 9px;
  letter-spacing: .04em;
  color: #556;
  margin-bottom: 5px;
}

.comp-boon-cov__icons {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
}

.comp-boon-cov__icons--squad {
  margin-bottom: 10px;
}

.comp-boon-cov__lines {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.comp-boon-cov__line-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.comp-boon-cov__line-label {
  font-size: 9px;
  color: #556;
  min-width: 18px;
}

/* Individual boon icon wrapper */
.comp-boon-cov__icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

.comp-boon-cov__icon--uncovered {
  opacity: 0.28;
}

.comp-boon-cov__img {
  display: block;
  border-radius: 3px;
}

/* Count badge */
.comp-boon-cov__badge {
  position: absolute;
  bottom: -3px;
  right: -3px;
  background: #0d0d1e;
  color: #f0b870;
  font-size: 7px;
  font-weight: 600;
  border-radius: 2px;
  padding: 0 2px;
  line-height: 12px;
  border: 1px solid #2a2a3e;
  pointer-events: none;
}

/* Boon tooltip */
.comp-boon-tooltip {
  position: fixed;
  z-index: 10000;
  background: #13131f;
  border: 1px solid #3a3a5e;
  border-radius: 5px;
  padding: 7px 10px;
  min-width: 140px;
  max-width: 220px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .65);
  pointer-events: none;
  font-size: 11px;
}

.comp-boon-tooltip__header {
  display: flex;
  align-items: center;
  gap: 5px;
}

.comp-boon-tooltip__name {
  color: #ddd;
  font-weight: 600;
  flex: 1;
}

.comp-boon-tooltip__count {
  color: #778;
  font-size: 10px;
  white-space: nowrap;
}

.comp-boon-tooltip__sep {
  height: 1px;
  background: #2a2a4e;
  margin: 5px 0;
}

.comp-boon-tooltip__providers {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.comp-boon-tooltip__line-group {
  margin-bottom: 4px;
}

.comp-boon-tooltip__line-label {
  font-size: 9px;
  color: #556;
  letter-spacing: .04em;
  margin-bottom: 2px;
}

.comp-boon-tooltip__row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 1px 0 1px 4px;
}

.comp-boon-tooltip__prof {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.comp-boon-tooltip__prof svg {
  width: 14px;
  height: 14px;
}

.comp-boon-tooltip__build-name {
  color: #bbb;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 2: Run all renderer unit tests**

```bash
npx jest tests/unit/renderer/ --no-coverage 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 3: Commit**
```bash
git add src/renderer/styles/comps.css
git commit -m "feat: add comp boon coverage section styles"
```

---

## Manual Verification Checklist

After implementing all tasks, verify in the running app (`npm start` or via build):

- [ ] Comp detail view shows "▾ BOON COVERAGE" header at the bottom of the party lines panel
- [ ] Section is expanded by default when opening a comp
- [ ] Boon icons appear after a brief moment (async load): covered boons full opacity with ×N badge, uncovered dimmed
- [ ] Squad row shows correct aggregate counts across all filled slots
- [ ] Per-line rows (P1, P2 …) appear only for lines with filled slots
- [ ] Hovering a covered squad boon shows a tooltip listing contributors grouped by line
- [ ] Hovering a covered per-line boon shows a flat list of builds in that line
- [ ] Hovering an uncovered boon shows "Not covered"
- [ ] Clicking the header collapses the body (chevron changes ▾ → ▸)
- [ ] Clicking again re-expands
- [ ] Collapse state persists when switching between comps in a session
- [ ] Adding or removing a build from a line updates the coverage (full re-render via onRerender)
- [ ] Comps with no filled slots anywhere show an empty section (no per-line rows, all squad icons dimmed)
