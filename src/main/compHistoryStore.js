"use strict";

const { HistoryStore } = require("./historyStore");
const diffComp = require("./history/diffComp");

/**
 * Version history for comps.
 *
 * `summarizeCompChange` used to live here — a chain of `JSON.stringify`
 * comparisons that reported "party layout changed" whenever any nested value
 * moved, including embedded build data a game patch had rewritten.
 * `history/diffComp.js` replaces it with a positional slot diff, so a slot swap
 * is one small op naming the party, the slot, and the build on each side.
 *
 * @see historyStore.js for the storage half, shared with builds.
 *
 * @param {string} baseDir
 * @param {{folderNameOf?: Function, buildNameOf?: Function, categoryNameOf?: Function}} [summaryOpts]
 *   optional resolvers used to phrase summaries ("party 2 slot 3: Heal Druid →
 *   Alacrity Mechanist"). Without them the summary falls back to raw ids, which
 *   is still truthful.
 */
class CompHistoryStore extends HistoryStore {
  constructor(baseDir, summaryOpts = {}) {
    super(baseDir, { subdir: "comps", idField: "compId", differ: diffComp, summaryOpts });
  }
}

/** Every build id a comp references, from membership AND from its party slots. */
function _memberIds(comp) {
  const fromList = (comp?.buildIds || []).filter(Boolean);
  const fromSlots = (comp?.partyLines || [])
    .flatMap((line) => line?.slots || [])
    // "tag:<categoryId>" slots name a category, not a build.
    .filter((slot) => typeof slot === "string" && slot && !slot.startsWith("tag:"));
  return new Set([...fromList, ...fromSlots]);
}

module.exports = { CompHistoryStore, _memberIds };
