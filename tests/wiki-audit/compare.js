/**
 * compare.js — Diff wiki-scraped facts against the committed data snapshots.
 *
 * Restored after the Phase 4 refactor (commit b56664d) removed
 * lib/gw2-balance-splits along with this file, which left `npm run audit:wiki`
 * crashing on a missing require. The fact-matching helpers it depended on
 * (buildSplitMatchTables / SPLIT_VALUE_KEYS) survive — with identical return
 * shapes — as buildMatchTables / VALUE_KEYS in the gw2-data package, so we
 * import them from there instead.
 *
 * Note on scope: balance-splits data was removed in Phase 4, so `splitEntry`
 * passed to compareEntity() is now always null (see run-audit.js:334). The
 * skill/trait path therefore reports "no_split" for everything — the live,
 * meaningful drift checks are compareRelicFacts() against relicFacts.json and
 * signetPassives.json.
 */

const {
  buildMatchTables: buildSplitMatchTables,
  VALUE_KEYS: SPLIT_VALUE_KEYS,
} = require("../../packages/gw2-data/src/facts/match");

/**
 * Compare wiki-extracted facts against a stored split entry.
 *
 * @param {object[]} wikiFacts — structured facts from the wiki
 * @param {object|null} splitEntry — stored entry ({ facts, complete }) or null
 * @param {object} opts — { hasToggle: boolean }
 * @returns {object} { category, fact_diffs, wiki_only_facts, splits_only_facts }
 */
function compareEntity(wikiFacts, splitEntry, opts = {}) {
  const result = {
    category: "match",
    fact_diffs: [],
    wiki_only_facts: [],
    splits_only_facts: [],
  };

  // Case: stored entry exists but wiki has no toggle (stale split)
  if (splitEntry && opts.hasToggle === false) {
    result.category = "missing_from_wiki";
    result.splits_only_facts = splitEntry.facts || [];
    return result;
  }

  // Case: wiki has toggle but no stored entry
  if (!splitEntry && opts.hasToggle && wikiFacts.length > 0) {
    result.category = "missing_from_splits";
    result.wiki_only_facts = wikiFacts;
    return result;
  }

  // Case: no stored data on either side
  if (!splitEntry) {
    result.category = "no_split";
    return result;
  }

  const splitFacts = splitEntry.facts || [];
  const isComplete = splitEntry.complete === true;

  if (splitFacts.length === 0 && wikiFacts.length === 0) {
    return result; // both empty = match
  }

  // Build match tables: wiki facts as "base", stored facts as "split"
  const { baseToSplit, splitToBase } = buildSplitMatchTables(wikiFacts, splitFacts);

  // Compare matched pairs
  for (let wi = 0; wi < wikiFacts.length; wi++) {
    const si = baseToSplit.get(wi);
    if (si === undefined) continue;
    const wf = wikiFacts[wi];
    const sf = splitFacts[si];
    const fields = {};

    for (const key of SPLIT_VALUE_KEYS) {
      const wVal = wf[key];
      const sVal = sf[key];
      if (wVal === undefined && sVal === undefined) continue;
      if (wVal === sVal) continue;
      if (key === "hit_count" && wVal === undefined) continue;
      fields[key] = { wiki: wVal, splits: sVal };
    }

    if (Object.keys(fields).length > 0) {
      result.fact_diffs.push({ text: wf.text || sf.text, type: wf.type || sf.type, fields });
    }
  }

  // Unmatched wiki facts (wiki has, stored doesn't) — only flag for complete entries
  if (isComplete) {
    for (let wi = 0; wi < wikiFacts.length; wi++) {
      if (!baseToSplit.has(wi)) {
        result.wiki_only_facts.push(wikiFacts[wi]);
      }
    }
  }

  // Unmatched stored facts (stored has, wiki doesn't)
  for (let si = 0; si < splitFacts.length; si++) {
    if (!splitToBase.has(si)) {
      result.splits_only_facts.push(splitFacts[si]);
    }
  }

  // Determine category
  if (result.fact_diffs.length > 0 || result.wiki_only_facts.length > 0 || result.splits_only_facts.length > 0) {
    result.category = "mismatch";
  }

  return result;
}

