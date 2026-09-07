"use strict";

// Turns a diffBuild.js / diffComp.js op list into the one-line summary shown
// in the history entry list. `derived` ops never surface here — they
// round-trip but are not user-facing edits. Everything else gets a phrase in
// the register the
// existing UI already uses (see `renderMiniBuildCard` / `EQUIP_*_SLOTS` in
// src/renderer/modules/constants.js), except `head`, which the panel calls
// "helm" — matched here verbatim per the brief's own test.
//
// Two rendering modes:
//   - 1-4 ops: each op gets its own clause, joined with "; ". A consumer
//     (`sync-summary.js`) splits on that separator to truncate long lists, so
//     the separator is load-bearing and must not change.
//   - 5+ ops: ops are grouped into counted categories (gear slots, sigils,
//     skills, traits, party slots) plus one bare noun per everything else, joined with
//     ", " into a SINGLE clause — no semicolons, so it always renders whole.

const SLOT_LABELS = {
  head: "head",
  shoulders: "shoulders",
  chest: "chest",
  hands: "hands",
  legs: "legs",
  feet: "feet",
  back: "back",
  amulet: "amulet",
  ring1: "ring 1",
  ring2: "ring 2",
  accessory1: "accessory 1",
  accessory2: "accessory 2",
  breather: "breather",
  aquatic1: "weapon 1",
  aquatic2: "weapon 2",
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
  // Comp fields (history/diffComp.js). A comp's free-text name is worth
  // quoting for the same reason a build's title is.
  name: { noun: "name", detail: (b, a) => `name: "${fmtValue(b)}" → "${fmtValue(a)}"` },
  buildIds: { noun: "members", detail: () => "members changed" },
  categories: { noun: "categories", detail: () => "categories changed" },
  buildColors: { noun: "slot colours", detail: () => "slot colours changed" },
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

// A comp slot holds a build id, a "tag:<categoryId>" category, null, or (in
// older records) a whole embedded build. `buildNameOf` turns an id into the
// title a teammate would recognise; without it the raw id is still truthful.
function partySlotValue(value, opts) {
  if (value === null || value === undefined || value === "") return "(none)";
  if (typeof value === "object") return fmtValue(value);
  const raw = String(value);
  if (raw.startsWith("tag:")) {
    const categoryNameOf = opts && typeof opts.categoryNameOf === "function" ? opts.categoryNameOf : null;
    const named = categoryNameOf ? categoryNameOf(raw.slice(4)) : undefined;
    return named ? `any ${named}` : `any ${raw.slice(4)}`;
  }
  const buildNameOf = opts && typeof opts.buildNameOf === "function" ? opts.buildNameOf : null;
  return (buildNameOf && buildNameOf(raw)) || raw;
}

function slotDetail(op, opts) {
  return `party ${Number(op.line) + 1} slot ${Number(op.index) + 1}: `
    + `${partySlotValue(op.before, opts)} → ${partySlotValue(op.after, opts)}`;
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

// A comp's party lines are diffed positionally, so a whole line appearing or
// disappearing arrives as a raw op. Echoing the serialised line would fill the
// summary with JSON; what a teammate needs is that a party was added.
const PARTY_LINE = /^partyLines\.(\d+)$/;
const PARTY_LINE_KEY = /^partyLines\.(\d+)\.(.+)$/;

function rawDetail(op) {
  if (op.path === "partyLines") return "party lines changed";
  const line = PARTY_LINE.exec(String(op.path));
  if (line) {
    const n = Number(line[1]) + 1;
    if (op.before === undefined || op.before === null) return `party ${n} added`;
    if (op.after === undefined || op.after === null) return `party ${n} removed`;
    return `party ${n} replaced`;
  }
  const key = PARTY_LINE_KEY.exec(String(op.path));
  if (key) {
    return `party ${Number(key[1]) + 1} ${humanize(key[2])}: ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
  }
  return `${humanize(op.path)}: ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
}

function renderOpDetail(op, opts) {
  switch (op.t) {
    case "gear":
      return gearDetail(op);
    case "skill":
      return skillDetail(op);
    case "slot":
      return slotDetail(op, opts);
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
      return op.path === "partyLines" || PARTY_LINE.test(String(op.path)) ? "parties" : humanize(op.path);
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
  let slotCount = 0;
  const others = [];

  for (const op of ops) {
    if (op.t === "gear") {
      if (/^sigil\d+$/.test(String(op.part))) sigilCount += 1;
      else gearCount += 1;
    } else if (op.t === "skill") {
      skillCount += 1;
    } else if (op.t === "trait") {
      traitCount += 1;
    } else if (op.t === "slot") {
      slotCount += 1;
    } else {
      others.push(groupBareNoun(op));
    }
  }

  const parts = [];
  if (gearCount) parts.push(pluralize(gearCount, "gear slot"));
  if (sigilCount) parts.push(pluralize(sigilCount, "sigil"));
  if (skillCount) parts.push(pluralize(skillCount, "skill"));
  if (traitCount) parts.push(pluralize(traitCount, "trait"));
  if (slotCount) parts.push(pluralize(slotCount, "party slot"));
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
