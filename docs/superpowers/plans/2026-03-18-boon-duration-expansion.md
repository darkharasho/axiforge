# Boon Duration Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user clicks a covered boon icon in a per-line boon coverage row, show an inline accordion panel listing every skill/trait source of that boon across all builds in the line, with effective boon duration computed from each build's Concentration stat.

**Architecture:** Extract Concentration computation into a standalone `computeBuildConcentration(build, upgradeCatalog)` function decoupled from `state.editor`. Thread it through `computeCompBoonCoverage` (new 5th param) so each line provider carries its sources with `effectiveDuration`. Add empty expansion divs after each line row in the HTML, populated on click via a new click handler in `bindBoonCoverageEvents`. One expansion open at a time, toggled closed on re-click or ✕.

**Tech Stack:** Vanilla JS ES modules, Jest for unit tests, CSS (no frameworks)

---

## File Map

| File | What changes |
|---|---|
| `src/renderer/modules/stats.js` | New export: `computeBuildConcentration(build, upgradeCatalog)` |
| `src/renderer/modules/comps/comp-boon-coverage.js` | 5th param on `computeCompBoonCoverage`; sources+effectiveDuration on line providers; emit expansion divs in HTML; click handler + `closeDurationExpand` export |
| `src/renderer/modules/comps/comp-detail.js` | Pass `state.upgradeCatalog` as 5th arg; call `closeDurationExpand()` in toggle-boon-coverage handler |
| `src/renderer/styles/comps.css` | New `.comp-boon-cov__duration-expand` and child classes |
| `tests/unit/renderer/stats.test.js` | Tests for `computeBuildConcentration` |
| `tests/unit/renderer/comp-boon-coverage.test.js` | Tests for updated `computeCompBoonCoverage` (sources, effectiveDuration) |

---

## Task 1: `computeBuildConcentration` in stats.js

**Files:**
- Modify: `src/renderer/modules/stats.js`
- Test: `tests/unit/renderer/stats.test.js`

This function mirrors `computeEquipmentStats`'s Concentration logic but takes `(build, upgradeCatalog)` directly instead of reading from `state.editor` and `state.upgradeCatalog`. Always uses land mode (AQUATIC_SLOTS excluded).

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `tests/unit/renderer/stats.test.js`:

```js
const { computeSlotStats, computeEquipmentStats, computeBuildConcentration } = require("../../../src/renderer/modules/stats");
// (update the existing require at line 10 to also import computeBuildConcentration)

// ---------------------------------------------------------------------------
// computeBuildConcentration
// ---------------------------------------------------------------------------

function makeUpgradeCatalog(overrides = {}) {
  return {
    foodById: overrides.foodById || new Map(),
    utilityById: overrides.utilityById || new Map(),
    runeById: overrides.runeById || new Map(),
    infusionById: overrides.infusionById || new Map(),
    enrichmentById: overrides.enrichmentById || new Map(),
  };
}

describe("computeBuildConcentration", () => {
  test("returns 0 when build has no equipment", () => {
    const build = { equipment: null };
    expect(computeBuildConcentration(build, makeUpgradeCatalog())).toBe(0);
  });

  test("returns 0 when build equipment has no slots", () => {
    const build = { equipment: {} };
    expect(computeBuildConcentration(build, makeUpgradeCatalog())).toBe(0);
  });

  test("returns 0 when upgradeCatalog is null (no catalog-dependent sources)", () => {
    // Harrier's gives Concentration, but no catalog needed for slot stats
    const build = { equipment: { slots: { head: "Harrier's" } } };
    // Should still compute slot Concentration even without catalog
    const result = computeBuildConcentration(build, null);
    expect(result).toBeGreaterThan(0);
  });

  test("Harrier's chest adds Concentration from slot stats", () => {
    // Harrier's: Power (primary), Healing Power, Concentration (secondary)
    // chest secondary weight = 96
    const build = { equipment: { slots: { chest: "Harrier's" } } };
    const result = computeBuildConcentration(build, makeUpgradeCatalog());
    expect(result).toBe(96); // chest secondary weight
  });

  test("adds flat Concentration from food buff string", () => {
    const foodDef = { buff: "+40 Concentration" };
    const catalog = makeUpgradeCatalog({
      foodById: new Map([[1001, foodDef]]),
    });
    const build = { equipment: { slots: {}, food: "1001" } };
    expect(computeBuildConcentration(build, catalog)).toBe(40);
  });

  test("returns slot Concentration only when upgradeCatalog is null (rune/food/util skipped)", () => {
    const build = { equipment: { slots: { chest: "Harrier's" }, food: "1001" } };
    // Without catalog, food lookup is skipped
    expect(computeBuildConcentration(build, null)).toBe(96);
  });

  test("accumulates Concentration from multiple sources", () => {
    const foodDef = { buff: "+40 Concentration" };
    const catalog = makeUpgradeCatalog({ foodById: new Map([[1001, foodDef]]) });
    const build = { equipment: { slots: { chest: "Harrier's" }, food: "1001" } };
    // 96 from slot + 40 from food = 136
    expect(computeBuildConcentration(build, catalog)).toBe(136);
  });

  test("excludes aquatic slots (always land mode)", () => {
    // aquatic1 is in AQUATIC_SLOTS — should be excluded
    const build = { equipment: { slots: { aquatic1: "Harrier's" } } };
    expect(computeBuildConcentration(build, makeUpgradeCatalog())).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/unit/renderer/stats.test.js --testNamePattern="computeBuildConcentration" -t "computeBuildConcentration"
```

