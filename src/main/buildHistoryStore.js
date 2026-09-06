"use strict";

const { HistoryStore } = require("./historyStore");

/**
 * Version history for builds.
 *
 * The storage half lives in HistoryStore, shared with comps — the two were
 * byte-for-byte the same logic and drifted apart the moment one of them grew a
 * feature. What stays here is what is actually about builds: the file it lives
 * in, the `buildId` key its entries carry, and summarizeBuildChange below.
 */
class BuildHistoryStore extends HistoryStore {
  constructor(baseDir) {
    super(baseDir, { fileName: "build-history.json", idField: "buildId", defaultSummary: "build updated" });
  }
}

/**
 * Returns a human-readable summary of every field that changed between two
 * build objects. All differences are listed (not just the first).
 */
function summarizeBuildChange(before, after) {
  if (!before) return "build created";
  const changes = [];

  if (before.title !== after.title) {
    changes.push(`title: "${before.title}" → "${after.title}"`);
  }
  if (before.profession !== after.profession) {
    changes.push(`profession: ${before.profession} → ${after.profession}`);
  }
  if ((before.gameMode || "pve") !== (after.gameMode || "pve")) {
    changes.push(`game mode: ${before.gameMode || "pve"} → ${after.gameMode || "pve"}`);
  }
  if (JSON.stringify(before.specializations) !== JSON.stringify(after.specializations)) {
    changes.push("specializations changed");
  }
  if (JSON.stringify(before.skills) !== JSON.stringify(after.skills)) {
    changes.push(_describeSkillChanges(before.skills, after.skills));
  }
  if (JSON.stringify(before.underwaterSkills) !== JSON.stringify(after.underwaterSkills)) {
    changes.push(_describeSkillChanges(before.underwaterSkills, after.underwaterSkills, true));
  }
  if (JSON.stringify(before.equipment) !== JSON.stringify(after.equipment)) {
    changes.push(_describeEquipmentChanges(before.equipment, after.equipment));
  }
  if (before.notes !== after.notes) {
    changes.push("notes updated");
  }
  if (JSON.stringify(before.tags) !== JSON.stringify(after.tags)) {
    changes.push("tags changed");
  }

  return changes.length > 0 ? changes.join("; ") : "build updated";
}

function _describeSkillChanges(before, after, underwater = false) {
  const prefix = underwater ? "underwater " : "";
  if (!before || !after) return `${prefix}skills changed`;
  const slots = [];
  if (JSON.stringify(before.heal) !== JSON.stringify(after.heal)) slots.push("heal");
  const utilBefore = before.utility || [];
  const utilAfter = after.utility || [];
  for (let i = 0; i < 3; i++) {
    if (JSON.stringify(utilBefore[i]) !== JSON.stringify(utilAfter[i])) {
      slots.push(`utility ${i + 1}`);
    }
  }
  if (JSON.stringify(before.elite) !== JSON.stringify(after.elite)) slots.push("elite");
  if (slots.length === 0) return `${prefix}skills changed`;
  return `${prefix}${slots.join(", ")} skill${slots.length > 1 ? "s" : ""} changed`;
}

function _describeEquipmentChanges(before, after) {
  if (!before || !after) return "equipment changed";
  const parts = [];
  if (before.statPackage !== after.statPackage) {
    parts.push(`stat package: ${before.statPackage || "none"} → ${after.statPackage || "none"}`);
  }
  if (JSON.stringify(before.slots) !== JSON.stringify(after.slots)) parts.push("armor/trinkets");
  if (JSON.stringify(before.weapons) !== JSON.stringify(after.weapons)) parts.push("weapons");
  if (JSON.stringify(before.runes) !== JSON.stringify(after.runes)) parts.push("runes");
  if (JSON.stringify(before.sigils) !== JSON.stringify(after.sigils)) parts.push("sigils");
  if (before.relic !== after.relic) parts.push("relic");
  if (before.food !== after.food) parts.push("food");
  if (before.utility !== after.utility) parts.push("utility consumable");
  if (before.enrichment !== after.enrichment) parts.push("enrichment");
  if (JSON.stringify(before.infusions) !== JSON.stringify(after.infusions)) parts.push("infusions");
  if (parts.length === 0) return "equipment changed";
  return `${parts.join(", ")} changed`;
}

module.exports = { BuildHistoryStore, summarizeBuildChange };
