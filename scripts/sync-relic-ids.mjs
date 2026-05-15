#!/usr/bin/env node
// Sync RELIC_ITEM_IDS in src/main/gw2Data/upgradeIds.js from the GW2 wiki.
// Uses Semantic MediaWiki: [[Category:Relics]] | ?Has game id.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WIKI_API = "https://wiki.guildwars2.com/api.php";
// Pages in Category:Relics that aren't selectable upgrade items.
const EXCLUDE_TITLES = new Set(["Legendary Relic"]);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(__dirname, "../src/main/gw2Data/upgradeIds.js");

async function fetchRelics() {
  const out = [];
  let offset = 0;
  for (;;) {
    const url = new URL(WIKI_API);
    url.searchParams.set("action", "ask");
    url.searchParams.set("format", "json");
    url.searchParams.set("query", `[[Category:Relics]]|?Has game id|limit=500|offset=${offset}`);
    const res = await fetch(url, { headers: { "User-Agent": "axiforge-sync" } });
    if (!res.ok) throw new Error(`wiki ${res.status}`);
    const data = await res.json();
    const results = data?.query?.results || {};
    for (const [title, entry] of Object.entries(results)) {
      if (EXCLUDE_TITLES.has(title)) continue;
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

function renderBlock(relics) {
  const sorted = [...relics].sort((a, b) => a.id - b.id);
  const lines = sorted.map(({ id, name }) => `  ${id}, // ${name}`);
  return `const RELIC_ITEM_IDS = [\n${lines.join("\n")}\n];`;
}

async function main() {
  const relics = await fetchRelics();
  if (!relics.length) throw new Error("no relics returned from wiki");

  const src = await readFile(TARGET, "utf8");
  const blockRe = /const RELIC_ITEM_IDS = \[[\s\S]*?\n\];/;
  if (!blockRe.test(src)) throw new Error("RELIC_ITEM_IDS block not found in upgradeIds.js");

  const existingIds = new Set(
    [...src.match(blockRe)[0].matchAll(/^\s*(\d+),/gm)].map((m) => Number(m[1])),
  );
  const nextIds = new Set(relics.map((r) => r.id));
  const added = [...nextIds].filter((id) => !existingIds.has(id));
  const removed = [...existingIds].filter((id) => !nextIds.has(id));

  const updated = src.replace(blockRe, renderBlock(relics));
  if (updated === src) {
    console.log(`✓ relics already up to date (${relics.length} entries)`);
    return;
  }
  await writeFile(TARGET, updated);
  console.log(`✓ wrote ${relics.length} relics to ${path.relative(process.cwd(), TARGET)}`);
  if (added.length) {
    const byId = new Map(relics.map((r) => [r.id, r.name]));
    console.log(`  + added (${added.length}): ${added.map((id) => `${id} ${byId.get(id)}`).join(", ")}`);
  }
  if (removed.length) {
    console.log(`  - removed (${removed.length}): ${removed.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
