"use strict";

// Published-build stat computation. Delegates to the shared @axiapps/gw2-data
// engine so the published page matches the in-app Attributes panel exactly —
// the renderer uses the same engine via engine-bridge.js. A previous hand-rolled
// reimplementation here diverged from the engine (it double-counted the inactive
// weapon set, skipped trait flat bonuses/conversions, and double-counted base
// Vitality in Health), causing published pages to disagree with the game/app.
const { computeAttributes } = require("@axiapps/gw2-data/engine");

// ---------------------------------------------------------------------------
// Stat combos + slot weights — retained ONLY for the lightweight estimateRole()
// heuristic below. The authoritative stat math lives in the engine.
// For 4-stat combos: first 2 stats are major (p4), last 2 are minor (s4).
const _STAT_COMBOS_ENTRIES = [
  ["Berserker's", { stats: ["Power", "Precision", "Ferocity"] }],
  ["Marauder's", { stats: ["Power", "Precision", "Vitality", "Ferocity"] }],
  ["Assassin's", { stats: ["Precision", "Power", "Ferocity"] }],
  ["Valkyrie", { stats: ["Power", "Vitality", "Ferocity"] }],
  ["Dragon's", { stats: ["Power", "Ferocity", "Vitality", "Precision"] }],
  ["Viper's", { stats: ["Power", "ConditionDamage", "Precision", "Expertise"] }],
  ["Grieving", { stats: ["Power", "ConditionDamage", "Ferocity", "Precision"] }],
  ["Sinister", { stats: ["ConditionDamage", "Power", "Precision"] }],
  ["Dire", { stats: ["ConditionDamage", "Toughness", "Vitality"] }],
  ["Rabid", { stats: ["ConditionDamage", "Toughness", "Precision"] }],
  ["Carrion", { stats: ["ConditionDamage", "Power", "Vitality"] }],
  ["Trailblazer's", { stats: ["Toughness", "ConditionDamage", "Vitality", "Expertise"] }],
  ["Knight's", { stats: ["Toughness", "Power", "Precision"] }],
  ["Soldier's", { stats: ["Power", "Toughness", "Vitality"] }],
  ["Sentinel's", { stats: ["Vitality", "Power", "Toughness"] }],
  ["Wanderer's", { stats: ["Power", "Vitality", "Toughness", "Concentration"] }],
  ["Diviner's", { stats: ["Power", "Concentration", "Ferocity", "Precision"] }],
  ["Cleric's", { stats: ["HealingPower", "Toughness", "Power"] }],
  ["Minstrel's", { stats: ["Toughness", "HealingPower", "Vitality", "Concentration"] }],
  ["Harrier's", { stats: ["Power", "HealingPower", "Concentration"] }],
  ["Ritualist's", { stats: ["Vitality", "ConditionDamage", "Expertise", "Concentration"] }],
  ["Seraph", { stats: ["Precision", "ConditionDamage", "HealingPower", "Concentration"] }],
  ["Crusader", { stats: ["Power", "Toughness", "Ferocity", "HealingPower"] }],
  ["Zealot's", { stats: ["Power", "Precision", "HealingPower"] }],
  ["Giver's", { stats: ["Toughness", "HealingPower", "Concentration"] }],
  ["Celestial", { stats: ["Power", "Precision", "Toughness", "Vitality", "ConditionDamage", "Ferocity", "HealingPower", "Expertise", "Concentration"] }],
  // Added in issue #133 — missing PvE / WvW stat sets
  ["Apothecary's", { stats: ["HealingPower", "Toughness", "ConditionDamage"] }],
  ["Magi's", { stats: ["HealingPower", "Precision", "Vitality"] }],
  ["Shaman's", { stats: ["Vitality", "ConditionDamage", "HealingPower"] }],
  ["Rampager's", { stats: ["Precision", "Power", "ConditionDamage"] }],
  ["Cavalier's", { stats: ["Toughness", "Power", "Ferocity"] }],
  ["Nomad's", { stats: ["Toughness", "Vitality", "HealingPower"] }],
  ["Settler's", { stats: ["Toughness", "ConditionDamage", "HealingPower"] }],
  ["Giver's", { stats: ["Toughness", "HealingPower", "Concentration"] }],
  ["Captain's", { stats: ["Toughness", "Power", "HealingPower"] }],
  ["Vigilant", { stats: ["Power", "Toughness", "Concentration"] }],
  ["Apostate's", { stats: ["ConditionDamage", "Toughness", "HealingPower"] }],
  ["Plaguedoctor's", { stats: ["ConditionDamage", "Vitality", "HealingPower", "Concentration"] }],
  ["Marshal's", { stats: ["Power", "HealingPower", "Precision", "ConditionDamage"] }],
  ["Demolisher", { stats: ["Power", "Precision", "Toughness", "Ferocity"] }],
  ["Commander's", { stats: ["Power", "Precision", "Toughness", "Concentration"] }],
];
// Add aliases without "'s" so imported builds (e.g. "Wanderer") resolve correctly
const STAT_COMBOS_BY_LABEL = new Map(
  _STAT_COMBOS_ENTRIES.flatMap(([label, combo]) => {
    const entries = [[label, combo]];
    if (label.endsWith("'s")) entries.push([label.slice(0, -2), combo]);
    return entries;
  })
);

