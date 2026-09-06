// Recognising a build you already have.
//
// Importing a comp brings every build it references along with it, so importing
// three comps from the same squad leaves you with three copies of the same
// Firebrand. This module answers one question — "is this build already in my
// library?" — and rewrites a comp to point at the copy you already have.
//
// IDENTITY IS THE SHARE CODE. encodeShareCode is already the app's definition of
// "what a build is": profession, game mode, specialisations and traits, skills,
// legends and pets, weapons, stats, runes, sigils, infusions and the relic. It
// deliberately carries none of the things two people would reasonably differ on
// — title, notes, tags, images, folder. So two builds with the same share code
// are the same build, and hand-rolling a field list here would only give the
// codec something to drift away from.

const { encodeShareCode } = require("@axiapps/code");

/**
 * @returns {string|null} the build's identity, or null if it has none — an
 * unfinished record with no profession, or one the codec refuses. A null never
 * matches anything, so an unencodable build simply imports as its own copy.
 */
function buildFingerprint(build) {
  if (!build || typeof build !== "object" || !build.profession) return null;
  try {
    return encodeShareCode(build) || null;
  } catch {
    return null;
  }
}

/**
 * A build is only worth reusing if the comp can actually point at it: a trashed
 * build is on its way out, and an archived one is deliberately out of sight, so
 * reusing either would hand you a comp full of builds you cannot see.
 */
function isReusable(build) {
  return Boolean(build) && !build.deletedAt && !build.archivedAt;
}

/**
 * First match wins. listBuilds returns records in creation order, so the copy
 * that has been in the library longest is the one everything gets pointed at —
 * the one most likely to be the one already in use elsewhere.
 */
function indexByFingerprint(builds) {
  const index = new Map();
  for (const build of builds || []) {
    if (!isReusable(build)) continue;
    const fp = buildFingerprint(build);
    if (!fp || index.has(fp)) continue;
    index.set(fp, build);
  }
  return index;
}

/**
 * Match incoming builds against the library WITHOUT changing anything.
 *
 * @param {object[]} incoming builds an import is about to write
 * @param {object[]} existing the library
 * @param {{eligible?: (build: object) => boolean, keyOf?: (build: object) => any}} [opts]
 *   `eligible` restricts what may be reused — the team-folder case passes one,
 *   see index.js. `keyOf` says how the caller identifies an incoming build:
 *   published imports have minted their local ids already, but a share code
 *   decodes to build records with no id at all, so that path keys by the object
 *   itself.
 * @returns {{reuse: Map<any, object>, duplicates: object[]}}
 *   `reuse` maps an incoming build's key to the existing record it should
 *   become; `duplicates` is the same information flattened for the UI, and is
 *   the only half that crosses IPC — hence a positional `index` rather than a
 *   key that may be an object.
 */
function planBuildReuse(incoming, existing, { eligible, keyOf = (b) => b.id } = {}) {
  const pool = eligible ? (existing || []).filter(eligible) : existing || [];
  const index = indexByFingerprint(pool);
  const reuse = new Map();
  const duplicates = [];
  (incoming || []).forEach((build, i) => {
    const fp = buildFingerprint(build);
    const match = fp ? index.get(fp) : null;
    if (!match) return;
    reuse.set(keyOf(build), match);
    duplicates.push({
      index: i,
      incomingTitle: build.title || "Untitled Build",
      existingId: match.id,
      existingTitle: match.title || "Untitled Build",
    });
  });
  return { reuse, duplicates };
}

function dedupeIds(ids) {
  return [...new Set((ids || []).filter(Boolean))];
}

/**
 * Rewrite an imported comp to use the builds it matched.
 *
 * Every reference has to move together — buildIds, party-line slots,
 * buildColors and category membership — for the same reason toImportedComp
 * remaps them all: miss one and the comp arrives with empty slots next to
 * builds that did import.
 *
 * Two incoming builds that match the SAME existing build collapse onto it. The
 * roster loses an entry (they were the same build under two names) but the
 * slots do not: each slot remaps independently, so the party lines keep their
 * shape and simply point at one record twice.
 *
 * @returns {{comp: object, builds: object[], reused: object[]}} `builds` is what
 *   still needs writing; `reused` is the existing records now referenced.
 */
function applyBuildReuse({ comp, builds }, reuse) {
  if (!reuse || reuse.size === 0) return { comp, builds: builds || [], reused: [] };

  const idFor = (id) => reuse.get(id)?.id || id;
  const remapSlot = (slot) =>
    typeof slot === "string" && slot.startsWith("tag:") ? slot : idFor(slot);

  const next = {
    ...comp,
    buildIds: dedupeIds((comp.buildIds || []).map(idFor)),
    partyLines: (comp.partyLines || []).map((line) => ({
      ...line,
      slots: (line.slots || []).map(remapSlot).filter(Boolean),
    })),
    buildColors: Object.fromEntries(
      Object.entries(comp.buildColors || {}).map(([id, color]) => [idFor(id), color])
    ),
    categories: (comp.categories || []).map((cat) => ({
      ...cat,
      buildIds: dedupeIds((cat.buildIds || []).map(idFor)),
    })),
  };

  return {
    comp: next,
    builds: (builds || []).filter((b) => !reuse.has(b.id)),
    // Deduped: two incoming builds can match the same record, and the caller
    // wires each of these into the comp exactly once.
    reused: [...new Map([...reuse.values()].map((b) => [b.id, b])).values()],
  };
}

module.exports = {
  buildFingerprint,
  indexByFingerprint,
  planBuildReuse,
  applyBuildReuse,
  _isReusable: isReusable,
};
