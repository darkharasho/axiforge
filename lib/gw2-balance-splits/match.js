/**
 * Shared fact-matching functions for GW2 balance splits.
 *
 * These were originally private helpers in catalog.js. They are extracted here
 * so that both the catalog builder and the wiki audit tool can share the same
 * matching logic.
 */

// ── Balance split helpers ─────────────────────────────────────────────────────

// The GW2 API uses type "Distance" for radius/range facts, but the wiki scraper
// produces type "Radius". Normalize both to the same token for group matching.
function splitNormalizeType(type) {
  if (type === "Distance") return "Radius";
  // The wiki scraper always emits "Buff" for {{skill fact|effect|...}}, but the GW2 API
  // may use "PrefixedBuff" or "ApplyBuffCondition" for the same fact. Normalize all three
  // to "Buff" so Pass 2 group-key matching can pair them by status name.
  if (type === "PrefixedBuff" || type === "ApplyBuffCondition") return "Buff";
  return type || "";
}

// Grouping key: normalizedType + target (for AttributeAdjust) or + status (for Buff).
// Distance/Radius facts share a group; AttributeAdjust[Healing] and [Power] are distinct.
function splitGroupKey(f) {
  return `${splitNormalizeType(f.type)}:${f.target || f.status || ""}`;
}

const SPLIT_VALUE_KEYS = ["value", "distance", "duration", "apply_count", "dmg_multiplier", "hit_count", "percent", "coefficient"];

// hit_count is metadata — skip it when the base didn't carry it (avoids false positives
// from the wiki scraper always emitting hit_count:1). For all other keys (including
// coefficient) flag as changed whenever the split adds or changes the value.
function splitValueChanged(before, after) {
  return SPLIT_VALUE_KEYS.some((k) => {
    if (after[k] === undefined) return false;
    if (k === "hit_count" && before[k] === undefined) return false;
    return before[k] !== after[k];
  });
}

/**
 * Build bidirectional index: baseToSplit[bi] = si and splitToBase[si] = bi.
 *
 * Two-pass matching:
 *   Pass 1 — exact text + normalized-type match (e.g. "Conditions Removed" → same)
 *   Pass 2 — type-group positional match (e.g. 1st AttributeAdjust:Healing split →
 *             1st AttributeAdjust:Healing base), enabling generic wiki labels like
 *             "Healing" to resolve to labelled base facts like "First Heal".
 */
function buildSplitMatchTables(baseFacts, splitFacts) {
  const baseToSplit = new Map();
  const splitToBase = new Map();

  // Pass 1: text + normalized-type
  for (let si = 0; si < splitFacts.length; si++) {
    const sf = splitFacts[si];
    const sfText = (sf.text || "").toLowerCase().trim();
    if (!sfText) continue;
    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseToSplit.has(bi)) continue;
      const bf = baseFacts[bi];
      if (
        splitNormalizeType(bf.type) === splitNormalizeType(sf.type) &&
        (bf.text || "").toLowerCase().trim() === sfText
      ) {
        baseToSplit.set(bi, si);
        splitToBase.set(si, bi);
        break;
      }
    }
  }

  // Pass 1.5: cross-type exact text match — the wiki scraper often assigns
  // type "Buff" to facts that the API types as Number, Percent, Time, etc.
  // Match by exact text equality regardless of type mismatch.
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitToBase.has(si)) continue;
    const sfText = (splitFacts[si].text || "").toLowerCase().trim();
    if (!sfText) continue;
    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseToSplit.has(bi)) continue;
      if ((baseFacts[bi].text || "").toLowerCase().trim() === sfText) {
        baseToSplit.set(bi, si);
        splitToBase.set(si, bi);
        break;
      }
    }
  }

  // Pass 2: type-group positional for remaining unmatched facts
  const unmatchedByGroup = {};
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitToBase.has(si)) continue;
    const key = splitGroupKey(splitFacts[si]);
    (unmatchedByGroup[key] = unmatchedByGroup[key] || []).push(si);
  }
  const groupCounters = {};
  for (let bi = 0; bi < baseFacts.length; bi++) {
    if (baseToSplit.has(bi)) continue;
    const key = splitGroupKey(baseFacts[bi]);
    const pool = unmatchedByGroup[key];
    if (!pool) continue;
    const idx = groupCounters[key] || 0;
    if (idx < pool.length) {
      baseToSplit.set(bi, pool[idx]);
      splitToBase.set(pool[idx], bi);
      groupCounters[key] = idx + 1;
    }
  }

  // Pass 3: keyword overlap — the wiki scraper rewrites fact text (e.g.
  // "Maximum Stacks" → "Maximum count", "Number of Allied Targets" → "Allied targets").
  // Match remaining unmatched facts if they share at least one significant word (>3 chars).
  // Score by number of shared words and pick the best match to avoid false positives.
  const _stopWords = new Set(["the", "and", "per", "for", "with", "from", "based", "gain"]);
  function _keywords(text) {
    return (text || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !_stopWords.has(w));
  }
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitToBase.has(si)) continue;
    const sfKw = _keywords(splitFacts[si].text);
    if (!sfKw.length) continue;
    let bestBi = -1, bestScore = 0;
    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseToSplit.has(bi)) continue;
      const bfKw = _keywords(baseFacts[bi].text);
      const shared = sfKw.filter((w) => bfKw.includes(w)).length;
      if (shared > bestScore) { bestScore = shared; bestBi = bi; }
    }
    if (bestScore > 0) {
      baseToSplit.set(bestBi, si);
      splitToBase.set(si, bestBi);
    }
  }

  return { baseToSplit, splitToBase };
}

module.exports = {
  splitNormalizeType,
  splitGroupKey,
  SPLIT_VALUE_KEYS,
  splitValueChanged,
  buildSplitMatchTables,
};
