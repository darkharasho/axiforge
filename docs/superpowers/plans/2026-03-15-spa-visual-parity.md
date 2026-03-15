# SPA Visual Parity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve visual parity between the published SPA build viewer and the desktop AxiForge app — correct layout order, filtered skills, equipment icons, computed stats, reference panel, and proper hover previews.

**Architecture:** Maximize data enrichment at publish time in `serializeForPublish()` so the SPA is a pure renderer with zero API calls or computation. Pre-filter skills by attunement/elite-spec/legend, compute stats, resolve equipment icons — all baked into the encrypted build payload. The SPA toggles between pre-built land/water datasets and attunement skill sets client-side.

**Tech Stack:** Node.js CommonJS (main process enrichment), vanilla JS ES modules (SPA site), Web Crypto API (decryption), Vite (site build), shared desktop CSS.

**Spec:** `docs/superpowers/specs/2026-03-15-spa-visual-parity-design.md`

**Important context for implementers:**
- The desktop app is Electron with vanilla JS (no React/Vue)
- SPA site files are ES modules in `src/site/`, built by Vite to `dist/site/`
- Main process modules are CommonJS in `src/main/`
- Equipment values in the build store are **string representations of numeric IDs** (e.g. `"24836"` for a rune)
- The upgrade catalog (`getUpgradeCatalog()`) has `runeById`, `sigilById`, `infusionById`, `enrichmentById`, `foodById`, `utilityById` Maps
- The profession catalog has `professionWeapons`, `weaponSkills` (array), `skills` (array), `legends`, `pets`
- Weapon skills have an `attunement` field (e.g. "Fire", "Water", "Air", "Earth") — empty string for non-attunement skills
- F-skills in `catalog.skills` have `slot` (e.g. "Profession_1"), `specialization` (elite spec ID or 0), `inProfessionEndpoint`, `attunement`
- Tests use Jest: `npx jest --verbose`
- Build site: `npm run build:site`
- The SPA imports desktop CSS from `src/renderer/styles/` via Vite

---

## Chunk 1: Data Enrichment — Pre-filtered Skill Sets

### Task 1: Restructure weapon skills by attunement and produce land/water datasets

**Files:**
- Modify: `src/main/buildPublish.js`
- Modify: `tests/unit/buildPublish.test.js`

Currently `serializeForPublish` dumps ALL weapon skills into flat arrays. For Elementalist, this means ~20 weapon skills per weapon (5 per attunement × 4). The SPA needs them grouped by attunement.

- [ ] **Step 1: Add attunement grouping for weapon skills**

In `buildPublish.js`, after resolving weapon skills, if the build's profession is "Elementalist", group weapon skills by their `attunement` field:

```js
// After resolving weaponSkills.set1, set2, etc.
// Group by attunement for Elementalist
const hasAttunements = weaponSkillsArray.some(s => s.attunement && s.attunement !== "None");
let attunementSkills = null;
if (hasAttunements) {
  const attunements = ["Fire", "Water", "Air", "Earth"];
  attunementSkills = {};
  for (const att of attunements) {
    attunementSkills[att] = {
      set1: resolveWeaponSetByAttunement(weapons.mainhand1, weapons.offhand1, professionWeapons, weaponSkillsArray, att),
      set2: resolveWeaponSetByAttunement(weapons.mainhand2, weapons.offhand2, professionWeapons, weaponSkillsArray, att),
    };
  }
}
```

Add a `resolveWeaponSetByAttunement` function that filters weapon skill refs to only those matching the given attunement (or having no attunement restriction). The catalog's `professionWeapons[weaponName].skills` array has `attunement` on each ref. Filter refs where `ref.attunement === attunement || !ref.attunement`.

- [ ] **Step 2: Produce land/water skill datasets**

Structure the output as:

```js
result.landSkills = {
  weaponSkills: { set1: [...], set2: [...] },  // default attunement (Fire) or all for non-Ele
  professionMechanics: [...],                   // filtered F-skills (see Task 2)
  skills: build.skills,                         // land heal/utility/elite
  attunementSkills: attunementSkills,           // null for non-Elementalist
};
result.waterSkills = {
  weaponSkills: { aquatic1: [...], aquatic2: [...] },
  professionMechanics: [...],                   // aquatic F-skills
  skills: build.underwaterSkills || build.skills,
  attunementSkills: null,                       // simplified for aquatic
};
result.activeAttunement = build.activeAttunement || (hasAttunements ? "Fire" : "");
```

Keep the old flat `weaponSkills` and `professionMechanics` fields for backward compat, but the SPA will use the new structured datasets.

- [ ] **Step 3: Add tests for attunement grouping**

Test with a mock Elementalist build that has attunement weapon skills. Verify `landSkills.attunementSkills.Fire.set1` contains only Fire attunement skills.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/buildPublish.test.js --verbose`
Then: `npx jest --verbose`

- [ ] **Step 5: Commit**

```bash
git add src/main/buildPublish.js tests/unit/buildPublish.test.js
git commit -m "feat: group weapon skills by attunement and produce land/water datasets"
```

---

### Task 2: Pre-filter profession mechanics (F-skills) by elite spec and attunement

**Files:**
- Modify: `src/main/buildPublish.js`
- Modify: `tests/unit/buildPublish.test.js`

Currently `professionMechanics` includes ALL F-skills for the profession. The desktop filters them by:
- Elite spec: only show F-skills whose `specialization` matches a selected elite spec (or 0 for base)
- Attunement: for Elementalist, group by attunement
- Exclude flip targets and exit/leave variants

- [ ] **Step 1: Filter professionMechanics by selected elite spec**

Get the selected elite spec IDs from `build.specializations`:
```js
const selectedSpecIds = new Set(
  (build.specializations || [])
    .map(s => Number(s?.id) || 0)
    .filter(Boolean)
);
```

Filter F-skills:
```js
const exitLeavePattern = /^(Exit|Leave)\b/i;
const flipSkillIds = new Set(skillsArray.flatMap(s => s.flipSkill ? [s.flipSkill] : []));

const filteredMechanics = skillsArray
  .filter(s => typeof s.slot === "string" && s.slot.startsWith("Profession_") && s.inProfessionEndpoint)
  .filter(s => !exitLeavePattern.test(s.name || ""))
  .filter(s => !flipSkillIds.has(s.id) || s.inProfessionEndpoint || (s.specialization > 0 && s.flipSkill > 0))
  .filter(s => {
    const lockSpec = Number(s.specialization) || 0;
    return !lockSpec || selectedSpecIds.has(lockSpec);
  })
  .sort((a, b) => {
    const na = parseInt((a.slot || "").replace("Profession_", ""), 10) || 0;
    const nb = parseInt((b.slot || "").replace("Profession_", ""), 10) || 0;
    return na - nb;
  });
```

- [ ] **Step 2: Group F-skills by attunement for Elementalist**

For Elementalist, further group the filtered mechanics by attunement:
```js
if (hasAttunements) {
  for (const att of attunements) {
    attunementSkills[att].professionMechanics = filteredMechanics.filter(
      s => s.attunement && s.attunement.toLowerCase() === att.toLowerCase()
    );
  }
  // Default land mechanics = Fire attunement
  landMechanics = attunementSkills[build.activeAttunement || "Fire"]?.professionMechanics || filteredMechanics;
} else {
  landMechanics = filteredMechanics;
}
```

- [ ] **Step 3: Add tests**

Test that Elementalist builds get F-skills grouped by attunement. Test that non-Elementalist builds get filtered F-skills (no exit/leave, no unselected elite spec skills).

- [ ] **Step 4: Run tests and commit**

```bash
npx jest --verbose
git add src/main/buildPublish.js tests/unit/buildPublish.test.js
git commit -m "feat: pre-filter F-skills by elite spec and attunement"
```

---

## Chunk 2: Data Enrichment — Equipment Icons & Computed Stats

### Task 3: Resolve equipment slot icons at publish time

**Files:**
- Modify: `src/main/buildPublish.js`
- Modify: `tests/unit/buildPublish.test.js`

Add `equipmentIcons` to the enriched build with resolved icon URLs for every equipment slot.

- [ ] **Step 1: Add equipment icon resolution**

The desktop uses these icon sources:
- **Armor**: Legendary armor icons from `LEGENDARY_ARMOR_ICONS[weight][slot]` (render CDN URLs). For non-legendary, use generic wiki slot icons.
- **Weapons**: `GW2_WEAPONS` constant has `.icon` per weapon type ID (e.g. `"dagger"` → wiki URL)
- **Trinkets**: `EQUIP_TRINKET_SLOTS` constant has `.filledIcon` (render CDN URLs)

Since these are all static constants, embed the lookup data directly in `buildPublish.js`:

```js
const PROFESSION_WEIGHT = {
  Elementalist: "light", Mesmer: "light", Necromancer: "light",
  Engineer: "medium", Ranger: "medium", Thief: "medium",
  Guardian: "heavy", Warrior: "heavy", Revenant: "heavy",
};

