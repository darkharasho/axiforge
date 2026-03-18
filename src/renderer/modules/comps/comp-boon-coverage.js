// Comp-level boon coverage — aggregates computeBoonCoverage across all builds in a comp.
// Kept in the comps/ folder to avoid circular imports (boon-coverage.js ← skills.js ← equipment-weapon-skills.js).

import { computeBoonCoverage } from "../boon-coverage.js";
import { resolveEquippedWeaponSkills } from "../equipment-weapon-skills.js";
import { BOON_DISPLAY_ORDER, BOON_CONDITION_ICONS } from "../constants.js";
import { getProfessionSvg } from "../profession-icons.js";
import { escapeHtml } from "../utils.js";
import { state } from "../state.js";

/**
 * Compute boon coverage for all filled slots in a comp, squad-wide and per-line.
 */
export async function computeCompBoonCoverage(comp, builds, catalogCache, getCatalog) {
  const lines = comp.partyLines || [];
  const buildMap = new Map(builds.map((b) => [b.id, b]));

  // Pre-warm catalog cache for every (profession, gameMode) pair in this comp
  const profKeys = new Set();
  for (const line of lines) {
    for (const buildId of line.slots || []) {
      const b = buildMap.get(buildId);
      if (b?.profession) profKeys.add(`${b.profession}|${b.gameMode || "pve"}`);
    }
  }
  await Promise.all(
    [...profKeys].map((key) => {
      const [profession, gameMode] = key.split("|");
      return getCatalog(profession, gameMode);
    })
  );

  const squadMap = new Map();
  const lineResults = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = `P${i + 1}`;
    const lineBoonMap = new Map();
    let hasFilledSlots = false;

    for (const buildId of line.slots || []) {
      const build = buildMap.get(buildId);
      if (!build || !build.profession) continue;

      const cacheKey = `${build.profession}_${build.gameMode || "pve"}`;
      const catalog = catalogCache.get(cacheKey);
      if (!catalog) continue;

      hasFilledSlots = true;
      const weaponSkills = resolveEquippedWeaponSkills(catalog, build);
      const coverage = computeBoonCoverage(catalog, build, weaponSkills);
      const buildName = build.title || build.id;

      for (const boon of coverage.boons) {
        if (!lineBoonMap.has(boon.name)) {
          lineBoonMap.set(boon.name, { count: 0, providers: [] });
        }
        const lineEntry = lineBoonMap.get(boon.name);
        lineEntry.count++;
        lineEntry.providers.push({ buildId, buildName });

        if (!squadMap.has(boon.name)) {
          squadMap.set(boon.name, { count: 0, providers: [] });
        }
        const squadEntry = squadMap.get(boon.name);
        squadEntry.count++;
        squadEntry.providers.push({ buildId, buildName, lineLabel: label });
      }
    }

    lineResults.push({ lineId: line.id, label, hasFilledSlots, boons: lineBoonMap });
  }

  return { squad: squadMap, lines: lineResults };
}

// ── HTML rendering ────────────────────────────────────────────────────────────

export function buildBoonCoverageHTML(data) {
  const { squad, lines } = data;

  const squadIcons = _renderIconRow(squad, "squad", "22", null);

  const lineRowsHtml = lines
    .filter((l) => l.hasFilledSlots)
    .map(
      (line) => `
      <div class="comp-boon-cov__line-row">
        <span class="comp-boon-cov__line-label">${escapeHtml(line.label)}</span>
        <div class="comp-boon-cov__icons">
          ${_renderIconRow(line.boons, "line", "17", line.label)}
        </div>
      </div>`
    )
    .join("");

  return `
    <div class="comp-boon-cov__squad-label">SQUAD</div>
    <div class="comp-boon-cov__icons comp-boon-cov__icons--squad">${squadIcons}</div>
    ${lineRowsHtml ? `<div class="comp-boon-cov__lines">${lineRowsHtml}</div>` : ""}
  `;
}

function _renderIconRow(boonMap, scope, size, lineLabel) {
  return BOON_DISPLAY_ORDER.map((boonName) => {
    const entry = boonMap.get(boonName);
    const count = entry?.count || 0;
    const covered = count > 0;
    const icon = BOON_CONDITION_ICONS[boonName] || "";

    const providersJson = covered
      ? escapeHtml(JSON.stringify(entry.providers))
      : "[]";

    return `
      <div class="comp-boon-cov__icon ${covered ? "" : "comp-boon-cov__icon--uncovered"}"
           data-scope="${scope}"
           data-boon-name="${escapeHtml(boonName)}"
           data-count="${count}"
           data-providers="${providersJson}"
           ${lineLabel ? `data-line-label="${escapeHtml(lineLabel)}"` : ""}>
        <img src="${escapeHtml(icon)}" width="${size}" height="${size}"
             class="comp-boon-cov__img" alt="${escapeHtml(boonName)}" />
        ${covered ? `<span class="comp-boon-cov__badge">&times;${count}</span>` : ""}
      </div>`;
  }).join("");
}

