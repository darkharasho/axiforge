"use strict";

const {
  BOON_NAMES, CONDITION_NAMES, CONDITION_NAME_NORMALIZE,
  BOON_DISPLAY_ORDER, BUFF_FACT_TYPES,
} = require("./constants");

function normalizeName(status) {
  return CONDITION_NAME_NORMALIZE[status] || status;
}

function isAllyTargeted(description, statusName, allBoonNames) {
  if (!description) return false;
  const desc = description.toLowerCase();
  const statusLower = statusName.toLowerCase();
  const sentences = desc.split(".");

  // Check if boon name in ally sentence
  let foundInAllySentence = false;
  let foundInDescription = false;
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const hasAlly = /\balli(?:es|ed)?\b/.test(trimmed) || /\bally\b/.test(trimmed);
    const hasBoon = trimmed.includes(statusLower);
    if (hasBoon) foundInDescription = true;
    if (hasBoon && hasAlly) foundInAllySentence = true;
  }

  if (foundInAllySentence) return true;
  if (foundInDescription) return false;

  // Boon not named in description — check for generic ally mention
  const hasGenericAlly = /\balli(?:es|ed)?\b/.test(desc) || /\bally\b/.test(desc);
  if (!hasGenericAlly) return false;

  // But if specific boons ARE named with allies, this unnamed one is probably self
  if (allBoonNames && allBoonNames.length > 0) {
    for (const otherBoon of allBoonNames) {
      const otherLower = otherBoon.toLowerCase();
      if (otherLower === statusLower) continue;
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        const hasAlly = /\balli(?:es|ed)?\b/.test(trimmed) || /\bally\b/.test(trimmed);
        if (trimmed.includes(otherLower) && hasAlly) return false;
      }
    }
  }

  return true;
}

function analyzeBoons(skills, traits, overrides, activeTraitIds) {
  const boonMap = new Map(); // name → { name, sources: [] }
  const condMap = new Map();

  // Check for Twisted Medicine override
  const twistedMedicineOverride = overrides.get("trait:2220");
  const hasTwistedMedicine = activeTraitIds && twistedMedicineOverride &&
    activeTraitIds.has(2220);

  function processEntity(entity, type) {
    const facts = entity.facts || [];
    const description = entity.description || "";

    // Collect all boon names from this entity for ally classification
    const entityBoonNames = [];
    for (const fact of facts) {
      if (!BUFF_FACT_TYPES.has(fact.type)) continue;
      const name = normalizeName(fact.status);
      if (BOON_NAMES.has(name)) entityBoonNames.push(name);
    }

    // Track section context from NoData facts
    let currentContext = null;

    for (const fact of facts) {
      if (fact.type === "NoData" && fact.text) {
        currentContext = fact.text;
        continue;
      }

      if (!BUFF_FACT_TYPES.has(fact.type)) continue;
      if (!fact.status) continue;

      const name = normalizeName(fact.status);
      const stacks = fact.apply_count || 1;
      const duration = fact.duration || 0;

      const isBoon = BOON_NAMES.has(name);
      const isCondition = CONDITION_NAMES.has(name);
      if (!isBoon && !isCondition) continue;

      // Determine ally targeting
      let isAlly = isAllyTargeted(description, name, entityBoonNames);

      // Twisted Medicine override
      if (hasTwistedMedicine && entity.categories) {
        const cats = entity.categories.map((c) => c.toLowerCase());
        const allyTargetedCats = twistedMedicineOverride.allyTargeted || [];
        if (allyTargetedCats.some((c) => cats.includes(c.toLowerCase()))) {
          isAlly = true;
        }
      }

      const source = {
        type,
        name: entity.name || "",
        sourceName: entity.name || "",
        stacks,
        duration,
        isAlly,
        context: currentContext,
      };

      const map = isBoon ? boonMap : condMap;
      if (!map.has(name)) {
        map.set(name, { name, sources: [] });
      }

      // Deduplicate by (sourceName, stacks, duration, context)
      const entry = map.get(name);
      const isDuplicate = entry.sources.some(
        (s) => s.sourceName === source.sourceName &&
               s.stacks === source.stacks &&
               s.duration === source.duration &&
               s.context === source.context
      );
      if (!isDuplicate) {
        entry.sources.push(source);
      }
    }
  }

  for (const skill of skills || []) {
    if (skill) processEntity(skill, "skill");
  }
  for (const trait of traits || []) {
    if (trait) processEntity(trait, "trait");
  }

  // Sort boons by display order
  const boonOrder = new Map(BOON_DISPLAY_ORDER.map((name, i) => [name, i]));
  const boons = [...boonMap.values()].sort((a, b) => {
    const ai = boonOrder.has(a.name) ? boonOrder.get(a.name) : 999;
    const bi = boonOrder.has(b.name) ? boonOrder.get(b.name) : 999;
    return ai - bi;
  });

  // Sort conditions alphabetically
  const conditions = [...condMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return { boons, conditions };
}

module.exports = { analyzeBoons, isAllyTargeted, normalizeName };
