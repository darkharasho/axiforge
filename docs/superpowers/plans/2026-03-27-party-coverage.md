# Party Coverage View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing boon coverage panel with a per-party-line "Party Coverage" view showing boons, combo fields, and blast finishers — with click-to-expand source details, a self-boon toggle, and full desktop/SPA parity.

**Architecture:** Expand the extraction engine (`boon-coverage.js`) to also extract combo fields and blast finishers from the same skill sources (including kit/bundle sub-skills). Rewrite the comp-level aggregation and HTML rendering (`comp-boon-coverage.js`) to produce three stacked sections per party line. Update the SPA (`render-comp.js`) with the same UI and interaction model. The visual mockup at `.superpowers/brainstorm/325897-1774639218/content/layout-expanded.html` is the source of truth for colors, spacing, and layout.

**Tech Stack:** Vanilla JS (ES modules), CSS, GW2 API skill facts

**Spec:** `docs/superpowers/specs/2026-03-27-party-coverage-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/renderer/modules/boon-coverage.js` | Add `extractComboFields()` and `extractBlastFinishers()` functions; add bundle/kit sub-skill scanning for all three extractors |
| Modify | `src/renderer/modules/constants.js` | Add `COMBO_FIELD_COLORS` map and `COMBO_FIELD_DISPLAY_ORDER` |
| Rewrite | `src/renderer/modules/comps/comp-boon-coverage.js` | New `computeCompPartyCoverage()` aggregation; new HTML renderer with three stacked sections; new event binding with toggle + expand |
| Modify | `src/renderer/modules/comps/comp-detail.js` | Update to call new computation/render functions; rename panel title to "PARTY COVERAGE" |
| Modify | `src/renderer/styles/comps.css` | Add CSS for party coverage sections, field/blast pills, toggle, expanded source rows |
| Rewrite | `src/site/render-comp.js` (boon section) | Replace boon coverage rendering and event binding with party coverage equivalents |

---

## Task 1: Add Combo Field and Blast Finisher Constants

**Files:**
- Modify: `src/renderer/modules/constants.js:470-573` (boon/condition constants region)

- [ ] **Step 1: Add combo field color and order constants**

Add after the `BOON_DISPLAY_ORDER` array (line 555):

```javascript
// Combo field type display colors — bg and text pairs matching the mockup
export const COMBO_FIELD_COLORS = {
  Fire:      { bg: "#5a3a2a", text: "#f96", border: "#7a5a3a" },
  Water:     { bg: "#2a3a5a", text: "#6af", border: "#3a5a7a" },
  Light:     { bg: "#5a5a3a", text: "#ee8", border: "#7a7a5a" },
  Dark:      { bg: "#3a2a3a", text: "#c8a", border: "#5a3a5a" },
  Ethereal:  { bg: "#3a3a5a", text: "#aaf", border: "#5a5a7a" },
  Ice:       { bg: "#2a4a5a", text: "#8de", border: "#3a6a7a" },
  Lightning: { bg: "#5a5a2a", text: "#ee6", border: "#7a7a3a" },
  Smoke:     { bg: "#3a3a3a", text: "#aaa", border: "#5a5a5a" },
  Poison:    { bg: "#2a4a2a", text: "#8d8", border: "#3a6a3a" },
};

export const COMBO_FIELD_DISPLAY_ORDER = [
  "Fire", "Water", "Light", "Dark", "Ethereal", "Ice", "Lightning", "Smoke", "Poison",
];

// Blast finisher theme colors
export const BLAST_FINISHER_COLORS = { bg: "#4a3a5a", text: "#c8f", border: "#6a5a7a" };
```

- [ ] **Step 2: Verify constants file is valid**

Run: `node -e "import('./src/renderer/modules/constants.js').then(() => console.log('OK'))"`
Expected: OK (or syntax-check equivalent)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/constants.js
git commit -m "feat(party-coverage): add combo field and blast finisher color constants"
```

---

## Task 2: Expand Extraction Engine with Combo Fields and Blast Finishers

**Files:**
- Modify: `src/renderer/modules/boon-coverage.js`

- [ ] **Step 1: Add `extractComboFields` function**

Add after the `extractBuffFacts` function (after line 89):

```javascript
/**
 * Extract combo field facts from a skill/trait entity.
 * Also pulls Duration and Radius facts from the same entity for metadata.
 */
function extractComboFields(entity, sourceType, kitName = "") {
  const results = [];
  const facts = entity.facts || [];
  let duration = 0;
  let radius = 0;

  // First pass: collect Duration and Radius metadata
  for (const fact of facts) {
    if ((fact.type === "Duration" || fact.type === "Time") && fact.duration) {
      duration = fact.duration;
    }
    if (fact.type === "Radius" && fact.distance) {
      radius = fact.distance;
    }
  }

  // Second pass: extract ComboField facts
  for (const fact of facts) {
    if (fact.type !== "ComboField") continue;
    const fieldType = fact.field_type;
    if (!fieldType) continue;
    results.push({
      fieldType,
      sourceType,
      sourceName: entity.name || "",
      duration,
      radius,
      kitName,
    });
  }
  return results;
}
```

- [ ] **Step 2: Add `extractBlastFinishers` function**

Add after `extractComboFields`:

```javascript
/**
 * Extract blast finisher facts from a skill/trait entity.
 * Counts multiple ComboFinisher facts on the same skill as multiple blasts.
 */
function extractBlastFinishers(entity, sourceType, kitName = "") {
  const results = [];
  const facts = entity.facts || [];
  let blastCount = 0;
  let percent = 100;

  for (const fact of facts) {
    if (fact.type !== "ComboFinisher") continue;
    if (fact.finisher_type !== "Blast") continue;
    blastCount++;
    if (fact.percent != null && fact.percent < 100) {
      percent = fact.percent;
    }
  }

  if (blastCount > 0) {
    results.push({
      sourceType,
      sourceName: entity.name || "",
      blastCount,
      percent,
      kitName,
    });
  }
  return results;
}
```

- [ ] **Step 3: Add `computePartyCoverage` export that returns boons + fields + blasts**

Rename the existing `computeBoonCoverage` to `_computeBoonsOnly` (internal), then create a new `computePartyCoverage` that calls the boon logic plus the two new extractors. The existing `computeBoonCoverage` export is kept for backwards compatibility (used by the single-build detail panel).

Add a new exported function after `computeBoonCoverage`:

```javascript
/**
 * Compute full party coverage for a single build: boons, combo fields, blast finishers.
 * Scans weapon skills, heal/utility/elite, profession mechanics, traits,
 * and kit/bundle sub-skills.
 */