Expected: FAIL — `computeBuildConcentration is not a function`

- [ ] **Step 3: Implement `computeBuildConcentration` in stats.js**

Add this export after `computeEquipmentStats` (around line 205). This is a parameter-driven extraction of the Concentration-accumulating logic from `computeEquipmentStats`:

```js
/**
 * Compute total Concentration for a given build from its equipment.
 * Always uses land mode (aquatic slots excluded).
 * Returns 0 if build.equipment is absent.
 * Returns slot-only Concentration if upgradeCatalog is null.
 */
export function computeBuildConcentration(build, upgradeCatalog) {
  if (!build?.equipment) return 0;
  const equipment = build.equipment;
  const slots = equipment.slots || {};
  let concentration = 0;

  // Stat combo slots — no catalog needed
  const EXCLUDED = AQUATIC_SLOTS; // always land mode
  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (!comboLabel || EXCLUDED.has(slotKey)) continue;
    const combo = STAT_COMBOS_BY_LABEL.get(comboLabel);
    const w = SLOT_WEIGHTS[slotKey];
    if (!combo || !w) continue;
    const n = combo.stats.length;
    if (n <= 3) {
      if (combo.stats[0] === "Concentration") concentration += w.p;
      else {
        for (let i = 1; i < n; i++) {
          if (combo.stats[i] === "Concentration") concentration += w.s;
        }
      }
    } else if (n === 4) {
      const idx = combo.stats.indexOf("Concentration");
      if (idx === 0) concentration += Math.round(w.p * 0.895);
      else if (idx === 1 || idx === 2) concentration += Math.round(w.s * 0.889);
      else if (idx === 3) concentration += Math.round(w.p * 0.452);
    } else {
      if (combo.stats.includes("Concentration")) concentration += Math.round((w.p + 2 * w.s) / n);
    }
  }

  if (!upgradeCatalog) return concentration;

  // Food
  const foodId = equipment.food;
  if (foodId) {
    const foodDef = upgradeCatalog.foodById?.get(Number(foodId));
    if (foodDef) {
      const re = /\+(\d+)\s+(Concentration|to All Attributes)/g;
      let m;
      while ((m = re.exec(foodDef.buff)) !== null) {
        concentration += Number(m[1]); // both "Concentration" and "to All Attributes" add flat value
      }
    }
  }

  // Infusions (land slots only)
  const infusions = equipment.infusions || {};
  const allInfusionIds = Object.entries(infusions)
    .filter(([k]) => !EXCLUDED.has(k))
    .flatMap(([, v]) => Array.isArray(v) ? v : [v]);
  for (const id of allInfusionIds) {
    if (!id) continue;
    const def = upgradeCatalog.infusionById?.get(Number(id));
    if (def?.infixUpgrade?.attributes) {
      for (const attr of def.infixUpgrade.attributes) {
        const key = attr.attribute === "Healing" ? "HealingPower" : attr.attribute;
        if (key === "Concentration") concentration += attr.modifier || 0;
      }
    }
  }

  // Enrichment
  const enrichmentId = equipment.enrichment;
  if (enrichmentId) {
    const def = upgradeCatalog.enrichmentById?.get(Number(enrichmentId));
    if (def?.infixUpgrade?.attributes) {
      for (const attr of def.infixUpgrade.attributes) {
        if (attr.attribute === "Concentration") concentration += attr.modifier || 0;
      }
    }
  }

  // Runes (exclude breather via EXCLUDED)
  const RUNE_BONUS_RE = /\+(\d+)\s+(Concentration|to All Stats)/;
  const runes = equipment.runes || {};
  const runeCounts = new Map();
  for (const [slot, id] of Object.entries(runes)) {
    if (!id || EXCLUDED.has(slot)) continue;
    runeCounts.set(String(id), (runeCounts.get(String(id)) || 0) + 1);
  }
  for (const [runeId, count] of runeCounts) {
    const runeDef = upgradeCatalog.runeById?.get(Number(runeId));
    if (!runeDef?.bonuses?.length) continue;
    const activeBonuses = runeDef.bonuses.slice(0, Math.min(count, 6));
    for (const bonus of activeBonuses) {
      const m = RUNE_BONUS_RE.exec(bonus);
      if (!m) continue;
      concentration += Number(m[1]);
    }
  }

  // Utility
  const utilityId = equipment.utility;
  if (utilityId) {
    const utilDef = upgradeCatalog.utilityById?.get(Number(utilityId));
    if (utilDef) {
      // Pattern 1: "Gain Concentration Equal to N% of Your X"
      const convRe = /Gain Concentration Equal to (\d+(?:\.\d+)?)% of Your (Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|Condition Damage|Healing Power)/g;
      // For conversion utilities we'd need the base totals — skip for now, not common for Concentration
      // Pattern 2: conditional flat
      const writRe = /Gain (\d+) Concentration When Health/g;
      let m;
      while ((m = writRe.exec(utilDef.buff)) !== null) concentration += Number(m[1]);
      // Pattern 3: flat
      const flatRe = /\+(\d+)\s+Concentration/g;
      while ((m = flatRe.exec(utilDef.buff)) !== null) concentration += Number(m[1]);
    }
  }

  return concentration;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest tests/unit/renderer/stats.test.js -t "computeBuildConcentration"
```

