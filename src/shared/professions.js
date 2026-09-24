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
