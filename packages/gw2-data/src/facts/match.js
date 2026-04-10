"use strict";

const { normalizeFactType } = require("./normalize");

const VALUE_KEYS = [
  "value", "distance", "duration", "apply_count", "dmg_multiplier",
  "hit_count", "percent", "coefficient", "finisher_type", "field_type",
];

const STOP_WORDS = new Set([
  "the", "and", "per", "for", "with", "from", "based", "gain",
]);

function splitGroupKey(fact) {
  const normType = normalizeFactType(fact.type);
  const qualifier = fact.target || fact.status || "";
  return `${normType}:${qualifier}`;
}

function valueChanged(before, after) {
  for (const key of VALUE_KEYS) {
    if (key === "hit_count" && before[key] === undefined) continue;
    if (before[key] !== after[key]) return true;
  }
  return false;
}

function extractKeywords(text) {
  if (!text) return new Set();
  const words = text.toLowerCase().split(/\s+/);
  return new Set(words.filter((w) => w.length >= 3 && !STOP_WORDS.has(w)));
}

function buildMatchTables(baseFacts, splitFacts) {
  const baseToSplit = new Map();
  const splitToBase = new Map();
  const baseMatched = new Set();
  const splitMatched = new Set();

  // Pass 1: Exact text + normalized type
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitMatched.has(si)) continue;
    const sf = splitFacts[si];
    const normSplitType = normalizeFactType(sf.type);
    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseMatched.has(bi)) continue;
      const bf = baseFacts[bi];
      if (normalizeFactType(bf.type) === normSplitType && bf.text === sf.text) {
        baseToSplit.set(bi, si);
        splitToBase.set(si, bi);
        baseMatched.add(bi);
        splitMatched.add(si);
        break;
      }
    }
  }

  // Pass 1.5: Cross-type exact text match
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitMatched.has(si)) continue;
    const sf = splitFacts[si];
    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseMatched.has(bi)) continue;
      const bf = baseFacts[bi];
      if (bf.text === sf.text) {
        baseToSplit.set(bi, si);
        splitToBase.set(si, bi);
        baseMatched.add(bi);
        splitMatched.add(si);
        break;
      }
    }
  }

  // Pass 2: Type-group positional match
  const baseGroups = new Map();
  const splitGroups = new Map();
  for (let bi = 0; bi < baseFacts.length; bi++) {
    if (baseMatched.has(bi)) continue;
    const key = splitGroupKey(baseFacts[bi]);
    if (!baseGroups.has(key)) baseGroups.set(key, []);
    baseGroups.get(key).push(bi);
  }
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitMatched.has(si)) continue;
    const key = splitGroupKey(splitFacts[si]);
    if (!splitGroups.has(key)) splitGroups.set(key, []);
    splitGroups.get(key).push(si);
  }
  for (const [key, splitIndices] of splitGroups) {
    const baseIndices = baseGroups.get(key);
    if (!baseIndices) continue;
    const pairs = Math.min(baseIndices.length, splitIndices.length);
    for (let i = 0; i < pairs; i++) {
      const bi = baseIndices[i];
      const si = splitIndices[i];
      baseToSplit.set(bi, si);
      splitToBase.set(si, bi);
      baseMatched.add(bi);
      splitMatched.add(si);
    }
  }

  // Pass 3: Keyword overlap
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitMatched.has(si)) continue;
    const splitWords = extractKeywords(splitFacts[si].text);
    if (splitWords.size === 0) continue;
    let bestBi = -1;
    let bestScore = 0;
    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseMatched.has(bi)) continue;
      const baseWords = extractKeywords(baseFacts[bi].text);
      let shared = 0;
      for (const w of splitWords) {
        if (baseWords.has(w)) shared++;
      }
      if (shared > bestScore) {
        bestScore = shared;
        bestBi = bi;
      }
    }
    if (bestBi >= 0 && bestScore >= 1) {
      baseToSplit.set(bestBi, si);
      splitToBase.set(si, bestBi);
      baseMatched.add(bestBi);
      splitMatched.add(si);
    }
  }

  return { baseToSplit, splitToBase };
}

module.exports = { buildMatchTables, splitGroupKey, valueChanged, VALUE_KEYS };
