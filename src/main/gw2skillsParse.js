"use strict";

const JSON5 = require("json5");
const { decodeChatLinkToBuild } = require("./buildChatLink.js");

// ── Page parser ──────────────────────────────────────────────────────────────
// gw2skills embeds `new BuildEditor({ ..., preload: {…} })` in the page. The
// top-level arg contains JS expressions (e.g. `showinfo: SI || undefined`) that
// only a real evaluator could handle — but `preload` itself is plain data. So we
// extract ONLY the balanced-brace `preload` sub-object and parse it with JSON5
// (unquoted keys, trailing commas). This is browser/Worker-safe (no `vm`/eval).
function _extractBalancedObject(src, fromIndex) {
  let depth = 0, start = -1;
  for (let i = fromIndex; i < src.length; i++) {
    const c = src[i];
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

function parsePreloadFromHtml(html) {
  const dbidMatch = html.match(/dbid\s*:\s*(\d+)/);
  if (!dbidMatch) throw new Error("Could not find dbid in gw2skills page");
  const dbid = dbidMatch[1];

  const marker = "new BuildEditor(";
  const beStart = html.indexOf(marker);
  if (beStart === -1) throw new Error("Could not find BuildEditor in gw2skills page");

  const preloadKey = html.indexOf("preload", beStart);
  if (preloadKey === -1) throw new Error("No preload found in BuildEditor args");
  const colon = html.indexOf(":", preloadKey);
  const literal = colon === -1 ? null : _extractBalancedObject(html, colon + 1);
  if (!literal) throw new Error("Could not extract preload object");

  // JSON5 supports unquoted keys/trailing commas but NOT bare `undefined`.
  // gw2skills occasionally emits `key: undefined`; normalize to null before parse.
  const cleaned = literal.replace(/\bundefined\b/g, "null");
  let preload;
  try {
    preload = JSON5.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse gw2skills preload: ${err.message}`);
  }
  if (!preload || !preload.chatlink) throw new Error("No chatlink in gw2skills preload");
  return { preload, dbid };
}

// ── Stat name lookup ───────────────────────────────────────────────────────────

/**
 * Build a Map from profile.id → prfltype name (e.g. "Berserker").
 * Exported for unit testing.
 * @param {object} db  raw DB json
 * @returns {Map<number, string>}
 */
function _buildStatLookup(db) {
  const profileTable = db.profile;
  const prfltypeTable = db.prfltype;
  if (!profileTable || !prfltypeTable) return new Map();

  const pDesc = profileTable.desc;
  const ptDesc = prfltypeTable.desc;
  const pIdIdx = pDesc.indexOf("id");
  const pPrflIdx = pDesc.indexOf("profile");
  const ptIdIdx = ptDesc.indexOf("id");
  const ptNameIdx = ptDesc.indexOf("name");

  // Build prfltype id → name map first
  const prfltypeNames = new Map();
  for (const row of prfltypeTable.rows) {
    prfltypeNames.set(row[ptIdIdx], row[ptNameIdx]);
  }

  // Then build profile.id → stat name
  const lookup = new Map();
  for (const row of profileTable.rows) {
    const profileId = row[pIdIdx];
    const prfltypeId = row[pPrflIdx];
    const name = prfltypeNames.get(prfltypeId);
    if (name) lookup.set(profileId, name);
  }
  return lookup;
}

// ── Stat name normalizer ───────────────────────────────────────────────────────

// gw2skills prfltype names → axiforge STAT_COMBOS labels
const _GW2S_STAT_MAP = {
  "Berserker":   "Berserker's",
  "Marauder":    "Marauder's",
  "Assassin":    "Assassin's",
  "Valkyrie":    "Valkyrie",
  "Dragon":      "Dragon's",
  "Viper":       "Viper's",
  "Grieving":    "Grieving",
  "Sinister":    "Sinister",
  "Dire":        "Dire",
  "Rabid":       "Rabid",
  "Carrion":     "Carrion",
  "Trailblazer": "Trailblazer's",
  "Knight":      "Knight's",
  "Soldier":     "Soldier's",
  "Sentinel":    "Sentinel's",
  "Wanderer":    "Wanderer's",
  "Diviner":     "Diviner's",
  "Cleric":      "Cleric's",
  "Minstrel":    "Minstrel's",
  "Harrier":     "Harrier's",
  "Ritualist":   "Ritualist's",
  "Seraph":      "Seraph",
  "Zealot":      "Zealot's",
  "Celestial":   "Celestial",
};

/**
 * Normalize a gw2skills stat name to an axiforge STAT_COMBOS label.
 * Strips WvW/PvP qualifiers, then does a direct lookup.
 * Exported for unit testing.
 */
function _normalizeStatName(name) {
  if (!name) return "";
  // Strip WvW/PvP qualifier, e.g. "Berserker (WvW)" → "Berserker"
  const base = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return _GW2S_STAT_MAP[base] ?? base;
}

// ── Upgrade / buff lookup helpers ──────────────────────────────────────────────

/**
 * Look up an upgrade name (sigil, rune, infusion) by id.
 * Exported for unit testing.
 * @param {Map<number, Array>} upgradeMap  id → row
 * @param {number} nameIdx               column index of the name field
 * @param {number} id
 * @returns {string}
 */
function _lookupUpgradeName(upgradeMap, nameIdx, id) {
  if (!id) return "";
  const row = upgradeMap.get(id);
  return row ? (row[nameIdx] || "") : "";
}

/**
 * Look up a buff name (food, utility) by id.
 * Exported for unit testing.
 */
function _lookupBuffName(buffMap, nameIdx, id) {
  if (!id) return "";
  const row = buffMap.get(id);
  return row ? (row[nameIdx] || "") : "";
}

// ── Slot name maps ─────────────────────────────────────────────────────────────

const _ARMOR_SLOT_MAP = {
  helm:      "head",
  shoulders: "shoulders",
  coat:      "chest",
  gloves:    "hands",
  leggings:  "legs",
  boots:     "feet",
  breather:  "breather",
};

const _WEAPON_SLOT_MAP = {
  w11: "mainhand1",
  w12: "offhand1",
  w21: "mainhand2",
  w22: "offhand2",
  w31: "aquatic1",
  w32: "aquatic2",
};

// preload.weapon = [mainhand1_id, offhand1_id, mainhand2_id, offhand2_id, aquatic1_id?, aquatic2_id?]
// weapon table type: 0=offhand-only, 1=one-handed (either), 2=two-handed, 3=underwater
const _PRELOAD_WEAPON_SLOTS = ["mainhand1", "offhand1", "mainhand2", "offhand2", "aquatic1", "aquatic2"];

const _TRINKET_SLOT_MAP = {
  amulet:   "amulet",
  ring1:    "ring1",
  ring2:    "ring2",
  earring1: "accessory1",
  earring2: "accessory2",
  back:     "back",
};

// How many infusion slots each axiforge slot has (array slots); absent = string (1 slot)
const _INF_COUNTS = {
  mainhand1: 2, offhand1: 1, mainhand2: 2, offhand2: 1,
  aquatic1: 2,  aquatic2: 2,
  back: 2, ring1: 3, ring2: 3, breather: 1,
  // head/shoulders/chest/hands/legs/feet/accessory1/accessory2 = string (1)
};

// ── Equipment mapper ───────────────────────────────────────────────────────────

/**
 * Map a gw2skills preload.equipment object to axiforge equipment fields.
 * Exported for unit testing.
 */
function _mapEquipment(eq, statLookup, upgradeMap, upgradeNameIdx, buffMap, buffNameIdx, twoHandedSlots = new Set()) {
  const slots = {};
  const runes = {};
  const sigils = {};
  const infusions = {};

  function statName(profileId) {
    return _normalizeStatName(statLookup.get(profileId) || "");
  }
  function upgradeName(id) {
    return _lookupUpgradeName(upgradeMap, upgradeNameIdx, id);
  }
  function infName(id) {
    return id ? upgradeName(id) : "";
  }

  // ── Armor ────────────────────────────────────────────────────────────────────
  for (const [gw2Slot, axSlot] of Object.entries(_ARMOR_SLOT_MAP)) {
    const piece = eq.armor?.[gw2Slot];
    if (!piece) continue;

    const s = statName(piece.item?.[0]);
    if (s) slots[axSlot] = s;

    const runeId = piece.up?.[0]?.[0];
    if (runeId) {
      const rn = upgradeName(runeId);
      if (rn) runes[axSlot] = rn;
    }

    const infId = piece.inf?.[0];
    infusions[axSlot] = infId ? (infName(infId) || "") : "";
  }

  // ── Breather: gw2skills rarely exports UW gear; fall back to helmet values ─
  if (!eq.armor?.breather && eq.armor?.helm) {
    const helm = eq.armor.helm;
    const bs = statName(helm.item?.[0]);
    if (bs) slots.breather = bs;
    const bRuneId = helm.up?.[0]?.[0];
    if (bRuneId) { const bn = upgradeName(bRuneId); if (bn) runes.breather = bn; }
    const bInfId = helm.inf?.[0];
    infusions.breather = bInfId ? (infName(bInfId) || "") : "";
  }

  // ── Weapons ──────────────────────────────────────────────────────────────────
  for (const [gw2Slot, axSlot] of Object.entries(_WEAPON_SLOT_MAP)) {
    const piece = eq.weapon?.[gw2Slot];
    // gw2skills emits offhand entries with item id 0 that mirror a two-handed
    // mainhand's second sigil/infusion — skip them entirely to avoid phantom upgrades
    if (!piece || !piece.item?.[0]) continue;

    const s = statName(piece.item[0]);
    if (s) slots[axSlot] = s;

    // Sigils: gw2skills lists the whole set's sigil pair on the mainhand entry
    // and repeats the offhand's own sigil on the offhand entry. A weapon only
    // has 2 sigil slots of its own when it is two-handed (aquatic weapons always are).
    const isOffhand = axSlot.startsWith("offhand");
    const isTwoHanded = axSlot.startsWith("aquatic") || twoHandedSlots.has(axSlot);
    const sigilCount = (isOffhand || !isTwoHanded) ? 1 : 2;
    const sigilArr = [];
    for (let i = 0; i < sigilCount; i++) {
      const sigilId = piece.up?.[i]?.[0];
      sigilArr.push(sigilId ? (upgradeName(sigilId) || "") : "");
    }
    sigils[axSlot] = sigilArr;

    // Infusions: same set-level packing as sigils — 1 slot per 1H weapon, 2 for 2H
    const infCount = (isOffhand || !isTwoHanded) ? 1 : (_INF_COUNTS[axSlot] ?? 1);
    const arr = [];
    for (let i = 0; i < infCount; i++) arr.push(infName(piece.inf?.[i]) || "");
    infusions[axSlot] = arr;
  }

  // ── Trinkets ─────────────────────────────────────────────────────────────────
  for (const [gw2Slot, axSlot] of Object.entries(_TRINKET_SLOT_MAP)) {
    const piece = eq.trinket?.[gw2Slot];
    if (!piece) continue;

    const s = statName(piece.item?.[0]);
    if (s) slots[axSlot] = s;

    // Infusions
    const infCount = _INF_COUNTS[axSlot];
    if (infCount) {
      // Array slot
      const arr = [];
      for (let i = 0; i < infCount; i++) arr.push(infName(piece.inf?.[i]) || "");
      infusions[axSlot] = arr;
    } else if (axSlot !== "amulet") {
      // Single-string slot (accessory1, accessory2)
      infusions[axSlot] = infName(piece.inf?.[0]) || "";
    }
  }

  // ── Food, utility, relic ──────────────────────────────────────────────────────
  const food    = _lookupBuffName(buffMap, buffNameIdx, eq.buff?.food)    || "";
  const utility = _lookupBuffName(buffMap, buffNameIdx, eq.buff?.utility) || "";
  const relic   = upgradeName(eq.relic) || "";

  // ── Enrichment (amulet upgrade slot) ─────────────────────────────────────────
  const enrichment = upgradeName(eq.trinket?.amulet?.up?.[0]?.[0]) || "";

  // ── statPackage — set if all non-empty slots share one stat ──────────────────
  const statValues = Object.values(slots).filter(Boolean);
  const uniqueStats = [...new Set(statValues)];
  const statPackage = uniqueStats.length === 1 ? uniqueStats[0] : "";

  return { slots, runes, sigils, infusions, food, utility, relic, enrichment, statPackage };
}

// ── Profession → primary aquatic weapon ───────────────────────────────────────
// gw2skills doesn't encode aquatic weapon type in the URL; infer from profession.
// Professions with multiple options (Ranger, Thief) get the most common choice.
const _PROFESSION_PRIMARY_AQUATIC = {
  Guardian:    "trident",
  Warrior:     "spear",
  Engineer:    "harpoon",
  Ranger:      "spear",
  Thief:       "spear",
  Elementalist:"trident",
  Mesmer:      "trident",
  Necromancer: "trident",
  Revenant:    "spear",
};

// ── Weapon key overrides ───────────────────────────────────────────────────────
// gw2skills weapon table key field → axiforge WEAPON_TYPES id (lowercase)
// axiforge stores weapons by id (e.g. "dagger", "greatsword"), not label.
// Only entries where gw2skills key differs from axiforge id.
const _GW2S_WEAPON_KEY_OVERRIDES = {
  "landspear":  "spear",   // gw2skills land spear → axiforge "spear"
  "harpoon_gun": "harpoon", // gw2skills harpoon_gun → axiforge "harpoon"
};

// ── Amalgam morph skill mapping ────────────────────────────────────────────
// gw2skills internal skill ID → GW2 API skill ID for Amalgam morph slots (F2–F4).
// Matched by visual icon comparison between gw2skills CDN and GW2 render service.
const _GW2S_MORPH_SKILL_MAP = {
  1509: 76798,  // Defensive Protocol: Cleanse
  1510: 76959,  // Defensive Protocol: Protect
  1511: 77163,  // Defensive Protocol: Thorns
  1512: 76806,  // Offensive Protocol: Obliterate
  1513: 76815,  // Offensive Protocol: Pierce
  1514: 76927,  // Offensive Protocol: Demolish
  1515: 77103,  // Offensive Protocol: Shred
};

/**
 * Extract Amalgam morph skill IDs from the gw2skills preload.extra array.
 * extra indices 2, 3, 4 correspond to F2, F3, F4 morph slots.
 * Returns [F2, F3, F4] as GW2 API skill IDs, or [0,0,0] if not applicable.
 * Exported for unit testing.
 */
function _extractMorphSkillIds(extra) {
  if (!Array.isArray(extra)) return [0, 0, 0];
  return [extra[2], extra[3], extra[4]].map(
    (gw2sId) => (gw2sId ? (_GW2S_MORPH_SKILL_MAP[gw2sId] || 0) : 0)
  );
}

// ── Transport-agnostic orchestration ────────────────────────────────────────

const _dbCache = new Map();

/**
 * Fetch and decode a gw2skills.net editor URL into an axiforge build object.
 * Transport-agnostic: the caller injects `fetchText` (HTTP GET → text) and
 * `getUpgradeCatalog` so this module stays browser/Worker-safe.
 * READ-ONLY: returns the assembled (normalize-ready) build; never writes a store.
 *
 * @param {string} url  full gw2skills.net editor URL
 * @param {{ fetchText: (url:string)=>Promise<string>, getUpgradeCatalog: ()=>Promise<object>, name?: (string|null), folderId?: (string|null), gameMode?: string }} deps
 * @returns {Promise<object>} the assembled axiforge build object (not saved)
 */
async function parseGw2Skills(url, deps = {}) {
  const { fetchText, getUpgradeCatalog, name = null, folderId = null, gameMode } = deps;
  if (typeof fetchText !== "function") throw new Error("parseGw2Skills requires deps.fetchText");
  if (typeof getUpgradeCatalog !== "function") throw new Error("parseGw2Skills requires deps.getUpgradeCatalog");

  // Normalize to English site
  const normalizedUrl = url.replace(/^https?:\/\/(?:www\.)?gw2skills\.net/, "https://en.gw2skills.net");
  const { preload, dbid } = parsePreloadFromHtml(await fetchText(normalizedUrl));

  const buildGameMode = preload.mode === "wvw" ? "wvw"
    : preload.mode === "pvp" ? "pvp"
    : gameMode || "pve";

  async function fetchDb(id) {
    if (_dbCache.has(id)) return _dbCache.get(id);
    const raw = JSON.parse(await fetchText(`https://en.gw2skills.net/ajax/db/en.${id}.json`));
    _dbCache.set(id, raw);
    return raw;
  }

  // Decode build template (profession, specs, traits, skills)
  const chatLink = `[&${preload.chatlink}]`;
  const [buildTemplate, db, upgradeCatalog] = await Promise.all([
    decodeChatLinkToBuild(chatLink, name, folderId, buildGameMode),
    fetchDb(dbid),
    getUpgradeCatalog(),
  ]);

  // ── Build gw2skills lookup helpers ──────────────────────────────────────────
  const statLookup = _buildStatLookup(db);

  const upgradeTable   = db.upgrade;
  const upgradeDesc    = upgradeTable?.desc ?? [];
  const upgradeNameIdx = upgradeDesc.indexOf("name");
  const upgradeTypeIdx = upgradeDesc.indexOf("type");

  const upgradeMap = new Map();
  for (const row of upgradeTable?.rows ?? []) upgradeMap.set(row[0], row);

  // Expand short names ("Force" → "Superior Sigil of Force", "the Scholar" → "Superior Rune of the Scholar")
  const expandedUpgradeMap = new Map();
  for (const [id, row] of upgradeMap) {
    const expandedRow = [...row];
    const rawName = expandedRow[upgradeNameIdx] || "";
    const type    = upgradeTypeIdx >= 0 ? expandedRow[upgradeTypeIdx] : -1;
    if (rawName) {
      if (type === 2) expandedRow[upgradeNameIdx] = `Superior Rune of ${rawName}`;
      else if (type === 1) expandedRow[upgradeNameIdx] = `Superior Sigil of ${rawName}`;
    }
    expandedUpgradeMap.set(id, expandedRow);
  }

  const buffTable   = db.buff;
  const buffDesc    = buffTable?.desc ?? [];
  const buffMap     = new Map();
  const buffNameIdx = buffDesc.indexOf("name");
  for (const row of buffTable?.rows ?? []) buffMap.set(row[0], row);

  // ── Build weapon type lookup: weapon table id → { name, type } ─────────────
  // type: 0=offhand, 1=1H mainhand, 2=2H mainhand, 3=underwater
  const weaponTypeMap = new Map(); // gw2skills weapon id → { axId, type }
  if (db.weapon) {
    const wDesc = db.weapon.desc;
    const wIdIdx   = wDesc.indexOf("id");
    const wKeyIdx  = wDesc.indexOf("key");
    const wTypeIdx = wDesc.indexOf("type");
    for (const row of db.weapon.rows) {
      const gw2Key = row[wKeyIdx] || "";
      const axId = _GW2S_WEAPON_KEY_OVERRIDES[gw2Key] || gw2Key;
      weaponTypeMap.set(row[wIdIdx], { axId, type: row[wTypeIdx] });
    }
  }

  const eq = preload.equipment || {};

  // ── Which mainhand slots hold two-handed weapons? ──────────────────────────
  // Needed by _mapEquipment: gw2skills packs the set's sigil/infusion pair on the
  // mainhand entry, but only a 2H weapon actually owns both slots.
  const twoHandedSlots = new Set();
  (preload.weapon || []).forEach((weaponId, i) => {
    const axSlot = _PRELOAD_WEAPON_SLOTS[i];
    if (!axSlot || !axSlot.startsWith("mainhand")) return;
    if (weaponTypeMap.get(weaponId)?.type === 2) twoHandedSlots.add(axSlot);
  });

  // ── Map equipment (returns name strings for upgrades) ──────────────────────
  const equipment = _mapEquipment(eq, statLookup, expandedUpgradeMap, upgradeNameIdx, buffMap, buffNameIdx, twoHandedSlots);

  // ── Resolve upgrade names → GW2 numeric item IDs ──────────────────────────
  const runeByName     = new Map(upgradeCatalog.runes.map(r => [r.name, String(r.id)]));
  const sigilByName    = new Map(upgradeCatalog.sigils.map(s => [s.name, String(s.id)]));
  const infusionByName = new Map([
    ...(upgradeCatalog.infusions  || []).map(i => [i.name, String(i.id)]),
    ...(upgradeCatalog.enrichments || []).map(e => [e.name, String(e.id)]),
  ]);
  const foodByName    = new Map((upgradeCatalog.foods     || []).map(f => [f.name, String(f.id)]));
  const utilityByName = new Map((upgradeCatalog.utilities || []).map(u => [u.name, String(u.id)]));

  const toId = (nameMap, n) => nameMap.get(n) || "";

  const resolvedRunes = {};
  for (const [slot, n] of Object.entries(equipment.runes || {})) {
    const id = toId(runeByName, n);
    if (id) resolvedRunes[slot] = id;
  }

  const resolvedSigils = {};
  for (const [slot, arr] of Object.entries(equipment.sigils || {})) {
    resolvedSigils[slot] = arr.map(n => n ? toId(sigilByName, n) : "");
  }

  const resolvedInfusions = {};
  for (const [slot, val] of Object.entries(equipment.infusions || {})) {
    if (Array.isArray(val)) {
      resolvedInfusions[slot] = val.map(n => n ? toId(infusionByName, n) : "");
    } else {
      resolvedInfusions[slot] = val ? toId(infusionByName, val) : "";
    }
  }

  const resolvedFood       = equipment.food       ? toId(foodByName,    equipment.food)       : "";
  const resolvedUtility    = equipment.utility    ? toId(utilityByName, equipment.utility)    : "";
  const resolvedEnrichment = equipment.enrichment ? toId(infusionByName, equipment.enrichment) : "";

  // Relic is stored as a label string matching the upgrade catalog's relic name
  // (e.g. "Relic of the Scholar"). gw2skills stores short names; prefix if needed.
  let resolvedRelic = equipment.relic || "";
  if (resolvedRelic && !resolvedRelic.startsWith("Relic of ")) {
    resolvedRelic = `Relic of ${resolvedRelic}`;
  }

  // ── Weapon types from preload.weapon array ────────────────────────────────
  const weapons = { ...buildTemplate.equipment?.weapons };
  (preload.weapon || []).forEach((weaponId, i) => {
    if (!weaponId) return;
    const axSlot = _PRELOAD_WEAPON_SLOTS[i];
    if (!axSlot) return;
    const wt = weaponTypeMap.get(weaponId);
    if (!wt?.axId) return;
    const isOffhand = axSlot.startsWith("offhand");
    const isAquatic = axSlot.startsWith("aquatic");
    if (isAquatic  && wt.type !== 3) return;                     // aquatic: underwater only
    if (!isAquatic && wt.type === 3) return;                     // land: skip underwater
    if (isOffhand  && wt.type === 2) return;                     // offhand: skip 2H weapons
    if (!isOffhand && !isAquatic && wt.type === 0) return;       // mainhand: skip offhand-only
    weapons[axSlot] = wt.axId;
  });

  // Infer aquatic weapon type from profession when gw2skills doesn't encode it in the URL.
  if (!weapons.aquatic1 && eq.weapon?.w31?.item?.[0]) {
    const inferred = _PROFESSION_PRIMARY_AQUATIC[buildTemplate.profession];
    if (inferred) weapons.aquatic1 = inferred;
  }

  const finalEquipment = {
    ...buildTemplate.equipment,
    ...equipment,
    runes:      resolvedRunes,
    sigils:     resolvedSigils,
    infusions:  resolvedInfusions,
    enrichment: resolvedEnrichment,
    food:       resolvedFood,
    utility:    resolvedUtility,
    relic:      resolvedRelic,
    weapons,
  };

  // ── Amalgam morph skills from preload.extra ─────────────────────────────
  const morphSkillIds = _extractMorphSkillIds(preload.extra);

  return {
    ...buildTemplate,
    equipment: finalEquipment,
    gameMode: buildGameMode,
    morphSkillIds,
  };
}

module.exports = {
  parsePreloadFromHtml,
  parseGw2Skills,
  _buildStatLookup, _normalizeStatName, _lookupUpgradeName,
  _lookupBuffName, _mapEquipment, _extractMorphSkillIds,
};
