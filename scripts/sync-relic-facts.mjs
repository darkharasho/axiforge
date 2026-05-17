#!/usr/bin/env node
// Sync src/main/gw2Data/relicFacts.json by scraping the GW2 wiki.
// For each relic in RELIC_ITEM_IDS, fetches the wiki page, extracts the
// blockquote fact rows + recharge from the statistics box, and rewrites
// the JSON file in-place.
//
// Usage:
//   node scripts/sync-relic-facts.mjs            # sync all relics
//   node scripts/sync-relic-facts.mjs --limit 5  # smoke test, first 5 only
//   node scripts/sync-relic-facts.mjs --id 100048 --id 99997  # specific IDs
//
// Reuses tests/wiki-audit/crawl-relic.js + parse-facts.js for the DOM
// extraction and structured-fact parsing — those modules already encode
// the wiki page conventions we depend on.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { crawlEntity } = require("../tests/wiki-audit/crawl-relic.js");
const { parseFactText } = require("../tests/wiki-audit/parse-facts.js");
const { RELIC_ITEM_IDS } = require("../src/main/gw2Data/upgradeIds.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(__dirname, "../src/main/gw2Data/relicFacts.json");
const OVERRIDES = path.resolve(__dirname, "../src/main/gw2Data/relicFactsOverrides.json");
const GW2_API = "https://api.guildwars2.com/v2";

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = Infinity;
  const ids = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) { limit = parseInt(args[++i], 10); }
    else if (args[i] === "--id" && args[i + 1]) { ids.push(parseInt(args[++i], 10)); }
  }
  return { limit, ids };
}

async function fetchRelicMeta(ids) {
  // GW2 /v2/items batches up to 200 per request.
  const out = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const url = `${GW2_API}/items?ids=${batch.join(",")}&lang=en`;
    const res = await fetch(url, { headers: { "User-Agent": "axiforge-sync" } });
    if (!res.ok) throw new Error(`gw2 api ${res.status}`);
    const items = await res.json();
    for (const it of items) out.set(it.id, { id: it.id, name: it.name });
  }
  return out;
}

function structureFacts(rawFacts) {
  // crawl-relic.js returns [{ name, valueText }, ...]
  // Convert each via parseFactText; drop unparseable rows.
  const out = [];
  for (const { name, valueText } of rawFacts) {
    const fact = parseFactText(name, valueText);
    if (fact) out.push(fact);
  }
  return out;
}

async function crawlAll(relics) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "axiforge-sync" });
  const page = await ctx.newPage();

  const results = new Map();
  const errors = [];
  let i = 0;
  for (const meta of relics) {
    i++;
    process.stdout.write(`  [${i}/${relics.length}] ${meta.name}… `);
    const crawl = await crawlEntity(page, meta, "relics");
    if (crawl?.error) {
      process.stdout.write(`error: ${crawl.error}\n`);
      errors.push({ id: meta.id, name: meta.name, error: crawl.error });
      continue;
    }
    const facts = structureFacts(crawl.facts || []);
    results.set(meta.id, { name: meta.name, facts });
    process.stdout.write(`${facts.length} facts\n`);
  }

  await browser.close();
  return { results, errors };
}

function diffSummary(prevRelics, nextResults) {
  const changed = [];
  const added = [];
  for (const [id, next] of nextResults) {
    const prev = prevRelics[String(id)];
    if (!prev) { added.push(id); continue; }
    if (JSON.stringify(prev.facts) !== JSON.stringify(next.facts)) changed.push(id);
  }
  return { changed, added };
}

async function main() {
  const { limit, ids: requestedIds } = parseArgs();
  const targetIds = (requestedIds.length ? requestedIds : RELIC_ITEM_IDS).slice(0, limit);

  console.log(`Fetching metadata for ${targetIds.length} relic(s) from GW2 API…`);
  const meta = await fetchRelicMeta(targetIds);
  const relics = targetIds.map((id) => meta.get(id)).filter(Boolean);
  if (relics.length !== targetIds.length) {
    console.warn(`  warning: ${targetIds.length - relics.length} id(s) not returned by GW2 API`);
  }

  console.log(`Crawling ${relics.length} wiki pages…`);
  const { results, errors } = await crawlAll(relics);

  console.log(`Merging results into ${path.relative(process.cwd(), TARGET)}…`);
  const prev = JSON.parse(await readFile(TARGET, "utf8"));
  const prevRelics = prev.relics || {};

  // Apply manual overrides last — for relics whose wiki pages omit or
  // mislabel facts the game actually has.
  const overrides = JSON.parse(await readFile(OVERRIDES, "utf8"));
  let overrideCount = 0;
  for (const [id, entry] of Object.entries(overrides)) {
    if (id.startsWith("_")) continue;
    if (!results.has(Number(id))) continue; // only override relics we crawled
    results.set(Number(id), { name: entry.name, facts: entry.facts });
    overrideCount++;
  }

  const { changed, added } = diffSummary(prevRelics, results);

  // Preserve any existing relics not in the target set (so --limit / --id runs
  // are non-destructive).
  const nextRelics = { ...prevRelics };
  for (const [id, entry] of results) nextRelics[String(id)] = entry;

  // Stable id-sorted output for clean diffs.
  const sortedKeys = Object.keys(nextRelics).sort((a, b) => Number(a) - Number(b));
  const sortedRelics = Object.fromEntries(sortedKeys.map((k) => [k, nextRelics[k]]));

  const next = { updatedAt: new Date().toISOString(), relics: sortedRelics };
  await writeFile(TARGET, JSON.stringify(next, null, 2) + "\n");

  console.log(`Done.`);
  console.log(`  added: ${added.length}, changed: ${changed.length}, overrides: ${overrideCount}, errors: ${errors.length}`);
  if (added.length) console.log(`  + ${added.join(", ")}`);
  if (changed.length) console.log(`  ~ ${changed.join(", ")}`);
  if (errors.length) {
    console.log(`  ! errors:`);
    for (const e of errors) console.log(`    ${e.id} ${e.name}: ${e.error}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