export function computePartyCoverage(catalog, editor, weaponSkills = []) {
  // Boons — delegate to existing function
  const { boons, conditions } = computeBoonCoverage(catalog, editor, weaponSkills);

  const allFields = [];
  const allBlasts = [];

  // Helper: scan an entity for fields and blasts
  function scanEntity(entity, sourceType, kitName = "") {
    if (!entity) return;
    allFields.push(...extractComboFields(entity, sourceType, kitName));
    allBlasts.push(...extractBlastFinishers(entity, sourceType, kitName));
  }

  // Weapon skills
  for (const ws of weaponSkills) {
    if (!ws) continue;
    scanEntity(ws, "skill");
    if (ws.flipSkill) {
      const flip = catalog.skillById?.get(ws.flipSkill) || catalog.weaponSkillById?.get(ws.flipSkill);
      scanEntity(flip, "skill");
    }
  }

  // Skills (heal, utility, elite, profession mechanics)
  const skillIds = collectSkillIds(editor, catalog);
  for (const id of skillIds) {
    const skill = catalog.skillById?.get(id);
    if (!skill) continue;
    scanEntity(skill, "skill");
    if (skill.flipSkill) {
      const flip = catalog.skillById?.get(skill.flipSkill);
      scanEntity(flip, "skill");
    }
    // Kit/bundle sub-skills
    for (const bundleId of skill.bundleSkills || []) {
      const bundleSkill = catalog.skillById?.get(bundleId);
      scanEntity(bundleSkill, "skill", skill.name || "");
    }
  }

  // Traits
  const traitIds = collectTraitIds(editor, catalog);
  for (const id of traitIds) {
    const trait = catalog.traitById?.get(id);
    scanEntity(trait, "trait");
  }

  // Deduplicate fields by (fieldType, sourceName)
  const fieldMap = new Map();
  for (const f of allFields) {
    const key = `${f.fieldType}|${f.sourceName}`;
    if (!fieldMap.has(key)) fieldMap.set(key, f);
  }
  const comboFields = [...fieldMap.values()];

  // Deduplicate blasts by sourceName
  const blastMap = new Map();
  for (const b of allBlasts) {
    const key = b.sourceName;
    if (!blastMap.has(key)) blastMap.set(key, b);
  }
  const blastFinishers = [...blastMap.values()];

  return { boons, conditions, comboFields, blastFinishers };
}
```

- [ ] **Step 4: Verify the module parses without errors**

Run: `node -e "import('./src/renderer/modules/boon-coverage.js').then(() => console.log('OK'))"`
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/boon-coverage.js
git commit -m "feat(party-coverage): add combo field and blast finisher extraction to boon-coverage"
```

---

## Task 3: Rewrite Comp-Level Aggregation

**Files:**
- Rewrite: `src/renderer/modules/comps/comp-boon-coverage.js`

- [ ] **Step 1: Replace `computeCompBoonCoverage` with `computeCompPartyCoverage`**

Rewrite the file. Keep the same imports pattern but use the new `computePartyCoverage` function:

```javascript
// Comp-level party coverage — aggregates boons, combo fields, and blast finishers
// across all builds in a comp, per party line (no squad-wide summary).

import { computePartyCoverage } from "../boon-coverage.js";
import { resolveEquippedWeaponSkills } from "../equipment-weapon-skills.js";
import {
  BOON_DISPLAY_ORDER, BOON_CONDITION_ICONS,
  COMBO_FIELD_COLORS, COMBO_FIELD_DISPLAY_ORDER,
  BLAST_FINISHER_COLORS, FACT_TYPE_ICONS,
} from "../constants.js";
import { getProfessionSvg } from "../profession-icons.js";
import { escapeHtml } from "../utils.js";
import { computeBuildConcentration } from "../stats.js";

// Profession color pips for source rows (hex values)
const PROF_PIP_COLORS = {
  Guardian: "#6ea8ff", Warrior: "#ff9944", Necromancer: "#4dca7a",
  Engineer: "#cc8844", Ranger: "#77cc55", Thief: "#cc6677",
  Mesmer: "#b07acc", Elementalist: "#dd5555", Revenant: "#aa6655",
};

/**
 * Compute party coverage for all filled slots in a comp, per line.
 */
export async function computeCompPartyCoverage(comp, builds, catalogCache, getCatalog, upgradeCatalog = null) {
  const lines = comp.partyLines || [];
  const buildMap = new Map(builds.map((b) => [b.id, b]));

  // Pre-warm catalog cache
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

  const lineResults = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = `P${i + 1}`;
    const lineBoonMap = new Map();
    const lineFieldMap = new Map();
    const lineBlasts = [];
    let hasFilledSlots = false;

    for (const buildId of line.slots || []) {
      const build = buildMap.get(buildId);
      if (!build || !build.profession) continue;

      const cacheKey = `${build.profession}_${build.gameMode || "pve"}`;
      const catalog = catalogCache.get(cacheKey);
      if (!catalog) continue;

      hasFilledSlots = true;
      const weaponSkills = resolveEquippedWeaponSkills(catalog, build);
      const coverage = computePartyCoverage(catalog, build, weaponSkills);
      const buildName = build.title || build.id;
      const concentrationBonus = computeBuildConcentration(build, upgradeCatalog) / 1500;

      // Resolve elite spec
      let eliteSpec = null;
      for (const spec of build.specializations || []) {
        if (spec?.elite && spec?.name) { eliteSpec = spec.name; break; }
        const specId = Number(spec?.specializationId || spec?.id) || 0;
        if (!specId) continue;
        const specData = catalog.specializationById?.get(specId);
        if (specData?.elite) { eliteSpec = specData.name || null; break; }
      }

      // Aggregate boons
      for (const boon of coverage.boons) {
        if (!lineBoonMap.has(boon.name)) {
          lineBoonMap.set(boon.name, { count: 0, providers: [] });
        }
        const entry = lineBoonMap.get(boon.name);
        entry.count++;
        const sources = (boon.sources || [])
          .filter(s => s.duration > 0)
          .map(s => ({
            type: s.type,
            name: s.name,
            stacks: s.stacks,
            effectiveDuration: +((s.duration * (1 + concentrationBonus)).toFixed(1)),
            context: s.context || "",
            isAlly: s.isAlly,
          }));
        entry.providers.push({ buildId, buildName, profession: build.profession, eliteSpec, sources });
      }

      // Aggregate combo fields
      for (const field of coverage.comboFields) {
        if (!lineFieldMap.has(field.fieldType)) {
          lineFieldMap.set(field.fieldType, { count: 0, sources: [] });
        }
        const entry = lineFieldMap.get(field.fieldType);
        entry.count++;
        entry.sources.push({
          sourceName: field.sourceName,
          profession: build.profession,
          eliteSpec,
          kitName: field.kitName || "",
          duration: field.duration,
          radius: field.radius,
        });
      }

      // Aggregate blast finishers
      for (const blast of coverage.blastFinishers) {
        lineBlasts.push({
          sourceName: blast.sourceName,
          profession: build.profession,
          eliteSpec,
          kitName: blast.kitName || "",
          blastCount: blast.blastCount,
          percent: blast.percent,
        });
      }
    }

    lineResults.push({
      lineId: line.id,
      label,
      hasFilledSlots,
      boons: lineBoonMap,
      comboFields: lineFieldMap,
      blastFinishers: lineBlasts,
    });
  }

  return { lines: lineResults };
}

// ── HTML rendering ────────────────────────────────────────────────────────────

export function buildPartyCoverageHTML(data) {
  const { lines } = data;

  return lines
    .filter((l) => l.hasFilledSlots)
    .map((line) => _renderPartyLine(line))
    .join("");
}

function _renderPartyLine(line) {
  const boonPills = _renderBoonPills(line.boons, line.label);
  const fieldPills = _renderFieldPills(line.comboFields, line.label);
  const blastPills = _renderBlastPills(line.blastFinishers, line.label);

  return `
    <div class="party-cov__line" data-line-label="${escapeHtml(line.label)}">
      <div class="party-cov__line-header">
        <span class="party-cov__line-label">${escapeHtml(line.label)} — Party Line ${line.label.replace("P", "")}</span>
        <label class="party-cov__toggle">
          <input type="checkbox" class="party-cov__toggle-input" data-action="toggle-self-boons" />
          <span class="party-cov__toggle-switch"></span>
          <span class="party-cov__toggle-text">Show self boons</span>
        </label>
      </div>
      <div class="party-cov__section" data-section="boons">
        <div class="party-cov__section-label">BOONS</div>
        <div class="party-cov__pills">${boonPills}</div>
        <div class="party-cov__expand" data-expand-for="boons"></div>
      </div>
      <div class="party-cov__section" data-section="fields">
        <div class="party-cov__section-label">COMBO FIELDS</div>
        <div class="party-cov__pills">${fieldPills}</div>
        <div class="party-cov__expand" data-expand-for="fields"></div>
      </div>
      <div class="party-cov__section" data-section="blasts">
        <div class="party-cov__section-label">BLAST FINISHERS</div>
        <div class="party-cov__pills">${blastPills}</div>
        <div class="party-cov__expand" data-expand-for="blasts"></div>
      </div>
    </div>`;
}

function _renderBoonPills(boonMap, lineLabel) {
  return BOON_DISPLAY_ORDER.map((boonName) => {
    const entry = boonMap.get(boonName);
    const count = entry?.count || 0;
    const covered = count > 0;
    const icon = BOON_CONDITION_ICONS[boonName] || "";

    // Check if any provider has an ally source
    const hasAllySource = entry?.providers?.some(p =>
      p.sources?.some(s => s.isAlly)
    ) || false;

    const providersJson = covered
      ? escapeHtml(JSON.stringify(entry.providers))
      : "[]";

    return `
      <div class="party-cov__pill party-cov__pill--boon ${covered ? "" : "party-cov__pill--uncovered"}"
           data-category="boon"
           data-boon-name="${escapeHtml(boonName)}"
           data-has-ally="${hasAllySource}"
           data-count="${count}"
           data-providers="${providersJson}"
           data-line-label="${escapeHtml(lineLabel)}"
           ${covered ? 'data-clickable="true"' : ""}>
        <img src="${escapeHtml(icon)}" width="20" height="20" alt="${escapeHtml(boonName)}"
             class="party-cov__pill-icon" />
        <span class="party-cov__pill-name">${escapeHtml(boonName)}</span>
        ${count > 1 ? `<span class="party-cov__pill-badge">&times;${count}</span>` : ""}
      </div>`;
  }).join("");
}

function _renderFieldPills(fieldMap, lineLabel) {
  return COMBO_FIELD_DISPLAY_ORDER
    .filter((ft) => fieldMap.has(ft))
    .map((fieldType) => {
      const entry = fieldMap.get(fieldType);
      const count = entry.count || 0;
      const colors = COMBO_FIELD_COLORS[fieldType] || { bg: "#333", text: "#aaa", border: "#555" };
      const sourcesJson = escapeHtml(JSON.stringify(entry.sources));

      return `
        <div class="party-cov__pill party-cov__pill--field"
             data-category="field"
             data-field-type="${escapeHtml(fieldType)}"
             data-count="${count}"
             data-sources="${sourcesJson}"
             data-line-label="${escapeHtml(lineLabel)}"
             data-clickable="true"
             style="background:${colors.bg}; color:${colors.text}; border-color:${colors.border};">
          <span class="party-cov__pill-name">${escapeHtml(fieldType)}</span>
          ${count > 1 ? `<span class="party-cov__pill-badge" style="color:${colors.text};">&times;${count}</span>` : ""}
        </div>`;
    }).join("");
}

function _renderBlastPills(blasts, lineLabel) {
  if (blasts.length === 0) return "";
  const colors = BLAST_FINISHER_COLORS;
  const sourcesJson = escapeHtml(JSON.stringify(blasts));

  return `
    <div class="party-cov__pill party-cov__pill--blast"
         data-category="blast"
         data-count="${blasts.length}"
         data-sources="${sourcesJson}"
         data-line-label="${escapeHtml(lineLabel)}"
         data-clickable="true"
         style="background:${colors.bg}; color:${colors.text}; border-color:${colors.border};">
      <span class="party-cov__pill-name">Blast</span>
      <span class="party-cov__pill-badge" style="color:#dda;">&times;${blasts.length}</span>
    </div>`;
}

// ── Expanded source detail panels ──────────────────────────────────────────

function _buildBoonExpandHTML(boonName, providers) {
  const icon = BOON_CONDITION_ICONS[boonName] || "";
  const totalSources = providers.reduce((n, p) => n + (p.sources?.length || 0), 0);

  const sourceRows = providers.flatMap(p =>
    (p.sources || []).map(s => {
      const pipColor = PROF_PIP_COLORS[p.profession] || "#888";
      const specLabel = p.eliteSpec || p.profession || "";
      const dur = `${s.effectiveDuration}s`;
      const stacksHtml = s.stacks > 1
        ? `<span class="party-cov__src-stacks">&times;${s.stacks}</span>` : "";
      const targetClass = s.isAlly ? "party-cov__src-target--ally" : "party-cov__src-target--self";
      const targetLabel = s.isAlly ? "ALLY" : "SELF";
      return `<div class="party-cov__src-row">
        <span class="party-cov__src-pip" style="background:${pipColor};"></span>
        <span class="party-cov__src-name">${escapeHtml(s.name)}</span>
        <span class="party-cov__src-spec">${escapeHtml(specLabel)}</span>
        ${stacksHtml}
        <span class="party-cov__src-dur">${escapeHtml(dur)}</span>
        <span class="party-cov__src-target ${targetClass}">${targetLabel}</span>
      </div>`;
    })
  ).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: #8f8;">
      <img src="${escapeHtml(icon)}" width="18" height="18" alt="${escapeHtml(boonName)}" class="party-cov__expand-icon" />
      <span class="party-cov__expand-title" style="color: #afa;">${escapeHtml(boonName)} — ${totalSources} source${totalSources !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: #8f8;">
      ${sourceRows}
    </div>`;
}

