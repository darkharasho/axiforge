#!/usr/bin/env node
"use strict";

/**
 * Live validation script — fetches real GW2 API + wiki data and validates
 * that our parser + merger produce correct results.
 *
 * This is NOT a test file. Run it manually to spot-check against live data:
 *
 *   node packages/gw2-data/tests/validate-live.js
 *   node packages/gw2-data/tests/validate-live.js --ids 5489,30185
 *   node packages/gw2-data/tests/validate-live.js --type traits --ids 264,1510
 *
 * Exits with code 1 if any validation fails.
 */

const { WikiClient } = require("../src/wiki/client");
const { Gw2ApiClient } = require("../src/api/client");
const { MemoryCache } = require("../src/wiki/cache");
const { mergeFacts } = require("../src/facts/merge");
const { normalizeFactType } = require("../src/facts/normalize");

const GW2_API = "https://api.guildwars2.com/v2";
const WIKI_API = "https://wiki.guildwars2.com/api.php";

// Known split skills from the wiki's balance split category.
// These are good validation targets because they have WvW-specific values.
const DEFAULT_SKILL_IDS = [
  5489,  // Fireball
  5536,  // Arcane Blast
  30185, // Berserk
  5507,  // Meteor Shower
  5548,  // Eruption
  5569,  // Water Blast
  5503,  // Glyph of Storms
  10586, // Mending (Warrior)
  5694,  // Burning Retreat (Elementalist)
  10574, // Bull's Charge (Warrior)
];

const DEFAULT_TRAIT_IDS = [
  264,  // Burning Precision
  1510, // Flow like Water
  1502, // Swift Revenge
  214,  // Empowering Might
  1925, // Stalwart Speed
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function color(code, text) {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (t) => color(32, t);
const red = (t) => color(31, t);
const yellow = (t) => color(33, t);
const dim = (t) => color(2, t);

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const typeArg = args.includes("--type") ? args[args.indexOf("--type") + 1] : "skills";
  const idsArg = args.includes("--ids") ? args[args.indexOf("--ids") + 1] : null;

  const ids = idsArg
    ? idsArg.split(",").map((s) => parseInt(s.trim(), 10))
    : (typeArg === "traits" ? DEFAULT_TRAIT_IDS : DEFAULT_SKILL_IDS);

  const endpoint = typeArg === "traits" ? "traits" : "skills";

  const wikiClient = new WikiClient({
    cache: new MemoryCache(),
    fetch: globalThis.fetch,
  });

  const apiClient = new Gw2ApiClient({
    cache: new MemoryCache(),
    fetch: globalThis.fetch,
  });

  console.log(`\nValidating ${ids.length} ${endpoint} against live GW2 data...\n`);

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const id of ids) {
    process.stdout.write(`  ${id} `);

    // 1. Fetch API data
    let apiData;
    try {
      const url = `${GW2_API}/${endpoint}/${id}?lang=en`;
      apiData = await apiClient.fetchJson(url);
    } catch (err) {
      console.log(yellow(`SKIP — API error: ${err.message}`));
      skipped++;
      continue;
    }

    const name = apiData.name || `(${endpoint} ${id})`;
    process.stdout.write(`${name.padEnd(30)} `);

    // 2. Fetch wiki page
    let wikitext;
    try {
      wikitext = await wikiClient.getWikitext(name);
    } catch (err) {
      console.log(yellow(`SKIP — wiki error: ${err.message}`));
      skipped++;
      continue;
    }

    if (!wikitext) {
      console.log(yellow("SKIP — no wiki page"));
      skipped++;
      continue;
    }

    // 3. Parse wiki facts
    const wikiResult = wikiClient.parseFacts(wikitext);
    const apiFacts = apiData.facts || [];

    // 4. Validate
    const issues = [];

    // Check: if wiki has a split, we should get split facts
    if (wikiResult.splitGrouping?.wvwHasSplit && wikiResult.facts.length === 0) {
      issues.push("split detected but no WvW facts parsed");
    }

    // Check: wiki fact types should all be recognized API types
    for (const fact of wikiResult.facts) {
      const normalized = normalizeFactType(fact.type);
      if (!normalized) {
        issues.push(`unknown fact type: ${fact.type}`);
      }
    }

    // Check: merge should not crash
    try {
      const merged = mergeFacts(apiFacts, wikiResult.facts, { complete: false });
      if (wikiResult.facts.length > 0 && merged.length === 0) {
        issues.push("merge produced empty result from non-empty inputs");
      }
    } catch (err) {
      issues.push(`merge crashed: ${err.message}`);
    }

    // Check: damage coefficients should be reasonable (0 < coeff < 50)
    for (const fact of wikiResult.facts) {
      if (fact.type === "Damage" && fact.dmg_multiplier !== undefined) {
        if (fact.dmg_multiplier < 0 || fact.dmg_multiplier > 50) {
          issues.push(`suspicious damage coefficient: ${fact.dmg_multiplier}`);
        }
      }
    }

    // Check: durations should be non-negative
    for (const fact of wikiResult.facts) {
      if (fact.duration !== undefined && fact.duration < 0) {
        issues.push(`negative duration: ${fact.duration}`);
      }
    }

    if (issues.length > 0) {
      console.log(red("FAIL"));
      for (const issue of issues) {
        console.log(`      ${red("✗")} ${issue}`);
      }
      failed++;
    } else {
      const splitLabel = wikiResult.splitGrouping?.wvwHasSplit ? "split" : "universal";
      console.log(
        green("OK") +
        dim(` (${wikiResult.facts.length} wiki facts, ${apiFacts.length} API facts, ${splitLabel})`)
      );
      passed++;
    }
  }

  console.log(`\n  ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : `${failed} failed`}, ${skipped} skipped\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
