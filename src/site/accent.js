import { ACCENTS, resolveAccentId } from "@renderer/modules/accents.js";

const KNOWN = new Set([
  ...ACCENTS.map((a) => a.id),
  "", "molten-core", "cinderfall", "frostforge", "verdant-crucible",
  "copper", "cobalt", "mithril", "rose-gold",
  "prof-guardian", "prof-warrior", "prof-necromancer", "prof-engineer",
  "prof-ranger", "prof-thief", "prof-mesmer", "prof-elementalist",
  "prof-revenant",
]);

/**
 * The accent a published page should use, or null to leave the page default.
 *
 * ?t= values are baked into share links already posted and cannot be
 * rewritten, so every legacy theme id resolves here forever. An unrecognised
 * value returns null rather than the default, so a junk parameter cannot put
 * a bogus attribute in the DOM.
 */
export function accentFromParams(params) {
  const raw = params.get("t");
  if (!raw || !KNOWN.has(raw)) return null;
  return resolveAccentId(raw);
}