const _R = "https://render.guildwars2.com/file";
const _WK = "https://wiki.guildwars2.com/images";

const ARMOR_ICONS = {
  light: {
    head: `${_R}/06146C9BD029041178F50B5D9ACD0A76E7051408/1634576.png`,
    shoulders: `${_R}/A77403E5F0EB03E46E686B12297A04707AF50278/1634579.png`,
    chest: `${_R}/C8FB494379CC98171EFB0F13923CACFD047743B3/1634574.png`,
    hands: `${_R}/9703DBC0926F6BB4072032E6B55BE593F6B750CD/1634575.png`,
    legs: `${_R}/65A4D3A41592D10EEABD0BC0D611F13A383B0261/1634577.png`,
    feet: `${_R}/FD60D4E3986FA46F4FEBB8131B65159195260B19/1634578.png`,
  },
  medium: {
    head: `${_R}/49092A1358E528DEC67EFA1C090546ED034642E2/1634588.png`,
    shoulders: `${_R}/CF7609512FC6527D805F2B74F26AF4549FF4E808/1634591.png`,
    chest: `${_R}/57360F35D1210D12010F6AE772382450A07D08F6/1634586.png`,
    hands: `${_R}/C57E5E5FA69261A2503CBB50080A6C023A155C49/1634587.png`,
    legs: `${_R}/EBD907C061747927AE062D1B41BC13D0EAF14AD5/1634589.png`,
    feet: `${_R}/BF4C6A48BA02BD6D6AC32F1E9C3F32A50399E336/1634590.png`,
  },
  heavy: {
    head: `${_R}/2695A8E44B7F07EF15A20857790EFCA91513F5F0/1634565.png`,
    shoulders: `${_R}/0F0F4BE73C9316BAA4956A3AA622CB0AE84D9CEA/1634567.png`,
    chest: `${_R}/DACF9B1ACBE8687B6B31ABC0CF295301120D7A67/1634563.png`,
    hands: `${_R}/A5DD0D661970F02CC26D04B510C7C94259B99520/1634564.png`,
    legs: `${_R}/EA9294557C175A43567906721E43962EC4B12D34/1634566.png`,
    feet: `${_R}/E895D40AE0D1A500FFFDB955C27A98FF687AA4C1/1634562.png`,
  },
};

const WEAPON_ICONS = {
  axe: `${_WK}/b/b5/Bandit_Cleaver.png`, dagger: `${_WK}/a/ac/Bandit_Shiv.png`,
  mace: `${_WK}/b/b3/Bandit_Mallet.png`, pistol: `${_WK}/f/f3/Bandit_Revolver.png`,
  sword: `${_WK}/e/e1/Bandit_Slicer.png`, scepter: `${_WK}/9/95/Bandit_Baton.png`,
  focus: `${_WK}/d/da/Bandit_Focus.png`, shield: `${_WK}/7/7c/Bandit_Ward.png`,
  torch: `${_WK}/7/7e/Bandit_Torch.png`, warhorn: `${_WK}/3/31/Bandit_Bugle.png`,
  greatsword: `${_WK}/0/0b/Bandit_Sunderer.png`, hammer: `${_WK}/f/fb/Bandit_Demolisher.png`,
  longbow: `${_WK}/2/2d/Bandit_Longbow.png`, rifle: `${_WK}/3/37/Bandit_Musket.png`,
  shortbow: `${_WK}/2/2f/Bandit_Short_Bow.png`, staff: `${_WK}/9/98/Bandit_Spire.png`,
  harpoon: `${_WK}/2/20/Bandit_Harpoon_Gun.png`, spear: `${_WK}/c/c9/Bandit_Spear.png`,
  trident: `${_WK}/6/66/Bandit_Trident.png`,
};

