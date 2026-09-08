/**
 * Smart folders: a rule over the library, evaluated per build.
 *
 * The evaluator is pure on purpose. Everything it needs about the world --
 * the folder tree, the current time -- arrives in `ctx`, so it can be tested
 * against plain objects with no DOM and no clock, and so the live "N builds
 * match" count in the editor is a synchronous array filter.
 *
 * This module must NOT import from folder-store.js: folder-store imports the
 * evaluator, and the reverse import would close a cycle.
 */

import { state } from "../state.js";
import { teamRootFor } from "../teams.js";

/** Values that arrive from persisted JSON, so nothing here may assume a shape. */
const asArray = (v) => (Array.isArray(v) ? v : null);
const asString = (v) => (typeof v === "string" ? v : null);

const lower = (v) => String(v ?? "").toLowerCase();

/** The elite specialization line, or "" when the build has none. */
function eliteSpecOf(build) {
  for (const s of build.specializations || []) {
    if (s && s.elite && s.name) return s.name;
  }
  return "";
}

/**
 * The folder plus every folder beneath it, as a Set of ids.
 *
 * folder-store.js has its own copy of this walk, but importing it here would
 * close an import cycle (folder-store -> smart-folders -> folder-store), and
 * this version reads the tree out of `ctx` rather than out of `state` so the
 * evaluator stays pure.
 */
function subtreeIds(folderId, folders) {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f && f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Milliseconds since epoch, or null when the stamp is missing or unparseable. */
function timestampMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

const DAY_MS = 86400000;

const DATE_OPS = {
  withinDays: (ms, value, _build, ctx) => {
    if (ms === null || typeof value !== "number" || !Number.isFinite(value)) return false;
    return ctx.now - ms <= value * DAY_MS;
  },
  olderThanDays: (ms, value, _build, ctx) => {
    if (ms === null || typeof value !== "number" || !Number.isFinite(value)) return false;
    return ctx.now - ms > value * DAY_MS;
  },
};

const LOCATION_OPS = {
  isUnfiled: (folderId) => !folderId,
  inFolder: (folderId, value, _build, ctx) => {
    const target = asString(value);
    if (!target || !folderId) return false;
    return subtreeIds(target, ctx.folders || []).has(folderId);
  },
  // The exact negation of inFolder, so an unfiled build satisfies it.
  notInFolder: (folderId, value, build, ctx) =>
    !LOCATION_OPS.inFolder(folderId, value, build, ctx),
};

const OWNERSHIP_OPS = {
  is: (ownership, value) => {
    const want = asString(value);
    if (want !== "mine" && want !== "sharedWithMe") return false;
    return ownership === want;
  },
};

/** isAnyOf / isNoneOf over a single scalar. */
const SCALAR_OPS = {
  isAnyOf: (val, value) => {
    const values = asArray(value);
    return values ? values.includes(val) : false;
  },
  isNoneOf: (val, value) => {
    const values = asArray(value);
    return values ? !values.includes(val) : false;
  },
};

/** contains / notContains over a string, case-insensitively. */
const TEXT_OPS = {
  contains: (val, value) => {
    const needle = asString(value);
    return needle === null ? false : lower(val).includes(needle.toLowerCase());
  },
  notContains: (val, value) => {
    const needle = asString(value);
    return needle === null ? false : !lower(val).includes(needle.toLowerCase());
  },
};

const TAG_OPS = {
  hasAnyOf: (tags, value) => {
    const values = asArray(value);
    return values ? values.some((t) => tags.includes(t)) : false;
  },
  hasAllOf: (tags, value) => {
    const values = asArray(value);
    return values ? values.every((t) => tags.includes(t)) : false;
  },
  hasNoneOf: (tags, value) => {
    const values = asArray(value);
    return values ? !values.some((t) => tags.includes(t)) : false;
  },
  isEmpty: (tags) => tags.length === 0,
  isNotEmpty: (tags) => tags.length > 0,
};

const BOOL_OPS = {
  isTrue: (val) => val === true,
  isFalse: (val) => val !== true,
};

/**
 * field -> { get(build, ctx), ops }.
 * Each op is `(extractedValue, conditionValue, build, ctx) => boolean`.
 */
const FIELDS = {
  profession: { get: (b) => b.profession || "", ops: SCALAR_OPS },
  eliteSpec: { get: (b) => eliteSpecOf(b), ops: SCALAR_OPS },
  gameMode: { get: (b) => b.gameMode || "pve", ops: SCALAR_OPS },
  tags: { get: (b) => (Array.isArray(b.tags) ? b.tags : []), ops: TAG_OPS },
  title: { get: (b) => b.title || "", ops: TEXT_OPS },
  notes: { get: (b) => b.notes || "", ops: TEXT_OPS },
  pinned: { get: (b) => b.pinned === true, ops: BOOL_OPS },
  location: { get: (b) => b.folderId || null, ops: LOCATION_OPS },
  // "Shared with me" means: it sits under a team root somebody else owns.
  ownership: {
    get: (b, ctx) => {
      const root = teamRootFor(b.folderId, ctx.folders || []);
      return root && root.role !== "owner" ? "sharedWithMe" : "mine";
    },
    ops: OWNERSHIP_OPS,
  },
  team: {
    get: (b, ctx) => teamRootFor(b.folderId, ctx.folders || [])?.teamId || "",
    ops: SCALAR_OPS,
  },
  updatedAt: { get: (b) => timestampMs(b.updatedAt), ops: DATE_OPS },
  createdAt: { get: (b) => timestampMs(b.createdAt), ops: DATE_OPS },
};

function evaluateCondition(node, build, ctx) {
  const field = FIELDS[node.field];
  if (!field) return false;
  const op = field.ops[node.op];
  if (typeof op !== "function") return false;
  try {
    return op(field.get(build, ctx), node.value, build, ctx) === true;
  } catch {
    return false;
  }
}

/** Recurse on groups, dispatch on conditions. Anything else is false. */
export function evaluateNode(node, build, ctx) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "group") {
    const children = Array.isArray(node.children) ? node.children : [];
    // No conditions means no constraint -- this is how Main Repository works.
    if (children.length === 0) return true;
    return node.match === "any"
      ? children.some((c) => evaluateNode(c, build, ctx))
      : children.every((c) => evaluateNode(c, build, ctx));
  }
  if (node.type === "condition") return evaluateCondition(node, build, ctx);
  return false;
}

/** Does this build belong in this smart folder? @param ctx {{folders, now}} */
export function matchesSmartFolder(smartFolder, build, ctx) {
  if (!smartFolder || !smartFolder.rule || !build) return false;
  return evaluateNode(smartFolder.rule, build, ctx);
}

/**
 * The evaluation context for the running app. Tests build their own instead,
 * which is the whole reason `now` is a value here rather than a Date.now()
 * call inside the operators.
 */
export function ruleContext() {
  return { folders: state.folders || [], now: Date.now() };
}
