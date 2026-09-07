"use strict";

// Structural differ for build documents.
//
// `diff(before, after)` returns a flat, ordered list of ops. Every op carries
// its full `before` and `after` value, so a patch is self-contained: it can be
// applied forwards, inverted, or rendered side by side without the documents it
// came from.
//
// Two conventions run through the whole file:
//
//   * `undefined` means "the key is absent", `null` means "the key is present
//     and holds null". `applyOps` deletes on `undefined` and assigns on `null`.
//     Without this an absent key and a null key round-trip to the same document
//     and the invariant quietly breaks.
//   * Known paths get a domain op; everything else gets a `raw` op. The raw
//     fallback is what keeps the round-trip invariant true for keys nobody
//     planned for, including whole containers that turned null.
//
// Ops are emitted in a fixed order — declared paths first in declaration order,
// then unknown keys sorted alphabetically — so a patch for a given pair of
// documents is byte-stable.

const { IGNORED_FIELDS, SUBSTANTIVE_OPS, INCIDENTAL_PATHS } = require("./constants");

const FIELD_PATHS = ["title", "profession", "gameMode", "tags", "notes"];
const CONSUMABLE_PATHS = ["relic", "food", "utility", "enrichment"];
const SKILL_ROOTS = ["skills", "underwaterSkills"];

// container name in `equipment` -> the gear op `part` it produces.
// `sigils` and `infusions` may hold arrays; those get one op per index.
const GEAR_CONTAINERS = [
  ["slots", "item"],
  ["weapons", "weapon"],
  ["runes", "rune"],
  ["sigils", "sigil"],
  ["infusions", "infusion"],
];

const EQUIPMENT_KEYS = new Set([
  "statPackage",
  ...CONSUMABLE_PATHS,
  ...GEAR_CONTAINERS.map(([name]) => name),
]);

const KNOWN_TOP_LEVEL = new Set([
  ...FIELD_PATHS,
  ...INCIDENTAL_PATHS,
  "specializations",
  "equipment",
  ...SKILL_ROOTS,
]);

/* ------------------------------------------------------------------ helpers */

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!deepEqual(a[key], b[key])) return false;
    return true;
  }
  return false;
}

