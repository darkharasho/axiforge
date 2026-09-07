// Usage: node scripts/verify-history-migration.mjs [profileDataDir]
//
// Copies a real profile's history into a temp dir, migrates it, and asserts
// that every reconstructed version deep-equals the v1 snapshot it came from.
// Never writes to the profile it is pointed at.
//
// "deep-equals" has exactly one sanctioned exception: IGNORED_FIELDS
// (`updatedAt`, `version`) are excluded from ops by design, so a version
// rebuilt from a patch inherits its keyframe's values for them. Every other
// difference is reported as a mismatch. A v1 entry the differ sees as no
// change at all writes no version, by design; each such gap is proved to be
// exactly that rather than assumed.
//
// Why this exists: 131 real versions of real builds are a better adversary
// than any fixture. A mismatch here means the differ loses data on shapes the
// unit tests never invented — stop and fix history/diffBuild.js, do not ship.
//
// SAFETY: the source profile is opened for READING ONLY. Everything below
// operates on `tmp`, a fresh mkdtemp directory. There is no code path here
// that opens a handle for writing under `profileDir`, and the migration is
// only ever handed `tmp`. The originals are not renamed, not moved, not
// truncated — `<file>.pre-v2` is created inside the temp copy.

import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { IGNORED_FIELDS } = require("../src/main/history/constants.js");
const { migrateV1 } = require("../src/main/history/migrateV1.js");
const { BuildHistoryStore } = require("../src/main/buildHistoryStore.js");
const { CompHistoryStore } = require("../src/main/compHistoryStore.js");
const diffBuild = require("../src/main/history/diffBuild.js");
const diffComp = require("../src/main/history/diffComp.js");

const DEFAULT_PROFILE = path.join(os.homedir(), ".config", "axiforge-desktop", "data");

const KINDS = [
  {
    label: "builds",
    historyFile: "build-history.json",
    recordsFile: "builds.json",
    idField: "buildId",
    differ: diffBuild,
    makeStore: (dir) => new BuildHistoryStore(dir),
  },
  {
    label: "comps",
    historyFile: "comp-history.json",
    recordsFile: "comps.json",
    idField: "compId",
    differ: diffComp,
    makeStore: (dir) => new CompHistoryStore(dir),
  },
];

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** builds.json / comps.json are flat arrays of documents keyed by `id`. */
function liveDocsFrom(list) {
  const map = new Map();
  for (const doc of Array.isArray(list) ? list : []) {
    if (doc && doc.id) map.set(doc.id, doc);
  }
  return map;
}

function deepEqual(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

/**
 * Top-level keys on which two documents differ. Used to prove that a
 * non-deepStrictEqual match differs ONLY in IGNORED_FIELDS — `updatedAt` and
 * `version` are excluded from ops by design (constants.js), so a patched
 * version inherits its keyframe's values for them. That is the one and only
 * sanctioned way a reconstructed version may differ from its v1 snapshot;
 * anything else is data loss.
 */
function differingKeys(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].filter((k) => !deepEqual((a || {})[k], (b || {})[k]));
}

/**
 * The states the migration is supposed to have produced, oldest-first: every
 * v1 entry's snapshot in reverse (v1 is newest-first, snapshots are the state
 * BEFORE the entry's change), then the live document that the newest entry's
 * change produced.
 */
function expectedStates(entries, liveDoc) {
  const ordered = entries.filter((e) => e && e.snapshot).reverse();
  const states = ordered.map((e) => ({ doc: e.snapshot, from: `entry ${e.id} snapshot` }));
  if (ordered.length && liveDoc) states.push({ doc: liveDoc, from: "live document" });
  return states;
}

