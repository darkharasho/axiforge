"use strict";

// Turns a diffBuild.js op list into the one-line summary shown in the history
// entry list. `derived` ops never surface here — they round-trip but are not
// user-facing edits. Everything else gets a phrase in the register the
// existing UI already uses (see `renderMiniBuildCard` / `EQUIP_*_SLOTS` in
// src/renderer/modules/constants.js), except `head`, which the panel calls
// "helm" — matched here verbatim per the brief's own test.
//
// Two rendering modes:
//   - 1-4 ops: each op gets its own clause, joined with "; ". A consumer
//     (`sync-summary.js`) splits on that separator to truncate long lists, so
//     the separator is load-bearing and must not change.
//   - 5+ ops: ops are grouped into counted categories (gear slots, sigils,
//     skills, traits) plus one bare noun per everything else, joined with
//     ", " into a SINGLE clause — no semicolons, so it always renders whole.

const SLOT_LABELS = {
  head: "helm",
  shoulders: "shoulders",
  chest: "chest",
  hands: "hands",
  legs: "legs",
  feet: "boots",
  back: "back",
  amulet: "amulet",
  ring1: "ring 1",
  ring2: "ring 2",
  accessory1: "accessory 1",
  accessory2: "accessory 2",
  breather: "breather",
  aquatic1: "underwater weapon 1",
  aquatic2: "underwater weapon 2",
  mainhand1: "main hand",
  offhand1: "off hand",
  mainhand2: "main hand (set 2)",
  offhand2: "off hand (set 2)",
};

// `part` -> the word appended after the slot label. `item` and `weapon` name
// the piece itself, so they add nothing ("helm: X → Y", not "helm item: X → Y").
const GEAR_PART_LABEL = {
  item: "",
  weapon: "",
  rune: "rune",
  infusion: "infusion",
};

// `field` paths, each with the noun used when grouped and the full clause
// used standalone. `title` is free text worth quoting; everything else reads
// better as "<noun> updated/changed" without echoing the raw value.
const FIELD_META = {
  title: { noun: "title", detail: (b, a) => `title: "${fmtValue(b)}" → "${fmtValue(a)}"` },
  notes: { noun: "notes", detail: () => "notes updated" },
  tags: { noun: "tags", detail: () => "tags updated" },
  profession: { noun: "profession", detail: (b, a) => `profession: ${fmtValue(b)} → ${fmtValue(a)}` },
  gameMode: { noun: "game mode", detail: (b, a) => `game mode: ${fmtValue(b)} → ${fmtValue(a)}` },
  // Task 1 widened FIELD_PATHS past the brief's original five; each of these
  // needs its own phrase or it renders unlabelled.
  images: { noun: "images", detail: () => "images updated" },
  selectedLegends: { noun: "legends", detail: () => "legends changed" },
  selectedUnderwaterLegends: { noun: "underwater legends", detail: () => "underwater legends changed" },
  selectedPets: { noun: "pets", detail: () => "pets changed" },
  morphSkillIds: { noun: "morph skills", detail: () => "morph skills changed" },
};

/* ------------------------------------------------------------------ helpers */

