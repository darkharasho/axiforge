# Mini Build Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a reusable mini build card component that displays spec lines, weapons, stats/rune, relic, tags, role badge, and game mode — then integrate it into the comp detail page's build pool.

**Architecture:** New standalone module (`mini-build-card.js`) + stylesheet (`mini-build-card.css`). Helper functions currently local to `comp-detail.js` get extracted to a shared `build-helpers.js` module. The comp detail page swaps `renderPoolCard()` for the new component. Drag-drop selector updated from `.comp-pool-card` to `.mini-card`.

**Tech Stack:** Vanilla JS (ES modules), CSS, no frameworks.

**Spec:** `docs/superpowers/specs/2026-03-19-mini-build-card-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/renderer/modules/build-helpers.js` | Shared helpers extracted from `comp-detail.js`: `getSpecIcon`, `getEliteSpecName`, `getDisplayName`, `resolveStatPackage`, `getRuneName`, `profClass` |
| Create | `src/renderer/modules/mini-build-card.js` | `renderMiniBuildCard(build, catalog, options)` + internal helpers `getSpecLineNames`, `getWeaponSetNames` |
| Create | `src/renderer/styles/mini-build-card.css` | All `.mini-card*` styles |
| Modify | `src/renderer/styles.css` | Add `@import "./styles/mini-build-card.css"` |
| Modify | `src/renderer/modules/comps/comp-detail.js` | Import from `build-helpers.js` and `mini-build-card.js`, replace `renderPoolCard()` call, remove extracted helpers |
| Modify | `src/renderer/modules/comps/comp-drag-drop.js` | Update draggable selector from `.comp-pool-card` to `.mini-card` |
| Modify | `src/renderer/styles/comps.css` | Remove old `.comp-pool-card*` styles |

---

### Task 1: Extract shared helpers to `build-helpers.js`

**Files:**
- Create: `src/renderer/modules/build-helpers.js`
- Modify: `src/renderer/modules/comps/comp-detail.js`

These functions are currently local to `comp-detail.js` and need to be importable by the new mini-build-card module. Extract them unchanged.

- [ ] **Step 1: Create `build-helpers.js` with extracted functions**

```javascript
// Shared build display helpers — extracted from comp-detail.js for reuse.

import { getProfessionSvg } from "./profession-icons.js";

export function getEliteSpecName(build) {
  if (!build.specializations) return null;
  for (const s of build.specializations) {
    if (s.elite && s.name) return s.name;
  }
  return null;
}

export function getSpecIcon(build) {
  const eliteSpec = getEliteSpecName(build);
  const name = eliteSpec || build.profession;
  if (!name) return "";
  return getProfessionSvg(name) || "";
}

export function profClass(profession) {
  if (!profession) return "";
  return `lib-prof--${profession.toLowerCase()}`;
}

export function getDisplayName(build) {
  const elite = getEliteSpecName(build);
  return build.title || elite || build.profession || "Untitled";
}

export function resolveStatPackage(build) {
  const pkg = build.equipment?.statPackage || "";
  if (pkg && !/^\d+$/.test(pkg)) return pkg;

  const slots = build.equipment?.slots;
  if (slots && typeof slots === "object") {
    const counts = {};
    for (const v of Object.values(slots)) {
      if (v && typeof v === "string") counts[v] = (counts[v] || 0) + 1;
    }
    let best = "";
    let bestCount = 0;
    for (const [label, count] of Object.entries(counts)) {
      if (count > bestCount) { best = label; bestCount = count; }
    }
    if (best) return best;
  }

  return "";
}

export function getRuneName(build, upgradeCatalog) {
  const runes = build.equipment?.runes;
  if (!runes || typeof runes !== "object") return "";
  const counts = {};
  for (const v of Object.values(runes)) {
    if (v) counts[String(v)] = (counts[String(v)] || 0) + 1;
  }
  let bestId = "";
  let bestCount = 0;
  for (const [id, count] of Object.entries(counts)) {
    if (count > bestCount) { bestId = id; bestCount = count; }
  }
  if (!bestId) return "";

  const runeDef = upgradeCatalog?.runeById?.get(Number(bestId));
  if (runeDef?.name) {
    return runeDef.name.replace(/^(?:Superior|Major|Minor) Rune of (?:the )?/i, "");
  }

  return /^\d+$/.test(bestId) ? "" : bestId;
}
```

