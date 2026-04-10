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
 * Parse infobox-level timing parameters (recharge, activation) by game mode.
 * These live outside the facts templates: `| recharge = 25`, `| activation = 0.5`
 *
 * @param {string} wikitext
 * @returns {{ recharge: {pve:number|null, wvw:number|null, pvp:number|null}, activation: {pve:number|null, wvw:number|null, pvp:number|null} }}
 */
function parseInfoboxTimings(wikitext) {
  const result = {
    recharge:   { pve: null, wvw: null, pvp: null },
    activation: { pve: null, wvw: null, pvp: null },
  };
  for (const param of ["recharge", "activation"]) {
    // Base value: `| recharge = 25` (applies to all modes as default)
    const baseRe = new RegExp(`\\|\\s*${param}\\s*=\\s*([\\d.]+)`, "i");
    const baseMatch = wikitext.match(baseRe);
    const baseVal = baseMatch ? parseFloat(baseMatch[1]) : null;
    if (baseVal != null && !isNaN(baseVal)) {
      result[param].pve = baseVal;
      result[param].wvw = baseVal;
      result[param].pvp = baseVal;
    }
    // Mode-specific overrides: `| recharge wvw = 40`, `| recharge pvp = 40`
    const modeRe = new RegExp(`\\|\\s*${param}\\s+(pve|wvw|pvp)\\s*=\\s*([\\d.]+)`, "gi");
    let m;
    while ((m = modeRe.exec(wikitext)) !== null) {
      const mode = m[1].toLowerCase();
      const val = parseFloat(m[2]);
      if (!isNaN(val)) result[param][mode] = val;
    }
  }
  return result;
}

/**
 * Parse wikitext and return facts separated by game mode.
 *
 * @param {string} wikitext
 * @returns {{ pve: Object[], wvw: Object[], pvp: Object[], hasSplit: boolean, recharge: {pve:number|null, wvw:number|null, pvp:number|null}, activation: {pve:number|null, wvw:number|null, pvp:number|null} }}
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
  const timings = parseInfoboxTimings(wikitext);

  return {
    pve: grouped.pve,
    wvw: grouped.wvw,
    pvp: grouped.pvp,
    hasSplit,
    recharge: timings.recharge,
    activation: timings.activation,
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

    const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;

    // Skip pages that exist but have no fact templates and no timings —
    // keep API facts instead of replacing them with empty arrays.
    if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0 && !hasTimings) continue;

    result.set(id, {
      pve: parsed.pve,
      wvw: parsed.hasSplit ? parsed.wvw : null,
      pvp: parsed.hasSplit ? parsed.pvp : null,
      hasSplit: parsed.hasSplit,
      recharge: parsed.recharge,
      activation: parsed.activation,
    });
  }

  return result;
}

module.exports = { groupFactsByMode, parseFactsByMode, resolveEntityFacts };
