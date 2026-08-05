#!/usr/bin/env node
// Sync upgrade-item ID lists in src/main/gw2Data/upgradeIds.js from the GW2 wiki.
// Uses Semantic MediaWiki Ask queries to enumerate items by category + rarity.
//
// Two modes (per CATEGORIES entry):
//   replace  — relics/runes/sigils: the wiki category IS the canonical list, so
//              the block is rewritten wholesale (adds new, drops removed).
//   additive — food/utility: the lists are hand-curated (mostly Masterwork/Rare
//              stat items the wiki category can't cleanly isolate), so we only
//              APPEND newly-published Exotic/Ascended stat items and never remove
//              anything. This catches holiday/expansion additions (e.g. the Snow
//              Diamond Ornament class of "+X% All Attributes" items) without
//              collapsing the curated lower-tier entries.
//
// Usage:
//   node scripts/sync-upgrade-ids.mjs              # sync all categories
//   node scripts/sync-upgrade-ids.mjs relics       # sync just one
//   node scripts/sync-upgrade-ids.mjs runes sigils # sync several
//   node scripts/sync-upgrade-ids.mjs food utility # additive picker refresh
//
// Add a new category by appending an entry to CATEGORIES below.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WIKI_API = "https://wiki.guildwars2.com/api.php";
const GW2_API = "https://api.guildwars2.com/v2";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(__dirname, "../src/main/gw2Data/upgradeIds.js");

// Only auto-append picker-worthy tiers; lower rarities stay hand-curated.
const ADDITIVE_RARITIES = new Set(["Exotic", "Ascended"]);
// Require a real combat attribute (or "All Attributes") in the buff description,
// so cosmetic/economy consumables that share the food/utility slot are skipped
// — e.g. Fool's Ocular Tonic (a "Long-View Enhancement" with only Magic Find /
// Karma / Gold / XP). Buff-name matching (below) already excludes that one, but
// this is a second guard against pure Magic-Find or novelty items.
const ADDITIVE_STAT_RE =
  /(All Attributes|Power|Precision|Toughness|Vitality|Ferocity|Condition Damage|Expertise|Concentration|Healing Power|Boon Duration|Condition Duration|Agony Resistance|Fishing Power)/i;

// Each entry maps a logical category to:
//   const       — the name of the `const NAME = [...]` block in upgradeIds.js
//   query       — the SMW ask query (without |?Has game id|limit/offset)
//   exclude     — page titles to skip even if they match the query
//   titleFilter — optional regex; if set, only titles matching are kept.
//                 Needed because the wiki's rune/sigil categories lump
//                 Major/Superior/Legendary together but the picker only wants
//                 Exotic Superior items.
const CATEGORIES = {
  relics: {
    const: "RELIC_ITEM_IDS",
    query: "[[Category:Relics]]",
    exclude: new Set(["Legendary Relic"]),
  },
  runes: {
    const: "RUNE_ITEM_IDS",
    query: "[[Category:Runes]]",
    titleFilter: /^Superior Rune of /,
  },
  sigils: {
    const: "SIGIL_ITEM_IDS",
    query: "[[Category:Sigils]]",
    titleFilter: /^Superior Sigil of /,
  },
  // Additive (never removes): append newly-published Exotic/Ascended stat foods
  // whose buff is a real Nourishment. `Category:Foods` (plural) is the wiki's
  // food-item category.
  food: {
    const: "FOOD_ITEM_IDS",
    query: "[[Category:Foods]]",
    additive: true,
    buffName: "Nourishment",
  },
  // Additive: append newly-published Exotic/Ascended utility (Enhancement-slot)
  // items. Buff name must be exactly "Enhancement" — this excludes novelty
  // slot-sharers like the "Long-View Enhancement" tonic.
  utility: {
    const: "UTILITY_ITEM_IDS",
    query: "[[Category:Utility items]]",
    additive: true,
    buffName: "Enhancement",
  },
};

async function fetchCategory({ query, exclude = new Set(), titleFilter = null }) {
  const out = [];
  let offset = 0;
  for (;;) {
    const url = new URL(WIKI_API);
    url.searchParams.set("action", "ask");
    url.searchParams.set("format", "json");
    url.searchParams.set("query", `${query}|?Has game id|limit=500|offset=${offset}`);
    const res = await fetch(url, { headers: { "User-Agent": "axiforge-sync" } });
    if (!res.ok) throw new Error(`wiki ${res.status} for ${query}`);
    const data = await res.json();
    const results = data?.query?.results || {};
    for (const [title, entry] of Object.entries(results)) {
      if (exclude.has(title)) continue;
      if (titleFilter && !titleFilter.test(title)) continue;
      const ids = entry?.printouts?.["Has game id"] || [];
      if (!ids.length) continue;
      out.push({ name: title, id: Number(ids[0]) });
    }
    const next = data["query-continue-offset"];
    if (typeof next !== "number" || next <= offset) break;
    offset = next;
  }
  return out;
}

