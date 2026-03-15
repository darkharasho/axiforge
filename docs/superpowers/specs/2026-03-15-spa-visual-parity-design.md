# SPA Visual Parity Design Spec

## Problem

The published SPA build viewer at `https://{user}.github.io/axibuilds/` looks significantly different from the desktop AxiForge app. Key issues:
- Skills bar is below specializations (should be above)
- Elementalist shows ALL attunement weapon skills and F-skills at once instead of filtering by active attunement
- No Land/Water toggle for switching between terrestrial and aquatic skill sets
- F-skill and elite spec filtering rules are not applied
- Equipment shows raw numeric IDs for runes/sigils/infusions instead of resolved names
- Equipment missing all item icons (armor, weapons, trinkets)
- No Attributes/stats panel
- No Reference Panel for viewing skill/trait details
- Hover preview cards are minimal (just name + description text) instead of matching the desktop's rich cards
- Spec card backgrounds are misaligned
- Armor layout is wrong (2-column grid instead of vertical list)
- Runes and infusions shown as separate summary sections instead of inline badges on armor slots

## Architecture

The SPA is a static Vite-built site at `src/site/` that renders encrypted build data. It cannot call APIs. ALL data must be baked into the encrypted build payload at publish time by `serializeForPublish()` in `src/main/buildPublish.js`.

The approach: maximize data enrichment at publish time, minimize computation in the SPA. The SPA is a pure renderer.

## Design

### 1. Layout Reorder

The BUILD tab content order changes from:
```
Specializations → Skills → Equipment
```
To:
```
Skills → Specializations
```

Equipment stays in its own tab. This matches the desktop's DOM order where the skills bar (`#skillsHost`) comes before specializations (`#specializationsHost`).

### 2. Data Enrichment at Publish Time

`serializeForPublish(build, catalog, upgradeCatalog)` produces two complete pre-filtered skill datasets and additional equipment display data.

#### 2a. Pre-filtered Land/Water Skill Sets

Instead of dumping all skills, produce two complete skill configurations:

```js
landSkills: {
  weaponSkills: { set1: [...], set2: [...] },       // filtered by active attunement for Elementalist
  professionMechanics: [...],                        // filtered by elite spec, legend, attunement rules
  skills: { heal, utility[], elite },                // land heal/utility/elite
  attunementSkills: {                                // Elementalist only: all 4 attunement sets
    Fire: { weaponSkills: [...], professionMechanics: [...] },
    Water: { weaponSkills: [...], professionMechanics: [...] },
    Air: { weaponSkills: [...], professionMechanics: [...] },
    Earth: { weaponSkills: [...], professionMechanics: [...] },
  }
},
waterSkills: {
  weaponSkills: { aquatic1: [...], aquatic2: [...] },
  professionMechanics: [...],                        // aquatic F-skills
  skills: { heal, utility[], elite },                // underwater heal/utility/elite (from build.underwaterSkills)
  attunementSkills: { ... }                          // if applicable
}
```

#### 2b. F-skill & Elite Spec Filtering Rules

Apply at publish time in `serializeForPublish`:

- Filter `professionMechanics` by `skill.specialization` matching selected elite spec IDs
- For Revenant: include only F-skills for the active legend(s)
- For Elementalist: group F-skills by attunement into the `attunementSkills` structure
- For Ranger: include pet command F-skills (or Soulbeast/Untamed variants based on elite spec)
- For Engineer: include toolbelt F-skills (or Mechanist Mech Commands)
- For all: exclude flip/exit/leave variants, apply the same filters as the desktop's `getSkillOptionsByType`

#### 2c. Equipment Icons

Resolve equipment slot icon URLs at publish time:

- **Armor**: Use wiki URLs based on armor weight class (Light/Medium/Heavy, derived from profession) and slot name. E.g. `https://wiki.guildwars2.com/wiki/Special:FilePath/Heavy_helm_icon.png`
- **Weapons**: Use icon URLs from `GW2_WEAPONS` constants (already has `.icon` per weapon type ID)
- **Trinkets**: Use generic wiki slot icons (Back, Ring, Accessory, Amulet)

Store as `equipmentIcons: { head: "url", shoulders: "url", mainhand1: "url", back: "url", ... }`.

#### 2d. Computed Stats

Port the logic from `src/renderer/modules/stats.js` `computeEquipmentStats()` to run at publish time. Include the result:

```js
computedStats: {
  Power: 2786, Precision: 2063, Toughness: 1000, Vitality: 1000,
  ConditionDamage: 0, Ferocity: 1288, HealingPower: 0,
  Expertise: 0, Concentration: 0,
  // Derived stats
  CritChance: "60.6%", CritDamage: "235.8%",
  Health: 11645, BoonDuration: "0.0%", ConditionDuration: "0.0%",
}
```

