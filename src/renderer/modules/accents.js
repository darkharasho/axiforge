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

/** Sets the accent on <html>, crossfading for 500ms. Returns the resolved id. */
export function applyAccent(id) {
  const resolved = resolveAccentId(id);
  const root = document.documentElement;

  root.classList.add("theme-transitioning");
  if (_transitionTimer) clearTimeout(_transitionTimer);
  _transitionTimer = setTimeout(() => {
    root.classList.remove("theme-transitioning");
    _transitionTimer = null;
  }, 500);

  root.setAttribute("data-axi-accent", resolved);
  return resolved;
}
