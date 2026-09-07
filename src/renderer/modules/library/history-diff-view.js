// Turns a history op into the pieces a reader can SEE: the icons and names of
// what actually changed.
//
// The main process words every op (`renderOpDetail` writes the sentence,
// `renderOpNoun` the subject) and that vocabulary is not repeated here — an op
// arrives carrying `label` and `noun` as data. What main cannot ship is the
// artwork, so this module resolves it, from three sources in order:
//
//   1. the op's own value — a skill op's `before`/`after` ARE skill objects,
//      icon and name included;
//   2. `op.vis` — trait and spec ops hold bare ids, so `diffBuild` resolves
//      their names and icons off the documents while it has them;
//   3. the two documents and the upgrade catalog — gear and consumables are
//      GW2 item ids, named by the same maps the mini card uses.
//
// Anything that resolves to nothing degrades to a text chip, and any op with
// no two-sided value at all (notes, folder moves) returns null and is rendered
// as the main process's prose instead. Nothing here is allowed to be the only
// thing that names a change.

import { escapeHtml } from "../utils.js";
import { PROFESSION_WEIGHT } from "../constants.js";
import { getSlotSvg } from "../slot-icons.js";
import { getWeaponSvg } from "../weapon-icons.js";

/* ------------------------------------------------------------------- chips */

const NONE = { kind: "none", name: "None" };

function imgChip(icon, name) {
  if (!icon) return name ? { kind: "text", name: String(name) } : null;
  return { kind: "img", icon: String(icon), name: String(name || "") };
}

function svgChip(svg, name) {
  if (!svg) return name ? { kind: "text", name: String(name) } : null;
  return { kind: "svg", svg: String(svg), name: String(name || "") };
}

function textChip(value) {
  if (value === null || value === undefined || value === "") return NONE;
  return { kind: "text", name: String(value) };
}

function isUnset(value) {
  return value === null || value === undefined || value === "";
}

/* --------------------------------------------------------------- resolvers */

function catalogHit(map, value) {
  if (!map || typeof map.get !== "function" || isUnset(value)) return null;
  return map.get(Number(value)) || map.get(String(value)) || null;
}

// Traits and specs prefer `op.vis` (written at diff time). Entries recorded
// before `vis` existed still resolve, because the compare modal hands us both
// documents and a saved spec line embeds its own icon and its trait catalog.
function visSide(op, side) {
  return (op.vis && op.vis[side]) || null;
}

function specLine(doc, line) {
  const lines = doc && doc.specializations;
  return (Array.isArray(lines) ? lines[Number(line)] : null) || null;
}

function traitFromDoc(doc, line, tier, traitId) {
  const spec = specLine(doc, line);
  const options = (spec && spec.majorTraitsByTier && spec.majorTraitsByTier[String(tier)]) || [];
  if (!Array.isArray(options)) return null;
  return options.find((t) => t && Number(t.id) === Number(traitId)) || null;
}

function traitChip(op, side, doc) {
  const value = op[side];
  if (isUnset(value)) return NONE;
  const hit = visSide(op, side) || traitFromDoc(doc, op.line, op.tier, value);
  if (!hit) return textChip(value);
  return imgChip(hit.icon, hit.name || value);
}

function specChip(op, side, doc) {
  const value = op[side];
  if (isUnset(value)) return NONE;
  const icon = (visSide(op, side) || {}).icon || (specLine(doc, op.line) || {}).icon;
  return imgChip(icon, value.name || value.id);
}

// Skill ops carry the whole skill, so no lookup is needed — but an older
// record may hold a bare id, which has no name to show.
function skillChip(op, side) {
  const value = op[side];
  if (isUnset(value)) return NONE;
  if (typeof value !== "object") return textChip(value);
  return imgChip(value.icon, value.name);
}

const GEAR_ID_MAPS = { rune: "runeById", infusion: "infusionById" };

function gearChip(op, side, catalog) {
  const value = op[side];
  if (isUnset(value)) return NONE;
  const part = String(op.part || "");
  // A weapon's value is its type ("axe"), drawn from the same SVG set the
  // equipment panel uses. An armor or trinket value is a stat prefix
  // ("Berserker's") and has no artwork anywhere in the app.
  if (part === "weapon") return svgChip(getWeaponSvg(value), weaponName(value));
  if (part === "item") return textChip(value);
  const mapName = /^sigil\d+$/.test(part) ? "sigilById" : GEAR_ID_MAPS[part];
  const hit = mapName ? catalogHit(catalog && catalog[mapName], value) : null;
  // No catalog hit means the id is all we have. Showing it is ugly but true;
  // the main process's sentence sits beside it either way.
  return hit ? imgChip(hit.icon, hit.name) : textChip(value);
}

