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
 * Detect whether wikitext is a disambiguation page.
 * GW2 wiki uses {{disambig}} or {{disambiguation}} templates.
 */
function isDisambiguation(wikitext) {
  return /\{\{disambig(uation)?\s*(\||\}\})/i.test(wikitext);
}

/**
 * Extract the GW2 API ID(s) from a {{Skill infobox}} or {{Trait infobox}} template.
 * Returns an array of numeric IDs, or empty array if no matching infobox found.
 *
 * @param {string} wikitext
 * @returns {number[]}
 */
function extractInfoboxId(wikitext) {
  // Match only Skill or Trait infoboxes (not Location, Weapon, NPC, etc.)
  const infoboxMatch = wikitext.match(/\{\{(?:Skill|Trait) infobox\b/i);
  if (!infoboxMatch) return [];

  // Find the | id = ... line within the infobox
  const idMatch = wikitext.match(/\|\s*id\s*=\s*([0-9,\s]+)/);
  if (!idMatch) return [];

  return idMatch[1]
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

/**
 * Batch-resolve wiki facts for multiple entities.
 *
 * @param {import("./client").WikiClient} client
 * @param {Map<string, number>} titleToId - Map of wiki title to entity ID
 * @param {object} [options]
 * @param {string} [options.profession] - Profession name (e.g. "Warrior") for disambiguation retries
 * @returns {Promise<Map<number, { pve: Object[], wvw: Object[]|null, pvp: Object[]|null, hasSplit: boolean }>>}
 */
async function resolveEntityFacts(client, titleToId, options = {}) {
  const result = new Map();

  if (titleToId.size === 0) return result;

  const titles = [...titleToId.keys()];
  const wikitextMap = await client.getWikitextBatch(titles);

  // Collect disambiguation pages and name collisions for retry
  const disambigRetries = new Map(); // alternative title → original title
  const nameCollisionRetries = new Map(); // original title → id (wrong infobox type / wrong ID)
  const profession = options.profession ? options.profession.toLowerCase() : null;

  for (const [title, id] of titleToId) {
    const wikitext = wikitextMap.get(title);
    if (!wikitext) continue; // skip missing pages

    // If this is a disambiguation page, queue a retry with profession-specific suffix
    if (isDisambiguation(wikitext)) {
      if (profession) {
        disambigRetries.set(`${title} (${profession} skill)`, title);
      }
      continue;
    }

    // Check if page has a Skill or Trait infobox (right page type).
    // Don't check the specific ID — multiple entities can share a name,
    // and titleToFirstId may map to a different entity than the wiki page lists.
    const hasSkillOrTraitInfobox = /\{\{(?:Skill|Trait) infobox\b/i.test(wikitext);
    if (!hasSkillOrTraitInfobox) {
      // Wrong page type (location, weapon, NPC, etc.) or no infobox.
      // Check if page has parseable facts anyway (some skill pages lack formal infoboxes).
      const parsed = parseFactsByMode(wikitext);
      const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;
      const hasFacts = parsed.pve.length > 0 || parsed.wvw.length > 0 || parsed.pvp.length > 0 || hasTimings;
      if (hasFacts) {
        // Has facts but no infobox — accept it (existing behavior)
        result.set(id, {
          pve: parsed.pve,
          wvw: parsed.hasSplit ? parsed.wvw : null,
          pvp: parsed.hasSplit ? parsed.pvp : null,
          hasSplit: parsed.hasSplit,
          recharge: parsed.recharge,
          activation: parsed.activation,
        });
      } else {
        // No infobox AND no facts — likely a wrong page type, queue retry
        nameCollisionRetries.set(title, id);
      }
      continue;
    }

    // Has Skill/Trait infobox — correct page type, parse facts normally
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

  // Retry disambiguation pages with profession-specific titles
  if (disambigRetries.size > 0) {
    const retryTitles = [...disambigRetries.keys()];
    const retryMap = await client.getWikitextBatch(retryTitles);

    for (const [retryTitle, originalTitle] of disambigRetries) {
      const wikitext = retryMap.get(retryTitle);
      if (!wikitext) continue;

      const parsed = parseFactsByMode(wikitext);
      const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;
      if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0 && !hasTimings) continue;

      const id = titleToId.get(originalTitle);
      result.set(id, {
        pve: parsed.pve,
        wvw: parsed.hasSplit ? parsed.wvw : null,
        pvp: parsed.hasSplit ? parsed.pvp : null,
        hasSplit: parsed.hasSplit,
        recharge: parsed.recharge,
        activation: parsed.activation,
      });
    }
  }

  // Retry name collision pages with suffix variants
  if (nameCollisionRetries.size > 0 && profession) {
    // Round 1: "Name (profession skill)"
    const round1Map = new Map(); // retry title → original title
    for (const [title] of nameCollisionRetries) {
      round1Map.set(`${title} (${profession} skill)`, title);
    }

    const round1Titles = [...round1Map.keys()];
    const round1Wikitext = await client.getWikitextBatch(round1Titles);
    const stillMissing = new Map(); // original title → id

    for (const [retryTitle, originalTitle] of round1Map) {
      const wikitext = round1Wikitext.get(retryTitle);
      if (!wikitext) {
        stillMissing.set(originalTitle, nameCollisionRetries.get(originalTitle));
        continue;
      }

      const parsed = parseFactsByMode(wikitext);
      const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;
      if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0 && !hasTimings) {
        stillMissing.set(originalTitle, nameCollisionRetries.get(originalTitle));
        continue;
      }

      const id = nameCollisionRetries.get(originalTitle);
      result.set(id, {
        pve: parsed.pve,
        wvw: parsed.hasSplit ? parsed.wvw : null,
        pvp: parsed.hasSplit ? parsed.pvp : null,
        hasSplit: parsed.hasSplit,
        recharge: parsed.recharge,
        activation: parsed.activation,
      });
    }

    // Round 2: "Name (skill)" for remaining
    if (stillMissing.size > 0) {
      const round2Map = new Map(); // retry title → original title
      for (const [title] of stillMissing) {
        round2Map.set(`${title} (skill)`, title);
      }

      const round2Titles = [...round2Map.keys()];
      const round2Wikitext = await client.getWikitextBatch(round2Titles);

      for (const [retryTitle, originalTitle] of round2Map) {
        const wikitext = round2Wikitext.get(retryTitle);
        if (!wikitext) continue;

        const parsed = parseFactsByMode(wikitext);
        const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;
        if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0 && !hasTimings) continue;

        const id = stillMissing.get(originalTitle);
        result.set(id, {
          pve: parsed.pve,
          wvw: parsed.hasSplit ? parsed.wvw : null,
          pvp: parsed.hasSplit ? parsed.pvp : null,
          hasSplit: parsed.hasSplit,
          recharge: parsed.recharge,
          activation: parsed.activation,
        });
      }
    }
  }

  return result;
}

module.exports = { groupFactsByMode, parseFactsByMode, resolveEntityFacts, isDisambiguation, extractInfoboxId };
