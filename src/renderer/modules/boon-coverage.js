import {
  BOON_NAMES, CONDITION_NAMES, CONDITION_NAME_NORMALIZE,
  BOON_DISPLAY_ORDER, BUFF_FACT_TYPES, BOON_CONDITION_ICONS,
} from "./constants.js";

const ALL_KNOWN_NAMES = [...BOON_NAMES, ...CONDITION_NAMES];

function normalizeName(status) {
  return CONDITION_NAME_NORMALIZE[status] || status;
}

// Check whether a specific boon/condition is described as ally-targeted in the description.
// Strategy:
// 1. If the boon name appears in a sentence with "allies/ally" → ally.
// 2. If the boon name appears in description but NOT in an ally sentence → self.
// 3. If the boon is NOT named in the description at all:
//    a. If the description mentions allies generically (no other boon names appear
//       near "allies" either) → ally (e.g. "grant boons to allies").
//    b. If other specific boons ARE named with allies → self (the ally mention
//       is about those specific boons, not this unnamed one).
// 4. No allies mentioned → self.
function isAllyTargeted(description, statusName, allBoonNames) {
  if (!description) return false;
  const desc = description.toLowerCase();
  const name = statusName.toLowerCase();
  const hasAllyWord = /\b(allies|ally)\b/.test(desc);
  if (!hasAllyWord) return false;

  const sentences = desc.split(/[.!;]/);

  // If the boon name appears in the description, check per-sentence
  if (desc.includes(name)) {
    for (const sentence of sentences) {
      if (sentence.includes(name) && /\b(allies|ally)\b/.test(sentence)) {
        return true;
      }
    }
    return false;
  }

  // Boon not named in description — check if the ally mentions are generic or specific
  // If any other known boon/condition name appears in an ally sentence, the ally
  // mention is specific to those boons → this unnamed boon defaults to self
  const knownNames = allBoonNames || [];
  for (const sentence of sentences) {
    if (!/\b(allies|ally)\b/.test(sentence)) continue;
    for (const known of knownNames) {
      if (sentence.includes(known.toLowerCase())) {
        // Ally mention is about a specific named boon, not generic
        return false;
      }
    }
  }
  // Ally mentions are generic (no specific boon named) → ally
  return true;
}

// Twisted Medicine (Harbinger trait 2220): "Elixir skills also grant their boons to
// allies within the elixir impact radius." When this trait is selected, boon facts
// from skills with the "Elixir" category are also ally-targeted.
const TWISTED_MEDICINE_TRAIT_ID = 2220;

function extractBuffFacts(entity, sourceType) {
  const results = [];
  const facts = entity.facts || [];
  const desc = entity.description || "";
  let sectionContext = ""; // most-recent NoData fact text — labels subsequent conditional facts
  for (const fact of facts) {
    if (fact.type === "NoData") {
      sectionContext = fact.text || "";
      continue;
    }
    if (!BUFF_FACT_TYPES.has(fact.type)) continue;
    const rawStatus = fact.status;
    if (!rawStatus) continue;
    const name = normalizeName(rawStatus);
    if (!BOON_NAMES.has(name) && !CONDITION_NAMES.has(name)) continue;
    results.push({
      name,
      sourceType,
      sourceName: entity.name || "",
      skillIcon: entity.icon || "",
      skillDescription: desc,
      skillFacts: facts,
      stacks: fact.apply_count || 0,
      duration: fact.duration || 0,
      context: sectionContext,
      isAlly: isAllyTargeted(desc, rawStatus, ALL_KNOWN_NAMES),
    });
  }
  return results;
}

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
      skillIcon: entity.icon || "",
      skillDescription: entity.description || "",
      skillFacts: entity.facts || [],
      duration,
      radius,
      kitName,
    });
  }
  return results;
}

/**
 * Extract combo finisher facts from a skill/trait entity.
 * Groups by finisher type (Blast, Whirl, Leap, Projectile).
 */