Note: `getRuneName` changes signature — it now takes `upgradeCatalog` as a parameter instead of accessing `state.upgradeCatalog` directly. This makes it pure and reusable outside the main app (e.g., in the SPA).

- [ ] **Step 2: Update `comp-detail.js` to import from `build-helpers.js`**

At the top of `comp-detail.js`, add the import:

```javascript
import {
  getEliteSpecName,
  getSpecIcon,
  profClass,
  getDisplayName,
  resolveStatPackage,
  getRuneName,
} from "../build-helpers.js";
```

Remove the local function definitions for all six functions (lines ~254-397 of `comp-detail.js`).

Update all call sites of `getRuneName(build)` to pass the catalog: `getRuneName(build, state.upgradeCatalog)`.

- [ ] **Step 3: Verify the app still works**

Run the app with `npm start`. Open the comp detail page. Confirm pool cards render exactly as before — no visual changes at this point.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/build-helpers.js src/renderer/modules/comps/comp-detail.js
git commit -m "refactor: extract shared build helpers from comp-detail.js"
```

---

### Task 2: Create `mini-build-card.css`

**Files:**
- Create: `src/renderer/styles/mini-build-card.css`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Create the stylesheet**

```css
/* ── Mini Build Card ─────────────────────────────────────────────────────────
   Reusable compact card showing build summary: specs, weapons, gear, relic.
   ──────────────────────────────────────────────────────────────────────────── */

.mini-card {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  background: #12122a;
  border-radius: 6px;
  cursor: grab;
  border-left: 3px solid currentColor;
  position: relative;
  transition: background 0.12s;
}

.mini-card:hover {
  background: #181838;
}

/* ── Icon ──────────────────────────────────────────────────────────────────── */

.mini-card__icon {
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 2px;
}

.mini-card__icon svg {
  width: 24px;
  height: 24px;
}

/* ── Info area ─────────────────────────────────────────────────────────────── */

.mini-card__info {
  flex: 1;
  min-width: 0;
}

/* ── Header row: name + tags + role + mode ─────────────────────────────────── */

.mini-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mini-card__name {
  font-size: 13px;
  color: #ddd;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-card__tag {
  font-size: 9px;
  border-radius: 8px;
  padding: 1px 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #aab;
  white-space: nowrap;
  flex-shrink: 0;
}

.mini-card__mode {
  font-size: 9px;
  color: #778;
  background: #0d0d22;
  border-radius: 8px;
  padding: 1px 6px;
  flex-shrink: 0;
}

/* ── Detail rows ───────────────────────────────────────────────────────────── */

.mini-card__detail-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.mini-card__detail-label {
  font-size: 9px;
  color: #556;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  min-width: 36px;
  flex-shrink: 0;
}

/* ── Spec pips ─────────────────────────────────────────────────────────────── */

.mini-card__spec-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mini-card__spec-pip {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(136, 153, 187, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 600;
  color: #8899bb;
  flex-shrink: 0;
}

.mini-card__spec-pip--elite {
  background: rgba(255, 200, 80, 0.15);
  color: #ffc850;
  border: 1px solid rgba(255, 200, 80, 0.25);
}

.mini-card__spec-name {
  font-size: 11px;
  color: #8899bb;
}

.mini-card__spec-name--elite {
  color: #ddc070;
  font-weight: 500;
}

.mini-card__spec-sep {
  color: #334;
  margin: 0 2px;
  font-size: 10px;
}

/* ── Weapon group ──────────────────────────────────────────────────────────── */

.mini-card__weap-group {
  display: flex;
  align-items: center;
  gap: 3px;
}

.mini-card__weap-name {
  font-size: 11px;
  color: #99aa88;
}

.mini-card__weap-div {
  color: #334;
  margin: 0 4px;
  font-size: 11px;
}

/* ── Gear icons & text ─────────────────────────────────────────────────────── */

.mini-card__gear-icon {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  flex-shrink: 0;
}

.mini-card__gear-icon--stat {
  background: rgba(200, 169, 110, 0.15);
  color: #c8a96e;
}

.mini-card__gear-icon--rune {
  background: rgba(153, 153, 170, 0.12);
  color: #99a;
}

.mini-card__gear-icon--relic {
  background: rgba(170, 136, 204, 0.12);
  color: #aa88cc;
}

.mini-card__stat {
  font-size: 11px;
  color: #c8a96e;
}

.mini-card__equip {
  font-size: 11px;
  color: #99a;
}

.mini-card__relic {
  font-size: 11px;
  color: #aa88cc;
}

.mini-card__sep {
  font-size: 11px;
  color: #334;
  margin: 0 3px;
}

/* ── Action buttons ────────────────────────────────────────────────────────── */

.mini-card__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 2px;
}

