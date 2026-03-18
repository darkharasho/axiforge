# Role Estimator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display an estimated role badge (Power DPS, Condi DPS, Boon Support, Heal Support, Tank, Hybrid, Unknown) on build cards in the library and on slots/pool cards in the comp detail view, derived purely from computed equipment stats.

**Architecture:** A new pure-function module `roleEstimator.js` scores equipment stats without touching global state, reusing the existing `computeSlotStats(comboLabel, slotKey)` export from `stats.js`. The result is computed at render time (never persisted) and rendered as an HTML pill via a `roleBadgeHtml(build)` helper imported wherever it's needed.

**Tech Stack:** Vanilla JS ES modules, CSS custom properties, existing pill/badge patterns from `library.css`.

**Note on testing:** This project has no test infrastructure. Verification steps below are manual smoke tests in the running app.

---

### Task 1: Create `roleEstimator.js`

**Files:**
- Create: `src/renderer/modules/roleEstimator.js`

- [ ] **Step 1: Create the module**

```javascript
// src/renderer/modules/roleEstimator.js
// Role estimation from equipment stats — pure functions, no global state.
import { computeSlotStats } from './stats.js';

const MIN_THRESHOLD = 1500;
const HYBRID_RATIO  = 0.20;

const ROLE_SCORERS = [
  { role: 'Power DPS',    fn: s => s.Power * 1.0 + s.Precision * 0.5 + s.Ferocity * 0.5 },
  { role: 'Condi DPS',    fn: s => s.ConditionDamage * 1.0 + s.Expertise * 0.8 },
  { role: 'Boon Support', fn: s => s.Concentration * 1.5 + s.HealingPower * 0.3 },
  { role: 'Heal Support', fn: s => s.HealingPower * 1.5 + s.Concentration * 0.3 },
  { role: 'Tank',         fn: s => s.Toughness * 1.5 + s.Vitality * 0.5 },
];

const ROLE_CSS_CLASS = {
  'Power DPS':    'power-dps',
  'Condi DPS':    'condi-dps',
  'Boon Support': 'boon-support',
  'Heal Support': 'heal-support',
  'Tank':         'tank',
  'Hybrid':       'hybrid',
  'Unknown':      'unknown',
};

// Note: computeSlotStats returns only the equipment contribution for a slot,
// not GW2 base stats (Power/Precision/Toughness/Vitality base = 1000 each).
// Base stats are added separately in computeEquipmentStats() and are NOT
// present here, so no subtraction is needed before scoring.
function scoreEquipmentSlots(slots) {
  const totals = {
    Power: 0, Precision: 0, Toughness: 0, Vitality: 0,
    Ferocity: 0, ConditionDamage: 0, Expertise: 0, Concentration: 0, HealingPower: 0,
  };
  for (const [slotKey, label] of Object.entries(slots)) {
    if (!label) continue;
    for (const { stat, value } of computeSlotStats(label, slotKey)) {
      if (stat in totals) totals[stat] += value;
    }
  }
  return totals;
}

/**
 * Returns the estimated role for a build, or null if no slots are equipped.
 * Pure function — reads only from the build object, no global state.
 */
export function estimateRole(build) {
  const slots = build?.equipment?.slots;
  if (!slots || !Object.values(slots).some(Boolean)) return null;

  const s = scoreEquipmentSlots(slots);
  const scored = ROLE_SCORERS.map(({ role, fn }) => ({ role, score: fn(s) }));
  scored.sort((a, b) => b.score - a.score);

  const [first, second] = scored;
  if (first.score < MIN_THRESHOLD) return 'Unknown';
  if (
    second &&
    second.score >= MIN_THRESHOLD &&
    (first.score - second.score) / first.score < HYBRID_RATIO
  ) {
    return 'Hybrid';
  }
  return first.role;
}

/**
 * Returns an HTML string for the role badge, or '' if the build has no equipment.
 */
export function roleBadgeHtml(build) {
  const role = estimateRole(build);
  if (!role) return '';
  const cls = ROLE_CSS_CLASS[role] ?? 'unknown';
  return `<span class="role-badge role-badge--${cls}">${role}</span>`;
}
```