function extractComboFinishers(entity, sourceType, kitName = "") {
  const results = [];
  const facts = entity.facts || [];

  // Group by finisher type — count hits per type
  const byType = new Map();
  for (const fact of facts) {
    if (fact.type !== "ComboFinisher") continue;
    const ft = fact.finisher_type;
    if (!ft) continue;
    if (!byType.has(ft)) byType.set(ft, { count: 0, percent: 100 });
    const entry = byType.get(ft);
    entry.count++;
    if (fact.percent != null && fact.percent < 100) {
      entry.percent = fact.percent;
    }
  }

  for (const [finisherType, data] of byType) {
    results.push({
      finisherType,
      sourceType,
      sourceName: entity.name || "",
      skillIcon: entity.icon || "",
      skillDescription: entity.description || "",
      skillFacts: entity.facts || [],
      hitCount: data.count,
      percent: data.percent,
      kitName,
    });
  }
  return results;
}

function collectSkillIds(editor, catalog) {
  const ids = new Set();
  const skills = editor.skills || {};
  // Support both editor format (healId/utilityIds/eliteId)
  // and serialized build format (heal.id / utility[].id / elite.id).
  const healId = skills.healId || skills.heal?.id;
  const eliteId = skills.eliteId || skills.elite?.id;
  if (healId) ids.add(Number(healId));
  if (eliteId) ids.add(Number(eliteId));
  for (const uid of skills.utilityIds || []) {
    if (uid) ids.add(Number(uid));
  }
  for (const u of skills.utility || []) {
    if (u?.id) ids.add(Number(u.id));
  }
  // Profession mechanic skill IDs (F1-F5)
  // Support both editor format (specializationId) and serialized format (id).
  const profSkills = catalog?.skills || [];
  const selectedSpecIds = new Set(
    (editor.specializations || []).map((s) => Number(s?.specializationId || s?.id) || 0).filter(Boolean)
  );
  for (const s of profSkills) {
    if ((s.type || "").toLowerCase() !== "profession") continue;
    const reqSpec = Number(s.specialization) || 0;
    if (reqSpec && !selectedSpecIds.has(reqSpec)) continue;
    if (/^Profession_[1-5]$/.test(s.slot || "")) ids.add(s.id);
  }
  // Revenant legend skills (heal, utilities, elite) — fixed per legend stance
  for (const legendId of editor.selectedLegends || []) {
    if (!legendId) continue;
    const legend = catalog?.legendById?.get(legendId);
    if (!legend) continue;
    if (legend.heal) ids.add(Number(legend.heal));
    if (legend.elite) ids.add(Number(legend.elite));
    for (const uid of legend.utilities || []) {
      if (uid) ids.add(Number(uid));
    }
  }
  return ids;
}

function collectTraitIds(editor, catalog) {
  const ids = new Set();
  for (const spec of editor.specializations || []) {
    // Selected major traits
    const choices = spec?.majorChoices || {};
    for (const tier of [1, 2, 3]) {
      const traitId = Number(choices[tier]) || 0;
      if (traitId) ids.add(traitId);
    }
    // Minor traits (always active when spec line is equipped)
    // Support both editor format (specializationId) and serialized format (id).
    const specId = Number(spec?.specializationId || spec?.id) || 0;
    const specData = specId ? catalog?.specializationById?.get(specId) : null;
    for (const minorId of specData?.minorTraits || []) {
      if (minorId) ids.add(Number(minorId));
    }
  }
  return ids;
}

