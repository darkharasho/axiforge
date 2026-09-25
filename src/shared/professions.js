/**
 * The app's door onto the profession palette, plus the one colour table that
 * is the app's alone.
 *
 * The nine profession hues, SLOT_ROLES and the --axi-series helpers moved into
 * packages/forge-render/src/professions.js in batch 5. They had to: that
 * package publishes standalone to AxiVale and AxiBridge and cannot import out
 * of the repo, and its mini card and comp card both need a hue. Leaving a
 * second copy here would have re-created the drift the batch-2 consolidation
 * removed, so the direction of the dependency flipped instead and this file
 * re-exports the package's. Every existing importer keeps its import path.
 *
 * What is still defined here is TARGET_ROLES, which only the boon-coverage
 * view uses and which no renderer in the package draws.
 *
 * What this file is NOT: the app's single home for domain colour.
 * src/renderer/modules/constants.js:430-455 holds nine more in
 * COMBO_FIELD_COLORS / COMBO_FINISHER_COLORS, which reach --axi-series the
 * same way these do. Consolidating those is parked in docs/BACKLOG.md.
 */

export {
  PROFESSIONS,
  SLOT_ROLES,
  professionColour,
  isProfession,
  professionSeriesStyle,
  professionStripStyle,
  slotSeriesStyle,
} from "../../packages/forge-render/src/professions.js";

/**
 * Five ways a boon/condition source can be targeted (ally, self, foe, a
 * condition's self-inflicted case, or a mix of self+foe). Domain data by
 * the same rule-10 argument as the professions — and deliberately not the
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