.mini-card__btn-open,
.mini-card__btn-remove {
  all: unset;
  cursor: pointer;
  font-size: 14px;
  color: #667;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}

.mini-card__btn-open:hover {
  color: #aaa;
  background: rgba(255, 255, 255, 0.07);
}

.mini-card__btn-remove:hover {
  color: #e55;
  background: rgba(238, 85, 85, 0.12);
}

/* ── Missing variant ───────────────────────────────────────────────────────── */

.mini-card--missing {
  opacity: 0.5;
  border-left-color: #444;
  cursor: default;
}

.mini-card__icon--missing {
  color: #555;
  font-size: 14px;
  font-weight: 600;
}

.mini-card__name--missing {
  color: #666;
  font-style: italic;
}
```

- [ ] **Step 2: Add the import to `styles.css`**

Add this line after the `comps.css` import (line 18):

```css
@import "./styles/mini-build-card.css";
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/mini-build-card.css src/renderer/styles.css
git commit -m "feat: add mini-build-card stylesheet"
```

---

### Task 3: Create `mini-build-card.js`

**Files:**
- Create: `src/renderer/modules/mini-build-card.js`

- [ ] **Step 1: Create the module**

```javascript
// Mini Build Card — reusable compact build summary card.

import { escapeHtml } from "./utils.js";
import { GW2_WEAPONS_BY_ID } from "./constants.js";
import {
  getSpecIcon,
  profClass,
  getDisplayName,
  resolveStatPackage,
  getRuneName,
} from "./build-helpers.js";
import { roleBadgeHtml } from "./roleEstimator.js";

/**
 * Return array of { name, isElite } for each specialization on the build.
 */
function getSpecLineNames(build) {
  if (!build.specializations) return [];
  return build.specializations
    .filter((s) => s && s.name)
    .map((s) => ({ name: s.name, isElite: !!s.elite }));
}

/**
 * Return array of weapon set display strings, e.g. ["Axe / Shield", "Staff"].
 * Skips empty sets.
 */
function getWeaponSetNames(build) {
  const weaps = build.equipment?.weapons;
  if (!weaps) return [];

  const resolve = (id) => {
    if (!id) return null;
    const w = GW2_WEAPONS_BY_ID.get(id);
    return w ? w.label : id; // fallback to raw id
  };

  const sets = [];

  // Set 1
  const mh1 = resolve(weaps.mainhand1);
  const oh1 = resolve(weaps.offhand1);
  if (mh1 || oh1) {
    sets.push([mh1, oh1].filter(Boolean).join(" / "));
  }

  // Set 2
  const mh2 = resolve(weaps.mainhand2);
  const oh2 = resolve(weaps.offhand2);
  if (mh2 || oh2) {
    sets.push([mh2, oh2].filter(Boolean).join(" / "));
  }

  return sets;
}

/**
 * Render a mini build card as an HTML string.
 *
 * @param {Object} build - Build object from state
 * @param {Object} upgradeCatalog - state.upgradeCatalog (for rune name resolution)
 * @param {Object} [options]
 * @param {boolean} [options.showActions=true] - Show open/remove buttons
 * @param {boolean} [options.showMode=true] - Show game mode pill
 * @returns {string} HTML string
 */
export function renderMiniBuildCard(build, upgradeCatalog, options = {}) {
  const { showActions = true, showMode = true } = options;

  const icon = getSpecIcon(build);
  const pClass = profClass(build.profession);
  const name = escapeHtml(getDisplayName(build));
  const gameMode = build.gameMode || "pve";

  // Tag pills
  const tagPills = (build.tags || [])
    .map((t) => `<span class="mini-card__tag">${escapeHtml(t)}</span>`)
    .join("");

  // Role badge
  const role = roleBadgeHtml(build, upgradeCatalog);

  // Mode pill
  const modePill = showMode
    ? `<span class="mini-card__mode">${escapeHtml(gameMode)}</span>`
    : "";

  // Spec line
  const specs = getSpecLineNames(build);
  let specRowHtml = "";
  if (specs.length) {
    const specPips = specs.map((s, i) => {
      const pipClass = s.isElite ? "mini-card__spec-pip mini-card__spec-pip--elite" : "mini-card__spec-pip";
      const nameClass = s.isElite ? "mini-card__spec-name mini-card__spec-name--elite" : "mini-card__spec-name";
      const letter = escapeHtml(s.name.charAt(0).toUpperCase());
      const sep = i < specs.length - 1 ? `<span class="mini-card__spec-sep">›</span>` : "";
      return `<span class="${pipClass}">${letter}</span><span class="${nameClass}">${escapeHtml(s.name)}</span>${sep}`;
    }).join("");

    specRowHtml = `
      <div class="mini-card__detail-row">
        <span class="mini-card__detail-label">Specs</span>
        <div class="mini-card__spec-group">${specPips}</div>
      </div>`;
  }

  // Weapon line
  const weaponSets = getWeaponSetNames(build);
  let weapRowHtml = "";
  if (weaponSets.length) {
    const weapHtml = weaponSets
      .map((s) => `<span class="mini-card__weap-name">${escapeHtml(s)}</span>`)
      .join(`<span class="mini-card__weap-div">|</span>`);

    weapRowHtml = `
      <div class="mini-card__detail-row">
        <span class="mini-card__detail-label">Weap</span>
        <div class="mini-card__weap-group">${weapHtml}</div>
      </div>`;
  }

  // Gear line (stat + rune)
  const statPackage = resolveStatPackage(build);
  const runeName = getRuneName(build, upgradeCatalog);
  let gearRowHtml = "";
  if (statPackage || runeName) {
    const parts = [];
    if (statPackage) {
      parts.push(`<span class="mini-card__gear-icon mini-card__gear-icon--stat">◆</span>`);
      parts.push(`<span class="mini-card__stat">${escapeHtml(statPackage)}</span>`);
    }
    if (statPackage && runeName) {
      parts.push(`<span class="mini-card__sep">&middot;</span>`);
    }
    if (runeName) {
      parts.push(`<span class="mini-card__gear-icon mini-card__gear-icon--rune">ᚱ</span>`);
      parts.push(`<span class="mini-card__equip">${escapeHtml(runeName)}</span>`);
    }
    gearRowHtml = `
      <div class="mini-card__detail-row">
        <span class="mini-card__detail-label">Gear</span>
        ${parts.join("")}
      </div>`;
  }

  // Relic line
  const relicName = build.equipment?.relic || "";
  let relicRowHtml = "";
  if (relicName) {
    relicRowHtml = `
      <div class="mini-card__detail-row">
        <span class="mini-card__detail-label"></span>
        <span class="mini-card__gear-icon mini-card__gear-icon--relic">⬡</span>
        <span class="mini-card__relic">${escapeHtml(relicName)}</span>
      </div>`;
  }

  // Action buttons
  const actionsHtml = showActions
    ? `<div class="mini-card__actions">
        <button type="button" class="mini-card__btn-open" data-action="pool-open"
                data-build-id="${escapeHtml(build.id)}" title="Open build">&#8599;</button>
        <button type="button" class="mini-card__btn-remove" data-action="pool-remove"
                data-build-id="${escapeHtml(build.id)}" title="Remove from comp">&times;</button>
      </div>`
    : "";

  return `
    <div class="mini-card ${pClass}" data-build-id="${escapeHtml(build.id)}">
      <div class="mini-card__icon">${icon}</div>
      <div class="mini-card__info">
        <div class="mini-card__header">
          <span class="mini-card__name">${name}</span>
          ${tagPills}
          ${role}
          ${modePill}
        </div>
        ${specRowHtml}
        ${weapRowHtml}
        ${gearRowHtml}
        ${relicRowHtml}
      </div>
      ${actionsHtml}
    </div>
  `;
}

/**
 * Render a placeholder card for a build that no longer exists in the library.
 */
export function renderMissingMiniBuildCard(buildId) {
  const truncId = buildId.length > 12 ? buildId.slice(0, 12) + "\u2026" : buildId;
  return `
    <div class="mini-card mini-card--missing" data-build-id="${escapeHtml(buildId)}">
      <div class="mini-card__icon mini-card__icon--missing">?</div>
      <div class="mini-card__info">
        <div class="mini-card__header">
          <span class="mini-card__name mini-card__name--missing">Missing Build</span>
        </div>
        <div class="mini-card__detail-row">
          <span class="mini-card__equip">${escapeHtml(truncId)}</span>
        </div>
      </div>
      <div class="mini-card__actions">
        <button type="button" class="mini-card__btn-remove" data-action="pool-remove"
                data-build-id="${escapeHtml(buildId)}" title="Remove from comp">&times;</button>
      </div>
    </div>
  `;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/mini-build-card.js
git commit -m "feat: add mini-build-card rendering module"
```

---

### Task 4: Integrate into comp detail page

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js`
- Modify: `src/renderer/modules/comps/comp-drag-drop.js`

- [ ] **Step 1: Update `comp-detail.js` imports and pool rendering**

Add import at the top of `comp-detail.js`:

```javascript
import { renderMiniBuildCard, renderMissingMiniBuildCard } from "../mini-build-card.js";
```

In `renderBuildPool()` (around line 668-671), replace:

```javascript
const cards = filtered.map((entry) => {
    if (entry.type === "missing") return renderMissingPoolCard(entry.id);
    return renderPoolCard(entry.build);
  }).join("");
```

With:

```javascript
const cards = filtered.map((entry) => {
    if (entry.type === "missing") return renderMissingMiniBuildCard(entry.id);
    return renderMiniBuildCard(entry.build, state.upgradeCatalog);
  }).join("");
```

Remove the now-unused `renderPoolCard()` and `renderMissingPoolCard()` functions entirely.

- [ ] **Step 2: Update drag-drop draggable selector**

In `comp-drag-drop.js` line 42, change:

```javascript
draggable: ".comp-pool-card",
```

To:

```javascript
draggable: ".mini-card",
```

Also check if `comp-drag-drop.js` references `comp-pool-card` anywhere else (e.g., in `onStart`, `onEnd` callbacks). The `data-build-id` attribute on the card is used for drop identification — this is preserved on `.mini-card` so no other changes are needed.

- [ ] **Step 3: Run the app and verify**

Run `npm start`. Open a comp with builds in the pool. Confirm:
- Cards render with all 5 rows (header, specs, weapons, gear, relic)
- Profession colors and left border work
- Drag-and-drop from pool to party slots still works
- Open and remove buttons work
- Search filtering still works
- Hover card still triggers correctly

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js src/renderer/modules/comps/comp-drag-drop.js
git commit -m "feat: integrate mini-build-card into comp detail pool"
```

---

### Task 5: Clean up old pool card styles

**Files:**
- Modify: `src/renderer/styles/comps.css`

- [ ] **Step 1: Remove old `.comp-pool-card*` and `.comp-pool-tag` styles**

Remove lines 709-847 of `comps.css` — the entire `.comp-pool-card*` block and `.comp-pool-tag` block. These are fully replaced by `mini-build-card.css`.

Keep everything else in `comps.css` (pool header, pool list, pool search, party lines, slots, drag states, etc.).

- [ ] **Step 2: Update drag ghost styles to target `.mini-card__*` classes**

In the Drag & Drop States section of `comps.css` (around lines 1048-1065), update the ghost selectors from `.comp-pool-card__*` to `.mini-card__*`:

```css
.comp-drag-icon-ghost .mini-card__info,
.comp-drag-icon-ghost .mini-card__actions {
  display: none !important;
}

.comp-drag-icon-ghost .mini-card__icon {
  width: 30px !important;
  height: 30px !important;
  background: rgba(255, 255, 255, 0.05) !important;
  border-radius: 50% !important;
  flex-shrink: 0 !important;
}

.comp-drag-icon-ghost .mini-card__icon svg {
  width: 26px !important;
  height: 26px !important;
}
```

This ensures the SortableJS drag ghost still collapses to a small icon circle during drag-and-drop.

- [ ] **Step 3: Verify no remaining references to old classes**

Search the codebase for `comp-pool-card` and `comp-pool-tag`. The only remaining references should be in:
- `src/site/render-comp.js` (the SPA — a future migration, not this task)
- Documentation/plan files

If any source files still reference the old classes, update them.

- [ ] **Step 4: Run the app and confirm no visual regressions**

Run `npm start`. Check the comp detail page. Confirm the pool looks correct, drag ghost collapses to icon circle, and no orphaned styles cause issues.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/comps.css
git commit -m "refactor: remove old comp-pool-card styles, replaced by mini-build-card"
```
