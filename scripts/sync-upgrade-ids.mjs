#!/usr/bin/env node
// Sync upgrade-item ID lists in src/main/gw2Data/upgradeIds.js from the GW2 wiki.
// Uses Semantic MediaWiki Ask queries to enumerate items by category + rarity.
//
// Usage:
//   node scripts/sync-upgrade-ids.mjs              # sync all categories
//   node scripts/sync-upgrade-ids.mjs relics       # sync just one
//   node scripts/sync-upgrade-ids.mjs runes sigils # sync several
//
// Add a new category by appending an entry to CATEGORIES below.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WIKI_API = "https://wiki.guildwars2.com/api.php";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(__dirname, "../src/main/gw2Data/upgradeIds.js");

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
    const changed = await syncCategory(t, CATEGORIES[t], srcRef);
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