const TRINKET_ICONS = {
  back: `${_R}/5EBEA1A467236237FCBACDC09969647956C4A371/1701118.png`,
  amulet: `${_R}/4944FD054FD80D805B0BFFB2DA60363A7DD31FDB/1614376.png`,
  ring1: `${_R}/EAA61AAF9BEF031104FD063C0A301A520EF5F5E6/1614682.png`,
  ring2: `${_R}/EAA61AAF9BEF031104FD063C0A301A520EF5F5E6/1614682.png`,
  accessory1: `${_R}/741D3F520D1DFD7BB9A35AD50FC75152D2B3CA6B/1614709.png`,
  accessory2: `${_R}/741D3F520D1DFD7BB9A35AD50FC75152D2B3CA6B/1614709.png`,
};
```

Build the `equipmentIcons` object:
```js
function resolveEquipmentIcons(build) {
  const weight = PROFESSION_WEIGHT[build.profession] || "medium";
  const weapons = build.equipment?.weapons || {};
  const icons = {};
  // Armor
  for (const slot of ["head", "shoulders", "chest", "hands", "legs", "feet"]) {
    icons[slot] = ARMOR_ICONS[weight]?.[slot] || "";
  }
  // Weapons
  for (const slot of ["mainhand1", "offhand1", "mainhand2", "offhand2", "aquatic1", "aquatic2"]) {
    const weaponId = (weapons[slot] || "").toLowerCase();
    icons[slot] = WEAPON_ICONS[weaponId] || "";
  }
  // Trinkets
  Object.assign(icons, TRINKET_ICONS);
  return icons;
}
```

Add `result.equipmentIcons = resolveEquipmentIcons(build);` to the return.

- [ ] **Step 2: Add tests**

Verify that a Warrior build gets heavy armor icons, an Elementalist gets light, and weapon icons resolve correctly.

- [ ] **Step 3: Run tests and commit**

```bash
npx jest --verbose
git add src/main/buildPublish.js tests/unit/buildPublish.test.js
git commit -m "feat: resolve equipment slot icons at publish time"
```

---

### Task 4: Compute equipment stats at publish time

**Files:**
- Create: `src/main/statsCompute.js`
- Create: `tests/unit/statsCompute.test.js`
- Modify: `src/main/buildPublish.js`

Port `computeEquipmentStats` from `src/renderer/modules/stats.js` to a CommonJS module that can run in the main process. The desktop version reads from `state.editor` — the port takes explicit parameters.

- [ ] **Step 1: Create `src/main/statsCompute.js`**

Port the stat computation logic as a pure function:

```js
function computePublishStats(equipment, upgradeCatalog, profession) { ... }
```

This function:
1. Iterates equipment slots, looks up stat combo weights, sums attribute totals
2. Adds food flat stat contributions (regex parse of `foodDef.buff`)
3. Adds infusion stat contributions (from `infixUpgrade.attributes`)
4. Adds enrichment stat contributions
5. Adds rune cumulative bonus stats (regex parse of `runeDef.bonuses`)
6. Adds utility consumable contributions (three patterns: conversion, conditional, flat)
7. Computes derived stats: CritChance, CritDamage, Health, BoonDuration, ConditionDuration

Embed the constants (`STAT_COMBOS_BY_LABEL`, `SLOT_WEIGHTS`, `PROFESSION_BASE_HP`, `PROFESSION_WEIGHT`) directly in this file since they're static data.

Also collect `statModifiers` — non-stat buff text lines from runes/sigils/food/utility.

Return `{ stats, modifiers }`.

- [ ] **Step 2: Create tests for `statsCompute.js`**

Test with a simple Berserker's full-gear build. Verify Power, Precision, Ferocity totals match expected values.

- [ ] **Step 3: Wire into `serializeForPublish`**

```js
const { computePublishStats } = require("./statsCompute");
// ...
const { stats: computedStats, modifiers: statModifiers } = computePublishStats(build.equipment, upgradeCatalog, build.profession);
result.computedStats = computedStats;
result.statModifiers = statModifiers;
```

- [ ] **Step 4: Run full tests and commit**

```bash
npx jest --verbose
git add src/main/statsCompute.js tests/unit/statsCompute.test.js src/main/buildPublish.js
git commit -m "feat: compute equipment stats at publish time"
```

---

## Chunk 3: SPA Renderers — Layout, Skills, Specs

### Task 5: Reorder layout and add land/water + attunement toggles

**Files:**
- Modify: `src/site/render-build.js`
- Modify: `src/site/render-skills.js`
- Modify: `src/site/styles.css`

- [ ] **Step 1: Reorder BUILD tab in `render-build.js`**

Change the BUILD tab content order from specs→skills to skills→specs:

```js
// BUILD tab: skills first, then specializations
buildContent.append(skillsHeading, skillsContainer, specsHeading, specsContainer);
```

- [ ] **Step 2: Add Land/Water toggle to `render-build.js`**

Add an `underwater-toggle` pill above the skills section:
```html
<div class="underwater-toggle">
  <button class="underwater-toggle__btn underwater-toggle__btn--active">⚓ Land</button>
  <button class="underwater-toggle__btn">≈ Water</button>
