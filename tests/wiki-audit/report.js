/**
 * report.js — Generate JSON audit report and copy HTML viewer.
 */

const path = require("path");
const fs = require("fs/promises");

const RESULTS_DIR = path.join(__dirname, "results");

/**
 * Write the audit report to disk.
 *
 * @param {object} report — { timestamp, duration_ms, summary, discrepancies, errors }
 * @returns {string} path to the written JSON file
 */
async function writeReport(report) {
  const ts = report.timestamp.replace(/[:.]/g, "-");
  const jsonPath = path.join(RESULTS_DIR, `${ts}-audit.json`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

  // Copy viewer.html alongside the report
  const viewerSrc = path.join(__dirname, "viewer.html");
  const viewerDst = path.join(RESULTS_DIR, "viewer.html");
  await fs.copyFile(viewerSrc, viewerDst);

  return jsonPath;
}

module.exports = { writeReport };
