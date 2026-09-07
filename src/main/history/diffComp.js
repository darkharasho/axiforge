"use strict";

// Structural differ for comp documents — the comp-side mirror of
// `diffBuild.js`, exposing the same four functions so `historyStore.js` stays
// differ-agnostic.
//
// The one rule that shapes everything here: a comp is NOT walked into its
// builds. A saved comp is a couple of megabytes, almost all of it per-slot
// build data that the comp merely references, and a slot swap has to stay a
// small patch. So `partyLines[i].slots[j]` is compared POSITIONALLY as an
// opaque value — a build id, a `tag:<categoryId>` category, null, or (in older
// records) a whole embedded build object. Whatever it is, swapping it is one
// op carrying the old and new value.
//
// The conventions from diffBuild.js hold here too:
//   * `undefined` means "the key is absent", `null` means "present and null";
//     `applyOps` deletes on the first and assigns on the second.
//   * known paths get a domain op, everything else gets a `raw` op, so the
//     round-trip invariant holds for keys nobody planned for.

const {
  IGNORED_FIELDS,
  SUBSTANTIVE_OPS,
  INCIDENTAL_PATHS,
  NON_VERSIONED_PATHS,
} = require("./constants");

// Comp content the user chose. `buildIds` is the membership list the party
// lines draw from, so a change to it is a real edit even when no slot moved.
const FIELD_PATHS = [
  "name",
  "notes",
  "tags",
  "gameMode",
  "buildIds",
  "categories",
  "buildColors",
];

const KNOWN_TOP_LEVEL = new Set([
  ...FIELD_PATHS,
  ...INCIDENTAL_PATHS,
  ...NON_VERSIONED_PATHS,
  "partyLines",
]);

// Keys on a party line that the slot ops already cover.
const LINE_WALKED_KEYS = new Set(["slots"]);

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

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

// Ops carry copies, never references into the documents they came from.
function emit(ops, op) {
  ops.push({ ...op, before: clone(op.before), after: clone(op.after) });
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
      emit(ops, { t: "field", path, before: b[path], after: a[path] });
    }
  }

  diffPartyLines(ops, b.partyLines, a.partyLines);

  for (const path of INCIDENTAL_PATHS) {
    if (!deepEqual(b[path], a[path])) {
      emit(ops, { t: "meta", path, before: b[path], after: a[path] });
    }
  }

  for (const path of NON_VERSIONED_PATHS) {
    if (!deepEqual(b[path], a[path])) {
      emit(ops, { t: "derived", path, before: b[path], after: a[path] });
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
      emit(ops, { t: "raw", path, before: b[path], after: a[path] });
    }
  }

  return ops;
}

function diffPartyLines(ops, beforeLines, afterLines) {
  if (deepEqual(beforeLines, afterLines)) return;
  // Only walk when both sides really are the array. If one is absent, null, or
  // some other shape, the container itself is the unit of change: deleting its
  // children one by one would leave an empty shell behind.
  if (!Array.isArray(beforeLines) || !Array.isArray(afterLines)) {
    emit(ops, { t: "raw", path: "partyLines", before: beforeLines, after: afterLines });
    return;
  }
  for (let line = 0; line < Math.max(beforeLines.length, afterLines.length); line += 1) {
    diffLine(ops, line, beforeLines[line], afterLines[line]);
  }
}

function diffLine(ops, line, beforeLine, afterLine) {
  if (deepEqual(beforeLine, afterLine)) return;
  const b = beforeLine;
  const a = afterLine;
  // A line added, removed, or replaced wholesale travels as one raw op. Same
  // reasoning as the container above, and it keeps `invert` symmetric.
  if (!isObject(b) || !isObject(a) || !Array.isArray(b.slots) || !Array.isArray(a.slots)) {
    emit(ops, { t: "raw", path: `partyLines.${line}`, before: b, after: a });
    return;
  }

  for (let index = 0; index < Math.max(b.slots.length, a.slots.length); index += 1) {
    if (deepEqual(b.slots[index], a.slots[index])) continue;
    emit(ops, { t: "slot", line, index, before: b.slots[index], after: a.slots[index] });
  }

  // The line's own attributes (id, capacity, name, ...) are not slots and are
  // not comp-level fields; they round-trip as raw ops so nothing is dropped.
  for (const key of sortedUnionKeys(b, a)) {
    if (LINE_WALKED_KEYS.has(key) || deepEqual(b[key], a[key])) continue;
    emit(ops, { t: "raw", path: `partyLines.${line}.${key}`, before: b[key], after: a[key] });
  }
}

/* ----------------------------------------------------------------- applyOps */

function applyOps(doc, ops) {
  const out = clone(isObject(doc) ? doc : {});
  // Deleting an array element in place would leave a hole, and later ops in the
  // same patch still need the element to write into, so removals are collected
  // and the arrays compacted once at the end.
  const removals = new Map();
  for (const op of Array.isArray(ops) ? ops : []) applyOp(out, op, removals);
  // Deepest paths first: compacting `partyLines` before `partyLines.0.slots`
  // would renumber the line the pending slot removal names.
  const paths = [...removals.keys()].sort((x, y) => y.split(".").length - x.split(".").length);
  for (const path of paths) {
    const arr = getPath(out, path);
    if (Array.isArray(arr)) {
      const drop = removals.get(path);
      assign(out, path.split("."), arr.filter((_, i) => !drop.has(i)));
    }
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
    case "slot":
      set(doc, ["partyLines", String(op.line), "slots", String(op.index)], op.after, removals);
      break;
    default:
      break;
  }
}

/* -------------------------------------------------------------- path writes */

function set(doc, segments, value, removals) {
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
  assign(doc, segments, clone(value));
}

function assign(doc, segments, value) {
  let node = doc;
  for (let i = 0; i < segments.length - 1; i += 1) {
    node = ensureChild(node, segments[i], isIndexKey(segments[i + 1]) ? "array" : "object");
  }
  node[segments[segments.length - 1]] = value;
}

// `kind` is a GUESS from whether the next path segment looks like an index;
// the document is not. Whatever container is already there wins — on
// `partyLines.0.0` the guess said "array" and replaced the whole party line
// with `["x"]`. @see the same fix in diffBuild.js.
function ensureChild(node, key, kind) {
  const current = node[key];
  if (Array.isArray(current) || isObject(current)) return current;
  node[key] = kind === "array" ? [] : {};
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

module.exports = { diff, applyOps, invert, classify };
