// Mini Build Card — reusable compact build summary card.

import { escapeHtml } from "./utils.js";
import { GW2_WEAPONS_BY_ID, GW2_RELICS_BY_LABEL } from "./constants.js";
import { getProfessionSvg } from "./profession-icons.js";
import {
  getSpecIcon,
  profClass,
  getDisplayName,
  resolveStatPackage,
  getRuneName,
} from "./build-helpers.js";
import { roleBadgeHtml } from "./roleEstimator.js";

/**
 * Return array of { name, isElite, svg } for each specialization on the build.
 * Elite specs get their own SVG icon; core specs get the profession icon as fallback.
 */
function getSpecLineInfo(build) {
  if (!build.specializations) return [];
  const profSvg = getProfessionSvg(build.profession) || "";
  return build.specializations
    .filter((s) => s && s.name)
    .map((s) => ({
      name: s.name,
      isElite: !!s.elite,
      svg: getProfessionSvg(s.name) || profSvg,
    }));
}

/**
 * Resolve the relic icon URL from GW2_RELICS_BY_LABEL, or null.
 */
function getRelicIcon(relicName) {
  if (!relicName) return null;
  const entry = GW2_RELICS_BY_LABEL.get(relicName);
  return entry?.icon || null;
}

/**
 * Resolve the rune icon URL from upgradeCatalog, or null.
 */
function getRuneIcon(build, upgradeCatalog) {
  const runes = build.equipment?.runes;
  if (!runes || typeof runes !== "object" || !upgradeCatalog) return null;
  const counts = {};
  for (const v of Object.values(runes)) {
    if (v) counts[String(v)] = (counts[String(v)] || 0) + 1;
  }
  let bestId = "";
  let bestCount = 0;
  for (const [id, count] of Object.entries(counts)) {
    if (count > bestCount) { bestId = id; bestCount = count; }
  }
  if (!bestId) return null;
  const runeDef = upgradeCatalog.runeById?.get(Number(bestId));
  return runeDef?.icon || null;
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

  // Left column: Specs (vertical, one per line)
  const specs = getSpecLineInfo(build);
  let specColHtml = "";
  if (specs.length) {
    const specLines = specs.map((s) => {
      const pipClass = s.isElite ? "mini-card__spec-pip mini-card__spec-pip--elite" : "mini-card__spec-pip";
      const nameClass = s.isElite ? "mini-card__spec-name mini-card__spec-name--elite" : "mini-card__spec-name";
      const pipContent = s.svg || escapeHtml(s.name.charAt(0).toUpperCase());
      return `<div class="mini-card__spec-line"><span class="${pipClass}">${pipContent}</span><span class="${nameClass}">${escapeHtml(s.name)}</span></div>`;
    }).join("");

    specColHtml = `
      <div class="mini-card__col-left">
        <span class="mini-card__detail-label">Specs</span>
        ${specLines}
      </div>`;
  }

  // Right column: Weapons, Gear, Relic (stacked)
  const weaponSets = getWeaponSetNames(build);
  let weapRowHtml = "";
  if (weaponSets.length) {
    const weapHtml = weaponSets
      .map((s) => `<span class="mini-card__weap-name">${escapeHtml(s)}</span>`)
      .join(`<span class="mini-card__weap-div">|</span>`);

    weapRowHtml = `
      <div class="mini-card__cell">
        <span class="mini-card__detail-label">Weap</span>
        <div class="mini-card__weap-group">${weapHtml}</div>
      </div>`;
  }

  const statPackage = resolveStatPackage(build);
  let statRowHtml = "";
  if (statPackage) {
    statRowHtml = `
      <div class="mini-card__cell">
        <span class="mini-card__detail-label">Stats</span>
        <span class="mini-card__gear-icon mini-card__gear-icon--stat">◆</span>
        <span class="mini-card__stat">${escapeHtml(statPackage)}</span>
      </div>`;
  }

  const runeName = getRuneName(build, upgradeCatalog);
  const runeIconUrl = getRuneIcon(build, upgradeCatalog);
  let runeRowHtml = "";
  if (runeName) {
    const runeIcon = runeIconUrl
      ? `<img class="mini-card__gear-img" src="${escapeHtml(runeIconUrl)}" alt="" loading="lazy">`
      : `<span class="mini-card__gear-icon mini-card__gear-icon--rune">ᚱ</span>`;
    runeRowHtml = `
      <div class="mini-card__cell">
        <span class="mini-card__detail-label">Rune</span>
        ${runeIcon}
        <span class="mini-card__equip">${escapeHtml(runeName)}</span>
      </div>`;
  }

  const relicName = build.equipment?.relic || "";
  const relicIconUrl = getRelicIcon(relicName);
  let relicRowHtml = "";
  if (relicName) {
    const relicIcon = relicIconUrl
      ? `<img class="mini-card__gear-img" src="${escapeHtml(relicIconUrl)}" alt="" loading="lazy">`
      : `<span class="mini-card__gear-icon mini-card__gear-icon--relic">⬡</span>`;
    relicRowHtml = `
      <div class="mini-card__cell">
        <span class="mini-card__detail-label">Relic</span>
        ${relicIcon}
        <span class="mini-card__relic">${escapeHtml(relicName)}</span>
      </div>`;
  }

  const rightColHtml = (weapRowHtml || statRowHtml || runeRowHtml || relicRowHtml)
    ? `<div class="mini-card__col-right">${weapRowHtml}${statRowHtml}${runeRowHtml}${relicRowHtml}</div>`
    : "";

  // Title is a clickable link to open the build
  const titleHtml = showActions
    ? `<button type="button" class="mini-card__name" data-action="pool-open"
              data-build-id="${escapeHtml(build.id)}" title="Open build">${name} <span class="mini-card__name-arrow">&#8599;</span></button>`
    : `<span class="mini-card__name">${name}</span>`;

  // Remove button — absolute top-right
  const removeHtml = showActions
    ? `<button type="button" class="mini-card__btn-remove" data-action="pool-remove"
              data-build-id="${escapeHtml(build.id)}" title="Remove from comp">&times;</button>`
    : "";

  return `
    <div class="mini-card ${pClass}" data-build-id="${escapeHtml(build.id)}">
      ${removeHtml}
      <div class="mini-card__icon">${icon}</div>
      <div class="mini-card__info">
        <div class="mini-card__header">
          ${titleHtml}
          ${tagPills}
          ${role}
          ${modePill}
        </div>
        <div class="mini-card__columns">
          ${specColHtml}
          ${rightColHtml}
        </div>
      </div>
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