// ── Tooltip event binding ─────────────────────────────────────────────────────

let _activeBoonTooltip = null;

function _closeBoonTooltip() {
  if (_activeBoonTooltip) {
    _activeBoonTooltip.remove();
    _activeBoonTooltip = null;
  }
}

export function bindBoonCoverageEvents(container) {
  container.querySelectorAll(".comp-boon-cov__icon").forEach((iconEl) => {
    iconEl.addEventListener("mouseenter", () => {
      _closeBoonTooltip();
      const boonName  = iconEl.dataset.boonName;
      const count     = Number(iconEl.dataset.count) || 0;
      const scope     = iconEl.dataset.scope;
      const lineLabel = iconEl.dataset.lineLabel || null;
      let providers   = [];
      try { providers = JSON.parse(iconEl.dataset.providers || "[]"); } catch (_) { /* ignore */ }

      const tip = document.createElement("div");
      tip.className = "comp-boon-tooltip";
      tip.innerHTML = _buildTooltipHTML(boonName, count, providers, scope);
      document.body.appendChild(tip);
      _activeBoonTooltip = tip;

      const ir = iconEl.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      const vw = window.innerWidth;
      let top  = ir.top - tr.height - 6;
      let left = ir.left + ir.width / 2 - tr.width / 2;
      if (top < 4)              top  = ir.bottom + 6;
      if (left < 4)             left = 4;
      if (left + tr.width > vw - 4) left = vw - tr.width - 4;
      tip.style.top  = `${top}px`;
      tip.style.left = `${left}px`;
    });

    iconEl.addEventListener("mouseleave", _closeBoonTooltip);
  });
}

function _buildTooltipHTML(boonName, count, providers, scope) {
  const icon = BOON_CONDITION_ICONS[boonName] || "";
  const headerLabel = count > 0
    ? `${count} ${count === 1 ? "build" : "builds"}`
    : "Not covered";

  if (count === 0) {
    return `
      <div class="comp-boon-tooltip__header">
        <img src="${escapeHtml(icon)}" width="14" height="14" alt="${escapeHtml(boonName)}" />
        <span class="comp-boon-tooltip__name">${escapeHtml(boonName)}</span>
        <span class="comp-boon-tooltip__count">${escapeHtml(headerLabel)}</span>
      </div>`;
  }

  if (scope === "line") {
    const rows = providers.map((p) => {
      const profSvg = _getProfSvgForBuild(p.buildId);
      return `<div class="comp-boon-tooltip__row">
        <span class="comp-boon-tooltip__prof">${profSvg}</span>
        <span class="comp-boon-tooltip__build-name">${escapeHtml(p.buildName)}</span>
      </div>`;
    }).join("");
    return `
      <div class="comp-boon-tooltip__header">
        <img src="${escapeHtml(icon)}" width="14" height="14" alt="${escapeHtml(boonName)}" />
        <span class="comp-boon-tooltip__name">${escapeHtml(boonName)}</span>
        <span class="comp-boon-tooltip__count">${escapeHtml(headerLabel)}</span>
      </div>
      <div class="comp-boon-tooltip__sep"></div>
      <div class="comp-boon-tooltip__providers">${rows}</div>`;
  }

  // Squad scope — group providers by lineLabel
  const byLine = new Map();
  for (const p of providers) {
    if (!byLine.has(p.lineLabel)) byLine.set(p.lineLabel, []);
    byLine.get(p.lineLabel).push(p);
  }
  const lineGroups = [...byLine.entries()].map(([lbl, lProviders]) => {
    const rows = lProviders.map((p) => {
      const profSvg = _getProfSvgForBuild(p.buildId);
      return `<div class="comp-boon-tooltip__row">
        <span class="comp-boon-tooltip__prof">${profSvg}</span>
        <span class="comp-boon-tooltip__build-name">${escapeHtml(p.buildName)}</span>
      </div>`;
    }).join("");
    return `<div class="comp-boon-tooltip__line-group">
      <div class="comp-boon-tooltip__line-label">${escapeHtml(lbl)}</div>
      ${rows}
    </div>`;
  }).join("");

  return `
    <div class="comp-boon-tooltip__header">
      <img src="${escapeHtml(icon)}" width="14" height="14" alt="${escapeHtml(boonName)}" />
      <span class="comp-boon-tooltip__name">${escapeHtml(boonName)}</span>
      <span class="comp-boon-tooltip__count">${escapeHtml(headerLabel)}</span>
    </div>
    <div class="comp-boon-tooltip__sep"></div>
    <div class="comp-boon-tooltip__providers">${lineGroups}</div>`;
}

function _getProfSvgForBuild(buildId) {
  const build = state.builds?.find((b) => b.id === buildId);
  if (!build) return "";
  return getProfessionSvg(build.profession || "") || "";
}
