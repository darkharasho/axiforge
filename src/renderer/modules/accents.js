// Accent selection for AxiForge, over @axiapps/axi-design.
//
// The design language themes exactly one variable, --axi-accent, against a
// single fixed ground. AxiForge used to ship 17 themes: 8 that rewrote the
// backgrounds and 9 applied per profession. All of them collapse to an accent
// id here, and LEGACY_THEME_TO_ACCENT is what keeps ids already persisted in
// settings - and already baked into share URLs in the wild - working.
import accentsJson from "@axiapps/axi-design/accents.json";

export const ACCENTS = accentsJson;

export const DEFAULT_ACCENT_ID = "axi-gold";

// Each profession keeps the hue it already had in themes.css. Elementalist and
// Revenant share crimson-red: their old colours were #d06050 and #b05050, and
// the family palette has one red at that hue. Necromancer takes the cooler
// green so it stays distinguishable from Ranger.
export const PROFESSION_ACCENTS = {
  Guardian: "electric-blue",
  Warrior: "amber-warm",
  Necromancer: "teal-ocean",
  Engineer: "gold-bronze",
  Ranger: "emerald-mint",
  Thief: "rose-pink",
  Mesmer: "violet-purple",
  Elementalist: "crimson-red",
  Revenant: "crimson-red",
};

// Every theme id a pre-conversion version could have written to
// appearance.theme or into a published page's ?t= parameter. Those URLs are
// immutable once shared, so this map is permanent, not a migration.
//
// Built with Object.create(null) - a plain object literal also answers to
// prototype-chain keys like "constructor" or "toString", which would resolve
// to an inherited function instead of falling through to the default below.
const LEGACY_THEME_TO_ACCENT = Object.create(null);
LEGACY_THEME_TO_ACCENT[""] = DEFAULT_ACCENT_ID; // "Golden Amber", the old default
LEGACY_THEME_TO_ACCENT["molten-core"] = "amber-warm";
LEGACY_THEME_TO_ACCENT["cinderfall"] = "crimson-red";
LEGACY_THEME_TO_ACCENT["frostforge"] = "refined-cyan";
LEGACY_THEME_TO_ACCENT["verdant-crucible"] = "emerald-mint";
LEGACY_THEME_TO_ACCENT["copper"] = "gold-bronze";
LEGACY_THEME_TO_ACCENT["rose-gold"] = "rose-pink";
LEGACY_THEME_TO_ACCENT["cobalt"] = "electric-blue";
LEGACY_THEME_TO_ACCENT["mithril"] = "slate-silver";
LEGACY_THEME_TO_ACCENT["prof-guardian"] = PROFESSION_ACCENTS.Guardian;
LEGACY_THEME_TO_ACCENT["prof-warrior"] = PROFESSION_ACCENTS.Warrior;
LEGACY_THEME_TO_ACCENT["prof-necromancer"] = PROFESSION_ACCENTS.Necromancer;
LEGACY_THEME_TO_ACCENT["prof-engineer"] = PROFESSION_ACCENTS.Engineer;
LEGACY_THEME_TO_ACCENT["prof-ranger"] = PROFESSION_ACCENTS.Ranger;
LEGACY_THEME_TO_ACCENT["prof-thief"] = PROFESSION_ACCENTS.Thief;
LEGACY_THEME_TO_ACCENT["prof-mesmer"] = PROFESSION_ACCENTS.Mesmer;
LEGACY_THEME_TO_ACCENT["prof-elementalist"] = PROFESSION_ACCENTS.Elementalist;
LEGACY_THEME_TO_ACCENT["prof-revenant"] = PROFESSION_ACCENTS.Revenant;

/** Always returns an id that exists in ACCENTS. */
export function resolveAccentId(id) {
  if (id && ACCENTS.some((a) => a.id === id)) return id;
  // "" is a legacy value and is falsy, so it has to be tested explicitly.
  if (id === "" || id == null) return DEFAULT_ACCENT_ID;
  return LEGACY_THEME_TO_ACCENT[id] || DEFAULT_ACCENT_ID;
}

let _transitionTimer = null;

/**
 * Holds the crossfade class on <html> for 500ms so the whole page changes
 * together. Shared by the accent and the surface: changing both at once should
 * still be one fade, so the timer is deliberately not per-attribute.
 */
function _startCrossfade(root) {
  root.classList.add("theme-transitioning");
  if (_transitionTimer) clearTimeout(_transitionTimer);
  _transitionTimer = setTimeout(() => {
    root.classList.remove("theme-transitioning");
    _transitionTimer = null;
  }, 500);
}

/**
 * Sets the accent on <html>. Returns the resolved id.
 * Crossfades for 500ms unless { transition: false } - startup passes that,
 * so the first paint doesn't visibly flash against an unthemed page.
 */
export function applyAccent(id, { transition = true } = {}) {
  const resolved = resolveAccentId(id);
  const root = document.documentElement;

  if (transition) _startCrossfade(root);

  root.setAttribute("data-axi-accent", resolved);
  return resolved;
}

/**
 * The surfaces the design language paints. "axi" is the language itself, drawn
 * with no `data-axi-theme` at all. "flat" and "glass" are repaints of it
 * shipped as `@axiapps/axi-design/themes/<id>.css`.
 */
export const SURFACES = [
  { id: "axi", label: "Axi" },
  { id: "flat", label: "Flat" },
  { id: "glass", label: "Glass" },
];

/** AxiForge has always been drawn in the language itself, so that stays the default. */
export const DEFAULT_SURFACE_ID = "axi";

/**
 * Always returns one of the three ids. Membership is tested against the array
 * rather than an object, so inherited property names are unknown values like
 * any other.
 *
 * There is deliberately no legacy map here. LEGACY_THEME_TO_ACCENT exists
 * because published share URLs carry an accent forever; the surface has never
 * been persisted or shared, so it has no vocabulary to translate.
 */
export function resolveSurfaceId(id) {
  return SURFACES.some((s) => s.id === id) ? id : DEFAULT_SURFACE_ID;
}

/**
 * Sets the surface on <html>. Returns the resolved id.
 * Crossfades for 500ms unless { transition: false } - startup passes that,
 * so the first paint doesn't visibly flash against an unthemed page.
 *
 * "axi" removes the attribute rather than naming itself: the language is not a
 * theme layered over itself, and axi-design's own rule is that removing
 * `data-axi-theme` leaves you back on it with no other change.
 */
export function applySurface(id, { transition = true } = {}) {
  const resolved = resolveSurfaceId(id);
  const root = document.documentElement;

  if (transition) _startCrossfade(root);

  if (resolved === "axi") root.removeAttribute("data-axi-theme");
  else root.setAttribute("data-axi-theme", resolved);

  return resolved;
}