function _buildFieldExpandHTML(fieldType, sources) {
  const colors = COMBO_FIELD_COLORS[fieldType] || { text: "#aaa", border: "#555" };

  const sourceRows = sources.map(s => {
    const pipColor = PROF_PIP_COLORS[s.profession] || "#888";
    const specLabel = s.kitName
      ? `${s.eliteSpec || s.profession} <span class="party-cov__src-kit">(${escapeHtml(s.kitName)})</span>`
      : escapeHtml(s.eliteSpec || s.profession || "");
    const durHtml = s.duration ? `<span class="party-cov__src-dur">${s.duration}s duration</span>` : "";
    const radiusHtml = s.radius ? `<span class="party-cov__src-radius">${s.radius} radius</span>` : "";
    return `<div class="party-cov__src-row">
      <span class="party-cov__src-pip" style="background:${pipColor};"></span>
      <span class="party-cov__src-name">${escapeHtml(s.sourceName)}</span>
      <span class="party-cov__src-spec">${specLabel}</span>
      ${durHtml}
      ${radiusHtml}
    </div>`;
  }).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: ${colors.text};">
      <span class="party-cov__expand-title" style="color: ${colors.text};">${escapeHtml(fieldType)} Field — ${sources.length} source${sources.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: ${colors.text};">
      ${sourceRows}
    </div>`;
}

function _buildBlastExpandHTML(blasts) {
  const colors = BLAST_FINISHER_COLORS;

  const sourceRows = blasts.map(b => {
    const pipColor = PROF_PIP_COLORS[b.profession] || "#888";
    const specLabel = b.kitName
      ? `${b.eliteSpec || b.profession} <span class="party-cov__src-kit">(${escapeHtml(b.kitName)})</span>`
      : escapeHtml(b.eliteSpec || b.profession || "");
    const countLabel = `&times;${b.blastCount} blast${b.blastCount !== 1 ? "s" : ""}`;
    const pctHtml = b.percent < 100
      ? ` <span class="party-cov__src-pct">(${b.percent}%)</span>` : "";
    return `<div class="party-cov__src-row">
      <span class="party-cov__src-pip" style="background:${pipColor};"></span>
      <span class="party-cov__src-name">${escapeHtml(b.sourceName)}</span>
      <span class="party-cov__src-spec">${specLabel}</span>
      <span class="party-cov__src-blasts">${countLabel}${pctHtml}</span>
    </div>`;
  }).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: ${colors.text};">
      <span class="party-cov__expand-title" style="color: ${colors.text};">Blast Finishers — ${blasts.length} source${blasts.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: ${colors.text};">
      ${sourceRows}
    </div>`;
}

// ── Event binding ─────────────────────────────────────────────────────────

let _activeExpand = null; // { expandEl, pillEl }

function _closeExpand() {
  if (!_activeExpand) return;
  _activeExpand.expandEl.classList.remove("party-cov__expand--open");
  _activeExpand.pillEl.classList.remove("party-cov__pill--active");
  _activeExpand = null;
}

export function closePartyCoverageExpand() { _closeExpand(); }

export function bindPartyCoverageEvents(container) {
  // Self-boon toggle
  container.querySelectorAll('[data-action="toggle-self-boons"]').forEach(toggle => {
    toggle.addEventListener("change", () => {
      const lineEl = toggle.closest(".party-cov__line");
      if (!lineEl) return;
      const showSelf = toggle.checked;
      lineEl.querySelectorAll('.party-cov__pill--boon').forEach(pill => {
        if (showSelf) {
          pill.classList.remove("party-cov__pill--self-hidden");
        } else {
          const hasAlly = pill.dataset.hasAlly === "true";
          const covered = Number(pill.dataset.count) > 0;
          if (covered && !hasAlly) {
            pill.classList.add("party-cov__pill--self-hidden");
          }
        }
      });
    });
    // Apply initial state (toggle is unchecked = hide self-only)
    toggle.dispatchEvent(new Event("change"));
  });

  // Click to expand pills
  container.querySelectorAll('.party-cov__pill[data-clickable="true"]').forEach(pillEl => {
    pillEl.addEventListener("click", (e) => {
      e.stopPropagation();

      // Toggle: clicking active pill closes it
      if (_activeExpand?.pillEl === pillEl) {
        _closeExpand();
        return;
      }
      _closeExpand();

      const section = pillEl.closest(".party-cov__section");
      const expandEl = section?.querySelector(".party-cov__expand");
      if (!expandEl) return;

      const category = pillEl.dataset.category;
      let html = "";

      if (category === "boon") {
        let providers = [];
        try { providers = JSON.parse(pillEl.dataset.providers || "[]"); } catch { /* */ }
        html = _buildBoonExpandHTML(pillEl.dataset.boonName, providers);
      } else if (category === "field") {
        let sources = [];
        try { sources = JSON.parse(pillEl.dataset.sources || "[]"); } catch { /* */ }
        html = _buildFieldExpandHTML(pillEl.dataset.fieldType, sources);
      } else if (category === "blast") {
        let sources = [];
        try { sources = JSON.parse(pillEl.dataset.sources || "[]"); } catch { /* */ }
        html = _buildBlastExpandHTML(sources);
      }

      expandEl.innerHTML = html;
      pillEl.classList.add("party-cov__pill--active");
      _activeExpand = { expandEl, pillEl };

      requestAnimationFrame(() => expandEl.classList.add("party-cov__expand--open"));
    });
  });
}
```

- [ ] **Step 2: Verify the module parses**

Run: `node -e "import('./src/renderer/modules/comps/comp-boon-coverage.js').then(() => console.log('OK'))"`
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/comps/comp-boon-coverage.js
git commit -m "feat(party-coverage): rewrite comp-boon-coverage with three-section party coverage"
```

---

## Task 4: Add Party Coverage CSS

**Files:**
- Modify: `src/renderer/styles/comps.css`

- [ ] **Step 1: Add party coverage styles**

Add after the existing `.comp-boon-cov` styles block. The new styles use the `party-cov__` prefix to avoid conflicts during the transition. Faithfully match the mockup colors and spacing:

```css
/* ── Party Coverage (replaces squad-level boon coverage) ──────────────── */

.party-cov__line {
  background: #1a1a2e;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 8px;
}

.party-cov__line-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.party-cov__line-label {
  color: #e0a040;
  font-weight: bold;
  font-size: 15px;
}

/* Self-boon toggle */
.party-cov__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}

.party-cov__toggle-input {
  display: none;
}

.party-cov__toggle-switch {
  width: 32px;
  height: 18px;
  background: #3a3a4e;
  border-radius: 9px;
  position: relative;
  transition: background 0.2s;
}

.party-cov__toggle-switch::after {
  content: "";
  width: 14px;
  height: 14px;
  background: #888;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s, background 0.2s;
}

.party-cov__toggle-input:checked + .party-cov__toggle-switch {
  background: #3a6ea5;
}

.party-cov__toggle-input:checked + .party-cov__toggle-switch::after {
  transform: translateX(14px);
  background: white;
}

.party-cov__toggle-text {
  color: #888;
  font-size: 11px;
}

/* Sections */
.party-cov__section {
  background: #2a2a3e;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
}

.party-cov__section:last-child {
  margin-bottom: 0;
}

.party-cov__section-label {
  color: #aaa;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

/* Pills */
.party-cov__pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.party-cov__pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.15s, border-color 0.15s;
}

.party-cov__pill--boon {
  background: #3a5a3a;
  color: #8f8;
}

.party-cov__pill--uncovered {
  background: #333;
  color: #666;
  cursor: default;
}

.party-cov__pill--self-hidden {
  display: none;
}

.party-cov__pill--active {
  border-color: currentColor;
}

.party-cov__pill-icon {
  display: block;
  border-radius: 3px;
}

.party-cov__pill-name {
  white-space: nowrap;
}

.party-cov__pill-badge {
  color: #dda;
  font-size: 10px;
}

/* Expanded source panel */
.party-cov__expand {
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transition: max-height 0.25s ease, opacity 0.2s ease, padding 0.25s ease;
}

.party-cov__expand--open {
  max-height: 600px;
  opacity: 1;
  padding-top: 8px;
}

.party-cov__expand-header {
  border-left: 3px solid;
  padding: 4px 10px;
  margin-bottom: 4px;
}

.party-cov__expand-title {
  font-size: 12px;
  font-weight: bold;
}

.party-cov__expand-icon {
  border-radius: 3px;
  vertical-align: middle;
  margin-right: 4px;
}

.party-cov__expand-body {
  border-left: 3px solid;
  padding-left: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Source rows */
.party-cov__src-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: #252540;
  border-radius: 4px;
}

.party-cov__src-pip {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.party-cov__src-name {
  color: #ddd;
  font-size: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.party-cov__src-spec {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
}

.party-cov__src-kit {
  color: #888;
  font-size: 10px;
}

.party-cov__src-stacks {
  color: #aaa;
  font-size: 11px;
}

.party-cov__src-dur {
  color: #aaa;
  font-size: 11px;
}

.party-cov__src-radius {
  color: #aaa;
  font-size: 11px;
}

.party-cov__src-blasts {
  color: #aaa;
  font-size: 11px;
}

.party-cov__src-pct {
  color: #888;
  font-size: 10px;
}

.party-cov__src-target {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.party-cov__src-target--ally {
  background: #2a4a6a;
  color: #8cf;
}

.party-cov__src-target--self {
  background: #4a4a2a;
  color: #dd8;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/comps.css
git commit -m "feat(party-coverage): add CSS styles for party coverage sections"
```

---

## Task 5: Integrate Party Coverage into Comp Detail (Desktop)

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js:504-524` (async boon patch)
- Modify: `src/renderer/modules/comps/comp-detail.js:562-571` (panel HTML)
- Modify: `src/renderer/modules/comps/comp-detail.js:860-874` (publish flow)

- [ ] **Step 1: Update imports in comp-detail.js**

Replace the old imports:
```javascript
import { computeCompBoonCoverage, buildBoonCoverageHTML, bindBoonCoverageEvents, closeBoonTooltip, closeDurationExpand } from "./comp-boon-coverage.js";
```
With:
```javascript
import { computeCompPartyCoverage, buildPartyCoverageHTML, bindPartyCoverageEvents, closePartyCoverageExpand } from "./comp-boon-coverage.js";
```

Also update all references to `closeBoonTooltip()` and `closeDurationExpand()` elsewhere in the file to `closePartyCoverageExpand()`. There are two call sites:
1. The cleanup/destroy function (around line 373-374): replace both calls with a single `closePartyCoverageExpand();`
2. The boon coverage collapse toggle (around line 1120): replace `closeDurationExpand();` with `closePartyCoverageExpand();`

- [ ] **Step 2: Update the panel HTML in `renderPartyLines`**

Replace lines 562-571 (the `comp-boon-cov` container):
```javascript
    <div class="comp-boon-cov">
      <div class="comp-boon-cov__header" data-action="toggle-boon-coverage">
        <span class="comp-boon-cov__chevron">${collapsed ? "▸" : "▾"}</span>
        <span class="comp-boon-cov__title">BOON COVERAGE</span>
      </div>
      <div class="comp-boon-cov__body${collapsed ? " comp-boon-cov__body--hidden" : ""}"
           id="comp-boon-coverage-body">
      </div>
    </div>
```
With:
```javascript
    <div class="comp-boon-cov">
      <div class="comp-boon-cov__header" data-action="toggle-boon-coverage">
        <span class="comp-boon-cov__chevron">${collapsed ? "▸" : "▾"}</span>
        <span class="comp-boon-cov__title">PARTY COVERAGE</span>
      </div>
      <div class="comp-boon-cov__body${collapsed ? " comp-boon-cov__body--hidden" : ""}"
           id="comp-boon-coverage-body">
      </div>
    </div>
```

- [ ] **Step 3: Update the async patch block (lines 504-524)**

Replace:
```javascript
        data = await computeCompBoonCoverage(
          comp, state.builds, state.catalogCache, _callbacks.getCatalog, state.upgradeCatalog
        );
      ...
      bodyEl.innerHTML = buildBoonCoverageHTML(data);
      bindBoonCoverageEvents(bodyEl);
```
With:
```javascript
        data = await computeCompPartyCoverage(
          comp, state.builds, state.catalogCache, _callbacks.getCatalog, state.upgradeCatalog
        );
      ...
      bodyEl.innerHTML = buildPartyCoverageHTML(data);
      bindPartyCoverageEvents(bodyEl);
```

- [ ] **Step 4: Update the publish flow (lines 868-873)**

Replace:
```javascript
        const covData = await computeCompBoonCoverage(
          comp, state.builds, state.catalogCache, _callbacks.getCatalog, state.upgradeCatalog
        );
        boonCoverageHtml = buildBoonCoverageHTML(covData);
```
With:
```javascript
        const covData = await computeCompPartyCoverage(
          comp, state.builds, state.catalogCache, _callbacks.getCatalog, state.upgradeCatalog
        );
        boonCoverageHtml = buildPartyCoverageHTML(covData);
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js
git commit -m "feat(party-coverage): integrate party coverage into comp detail view"
```

---

## Task 6: Update SPA Rendering (render-comp.js)

**Files:**
- Modify: `src/site/render-comp.js`

- [ ] **Step 1: Replace `renderBoonCoverage` function (lines 115-125)**

Replace:
```javascript
function renderBoonCoverage(comp) {
  if (!comp.boonCoverageHtml) return "";
  return `
    <div class="comp-boon-cov">
      <div class="comp-boon-cov__header">
        <span class="comp-boon-cov__chevron">\u25be</span>
        <span class="comp-boon-cov__title">BOON COVERAGE</span>
      </div>
      <div class="comp-boon-cov__body">${comp.boonCoverageHtml}</div>
    </div>`;
}
```
With:
```javascript
function renderPartyCoverage(comp) {
  if (!comp.boonCoverageHtml) return "";
  return `
    <div class="comp-boon-cov">
      <div class="comp-boon-cov__header">
        <span class="comp-boon-cov__chevron">\u25be</span>
        <span class="comp-boon-cov__title">PARTY COVERAGE</span>
      </div>
      <div class="comp-boon-cov__body">${comp.boonCoverageHtml}</div>
    </div>`;
}
```

- [ ] **Step 2: Update `renderCompPage` to call `renderPartyCoverage`**

Replace `${renderBoonCoverage(comp)}` with `${renderPartyCoverage(comp)}` in the template string (around line 328).

- [ ] **Step 3: Replace `bindBoonEvents` with `bindPartyCoverageEvents`**

Replace the entire `bindBoonEvents` function (lines 247-308) and the helper functions (`buildDurationExpandHTML` at lines 143-190, `buildTooltipHTML` at lines 192-245) with a new SPA version of the party coverage event binding:

```javascript
// ── Party Coverage Interactions ───────────────────────────────────────────

// Profession color pips (same as desktop)
const PROF_PIP_COLORS = {
  Guardian: "#6ea8ff", Warrior: "#ff9944", Necromancer: "#4dca7a",
  Engineer: "#cc8844", Ranger: "#77cc55", Thief: "#cc6677",
  Mesmer: "#b07acc", Elementalist: "#dd5555", Revenant: "#aa6655",
};

const COMBO_FIELD_COLORS = {
  Fire: { text: "#f96" }, Water: { text: "#6af" }, Light: { text: "#ee8" },
  Dark: { text: "#c8a" }, Ethereal: { text: "#aaf" }, Ice: { text: "#8de" },
  Lightning: { text: "#ee6" }, Smoke: { text: "#aaa" }, Poison: { text: "#8d8" },
};

let _activeExpand = null; // { expandEl, pillEl }
let _activeTooltip = null;

function closeSpaTooltip() {
  if (_activeTooltip) { _activeTooltip.remove(); _activeTooltip = null; }
}

function closeSpaExpand() {
  if (!_activeExpand) return;
  _activeExpand.expandEl.classList.remove("party-cov__expand--open");
  _activeExpand.pillEl.classList.remove("party-cov__pill--active");
  _activeExpand = null;
}

function buildBoonExpandHTML(boonName, providers, builds) {
  const totalSources = providers.reduce((n, p) => n + (p.sources?.length || 0), 0);

  const sourceRows = providers.flatMap(p => {
    const buildData = builds?.[p.buildId];
    return (p.sources || []).map(s => {
      const pipColor = PROF_PIP_COLORS[p.profession] || "#888";
      const specLabel = p.eliteSpec || p.profession || "";
      const dur = `${s.effectiveDuration}s`;
      const stacksHtml = s.stacks > 1
        ? `<span class="party-cov__src-stacks">&times;${s.stacks}</span>` : "";
      const targetClass = s.isAlly ? "party-cov__src-target--ally" : "party-cov__src-target--self";
      const targetLabel = s.isAlly ? "ALLY" : "SELF";
      return `<div class="party-cov__src-row">
        <span class="party-cov__src-pip" style="background:${pipColor};"></span>
        <span class="party-cov__src-name">${escapeHtml(s.name)}</span>
        <span class="party-cov__src-spec">${escapeHtml(specLabel)}</span>
        ${stacksHtml}
        <span class="party-cov__src-dur">${escapeHtml(dur)}</span>
        <span class="party-cov__src-target ${targetClass}">${targetLabel}</span>
      </div>`;
    });
  }).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: #8f8;">
      <span class="party-cov__expand-title" style="color: #afa;">${escapeHtml(boonName)} — ${totalSources} source${totalSources !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: #8f8;">
      ${sourceRows}
    </div>`;
}

function buildFieldExpandHTML(fieldType, sources) {
  const colors = COMBO_FIELD_COLORS[fieldType] || { text: "#aaa" };
  const sourceRows = sources.map(s => {
    const pipColor = PROF_PIP_COLORS[s.profession] || "#888";
    const specLabel = s.kitName
      ? `${s.eliteSpec || s.profession} <span class="party-cov__src-kit">(${escapeHtml(s.kitName)})</span>`
      : escapeHtml(s.eliteSpec || s.profession || "");
    const durHtml = s.duration ? `<span class="party-cov__src-dur">${s.duration}s duration</span>` : "";
    const radiusHtml = s.radius ? `<span class="party-cov__src-radius">${s.radius} radius</span>` : "";
    return `<div class="party-cov__src-row">
      <span class="party-cov__src-pip" style="background:${pipColor};"></span>
      <span class="party-cov__src-name">${escapeHtml(s.sourceName)}</span>
      <span class="party-cov__src-spec">${specLabel}</span>
      ${durHtml}
      ${radiusHtml}
    </div>`;
  }).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: ${colors.text};">
      <span class="party-cov__expand-title" style="color: ${colors.text};">${escapeHtml(fieldType)} Field — ${sources.length} source${sources.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: ${colors.text};">
      ${sourceRows}
    </div>`;
}

function buildBlastExpandHTML(blasts) {
  const sourceRows = blasts.map(b => {
    const pipColor = PROF_PIP_COLORS[b.profession] || "#888";
    const specLabel = b.kitName
      ? `${b.eliteSpec || b.profession} <span class="party-cov__src-kit">(${escapeHtml(b.kitName)})</span>`
      : escapeHtml(b.eliteSpec || b.profession || "");
    const countLabel = `&times;${b.blastCount} blast${b.blastCount !== 1 ? "s" : ""}`;
    const pctHtml = b.percent < 100
      ? ` <span class="party-cov__src-pct">(${b.percent}%)</span>` : "";
    return `<div class="party-cov__src-row">
      <span class="party-cov__src-pip" style="background:${pipColor};"></span>
      <span class="party-cov__src-name">${escapeHtml(b.sourceName)}</span>
      <span class="party-cov__src-spec">${specLabel}</span>
      <span class="party-cov__src-blasts">${countLabel}${pctHtml}</span>
    </div>`;
  }).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: #c8f;">
      <span class="party-cov__expand-title" style="color: #c8f;">Blast Finishers — ${blasts.length} source${blasts.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: #c8f;">
      ${sourceRows}
    </div>`;
}

function bindPartyCoverageEvents(container, builds) {
  // Self-boon toggle
  container.querySelectorAll('[data-action="toggle-self-boons"]').forEach(toggle => {
    toggle.addEventListener("change", () => {
      const lineEl = toggle.closest(".party-cov__line");
      if (!lineEl) return;
      const showSelf = toggle.checked;
      lineEl.querySelectorAll(".party-cov__pill--boon").forEach(pill => {
        if (showSelf) {
          pill.classList.remove("party-cov__pill--self-hidden");
        } else {
          const hasAlly = pill.dataset.hasAlly === "true";
          const covered = Number(pill.dataset.count) > 0;
          if (covered && !hasAlly) {
            pill.classList.add("party-cov__pill--self-hidden");
          }
        }
      });
    });
    // Apply initial state
    toggle.dispatchEvent(new Event("change"));
  });

  // Click to expand
  container.querySelectorAll('.party-cov__pill[data-clickable="true"]').forEach(pillEl => {
    pillEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (_activeExpand?.pillEl === pillEl) { closeSpaExpand(); return; }
      closeSpaExpand();

      const section = pillEl.closest(".party-cov__section");
      const expandEl = section?.querySelector(".party-cov__expand");
      if (!expandEl) return;

      const category = pillEl.dataset.category;
      let html = "";

      if (category === "boon") {
        let providers = [];
        try { providers = JSON.parse(pillEl.dataset.providers || "[]"); } catch { /* */ }
        html = buildBoonExpandHTML(pillEl.dataset.boonName, providers, builds);
      } else if (category === "field") {
        let sources = [];
        try { sources = JSON.parse(pillEl.dataset.sources || "[]"); } catch { /* */ }
        html = buildFieldExpandHTML(pillEl.dataset.fieldType, sources);
      } else if (category === "blast") {
        let sources = [];
        try { sources = JSON.parse(pillEl.dataset.sources || "[]"); } catch { /* */ }
        html = buildBlastExpandHTML(sources);
      }

      expandEl.innerHTML = html;
      pillEl.classList.add("party-cov__pill--active");
      _activeExpand = { expandEl, pillEl };
      requestAnimationFrame(() => expandEl.classList.add("party-cov__expand--open"));
    });
  });
}
```

- [ ] **Step 4: Update event binding call in `renderCompPage`**

Replace `bindBoonEvents(app, comp.builds || {});` (line 359) with `bindPartyCoverageEvents(app, comp.builds || {});`

- [ ] **Step 5: Remove old helper functions**

Delete the now-unused functions:
- `closeBoonTooltip()` (line 132-134)
- `closeDurationExpand()` (line 136-141)
- `buildDurationExpandHTML()` (line 143-190)
- `buildTooltipHTML()` (line 192-245)
- `bindBoonEvents()` (line 247-308)

Replace with the new functions from step 3.

- [ ] **Step 6: Commit**

```bash
git add src/site/render-comp.js
git commit -m "feat(party-coverage): update SPA with party coverage rendering and events"
```

---

## Task 7: Update SPA CSS

**Files:**
- Find and modify the SPA CSS file that includes comp styles

- [ ] **Step 1: Ensure party coverage CSS is included in SPA build**

The SPA likely imports `comps.css` or has its own site-specific CSS. The party coverage classes (`party-cov__*`) added in Task 4 need to be available in the SPA build. Check the SPA's CSS pipeline:
- If the SPA imports `comps.css` via the Vite build, the styles from Task 4 are already included.
- If the SPA has a separate CSS file (e.g., `src/site/site.css`), add the same party coverage styles there.

Check: `grep -r "comps.css" src/site/` to determine the import path.

- [ ] **Step 2: Add mobile overrides for party coverage**

In the SPA mobile CSS file (`src/site/site-mobile.css` or similar), add:

```css
@media (max-width: 768px) {
  .party-cov__line {
    padding: 10px;
  }
  .party-cov__line-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .party-cov__pills {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
  }
  .party-cov__src-row {
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/site/
git commit -m "feat(party-coverage): add SPA and mobile CSS for party coverage"
```

---

## Task 8: Update Comp List Boon Percentage

**Files:**
- Modify: `src/renderer/modules/comps/comp-list.js`

The comp list shows a boon coverage percentage on each card. It currently uses `computeCompBoonCoverage` and reads `result.squad`. Since the new function no longer returns `squad`, update comp-list to use `computeCompPartyCoverage` and compute boon coverage across all lines.

- [ ] **Step 1: Update import**

Replace:
```javascript
import { computeCompBoonCoverage } from "./comp-boon-coverage.js";
```
With:
```javascript
import { computeCompPartyCoverage } from "./comp-boon-coverage.js";
```

- [ ] **Step 2: Update boon percentage computation**

Replace the existing computation block (around lines 435-447):
```javascript
    const result = await computeCompBoonCoverage(comp, builds, catalogCache, _callbacks.getCatalog, state.upgradeCatalog);
    if (!result || !result.squad) {
      _boonCache.set(comp.id, { percentage: 0, hash });
    } else {
      const squadMap = result.squad;
      let covered = 0;
      for (const boon of BOON_DISPLAY_ORDER) {
        const entry = squadMap.get(boon);
        if (entry && entry.count > 0) covered++;
      }
      const percentage = Math.round((covered / 12) * 100);
      _boonCache.set(comp.id, { percentage, hash });
    }
```
With:
```javascript
    const result = await computeCompPartyCoverage(comp, builds, catalogCache, _callbacks.getCatalog, state.upgradeCatalog);
    if (!result || !result.lines) {
      _boonCache.set(comp.id, { percentage: 0, hash });
    } else {
      // Aggregate boon coverage across all lines (union of covered boons)
      const coveredBoons = new Set();
      for (const line of result.lines) {
        if (!line.hasFilledSlots) continue;
        for (const boon of BOON_DISPLAY_ORDER) {
          const entry = line.boons.get(boon);
          if (entry && entry.count > 0) coveredBoons.add(boon);
        }
      }
      const percentage = Math.round((coveredBoons.size / 12) * 100);
      _boonCache.set(comp.id, { percentage, hash });
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/comps/comp-list.js
git commit -m "feat(party-coverage): update comp list boon percentage to use new aggregation"
```

---

## Task 9: Clean up Old Boon Coverage Code

**Files:**
- Modify: `src/renderer/styles/comps.css` (remove old squad-level styles)
- Verify: `src/renderer/modules/comps/comp-detail.js` (no stale references)

- [ ] **Step 1: Check for remaining references to old exports**

Search for any remaining imports/references to:
- `computeCompBoonCoverage`
- `buildBoonCoverageHTML`
- `bindBoonCoverageEvents`
- `closeBoonTooltip`
- `closeDurationExpand`

Run: `grep -r "computeCompBoonCoverage\|buildBoonCoverageHTML\|bindBoonCoverageEvents\|closeBoonTooltip\|closeDurationExpand" src/`

Update or remove any remaining references. The comp-list.js may also reference boon coverage for the list card preview — check if it uses the old function and update accordingly.

- [ ] **Step 2: Remove old squad-level CSS classes that are no longer used**

After verifying no code references them, remove CSS rules for:
- `.comp-boon-cov__squad-label`
- `.comp-boon-cov__icons--squad`
- Old `.comp-boon-cov__icon` styles (replaced by `.party-cov__pill`)
- Old `.comp-boon-tooltip` styles
- Old `.comp-boon-cov__duration-expand` styles
- Old `.comp-boon-cov__dur-*` styles

Keep the `.comp-boon-cov` container, `__header`, `__body`, `__chevron`, `__title` classes as they're still used for the collapsible wrapper.

- [ ] **Step 3: Verify app loads and renders**

Run the app, open a comp with builds assigned to party lines. Verify:
1. Party coverage panel shows with three stacked sections per line
2. Self-boon toggle hides self-only boons when off
3. Clicking a boon/field/blast pill expands source details
4. Colors and layout match the mockup

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(party-coverage): remove old boon coverage CSS and stale references"
```

---

## Task 10: End-to-End Verification

- [ ] **Step 1: Desktop verification**

Open the app and navigate to a comp with multiple party lines and diverse builds (Engineer, Guardian, Elementalist for good field/blast coverage).

Verify:
- [ ] Three stacked sections per party line (Boons, Combo Fields, Blast Finishers)
- [ ] No squad-wide summary row
- [ ] Self-boon toggle defaults to off, hiding self-only boons
- [ ] Toggling "Show self boons" reveals self-only boons
- [ ] Clicking a boon pill expands with sources showing pip, name, spec, stacks, duration, ALLY/SELF badge
- [ ] Clicking a field pill expands with sources showing pip, name, spec (kit in parens), duration, radius
- [ ] Clicking a blast pill expands with sources showing pip, name, spec (kit in parens), blast count
- [ ] Kit/bundle skills appear (e.g., Bomb Kit blast finisher for Engineer)
- [ ] Uncovered boons are greyed out
- [ ] Field types without sources don't show empty placeholders
- [ ] Collapse/expand toggle on panel header still works

- [ ] **Step 2: Publish and verify SPA**

Publish the comp and open the SPA URL.

Verify:
- [ ] Same three-section layout as desktop
- [ ] Self-boon toggle works
- [ ] Click-to-expand works for all three categories
- [ ] Mobile responsive layout (resize browser to < 768px)
- [ ] Colors and layout match the mockup

- [ ] **Step 3: Commit final verification notes**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix(party-coverage): polish from end-to-end verification"
```
