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
import { PROFESSION_WEIGHT } from "../constants.js";

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
 * Every weapon type the build equips, across both weapon sets and the aquatic
 * slots, as a deduplicated list of catalog ids ("greatsword").
 *
 * A list rather than a scalar because a build carries up to six, and the
 * question a user asks is "which of my builds run a staff" -- a `has any of`
 * over the whole loadout, not a per-slot match.
 */
function weaponsOf(build) {
  const slots = build.equipment?.weapons;
  if (!slots || typeof slots !== "object") return [];
  return [...new Set(Object.values(slots).filter((w) => typeof w === "string" && w !== ""))];
}

/**
 * Armor class, derived from the profession rather than stored -- GW2 fixes it
 * per profession, so a build has no say in it and nothing writes it down.
 */
function armorWeightOf(build) {
  return PROFESSION_WEIGHT[build.profession] || "";
}

/**
 * Every stat prefix the build uses: the per-slot labels plus the whole-build
 * package. Numeric statPackage values are ignored -- older records stored a
 * GW2 API stat id there, which is not a name a user would ever pick from a
 * list.
 */
function statsOf(build) {
  const out = new Set();
  const pkg = build.equipment?.statPackage;
  if (typeof pkg === "string" && pkg !== "" && !/^\d+$/.test(pkg)) out.add(pkg);
  const slots = build.equipment?.slots;
  if (slots && typeof slots === "object") {
    for (const v of Object.values(slots)) {
      if (typeof v === "string" && v !== "" && !/^\d+$/.test(v)) out.add(v);
    }
  }
  return [...out];
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
 * What "shared" can mean for a build.
 *
 * `personal` is about WHERE a build lives -- outside every team space. The two
 * shared values are about WHO WROTE IT, which is the only reading of those
 * labels that matches what they say. They used to be keyed on the team root's
 * role instead, and that made an owner's "Shared by me" mean "everything in a
 * team I own", teammates' builds and all, while "Shared with me" could never
 * match anything at all (#300).
 *
 * Authorship is not derivable in the renderer -- `createdBy` lives in main's
 * sync state -- so it arrives in `ctx.syncAuthors`. @see ownershipOf
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
/** The three GW2 armor classes, in the order the wiki lists them. */
export const ARMOR_WEIGHTS = Object.freeze([
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "heavy", label: "Heavy" },
]);

export function gameModeLabel(mode) {
  if (mode === "pve") return "PvE";
  if (mode === "pvp") return "PvP";
  if (mode === "wvw") return "WvW";
  return mode || "PvE";
}

/**
 * Did the asking user write this item? "unknown" is a real third answer, not a
 * shrug: it is what you get from a record the server returned with no creator,
 * or when there is no session to compare against, and the caller has to decide
 * rather than be told a confident wrong thing.
 *
 * A build with NO entry in the map has never been pushed, which can only be
 * true of one made on this machine -- so that reads as ours.
 *
 * @returns {"mine"|"theirs"|"unknown"}
 */
function authorshipOf(build, ctx) {
  // No identity to compare against -- sync is off, or the session never
  // loaded. "Never pushed, so it is ours" below is only sound when there is
  // someone for it to be ours to.
  const me = ctx.sessionUserId || null;
  if (!me) return "unknown";
  const authors = ctx.syncAuthors || {};
  if (!Object.prototype.hasOwnProperty.call(authors, build.id)) return "mine";
  const author = authors[build.id];
  if (!author) return "unknown";
  return author === me ? "mine" : "theirs";
}

/**
 * `personal` | `sharedByMe` | `sharedWithMe` for one build.
 *
 * Outside every team space is personal, whoever wrote it. Inside one it is the
 * author that decides -- and only when authorship cannot be resolved at all do
 * we fall back to the team's role, which is the pre-#300 answer and the best
 * guess left: in a team you own, an item with no known author is most likely
 * one of yours.
 */
function ownershipOf(build, ctx) {
  const root = teamRootFor(build.folderId, ctx.folders || []);
  if (!root) return "personal";
  const author = authorshipOf(build, ctx);
  if (author === "mine") return "sharedByMe";
  if (author === "theirs") return "sharedWithMe";
  return root.role === "owner" ? "sharedByMe" : "sharedWithMe";
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
  weapons: { get: (b) => weaponsOf(b), ops: TAG_OPS },
  stats: { get: (b) => statsOf(b), ops: TAG_OPS },
  armorWeight: { get: (b) => armorWeightOf(b), ops: SCALAR_OPS },
  title: { get: (b) => b.title || "", ops: TEXT_OPS },
  notes: { get: (b) => b.notes || "", ops: TEXT_OPS },
  pinned: { get: (b) => b.pinned === true, ops: BOOL_OPS },
  location: { get: (b) => b.folderId || null, ops: LOCATION_OPS },
  // @see ownershipOf
  ownership: { get: (b, ctx) => ownershipOf(b, ctx), ops: OWNERSHIP_OPS },
  team: {
    get: (b, ctx) => teamRootFor(b.folderId, ctx.folders || [])?.teamId || "",
    ops: SCALAR_OPS,
  },
  updatedAt: { get: (b) => timestampMs(b.updatedAt), ops: DATE_OPS },
  createdAt: { get: (b) => timestampMs(b.createdAt), ops: DATE_OPS },
};

/**
 * Every field name the evaluator understands. The editor's FIELD_DEFS is
 * checked against this, so a field added here without an editor entry -- or
 * offered there and unknown here, which silently matches nothing -- fails a
 * test rather than shipping.
 */
export const SUPPORTED_FIELDS = Object.freeze(Object.keys(FIELDS));

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

/**
 * Does this build belong in this smart folder?
 * @param ctx {{folders, now, sessionUserId?, syncAuthors?}} @see ruleContext
 */
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
  return {
    folders: state.folders || [],
    now: Date.now(),
    // Authorship, for the ownership field. Both are absent when sync is off,
    // which reads as "everything here is mine" rather than as somebody else's.
    sessionUserId: state.teamSession?.userId || null,
    syncAuthors: state.syncAuthors || {},
  };
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
  // Both sides of every team space, whoever wrote them. "Shared with me" alone
  // would hide your own contributions to a team, and "Shared by me" alone would
  // hide everything teammates file into a team you own -- which is most of what
  // an owner wants to see here.
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