</div>
```

Clicking swaps between `build.landSkills` and `build.waterSkills` and re-renders the skills section.

- [ ] **Step 3: Rewrite `render-skills.js` to use landSkills/waterSkills data**

Change `renderSkills(container, build)` to accept a skill dataset rather than the full build:

```js
export function renderSkills(container, skillData, build) {
  // skillData = build.landSkills or build.waterSkills
  const weaponSkills = skillData.weaponSkills || {};
  const professionMechanics = skillData.professionMechanics || [];
  const skills = skillData.skills || {};
  // ...
}
```

- [ ] **Step 4: Add attunement toggle for Elementalist**

If `skillData.attunementSkills` is present, render 4 attunement buttons above the weapon skill bar. Clicking one swaps the displayed weapon skills and F-skills to the selected attunement's set.

Use the GW2 render CDN attunement icons or simple text labels (Fire 🔥, Water 💧, Air ⚡, Earth 🌍).

- [ ] **Step 5: Build and commit**

```bash
npm run build:site
git add src/site/render-build.js src/site/render-skills.js src/site/styles.css
git commit -m "feat: reorder layout, add land/water and attunement toggles"
```

---

### Task 6: Fix spec card backgrounds

**Files:**
- Modify: `src/site/render-specs.js`

- [ ] **Step 1: Fix background image styling**

The desktop uses wiki FilePath URLs for spec backgrounds:
```js
const wikiBackground = `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(`${spec.name || ""} specialization.png`)}`;
```

Update the panel style to match the desktop exactly:
```js
panel.style.backgroundImage = `linear-gradient(0deg, rgba(7, 14, 27, 0.1), rgba(7, 14, 27, 0.1)), url("${wikiBackground}")`;
panel.style.backgroundPosition = "center, center";
panel.style.backgroundSize = "100% 100%, cover";
panel.style.backgroundRepeat = "no-repeat, no-repeat";
```

The key issue: if `spec.background` is a raw API URL (not wiki), it may not load. Use the wiki FilePath format as fallback. Try `spec.background` first, fall back to wiki URL if it starts with `https://render.guildwars2.com`.

- [ ] **Step 2: Build and commit**

```bash
npm run build:site
git add src/site/render-specs.js
git commit -m "fix: use wiki FilePath URLs for spec card backgrounds"
```

---

## Chunk 4: SPA Renderers — Equipment & Attributes

### Task 7: Overhaul equipment renderer with icons and inline upgrades

**Files:**
- Modify: `src/site/render-equipment.js`

