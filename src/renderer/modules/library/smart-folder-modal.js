// Smart Folder rule editor — create/edit a personal smart folder.
//
// Structured exactly like share-modal.js: a module-level `_overlay` built once
// and appended to document.body, an `open` that installs a working copy of the
// record (`_draft`) and calls `_render()`, a `_render()` that rewrites
// `#sfm-body`'s innerHTML from `_draft`, and delegated click/change/input
// listeners on the body rather than one per control (controls are rebuilt on
// every render, so per-control listeners would leak).

import { escapeHtml } from "../utils.js";
import { state } from "../state.js";
import { libraryBuilds, libraryFolders } from "./folder-store.js";
import {
  matchesSmartFolder, ruleContext, saveSmartFolder, deleteSmartFolder,
  OWNERSHIP_VALUES, gameModeLabel,
} from "./smart-folders.js";
import { getProfessionSvg } from "../profession-icons.js";
import { tagIcon, userGroupIcon, globeAltIcon } from "./heroicons.js";

/**
 * The editor's vocabulary. It must stay in step with FIELDS in
 * smart-folders.js -- a field offered here that the evaluator does not know
 * silently matches nothing.
 */
export const FIELD_DEFS = [
  { field: "profession", label: "Profession", ops: [
    { op: "isAnyOf", label: "is any of", valueKind: "multi" },
    { op: "isNoneOf", label: "is none of", valueKind: "multi", negative: true },
  ]},
  { field: "eliteSpec", label: "Elite Spec", ops: [
    { op: "isAnyOf", label: "is any of", valueKind: "multi" },
    { op: "isNoneOf", label: "is none of", valueKind: "multi", negative: true },
  ]},
  { field: "gameMode", label: "Game Mode", ops: [
    { op: "isAnyOf", label: "is any of", valueKind: "multi" },
    { op: "isNoneOf", label: "is none of", valueKind: "multi", negative: true },
  ]},
  { field: "tags", label: "Tags", ops: [
    { op: "hasAnyOf", label: "has any of", valueKind: "multi" },
    { op: "hasAllOf", label: "has all of", valueKind: "multi" },
    { op: "hasNoneOf", label: "has none of", valueKind: "multi", negative: true },
    { op: "isEmpty", label: "is empty", valueKind: "none" },
    { op: "isNotEmpty", label: "is not empty", valueKind: "none" },
  ]},
  { field: "title", label: "Title", ops: [
    { op: "contains", label: "contains", valueKind: "text" },
    { op: "notContains", label: "does not contain", valueKind: "text", negative: true },
  ]},
  { field: "notes", label: "Notes", ops: [
    { op: "contains", label: "contains", valueKind: "text" },
    { op: "notContains", label: "does not contain", valueKind: "text", negative: true },
  ]},
  { field: "location", label: "Location", ops: [
    { op: "isUnfiled", label: "is unfiled", valueKind: "none" },
    { op: "inFolder", label: "is in folder", valueKind: "folder" },
    { op: "notInFolder", label: "is not in folder", valueKind: "folder", negative: true },
  ]},
  { field: "ownership", label: "Ownership", ops: [
    { op: "is", label: "is", valueKind: "ownership" },
    { op: "isNot", label: "is not", valueKind: "ownership", negative: true },
  ]},
  { field: "team", label: "Team", ops: [
    { op: "isAnyOf", label: "is any of", valueKind: "team" },
    { op: "isNoneOf", label: "is none of", valueKind: "team", negative: true },
  ]},
  { field: "updatedAt", label: "Updated", ops: [
    { op: "withinDays", label: "within last", valueKind: "number" },
    { op: "olderThanDays", label: "older than", valueKind: "number" },
  ]},
  { field: "createdAt", label: "Created", ops: [
    { op: "withinDays", label: "within last", valueKind: "number" },
    { op: "olderThanDays", label: "older than", valueKind: "number" },
  ]},
  { field: "pinned", label: "Pinned", ops: [
    { op: "isTrue", label: "is pinned", valueKind: "none" },
    { op: "isFalse", label: "is not pinned", valueKind: "none" },
  ]},
];