// Ascended/Legendary stat weights per slot (estimateRole heuristic only).
const SLOT_WEIGHTS = {
  head:       { p: 63,  s: 45,  p4: 54,  s4: 30, c: 30 },
  shoulders:  { p: 47,  s: 34,  p4: 40,  s4: 22, c: 22 },
  chest:      { p: 141, s: 101, p4: 121, s4: 66, c: 66 },
  hands:      { p: 47,  s: 34,  p4: 40,  s4: 22, c: 22 },
  legs:       { p: 94,  s: 67,  p4: 81,  s4: 44, c: 44 },
  feet:       { p: 47,  s: 34,  p4: 40,  s4: 22, c: 22 },
  mainhand1:  { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  offhand1:   { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  mainhand2:  { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  offhand2:   { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  back:       { p: 63,  s: 40,  p4: 51,  s4: 27, c: 28 },
  amulet:     { p: 157, s: 108, p4: 132, s4: 71, c: 72 },
  ring1:      { p: 126, s: 85,  p4: 105, s4: 56, c: 57 },
  ring2:      { p: 126, s: 85,  p4: 105, s4: 56, c: 57 },
  accessory1: { p: 110, s: 74,  p4: 92,  s4: 49, c: 50 },
  accessory2: { p: 110, s: 74,  p4: 92,  s4: 49, c: 50 },
};

// Two-handed weapon stat weights (attribute_adjustment 716.8, double the 1h value).
const TWO_HAND_WEIGHTS = { p: 251, s: 179, p4: 215, s4: 118, c: 118 };
const TWO_HAND_WEAPON_IDS = new Set([
  "greatsword", "hammer", "longbow", "rifle", "shortbow", "staff", "spear",
]);

// ---------------------------------------------------------------------------
// Build the engine's `catalogs` shape from the publish-side catalogs.
// activeCatalog (profession catalog) supplies trait/skill/spec maps; the
// upgradeCatalog supplies rune/food/utility/infusion/enrichment maps.
// ---------------------------------------------------------------------------
function _buildEngineCatalogs(upgradeCatalog, activeCatalog) {
  return {
    traitById: activeCatalog?.traitById || new Map(),
    skillById: activeCatalog?.skillById || new Map(),
    specializationById: activeCatalog?.specializationById || new Map(),
    runeById: upgradeCatalog?.runeById || new Map(),
    foodById: upgradeCatalog?.foodById || new Map(),
    utilityById: upgradeCatalog?.utilityById || new Map(),
    infusionById: upgradeCatalog?.infusionById || new Map(),
    enrichmentById: upgradeCatalog?.enrichmentById || new Map(),
  };
}

// Map a published skill selection ({ heal, utility:[], elite } of refs/ids) into
// the engine's ctx.skills shape ({ healId, utilityIds:[], eliteId }) so equipped
// signets contribute their passive stat buffs. Tolerates plain ids or {id} refs.
function _toEngineSkills(skills) {
  if (!skills) return { healId: 0, utilityIds: [], eliteId: 0 };
  // Already in engine shape.
  if ("healId" in skills || "utilityIds" in skills || "eliteId" in skills) {
    return {
      healId: Number(skills.healId) || 0,
      utilityIds: (skills.utilityIds || []).map((x) => Number(x) || 0),
      eliteId: Number(skills.eliteId) || 0,
    };
  }
  const idOf = (ref) => (ref && typeof ref === "object" ? Number(ref.id) : Number(ref)) || 0;
  return {
    healId: idOf(skills.heal),
    utilityIds: (Array.isArray(skills.utility) ? skills.utility : []).map(idOf),
    eliteId: idOf(skills.elite),
  };
}

/**
 * Compute the stat block embedded in a published build.
 *
 * @param {object|null} equipment - build.equipment
 * @param {object|null} upgradeCatalog - rune/food/utility/infusion/enrichment maps
 * @param {string} profession - build.profession (may be an elite-spec name)
 * @param {string} gameMode - "pve" | "wvw" | "pvp"
 * @param {object} [opts] - additional context so traits/conversions apply:
 *   { specializations, skills, activeCatalog, underwaterMode, activeWeaponSet }
 * @returns {{ stats: object, modifiers: array }}
 *
 * Published pages show the unbuffed baseline (assumed boons/sigil stacks are not
 * persisted), which matches the app's default Attributes panel.
 */
function computePublishStats(equipment, upgradeCatalog, profession, gameMode, opts = {}) {
  if (!equipment) return { stats: {}, modifiers: [] };

  const ctx = {
    profession: profession || "",
    gameMode: gameMode || "pve",
    underwaterMode: Boolean(opts.underwaterMode),
    activeWeaponSet: Number(opts.activeWeaponSet) || 1,
    specializations: (opts.specializations || []).map((s) => ({
      id: s?.specializationId || s?.id,
      specializationId: s?.specializationId,
      majorChoices: s?.majorChoices || {},
      minorTraits: s?.minorTraits,
    })),
    equipment: {
      slots: equipment.slots || {},
      weapons: equipment.weapons || {},
      runes: equipment.runes || {},
      sigils: equipment.sigils || {},
      infusions: equipment.infusions || {},
      enrichment: equipment.enrichment ? Number(equipment.enrichment) : null,
      food: equipment.food ? Number(equipment.food) : null,
      utility: equipment.utility ? Number(equipment.utility) : null,
    },
    skills: _toEngineSkills(opts.skills),
    // Static baseline — no assumed boons / sigil stacks / signet actives.
    assumedBoons: null,
    sigilStacks: null,
    activeSignets: null,
    berserkActive: false,
  };

  const catalogs = _buildEngineCatalogs(upgradeCatalog, opts.activeCatalog);
  const eng = computeAttributes(ctx, catalogs);
  const t = eng.total;
  const d = eng.derived;

  const stats = {
    Power: t.Power,
    Precision: t.Precision,
    Toughness: t.Toughness,
    Vitality: t.Vitality,
    Ferocity: t.Ferocity,
    ConditionDamage: t.ConditionDamage,
    Expertise: t.Expertise,
    Concentration: t.Concentration,
    HealingPower: t.HealingPower,
    Health: d.health,
    CritChance: d.critChance.toFixed(2) + "%",
    CritDamage: d.critDamage.toFixed(1) + "%",
    BoonDuration: d.boonDuration.toFixed(1) + "%",
    ConditionDuration: d.conditionDuration.toFixed(1) + "%",
  };

  return { stats, modifiers: [] };
}

// ── Lightweight role estimation (mirrors renderer roleEstimator.js) ──────────

const MIN_THRESHOLD = 700;
const HYBRID_RATIO  = 0.10;

const ROLE_SCORERS = [
  { role: "Power DPS",    fn: s => s.Power * 1.0 + s.Precision * 0.5 + s.Ferocity * 0.5 },
  { role: "Condi DPS",    fn: s => s.ConditionDamage * 1.0 + s.Expertise * 0.8 },
  { role: "Boon Support", fn: s => s.Concentration * 1.5 + s.HealingPower * 0.3 },
  { role: "Heal Support", fn: s => s.HealingPower * 1.5 + s.Concentration * 0.3 },
];

function estimateRole(build) {
  const slots = build?.equipment?.slots;
  if (!slots || !Object.values(slots).some(Boolean)) return null;

  const totals = {
    Power: 0, Precision: 0, Toughness: 0, Vitality: 0,
    Ferocity: 0, ConditionDamage: 0, Expertise: 0, Concentration: 0, HealingPower: 0,
  };

  const weapons = build?.equipment?.weapons || {};
  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (!comboLabel) continue;
    const combo = STAT_COMBOS_BY_LABEL.get(comboLabel);
    let w = SLOT_WEIGHTS[slotKey];
    if (!combo || !w) continue;
    if (slotKey.startsWith("mainhand") && TWO_HAND_WEAPON_IDS.has(weapons[slotKey])) {
      w = TWO_HAND_WEIGHTS;
    }
    const n = combo.stats.length;
    if (n <= 3) {
      totals[combo.stats[0]] += w.p;
      for (let i = 1; i < n; i++) totals[combo.stats[i]] += w.s;
    } else if (n === 4) {
      totals[combo.stats[0]] += w.p4;
      totals[combo.stats[1]] += w.p4;
      totals[combo.stats[2]] += w.s4;
      totals[combo.stats[3]] += w.s4;
    } else {
      for (const stat of combo.stats) totals[stat] += w.c;
    }
  }

  const scored = ROLE_SCORERS.map(({ role, fn }) => ({ role, score: fn(totals) }));
  scored.sort((a, b) => b.score - a.score);

  const [first, second] = scored;
  if (first.score < MIN_THRESHOLD) return "Unknown";
  if (second && second.score >= MIN_THRESHOLD && (first.score - second.score) / first.score < HYBRID_RATIO) {
    return "Hybrid";
  }
  return first.role;
}

module.exports = { computePublishStats, estimateRole };
