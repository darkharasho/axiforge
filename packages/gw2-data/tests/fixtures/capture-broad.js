#!/usr/bin/env node
"use strict";

/**
 * Broad fixture capture — fetches all stat-affecting traits from the GW2 API.
 *
 * A trait is "interesting" (captured) when it has any of:
 *   - AttributeAdjust facts           → flatBonus modifiers
 *   - AttributeConversion / BuffConversion facts → conversion modifiers
 *   - Percent "Critical Chance Increase" facts   → critChance modifiers
 *   - An entry in overrides.json      → special engine handling
 *
 * Output: packages/gw2-data/tests/fixtures/fixtures-broad.json
 *
 * Usage:
 *   node packages/gw2-data/tests/fixtures/capture-broad.js
 *
 * Rate limit: 200ms between requests. Batch size: 200 IDs per request.
 * Typical run time: ~30s for ~999 traits.
 */

const fs = require("fs");
const path = require("path");

const GW2_API = "https://api.guildwars2.com/v2";
const RATE_LIMIT_MS = 200;
const BATCH_SIZE = 200;
const USER_AGENT = "@axiapps/gw2-data fixture-capture-broad";

const OVERRIDES_PATH = path.join(__dirname, "../../data/overrides.json");
const OUT_PATH = path.join(__dirname, "fixtures-broad.json");

// Specialization ID → profession name (GW2 API specialization IDs)
// Used to annotate fixtures with profession context.
const SPEC_PROFESSIONS = {
  // Guardian
  16: "guardian", 42: "guardian", 27: "guardian",
  46: "guardian", 49: "guardian", 62: "guardian",
  // Warrior
  4: "warrior", 11: "warrior", 22: "warrior",
  36: "warrior", 51: "warrior", 18: "warrior",
  // Engineer
  6: "engineer", 29: "engineer", 38: "engineer",
  43: "engineer", 47: "engineer", 57: "engineer",
  // Ranger
  8: "ranger", 25: "ranger", 30: "ranger",
  32: "ranger", 55: "ranger", 5: "ranger",
  // Thief
  10: "thief", 20: "thief", 28: "thief",
  35: "thief", 44: "thief", 7: "thief",
  // Elementalist
  26: "elementalist", 31: "elementalist", 37: "elementalist",
  40: "elementalist", 48: "elementalist", 56: "elementalist",
  // Mesmer
  1: "mesmer", 23: "mesmer", 24: "mesmer",
  45: "mesmer", 59: "mesmer", 60: "mesmer",
  // Necromancer
  2: "necromancer", 19: "necromancer", 39: "necromancer",
  50: "necromancer", 53: "necromancer", 34: "necromancer",
  // Revenant
  3: "revenant", 9: "revenant", 14: "revenant",
  15: "revenant", 52: "revenant", 63: "revenant",
};

let lastRequestTime = 0;

async function rateLimitedFetch(url) {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastRequestTime);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

function isInteresting(trait, overrideIds) {
  if (overrideIds.has(trait.id)) return true;
  const facts = trait.facts || [];
  return facts.some(
    (f) =>
      f.type === "AttributeAdjust" ||
      f.type === "AttributeConversion" ||
      f.type === "BuffConversion" ||
      (f.type === "Percent" && f.text === "Critical Chance Increase")
  );
}

function hasWvwSplit(trait) {
  const facts = trait.facts || [];
  // Group facts by type+text key, flag if any group has 2+ entries
  const groups = new Map();
  for (const f of facts) {
    const key = `${f.type}|${f.text || ""}|${f.target || ""}|${f.source || ""}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return [...groups.values()].some((n) => n > 1);
}

async function main() {
  const overridesRaw = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
  const overrideIds = new Set(
    Object.keys(overridesRaw)
      .filter((k) => k.startsWith("trait:"))
      .map((k) => Number(k.split(":")[1]))
  );

  // 1. Fetch all trait IDs
  process.stdout.write("Fetching trait ID list...");
  const allIds = await rateLimitedFetch(`${GW2_API}/traits`);
  console.log(` ${allIds.length} total trait IDs`);

  // 2. Batch-fetch all traits
  const batches = [];
  for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
    batches.push(allIds.slice(i, i + BATCH_SIZE));
  }

  const allTraits = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`  Batch ${i + 1}/${batches.length} (${batch.length} traits)...`);
    const data = await rateLimitedFetch(`${GW2_API}/traits?ids=${batch.join(",")}&lang=en`);
    allTraits.push(...data);
    console.log(` OK`);
  }
  console.log(`Fetched ${allTraits.length} traits total`);

  // 3. Filter for interesting traits
  const interesting = allTraits.filter((t) => isInteresting(t, overrideIds));
  const withSplit = interesting.filter(hasWvwSplit);
  console.log(`Interesting (stat-affecting): ${interesting.length}`);
  console.log(`  of which have WvW split (2+ same-type facts): ${withSplit.length}`);

  // 4. Build fixture entries (sorted by specialization, then trait ID)
  const fixtures = interesting
    .map((trait) => ({
      id: trait.id,
      specId: trait.specialization || null,
      profession: SPEC_PROFESSIONS[trait.specialization] || null,
      hasWvwSplit: hasWvwSplit(trait),
      hasOverride: overrideIds.has(trait.id),
      api: trait,
    }))
    .sort((a, b) => (a.specId || 999) - (b.specId || 999) || a.id - b.id);

  // 5. Summarise by profession
  const byProf = {};
  for (const f of fixtures) {
    const prof = f.profession || "unknown";
    byProf[prof] = (byProf[prof] || 0) + 1;
  }
  console.log("\nBreakdown by profession:");
  for (const [prof, count] of Object.entries(byProf).sort()) {
    console.log(`  ${prof}: ${count}`);
  }

  const output = {
    capturedAt: new Date().toISOString(),
    totalFetched: allTraits.length,
    totalInteresting: interesting.length,
    totalWithWvwSplit: withSplit.length,
    traits: fixtures,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${fixtures.length} traits to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
