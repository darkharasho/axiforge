// Mini Build Card — reusable compact build summary card.

import { escapeHtml } from "./utils.js";
import { GW2_WEAPONS_BY_ID } from "./constants.js";
import {
  getSpecIcon,
  profClass,
  getDisplayName,
  resolveStatPackage,
  getRuneName,
} from "./build-helpers.js";
import { roleBadgeHtml } from "./roleEstimator.js";

/**
 * Return array of { name, isElite } for each specialization on the build.
 */
function getSpecLineNames(build) {
  if (!build.specializations) return [];
  return build.specializations
    .filter((s) => s && s.name)
    .map((s) => ({ name: s.name, isElite: !!s.elite }));
}

/**
 * Return array of weapon set display strings, e.g. ["Axe / Shield", "Staff"].
 * Skips empty sets.
 */
function getWeaponSetNames(build) {
  const weaps = build.equipment?.weapons;
  if (!weaps) return [];

  const resolve = (id) => {
    if (!id) return null;
    const w = GW2_WEAPONS_BY_ID.get(id);
    return w ? w.label : id; // fallback to raw id
  };

  const sets = [];

  // Set 1
  const mh1 = resolve(weaps.mainhand1);
  const oh1 = resolve(weaps.offhand1);
  if (mh1 || oh1) {
    sets.push([mh1, oh1].filter(Boolean).join(" / "));
  }

  // Set 2
  const mh2 = resolve(weaps.mainhand2);
  const oh2 = resolve(weaps.offhand2);
  if (mh2 || oh2) {
    sets.push([mh2, oh2].filter(Boolean).join(" / "));
  }

  return sets;
}

/**
 * Render a mini build card as an HTML string.
 *
 * @param {Object} build - Build object from state
 * @param {Object} upgradeCatalog - state.upgradeCatalog (for rune name resolution)
 * @param {Object} [options]
 * @param {boolean} [options.showActions=true] - Show open/remove buttons
 * @param {boolean} [options.showMode=true] - Show game mode pill
 * @returns {string} HTML string
 */
export function renderMiniBuildCard(build, upgradeCatalog, options = {}) {
  const { showActions = true, showMode = true } = options;

  const icon = getSpecIcon(build);
  const pClass = profClass(build.profession);
  const name = escapeHtml(getDisplayName(build));
  const gameMode = build.gameMode || "pve";

  // Tag pills
  const tagPills = (build.tags || [])
    .map((t) => `<span class="mini-card__tag">${escapeHtml(t)}</span>`)
    .join("");

  // Role badge
  const role = roleBadgeHtml(build, upgradeCatalog);

  // Mode pill
  const modePill = showMode
    ? `<span class="mini-card__mode">${escapeHtml(gameMode)}</span>`
    : "";

  // Spec line
  const specs = getSpecLineNames(build);
  let specRowHtml = "";
  if (specs.length) {
    const specPips = specs.map((s, i) => {
      const pipClass = s.isElite ? "mini-card__spec-pip mini-card__spec-pip--elite" : "mini-card__spec-pip";
      const nameClass = s.isElite ? "mini-card__spec-name mini-card__spec-name--elite" : "mini-card__spec-name";
      const letter = escapeHtml(s.name.charAt(0).toUpperCase());
      const sep = i < specs.length - 1 ? `<span class="mini-card__spec-sep">›</span>` : "";
      return `<span class="${pipClass}">${letter}</span><span class="${nameClass}">${escapeHtml(s.name)}</span>${sep}`;
    }).join("");

    specRowHtml = `
      <div class="mini-card__detail-row">
        <span class="mini-card__detail-label">Specs</span>
        <div class="mini-card__spec-group">${specPips}</div>
      </div>`;
  }

  // Weapon line
  const weaponSets = getWeaponSetNames(build);
  let weapRowHtml = "";
  if (weaponSets.length) {
    const weapHtml = weaponSets
      .map((s) => `<span class="mini-card__weap-name">${escapeHtml(s)}</span>`)
      .join(`<span class="mini-card__weap-div">|</span>`);

    weapRowHtml = `
      <div class="mini-card__detail-row">
        <span class="mini-card__detail-label">Weap</span>
        <div class="mini-card__weap-group">${weapHtml}</div>
      </div>`;
  }

  // Gear line (stat + rune)
  const statPackage = resolveStatPackage(build);
  const runeName = getRuneName(build, upgradeCatalog);
  let gearRowHtml = "";
  if (statPackage || runeName) {
    const parts = [];
    if (statPackage) {
      parts.push(`<span class="mini-card__gear-icon mini-card__gear-icon--stat">◆</span>`);
      parts.push(`<span class="mini-card__stat">${escapeHtml(statPackage)}</span>`);
    }
    if (statPackage && runeName) {
      parts.push(`<span class="mini-card__sep">&middot;</span>`);
    }
    if (runeName) {
      parts.push(`<span class="mini-card__gear-icon mini-card__gear-icon--rune">ᚱ</span>`);
      parts.push(`<span class="mini-card__equip">${escapeHtml(runeName)}</span>`);
    }
    gearRowHtml = `
      <div class="mini-card__detail-row">
        <span class="mini-card__detail-label">Gear</span>
        ${parts.join("")}
      </div>`;
  }

  // Relic line
  const relicName = build.equipment?.relic || "";
  let relicRowHtml = "";
  if (relicName) {
    relicRowHtml = `
      <div class="mini-card__detail-row">
        <span class="mini-card__detail-label"></span>
        <span class="mini-card__gear-icon mini-card__gear-icon--relic">⬡</span>
        <span class="mini-card__relic">${escapeHtml(relicName)}</span>
      </div>`;
  }

  // Action buttons
  const actionsHtml = showActions
    ? `<div class="mini-card__actions">
        <button type="button" class="mini-card__btn-open" data-action="pool-open"
                data-build-id="${escapeHtml(build.id)}" title="Open build">&#8599;</button>
        <button type="button" class="mini-card__btn-remove" data-action="pool-remove"
                data-build-id="${escapeHtml(build.id)}" title="Remove from comp">&times;</button>
      </div>`
    : "";

  return `
    <div class="mini-card ${pClass}" data-build-id="${escapeHtml(build.id)}">
      <div class="mini-card__icon">${icon}</div>
      <div class="mini-card__info">
        <div class="mini-card__header">
          <span class="mini-card__name">${name}</span>
          ${tagPills}
          ${role}
          ${modePill}
        </div>
        ${specRowHtml}
        ${weapRowHtml}
        ${gearRowHtml}
        ${relicRowHtml}
      </div>
      ${actionsHtml}
    </div>
  `;
}

/**
 * Render a placeholder card for a build that no longer exists in the library.
 */
export function renderMissingMiniBuildCard(buildId) {
  const truncId = buildId.length > 12 ? buildId.slice(0, 12) + "\u2026" : buildId;
  return `
    <div class="mini-card mini-card--missing" data-build-id="${escapeHtml(buildId)}">
      <div class="mini-card__icon mini-card__icon--missing">?</div>
      <div class="mini-card__info">
        <div class="mini-card__header">
          <span class="mini-card__name mini-card__name--missing">Missing Build</span>
        </div>
        <div class="mini-card__detail-row">
          <span class="mini-card__equip">${escapeHtml(truncId)}</span>
        </div>
      </div>
      <div class="mini-card__actions">
        <button type="button" class="mini-card__btn-remove" data-action="pool-remove"
                data-build-id="${escapeHtml(buildId)}" title="Remove from comp">&times;</button>
      </div>
    </div>
  `;
}