Expected: All `computeBuildConcentration` tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npx jest tests/unit/renderer/stats.test.js
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/stats.js tests/unit/renderer/stats.test.js
git commit -m "feat: add computeBuildConcentration to stats.js"
```

---

## Task 2: Thread `upgradeCatalog` + sources into `computeCompBoonCoverage`

**Files:**
- Modify: `src/renderer/modules/comps/comp-boon-coverage.js`
- Test: `tests/unit/renderer/comp-boon-coverage.test.js`

Add `upgradeCatalog` as a 5th parameter to `computeCompBoonCoverage`. For each build, compute `concentrationBonus = computeBuildConcentration(build, upgradeCatalog) / 1500`. Store sources with `effectiveDuration` on line-scope providers. Squad providers remain unchanged.

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/renderer/comp-boon-coverage.test.js` (after existing tests):

```js
// Helper: build a catalog with upgradeCatalog (empty — no Concentration gear)
function makeUpgradeCatalog() {
  return {
    foodById: new Map(), utilityById: new Map(), runeById: new Map(),
    infusionById: new Map(), enrichmentById: new Map(),
  };
}

describe("computeCompBoonCoverage — sources and effectiveDuration on line providers", () => {
  test("line providers include sources array with effectiveDuration", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    // makeMightSkill has duration: 10, apply_count: 5
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const upgradeCatalog = makeUpgradeCatalog(); // no Concentration gear → bonus = 0
    const { lines } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog, upgradeCatalog);

    const mightEntry = lines[0].boons.get("Might");
    expect(mightEntry).toBeDefined();
    const provider = mightEntry.providers[0];
    expect(provider.sources).toBeDefined();
    expect(provider.sources).toHaveLength(1);
    expect(provider.sources[0]).toMatchObject({
      type: "skill",
      name: "Healing Surge",
      stacks: 5,
      effectiveDuration: 10, // base 10s * (1 + 0) = 10s, no concentration
    });
  });

  test("effectiveDuration is multiplied by concentrationBonus from gear", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    // Give build Harrier's chest — gives 96 Concentration
    build.equipment.slots = { chest: "Harrier's" };

    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    // makeMightSkill: duration: 10
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const upgradeCatalog = makeUpgradeCatalog();
    const { lines } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog, upgradeCatalog);

    const provider = lines[0].boons.get("Might").providers[0];
    // 96 Concentration → 96/1500 = 0.064 → 10 * 1.064 = 10.6
    expect(provider.sources[0].effectiveDuration).toBeCloseTo(10.6, 1);
  });

  test("sources with duration 0 are filtered out", async () => {
    // makeFurySkill has duration: 6, but we'll use a skill with duration: 0
    const zeroDurationSkill = {
      id: 300, name: "Zero Dur Skill",
      description: "Grant Might to allies.",
      facts: [{ type: "Buff", status: "Might", duration: 0, apply_count: 3 }],
      type: "Utility",
    };
    const build = makeBuild("b1", "Guardian");
    build.skills.utilityIds = [300, 0, 0];
    const catalog = makeCatalog(new Map([[300, zeroDurationSkill]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { lines } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog, makeUpgradeCatalog());

    // Might is provided (boon exists) but its source has duration 0 — filtered from sources
    const mightEntry = lines[0].boons.get("Might");
    if (mightEntry) {
      const provider = mightEntry.providers[0];
      if (provider?.sources) {
        expect(provider.sources.every(s => s.effectiveDuration > 0)).toBe(true);
      }
    }
    // The boon itself may still be counted — only sources are filtered
  });

  test("squad providers do NOT include sources", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog, makeUpgradeCatalog());

    const squadProvider = squad.get("Might").providers[0];
    expect(squadProvider.sources).toBeUndefined();
  });

  test("works with upgradeCatalog as undefined (backward compat)", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    // Call without 5th param — should not throw
    const { lines } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);
    expect(lines[0].boons.get("Might")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/unit/renderer/comp-boon-coverage.test.js -t "sources and effectiveDuration"
```

