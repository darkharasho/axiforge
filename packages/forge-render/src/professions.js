/**
 * The nine professions and the colours they own.
 *
 * This is domain data, not style: a profession's colour belongs to Guild
 * Wars 2, not to the embedding app's theme, and it does not change when the
 * accent does. RULES.md rule 10 is the reason it reaches CSS only through
 * the per-instance --axi-series / --axi-card-strip knobs rather than as a
 * token or a class — a stylesheet that named a profession would be a colour
 * literal in app CSS, and a token would put game data on the theme surface.
 *
 * It lives HERE, in the package, rather than in src/shared/professions.js
 * where the app's copy used to be, for one reason: forge-render publishes
 * standalone to AxiVale and AxiBridge and may not import out of the repo, so
 * the renderers that need a hue cannot reach the app's module. The app's
 * src/shared/professions.js re-exports this one, which is what keeps the
 * palette single-definition across both.
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

/** Full strength, as rule 10 requires. */
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
 * rule names in --axi-series's fallback rather than this helper guessing a
 * colour on its behalf.
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
 * styling it, so the colour lives here rather than as a literal in CSS.
 */
export const SLOT_ROLES = Object.freeze({ red: "#d63a3a", blue: "#3a8fd6" });

/**
 * A `style` body for a comp slot or a mini card: the role marker if one is
 * set, else the profession it holds. A slot is a small box with no room for
 * a strip or a label, so its outline is the one place an outline carries
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
 * The roles role-estimator.js can decide a build plays, and the colours they
 * own. Domain data by the same rule-10 argument as the professions: the
 * estimator asserts a role from the build's gear, it is not styling it — so
 * the hue lives here rather than as a literal in forge-render.css, where it
 * used to sit six times over as a hue washed to 15% (rule 2's "five muted
 * inks over near-black are five browns").
 *
 * "Unknown" is deliberately absent, not mapped to a grey: an unknown role has
 * no colour to assert, so it yields "" and the badge falls to the neutral its
 * own CSS rule names as --axi-series's fallback.
 */
export const BUILD_ROLES = Object.freeze({
  "Power DPS": "#e87070",
  "Condi DPS": "#cc80e8",
  "Boon Support": "#72aaff",
  "Heal Support": "#4dca7a",
  Hybrid: "#c8a96e",
});

/** A `style` body for a role badge, or "" for a role with no colour. */
export function roleSeriesStyle(role) {
  return Object.prototype.hasOwnProperty.call(BUILD_ROLES, role)
    ? `--axi-series: ${BUILD_ROLES[role]}`
    : "";
}