async function verifyKind(profileDir, tmpRoot, kind) {
  const src = path.join(profileDir, kind.historyFile);
  const v1 = await readJson(src);
  if (!v1 || typeof v1 !== "object" || Object.keys(v1).length === 0) {
    return { present: false, records: 0, versions: 0, states: 0, exact: 0, ignoredDrift: 0, notVersioned: 0, mismatches: 0 };
  }

  // --- the only place the source is touched, and only to copy out of it -----
  const dir = path.join(tmpRoot, kind.label);
  await fs.mkdir(dir, { recursive: true });
  await fs.cp(src, path.join(dir, kind.historyFile));
  const recordsSrc = path.join(profileDir, kind.recordsFile);
  const records = await readJson(recordsSrc);
  if (records) await fs.cp(recordsSrc, path.join(dir, kind.recordsFile));
  // -------------------------------------------------------------------------

  const liveDocs = liveDocsFrom(records);
  const store = kind.makeStore(dir);
  await store.init();
  const result = await migrateV1({
    baseDir: dir,
    store,
    fileName: kind.historyFile,
    idField: kind.idField,
    liveDocs,
  });

  let checked = 0;
  let states = 0;
  let exact = 0;
  let ignoredDrift = 0;
  let mismatches = 0;
  let notVersioned = 0;
  let recordCount = 0;

  for (const [recordId, entries] of Object.entries(v1)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    recordCount += 1;
    const expected = expectedStates(entries, liveDocs.get(recordId));
    const { versions: stored } = await store.listVersions(recordId, { limit: 100000 });
    const actual = [];
    for (const v of [...stored].reverse()) actual.push({ v: v.v, doc: await store.getVersion(recordId, v.v) });

    // `actual` must be `expected` in order, possibly with gaps. A v1 entry
    // whose change the differ sees as nothing — only ignored fields moved
    // (an `updatedAt` bump from a save that changed nothing else), or only
    // derived fields did (a publish receipt, a sort order) — writes no
    // version by design. Every gap is proved to be exactly that.
    let j = 0;
    let lastDoc = null;
    for (const exp of expected) {
      states += 1;
      if (exp.from !== "live document") checked += 1;
      if (j < actual.length && kind.differ.diff(actual[j].doc, exp.doc).length === 0) {
        // Matched as far as the differ is concerned. Now the strict check:
        // deepStrictEqual, or a difference confined to IGNORED_FIELDS.
        if (deepEqual(actual[j].doc, exp.doc)) {
          exact += 1;
        } else {
          const keys = differingKeys(actual[j].doc, exp.doc);
          const unexplained = keys.filter((k) => !IGNORED_FIELDS.includes(k));
          if (unexplained.length) {
            mismatches += 1;
            console.error(
              `MISMATCH ${kind.label} ${recordId} v${actual[j].v}: ${exp.from} differs on`
              + ` ${unexplained.join(", ")} with no op to explain it`
            );
          } else {
            ignoredDrift += 1;
          }
        }
        lastDoc = actual[j].doc;
        j += 1;
        continue;
      }
      // No version for this state. Legitimate only if the differ sees no
      // change at all between the last stored version and it.
      const ops = kind.differ.diff(lastDoc || {}, exp.doc);
      const { substantive, incidental } = kind.differ.classify(ops);
      if (lastDoc && substantive.length === 0 && incidental.length === 0) {
        notVersioned += 1;
        continue;
      }
      mismatches += 1;
      console.error(
        `MISMATCH ${kind.label} ${recordId}: ${exp.from} is not reconstructible`
        + ` (${substantive.length} substantive, ${incidental.length} incidental ops lost)`
      );
    }
    if (j !== actual.length) {
      mismatches += 1;
      console.error(
        `MISMATCH ${kind.label} ${recordId}: ${actual.length - j} stored version(s) match no v1 snapshot`
      );
    }
  }

  if (result.failed) console.error(`WARNING ${kind.label}: ${result.failed} record(s) failed to migrate`);
  return { present: true, records: recordCount, versions: checked, states, exact, ignoredDrift, notVersioned, mismatches, result };
}

async function main() {
  const profileDir = process.argv[2] || DEFAULT_PROFILE;
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-verify-migration-"));
  let totals = { records: 0, versions: 0, mismatches: 0, exact: 0, ignoredDrift: 0, notVersioned: 0, present: false };
  try {
    for (const kind of KINDS) {
      const r = await verifyKind(profileDir, tmpRoot, kind);
      if (!r.present) {
        console.log(`${kind.label}: no v1 history in ${profileDir}`);
        continue;
      }
      totals.present = true;
      totals.records += r.records;
      totals.versions += r.versions;
      totals.mismatches += r.mismatches;
      totals.exact += r.exact;
      totals.ignoredDrift += r.ignoredDrift;
      totals.notVersioned += r.notVersioned;
      console.log(
        `${kind.label}: ${r.versions} v1 entries + ${r.states - r.versions} live documents`
        + ` = ${r.states} states across ${r.records} records —`
        + ` ${r.exact} byte-identical, ${r.ignoredDrift} identical but for ${IGNORED_FIELDS.join("/")}`
        + `, ${r.notVersioned} the differ sees as no change at all (no version by design)`
        + `, ${r.mismatches} mismatches`
      );
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }

  if (!totals.present) {
    console.log(`No v1 history found in ${profileDir} — nothing to verify.`);
    return 0;
  }
  console.log(
    `checked ${totals.versions} versions across ${totals.records} records, ${totals.mismatches} mismatches`
  );
  return totals.mismatches === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("verify-history-migration failed:", err);
    process.exit(1);
  }
);
