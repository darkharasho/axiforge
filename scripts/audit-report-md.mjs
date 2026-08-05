#!/usr/bin/env node
// audit-report-md.mjs — turn wiki-audit result JSON into a Markdown summary.
//
// Used by the data-drift-audit workflow to build a human-readable PR body from
// the newest report(s) in tests/wiki-audit/results/. Picks, per entity type,
// the most recent report that actually checked that type (so running
// `audit:wiki:relics` then `audit:wiki:signets` yields one combined summary).
//
// Usage:
//   node scripts/audit-report-md.mjs                 # newest report per type
//   node scripts/audit-report-md.mjs path/to/a.json  # explicit file(s)

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.resolve(__dirname, "../tests/wiki-audit/results");

const TYPES = [
  { key: "skills", checked: "skills_checked", label: "Skills" },
  { key: "traits", checked: "traits_checked", label: "Traits" },
  { key: "relics", checked: "relics_checked", label: "Relics" },
  { key: "signets", checked: "signets_checked", label: "Signets" },
];

async function loadReports(explicitFiles) {
  const files = explicitFiles.length
    ? explicitFiles
    : (await readdir(RESULTS_DIR))
        .filter((f) => f.endsWith("-audit.json"))
        .map((f) => path.join(RESULTS_DIR, f));

  const reports = [];
  for (const f of files) {
    try {
      reports.push({ file: f, data: JSON.parse(await readFile(f, "utf8")) });
    } catch {
      // skip unreadable/legacy files
    }
  }
  // newest first by timestamp in the report body (falls back to filename order)
  reports.sort((a, b) => String(b.data.timestamp).localeCompare(String(a.data.timestamp)));
  return reports;
}

function pickPerType(reports) {
  const chosen = new Map();
  for (const t of TYPES) {
    const hit = reports.find((r) => (r.data.summary?.[t.checked] || 0) > 0);
    if (hit) chosen.set(t.key, hit);
  }
  return chosen;
}

function fmtFact(f) {
  const bits = [f.type, f.text].filter(Boolean).join(" · ");
  const vals = ["value", "duration", "percent", "distance", "apply_count", "dmg_multiplier"]
    .filter((k) => f[k] !== undefined)
    .map((k) => `${k}=${f[k]}`)
    .join(", ");
  return vals ? `${bits} (${vals})` : bits;
}

function fmtDiff(d) {
  const lines = [`- **${d.name}** (${d.entity_type} #${d.id}) — [wiki](${d.wiki_url})`];
  for (const fd of d.fact_diffs || []) {
    for (const [key, v] of Object.entries(fd.fields)) {
      lines.push(`  - \`${fd.text || fd.type}\` ${key}: wiki \`${v.wiki}\` vs stored \`${v.splits}\``);
    }
  }
  for (const f of d.wiki_only_facts || []) lines.push(`  - wiki-only: ${fmtFact(f)}`);
  for (const f of d.splits_only_facts || []) lines.push(`  - stored-only: ${fmtFact(f)}`);
  return lines.join("\n");
}

async function main() {
  const explicit = process.argv.slice(2);
  const reports = await loadReports(explicit);
  if (!reports.length) {
    console.log("_No audit reports found._");
    return;
  }

  const chosen = pickPerType(reports);
  const out = [];
  out.push("## Wiki drift audit");
  out.push("");

  // Aggregate totals across the chosen per-type reports (dedupe by file).
  const seen = new Set();
  let totalMismatch = 0;
  let totalMissing = 0;
  let totalErrors = 0;
  const tableRows = [];
  const allDiscrepancies = [];

  const blockedTypes = [];
  for (const t of TYPES) {
    const r = chosen.get(t.key);
    if (!r) continue;
    const s = r.data.summary;
    // A blocked crawl (wiki served empty pages to the runner IP) makes every
    // fact-bearing entry look like drift. Mark it inconclusive and don't count
    // its phantom mismatches toward the flagged total.
    const blocked = !!r.data.crawl_blocked;
    tableRows.push(
      `| ${t.label} | ${s[t.checked]} | ${s.matches} | ${s.mismatches} | ${s.missing_from_splits} | ${s.no_split} | ${s.errors} |` +
        (blocked ? " ⚠️ crawl blocked — inconclusive" : "")
    );
    if (!seen.has(r.file)) {
      seen.add(r.file);
      if (blocked) {
        if (!blockedTypes.includes(t.label)) blockedTypes.push(t.label);
        continue; // skip phantom mismatches/discrepancies from a blocked crawl
      }
      totalMismatch += s.mismatches || 0;
      totalMissing += s.missing_from_splits || 0;
      totalErrors += s.errors || 0;
      for (const d of r.data.discrepancies || []) {
        if (d.entity_type + "s" === t.key || d.entity_type === t.key.slice(0, -1)) {
          allDiscrepancies.push(d);
        }
      }
    }
  }

  if (tableRows.length) {
    out.push("| Type | Checked | Match | Mismatch | New (wiki-only) | Skipped | Errors |");
    out.push("| --- | --- | --- | --- | --- | --- | --- |");
    out.push(...tableRows);
    out.push("");
    out.push("_Skipped = not reliably machine-checkable (e.g. hand-curated signet passives the wiki renders in an incomparable shape)._");
    out.push("");
  }

  if (blockedTypes.length) {
    out.push(
      `> ⚠️ **Wiki crawl blocked** for ${blockedTypes.join(", ")} — the wiki served the runner IP empty pages, so those types are **inconclusive** this run (not counted below). Re-run the audit from a non-blocked IP.`
    );
    out.push("");
  }

  const flagged = totalMismatch + totalMissing;
  if (flagged === 0 && totalErrors === 0) {
    out.push(
      blockedTypes.length
        ? "✅ No drift detected in the types that crawled successfully."
        : "✅ No drift detected — committed snapshots match the wiki."
    );
  } else {
    out.push(
      `⚠️ **${flagged}** entit${flagged === 1 ? "y" : "ies"} flagged for review` +
        (totalErrors ? ` (+${totalErrors} crawl errors)` : "") +
        "."
    );
  }

  if (allDiscrepancies.length) {
    out.push("");
    out.push("<details><summary>Flagged entities</summary>");
    out.push("");
    for (const d of allDiscrepancies.slice(0, 100)) out.push(fmtDiff(d));
    if (allDiscrepancies.length > 100) {
      out.push(`\n_…and ${allDiscrepancies.length - 100} more. See the full report artifact._`);
    }
    out.push("");
    out.push("</details>");
  }

  console.log(out.join("\n"));
}

main().catch((err) => {
  console.error("audit-report-md failed:", err);
  process.exit(1);
});