Expected: FAIL — providers don't have `sources`.

- [ ] **Step 3: Update `computeCompBoonCoverage` in comp-boon-coverage.js**

Add the import for `computeBuildConcentration` at the top:

```js
import { computeBuildConcentration } from "../stats.js";
```

Update the function signature and inner loop (lines 13–87 in current file). Key changes:

1. New 5th param: `upgradeCatalog = null`
2. Per-build: compute `concentrationBonus`
3. Per-boon: build `sources` array with `effectiveDuration`, attach to line provider

```js
export async function computeCompBoonCoverage(comp, builds, catalogCache, getCatalog, upgradeCatalog = null) {
  // ... existing catalog warm-up code unchanged ...

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = `P${i + 1}`;
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

      // Concentration bonus for effective duration
      const concentrationBonus = computeBuildConcentration(build, upgradeCatalog) / 1500;

      let eliteSpec = null;
      for (const spec of build.specializations || []) {
        if (spec?.elite && spec?.name) { eliteSpec = spec.name; break; }
        const specId = Number(spec?.specializationId || spec?.id) || 0;
        if (!specId) continue;
        const specData = catalog.specializationById?.get(specId);
        if (specData?.elite) { eliteSpec = specData.name || null; break; }
      }

      for (const boon of coverage.boons) {
        if (!lineBoonMap.has(boon.name)) {
          lineBoonMap.set(boon.name, { count: 0, providers: [] });
        }
        const lineEntry = lineBoonMap.get(boon.name);
        lineEntry.count++;

        // Build sources with effectiveDuration (filter out zero-duration entries)
        const sources = (boon.sources || [])
          .filter(s => s.duration > 0)
          .map(s => ({
            type: s.type,
            name: s.name,
            stacks: s.stacks,
            effectiveDuration: +((s.duration * (1 + concentrationBonus)).toFixed(1)),
          }));

        lineEntry.providers.push({ buildId, buildName, profession: build.profession, eliteSpec, sources });

        // Squad map — unchanged, no sources
        if (!squadMap.has(boon.name)) {
          squadMap.set(boon.name, { count: 0, providers: [] });
        }
        const squadEntry = squadMap.get(boon.name);
        squadEntry.count++;
        squadEntry.providers.push({ buildId, buildName, lineLabel: label, profession: build.profession, eliteSpec });
      }
    }

    lineResults.push({ lineId: line.id, label, hasFilledSlots, boons: lineBoonMap });
  }

  return { squad: squadMap, lines: lineResults };
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/renderer/comp-boon-coverage.test.js
```

