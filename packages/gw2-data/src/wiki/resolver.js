"use strict";

const { parseAllTaggedFacts, parseSplitGrouping, parseInfoboxParams } = require("./parser");

/**
 * Group tagged facts (with `_modes` arrays) into per-mode arrays.
 * Strips `_modes` from output facts.
 *
 * @param {Object[]} taggedFacts - Facts with `_modes: string[]`
 * @returns {{ pve: Object[], wvw: Object[], pvp: Object[] }}
 */
function groupFactsByMode(taggedFacts) {
  const pve = [];
  const wvw = [];
  const pvp = [];

  for (const fact of taggedFacts) {
    const modes = fact._modes || [];
    // Clone fact without _modes
    const { _modes, ...clean } = fact;

    if (modes.includes("pve")) pve.push({ ...clean });
    if (modes.includes("wvw")) wvw.push({ ...clean });
    if (modes.includes("pvp")) pvp.push({ ...clean });
  }

  return { pve, wvw, pvp };
}

/**
 * Parse wikitext and return facts separated by game mode.
 *
 * @param {string} wikitext
 * @returns {{ pve: Object[], wvw: Object[], pvp: Object[], hasSplit: boolean }}
 */
function parseFactsByMode(wikitext) {
  const { facts: taggedFacts, hasPveOnly } = parseAllTaggedFacts(wikitext);
  const grouped = groupFactsByMode(taggedFacts);

  // Check for split field
  const splitMatch = wikitext.match(/\|\s*split\s*=\s*(.+)/i);
  let splitGrouping = null;
  let wvwGroupedWithPvp = false;

  if (splitMatch) {
    splitGrouping = parseSplitGrouping(splitMatch[1].trim());
    wvwGroupedWithPvp = splitGrouping.wvwGroupedWithPvp;
  }

  // If no template-based WvW facts but a split exists, try infobox fallback
  if (grouped.wvw.length === 0 && splitGrouping?.wvwHasSplit) {
    const infoboxFacts = parseInfoboxParams(wikitext, wvwGroupedWithPvp);
    grouped.wvw = infoboxFacts;
  }

  const hasSplit = hasPveOnly || (splitGrouping?.wvwHasSplit ?? false);

  return {
    pve: grouped.pve,
    wvw: grouped.wvw,
    pvp: grouped.pvp,
    hasSplit,
  };
}

/**
 * Batch-resolve wiki facts for multiple entities.
 *
 * @param {import("./client").WikiClient} client
 * @param {Map<string, number>} titleToId - Map of wiki title to entity ID
 * @returns {Promise<Map<number, { pve: Object[], wvw: Object[]|null, pvp: Object[]|null, hasSplit: boolean }>>}
 */
async function resolveEntityFacts(client, titleToId) {
  const result = new Map();

  if (titleToId.size === 0) return result;

  const titles = [...titleToId.keys()];
  const wikitextMap = await client.getWikitextBatch(titles);

  for (const [title, id] of titleToId) {
    const wikitext = wikitextMap.get(title);
    if (!wikitext) continue; // skip missing pages

    const parsed = parseFactsByMode(wikitext);

    // Skip pages that exist but have no fact templates — keep API facts instead
    // of replacing them with empty arrays.
    if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0) continue;

    result.set(id, {
      pve: parsed.pve,
      wvw: parsed.hasSplit ? parsed.wvw : null,
      pvp: parsed.hasSplit ? parsed.pvp : null,
      hasSplit: parsed.hasSplit,
    });
  }

  return result;
}

module.exports = { groupFactsByMode, parseFactsByMode, resolveEntityFacts };
