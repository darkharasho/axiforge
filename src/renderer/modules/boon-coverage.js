// Boon coverage — party-level aggregation wrapper.
// Core boon computation lives in @axiapps/gw2-data/engine, accessed via engine-bridge.js.
import { computeBoons, computeCombos } from "./engine-bridge.js";
import { state } from "./state.js";

/**
 * Compute boon/condition coverage for a single build.
 * Thin wrapper around engine bridge, preserving old API signature.
 */
export function computeBoonCoverage(catalog, editor, weaponSkills = []) {
  const bridgeState = {
    editor,
    activeCatalog: catalog,
    upgradeCatalog: state.upgradeCatalog || {},
  };
  return computeBoons(bridgeState, weaponSkills);
}

/**
 * Compute full party coverage for a single build: boons, conditions, combo fields, finishers.
 * Delegates core boon/condition computation to the engine.
 */
export function computePartyCoverage(catalog, editor, weaponSkills = []) {
  // Build a temporary state object for the bridge functions.
  // The bridge needs state.editor and state.activeCatalog/upgradeCatalog.
  const bridgeState = {
    editor,
    activeCatalog: catalog,
    upgradeCatalog: state.upgradeCatalog || {},
  };

  const { boons, conditions } = computeBoons(bridgeState, weaponSkills);
  const { fields: comboFields, finishers: comboFinishers } = computeCombos(bridgeState, weaponSkills, { filterWeapons: true });

  return { boons, conditions, comboFields, comboFinishers };
}

// ---------------------------------------------------------------------------
// Single-build coverage strip
//
// The editor renders this strip in two places (skills panel and equipment
// weapon-skill section) with different BEM prefixes and icon sizes. Both used
// to carry their own near-identical copy of the DOM building; they share this
// one now.
// ---------------------------------------------------------------------------

const SOURCE_TYPE_LABELS = { skill: "Skill", trait: "Trait", relic: "Relic" };

const CONDI_TARGET_LABELS = {
  foe: { mod: "foe", label: "FOE" },
  self: { mod: "selfcondi", label: "SELF" },
  mixed: { mod: "mixed", label: "SELF+FOE" },
};

function _sourceDetailText(src) {
  if (!(src.duration > 0)) return "passive";
  const parts = [];
  if (src.stacks > 0) parts.push(`${src.stacks}×`);
  parts.push(`${src.duration}s`);
  return parts.join(" ");
}

function _makeTooltip(item, { isCondition }) {
  const tooltip = document.createElement("div");
  tooltip.className = "boon-coverage__tooltip";

  const title = document.createElement("div");
  title.className = "boon-coverage__tooltip-title";
  title.textContent = item.name;
  tooltip.append(title);

  const sources = item.sources || [];
  if (!sources.length) {
    const empty = document.createElement("div");
    empty.className = "boon-coverage__tooltip-note";
    empty.textContent = "No source in this build.";
    tooltip.append(empty);
    return tooltip;
  }

  for (const src of sources) {
    const sourceRow = document.createElement("div");
    sourceRow.className = "boon-coverage__tooltip-row";
    if (isCondition && src.target === "self") {
      sourceRow.classList.add("boon-coverage__tooltip-row--self-condi");
    }

    const tag = document.createElement("span");
    tag.className = `boon-coverage__tooltip-tag boon-coverage__tooltip-tag--${src.type}`;
    tag.textContent = SOURCE_TYPE_LABELS[src.type] || "Trait";
    sourceRow.append(tag);

    const srcName = document.createElement("span");
    srcName.className = "boon-coverage__tooltip-name";
    srcName.textContent = src.name;
    sourceRow.append(srcName);

    const detail = document.createElement("span");
    detail.className = "boon-coverage__tooltip-detail";
    detail.textContent = _sourceDetailText(src);
    sourceRow.append(detail);

    // Conditions carry a foe/self target; boons don't (they use the ally badge).
    if (isCondition) {
      const t = CONDI_TARGET_LABELS[src.target] || CONDI_TARGET_LABELS.foe;
      const target = document.createElement("span");
      target.className = `boon-coverage__tooltip-target boon-coverage__tooltip-target--${t.mod}`;
      target.textContent = t.label;
      sourceRow.append(target);
    }

    tooltip.append(sourceRow);
  }

  if (isCondition && !sources.some((s) => s.target !== "self")) {
    const note = document.createElement("div");
    note.className = "boon-coverage__tooltip-note";
    note.textContent = "Self-inflicted only — not applied to enemies.";
    tooltip.append(note);
  }

  return tooltip;
}

function _makeCoverageIcon(item, { prefix, iconSize, isCondition, stateMod }) {
  const icon = document.createElement("div");
  icon.className = `${prefix}__icon`;
  if (stateMod) icon.classList.add(`${prefix}__icon--${stateMod}`);

  const img = document.createElement("img");
  img.src = item.icon || "";
  img.alt = item.name;
  img.width = iconSize;
  img.height = iconSize;
  icon.append(img);

  // The ally badge is a boon concept — conditions use the target tag instead.
  if (!isCondition && item.hasAllySource) {
    const badge = document.createElement("div");
    badge.className = `${prefix}__ally-badge`;
    badge.textContent = "⇧";
    icon.append(badge);
  }

  icon.addEventListener("mouseenter", () => {
    icon.append(_makeTooltip(item, { isCondition }));
  });
  icon.addEventListener("mouseleave", () => {
    const tooltip = icon.querySelector(".boon-coverage__tooltip");
    if (tooltip) tooltip.remove();
  });

  return icon;
}

/**
 * Annotate a build's conditions for the strip. Only conditions the build can
 * actually apply are listed (same as boons) — but a condition whose sources are
 * all self-inflicted (e.g. a necro's Corrupt Boon) is marked so it doesn't read
 * as offensive pressure it can't deliver.
 */
export function buildConditionList(conditions = []) {
  return (conditions || []).map((entry) => {
    const sources = entry.sources || [];
    const covered = sources.some((s) => (s.target || "foe") !== "self");
    return { ...entry, covered, selfOnly: !covered && sources.length > 0 };
  });
}

/**
 * Render the boon/condition coverage strip for a single build.
 * `prefix` selects the BEM namespace ("boon-coverage" in the skills panel,
 * "equip-boon-coverage" in the equipment panel); tooltips are shared.
 * Returns null when the build produces no boons or conditions at all.
 */
export function renderCoverageStrip(coverage, { prefix = "boon-coverage", iconSize = 24 } = {}) {
  const boons = coverage?.boons || [];
  const conditions = coverage?.conditions || [];
  if (!boons.length && !conditions.length) return null;

  const container = document.createElement("div");
  container.className = prefix;

  if (boons.length) {
    const row = document.createElement("div");
    row.className = `${prefix}__boons`;
    for (const boon of boons) {
      row.append(_makeCoverageIcon(boon, { prefix, iconSize, isCondition: false }));
    }
    container.append(row);
  }

  if (conditions.length) {
    const row = document.createElement("div");
    row.className = `${prefix}__conditions`;
    for (const cond of buildConditionList(conditions)) {
      row.append(_makeCoverageIcon(cond, {
        prefix, iconSize, isCondition: true,
        stateMod: cond.selfOnly ? "self-condi" : "",
      }));
    }
    container.append(row);
  }

  return container;
}
