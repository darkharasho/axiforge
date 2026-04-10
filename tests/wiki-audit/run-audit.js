#!/usr/bin/env node
/**
 * run-audit.js — Main entry point for the wiki audit tool.
 *
 * Usage:
 *   npm run audit:wiki
 *   npm run audit:wiki -- --skip 100
 *   npm run audit:wiki -- --limit 10
 *   npm run audit:wiki -- --workers 6
 *   npm run audit:wiki -- --skip 100 --limit 50 --workers 4
 */

const { chromium } = require("playwright");
const path = require("path");
const { crawlEntity } = require("./crawl");
const { crawlEntity: crawlRelic } = require("./crawl-relic");
const { crawlEntity: crawlSignet } = require("./crawl-signet");
const { compareEntity, compareRelicFacts } = require("./compare");
const { parseFactText } = require("./parse-facts");
const { IncrementalReport, writeReport } = require("./report");
const { StatusDisplay } = require("./status-display");

const GW2_API = "https://api.guildwars2.com/v2";
// Balance splits data has been removed (Phase 4); splitsIndex is now always empty.
const DEFAULT_WORKERS = 4;

// ── CLI args ──

function parseArgs() {
  const args = process.argv.slice(2);
  let skip = 0, limit = Infinity, workers = DEFAULT_WORKERS;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skip" && args[i + 1]) skip = parseInt(args[i + 1], 10);
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[i + 1], 10);
    if (args[i] === "--workers" && args[i + 1]) workers = parseInt(args[i + 1], 10);
  }
  const typeArg = args.find(a => a.startsWith("--type"));
  const typeVal = typeArg ? (typeArg.includes("=") ? typeArg.split("=")[1] : args[args.indexOf(typeArg) + 1]) : null;
  const VALID_TYPES = new Set(["skills", "traits", "relics", "signets"]);
  if (typeVal && !VALID_TYPES.has(typeVal)) {
    console.error(`Invalid --type: ${typeVal}. Must be one of: skills, traits, relics`);
    process.exit(1);
  }
  return { skip, limit, workers: Math.max(1, Math.min(workers, 10)), typeVal };
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

// ── Worker pool ──

/**
 * Process entities across N browser contexts in parallel.
 * Each worker gets its own browser context + page, pulls entities
 * from a shared queue, and pushes results to shared arrays.
 */