function weaponName(value) {
  const raw = String(value);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const CONSUMABLE_MAPS = {
  food: "foodById",
  utility: "utilityById",
  enrichment: "enrichmentById",
};

function consumableChip(op, side, catalog) {
  const value = op[side];
  if (isUnset(value)) return NONE;
  // A relic is stored by NAME, every other consumable by id.
  if (op.path === "relic") {
    const hit = catalog && catalog.relicByName && catalog.relicByName.get(String(value));
    return imgChip(hit && hit.icon, value);
  }
  const hit = catalogHit(catalog && catalog[CONSUMABLE_MAPS[op.path]], value);
  return hit ? imgChip(hit.icon, hit.name) : textChip(value);
}

// `field` ops whose two values are worth showing side by side. The rest
// ("notes updated", "tags updated") say everything in the main process's own
// sentence, so they stay prose.
const VALUED_FIELDS = new Set(["title", "name", "profession", "gameMode"]);

/* ------------------------------------------------------------- entry point */

/**
 * @param {object} op — a history op, ideally carrying `label` and `noun`.
 * @param {object} [ctx] — { fromDoc, toDoc, catalog }
 * @returns {object|null} { noun, labelSvg, before, after } or null for ops
 *   that have no side-by-side value and should be rendered as prose.
 */
export function resolveOpVisual(op, ctx) {
  if (!op || typeof op !== "object") return null;
  const c = ctx || {};
  const from = c.fromDoc || null;
  const to = c.toDoc || null;
  const catalog = c.catalog || null;

  switch (op.t) {
    case "skill":
      return visual(op, skillChip(op, "before"), skillChip(op, "after"), null);
    case "trait":
      return visual(op, traitChip(op, "before", from), traitChip(op, "after", to), null);
    case "spec":
      return visual(op, specChip(op, "before", from), specChip(op, "after", to), null);
    case "gear":
      return visual(
        op,
        gearChip(op, "before", catalog),
        gearChip(op, "after", catalog),
        slotSvg(op, from, to),
      );
    case "consumable":
      return visual(op, consumableChip(op, "before", catalog), consumableChip(op, "after", catalog), null);
    case "stat":
      return visual(op, textChip(op.before), textChip(op.after), null);
    case "field":
      if (!VALUED_FIELDS.has(String(op.path))) return null;
      return visual(op, textChip(op.before), textChip(op.after), null);
    default:
      return null;
  }
}

function visual(op, before, after, labelSvg) {
  return {
    noun: String(op.noun || ""),
    labelSvg: labelSvg || null,
    before: before || NONE,
    after: after || NONE,
  };
}

// The row's label icon: the SLOT, not its contents — a helm outline beside
// "helm rune", so the eye finds the piece before it reads the words.
function slotSvg(op, fromDoc, toDoc) {
  const base = String(op.slot || "").replace(/\[\d+\]$/, "");
  const doc = toDoc || fromDoc;
  const weight = PROFESSION_WEIGHT[doc && doc.profession] || "heavy";
  const armor = getSlotSvg(base, weight);
  if (armor) return armor;
  const weapons = (doc && doc.equipment && doc.equipment.weapons) || {};
  return getWeaponSvg(weapons[base]) || null;
}

/* --------------------------------------------------------------- rendering */

export function renderChip(chip, variant) {
  const c = chip || NONE;
  const cls = `hist-chip hist-chip--${c.kind}${variant ? ` hist-chip--${variant}` : ""}`;
  return `<span class="${cls}">${chipArt(c)}<span class="hist-chip__name">${escapeHtml(c.name || "")}</span></span>`;
}

function chipArt(c) {
  if (c.kind === "img") return `<img class="hist-chip__icon" src="${escapeHtml(c.icon)}" alt="" loading="lazy">`;
  if (c.kind === "svg") return `<span class="hist-chip__icon hist-chip__icon--svg">${c.svg}</span>`;
  if (c.kind === "none") return `<span class="hist-chip__icon hist-chip__icon--empty">–</span>`;
  return "";
}

/**
 * The compact strip shown under a history entry's one-line summary: just the
 * artwork, before and after, so a glance at the list says what changed without
 * reading it. Ops with no artwork contribute nothing — the sentence above the
 * strip is still the authoritative description.
 *
 * @param {object[]} ops
 * @param {object} [ctx] — { catalog }
 * @param {number} [limit]
 */
export function renderOpIconStrip(ops, ctx, limit = 6) {
  const pairs = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || op.t === "derived") continue;
    const vis = resolveOpVisual(op, ctx);
    if (!vis) continue;
    if (!hasArt(vis.before) && !hasArt(vis.after)) continue;
    pairs.push({ ...vis, noun: vis.noun || op.label || "" });
    if (pairs.length >= limit) break;
  }
  if (pairs.length === 0) return "";
  const more = countArt(ops, ctx) - pairs.length;
  const cells = pairs.map((vis) => `
    <span class="hist-strip__pair" title="${escapeHtml(vis.noun)}">
      ${renderMini(vis.before)}<span class="hist-strip__arrow">→</span>${renderMini(vis.after)}
    </span>`).join("");
  const overflow = more > 0 ? `<span class="hist-strip__more">+${more}</span>` : "";
  return `<div class="hist-strip">${cells}${overflow}</div>`;
}

function hasArt(chip) {
  return !!chip && (chip.kind === "img" || chip.kind === "svg");
}

function countArt(ops, ctx) {
  let n = 0;
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || op.t === "derived") continue;
    const vis = resolveOpVisual(op, ctx);
    if (vis && (hasArt(vis.before) || hasArt(vis.after))) n += 1;
  }
  return n;
}

function renderMini(chip) {
  const c = chip || NONE;
  if (c.kind === "img") return `<img class="hist-strip__icon" src="${escapeHtml(c.icon)}" alt="${escapeHtml(c.name || "")}" loading="lazy">`;
  if (c.kind === "svg") return `<span class="hist-strip__icon hist-strip__icon--svg">${c.svg}</span>`;
  return `<span class="hist-strip__icon hist-strip__icon--empty"></span>`;
}
