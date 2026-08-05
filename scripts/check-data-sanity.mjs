#!/usr/bin/env node
// check-data-sanity.mjs — guard against a broken/truncated data sync before it
// auto-merges. Compares the working-tree snapshots against the committed (HEAD)
// versions and fails (exit 3) if any list collapsed — the signature of a wiki
// layout change or a partial scrape. A clean result (exit 0) lets the data-drift
// workflow auto-merge; a failure routes the PR to human review instead.
//
// Usage: node scripts/check-data-sanity.mjs

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DROP_TOLERANCE = 0.2; // flag if a metric drops by more than 20%

// metric name -> fn(parsedJson) -> count
const CHECKS = {
  "src/main/gw2Data/relicFacts.json": {
    relics: (j) => Object.keys(j.relics || {}).length,
    // Facts total, not just relic count: an IP-blocked wiki crawl keeps every
    // relic key but blanks its facts to [], which the count metric can't see.
    relic_facts: (j) =>
      Object.values(j.relics || {}).reduce((n, r) => n + (r.facts?.length || 0), 0),
  },
  "src/main/gw2Data/upgradeIds.json": {
    RUNE_ITEM_IDS: (j) => (j.RUNE_ITEM_IDS || []).length,
    SIGIL_ITEM_IDS: (j) => (j.SIGIL_ITEM_IDS || []).length,
    RELIC_ITEM_IDS: (j) => (j.RELIC_ITEM_IDS || []).length,
    FOOD_ITEM_IDS: (j) => (j.FOOD_ITEM_IDS || []).length,
  },
};

function readHead(file) {
  try {
    return JSON.parse(execSync(`git show HEAD:${file}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }));
  } catch {
    return null; // new file (e.g. upgradeIds.json first run) — nothing to compare
  }
}

function readWorking(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

let anomalies = 0;
const rows = [];

for (const [file, metrics] of Object.entries(CHECKS)) {
  const head = readHead(file);
  const work = readWorking(file);
  if (!work) {
    rows.push(`  ${file}: MISSING in working tree`);
    anomalies++;
    continue;
  }
  for (const [name, count] of Object.entries(metrics)) {
    const now = count(work);
    const before = head ? count(head) : null;
    let verdict = "ok";
    if (now === 0) {
      verdict = "EMPTY";
      anomalies++;
    } else if (before != null && now < before * (1 - DROP_TOLERANCE)) {
      verdict = `DROP ${before}→${now} (>${DROP_TOLERANCE * 100}%)`;
      anomalies++;
    }
    const beforeStr = before == null ? "new" : String(before);
    rows.push(`  ${name}: ${beforeStr} → ${now}  [${verdict}]`);
  }
}

console.log("Data sanity check:");
console.log(rows.join("\n"));

if (anomalies > 0) {
  console.error(`\n✗ ${anomalies} anomaly(ies) — routing to human review.`);
  process.exit(3);
}
console.log("\n✓ Data looks sane.");