Also include `statModifiers: string[]` — the buff text lines from runes/sigils/food ("+5% Damage", "+7% Strike Damage vs Stunned", etc.).

The computation needs:
- `STAT_COMBOS` data (stat attribute weights per combo label)
- `SLOT_WEIGHTS` (stat value multipliers per armor/trinket/weapon slot)
- `PROFESSION_BASE_HP` (base health per profession)
- `PROFESSION_WEIGHT` (armor weight class per profession)
- Upgrade catalog (for rune/sigil/food buff stat contributions)

#### 2e. Active Attunement

Include `build.activeAttunement` (e.g. "Fire") and `build.activeAttunement2` (for Weaver) in the enriched output. Default to "Fire" if not set for Elementalist.

### 3. SPA Renderer Changes

#### 3a. Attunement Toggle (Elementalist only)

When `build.landSkills.attunementSkills` is present (Elementalist), render 4 attunement buttons (Fire, Water, Air, Earth) above the weapon skill bar. Clicking one:
- Swaps displayed weapon skills to the selected attunement's set
- Swaps displayed F-skills to the selected attunement's set
- Updates button active state

Use the desktop's attunement icon URLs from the GW2 render CDN. Pure client-side toggle — all data is already in the payload.

#### 3b. Land/Water Toggle

A segmented pill toggle ("Land" / "Water") using the desktop's `.underwater-toggle` CSS classes. Clicking "Water":
- Swaps weapon skills to `waterSkills.weaponSkills`
- Swaps F-skills to `waterSkills.professionMechanics`
- Swaps heal/utility/elite to `waterSkills.skills`

Default is "Land".

#### 3c. Equipment Renderer

**Armor**: Vertical list (not grid). Each slot:
- Slot icon (`<img>` from `equipmentIcons[slot]`)
- Label (HEAD, SHOULDERS, etc.)
- Stat combo name (Berserker's)
- Stat attributes (Power · Precision · Ferocity) via `STAT_COMBOS` lookup
- Rune badge inline (resolved name from `equipmentDisplay.runes[slot]`)
- Infusion badge inline (resolved from `equipmentDisplay.infusions[slot]`)

**Weapons**: Icon + name + stat combo + stat breakdown + sigil badges inline.

**Trinkets**: 4-column grid matching desktop. Row 1: Back, Accessory 1, Accessory 2, Relic. Row 2: Amulet, Ring 1, Ring 2. Each with infusion badges.

**Remove separate Runes/Infusions summary sections**. Upgrade info is shown inline on each slot.

**Consumables**: Resolved names with icons for Food, Utility, Enrichment.

#### 3d. Attributes Panel

Right column of Equipment tab. Renders `computedStats` as a table:
- Base attributes: Power, Precision, Toughness, Vitality, Ferocity, Condition Damage, Expertise, Concentration, Healing Power
- Derived stats: Crit Chance, Crit Damage, Health, Boon Duration, Condition Duration
- Stat modifiers section below the table

Uses the desktop's `.equip-stats`, `.equip-stat-row`, `.equip-stat-cell` CSS classes.

#### 3e. Reference Panel

Right sidebar on the BUILD tab showing detailed info for the last hovered trait or skill:
- Icon (56×56)
- Name + meta line (type, slot)
- Description text
- Facts list (Recharge, Damage, Healing, Number of Targets, etc.)

Uses the desktop's `.hover-preview` CSS classes. Populated by clicking or hovering `[data-name]` elements that also have `data-icon`, `data-facts` attributes.

The trait/skill `facts` arrays must be preserved in the enriched build data.

#### 3f. Improved Hover Preview

Replace the minimal tooltip with the desktop's rich hover card:
- `.hover-preview__head` with icon + title + meta
- `.hover-preview__desc` with description
- `.hover-preview__facts` with fact items
- Smart positioning (flips near screen edges)

#### 3g. Spec Card Background Fix

Fix the background image styling in `render-specs.js`:
- Use the wiki FilePath URL format for spec backgrounds
- Change from `background-size: 100% 100%` to `background-size: cover` for the image layer
- Maintain the gradient overlay

### 4. Files Changed

**Main process (data enrichment):**
- `src/main/buildPublish.js` — major expansion for land/water skill sets, F-skill filtering, equipment icons, computed stats
- `src/main/index.js` — pass additional data to serializeForPublish if needed
- `tests/unit/buildPublish.test.js` — tests for new enrichment

**SPA renderers:**
- `src/site/render-build.js` — layout reorder, reference panel sidebar, attunement/land-water toggles
- `src/site/render-skills.js` — attunement toggle UI, land/water toggle, filtered skill display
- `src/site/render-equipment.js` — vertical armor, inline upgrades, icons, attributes panel
- `src/site/render-specs.js` — background fix
- `src/site/render-detail.js` — improved hover preview with rich cards
- `src/site/styles.css` — any SPA-specific style additions
- `src/site/main.js` — if needed for new data flow