async function crawlWithWorkers(browser, entities, splitsIndex, relicFactsData, signetPassivesData, workerCount, incremental, display) {
  const summary = {
    skills_checked: 0, traits_checked: 0, relics_checked: 0, signets_checked: 0, total_checked: 0,
    matches: 0, mismatches: 0, missing_from_splits: 0,
    missing_from_wiki: 0, no_split: 0, errors: 0,
  };
  const discrepancies = [];
  const errors = [];

  let nextIndex = 0;       // shared cursor into entities array
  const total = entities.length;

  async function worker(workerId) {
    const context = await browser.newContext();
    const page = await context.newPage();

    while (true) {
      // Atomically grab the next entity
      const idx = nextIndex++;
      if (idx >= total) break;

      const entity = entities[idx];
      const entityType = entity.type;

      // Update display with what this worker is checking
      display.setWorker(workerId, `${entity.name} (${entityType} #${entity.id})`);

      // Crawl
      const crawlResult = entityType === "relic"
        ? await crawlRelic(page, entity, entityType)
        : entityType === "signet"
        ? await crawlSignet(page, entity, entityType)
        : await crawlEntity(page, entity, entityType);

      // Process result (synchronized via single-threaded JS)
      if (entityType === "skill") summary.skills_checked++;
      else if (entityType === "trait") summary.traits_checked++;
      else if (entityType === "relic") summary.relics_checked++;
      else if (entityType === "signet") summary.signets_checked++;
      summary.total_checked++;

      if (crawlResult.error) {
        summary.errors++;
        const errRecord = {
          entity_type: entityType, id: entity.id, name: entity.name,
          error: crawlResult.error,
        };
        errors.push(errRecord);
        incremental.writeError(errRecord);
        display.addCompleted("errors");
        display.addRecent("!", "\x1b[90m", "ERROR", `${entity.name} — ${crawlResult.error.slice(0, 50)}`);
      } else if (entityType === "relic") {
        const storedEntry = relicFactsData.relics[String(entity.id)];
        const wikiFacts = crawlResult.facts
          .map((f) => parseFactText(f.name, f.valueText, f.titleAttr))
          .filter(Boolean);
        const cmp = compareRelicFacts(wikiFacts, storedEntry?.facts || null);

        switch (cmp.category) {
          case "match": summary.matches++; break;
          case "mismatch": summary.mismatches++; break;
          case "missing_from_splits": summary.missing_from_splits++; break;
          case "no_split": summary.no_split++; break;
        }

        display.addCompleted(cmp.category === "match" ? "matches"
          : cmp.category === "no_split" ? "no_split"
          : cmp.category === "mismatch" ? "mismatches"
          : cmp.category === "missing_from_splits" ? "missing_from_splits"
          : "errors");

        if (cmp.category !== "match" && cmp.category !== "no_split") {
          const record = {
            entity_type: entityType,
            id: entity.id,
            name: entity.name,
            wiki_url: crawlResult.wiki_url || `https://wiki.guildwars2.com/wiki/${entity.name.replace(/ /g, "_")}`,
            category: cmp.category,
            wiki_wvw_facts: wikiFacts,
            splits_wvw_facts: storedEntry?.facts || [],
          };
          if (cmp.fact_diffs.length) record.fact_diffs = cmp.fact_diffs;
          if (cmp.wiki_only_facts.length) record.wiki_only_facts = cmp.wiki_only_facts;
          if (cmp.splits_only_facts.length) record.splits_only_facts = cmp.splits_only_facts;
          discrepancies.push(record);
          incremental.writeDiscrepancy(record);
          const tag = `${entity.name} (${entityType} #${entity.id})`;
          if (cmp.category === "mismatch") {
            display.addRecent("\u2717", "\x1b[31m", "MISMATCH", tag);
          } else if (cmp.category === "missing_from_splits") {
            display.addRecent("\u25cc", "\x1b[33m", "MISSING(S)", tag);
          }
        }
      } else if (entityType === "signet") {
        const storedEntry = signetPassivesData.signets[String(entity.id)];
        const wikiFacts = crawlResult.facts
          .map((f) => parseFactText(f.name, f.valueText, f.titleAttr))
          .filter(Boolean);
        const cmp = compareRelicFacts(wikiFacts, storedEntry?.facts || null);

        switch (cmp.category) {
          case "match": summary.matches++; break;
          case "mismatch": summary.mismatches++; break;
          case "missing_from_splits": summary.missing_from_splits++; break;
          case "no_split": summary.no_split++; break;
        }

        display.addCompleted(cmp.category === "match" ? "matches"
          : cmp.category === "no_split" ? "no_split"
          : cmp.category === "mismatch" ? "mismatches"
          : cmp.category === "missing_from_splits" ? "missing_from_splits"
          : "errors");

        if (cmp.category !== "match" && cmp.category !== "no_split") {
          const record = {
            entity_type: entityType,
            id: entity.id,
            name: entity.name,
            wiki_url: crawlResult.wiki_url || `https://wiki.guildwars2.com/wiki/${entity.name.replace(/ /g, "_")}`,
            category: cmp.category,
            wiki_wvw_facts: wikiFacts,
            splits_wvw_facts: storedEntry?.facts || [],
          };
          if (cmp.fact_diffs.length) record.fact_diffs = cmp.fact_diffs;
          if (cmp.wiki_only_facts.length) record.wiki_only_facts = cmp.wiki_only_facts;
          if (cmp.splits_only_facts.length) record.splits_only_facts = cmp.splits_only_facts;
          discrepancies.push(record);
          incremental.writeDiscrepancy(record);
          const tag = `${entity.name} (${entityType} #${entity.id})`;
          if (cmp.category === "mismatch") {
            display.addRecent("\u2717", "\x1b[31m", "MISMATCH", tag);
          } else if (cmp.category === "missing_from_splits") {
            display.addRecent("\u25cc", "\x1b[33m", "MISSING(S)", tag);
          }
        }
      } else {
        // Existing skill/trait comparison path
        const wikiFacts = crawlResult.wvwFacts
          .map((f) => parseFactText(f.name, f.valueText, f.titleAttr))
          .filter(Boolean);

        const splitEntry = splitsIndex[entityType]?.[String(entity.id)]?.modes?.wvw || null;
        const cmp = compareEntity(wikiFacts, splitEntry, { hasToggle: crawlResult.hasToggle });

        switch (cmp.category) {
          case "match": summary.matches++; break;
          case "mismatch": summary.mismatches++; break;
          case "missing_from_splits": summary.missing_from_splits++; break;
          case "missing_from_wiki": summary.missing_from_wiki++; break;
          case "no_split": summary.no_split++; break;
        }

        display.addCompleted(cmp.category === "match" ? "matches"
          : cmp.category === "no_split" ? "no_split"
          : cmp.category === "mismatch" ? "mismatches"
          : cmp.category === "missing_from_splits" ? "missing_from_splits"
          : cmp.category === "missing_from_wiki" ? "missing_from_wiki"
          : "errors");

        if (cmp.category !== "match" && cmp.category !== "no_split") {
          const record = {
            entity_type: entityType,
            id: entity.id,
            name: entity.name,
            wiki_url: crawlResult.wiki_url || `https://wiki.guildwars2.com/wiki/${entity.name.replace(/ /g, "_")}`,
            category: cmp.category,
          };
          // Include raw fact arrays for side-by-side diff in viewer
          record.wiki_wvw_facts = wikiFacts;
          record.splits_wvw_facts = splitEntry?.facts || [];
          if (cmp.fact_diffs.length) record.fact_diffs = cmp.fact_diffs;
          if (cmp.wiki_only_facts.length) record.wiki_only_facts = cmp.wiki_only_facts;
          if (cmp.splits_only_facts.length) record.splits_only_facts = cmp.splits_only_facts;
          discrepancies.push(record);
          incremental.writeDiscrepancy(record);

          // Add to recent findings display
          const tag = entity.name + ` (${entityType} #${entity.id})`;
          if (cmp.category === "mismatch") {
            display.addRecent("\u2717", "\x1b[31m", "MISMATCH", tag);
          } else if (cmp.category === "missing_from_splits") {
            display.addRecent("\u25cc", "\x1b[33m", "MISSING(S)", tag);
          } else if (cmp.category === "missing_from_wiki") {
            display.addRecent("\u25cc", "\x1b[33m", "MISSING(W)", tag);
          }
        }
      }
    }

    display.setWorker(workerId, "done");
    await context.close();
  }

  // Launch all workers concurrently
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker(i));
  }
  await Promise.all(workers);

  return { summary, discrepancies, errors };
}

