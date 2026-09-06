"use strict";

const { HistoryStore } = require("./historyStore");

/**
 * Version history for comps.
 *
 * Comps had none. A build carried a full record of who changed what, and the
 * comp those builds sit in — the thing a squad actually argues over, and the
 * thing a teammate can restructure in one drag — carried nothing at all.
 *
 * @see historyStore.js for the storage half, shared with builds.
 */
class CompHistoryStore extends HistoryStore {
  constructor(baseDir) {
    super(baseDir, { fileName: "comp-history.json", idField: "compId", defaultSummary: "comp updated" });
  }
}

/** Every build id a comp references, from membership AND from its party slots. */
function _memberIds(comp) {
  const fromList = (comp?.buildIds || []).filter(Boolean);
  const fromSlots = (comp?.partyLines || [])
    .flatMap((line) => line?.slots || [])
    // "tag:<categoryId>" slots name a category, not a build.
    .filter((slot) => typeof slot === "string" && slot && !slot.startsWith("tag:"));
  return new Set([...fromList, ...fromSlots]);
}

function _slotCount(comp) {
  return (comp?.partyLines || []).reduce((n, line) => n + (line?.slots || []).filter(Boolean).length, 0);
}

function _names(ids, titleOf) {
  const named = [...ids].map((id) => titleOf(id)).filter(Boolean);
  if (named.length === 0) return null;
  if (named.length <= 3) return named.join(", ");
  return `${named.slice(0, 3).join(", ")} +${named.length - 3} more`;
}

/**
 * A human-readable summary of what changed between two comps.
 *
 * Deliberately names builds where it can. "party lines changed" tells a
 * teammate nothing they could act on; "removed Heal Druid, Firebrand" tells
 * them exactly what to argue with.
 *
 * @param {object|null} before
 * @param {object} after
 * @param {(buildId: string) => string|undefined} [titleOf] resolves build titles;
 *   omit it and the summary falls back to counts.
 */
function summarizeCompChange(before, after, titleOf = () => undefined) {
  if (!before) return "comp created";
  const changes = [];

  if (before.name !== after.name) {
    changes.push(`name: "${before.name}" → "${after.name}"`);
  }
  if ((before.gameMode || null) !== (after.gameMode || null)) {
    const label = (m) => (m === "wvw" ? "WvW" : m === "pvp" ? "PvP" : m === "pve" ? "PvE" : "any");
    changes.push(`game mode: ${label(before.gameMode)} → ${label(after.gameMode)}`);
  }

  const beforeIds = _memberIds(before);
  const afterIds = _memberIds(after);
  const added = [...afterIds].filter((id) => !beforeIds.has(id));
  const removed = [...beforeIds].filter((id) => !afterIds.has(id));
  if (added.length) {
    changes.push(`added ${_names(added, titleOf) || `${added.length} build${added.length > 1 ? "s" : ""}`}`);
  }
  if (removed.length) {
    changes.push(`removed ${_names(removed, titleOf) || `${removed.length} build${removed.length > 1 ? "s" : ""}`}`);
  }

  // Membership unchanged but the layout moved — a reorder or a move between
  // parties is a real edit to argue with, and saying nothing at all reads as a
  // phantom entry.
  const beforeLines = (before.partyLines || []).length;
  const afterLines = (after.partyLines || []).length;
  if (beforeLines !== afterLines) {
    changes.push(`parties: ${beforeLines} → ${afterLines}`);
  } else if (!added.length && !removed.length) {
    const layoutMoved =
      JSON.stringify((before.partyLines || []).map((l) => l.slots)) !==
      JSON.stringify((after.partyLines || []).map((l) => l.slots));
    if (layoutMoved) changes.push("party layout changed");
  }

  if (JSON.stringify(before.categories || []) !== JSON.stringify(after.categories || [])) {
    changes.push("categories changed");
  }
  if (JSON.stringify(before.buildColors || {}) !== JSON.stringify(after.buildColors || {})) {
    changes.push("slot colours changed");
  }
  if ((before.notes || "") !== (after.notes || "")) {
    changes.push("notes updated");
  }
  if (JSON.stringify(before.tags || []) !== JSON.stringify(after.tags || [])) {
    changes.push("tags changed");
  }

  if (changes.length === 0) {
    // Nothing recognised moved, but the caller only writes an entry when the
    // record actually changed — say something true rather than nothing.
    const b = _slotCount(before);
    const a = _slotCount(after);
    return b === a ? "comp updated" : `slots: ${b} → ${a}`;
  }
  return changes.join("; ");
}

module.exports = { CompHistoryStore, summarizeCompChange, _memberIds };