export function computeBoonCoverage(catalog, editor, weaponSkills = []) {
  if (!catalog) return { boons: [], conditions: [] };

  const allFacts = [];

  // Collect from weapon skills (passed in by caller, already resolved)
  for (const ws of weaponSkills) {
    if (!ws) continue;
    allFacts.push(...extractBuffFacts(ws, "skill"));
    if (ws.flipSkill) {
      const flip = catalog.skillById?.get(ws.flipSkill) || catalog.weaponSkillById?.get(ws.flipSkill);
      if (flip) allFacts.push(...extractBuffFacts(flip, "skill"));
    }
  }

  // Collect from skills (heal, utility, elite, profession mechanics)
  const skillIds = collectSkillIds(editor, catalog);
  const traitIds = collectTraitIds(editor, catalog);
  const hasTwistedMedicine = traitIds.has(TWISTED_MEDICINE_TRAIT_ID);
  for (const id of skillIds) {
    const skill = catalog.skillById?.get(id);
    if (!skill) continue;
    const isElixir = hasTwistedMedicine && (skill.categories || []).includes("Elixir");
    const facts = extractBuffFacts(skill, "skill");
    if (isElixir) {
      for (const f of facts) {
        if (BOON_NAMES.has(f.name)) f.isAlly = true;
      }
    }
    allFacts.push(...facts);
    if (skill.flipSkill) {
      const flip = catalog.skillById?.get(skill.flipSkill);
      if (flip) allFacts.push(...extractBuffFacts(flip, "skill"));
    }
    for (const bundleId of skill.bundleSkills || []) {
      const bundleSkill = catalog.skillById?.get(bundleId);
      if (bundleSkill) allFacts.push(...extractBuffFacts(bundleSkill, "skill"));
    }
    // Toolbelt skill (Engineer)
    if (skill.toolbeltSkill) {
      const tbSkill = catalog.skillById?.get(skill.toolbeltSkill);
      if (tbSkill) allFacts.push(...extractBuffFacts(tbSkill, "skill"));
    }
  }

  // Collect from traits
  for (const id of traitIds) {
    const trait = catalog.traitById?.get(id);
    if (!trait) continue;
    allFacts.push(...extractBuffFacts(trait, "trait"));
  }

  // Group by name (already normalized in extractBuffFacts)
  const grouped = new Map();
  for (const f of allFacts) {
    if (!grouped.has(f.name)) {
      grouped.set(f.name, { sources: [], hasAnyAlly: false });
    }
    const entry = grouped.get(f.name);
    const dupeKey = `${f.sourceType}|${f.sourceName}|${f.stacks}|${f.duration}|${f.context}`;
    if (!entry._seen) entry._seen = new Set();
    if (!entry._seen.has(dupeKey)) {
      entry._seen.add(dupeKey);
      entry.sources.push({
        type: f.sourceType,
        name: f.sourceName,
        stacks: f.stacks,
        duration: f.duration,
        context: f.context,
        isAlly: f.isAlly,
      });
    }
    if (f.isAlly) entry.hasAnyAlly = true;
  }

  // Build output arrays
  const boons = [];
  const conditions = [];
  for (const [name, data] of grouped) {
    if (BOON_NAMES.has(name)) {
      boons.push({
        name,
        icon: BOON_CONDITION_ICONS[name] || "",
        hasAllySource: data.hasAnyAlly,
        sources: data.sources,
      });
    } else {
      conditions.push({
        name,
        icon: BOON_CONDITION_ICONS[name] || "",
        sources: data.sources,
      });
    }
  }

  // Sort boons by GW2 display order, conditions alphabetically
  const boonOrder = new Map(BOON_DISPLAY_ORDER.map((b, i) => [b, i]));
  boons.sort((a, b) => (boonOrder.get(a.name) ?? 99) - (boonOrder.get(b.name) ?? 99));
  conditions.sort((a, b) => a.name.localeCompare(b.name));

  return { boons, conditions };
}

/**
 * Compute full party coverage for a single build: boons, combo fields, blast finishers.
 * Scans weapon skills, heal/utility/elite, profession mechanics, traits,
 * and kit/bundle sub-skills.
 */
export function computePartyCoverage(catalog, editor, weaponSkills = []) {
  // Boons — delegate to existing function
  const { boons, conditions } = computeBoonCoverage(catalog, editor, weaponSkills);

  const allFields = [];
  const allFinishers = [];

  // Helper: scan an entity for fields and finishers
  function scanEntity(entity, sourceType, kitName = "") {
    if (!entity) return;
    allFields.push(...extractComboFields(entity, sourceType, kitName));
    allFinishers.push(...extractComboFinishers(entity, sourceType, kitName));
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
    // Toolbelt skill (Engineer)
    if (skill.toolbeltSkill) {
      const tbSkill = catalog.skillById?.get(skill.toolbeltSkill);
      scanEntity(tbSkill, "skill", skill.name || "");
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

  // Deduplicate finishers by (finisherType, sourceName)
  const finisherMap = new Map();
  for (const f of allFinishers) {
    const key = `${f.finisherType}|${f.sourceName}`;
    if (!finisherMap.has(key)) finisherMap.set(key, f);
  }
  const comboFinishers = [...finisherMap.values()];

  return { boons, conditions, comboFields, comboFinishers };
}
