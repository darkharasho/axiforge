#!/usr/bin/env node
// Sync src/main/gw2Data/{professions,specializations}.json from the GW2 API.
// These are static snapshots that change only with expansions / elite spec
// releases, so we keep them on disk rather than fetching at runtime.
//
// Usage:
//   node scripts/sync-profession-data.mjs                       # both
//   node scripts/sync-profession-data.mjs professions           # only one
//   node scripts/sync-profession-data.mjs specializations       # only one

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Order matches the GW2 API response order (canonical in-game order for
// professions, numeric id order for specializations) — we deliberately don't
// re-sort so future diffs only show real content changes.
const TARGETS = {
  professions: {
    file: path.resolve(__dirname, "../src/main/gw2Data/professions.json"),
    listEndpoint: "https://api.guildwars2.com/v2/professions",
    detailEndpoint: (ids) => `https://api.guildwars2.com/v2/professions?ids=${ids.join(",")}`,
  },
  specializations: {
    file: path.resolve(__dirname, "../src/main/gw2Data/specializations.json"),
    listEndpoint: "https://api.guildwars2.com/v2/specializations",
    detailEndpoint: (ids) => `https://api.guildwars2.com/v2/specializations?ids=${ids.join(",")}`,
  },
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "axiforge-sync" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function syncOne(name, cfg) {
  const ids = await fetchJson(cfg.listEndpoint);
  if (!Array.isArray(ids) || !ids.length) throw new Error(`no ${name} ids`);

  // /v2 endpoints accept up to 200 ids; batch. Single-batch detail requests
  // preserve the response order GW2's API returns, which already matches the
  // existing on-disk ordering — no client-side sort needed.
  const items = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    items.push(...await fetchJson(cfg.detailEndpoint(batch)));
  }

  const prev = await readFile(cfg.file, "utf8").catch(() => "");
  const next = JSON.stringify(items) + "\n";
  if (next === prev) {
    console.log(`✓ ${name}: already up to date (${items.length} entries)`);
    return;
  }
  await writeFile(cfg.file, next);
  console.log(`✓ ${name}: wrote ${items.length} entries (${(next.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  const requested = process.argv.slice(2);
  const targets = requested.length ? requested : Object.keys(TARGETS);
  for (const t of targets) {
    if (!TARGETS[t]) {
      console.error(`unknown target: ${t}. valid: ${Object.keys(TARGETS).join(", ")}`);
      process.exit(2);
    }
  }
  for (const t of targets) await syncOne(t, TARGETS[t]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