- [ ] **Step 2: Smoke test the module logic manually**

Open DevTools console while the app is running. Load a Berserker's build and run:
```javascript
import('/modules/roleEstimator.js').then(m => {
  const build = window.__state?.builds?.[0]; // grab any build
  console.log(m.estimateRole(build));
});
```
Expected: a role string for equipped builds, `null` for empty ones.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/roleEstimator.js
git commit -m "feat: add role estimator pure function module"
```

---

### Task 2: Create `role-badge.css` and import it

**Files:**
- Create: `src/renderer/styles/role-badge.css`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Create the CSS file**

```css
/* src/renderer/styles/role-badge.css */
/* Role badge pill — used in library cards and comp detail. */

.role-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 0.72rem;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid transparent;
  line-height: 1.5;
  flex-shrink: 0;
}

.role-badge--power-dps {
  background: rgba(220, 80, 80, 0.12);
  border-color: rgba(220, 80, 80, 0.35);
  color: #e87070;
}

.role-badge--condi-dps {
  background: rgba(185, 80, 220, 0.12);
  border-color: rgba(185, 80, 220, 0.35);
  color: #cc80e8;
}

.role-badge--boon-support {
  background: rgba(72, 160, 255, 0.12);
  border-color: rgba(72, 160, 255, 0.35);
  color: #72aaff;
}

.role-badge--heal-support {
  background: rgba(77, 202, 122, 0.12);
  border-color: rgba(77, 202, 122, 0.35);
  color: #4dca7a;
}

.role-badge--tank {
  background: rgba(160, 140, 100, 0.12);
  border-color: rgba(160, 140, 100, 0.35);
  color: #c8a850;
}

.role-badge--hybrid {
  background: rgba(200, 169, 110, 0.12);
  border-color: rgba(200, 169, 110, 0.35);
  color: #c8a96e;
}

.role-badge--unknown {
  background: rgba(130, 130, 130, 0.10);
  border-color: rgba(130, 130, 130, 0.25);
  color: #888;
}

/* Compact variant used inside comp party line slots */
.comp-slot .role-badge {
  font-size: 0.6rem;
  padding: 0 4px;
  line-height: 1.4;
}
```

- [ ] **Step 2: Import in styles.css**

In `src/renderer/styles.css`, add the import after the `comps.css` line (line 18):

```css
@import "./styles/comps.css";
@import "./styles/role-badge.css";
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/role-badge.css src/renderer/styles.css
git commit -m "feat: add role badge CSS styles"
```

---

### Task 3: Add role badges to library build cards

**Files:**
- Modify: `src/renderer/modules/library/content.js`
- Modify: `src/renderer/styles/library.css`

**Note:** No badge in icon view (too compact). Badge in list, grid, columns, and table views.

- [ ] **Step 1: Add import to content.js**

At the top of `src/renderer/modules/library/content.js`, after the existing imports (around line 17), add:

```javascript
import { roleBadgeHtml } from '../roleEstimator.js';
```

- [ ] **Step 2: Add badge to list view (line ~212)**

Find the list view build row (inside `renderListView`, around line 212):
```javascript
${profPillHtml(b)}${eliteSpecPillHtml(b)}${gameModePillHtml(b)}${tagPillsHtml(b)}
```
Change to:
```javascript
${profPillHtml(b)}${eliteSpecPillHtml(b)}${gameModePillHtml(b)}${tagPillsHtml(b)}${roleBadgeHtml(b)}
```

- [ ] **Step 3: Add badge to grid view (line ~433)**

Find the grid view build card (inside `renderGridView`, around line 433):
```javascript
${profPillHtml(b)}${eliteSpecPillHtml(b)}${gameModePillHtml(b)}
```
Change to:
```javascript
${profPillHtml(b)}${eliteSpecPillHtml(b)}${gameModePillHtml(b)}${roleBadgeHtml(b)}
```

- [ ] **Step 4: Add badge to columns view (line ~572)**

Find the columns view build item (inside `renderColumnsView`, around line 572):
```javascript
<div class="lib-col__item lib-col__item--build ${profClass(b.profession)}"
     data-build-id="${escapeHtml(b.id)}" data-col-index="${colIndex}">
  <span class="lib-col__icon ${profClass(b.profession)}">${getSpecIcon(b)}</span>
  <span class="lib-col__name">${escapeHtml(b.title || "Untitled")}${folderPathHtml(b)}</span>
