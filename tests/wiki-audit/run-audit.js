#!/usr/bin/env node
/**
 * run-audit.js — Main entry point for the wiki audit tool.
 *
 * Usage:
 *   npm run audit:wiki
 *   npm run audit:wiki -- --skip 100
 *   npm run audit:wiki -- --limit 10
 *   npm run audit:wiki -- --skip 100 --limit 50
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs/promises");
const { crawlEntity } = require("./crawl");
const { compareEntity } = require("./compare");
const { parseFactText } = require("./parse-facts");
const { writeReport } = require("./report");

const GW2_API = "https://api.guildwars2.com/v2";
const SPLITS_PATH = path.join(__dirname, "../../lib/gw2-balance-splits/data/splits.json");

// ── CLI args ──

function parseArgs() {
  const args = process.argv.slice(2);
  let skip = 0, limit = Infinity;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skip" && args[i + 1]) skip = parseInt(args[i + 1], 10);
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[i + 1], 10);
  }
  return { skip, limit };
}

// ── Progress bar (matches seed.js style) ──

function progressBar(current, total, width = 30) {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(width * pct);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
  const pctStr = (pct * 100).toFixed(1).padStart(5);
  return `  ${bar} ${pctStr}% (${current}/${total})`;
}

// ── GW2 API fetching ──

async function fetchAllIds(endpoint) {
  const res = await fetch(`${GW2_API}/${endpoint}`);
  if (!res.ok) throw new Error(`GW2 API ${endpoint}: HTTP ${res.status}`);
  return res.json();
}

async function fetchByIds(endpoint, ids) {
  const results = [];
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const res = await fetch(`${GW2_API}/${endpoint}?ids=${chunk.join(",")}`);
    if (!res.ok) throw new Error(`GW2 API ${endpoint}?ids=...: HTTP ${res.status}`);
    const data = await res.json();
    results.push(...data);
  }
  return results;
}

// ── Main ──

async function main() {
  const { skip, limit } = parseArgs();
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`Wiki Audit — ${timestamp}`);

  // 1. Fetch entity list
  process.stdout.write("Fetching skills from GW2 API... ");
  const skillIds = await fetchAllIds("skills");
  const skills = await fetchByIds("skills", skillIds);
  const skillEntities = skills.map((s) => ({
    id: s.id, name: s.name, professions: s.professions || [], type: "skill",
  }));
  console.log(`${skillEntities.length} skills`);

  process.stdout.write("Fetching traits from GW2 API... ");
  const traitIds = await fetchAllIds("traits");
  const traits = await fetchByIds("traits", traitIds);
  const traitEntities = traits.map((t) => ({
    id: t.id, name: t.name, professions: [], specialization: t.specialization, type: "trait",
  }));
  console.log(`${traitEntities.length} traits`);

  // 2. Load splits.json
  const splitsRaw = JSON.parse(await fs.readFile(SPLITS_PATH, "utf-8"));
  const splitsIndex = {
    skill: splitsRaw.skills || {},
    trait: splitsRaw.traits || {},
  };
  const skillSplitCount = Object.keys(splitsIndex.skill).length;
  const traitSplitCount = Object.keys(splitsIndex.trait).length;
  console.log(`Loaded splits.json (${skillSplitCount} skills, ${traitSplitCount} traits)`);

  // 3. Build entity list with skip/limit
  const allEntities = [...skillEntities, ...traitEntities];
  const entities = allEntities.slice(skip, skip + limit);
  console.log(`Crawling ${entities.length} entities (skip=${skip}, limit=${limit === Infinity ? "all" : limit})\n`);

  // 4. Launch browser
  console.log("Launching browser...\n");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 5. Crawl and compare
  const summary = {
    skills_checked: 0, traits_checked: 0, total_checked: 0,
    matches: 0, mismatches: 0, missing_from_splits: 0,
    missing_from_wiki: 0, no_split: 0, errors: 0,
  };
  const discrepancies = [];
  const errors = [];

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const entityType = entity.type;

    // Progress
    process.stdout.write(`\r  Crawling: ${progressBar(i + 1, entities.length)}`);

    // Crawl
    const crawlResult = await crawlEntity(page, entity, entityType);

    if (entityType === "skill") summary.skills_checked++;
    else summary.traits_checked++;
    summary.total_checked++;

    // Handle errors
    if (crawlResult.error) {
      summary.errors++;
      errors.push({
        entity_type: entityType, id: entity.id, name: entity.name,
        error: crawlResult.error,
      });
      continue;
    }

    // Parse raw facts through parseFactText
    const wikiFacts = crawlResult.wvwFacts
      .map((f) => parseFactText(f.name, f.valueText))
      .filter(Boolean);

    // Look up splits.json entry
    const splitEntry = splitsIndex[entityType]?.[String(entity.id)]?.modes?.wvw || null;

    // Compare
    const cmp = compareEntity(wikiFacts, splitEntry, { hasToggle: crawlResult.hasToggle });

    switch (cmp.category) {
      case "match": summary.matches++; break;
      case "mismatch": summary.mismatches++; break;
      case "missing_from_splits": summary.missing_from_splits++; break;
      case "missing_from_wiki": summary.missing_from_wiki++; break;
      case "no_split": summary.no_split++; break;
    }

    // Record discrepancies (skip matches and no_split)
    if (cmp.category !== "match" && cmp.category !== "no_split") {
      const record = {
        entity_type: entityType,
        id: entity.id,
        name: entity.name,
        wiki_url: crawlResult.wiki_url || `https://wiki.guildwars2.com/wiki/${entity.name.replace(/ /g, "_")}`,
        category: cmp.category,
      };
      if (cmp.fact_diffs.length) record.fact_diffs = cmp.fact_diffs;
      if (cmp.wiki_only_facts.length) record.wiki_only_facts = cmp.wiki_only_facts;
      if (cmp.splits_only_facts.length) record.splits_only_facts = cmp.splits_only_facts;
      if (cmp.category === "missing_from_splits") record.wiki_facts = wikiFacts;
      discrepancies.push(record);
    }
  }

  console.log("\n");

  // 6. Close browser
  await browser.close();

  // 7. Write report
  const report = {
    timestamp,
    duration_ms: Date.now() - startTime,
    summary,
    discrepancies,
    errors,
  };

  const reportPath = await writeReport(report);

  // 8. Print summary
  console.log("── Summary ──");
  console.log(`  Checked:             ${summary.total_checked}`);
  console.log(`  Matches:             ${summary.matches}`);
  console.log(`  Mismatches:          ${summary.mismatches}`);
  console.log(`  Missing from splits: ${summary.missing_from_splits}`);
  console.log(`  Missing from wiki:   ${summary.missing_from_wiki}`);
  console.log(`  No split:            ${summary.no_split}`);
  console.log(`  Errors:              ${summary.errors}`);
  console.log("");
  console.log(`Report written to ${reportPath}`);
  console.log(`Open tests/wiki-audit/results/viewer.html to review.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