Expected: All tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/comps/comp-boon-coverage.js tests/unit/renderer/comp-boon-coverage.test.js
git commit -m "feat: add effectiveDuration sources to line providers in computeCompBoonCoverage"
```

---

## Task 3: Pass `upgradeCatalog` from comp-detail.js

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js` (around line 471)

Small call-site update. No new tests needed — existing comp-boon-coverage and comp-detail behavior is unchanged.

- [ ] **Step 1: Update the call to `computeCompBoonCoverage` in comp-detail.js**

Find this block (around line 471):

```js
data = await computeCompBoonCoverage(
  comp, state.builds, state.catalogCache, _callbacks.getCatalog
);
```

Change to:

```js
data = await computeCompBoonCoverage(
  comp, state.builds, state.catalogCache, _callbacks.getCatalog, state.upgradeCatalog
);
```

- [ ] **Step 2: Run full renderer test suite to check for regressions**

```bash
npx jest tests/unit/renderer/
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js
git commit -m "feat: pass upgradeCatalog to computeCompBoonCoverage in comp-detail"
```

---

## Task 4: HTML — emit expansion divs + mark line icons as clickable

**Files:**
- Modify: `src/renderer/modules/comps/comp-boon-coverage.js` — `buildBoonCoverageHTML()` and `_renderIconRow()`

After each `.comp-boon-cov__line-row`, emit a sibling expansion div (empty, hidden). Mark line-scope icons `data-clickable="true"` so the click handler can target them distinctly from squad icons.

- [ ] **Step 1: Update `_renderIconRow` — add `data-clickable` on line-scope icons**

In `_renderIconRow`, the current icon div is:

```js
return `
  <div class="comp-boon-cov__icon ${covered ? "" : "comp-boon-cov__icon--uncovered"}"
       data-scope="${scope}"
       data-boon-name="${escapeHtml(boonName)}"
       data-count="${count}"
       data-providers="${providersJson}"
       ${lineLabel ? `data-line-label="${escapeHtml(lineLabel)}"` : ""}>
```

Add `data-clickable` for covered line-scope icons only:

```js
const isClickable = scope === "line" && covered;
return `
  <div class="comp-boon-cov__icon ${covered ? "" : "comp-boon-cov__icon--uncovered"}"
       data-scope="${scope}"
       ${isClickable ? 'data-clickable="true"' : ""}
       data-boon-name="${escapeHtml(boonName)}"
       data-count="${count}"
       data-providers="${providersJson}"
       ${lineLabel ? `data-line-label="${escapeHtml(lineLabel)}"` : ""}>
```

- [ ] **Step 2: Update `buildBoonCoverageHTML` — emit expansion divs after each line row**

Current line rows block (around line 96–107):

```js
const lineRowsHtml = lines
  .filter((l) => l.hasFilledSlots)
  .map(
    (line) => `
    <div class="comp-boon-cov__line-row">
      <span class="comp-boon-cov__line-label">${escapeHtml(line.label)}</span>
      <div class="comp-boon-cov__icons">
        ${_renderIconRow(line.boons, "line", "28", line.label)}
      </div>
    </div>`
  )
  .join("");
```

Update to emit sibling expansion div:

```js
const lineRowsHtml = lines
  .filter((l) => l.hasFilledSlots)
  .map(
    (line) => `
    <div class="comp-boon-cov__line-row">
      <span class="comp-boon-cov__line-label">${escapeHtml(line.label)}</span>
      <div class="comp-boon-cov__icons">
        ${_renderIconRow(line.boons, "line", "28", line.label)}
      </div>
    </div>
    <div class="comp-boon-cov__duration-expand" data-line-label="${escapeHtml(line.label)}" hidden></div>`
  )
  .join("");
```