/** The ownership values the evaluator accepts -- anything else is false. */
const OWNERSHIP_OPTIONS = OWNERSHIP_VALUES;

function fieldDef(field) {
  return FIELD_DEFS.find((f) => f.field === field) || null;
}

function opDef(field, op) {
  return fieldDef(field)?.ops.find((o) => o.op === op) || null;
}

/** Default value per `valueKind` when a field changes. */
function defaultValueFor(valueKind) {
  switch (valueKind) {
    case "multi":
    case "team": return [];
    case "text": return "";
    case "number": return 14;
    case "folder": return null;
    case "ownership": return "personal";
    default: return undefined;   // "none"
  }
}

/**
 * Options for a value control, harvested from the browsable library (or, for
 * ownership/team, a fixed vocabulary the evaluator itself defines). Always
 * `{ value, label }` pairs so every multi-valued control renders the same way.
 */
function optionsFor(field) {
  const builds = libraryBuilds();
  if (field === "profession") {
    return [...new Set(builds.map((b) => b.profession).filter(Boolean))].sort().map((v) => ({ value: v, label: v }));
  }
  if (field === "eliteSpec") {
    const specs = new Set();
    for (const b of builds) for (const s of b.specializations || []) if (s?.elite && s.name) specs.add(s.name);
    return [...specs].sort().map((v) => ({ value: v, label: v }));
  }
  if (field === "gameMode") {
    return [...new Set(builds.map((b) => b.gameMode || "pve"))].sort().map((v) => ({ value: v, label: gameModeLabel(v) }));
  }
  if (field === "tags") {
    return [...new Set(builds.flatMap((b) => b.tags || []).filter(Boolean))].sort().map((v) => ({ value: v, label: v }));
  }
  if (field === "ownership") return OWNERSHIP_OPTIONS;
  if (field === "team") {
    return (state.teams || []).map((t) => ({ value: t.team.id, label: t.team.name }));
  }
  return [];
}

/**
 * The glyph beside an option. Professions and elite specs share one lookup --
 * gw2-class-icons keys both off the line's name -- so "Firebrand" resolves the
 * same way whether it arrived as a profession or as a spec. Fields with no
 * visual vocabulary get a category glyph rather than nothing, so every row in
 * a list lines up on the same left edge.
 */
function optionIcon(field, label) {
  if (field === "profession" || field === "eliteSpec") return getProfessionSvg(label) || "";
  if (field === "gameMode") return globeAltIcon;
  if (field === "tags") return tagIcon;
  if (field === "team") return userGroupIcon;
  return "";
}

/** Folders the "is in folder" / "is not in folder" ops can point at. */
function folderOptions() {
  return libraryFolders().map((f) => ({ value: f.id, label: f.name }));
}

/** The live "N of M builds match" count, recomputed on every render. */
function matchCount(rule) {
  const sf = { id: "__preview", name: "", rule };
  const ctx = ruleContext();
  return libraryBuilds().filter((b) => matchesSmartFolder(sf, b, ctx)).length;
}

/**
 * A row is complete when its operator needs no value, or carries one of the
 * shape that operator actually evaluates. Checking `valueKind` rather than the
 * runtime typeof is what stops a shape mismatch -- the number field holding the
 * string "30", say -- from being saved as a rule that matches nothing.
 */
function isComplete(cond) {
  const def = opDef(cond.field, cond.op);
  if (!def) return false;
  switch (def.valueKind) {
    case "none": return true;
    case "multi":
    case "team": return Array.isArray(cond.value) && cond.value.length > 0;
    case "text": return typeof cond.value === "string" && cond.value.trim() !== "";
    case "number": return typeof cond.value === "number" && Number.isFinite(cond.value);
    case "folder": return typeof cond.value === "string" && cond.value !== "";
    case "ownership": return OWNERSHIP_OPTIONS.some((o) => o.value === cond.value);
    default: return false;
  }
}