</div>
```
Change to:
```javascript
<div class="lib-col__item lib-col__item--build ${profClass(b.profession)}"
     data-build-id="${escapeHtml(b.id)}" data-col-index="${colIndex}">
  <span class="lib-col__icon ${profClass(b.profession)}">${getSpecIcon(b)}</span>
  <span class="lib-col__name">${escapeHtml(b.title || "Untitled")}${folderPathHtml(b)}</span>
  ${roleBadgeHtml(b)}
</div>
```

The `.lib-col__item` is likely a flex row. Verify in `library.css` that it can accommodate a third child. If the badge wraps or overflows, add `flex-wrap: wrap` or `gap: 4px` to the `.lib-col__item--build` rule. The badge is `flex-shrink: 0` so it will not compress.

- [ ] **Step 5: Add Role column to table view**

The table view (`renderTableView`) uses a CSS grid with 9 columns defined in `library.css:1002`. A new "Role" column needs to be added between "Mode" and "Tags" in three places:

**a) `library.css` line ~1002** — update grid template from 9 to 10 columns:
```css
/* OLD */
grid-template-columns: 22px 22px 1fr 100px 100px 60px 80px 80px 80px;
/* NEW — added 80px role column after 60px mode column */
grid-template-columns: 22px 22px 1fr 100px 100px 60px 80px 80px 80px 80px;
```

**b) Table header** (inside `renderTableView`, around line 370):
Find:
```javascript
<span class="lib-tv__mode">Mode</span>
<span class="lib-tv__tags">Tags</span>
```
Change to:
```javascript
<span class="lib-tv__mode">Mode</span>
<span class="lib-tv__role">Role</span>
<span class="lib-tv__tags">Tags</span>
```

**c) `renderTreeBuild` function (line ~318)**:
Find the mode span:
```javascript
<span class="lib-tv__mode">${escapeHtml(gameModeLabel(b.gameMode || "pve"))}</span>
<span class="lib-tv__tags" ...>${tags}</span>
```
Change to:
```javascript
<span class="lib-tv__mode">${escapeHtml(gameModeLabel(b.gameMode || "pve"))}</span>
<span class="lib-tv__role">${roleBadgeHtml(b)}</span>
<span class="lib-tv__tags" ...>${tags}</span>
```

**d) `renderTreeFolder`** — add empty placeholder span after mode span:
```javascript
<span class="lib-tv__mode"></span>
<span class="lib-tv__role"></span>
<span class="lib-tv__tags"></span>
```

**e) `renderTreeComp`** — find the mode and tags spans (around line 348):
```javascript
<span class="lib-tv__mode"></span>
<span class="lib-tv__tags" title="${escapeHtml((c.tags || []).join(", "))}">${tags}</span>
```
Change to:
```javascript
<span class="lib-tv__mode"></span>
<span class="lib-tv__role"></span>
<span class="lib-tv__tags" title="${escapeHtml((c.tags || []).join(", "))}">${tags}</span>
```

- [ ] **Step 6: Smoke test in app**

Launch the app. Navigate to Library. Check each view mode (list, grid, columns, table). Confirm:
- Berserker's builds show "Power DPS" in red
- Viper's/Trailblazer's builds show "Condi DPS" in purple
- Minstrel's builds show "Heal Support" or "Boon Support" in green/blue
- Harrier's builds show "Boon Support" or "Heal Support"
- Builds with no equipment show no badge
- Icon view shows no badge (unchanged)
- Table view has a "Role" column with correct badges

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/library/content.js src/renderer/styles/library.css
git commit -m "feat: show role badge on library build cards (all views except icon)"
```