// Fetch full item details from the GW2 API in batches (rarity + buff details
// aren't available via the wiki SMW printouts we query).
async function fetchApiItems(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const res = await fetch(`${GW2_API}/items?lang=en&ids=${chunk.join(",")}`, {
      headers: { "User-Agent": "axiforge-sync" },
    });
    if (!res.ok) throw new Error(`GW2 API ${res.status} for items batch`);
    out.push(...(await res.json()));
  }
  return out;
}

function renderBlock(constName, items) {
  const sorted = [...items].sort((a, b) => a.id - b.id);
  const lines = sorted.map(({ id, name }) => `  ${id}, // ${name}`);
  return `const ${constName} = [\n${lines.join("\n")}\n];`;
}

function blockRegex(constName) {
  return new RegExp(`const ${constName} = \\[[\\s\\S]*?\\n\\];`);
}

async function syncCategory(name, cfg, srcRef) {
  const items = await fetchCategory(cfg);
  if (!items.length) throw new Error(`no ${name} returned from wiki`);

  const re = blockRegex(cfg.const);
  if (!re.test(srcRef.src)) throw new Error(`${cfg.const} block not found in upgradeIds.js`);

  const existingIds = new Set(
    [...srcRef.src.match(re)[0].matchAll(/^\s*(\d+),/gm)].map((m) => Number(m[1])),
  );
  const nextIds = new Set(items.map((r) => r.id));
  const added = [...nextIds].filter((id) => !existingIds.has(id));
  const removed = [...existingIds].filter((id) => !nextIds.has(id));

  const updated = srcRef.src.replace(re, renderBlock(cfg.const, items));
  if (updated === srcRef.src) {
    console.log(`✓ ${name}: already up to date (${items.length} entries)`);
    return false;
  }
  srcRef.src = updated;
  console.log(`✓ ${name}: wrote ${items.length} entries`);
  if (added.length) {
    const byId = new Map(items.map((r) => [r.id, r.name]));
    console.log(`  + added (${added.length}): ${added.map((id) => `${id} ${byId.get(id)}`).join(", ")}`);
  }
  if (removed.length) {
    console.log(`  - removed (${removed.length}): ${removed.join(", ")}`);
  }
  return true;
}

// Additive sync: keep every existing id, append only newly-published
// Exotic/Ascended stat items. A flaky wiki/API response leaves the list
// untouched (skip, don't throw) so it can't collapse a hand-curated block.
async function syncCategoryAdditive(name, cfg, srcRef) {
  let wiki;
  let details;
  try {
    wiki = await fetchCategory(cfg);
    details = await fetchApiItems(wiki.map((w) => w.id));
  } catch (err) {
    console.warn(`⚠ ${name}: skipped — fetch failed (${err.message}); list left unchanged`);
    return false;
  }
  const byId = new Map(details.map((d) => [d.id, d]));
  const qualifies = (d) =>
    d &&
    ADDITIVE_RARITIES.has(d.rarity) &&
    d.details &&
    d.details.name === cfg.buffName &&
    ADDITIVE_STAT_RE.test(d.details.description || "");

  const re = blockRegex(cfg.const);
  if (!re.test(srcRef.src)) throw new Error(`${cfg.const} block not found in upgradeIds.js`);
  const block = srcRef.src.match(re)[0];
  // These blocks pack many ids per line, so match every id, not just the
  // line-leading one. Strip `//` comments first so a digit inside an item-name
  // comment can't be mistaken for an id.
  const existing = new Set(
    [...block.replace(/\/\/[^\n]*/g, "").matchAll(/\d+/g)].map((m) => Number(m[0])),
  );

  const toAdd = wiki
    .filter((w) => qualifies(byId.get(w.id)) && !existing.has(w.id))
    .sort((a, b) => a.id - b.id);
  if (!toAdd.length) {
    console.log(`✓ ${name}: up to date (${existing.size} entries, no new Exotic/Ascended items)`);
    return false;
  }

  const insert = toAdd.map((c) => `  ${c.id}, // ${c.name} (auto-added)`).join("\n");
  const updatedBlock = block.replace(/\n\];\s*$/, `\n${insert}\n];`);
  // Function replacement so `$`/`$&` inside item names aren't treated as
  // replacement patterns.
  srcRef.src = srcRef.src.replace(re, () => updatedBlock);
  console.log(`✓ ${name}: added ${toAdd.length}: ${toAdd.map((c) => `${c.id} ${c.name}`).join(", ")}`);
  return true;
}

async function main() {
  const requested = process.argv.slice(2);
  const targets = requested.length ? requested : Object.keys(CATEGORIES);
  for (const t of targets) {
    if (!CATEGORIES[t]) {
      console.error(`unknown category: ${t}. valid: ${Object.keys(CATEGORIES).join(", ")}`);
      process.exit(2);
    }
  }

  const srcRef = { src: await readFile(TARGET, "utf8") };
  let anyChanged = false;
  for (const t of targets) {
    const cfg = CATEGORIES[t];
    const changed = cfg.additive
      ? await syncCategoryAdditive(t, cfg, srcRef)
      : await syncCategory(t, cfg, srcRef);
    anyChanged = anyChanged || changed;
  }
  if (anyChanged) {
    await writeFile(TARGET, srcRef.src);
    console.log(`wrote ${path.relative(process.cwd(), TARGET)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