function blankCondition() {
  const def = FIELD_DEFS[0];
  const op = def.ops[0];
  return { type: "condition", field: def.field, op: op.op, value: defaultValueFor(op.valueKind) };
}

/** A defensive copy so editing the draft never touches the caller's record
 * (built-ins are shared, frozen-array objects; a saved record may be reused
 * by the caller after this modal closes). */
function cloneRule(rule) {
  const children = Array.isArray(rule?.children) ? rule.children : [];
  return {
    type: "group",
    match: rule?.match === "any" ? "any" : "all",
    children: children
      .filter((c) => c && c.type === "condition")
      .map((c) => ({ type: "condition", field: c.field, op: c.op, value: Array.isArray(c.value) ? [...c.value] : c.value })),
  };
}

let _overlay = null;
let _callbacks = {};
let _draft = null;
let _escHandler = null;

export function initSmartFolderModal(callbacks) {
  if (typeof document === "undefined") return;
  // Set the callbacks before the early return -- a second init() call (the
  // test suite issues one per test) must still pick up fresh callbacks even
  // though the overlay itself is built only once. Only when the caller
  // actually supplied some, though: openSmartFolderModal()'s bare init() call
  // must not wipe the ones the app installed at startup.
  if (callbacks) _callbacks = callbacks;
  if (_overlay) {
    // Tests reset document.body between cases; reattach if we got orphaned.
    if (!document.body.contains(_overlay)) document.body.appendChild(_overlay);
    return;
  }

  _overlay = document.createElement("div");
  _overlay.className = "sfm-overlay sfm-overlay--hidden";
  _overlay.innerHTML = `
    <div class="sfm" role="dialog" aria-modal="true" aria-labelledby="sfm-title">
      <div class="sfm__header">
        <h3 class="sfm__title" id="sfm-title">Smart Folder</h3>
        <button class="sfm__close" id="sfm-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="sfm__body" id="sfm-body"></div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _overlay.querySelector("#sfm-close").addEventListener("click", closeSmartFolderModal);
  _overlay.addEventListener("mousedown", (e) => {
    if (e.target === _overlay) closeSmartFolderModal();
  });

  const body = _overlay.querySelector("#sfm-body");
  body.addEventListener("click", _onClick);
  body.addEventListener("change", _onChange);
  body.addEventListener("input", _onInput);
}

/**
 * @param {object|null} smartFolderOrNull `null` opens a blank new folder.
 *   A record without an `id` (e.g. the AI-suggested rule handed in by a later
 *   task) also opens as new -- there is nothing to update in the store yet.
 */
export function openSmartFolderModal(smartFolderOrNull) {
  if (!_overlay) initSmartFolderModal();
  if (!_overlay) return;

  _draft = smartFolderOrNull
    ? { ...smartFolderOrNull, name: smartFolderOrNull.name || "", rule: cloneRule(smartFolderOrNull.rule) }
    : { name: "", icon: "funnel", rule: { type: "group", match: "all", children: [blankCondition()] } };

  _overlay.classList.remove("sfm-overlay--hidden");
  if (_escHandler) document.removeEventListener("keydown", _escHandler);
  _escHandler = (e) => { if (e.key === "Escape") closeSmartFolderModal(); };
  document.addEventListener("keydown", _escHandler);

  _render();
}

export function closeSmartFolderModal() {
  if (!_overlay) return;
  _overlay.classList.add("sfm-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
  _draft = null;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function _render() {
  if (!_overlay || !_draft) return;
  const body = _overlay.querySelector("#sfm-body");
  const title = _overlay.querySelector("#sfm-title");
  const rule = _draft.rule;
  const canDelete = Boolean(_draft.id) && !_draft.builtin;

  title.textContent = _draft.id ? "Edit Smart Folder" : "New Smart Folder";

  const conditionsHtml = rule.children.map((c, i) => _renderCondition(c, i)).join("")
    || `<p class="sfm__hint">No conditions -- every build matches.</p>`;

  const matched = matchCount(rule);
  const total = libraryBuilds().length;

  body.innerHTML = `
    <div class="sfm__field">
      <label for="sfm-name">Name</label>
      <input type="text" id="sfm-name" value="${escapeHtml(_draft.name)}" placeholder="Smart folder name">
    </div>
    <div class="sfm__match-row">
      <span>Match</span>
      <select id="sfm-match">
        <option value="all" ${rule.match !== "any" ? "selected" : ""}>all</option>
        <option value="any" ${rule.match === "any" ? "selected" : ""}>any</option>
      </select>
      <span>of the following:</span>
    </div>
    <div class="sfm__conditions">${conditionsHtml}</div>
    <button type="button" id="sfm-add-cond" class="sfm__btn sfm__btn--add">+ Add condition</button>
    <div id="sfm-status" class="sfm__status"></div>
    <div class="sfm__footer">
      <div class="sfm__count">Matches <span id="sfm-count">${matched}</span> of <span id="sfm-total">${total}</span> builds</div>
      <div class="sfm__actions">
        ${canDelete ? `<button type="button" id="sfm-delete" class="sfm__btn sfm__btn--danger">Delete</button>` : ""}
        <button type="button" id="sfm-cancel" class="sfm__btn">Cancel</button>
        <button type="button" id="sfm-save" class="sfm__btn sfm__btn--primary">Save</button>
      </div>
    </div>
  `;
}

function _renderCondition(cond, index) {
  const def = fieldDef(cond.field) || FIELD_DEFS[0];
  const op = opDef(cond.field, cond.op) || def.ops[0];
  const negative = Boolean(op?.negative);
  // A multi-valued list gets its own full-width row; the card has to say so.
  const multi = op?.valueKind === "multi" || op?.valueKind === "team";

  const fieldOptions = FIELD_DEFS.map((f) => `<option value="${f.field}" ${f.field === cond.field ? "selected" : ""}>${escapeHtml(f.label)}</option>`).join("");
  const opOptions = def.ops.map((o) => `<option value="${o.op}" ${o.op === cond.op ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");

  return `
    <div class="sfm-cond${multi ? " sfm-cond--multi" : ""}${negative ? " sfm-cond--negative" : ""}" data-cond-index="${index}">
      <select class="sfm-cond__field" data-cond-field>${fieldOptions}</select>
      <select class="sfm-cond__op" data-cond-op>${opOptions}</select>
      ${_renderValueControl(cond, op)}
      <button type="button" class="sfm-cond__remove" data-cond-remove aria-label="Remove condition">×</button>
    </div>
  `;
}

function _renderValueControl(cond, op) {
  if (!op || op.valueKind === "none") return "";

  if (op.valueKind === "multi" || op.valueKind === "team") {
    // Not a <select multiple>: an <option> cannot carry a profession icon, and
    // ctrl-clicking a native listbox loses the whole selection on a stray
    // click. These are toggle buttons, so every row is one click and the icon
    // makes a long spec list scannable.
    const options = optionsFor(cond.field);
    const selected = Array.isArray(cond.value) ? cond.value : [];
    if (options.length === 0) {
      return `<div class="sfm-opts sfm-opts--empty" data-cond-value data-cond-multi role="listbox" aria-multiselectable="true">
        <span class="sfm-opts__empty">Nothing in your library to choose from yet.</span>
      </div>`;
    }
    const optionsHtml = options.map((o) => {
      const on = selected.includes(o.value);
      const icon = optionIcon(cond.field, o.label);
      return `<button type="button" role="option" aria-selected="${on}"
        class="sfm-opt${on ? " sfm-opt--on" : ""}" data-opt-value="${escapeHtml(o.value)}">
        <span class="sfm-opt__icon">${icon}</span>
        <span class="sfm-opt__label">${escapeHtml(o.label)}</span>
      </button>`;
    }).join("");
    return `<div class="sfm-opts" data-cond-value data-cond-multi role="listbox" aria-multiselectable="true">${optionsHtml}</div>`;
  }

  if (op.valueKind === "ownership") {
    const optionsHtml = OWNERSHIP_OPTIONS.map((o) => `<option value="${escapeHtml(o.value)}" ${cond.value === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
    return `<select class="sfm-cond__value" data-cond-value>${optionsHtml}</select>`;
  }

  if (op.valueKind === "folder") {
    const options = folderOptions();
    const optionsHtml = `<option value="">Choose a folder…</option>` + options.map((o) => `<option value="${escapeHtml(o.value)}" ${cond.value === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
    return `<select class="sfm-cond__value" data-cond-value>${optionsHtml}</select>`;
  }

  if (op.valueKind === "text") {
    return `<input type="text" class="sfm-cond__value" data-cond-value value="${escapeHtml(cond.value || "")}">`;
  }

  if (op.valueKind === "number") {
    return `
      <span class="sfm-num-wrap">
        <input type="number" class="sfm-cond__value sfm-num-input" data-cond-value value="${Number.isFinite(cond.value) ? cond.value : ""}">
        <span class="sfm-unit">days</span>
      </span>
    `;
  }

  return "";
}

// ─── Events ──────────────────────────────────────────────────────────────────

function _rowIndex(target) {
  const row = target.closest("[data-cond-index]");
  return row ? Number(row.dataset.condIndex) : -1;
}

function _onClick(e) {
  if (e.target.closest("#sfm-add-cond")) {
    _draft.rule.children.push(blankCondition());
    _render();
    return;
  }
  const removeBtn = e.target.closest("[data-cond-remove]");
  if (removeBtn) {
    const i = _rowIndex(removeBtn);
    if (i >= 0) _draft.rule.children.splice(i, 1);
    _render();
    return;
  }
  const opt = e.target.closest("[data-opt-value]");
  if (opt) { _toggleOption(opt); return; }
  if (e.target.closest("#sfm-save")) { _handleSave(); return; }
  if (e.target.closest("#sfm-cancel")) { closeSmartFolderModal(); return; }
  if (e.target.closest("#sfm-delete")) { _handleDelete(); return; }
}

function _onChange(e) {
  if (e.target.id === "sfm-match") {
    _draft.rule.match = e.target.value === "any" ? "any" : "all";
    _render();
    return;
  }

  if (e.target.matches("[data-cond-field]")) {
    const i = _rowIndex(e.target);
    const cond = _draft.rule.children[i];
    if (!cond) return;
    const def = fieldDef(e.target.value) || FIELD_DEFS[0];
    const op = def.ops[0];
    cond.field = def.field;
    cond.op = op.op;
    cond.value = defaultValueFor(op.valueKind);
    _render();
    return;
  }

  if (e.target.matches("[data-cond-op]")) {
    const i = _rowIndex(e.target);
    const cond = _draft.rule.children[i];
    if (!cond) return;
    const oldOp = opDef(cond.field, cond.op);
    const newOp = opDef(cond.field, e.target.value);
    if (!newOp) return;
    cond.op = newOp.op;
    // Only reset the value when the shape it needs actually changed (e.g.
    // text -> none). Switching "is any of" <-> "is none of" keeps the same
    // picked values -- that's the whole point of offering both.
    if (!oldOp || oldOp.valueKind !== newOp.valueKind) {
      cond.value = defaultValueFor(newOp.valueKind);
    }
    _render();
    return;
  }

  if (e.target.matches("[data-cond-value]")) {
    const i = _rowIndex(e.target);
    const cond = _draft.rule.children[i];
    if (!cond) return;
    _readValueControl(e.target, cond);
    if (e.target.tagName === "SELECT") {
      // Selects do not fire `change` on blur, so a full re-render here cannot
      // pull the ground out from under a click that is already in flight.
      _render();
      return;
    }
    // Text and number inputs DO fire `change` on blur -- which happens on the
    // mousedown of the Save click. Re-rendering would replace #sfm-save
    // between mousedown and mouseup, so the click event never reaches it and
    // the first Save press is silently swallowed. Refresh only the live count.
    _refreshCount();
  }
}

/**
 * Toggle one option of a multi-valued condition, in place.
 *
 * Deliberately not a re-render: the option list scrolls, and rebuilding the
 * body would jump it back to the top on every pick -- the exact motion that
 * makes selecting six specs in a row unpleasant. Nothing else on the card
 * depends on which options are on, so only the live count needs refreshing.
 */
function _toggleOption(btn) {
  const i = _rowIndex(btn);
  const cond = _draft?.rule.children[i];
  if (!cond) return;
  const value = btn.dataset.optValue;
  const current = Array.isArray(cond.value) ? cond.value : [];
  const on = !current.includes(value);
  cond.value = on ? [...current, value] : current.filter((v) => v !== value);
  btn.classList.toggle("sfm-opt--on", on);
  btn.setAttribute("aria-selected", String(on));
  _refreshCount();
}

/** Read a value control into its condition, coercing number inputs. */
function _readValueControl(el, cond) {
  if (el.type === "number") {
    // HTMLInputElement.value is always a string; the date operators require a
    // real number, so an uncoerced "30" would match nothing.
    cond.value = el.value === "" ? NaN : Number(el.value);
  } else {
    cond.value = el.value;
  }
}

/** Update the footer counts in place, without rebuilding the body. */
function _refreshCount() {
  if (!_overlay || !_draft) return;
  const count = _overlay.querySelector("#sfm-count");
  const total = _overlay.querySelector("#sfm-total");
  if (count) count.textContent = String(matchCount(_draft.rule));
  if (total) total.textContent = String(libraryBuilds().length);
}

function _onInput(e) {
  if (e.target.id === "sfm-name") {
    _draft.name = e.target.value;
    return;
  }
  if (e.target.matches("[data-cond-value]")) {
    const i = _rowIndex(e.target);
    const cond = _draft.rule.children[i];
    if (!cond) return;
    _readValueControl(e.target, cond);
    // The live count is the thing that makes the builder learnable, so it
    // tracks every keystroke rather than waiting for blur.
    _refreshCount();
  }
}

async function _handleSave() {
  const name = _draft.name.trim();
  if (!name) {
    _setStatus("Give the smart folder a name.", true);
    return;
  }
  const children = _draft.rule.children.filter(isComplete);
  // saveSmartFolder mints the id for a brand-new folder and hands back the
  // record it actually persisted -- that is the id onSaved must carry, so we
  // pass the draft through as-is (with or without an id) and use the return
  // value rather than predicting the id ourselves.
  try {
    const saved = await saveSmartFolder({ ..._draft, name, rule: { ..._draft.rule, children } });
    _callbacks.onSaved?.(saved);
    closeSmartFolderModal();
  } catch (err) {
    _setStatus(err?.message || "Could not save this smart folder.", true);
  }
}

async function _handleDelete() {
  if (!_draft?.id) return;
  const id = _draft.id;
  try {
    await deleteSmartFolder(id);
    _callbacks.onDeleted?.(id);
    closeSmartFolderModal();
  } catch (err) {
    _setStatus(err?.message || "Could not delete this smart folder.", true);
  }
}

function _setStatus(message, isError = false) {
  const el = _overlay?.querySelector("#sfm-status");
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("sfm__status--error", Boolean(message) && isError);
}
