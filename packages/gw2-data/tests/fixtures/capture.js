#!/usr/bin/env node
"use strict";

/**
 * Capture real GW2 API + Wiki data for fixture-based regression tests.
 *
 * Usage:  node packages/gw2-data/tests/fixtures/capture.js
 *
 * Fetches skill/trait data from the live GW2 API and corresponding wikitext
 * from wiki.guildwars2.com, then writes a single fixtures.json file.
 */

const fs = require("fs");
const path = require("path");

const GW2_API = "https://api.guildwars2.com/v2";
const WIKI_API = "https://wiki.guildwars2.com/api.php";
const RATE_LIMIT_MS = 250;
const USER_AGENT = "@axiapps/gw2-data fixture-capture";

// Representative skills/traits covering different edge cases:
//
// Skills with balance splits (WvW differs from PvE):
//   5489  - Fireball (Elementalist) — basic damage skill, split
//   5536  - Arcane Blast (Elementalist) — split with different coefficients
//   30185 - Berserk (Warrior) — known regression target, complex facts
//
// Skills with various fact types:
//   5507  - Meteor Shower (Elementalist) — damage + burning + hits + radius
//   5492  - Fire Attunement (Elementalist) — attunement with flipSkill (Overload)
//   5503  - Glyph of Storms (Elementalist) — multi-attunement skill
//
// Traits with splits:
//   1510  - Flow like Water (Weaver) — trait with split
//   1502  - Swift Revenge (Weaver) — trait
//
// Skills with healing/barrier:
//   5569  - Water Blast (Elementalist) — healing skill
//
// Skills with combo fields/finishers:
//   5548  - Eruption (Elementalist) — blast finisher + fire field

const SKILLS_TO_CAPTURE = [
  { id: 5489, wiki: "Fireball", note: "basic damage, has split" },
  { id: 5536, wiki: "Arcane Blast", note: "split with different coefficients" },
  { id: 30185, wiki: "Berserk", note: "warrior elite, regression target" },
  { id: 5507, wiki: "Meteor Shower", note: "damage+burning+hits+radius" },
  { id: 5492, wiki: "Fire Attunement", note: "attunement with flipSkill" },
  { id: 5548, wiki: "Eruption", note: "blast finisher + fire field" },
  { id: 5569, wiki: "Water Blast", note: "healing skill" },
  { id: 5503, wiki: "Glyph of Storms", note: "multi-attunement" },
];

const TRAITS_TO_CAPTURE = [
  { id: 1510, wiki: "Flow like Water", note: "Weaver trait with split" },
  { id: 1502, wiki: "Swift Revenge", note: "Weaver trait" },
  { id: 264, wiki: "Burning Precision", note: "trait with condition" },
];

let lastRequestTime = 0;

async function rateLimitedFetch(url) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  return res;
}

async function fetchApiSkill(id) {
  const url = `${GW2_API}/skills/${id}?lang=en`;
  const res = await rateLimitedFetch(url);
  if (!res.ok) {
    console.warn(`  API skill ${id}: HTTP ${res.status}`);
    return null;
  }
  return res.json();
}

async function fetchApiTrait(id) {
  const url = `${GW2_API}/traits/${id}?lang=en`;
  const res = await rateLimitedFetch(url);
  if (!res.ok) {
    console.warn(`  API trait ${id}: HTTP ${res.status}`);
    return null;
  }
  return res.json();
}

async function fetchWikitext(title) {
  const url =
    `${WIKI_API}?action=query&prop=revisions&rvprop=content` +
    `&titles=${encodeURIComponent(title)}&format=json&formatversion=2`;
  const res = await rateLimitedFetch(url);
  if (!res.ok) {
    console.warn(`  Wiki "${title}": HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  const page = data.query?.pages?.[0];
  if (!page || page.missing) {
    console.warn(`  Wiki "${title}": page not found`);
    return null;
  }
  return page.revisions?.[0]?.content || null;
}

async function main() {
  const fixtures = { skills: [], traits: [], capturedAt: new Date().toISOString() };

  console.log("Capturing skill fixtures...");
  for (const entry of SKILLS_TO_CAPTURE) {
    process.stdout.write(`  ${entry.id} (${entry.wiki})...`);
    const api = await fetchApiSkill(entry.id);
    const wikitext = await fetchWikitext(entry.wiki);
    if (api && wikitext) {
      fixtures.skills.push({
        id: entry.id,
        wikiTitle: entry.wiki,
        note: entry.note,
        api,
        wikitext,
      });
      console.log(" OK");
    } else {
      console.log(" SKIPPED");
    }
  }

  console.log("\nCapturing trait fixtures...");
  for (const entry of TRAITS_TO_CAPTURE) {
    process.stdout.write(`  ${entry.id} (${entry.wiki})...`);
    const api = await fetchApiTrait(entry.id);
    const wikitext = await fetchWikitext(entry.wiki);
    if (api && wikitext) {
      fixtures.traits.push({
        id: entry.id,
        wikiTitle: entry.wiki,
        note: entry.note,
        api,
        wikitext,
      });
      console.log(" OK");
    } else {
      console.log(" SKIPPED");
    }
  }

  const outPath = path.join(__dirname, "fixtures.json");
  fs.writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
  console.log(`\nWrote ${fixtures.skills.length} skills + ${fixtures.traits.length} traits to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
