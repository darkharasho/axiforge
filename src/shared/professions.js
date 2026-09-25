/**
 * The nine professions and the colours they own.
 *
 * This is domain data, not style: a profession's colour belongs to Guild
 * Wars 2, not to the app's theme, and it does not change when the accent
 * does. RULES.md rule 10 is the reason it reaches CSS only through the
 * per-instance --axi-series / --axi-card-strip knobs rather than as a token
 * or a class — a stylesheet that named a profession would be a colour
 * literal in app CSS, and a token would put game data on the theme surface.
 *
 * It used to live in six places: two blocks in library.css, one in
 * comps.css, one in comp-list.js, one in renderer.js, and one more each in
 * src/site and packages/forge-render (both converting in batch 5). They had
 * already drifted — library.css's pills were the same hues at 15% opacity
 * over near-black, which rule 2 calls nine browns.
 *
 * What this file is NOT: the app's single home for domain colour. To be exact,
 * because the plan for this batch said colour would have "exactly one way into
 * the app" after the consolidation and that is not what shipped:
 *   - This file itself holds three tables, not one — PROFESSIONS' nine hues
 *     plus SLOT_ROLES (2) and TARGET_ROLES (5) below. It also hosts SLOT_ROLES
 *     despite being named professions.js.
 *   - src/renderer/modules/constants.js:430-455 holds nine more in
 *     COMBO_FIELD_COLORS / COMBO_FINISHER_COLORS, which reach --axi-series the
 *     same way these do.
 * What IS true after the consolidation: a profession's colour has exactly one
 * definition, and no app stylesheet names a profession. Consolidating the rest
 * is a cross-file palette decision (rule 10's answer past two series is the
 * accent against the neutral ramp, and ally-vs-self is a two-value
 * distinction); it is parked in docs/BACKLOG.md for batch 3.
 */

/** Canonical names, title-cased, in the game's own order. */
export const PROFESSIONS = Object.freeze([
  "Guardian",
  "Warrior",
  "Engineer",
  "Ranger",
  "Thief",
  "Elementalist",
  "Mesmer",
  "Necromancer",
  "Revenant",
]);

/**
 * Full strength, as rule 10 requires. These are the hues the app has always
 * used for a profession's icon (library.css:1720-1731); what changes in this
 * batch is that the tinted variants derived from them are gone.
 */
const COLOURS = Object.freeze({
  guardian: "#6ea8ff",
  warrior: "#ff9944",
  engineer: "#cc8844",
  ranger: "#77cc55",
  thief: "#cc6677",
  elementalist: "#dd5555",
  mesmer: "#b07acc",
  necromancer: "#4dca7a",
  revenant: "#aa6655",
});

/** What an unknown profession reads as. Not in COLOURS, so it is never a key. */
const UNKNOWN = "#888888";

/**
 * Normalise a profession name to its lookup key.
 * Tolerant because the import paths are: gw2skills has produced
 * "Elementalist " and ".axicode" files have produced lowercase.
 * @param {unknown} name
 * @returns {string} a key of COLOURS, or "" when the name is not one of the nine
 */
function key(name) {
  if (typeof name !== "string") return "";
  const k = name.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(COLOURS, k) ? k : "";
}

/**
 * The colour a profession owns, at full strength.
 * @param {unknown} name
 * @returns {string} always a hex string, never undefined
 */
export function professionColour(name) {
  const k = key(name);
  return k ? COLOURS[k] : UNKNOWN;
}

/** True when the name is one of the nine. */
export function isProfession(name) {
  return key(name) !== "";
}

/**
 * A `style` attribute body setting --axi-series, or "" for an unknown
 * profession so the element falls through to whatever neutral its own CSS
 * rule names in --axi-series's fallback (most consumers use a dim/faint
 * text colour; one nav-icon rule falls to the accent instead) rather than
 * this helper guessing a colour on its behalf.
 * @param {unknown} name
 * @returns {string}
 */
export function professionSeriesStyle(name) {
  const k = key(name);
  return k ? `--axi-series: ${COLOURS[k]}` : "";
}

/** The same, for a card's capping strip. */
export function professionStripStyle(name) {
  const k = key(name);
  return k ? `--axi-card-strip: ${COLOURS[k]}` : "";
}

/**
 * Role markers a comp slot can be flagged with, overriding the profession.
 * Condi and Heal markers are domain data by the same argument as the
 * professions above: a comp author is asserting a role for that slot, not
 * styling it, so the colour lives here rather than as a literal in comps.css.
 */
export const SLOT_ROLES = Object.freeze({ red: "#d63a3a", blue: "#3a8fd6" });

/**
 * A `style` body for a comp slot: the role marker if the slot carries one,
 * else the profession it holds. A slot is a 42px box with no room for a
 * strip or a label, so its outline is the one place an outline carries
 * domain colour — the outline IS the identification.
 * @param {unknown} role - "red" | "blue" | anything else (including "normal")
 * @param {unknown} profession
 * @returns {string}
 */
export function slotSeriesStyle(role, profession) {
  if (Object.prototype.hasOwnProperty.call(SLOT_ROLES, role)) {
    return `--axi-series: ${SLOT_ROLES[role]}`;
  }
  return professionSeriesStyle(profession);
}

/**
 * Five ways a boon/condition source can be targeted (ally, self, foe, a
 * condition's self-inflicted case, or a mix of self+foe). Domain data by
 * the same rule-10 argument as SLOT_ROLES — and deliberately not the
 * status inks: "foe" is the *good* outcome for a condition (damage landing
 * on the enemy), so it must not borrow --axi-danger's meaning, and "self"
 * is informational, not commentary, so it must not borrow the reserved
 * --axi-meta ink either (rule 6).
 */
export const TARGET_ROLES = Object.freeze({
  ally: "#5b8fd6",
  self: "#c9a63c",
  foe: "#d6785b",
  selfcondi: "#d6a35b",
  mixed: "#a35bd6",
});

/** A `style` body for a targeting badge: "" for an unknown role, so it falls
 * through to whatever neutral the consumer's own CSS names in --axi-series's
 * fallback. */
export function targetSeriesStyle(role) {
  return Object.prototype.hasOwnProperty.call(TARGET_ROLES, role)
    ? `--axi-series: ${TARGET_ROLES[role]}`
    : "";
}