- [ ] **Step 3: Run tests to confirm nothing broke**

```bash
npx jest tests/unit/renderer/comp-boon-coverage.test.js
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/comps/comp-boon-coverage.js
git commit -m "feat: emit expansion divs and mark clickable line boon icons in HTML"
```

---

## Task 5: Click event handling — toggle, populate, tooltip suppression

**Files:**
- Modify: `src/renderer/modules/comps/comp-boon-coverage.js` — `bindBoonCoverageEvents()`, new module-level state, new exports

This is the core interactive logic. No unit tests possible for DOM events in this project's test setup — manual testing is the verification step.

- [ ] **Step 1: Add module-level state and `_closeDurationExpand` / `closeDurationExpand`**

Below the existing `let _activeBoonTooltip = null;` (around line 143), add:

```js
let _activeDurationExpand = null; // { expandEl: HTMLElement, iconEl: HTMLElement } | null

function _closeDurationExpand() {
  if (!_activeDurationExpand) return;
  _activeDurationExpand.expandEl.hidden = true;
  _activeDurationExpand.iconEl.classList.remove("comp-boon-cov__icon--active");
  _activeDurationExpand = null;
}

export function closeDurationExpand() { _closeDurationExpand(); }
```

- [ ] **Step 2: Add helper to build expansion inner HTML**

Add `_buildDurationExpandHTML(boonName, lineLabel, providers)` below `_buildTooltipHTML`:

```js
function _buildDurationExpandHTML(boonName, lineLabel, providers) {
  const icon = BOON_CONDITION_ICONS[boonName] || "";

  const buildBlocks = providers
    .filter(p => p.sources && p.sources.length > 0)
    .map((p, i, arr) => {
      const profSvg = _getProfSvg(p.profession, p.eliteSpec);
      const sourceRows = p.sources.map(s => {
        const typeClass = s.type === "skill" ? "comp-boon-cov__dur-type--skill" : "comp-boon-cov__dur-type--trait";
        const typeLabel = s.type === "skill" ? "SKILL" : "TRAIT";
        const dur = Number.isInteger(s.effectiveDuration)
          ? `${s.effectiveDuration}s`
          : `${s.effectiveDuration}s`;
        const stacksHtml = s.stacks > 1
          ? `<span class="comp-boon-cov__dur-stacks">&times;${s.stacks}</span>`
          : "";
        return `<div class="comp-boon-cov__dur-source">
          <span class="comp-boon-cov__dur-type ${typeClass}">${typeLabel}</span>
          <span class="comp-boon-cov__dur-source-name">${escapeHtml(s.name)}</span>
          <span class="comp-boon-cov__dur-duration">${escapeHtml(dur)}</span>
          ${stacksHtml}
        </div>`;
      }).join("");
      const sep = i < arr.length - 1 ? '<div class="comp-boon-cov__dur-sep"></div>' : "";
      return `<div class="comp-boon-cov__dur-build">
        <div class="comp-boon-cov__dur-build-header">
          <span class="comp-boon-cov__dur-prof">${profSvg}</span>
          <span class="comp-boon-cov__dur-build-name">${escapeHtml(p.buildName)}</span>
        </div>
        <div class="comp-boon-cov__dur-sources">${sourceRows}</div>
      </div>${sep}`;
    }).join("");

  // lineLabel is passed from iconEl.dataset.lineLabel (e.g. "P1")
  return `
    <div class="comp-boon-cov__dur-header">
      <img class="comp-boon-cov__dur-boon-icon" src="${escapeHtml(icon)}" width="18" height="18" alt="${escapeHtml(boonName)}">
      <span class="comp-boon-cov__dur-boon-name">${escapeHtml(boonName)}</span>
      <span class="comp-boon-cov__dur-line-label">${escapeHtml(lineLabel)}</span>
      <button class="comp-boon-cov__dur-close" aria-label="Close">&#x2715;</button>
    </div>
    ${buildBlocks}
  `;
}
```

