/**
 * report.js — Incremental + final JSON audit report generation.
 *
 * During a crawl, results are appended to a .jsonl file (one JSON object
 * per line) so that a crash only loses in-flight pages. At the end, the
 * .jsonl is consolidated into the final .json report.
 */

const path = require("path");
const fs = require("fs");
const fsP = require("fs/promises");

const RESULTS_DIR = path.join(__dirname, "results");

/**
 * Manages incremental result writing during a crawl.
 * Each result (discrepancy or error) is appended as a JSON line immediately.
 */
class IncrementalReport {
  constructor(timestamp) {
    this.timestamp = timestamp;
    this.ts = timestamp.replace(/[:.]/g, "-");
    this.jsonlPath = path.join(RESULTS_DIR, `${this.ts}-audit.jsonl`);
    this.fd = null;
  }

  /** Open the .jsonl file for appending. */
  open() {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    this.fd = fs.openSync(this.jsonlPath, "w");
  }

  /** Append a discrepancy record. */
  writeDiscrepancy(record) {
    if (!this.fd) return;
    const line = JSON.stringify({ kind: "discrepancy", ...record }) + "\n";
    fs.writeSync(this.fd, line);
  }

  /** Append an error record. */
  writeError(record) {
    if (!this.fd) return;
    const line = JSON.stringify({ kind: "error", ...record }) + "\n";
    fs.writeSync(this.fd, line);
  }

  /** Close the .jsonl file. */
  close() {
    if (this.fd) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  /** Path to the .jsonl file (useful for crash recovery). */
  get incrementalPath() {
    return this.jsonlPath;
  }
}

/**
 * Write the final consolidated JSON report + copy the HTML viewer.
 * Also cleans up the .jsonl file since the final report supersedes it.
 *
 * @param {object} report — { timestamp, duration_ms, summary, discrepancies, errors }
 * @param {IncrementalReport} [incremental] — optional, cleaned up if provided
 * @returns {string} path to the written JSON file
 */
async function writeReport(report, incremental) {
  const ts = report.timestamp.replace(/[:.]/g, "-");
  const jsonPath = path.join(RESULTS_DIR, `${ts}-audit.json`);
  await fsP.writeFile(jsonPath, JSON.stringify(report, null, 2));

  // Copy viewer.html alongside the report
  const viewerSrc = path.join(__dirname, "viewer.html");
  const viewerDst = path.join(RESULTS_DIR, "viewer.html");
  await fsP.copyFile(viewerSrc, viewerDst);

  // Clean up the .jsonl now that the final report is written
  if (incremental) {
    incremental.close();
    try { await fsP.unlink(incremental.incrementalPath); } catch {}
  }

  return jsonPath;
}

module.exports = { IncrementalReport, writeReport };