// Identity, not deep equality: a game patch that rewrites an icon URL or a
// description must not read as the player swapping the skill out.
function sameEntity(a, b) {
  if (!isObject(a) || !isObject(b)) return false;
  if (a.id !== undefined || b.id !== undefined) return a.id === b.id;
  return a.name !== undefined && a.name === b.name;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function sortedUnionKeys(a, b) {
  return [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
}

function isIndexKey(key) {
  return /^(0|[1-9][0-9]*)$/.test(String(key));
}

/* --------------------------------------------------------------------- diff */

function diff(before, after) {
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  const ops = [];

  for (const path of FIELD_PATHS) {
    if (!deepEqual(b[path], a[path])) {
      ops.push({ t: "field", path, before: b[path], after: a[path] });
    }
  }

  diffSpecializations(ops, b.specializations, a.specializations);
  for (const root of SKILL_ROOTS) diffSkills(ops, b[root], a[root], root === "underwaterSkills");
  diffEquipment(ops, b.equipment, a.equipment);

  for (const path of INCIDENTAL_PATHS) {
    if (!deepEqual(b[path], a[path])) {
      ops.push({ t: "meta", path, before: b[path], after: a[path] });
    }
  }

  // A first version has nothing to compare against, so it has to carry every
  // key — including the ones a normal save is not allowed to log.
  const ignored = isObject(before) ? IGNORED_FIELDS : [];
  const unknown = sortedUnionKeys(b, a).filter(
    (key) => !KNOWN_TOP_LEVEL.has(key) && !ignored.includes(key),
  );
  for (const path of unknown) {
    if (!deepEqual(b[path], a[path])) {
      ops.push({ t: "raw", path, before: b[path], after: a[path] });
    }
  }

  return ops;
}

function diffSpecializations(ops, beforeLines, afterLines) {
  if (deepEqual(beforeLines, afterLines)) return;
  walkOrRaw(ops, "specializations", beforeLines, afterLines, () => {
    if (!bothAre(beforeLines, afterLines, Array.isArray)) return;
    for (let line = 0; line < Math.max(beforeLines.length, afterLines.length); line += 1) {
      diffSpecLine(ops, line, beforeLines[line], afterLines[line]);
    }
  });
}

function diffSpecLine(ops, line, beforeLine, afterLine) {
  if (deepEqual(beforeLine, afterLine)) return;
  walkOrRaw(ops, `specializations.${line}`, beforeLine, afterLine, () => {
    diffSpecLineInner(ops, line, beforeLine, afterLine);
  });
}

function diffSpecLineInner(ops, line, beforeLine, afterLine) {
  // A spec line is an array element, so an absent one is diffed against an
  // empty line: `applyOps` drops the element wholesale, no shell left behind.
  if (!isAbsentOr(beforeLine, isObject) || !isAbsentOr(afterLine, isObject)) return;
  const b = beforeLine || {};
  const a = afterLine || {};

  // `id` and `name` travel on the spec op; `majorChoices` becomes trait ops.
  // Everything else on a spec line is the embedded catalog of options, so it is
  // derived: it round-trips but never reads as an edit.
  const skip = new Set(["id", "majorChoices"]);
  if (!sameEntity(beforeLine, afterLine)) {
    skip.add("name");
    ops.push({
      t: "spec",
      line,
      before: beforeLine === undefined ? undefined : { id: b.id, name: b.name },
      after: afterLine === undefined ? undefined : { id: a.id, name: a.name },
    });
  }

  diffTraitChoices(ops, line, b.majorChoices, a.majorChoices);

  for (const key of sortedUnionKeys(b, a)) {
    if (skip.has(key) || deepEqual(b[key], a[key])) continue;
    ops.push({ t: "derived", path: `specializations.${line}.${key}`, before: b[key], after: a[key] });
  }
}

function diffTraitChoices(ops, line, beforeChoices, afterChoices) {
  if (deepEqual(beforeChoices, afterChoices)) return;
  walkOrRaw(ops, `specializations.${line}.majorChoices`, beforeChoices, afterChoices, () => {
    if (!bothAre(beforeChoices, afterChoices, isObject)) return;
    for (const tier of sortedUnionKeys(beforeChoices, afterChoices)) {
      if (deepEqual(beforeChoices[tier], afterChoices[tier])) continue;
      ops.push({ t: "trait", line, tier: Number(tier), before: beforeChoices[tier], after: afterChoices[tier] });
    }
  });
}

function diffSkills(ops, beforeSkills, afterSkills, uw) {
  if (deepEqual(beforeSkills, afterSkills)) return;
  const root = uw ? "underwaterSkills" : "skills";
  walkOrRaw(ops, root, beforeSkills, afterSkills, () => {
    diffSkillsInner(ops, root, beforeSkills, afterSkills, uw);
  });
}

function diffSkillsInner(ops, root, beforeSkills, afterSkills, uw) {
  if (!bothAre(beforeSkills, afterSkills, isObject)) return;
  const b = beforeSkills;
  const a = afterSkills;

  diffSkillSlot(ops, root, "heal", "heal", b.heal, a.heal, uw);

  if (!deepEqual(b.utility, a.utility)) {
    walkOrRaw(ops, `${root}.utility`, b.utility, a.utility, () => {
      if (!bothAre(b.utility, a.utility, Array.isArray)) return;
      const bu = b.utility;
      const au = a.utility;
      for (let i = 0; i < Math.max(bu.length, au.length); i += 1) {
        diffSkillSlot(ops, root, `utility${i + 1}`, `utility.${i}`, bu[i], au[i], uw);
      }
    });
  }

  diffSkillSlot(ops, root, "elite", "elite", b.elite, a.elite, uw);
}

function diffSkillSlot(ops, root, slot, subPath, before, after, uw) {
  if (deepEqual(before, after)) return;
  if (sameEntity(before, after)) {
    ops.push({ t: "derived", path: `${root}.${subPath}`, before, after });
    return;
  }
  ops.push({ t: "skill", slot, uw, before, after });
}

function diffEquipment(ops, beforeEq, afterEq) {
  if (deepEqual(beforeEq, afterEq)) return;
  walkOrRaw(ops, "equipment", beforeEq, afterEq, () => {
    diffEquipmentInner(ops, beforeEq, afterEq);
  });
}

function diffEquipmentInner(ops, beforeEq, afterEq) {
  if (!bothAre(beforeEq, afterEq, isObject)) return;
  const b = beforeEq;
  const a = afterEq;

  if (!deepEqual(b.statPackage, a.statPackage)) {
    ops.push({ t: "stat", before: b.statPackage, after: a.statPackage });
  }
  for (const path of CONSUMABLE_PATHS) {
    if (!deepEqual(b[path], a[path])) {
      ops.push({ t: "consumable", path, before: b[path], after: a[path] });
    }
  }
  for (const [name, part] of GEAR_CONTAINERS) {
    diffGearContainer(ops, name, part, b[name], a[name]);
  }
  for (const key of sortedUnionKeys(b, a)) {
    if (EQUIPMENT_KEYS.has(key) || deepEqual(b[key], a[key])) continue;
    ops.push({ t: "raw", path: `equipment.${key}`, before: b[key], after: a[key] });
  }
}

function diffGearContainer(ops, name, part, beforeMap, afterMap) {
  if (deepEqual(beforeMap, afterMap)) return;
  walkOrRaw(ops, `equipment.${name}`, beforeMap, afterMap, () => {
    diffGearContainerInner(ops, name, part, beforeMap, afterMap);
  });
}

function diffGearContainerInner(ops, name, part, beforeMap, afterMap) {
  if (!bothAre(beforeMap, afterMap, isObject)) return;
  const b = beforeMap;
  const a = afterMap;
  for (const slot of sortedUnionKeys(b, a)) {
    const bv = b[slot];
    const av = a[slot];
    if (deepEqual(bv, av)) continue;
    if (!Array.isArray(bv) && !Array.isArray(av)) {
      ops.push({ t: "gear", slot, part, before: bv, after: av });
      continue;
    }
    // Sigils are always arrays; infusions are arrays only on the slots that
    // hold more than one (back, rings, two-handers).
    walkOrRaw(ops, `equipment.${name}.${slot}`, bv, av, () => {
      if (!bothAre(bv, av, Array.isArray)) return;
      const bl = bv;
      const al = av;
      for (let i = 0; i < Math.max(bl.length, al.length); i += 1) {
        if (deepEqual(bl[i], al[i])) continue;
        ops.push({
          t: "gear",
          // Sigils carry the index in the part (`sigil0`/`sigil1`); infusion
          // slots can hold three, so they carry it in the slot instead.
          slot: name === "sigils" ? slot : `${slot}[${i}]`,
          part: name === "sigils" ? `sigil${i}` : part,
          before: bl[i],
          after: al[i],
        });
      }
    });
  }
}

// Walking into a container is only safe when it yields at least one op: an
// empty array or object that appears on one side only has no children to
// report, and silently emitting nothing would break the round-trip invariant.
// Anything a walk cannot express falls back to one raw op carrying the whole
// value.
function walkOrRaw(ops, path, before, after, walk) {
  const start = ops.length;
  walk();
  if (ops.length === start) ops.push({ t: "raw", path, before, after });
}

// A named container is walked only when both sides really are that container.
// If one side is absent, null, or a different shape, the whole thing travels as
// one raw op: deleting a container's children one by one leaves an empty shell
// behind, and creating them one by one is not invertible for the same reason.
// The container itself has to be the unit of change.
function bothAre(a, b, isShape) {
  return isShape(a) && isShape(b);
}

// Array elements are the exception: an absent one is diffed against an empty
// value, because `applyOps` compacts removed elements out of the array.
function isAbsentOr(value, isShape) {
  return value === undefined || isShape(value);
}

/* ----------------------------------------------------------------- applyOps */

function applyOps(doc, ops) {
  const out = clone(isObject(doc) ? doc : {});
  // Deleting an array element in place would leave a hole, and later ops in the
  // same patch still need the element to write into, so removals are collected
  // and the arrays are compacted once at the end.
  const removals = new Map();
  for (const op of Array.isArray(ops) ? ops : []) applyOp(out, op, removals);
  for (const [path, indices] of removals) {
    const arr = getPath(out, path);
    if (Array.isArray(arr)) assign(out, path.split("."), arr.filter((_, i) => !indices.has(i)));
  }
  return out;
}

function applyOp(doc, op, removals) {
  if (!isObject(op)) return;
  switch (op.t) {
    case "field":
    case "meta":
    case "raw":
    case "derived":
      set(doc, String(op.path).split("."), op.after, removals);
      break;
    case "stat":
      set(doc, ["equipment", "statPackage"], op.after, removals);
      break;
    case "consumable":
      set(doc, ["equipment", String(op.path)], op.after, removals);
      break;
    case "gear":
      set(doc, gearSegments(op), op.after, removals);
      break;
    case "skill":
      set(doc, skillSegments(op), op.after, removals);
      break;
    case "trait":
      set(doc, ["specializations", String(op.line), "majorChoices", String(op.tier)], op.after, removals, {
        // majorChoices is an object with numeric keys, not an array.
        2: "object",
      });
      break;
    case "spec":
      applySpec(doc, op, removals);
      break;
    default:
      break;
  }
}

// The spec op owns only `id` and `name`; the trait and derived ops in the same
// patch own the rest of the line. Merging rather than replacing keeps the three
// independent, which is what lets `invert` reverse the op order safely.
function applySpec(doc, op, removals) {
  const segments = ["specializations", String(op.line)];
  if (op.after === undefined) {
    removals.set("specializations", (removals.get("specializations") || new Set()).add(Number(op.line)));
    return;
  }
  if (op.after === null) {
    set(doc, segments, null, removals);
    return;
  }
  const line = ensureContainer(doc, segments, "object");
  for (const key of ["id", "name"]) {
    if (op.after[key] === undefined) delete line[key];
    else line[key] = clone(op.after[key]);
  }
}

function gearSegments(op) {
  const part = String(op.part);
  const slot = String(op.slot);
  if (part.startsWith("sigil")) return ["equipment", "sigils", slot, part.slice("sigil".length)];
  const container =
    part === "item" ? "slots" : part === "rune" ? "runes" : part === "weapon" ? "weapons" : "infusions";
  const indexed = /^(.*)\[(\d+)\]$/.exec(slot);
  if (indexed) return ["equipment", container, indexed[1], indexed[2]];
  return ["equipment", container, slot];
}

function skillSegments(op) {
  const root = op.uw ? "underwaterSkills" : "skills";
  const slot = String(op.slot);
  const utility = /^utility(\d+)$/.exec(slot);
  if (utility) return [root, "utility", String(Number(utility[1]) - 1)];
  return [root, slot];
}

/* -------------------------------------------------------------- path writes */

// `kinds` overrides the container created at a given segment index; by default a
// container is an array when the next segment is an index and an object
// otherwise.
function set(doc, segments, value, removals, kinds = {}) {
  const parentSegments = segments.slice(0, -1);
  const key = segments[segments.length - 1];
  if (value === undefined) {
    const parent = getPath(doc, parentSegments.join("."));
    if (!parent || typeof parent !== "object") return;
    if (Array.isArray(parent)) {
      const path = parentSegments.join(".");
      removals.set(path, (removals.get(path) || new Set()).add(Number(key)));
      return;
    }
    delete parent[key];
    return;
  }
  assign(doc, segments, clone(value), kinds);
}

function assign(doc, segments, value, kinds = {}) {
  let node = doc;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const kind = kinds[i] || (isIndexKey(segments[i + 1]) ? "array" : "object");
    node = ensureChild(node, segments[i], kind);
  }
  node[segments[segments.length - 1]] = value;
}

function ensureContainer(doc, segments, kind) {
  let node = doc;
  for (let i = 0; i < segments.length - 1; i += 1) {
    node = ensureChild(node, segments[i], isIndexKey(segments[i + 1]) ? "array" : "object");
  }
  return ensureChild(node, segments[segments.length - 1], kind);
}

function ensureChild(node, key, kind) {
  const current = node[key];
  const ok = kind === "array" ? Array.isArray(current) : isObject(current);
  if (!ok) node[key] = kind === "array" ? [] : {};
  return node[key];
}

function getPath(doc, path) {
  if (!path) return doc;
  let node = doc;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = node[segment];
  }
  return node;
}

/* --------------------------------------------------------- invert, classify */

function invert(ops) {
  return (Array.isArray(ops) ? ops : [])
    .slice()
    .reverse()
    .map((op) => ({ ...op, before: op.after, after: op.before }));
}

function classify(ops) {
  const list = Array.isArray(ops) ? ops : [];
  return {
    substantive: list.filter((op) => SUBSTANTIVE_OPS.includes(op && op.t)),
    incidental: list.filter((op) => op && op.t === "meta"),
    derived: list.filter((op) => op && op.t === "derived"),
  };
}

module.exports = { diff, applyOps, invert, classify, sameEntity };