- [ ] **Step 1: Rewrite armor section as vertical list with icons**

Each armor slot:
```html
<div class="equip-slot equip-slot--compact">
  <div class="equip-slot__icon equip-slot__icon--filled">
    <img src="ARMOR_ICON_URL" />
  </div>
  <div class="equip-slot__info">
    <div class="equip-slot__label">HEAD</div>
    <div class="equip-slot__value">Berserker's</div>
    <div class="equip-slot__combo-stats">Power · Precision · Ferocity</div>
  </div>
  <div class="equip-upgrade-slots">
    <!-- Rune badge with resolved name -->
    <div class="equip-upgrade-btn equip-upgrade-btn--rune equip-upgrade-btn--filled" data-name="RUNE_NAME">R</div>
    <!-- Infusion badge (if present) -->
  </div>
</div>
```

Use `build.equipmentIcons[slot]` for the `<img>` src.
Use `build.equipmentDisplay.runes[slot]?.name` for the rune tooltip.
Use `build.equipmentDisplay.infusions[slot]` for infusion badge.

Remove the separate Runes and Infusions summary sections entirely.

- [ ] **Step 2: Fix weapon slots with icons**

Use `build.equipmentIcons[slot]` for weapon icon images.

- [ ] **Step 3: Fix trinket slots with icons**

Use `build.equipmentIcons[slot]` for trinket icon images.

- [ ] **Step 4: Fix consumables with resolved names**

Use `build.equipmentDisplay.food?.name`, `.utility?.name`, `.relic?.name`, `.enrichment?.name`.

- [ ] **Step 5: Build and commit**

```bash
npm run build:site
git add src/site/render-equipment.js
git commit -m "feat: equipment renderer with icons, inline upgrades, vertical armor"
```

---

### Task 8: Add Attributes panel to equipment tab

**Files:**
- Modify: `src/site/render-equipment.js`
- Modify: `src/site/styles.css`

- [ ] **Step 1: Render attributes panel in the right column**

Above the trinkets section, add an ATTRIBUTES section using `build.computedStats`:

```html
<section class="equip-section">
  <div class="equip-section__head"><span>ATTRIBUTES</span></div>
  <div class="equip-stats">
    <div class="equip-stat-row">
      <span class="equip-stat-cell">Power</span>
      <span class="equip-stat-cell">2,786</span>
    </div>
    <div class="equip-stat-row">
      <span class="equip-stat-cell">Precision</span>
      <span class="equip-stat-cell">2,063</span>
      <span class="equip-stat-cell equip-stat-cell--derived">Crit Chance</span>
      <span class="equip-stat-cell equip-stat-cell--derived">60.6%</span>
    </div>
    <!-- ... etc -->
  </div>
</section>
```

Layout as a table with base stats on the left and derived stats on the right (matching desktop screenshot).

- [ ] **Step 2: Render stat modifiers below attributes**

Show `build.statModifiers` as colored text lines (green for positive, matching desktop).

- [ ] **Step 3: Add any missing CSS**

The desktop CSS for `equip-stats`, `equip-stat-row`, `equip-stat-cell` is in `src/renderer/styles/equipment.css` which is already imported. Add SPA-specific overrides if needed.

- [ ] **Step 4: Build and commit**

```bash
npm run build:site
git add src/site/render-equipment.js src/site/styles.css
git commit -m "feat: add Attributes panel with computed stats and modifiers"
```

---

## Chunk 5: Reference Panel & Hover Preview

### Task 9: Add Reference Panel sidebar to BUILD tab

**Files:**
- Create: `src/site/render-reference.js`
- Modify: `src/site/render-build.js`
- Modify: `src/site/styles.css`

- [ ] **Step 1: Create `src/site/render-reference.js`**

Export `initReferencePanel(container)` that creates a persistent detail card sidebar:

```html
<div class="detail-host">
  <div class="equip-section__head"><span>REFERENCE PANEL</span></div>
  <div class="detail-card" id="spa-reference-card">
    <!-- populated on hover/click -->
  </div>
</div>
```

Export `updateReferencePanel(data)` that populates the card:

```js
function updateReferencePanel(data) {
  const card = document.getElementById("spa-reference-card");
  if (!card || !data) return;
  card.innerHTML = "";
  // Header: icon + name + meta
  const header = document.createElement("header");
  if (data.icon) {
    const img = document.createElement("img");
    img.src = data.icon;
    header.append(img);
  }
  const info = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = data.name || "";
  info.append(title);
  if (data.meta) {
    const meta = document.createElement("p");
    meta.textContent = data.meta;
    meta.style.color = "var(--muted)";
    meta.style.fontSize = "0.78rem";
    info.append(meta);
  }
  header.append(info);
  card.append(header);
  // Description
  if (data.description) {
    const section = document.createElement("section");
    const h4 = document.createElement("h4");
    h4.textContent = "IN-GAME DESCRIPTION";
    const p = document.createElement("p");
    p.textContent = data.description;
    section.append(h4, p);
    card.append(section);
  }
  // Facts
  if (data.facts?.length) {
    const section = document.createElement("section");
    const h4 = document.createElement("h4");
    h4.textContent = "FACTS";
    const ul = document.createElement("ul");
    for (const fact of data.facts.slice(0, 12)) {
      const li = document.createElement("li");
      li.textContent = formatFact(fact);
      ul.append(li);
    }
    section.append(h4, ul);
    card.append(section);
  }
}
```

- [ ] **Step 2: Wire into `render-build.js`**

Add the reference panel as a sidebar on the BUILD tab:

```js
// BUILD tab layout: content on left, reference panel on right
const buildLayout = document.createElement("div");
buildLayout.className = "specs-with-detail";
const buildMain = document.createElement("div");
buildMain.className = "specs-panel";
buildMain.append(skillsHeading, skillsContainer, specsHeading, specsContainer);
const referencePanel = document.createElement("div");
referencePanel.className = "detail-panel";
initReferencePanel(referencePanel);
buildLayout.append(buildMain, referencePanel);
```

- [ ] **Step 3: Update hover/click handlers to populate reference panel**

In `render-detail.js`, when a `[data-name]` element is hovered, also call `updateReferencePanel` with the element's data attributes. Add `data-icon`, `data-facts` (JSON) to skill/trait elements in the renderers.

- [ ] **Step 4: Build and commit**

```bash
npm run build:site
git add src/site/render-reference.js src/site/render-build.js src/site/styles.css
git commit -m "feat: add Reference Panel sidebar to BUILD tab"
```

---

### Task 10: Improve hover preview cards

**Files:**
- Modify: `src/site/render-detail.js`
- Modify: `src/site/styles.css`

- [ ] **Step 1: Enhance hover preview DOM structure**

Replace the minimal tooltip with the desktop's rich card:

```html
<div class="hover-preview spa-tooltip">
  <div class="hover-preview__head">
    <img class="hover-preview__icon" src="ICON" />
    <div>
      <h4 class="hover-preview__title">SKILL NAME</h4>
      <p class="hover-preview__meta">Skill · Profession_1</p>
    </div>
  </div>
  <p class="hover-preview__desc">Description text...</p>
  <ul class="hover-preview__facts">
    <li>Recharge: 20</li>
    <li>Damage: ×0.50 = 897</li>
  </ul>
</div>
```

- [ ] **Step 2: Smart positioning**

Position the tooltip near the cursor, flipping to the opposite side if it would go off-screen. Match the desktop's logic: 16px right/below cursor, flip if near edges.

- [ ] **Step 3: Add `data-icon` and `data-facts` to skill/trait elements**

In `render-specs.js`, `render-skills.js`: add `data-icon` with the skill/trait icon URL and `data-facts` with a JSON-encoded facts array.

- [ ] **Step 4: Build and commit**

```bash
npm run build:site
git add src/site/render-detail.js src/site/render-specs.js src/site/render-skills.js src/site/styles.css
git commit -m "feat: rich hover preview cards with icon, meta, and facts"
```

---

### Task 11: Final integration test and build

- [ ] **Step 1: Build site**

Run: `npm run build:site`

- [ ] **Step 2: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests pass.

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -p
git commit -m "fix: address issues found during integration testing"
```
