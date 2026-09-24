"use strict";

// CommonJS mirror of src/renderer/modules/accents.js. The main process and the
// renderer cannot share one module - the renderer's is ESM and this one is
// required from CommonJS - so tests/unit/main/publish-accent.test.js asserts
// the two agree. Change one, change both.

const DEFAULT_ACCENT_ID = "axi-gold";

const PROFESSION_ACCENTS = {
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

const ACCENT_IDS = new Set(require("@axiapps/axi-design/accents.json").map((a) => a.id));

// Built with Object.create(null) - a plain object literal also answers to
// prototype-chain keys like "constructor" or "toString", which would resolve
// to an inherited function instead of falling through to the default below.
// Mirrors src/renderer/modules/accents.js:20-38.
const LEGACY_THEME_TO_ACCENT = Object.create(null);
LEGACY_THEME_TO_ACCENT[""] = DEFAULT_ACCENT_ID;
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

function resolveAccentId(id) {
  if (id && ACCENT_IDS.has(id)) return id;
  if (id === "" || id == null) return DEFAULT_ACCENT_ID;
  return LEGACY_THEME_TO_ACCENT[id] || DEFAULT_ACCENT_ID;
}

module.exports = { DEFAULT_ACCENT_ID, PROFESSION_ACCENTS, resolveAccentId };
