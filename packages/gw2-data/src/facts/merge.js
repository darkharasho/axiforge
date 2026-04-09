"use strict";

const { buildMatchTables, valueChanged, VALUE_KEYS } = require("./match");

function mergeFacts(baseFacts, splitFacts, { complete = false } = {}) {
  if (!splitFacts || splitFacts.length === 0) {
    return baseFacts;
  }

  const { baseToSplit, splitToBase } = buildMatchTables(baseFacts, splitFacts);
  const result = [];

  for (let bi = 0; bi < baseFacts.length; bi++) {
    const si = baseToSplit.get(bi);
    if (si !== undefined) {
      const merged = { ...baseFacts[bi] };
      const splitFact = splitFacts[si];
      let changed = false;
      for (const key of VALUE_KEYS) {
        if (splitFact[key] !== undefined) {
          if (merged[key] !== splitFact[key]) {
            changed = true;
          }
          merged[key] = splitFact[key];
        }
      }
      if (changed) {
        merged._splitFact = true;
      }
      result.push(merged);
    } else if (!complete) {
      result.push({ ...baseFacts[bi] });
    }
  }

  for (let si = 0; si < splitFacts.length; si++) {
    if (!splitToBase.has(si)) {
      result.push({ ...splitFacts[si], _newFact: true });
    }
  }

  return result;
}

module.exports = { mergeFacts };