function humanize(path) {
  return String(path)
    .replace(/\./g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

function fmtValue(v) {
  if (v === null || v === undefined || v === "") return "(none)";
  if (typeof v === "object") {
    if (Array.isArray(v)) return v.length ? v.join(", ") : "(none)";
    if (typeof v.name === "string") return v.name;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function gearSlotLabel(slotRaw) {
  const m = /^(.*)\[(\d+)\]$/.exec(String(slotRaw));
  const base = m ? m[1] : slotRaw;
  return SLOT_LABELS[base] || humanize(base);
}

function gearPartLabel(part) {
  if (/^sigil\d+$/.test(String(part))) return "sigil";
  return GEAR_PART_LABEL[part] || "";
}

function skillSlotLabel(slotRaw) {
  const slot = String(slotRaw);
  const utility = /^utility(\d+)$/.exec(slot);
  if (utility) return `utility ${utility[1]}`;
  return SLOT_LABELS[slot] || humanize(slot);
}

/* ---------------------------------------------------------- per-op detail */

function gearDetail(op) {
  const slotLabel = gearSlotLabel(op.slot);
  const partLabel = gearPartLabel(op.part);
  const label = partLabel ? `${slotLabel} ${partLabel}` : slotLabel;
  return `${label}: ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
}

function skillDetail(op) {
  const label = `${op.uw ? "underwater " : ""}${skillSlotLabel(op.slot)}`;
  return `${label}: ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
}

function traitDetail(op) {
  return `trait (tier ${op.tier}): ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
}

function specDetail(op) {
  return `specialization: ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
}

function statDetail(op) {
  return `stats: ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
}

function consumableDetail(op) {
  return `${humanize(op.path)}: ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
}

function fieldDetail(op) {
  const meta = FIELD_META[op.path];
  if (meta) return meta.detail(op.before, op.after);
  return `${humanize(op.path)} updated`;
}

function metaDetail(op, opts) {
  if (op.path === "folderId") {
    const folderNameOf = opts && typeof opts.folderNameOf === "function" ? opts.folderNameOf : null;
    const name = folderNameOf ? folderNameOf(op.after) : undefined;
    return name ? `moved to ${name}` : "moved to another folder";
  }
  return `${humanize(op.path)}: ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
}

function rawDetail(op) {
  return `${humanize(op.path)}: ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
}

function renderOpDetail(op, opts) {
  switch (op.t) {
    case "gear":
      return gearDetail(op);
    case "skill":
      return skillDetail(op);
    case "trait":
      return traitDetail(op);
    case "spec":
      return specDetail(op);
    case "stat":
      return statDetail(op);
    case "consumable":
      return consumableDetail(op);
    case "field":
      return fieldDetail(op);
    case "meta":
      return metaDetail(op, opts);
    case "raw":
      return rawDetail(op);
    default:
      return `${humanize(op.t || "change")}: ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
  }
}

/* -------------------------------------------------------------- grouping */

function groupBareNoun(op) {
  switch (op.t) {
    case "field":
      return (FIELD_META[op.path] && FIELD_META[op.path].noun) || humanize(op.path);
    case "meta":
      return op.path === "folderId" ? "folder" : humanize(op.path);
    case "stat":
      return "stats";
    case "consumable":
      return humanize(op.path);
    case "spec":
      return "specialization";
    case "raw":
      return humanize(op.path);
    default:
      return humanize(op.t || "change");
  }
}

function pluralize(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function groupSummary(ops) {
  let gearCount = 0;
  let sigilCount = 0;
  let skillCount = 0;
  let traitCount = 0;
  const others = [];

  for (const op of ops) {
    if (op.t === "gear") {
      if (/^sigil\d+$/.test(String(op.part))) sigilCount += 1;
      else gearCount += 1;
    } else if (op.t === "skill") {
      skillCount += 1;
    } else if (op.t === "trait") {
      traitCount += 1;
    } else {
      others.push(groupBareNoun(op));
    }
  }

  const parts = [];
  if (gearCount) parts.push(pluralize(gearCount, "gear slot"));
  if (sigilCount) parts.push(pluralize(sigilCount, "sigil"));
  if (skillCount) parts.push(pluralize(skillCount, "skill"));
  if (traitCount) parts.push(pluralize(traitCount, "trait"));
  parts.push(...others);
  return parts.join(", ");
}

/* --------------------------------------------------------------- entry point */

function renderSummary(ops, opts = {}) {
  const list = (Array.isArray(ops) ? ops : []).filter((op) => op && op.t !== "derived");
  if (list.length === 0) return "";
  if (list.length > 4) return groupSummary(list);
  return list.map((op) => renderOpDetail(op, opts)).join("; ");
}

module.exports = { renderSummary };
