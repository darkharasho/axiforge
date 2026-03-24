#!/usr/bin/env node
/**
 * fix-splits.js — Apply wiki audit findings to splits.json.
 *
 * Reads the latest audit report (or a specific one via --report) and patches
 * splits.json to match the wiki's WvW facts.
 *
 * Usage:
 *   npm run audit:wiki:fix                      # use latest report
 *   npm run audit:wiki:fix -- --report <file>   # use specific report
 *   npm run audit:wiki:fix -- --dry-run         # show changes without writing
 */

const fs = require("fs");
const path = require("path");

const SPLITS_PATH = path.join(__dirname, "../../lib/gw2-balance-splits/data/splits.json");
const RESULTS_DIR = path.join(__dirname, "results");

// ── ANSI helpers ──

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

// ── CLI args ──

function parseArgs() {
  const args = process.argv.slice(2);
  let reportPath = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--report" && args[i + 1]) reportPath = args[++i];
    if (args[i] === "--dry-run") dryRun = true;
  }
  return { reportPath, dryRun };
}

// ── Find latest report ──

function findLatestReport() {
  const files = fs.readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith("-audit.json"))
    .sort();
  if (files.length === 0) {
    console.error("No audit reports found in", RESULTS_DIR);
    process.exit(1);
  }
  return path.join(RESULTS_DIR, files[files.length - 1]);
}

// ── Main ──

function main() {
  const { reportPath, dryRun } = parseArgs();
  const report = reportPath || findLatestReport();

  console.log(`\n${BOLD}${CYAN}Wiki Audit → Fix Splits${RESET}\n`);
  console.log(`  Report:  ${DIM}${path.basename(report)}${RESET}`);
  console.log(`  Mode:    ${dryRun ? `${YELLOW}dry run${RESET}` : `${GREEN}write${RESET}`}\n`);

  const audit = JSON.parse(fs.readFileSync(report, "utf8"));
  const splits = JSON.parse(fs.readFileSync(SPLITS_PATH, "utf8"));

  const discrepancies = audit.discrepancies || [];
  if (discrepancies.length === 0) {
    console.log(`  ${GREEN}No discrepancies — splits.json is up to date.${RESET}\n`);
    return;
  }

  const stats = { updated: 0, added: 0, skipped: 0 };
  const changes = [];

  for (const d of discrepancies) {
    if (d.entity_type === "relic") {
      continue; // handled in relic loop below
    }
    const collection = d.entity_type === "trait" ? "traits" : "skills";
    const idStr = String(d.id);
    const wikiFacts = d.wiki_wvw_facts || [];

    if (d.category === "mismatch") {
      if (wikiFacts.length === 0) {
        // Wiki had no extractable facts — can't fix automatically
        stats.skipped++;
        changes.push({ action: "skip", name: d.name, id: d.id, reason: "no wiki facts to apply" });
        continue;
      }

      const entry = splits[collection][idStr];
      if (!entry || !entry.modes || !entry.modes.wvw) {
        stats.skipped++;
        changes.push({ action: "skip", name: d.name, id: d.id, reason: "splits entry structure unexpected" });
        continue;
      }

      // Replace WvW facts with wiki's version
      const oldFacts = entry.modes.wvw.facts;
      entry.modes.wvw.facts = wikiFacts;
      stats.updated++;
      changes.push({ action: "update", name: d.name, id: d.id, oldCount: oldFacts.length, newCount: wikiFacts.length });

    } else if (d.category === "missing_from_splits") {
      if (wikiFacts.length === 0) {
        stats.skipped++;
        changes.push({ action: "skip", name: d.name, id: d.id, reason: "no wiki facts to apply" });
        continue;
      }

      // Add new entry
      if (!splits[collection]) splits[collection] = {};
      splits[collection][idStr] = {
        name: d.name,
        modes: {
          wvw: {
            facts: wikiFacts,
            complete: true,
          },
        },
      };
      stats.added++;
      changes.push({ action: "add", name: d.name, id: d.id, factCount: wikiFacts.length });

    } else if (d.category === "missing_from_wiki") {
      // We have it in splits but wiki doesn't show a toggle — skip, don't remove
      stats.skipped++;
      changes.push({ action: "skip", name: d.name, id: d.id, reason: "missing from wiki (kept in splits)" });

    } else {
      stats.skipped++;
    }
  }

  // ── Relic patching ──
  const relicFactsPath = path.join(__dirname, "data/relicFacts.json");
  let relicFacts;
  try {
    relicFacts = JSON.parse(fs.readFileSync(relicFactsPath, "utf8"));
  } catch {
    relicFacts = { updatedAt: "", relics: {} };
  }

  let relicChanged = false;
  for (const d of discrepancies.filter(d => d.entity_type === "relic")) {
    const idStr = String(d.id);
    const wikiFacts = (d.wiki_wvw_facts || []).filter(f => f && f.type);

    if (d.category === "mismatch") {
      if (wikiFacts.length === 0) { stats.skipped++; continue; }
      relicFacts.relics[idStr] = relicFacts.relics[idStr] || { name: d.name, facts: [] };
      relicFacts.relics[idStr].facts = wikiFacts;
      relicChanged = true;
      stats.updated++;
    } else if (d.category === "missing_from_splits") {
      if (wikiFacts.length === 0) { stats.skipped++; continue; }
      relicFacts.relics[idStr] = { name: d.name, facts: wikiFacts };
      relicChanged = true;
      stats.added++;
    } else {
      stats.skipped++;
    }
  }

  if (relicChanged && !dryRun) {
    relicFacts.updatedAt = new Date().toISOString();
    fs.writeFileSync(relicFactsPath, JSON.stringify(relicFacts, null, 2) + "\n");
    console.log(`Wrote ${relicFactsPath}`);
  }

  // Print changes
  console.log(`${BOLD}  Changes:${RESET}\n`);

  for (const c of changes) {
    if (c.action === "update") {
      console.log(`  ${YELLOW}\u270e${RESET}  ${BOLD}${c.name}${RESET} ${DIM}(${c.id})${RESET} — updated ${c.oldCount} → ${c.newCount} facts`);
    } else if (c.action === "add") {
      console.log(`  ${GREEN}+${RESET}  ${BOLD}${c.name}${RESET} ${DIM}(${c.id})${RESET} — added ${c.factCount} facts`);
    } else if (c.action === "skip") {
      console.log(`  ${GRAY}\u2013${RESET}  ${DIM}${c.name} (${c.id}) — ${c.reason}${RESET}`);
    }
  }

  // Summary
  console.log(`\n${BOLD}  Summary:${RESET}`);
  console.log(`    ${GREEN}Updated:${RESET}  ${stats.updated}`);
  console.log(`    ${GREEN}Added:${RESET}    ${stats.added}`);
  console.log(`    ${GRAY}Skipped:${RESET}  ${stats.skipped}`);

  // Write
  if (!dryRun && (stats.updated > 0 || stats.added > 0)) {
    splits.updatedAt = new Date().toISOString();
    fs.writeFileSync(SPLITS_PATH, JSON.stringify(splits, null, 2) + "\n", "utf8");
    console.log(`\n  ${GREEN}\u2713 splits.json updated${RESET}\n`);
  } else if (dryRun) {
    console.log(`\n  ${YELLOW}Dry run — no changes written${RESET}\n`);
  } else {
    console.log(`\n  ${DIM}No changes to write${RESET}\n`);
  }
}

main();
