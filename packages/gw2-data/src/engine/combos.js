"use strict";

const { factsForMode } = require("./facts");

/**
 * Extract combo field facts from an entity.
 * Pulls Duration and Radius from adjacent facts for metadata.
 */
function extractComboFields(entity, sourceType, gameMode) {
  const results = [];
  const facts = factsForMode(entity, gameMode);
  let duration = 0;
  let radius = 0;

  for (const fact of facts) {
    if ((fact.type === "Duration" || fact.type === "Time") && fact.duration) {
      duration = fact.duration;
    }
    if (fact.type === "Radius" && fact.distance) {
      radius = fact.distance;
    }
  }

  for (const fact of facts) {
    if (fact.type !== "ComboField" || !fact.field_type) continue;
    results.push({
      fieldType: fact.field_type,
      sourceType,
      sourceName: entity.name || "",
      duration,
      radius,
    });
  }
  return results;
}

/**
 * Extract combo finisher facts from an entity.
 * Groups by finisher type, counts hits.
 */
function extractComboFinishers(entity, sourceType, gameMode) {
  const results = [];
  const facts = factsForMode(entity, gameMode);

  const byType = new Map();
  for (const fact of facts) {
    if (fact.type !== "ComboFinisher" || !fact.finisher_type) continue;
    const ft = fact.finisher_type;
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
      hitCount: data.count,
      percent: data.percent,
    });
  }
  return results;
}

/**
 * Analyze combo fields and finishers from resolved skills and traits.
 *
 * @param {Object[]} skills - Resolved skill objects with facts
 * @param {Object[]} traits - Resolved trait objects with facts
 * @param {string} [gameMode] - "pve" | "wvw" | "pvp"; selects mode-split facts
 * @returns {{ fields: Object[], finishers: Object[] }}
 */
function analyzeCombos(skills, traits, gameMode) {
  const allFields = [];
  const allFinishers = [];

  for (const skill of skills) {
    if (!skill) continue;
    allFields.push(...extractComboFields(skill, "skill", gameMode));
    allFinishers.push(...extractComboFinishers(skill, "skill", gameMode));
  }

  for (const trait of traits) {
    if (!trait) continue;
    allFields.push(...extractComboFields(trait, "trait", gameMode));
    allFinishers.push(...extractComboFinishers(trait, "trait", gameMode));
  }

  // Deduplicate fields by (fieldType, sourceName)
  const seen = new Set();
  const fields = [];
  for (const field of allFields) {
    const key = `${field.fieldType}::${field.sourceName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push(field);
  }

  return { fields, finishers: allFinishers };
}

module.exports = { analyzeCombos };
