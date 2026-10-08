"use strict";

const { publishStatus } = require("../shared/publishState");

/** Whether a record can be published at all (the same rules the publish path enforces). */
function isPublishable(kind, record) {
  if (!record) return false;
  if (kind === "build") return Boolean(record.profession);
  const name = String(record.name || "").trim();
  return Boolean(name) && name !== "Untitled Comp";
}

/**
 * What a save should do about publishing.
 *
 * `record` must be annotated (annotateBuild / annotateComp): an unchanged
 * fingerprint reads "current" and is skipped. A record whose receipt names
 * another owner than the one it would publish to is asked about once, unless a
 * choice was already made. An unknown target (signed out) never asks: the round
 * checks again when it runs.
 *
 * @param {"build"|"comp"} kind
 * @param {object|null} record
 * @param {{targetOwner?: string|null, choice?: "mine"|"theirs"|null}} ctx
 * @returns {"skip"|"enqueue"|"ask-owner"}
 */
function autoPublishDecision(kind, record, { targetOwner = null, choice = null } = {}) {
  if (!record || record.deletedAt || record.archivedAt) return "skip";
  if (!isPublishable(kind, record)) return "skip";
  if (choice === "theirs") return "skip";
  if (publishStatus(record) === "current") return "skip";
  const foreign = Boolean(record.publishedOwner && targetOwner && record.publishedOwner !== targetOwner);
  if (foreign && choice !== "mine") return "ask-owner";
  return "enqueue";
}

/** Records the one-time bulk prompt offers to publish. Archived ones stay put away. */
function bulkPublishCandidates({ builds = [], comps = [] }) {
  const out = [];
  for (const b of builds) {
    if (!b.deletedAt && !b.archivedAt && !b.publishedFileId && isPublishable("build", b)) out.push({ kind: "build", id: b.id });
  }
  for (const c of comps) {
    if (!c.deletedAt && !c.archivedAt && !c.publishedFileId && isPublishable("comp", c)) out.push({ kind: "comp", id: c.id });
  }
  return out;
}

module.exports = { autoPublishDecision, isPublishable, bulkPublishCandidates };