---

### Task 4: Add role badges to comp detail view

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js`

- [ ] **Step 1: Add import to comp-detail.js**

At the top of `src/renderer/modules/comps/comp-detail.js`, after the existing imports (around line 6), add:

```javascript
import { roleBadgeHtml } from '../roleEstimator.js';
```

- [ ] **Step 2: Add badge to party line filled slots (line ~494-498)**

Find the filled slot template (inside the `renderPartyLine` or similar function, around line 494):
```javascript
`<div class="comp-slot comp-slot--filled ${pClass}" title="${title}"
      data-action="click-filled-slot" data-line-id="${escapeHtml(pl.id)}" data-slot-idx="${i}" data-build-id="${escapeHtml(buildId)}">
  <span class="comp-slot__icon">${icon}</span>
</div>`
```
Change to:
```javascript
`<div class="comp-slot comp-slot--filled ${pClass}" title="${title}"
      data-action="click-filled-slot" data-line-id="${escapeHtml(pl.id)}" data-slot-idx="${i}" data-build-id="${escapeHtml(buildId)}">
  <span class="comp-slot__icon">${icon}</span>
  ${roleBadgeHtml(build)}
</div>`
```

The `.comp-slot` is a fixed `42×42px` box (defined in `comps.css`). Stacking an icon + badge vertically would overflow that height. Increase the slot height for filled slots to accommodate.

In `src/renderer/styles/comps.css`, find the `.comp-slot--filled` rule and add flex-column stacking plus a height increase:
```css
.comp-slot--filled {
  /* existing rules — keep them, add: */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 58px;
}
```

The compact `.comp-slot .role-badge` rule in `role-badge.css` (font-size: 0.6rem, padding: 0 4px) keeps the badge small enough to fit in the extra height.

**Also update the slot container `max-height` formula in `renderPartyLine`** (around line 524 of `comp-detail.js`). The party line slot container uses a hardcoded `42` slot height to compute its max-height:
```javascript
style="max-height: ${Math.ceil(capacity / 5) * 42 + (Math.ceil(capacity / 5) - 1) * 5}px;"
```
Change `42` to `58` to match the new slot height:
```javascript
style="max-height: ${Math.ceil(capacity / 5) * 58 + (Math.ceil(capacity / 5) - 1) * 5}px;"
```
Without this fix the slot container will be too short and the role badges will be clipped.

- [ ] **Step 3: Add badge to hover card (line ~127-139)**

In `showSlotHoverCard`, add a `roleBadge` variable alongside the other declarations before `card.innerHTML` is set (around line 127):
```javascript
const tagPills = tags.map((t) => `<span class="comp-hover__tag">${escapeHtml(t)}</span>`).join("");
const roleBadge = roleBadgeHtml(build);  // add this line
```

Then in the `card.innerHTML` template, after the `tagPills` div:
```javascript
${tagPills ? `<div class="comp-hover__tags">${tagPills}</div>` : ""}
${roleBadge ? `<div class="comp-hover__role">${roleBadge}</div>` : ""}
```

- [ ] **Step 4: Add badge to pool cards (line ~613)**

In `renderPoolCard`, find the `comp-pool-card__top` section (around line 611-614):
```javascript
<div class="comp-pool-card__top">
  <span class="comp-pool-card__name">${name}</span>
  ${tagPills}
</div>
```
Change to:
```javascript
<div class="comp-pool-card__top">
  <span class="comp-pool-card__name">${name}</span>
  ${tagPills}
  ${roleBadgeHtml(build)}
</div>
```

- [ ] **Step 5: Smoke test in app**

Navigate to a Comp. Check:
- Each filled slot in party lines shows a small role badge below the spec icon
- Hovering a slot shows the role badge in the hover card
- Pool cards show the role badge next to tags
- Builds with no equipment slots filled show no badge
- The slot layout is not broken (badge fits cleanly below the icon)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js src/renderer/styles/comps.css
git commit -m "feat: show role badge in comp party line slots and pool cards"
```