/**
 * Compare wiki-scraped relic/signet facts against stored snapshot data
 * (relicFacts.json / signetPassives.json).
 * Simpler than compareEntity — no WvW toggle semantics, just direct fact comparison.
 *
 * @param {object[]} wikiFacts
 * @param {object[]|null} storedFacts
 * @param {object} [opts]
 * @param {boolean} [opts.lenient=false] — high-signal mode for signets. Signet
 *   passives come in shapes the generic parser can't reproduce from the wiki
 *   (percent-vs-number, prose-only, non-self-named rows), while
 *   signetPassives.json is hand-curated. In lenient mode we only flag a genuine
 *   value change on a *matched* fact — an extraction gap (wiki produced nothing,
 *   or facts the parser couldn't pair) is reported as a skip, not drift, so the
 *   audit stays high-signal. Relics leave this off and stay strict.
 */
function compareRelicFacts(wikiFacts, storedFacts, opts = {}) {
  const lenient = opts.lenient === true;
  const result = {
    category: "match",
    fact_diffs: [],
    wiki_only_facts: [],
    splits_only_facts: [],
  };

  const wFacts = Array.isArray(wikiFacts) ? wikiFacts : [];
  const sFacts = Array.isArray(storedFacts) ? storedFacts : [];

  // Both empty — nothing to compare
  if (wFacts.length === 0 && sFacts.length === 0) {
    result.category = "no_split";
    return result;
  }

  // Wiki extraction produced nothing but we have stored facts. In lenient mode
  // this is a crawler/parser gap, not drift — skip rather than false-flag.
  if (lenient && wFacts.length === 0 && sFacts.length > 0) {
    result.category = "no_split";
    result.splits_only_facts = sFacts;
    return result;
  }

  // Wiki has facts but stored is empty/null — new data available
  if (wFacts.length > 0 && sFacts.length === 0) {
    result.category = "missing_from_splits";
    result.wiki_only_facts = wFacts;
    return result;
  }

  // Use existing match infrastructure (baseToSplit/splitToBase are Map<index, index>)
  const { baseToSplit, splitToBase } = buildSplitMatchTables(wFacts, sFacts);

  // Compare matched pairs
  for (let wi = 0; wi < wFacts.length; wi++) {
    const si = baseToSplit.get(wi);
    if (si === undefined) continue;
    const wf = wFacts[wi];
    const sf = sFacts[si];

    // Lenient (signets): a matched pair of different types (e.g. wiki Percent
    // vs curated Number) is a representation mismatch, not value drift — the
    // matcher paired them by text. Skip it rather than report a false diff.
    if (lenient && wf.type !== sf.type) continue;

    const fields = {};
    for (const key of SPLIT_VALUE_KEYS) {
      const wVal = wf[key];
      const sVal = sf[key];
      if (wVal === undefined && sVal === undefined) continue;
      if (wVal === sVal) continue;
      fields[key] = { wiki: wVal, splits: sVal };
    }

    if (Object.keys(fields).length > 0) {
      result.fact_diffs.push({ text: wf.text || sf.text, type: wf.type || sf.type, fields });
    }
  }

  // Unmatched wiki facts (always flag for relics — we have complete data)
  for (let wi = 0; wi < wFacts.length; wi++) {
    if (!baseToSplit.has(wi)) {
      result.wiki_only_facts.push(wFacts[wi]);
    }
  }

  // Unmatched stored facts
  for (let si = 0; si < sFacts.length; si++) {
    if (!splitToBase.has(si)) {
      result.splits_only_facts.push(sFacts[si]);
    }
  }

  // Strict (relics): any diff or unmatched fact on either side is drift.
  // Lenient (signets): only a value change on a *matched* fact is drift;
  // unmatched facts are extraction/shape gaps and are recorded for visibility
  // but don't raise the category.
  const isMismatch = lenient
    ? result.fact_diffs.length > 0
    : result.fact_diffs.length > 0 ||
      result.wiki_only_facts.length > 0 ||
      result.splits_only_facts.length > 0;
  if (isMismatch) {
    result.category = "mismatch";
  }

  return result;
}

module.exports = { compareEntity, compareRelicFacts };
