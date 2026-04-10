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
 * Accepts a per-entity title map so that the caller (catalog) can provide
 * disambiguated wiki titles for entities that share a display name.
 * Internally deduplicates fetches by title — if multiple IDs point to the
 * same wiki title, the page is fetched once and the parsed facts are shared.
 *
 * @param {import("./client").WikiClient} client
 * @param {Map<number, string>} idToTitle - Map of entity ID to wiki title
 * @param {object} [options]
 * @param {string} [options.profession] - Profession name (e.g. "Warrior") for disambiguation retries
 * @returns {Promise<Map<number, { pve: Object[], wvw: Object[]|null, pvp: Object[]|null, hasSplit: boolean }>>}
 */
async function resolveEntityFacts(client, idToTitle, options = {}) {
  const result = new Map();

  if (idToTitle.size === 0) return result;

  // Group by title → id[] for batch fetching (avoids duplicate requests)
  const titleToIds = new Map();
  for (const [id, title] of idToTitle) {
    if (!titleToIds.has(title)) titleToIds.set(title, []);
    titleToIds.get(title).push(id);
  }

  const titles = [...titleToIds.keys()];
  const wikitextMap = await client.getWikitextBatch(titles);

  // Collect disambiguation pages and name collisions for retry
  const disambigRetries = new Map(); // alternative title → original title
  const nameCollisionRetries = new Map(); // original title → id[] (wrong infobox type / wrong ID)
  const profession = options.profession ? options.profession.toLowerCase() : null;

  for (const [title, ids] of titleToIds) {
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
    const hasSkillOrTraitInfobox = /\{\{(?:Skill|Trait) infobox\b/i.test(wikitext);
    if (!hasSkillOrTraitInfobox) {
      // Wrong page type (location, weapon, NPC, etc.) or no infobox.
      // Check if page has parseable facts anyway (some skill pages lack formal infoboxes).
      const parsed = parseFactsByMode(wikitext);
      const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;
      const hasFacts = parsed.pve.length > 0 || parsed.wvw.length > 0 || parsed.pvp.length > 0 || hasTimings;
      if (hasFacts) {
        // Has facts but no infobox — accept it (existing behavior)
        const factEntry = {
          pve: parsed.pve,
          wvw: parsed.hasSplit ? parsed.wvw : null,
          pvp: parsed.hasSplit ? parsed.pvp : null,
          hasSplit: parsed.hasSplit,
          recharge: parsed.recharge,
          activation: parsed.activation,
        };
        for (const id of ids) result.set(id, factEntry);
      } else {
        // No infobox AND no facts — likely a wrong page type, queue retry
        nameCollisionRetries.set(title, ids);
      }
      continue;
    }

    // Has Skill/Trait infobox — correct page type, parse facts normally
    const parsed = parseFactsByMode(wikitext);

    const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;

    // Skip pages that exist but have no fact templates and no timings —
    // keep API facts instead of replacing them with empty arrays.
    if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0 && !hasTimings) continue;

    const factEntry = {
      pve: parsed.pve,
      wvw: parsed.hasSplit ? parsed.wvw : null,
      pvp: parsed.hasSplit ? parsed.pvp : null,
      hasSplit: parsed.hasSplit,
      recharge: parsed.recharge,
      activation: parsed.activation,
    };

    // Apply facts to ALL IDs sharing this title. Many skills have multiple API IDs
    // that map to a single wiki page (e.g. True Nature per legend, Deploy Jade Sphere
    // per attunement). Giving all IDs the same facts is correct for these variants.
    for (const id of ids) result.set(id, factEntry);

    // If the page's infobox ID doesn't cover all requesting IDs, queue the unmatched
    // ones for prefix search — they might be genuinely different entities (e.g. "Maul"
    // the ranger greatsword vs "Maul" the pet skill). If prefix search finds a better
    // page, it overwrites the initially-shared facts.
    if (ids.length > 1) {
      const infoboxIds = new Set(extractInfoboxId(wikitext));
      if (infoboxIds.size > 0) {
        const unmatched = ids.filter((id) => !infoboxIds.has(id));
        if (unmatched.length > 0) {
          const existing = nameCollisionRetries.get(title) || [];
          nameCollisionRetries.set(title, [...existing, ...unmatched]);
        }
      }
    }
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

      const ids = titleToIds.get(originalTitle);
      const factEntry = {
        pve: parsed.pve,
        wvw: parsed.hasSplit ? parsed.wvw : null,
        pvp: parsed.hasSplit ? parsed.pvp : null,
        hasSplit: parsed.hasSplit,
        recharge: parsed.recharge,
        activation: parsed.activation,
      };
      for (const id of ids) result.set(id, factEntry);
    }
  }

  // Retry name collision pages via prefix search for "Name (" variants.
  // This handles both wrong-type pages (location instead of skill) and infobox ID
  // mismatches (page is about a different entity with the same name).
  if (nameCollisionRetries.size > 0) {
    // Prefix-search all colliding titles in parallel to find candidate pages
    const searchPromises = [];
    for (const [title] of nameCollisionRetries) {
      searchPromises.push(
        client.prefixSearch(`${title} (`).then((titles) => ({ originalTitle: title, candidates: titles }))
      );
    }
    const searchResults = await Promise.all(searchPromises);

    // Collect all candidate titles for a single batch fetch.
    // Accept any disambiguated page (not just "skill"/"trait" suffixes) — pet skill
    // pages use family names like "Maul (porcine)". The infobox type/ID check after
    // fetching is the real filter.
    const candidateToOriginal = new Map(); // candidate title → original title
    for (const { originalTitle, candidates } of searchResults) {
      for (const candidate of candidates) {
        if (candidate.includes("/")) continue; // exclude subpages
        candidateToOriginal.set(candidate, originalTitle);
      }
    }

    if (candidateToOriginal.size > 0) {
      const candidateWikitext = await client.getWikitextBatch([...candidateToOriginal.keys()]);

      // Group candidates by original title
      const candidatesByOriginal = new Map(); // original title → [candidate titles]
      for (const [candidate, original] of candidateToOriginal) {
        if (!candidatesByOriginal.has(original)) candidatesByOriginal.set(original, []);
        candidatesByOriginal.get(original).push(candidate);
      }

      for (const [originalTitle, candidates] of candidatesByOriginal) {
        const unresolvedIds = new Set(nameCollisionRetries.get(originalTitle));

        for (const candidate of candidates) {
          if (unresolvedIds.size === 0) break;

          const wikitext = candidateWikitext.get(candidate);
          if (!wikitext) continue;

          if (!/\{\{(?:Skill|Trait) infobox\b/i.test(wikitext)) continue;

          const parsed = parseFactsByMode(wikitext);
          const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;
          if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0 && !hasTimings) continue;

          const factEntry = {
            pve: parsed.pve,
            wvw: parsed.hasSplit ? parsed.wvw : null,
            pvp: parsed.hasSplit ? parsed.pvp : null,
            hasSplit: parsed.hasSplit,
            recharge: parsed.recharge,
            activation: parsed.activation,
          };

          // Match candidate to specific requesting IDs by infobox ID
          const infoboxIds = extractInfoboxId(wikitext);
          const matched = infoboxIds.filter((id) => unresolvedIds.has(id));

          if (matched.length > 0) {
            for (const id of matched) {
              result.set(id, factEntry);
              unresolvedIds.delete(id);
            }
          } else if (infoboxIds.length === 0) {
            // No infobox IDs extractable — apply to all remaining (legacy fallback)
            for (const id of unresolvedIds) result.set(id, factEntry);
            unresolvedIds.clear();
          }
          // If infobox IDs exist but don't match any requesting ID, skip this candidate
        }
      }
    }
  }

  return result;
}

module.exports = { groupFactsByMode, parseFactsByMode, resolveEntityFacts, isDisambiguation, extractInfoboxId };
