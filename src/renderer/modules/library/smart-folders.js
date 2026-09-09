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

/**
 * What "shared" can mean for a build. Every value is keyed on the team root
 * the build sits under, because authorship is not reachable from the renderer
 * -- `createdBy` lives in main's sync state, and only for synced records. So
 * these describe WHERE a build lives, never who wrote it: a teammate's build
 * in a team you own is `sharedByMe`, not `sharedWithMe`.
 *
 * The editor renders its Ownership select straight off this list, so adding a
 * value here is the only edit a new one needs.
 */
export const OWNERSHIP_VALUES = Object.freeze([
  { value: "personal", label: "Personal" },
  { value: "sharedByMe", label: "Shared by me" },
  { value: "sharedWithMe", label: "Shared with me" },
]);

const OWNERSHIP_SET = new Set(OWNERSHIP_VALUES.map((o) => o.value));

/**
 * Display name for a game mode id. Lives beside the rule vocabulary because
 * the sidebar, the table view and the rule editor all label the same stored
 * values, and three private copies had already started to drift.
 */
export function gameModeLabel(mode) {
  if (mode === "pve") return "PvE";
  if (mode === "pvp") return "PvP";
  if (mode === "wvw") return "WvW";
  return mode || "PvE";
}

const OWNERSHIP_OPS = {
  is: (ownership, value) => {
    const want = asString(value);
    if (!OWNERSHIP_SET.has(want)) return false;
    return ownership === want;
  },
  // Not the negation of an unknown value: an unrecognised value is false under
  // both ops, so a malformed rule matches nothing rather than everything.
  isNot: (ownership, value) => {
    const want = asString(value);
    if (!OWNERSHIP_SET.has(want)) return false;
    return ownership !== want;
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
  // Which side of a team space a build sits on. @see OWNERSHIP_VALUES
  ownership: {
    get: (b, ctx) => {
      const root = teamRootFor(b.folderId, ctx.folders || []);
      if (!root) return "personal";
      return root.role === "owner" ? "sharedByMe" : "sharedWithMe";
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

// ─── Built-ins ─────────────────────────────────────────────────────────────────

const group = (children, match = "all") => ({ type: "group", match, children });
const when = (field, op, value) => ({ type: "condition", field, op, value });

/**
 * Built-ins are code, not persisted rows. That way improving one of these
 * rules in a later release reaches everybody -- the only thing we persist
 * about them is which ones the user has hidden.
 */
export const BUILTIN_SMART_FOLDERS = Object.freeze([
  { id: "__sf-main", name: "Main Repository", icon: "folderOpen", builtin: true, rule: group([]) },
  { id: "__sf-recent", name: "Recently Modified", icon: "clock", builtin: true, rule: group([when("updatedAt", "withinDays", 14)]) },
  // Both sides of every team space. "Shared with me" alone would hide the
  // builds teammates file into a team you own, which is most of what an owner
  // wants to see here.
  { id: "__sf-shared", name: "Shared", icon: "share", builtin: true, rule: group([when("ownership", "isNot", "personal")]) },
  { id: "__sf-unfiled", name: "Unfiled", icon: "bars", builtin: true, rule: group([when("location", "isUnfiled")]) },
  { id: "__sf-untagged", name: "Untagged", icon: "tag", builtin: true, rule: group([when("tags", "isEmpty")]) },
]);

// ─── Persistence ───────────────────────────────────────────────────────────────

const SETTING_FOLDERS = "library.smartFolders";
const SETTING_OVERRIDES = "library.smartFolderOverrides";

// The sidebar renders synchronously, so the persisted state is cached here and
// listSmartFolders() reads the cache rather than awaiting the settings store.
let _userFolders = [];
let _hidden = new Set();

// A failed *read* leaves the caches empty because we could not see the user's
// records, not because they have none -- so the next write must not persist
// that emptiness over them. These flags latch on a read failure and clear on
// the next successful load.
let _foldersLoadFailed = false;
let _overridesLoadFailed = false;

/** A record is usable only if we can address it and evaluate it. */
function isWellFormed(sf) {
  return Boolean(
    sf && typeof sf === "object" && typeof sf.id === "string" && sf.id && sf.rule && typeof sf.rule === "object",
  );
}

/** Read persisted smart folders into the cache. Safe to call more than once. */
export async function loadSmartFolders() {
  _userFolders = [];
  _hidden = new Set();
  _foldersLoadFailed = false;
  _overridesLoadFailed = false;
  try {
    const raw = await window.desktopApi.getSetting(SETTING_FOLDERS);
    if (Array.isArray(raw)) _userFolders = raw.filter(isWellFormed);
  } catch {
    // A library that opens with only the built-ins beats one that does not open.
    _foldersLoadFailed = true;
  }
  try {
    const raw = await window.desktopApi.getSetting(SETTING_OVERRIDES);
    if (raw && Array.isArray(raw.hidden)) _hidden = new Set(raw.hidden.filter((id) => typeof id === "string"));
  } catch {
    // Same.
    _overridesLoadFailed = true;
  }
}

// Unlike loadSmartFolders()'s reads, a write failure here is NOT swallowed --
// the caller (the rule editor) needs it to keep its modal open and tell the
// user the save did not stick, rather than reporting success on a folder that
// only exists in this session's memory.
//
// The caches are also only replaced once the write lands, so a refused or
// failed write leaves memory and disk agreeing with each other.
async function persistFolders(next) {
  if (_foldersLoadFailed) {
    throw new Error("Could not read your saved smart folders — not overwriting them.");
  }
  await window.desktopApi.setSetting(SETTING_FOLDERS, next);
  _userFolders = next;
}

async function persistOverrides(next) {
  if (_overridesLoadFailed) {
    throw new Error("Could not read your smart folder settings — not overwriting them.");
  }
  await window.desktopApi.setSetting(SETTING_OVERRIDES, { hidden: [...next] });
  _hidden = next;
}

/** Built-ins the user has not hidden, then their own, in creation order. */
export function listSmartFolders() {
  return [...BUILTIN_SMART_FOLDERS.filter((f) => !_hidden.has(f.id)), ..._userFolders];
}

/** Resolve by id, including built-ins the user has hidden. */
export function getSmartFolder(id) {
  return (
    BUILTIN_SMART_FOLDERS.find((f) => f.id === id) || _userFolders.find((f) => f.id === id) || null
  );
}

function newId() {
  return `sf_${Math.random().toString(36).slice(2, 10)}`;
}

/** Create when `sf.id` is absent, update in place otherwise. */
export async function saveSmartFolder(sf) {
  const record = { ...sf, id: sf.id || newId(), builtin: false };
  const next = [..._userFolders];
  const at = next.findIndex((f) => f.id === record.id);
  if (at >= 0) next[at] = record;
  else next.push(record);
  await persistFolders(next);
  return record;
}

export async function deleteSmartFolder(id) {
  await persistFolders(_userFolders.filter((f) => f.id !== id));
}

export async function setBuiltinHidden(id, hidden) {
  const next = new Set(_hidden);
  if (hidden) next.add(id);
  else next.delete(id);
  await persistOverrides(next);
}