- [ ] **Step 3: Update `bindBoonCoverageEvents` to wire click handlers**

In `bindBoonCoverageEvents(container)`, after the existing `mouseenter`/`mouseleave` loop, add:

```js
// ── Click handler for per-line boon icons ──────────────────────
container.querySelectorAll('.comp-boon-cov__icon[data-clickable="true"]').forEach((iconEl) => {
  iconEl.addEventListener("click", (e) => {
    e.stopPropagation();

    // Toggle: clicking the active icon closes it
    if (_activeDurationExpand?.iconEl === iconEl) {
      _closeDurationExpand();
      return;
    }

    // Close any existing expansion
    _closeDurationExpand();

    // Find the expansion div (next sibling of the parent .comp-boon-cov__line-row)
    const lineRow = iconEl.closest(".comp-boon-cov__line-row");
    const expandEl = lineRow?.nextElementSibling;
    if (!expandEl || !expandEl.classList.contains("comp-boon-cov__duration-expand")) return;

    // Parse providers and populate expansion
    let providers = [];
    try { providers = JSON.parse(iconEl.dataset.providers || "[]"); } catch (_) { /* ignore */ }
    const boonName = iconEl.dataset.boonName;
    const lineLabel = iconEl.dataset.lineLabel || "";

    expandEl.innerHTML = _buildDurationExpandHTML(boonName, lineLabel, providers);
    expandEl.hidden = false;
    iconEl.classList.add("comp-boon-cov__icon--active");
    _activeDurationExpand = { expandEl, iconEl };

    // Wire the close button inside the expansion
    expandEl.querySelector(".comp-boon-cov__dur-close")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      _closeDurationExpand();
    });
  });
});
```

- [ ] **Step 4: Update the existing `mouseenter` handler to suppress tooltip on the active icon**

Inside the existing `mouseenter` callback (around line 158), add a guard at the top:

```js
iconEl.addEventListener("mouseenter", () => {
  // Suppress tooltip if this icon has its expansion open
  if (_activeDurationExpand?.iconEl === iconEl) return;
  _closeBoonTooltip();
  // ... rest of existing tooltip code unchanged ...
```

- [ ] **Step 5: Manual smoke test**

Run the app:
```bash
npm run dev
```

1. Open a comp with at least one filled party line.
2. Wait for boon coverage to load.
3. Click a covered boon icon in a party line (e.g. Might under P1).
4. Verify: expansion panel appears below the P1 row showing builds and sources with durations.
5. Click the same icon again — verify panel closes.
6. Click a different boon icon — verify old panel closes and new one opens.
7. Click ✕ — verify panel closes.
8. Hover over the active boon icon while expanded — verify no tooltip appears.
9. Hover over a different boon icon while expansion open — verify tooltip shows normally.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/comps/comp-boon-coverage.js
git commit -m "feat: wire boon duration expansion click handler in bindBoonCoverageEvents"
```

---

## Task 6: Close expansion when boon coverage section is collapsed

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js` (toggle-boon-coverage handler, ~line 987)
- Modify: `src/renderer/modules/comps/comp-boon-coverage.js` — update import in comp-detail.js

`closeDurationExpand` is already exported from `comp-boon-coverage.js` (added in Task 5). Just call it in the existing toggle handler.

- [ ] **Step 1: Update the import in comp-detail.js**

Find the existing import (line 8):

```js
import { computeCompBoonCoverage, buildBoonCoverageHTML, bindBoonCoverageEvents, closeBoonTooltip } from "./comp-boon-coverage.js";
```

Add `closeDurationExpand`:

```js
import { computeCompBoonCoverage, buildBoonCoverageHTML, bindBoonCoverageEvents, closeBoonTooltip, closeDurationExpand } from "./comp-boon-coverage.js";
```

- [ ] **Step 2: Update the toggle-boon-coverage click handler**

Find the handler (around line 987):

```js
container.querySelector("[data-action='toggle-boon-coverage']")?.addEventListener("click", () => {
  state.compPrefs.boonCoverageCollapsed = !state.compPrefs.boonCoverageCollapsed;
  // ...
```

Add `closeDurationExpand()` as the first line:

```js
container.querySelector("[data-action='toggle-boon-coverage']")?.addEventListener("click", () => {
  closeDurationExpand();
  state.compPrefs.boonCoverageCollapsed = !state.compPrefs.boonCoverageCollapsed;
  // ... rest unchanged ...
```

- [ ] **Step 3: Manual smoke test**

1. Open a comp, click a boon icon to open the expansion.
2. Click the BOON COVERAGE chevron to collapse the section.
3. Verify: expansion closes before the section collapses (icon loses active state).
4. Expand the section again — verify no stale expansion is shown.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js
git commit -m "feat: close boon duration expansion when boon coverage section is collapsed"
```

---

## Task 7: CSS for the expansion panel

**Files:**
- Modify: `src/renderer/styles/comps.css` (after the existing `.comp-boon-cov__badge` block, around line 1350+)

- [ ] **Step 1: Add CSS classes**

Append after the existing `comp-boon-cov` block:

```css
/* ── Boon Duration Expansion ──────────────────────────────────── */

.comp-boon-cov__icon--active .comp-boon-cov__img {
  outline: 1.5px solid #6c5ce7;
  outline-offset: 1px;
  border-radius: 3px;
  box-shadow: 0 0 6px #6c5ce766;
}

.comp-boon-cov__duration-expand {
  border-left: 2px solid #6c5ce7;
  background: #14141e;
  padding: 8px 12px 10px 12px;
  border-bottom: 1px solid #1a1a3a;
}

.comp-boon-cov__dur-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.comp-boon-cov__dur-boon-icon {
  border-radius: 3px;
  flex-shrink: 0;
}

.comp-boon-cov__dur-boon-name {
  font-size: 11px;
  font-weight: 700;
  color: #ccd;
}

.comp-boon-cov__dur-line-label {
  font-size: 9px;
  color: #445;
  font-weight: 600;
  letter-spacing: .04em;
}

.comp-boon-cov__dur-close {
  margin-left: auto;
  background: none;
  border: none;
  color: #445;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
}

.comp-boon-cov__dur-close:hover {
  color: #889;
}

.comp-boon-cov__dur-build {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.comp-boon-cov__dur-build-header {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 3px;
}

.comp-boon-cov__dur-prof {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.comp-boon-cov__dur-prof svg {
  width: 16px;
  height: 16px;
}

.comp-boon-cov__dur-build-name {
  font-size: 11px;
  font-weight: 600;
  color: #aab;
}

.comp-boon-cov__dur-sources {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-left: 21px;
}

.comp-boon-cov__dur-source {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 1px 3px;
  border-radius: 3px;
}

.comp-boon-cov__dur-source:hover {
  background: #1e1e2e;
}

.comp-boon-cov__dur-type {
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .04em;
  padding: 1px 4px;
  border-radius: 3px;
  flex-shrink: 0;
}

.comp-boon-cov__dur-type--skill {
  background: #1a2e20;
  color: #4caf82;
}

.comp-boon-cov__dur-type--trait {
  background: #241a33;
  color: #a78bfa;
}

.comp-boon-cov__dur-source-name {
  font-size: 10px;
  color: #99a;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.comp-boon-cov__dur-duration {
  font-size: 10px;
  font-weight: 700;
  color: #c89b3c;
  white-space: nowrap;
  flex-shrink: 0;
}

.comp-boon-cov__dur-stacks {
  font-size: 9px;
  color: #556;
  white-space: nowrap;
  flex-shrink: 0;
}

.comp-boon-cov__dur-sep {
  height: 1px;
  background: #1a1a3a;
  margin: 5px 0;
}
```

- [ ] **Step 2: Manual visual test**

Run the app (`npm run dev`), open a comp with filled party lines, and verify:

- Expansion panel has a purple left border, dark background.
- Header: boon icon + name + ✕ button aligned to the right.
- Each build has a profession icon, build name, and indented source rows.
- SKILL pill is green, TRAIT pill is purple.
- Duration value is gold/amber.
- Active boon icon has a purple outline.
- Separator between builds is visible when multiple builds.

- [ ] **Step 3: Run full test suite one final time**

```bash
npx jest
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/styles/comps.css
git commit -m "feat: add CSS for boon duration expansion panel"
```