// ── Main ──

async function main() {
  const { skip, limit, workers, typeVal } = parseArgs();
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`Wiki Audit — ${timestamp}`);

  // 1. Fetch entity list
  let skillEntities = [];
  if (!typeVal || typeVal === "skills") {
    process.stdout.write("Fetching skills from GW2 API... ");
    const skillIds = await fetchAllIds("skills");
    const skills = await fetchByIds("skills", skillIds);
    skillEntities = skills.map((s) => ({
      id: s.id, name: s.name, professions: s.professions || [], type: "skill",
    }));
    console.log(`${skillEntities.length} skills`);
  }

  let traitEntities = [];
  if (!typeVal || typeVal === "traits") {
    process.stdout.write("Fetching traits from GW2 API... ");
    const traitIds = await fetchAllIds("traits");
    const traits = await fetchByIds("traits", traitIds);
    traitEntities = traits.map((t) => ({
      id: t.id, name: t.name, professions: [], specialization: t.specialization, type: "trait",
    }));
    console.log(`${traitEntities.length} traits`);
  }

  let relicEntities = [];
  if (!typeVal || typeVal === "relics") {
    const { RELIC_ITEM_IDS } = require("../../src/main/gw2Data/upgradeIds");
    const relicItems = await fetchByIds("items", RELIC_ITEM_IDS);
    relicEntities = relicItems.map(item => ({
      id: item.id,
      name: item.name,
      type: "relic",
    }));
    console.log(`${relicEntities.length} relics`);
  }

  let signetEntities = [];
  if (!typeVal || typeVal === "signets") {
    const signetPassivesData = require("../../src/main/gw2Data/signetPassives.json");
    signetEntities = Object.entries(signetPassivesData.signets).map(([id, data]) => ({
      id: parseInt(id, 10),
      name: data.name,
      type: "signet",
    }));
    console.log(`${signetEntities.length} signet passives`);
  }

  // 2. Splits data removed (Phase 4) — empty index for backward compat
  const splitsIndex = { skill: {}, trait: {} };

  // 2b. Load relicFacts.json
  const relicFactsData = require("../../src/main/gw2Data/relicFacts.json");

  // 2c. Load signetPassives.json
  const signetPassivesData = require("../../src/main/gw2Data/signetPassives.json");

  // 3. Build entity list with skip/limit
  const allEntities = [...skillEntities, ...traitEntities, ...relicEntities, ...signetEntities];
  const entities = allEntities.slice(skip, skip + limit);
  console.log(`Crawling ${entities.length} entities (skip=${skip}, limit=${limit === Infinity ? "all" : limit}, workers=${workers})\n`);

  // 4. Launch browser, incremental writer, and status display
  const browser = await chromium.launch({ headless: true });
  const incremental = new IncrementalReport(timestamp);
  incremental.open();

  const display = new StatusDisplay(workers, entities.length);
  display.start();

  // 5. Crawl and compare with worker pool
  const { summary, discrepancies, errors } = await crawlWithWorkers(browser, entities, splitsIndex, relicFactsData, signetPassivesData, workers, incremental, display);

  display.stop();
  console.log("");

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

  const reportPath = await writeReport(report, incremental);

  // 8. Print summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("── Summary ──");
  console.log(`  Checked:             ${summary.total_checked} (${summary.skills_checked} skills, ${summary.traits_checked} traits, ${summary.relics_checked} relics, ${summary.signets_checked} signets)`);
  console.log(`  Matches:             ${summary.matches}`);
  console.log(`  Mismatches:          ${summary.mismatches}`);
  console.log(`  Missing from splits: ${summary.missing_from_splits}`);
  console.log(`  Missing from wiki:   ${summary.missing_from_wiki}`);
  console.log(`  No split:            ${summary.no_split}`);
  console.log(`  Errors:              ${summary.errors}`);
  console.log(`  Duration:            ${elapsed}s`);
  console.log("");
  console.log(`Report written to ${reportPath}`);
  console.log(`Open tests/wiki-audit/results/viewer.html to review.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
