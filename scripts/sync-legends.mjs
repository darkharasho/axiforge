#!/usr/bin/env node
// Sync src/main/gw2Data/legends.json from the GW2 API.
// /v2/legends returns Revenant legend definitions with swap/heal/elite/utility
// skill IDs in exactly the format we already store.
//
// Usage:
//   node scripts/sync-legends.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(__dirname, "../src/main/gw2Data/legends.json");
const GW2_API = "https://api.guildwars2.com/v2";

async function main() {
  const idsRes = await fetch(`${GW2_API}/legends`);
  if (!idsRes.ok) throw new Error(`gw2 api legends ${idsRes.status}`);
  const ids = await idsRes.json();
  if (!Array.isArray(ids) || !ids.length) throw new Error("no legend ids returned");

  const detailRes = await fetch(`${GW2_API}/legends?ids=${ids.join(",")}`);
  if (!detailRes.ok) throw new Error(`gw2 api legends detail ${detailRes.status}`);
  const legends = await detailRes.json();

  // Match the existing schema exactly: id, swap, heal, elite, utilities.
  const normalized = legends
    .map((l) => ({ id: l.id, swap: l.swap, heal: l.heal, elite: l.elite, utilities: l.utilities }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const prev = JSON.parse(await readFile(TARGET, "utf8"));
  const prevById = new Map(prev.map((l) => [l.id, l]));
  const changed = normalized.filter((l) => JSON.stringify(l) !== JSON.stringify(prevById.get(l.id)));

  // legends.json is stored as compact single-line JSON; preserve that to avoid
  // noisy diffs.
  await writeFile(TARGET, JSON.stringify(normalized) + "\n");
  console.log(`✓ wrote ${normalized.length} legends`);
  if (changed.length) console.log(`  ~ changed: ${changed.map((l) => l.id).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
