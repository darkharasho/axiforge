// Comp-level boon coverage — aggregates computeBoonCoverage across all builds in a comp.
// Kept in the comps/ folder to avoid circular imports (boon-coverage.js ← skills.js ← equipment-weapon-skills.js).

import { computeBoonCoverage } from "../boon-coverage.js";
import { resolveEquippedWeaponSkills } from "../equipment-weapon-skills.js";
import { BOON_DISPLAY_ORDER, BOON_CONDITION_ICONS } from "../constants.js";
import { getProfessionSvg } from "../profession-icons.js";
import { escapeHtml } from "../utils.js";
import { computeBuildConcentration } from "../stats.js";

/**
 * Compute boon coverage for all filled slots in a comp, squad-wide and per-line.
 */
export async function computeCompBoonCoverage(comp, builds, catalogCache, getCatalog, upgradeCatalog = null) {
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
      const concentrationBonus = computeBuildConcentration(build, upgradeCatalog) / 1500;

      // Determine elite spec name (for icon display in tooltips).
      // Serialized builds have .elite and .name directly on each spec entry;
      // editor-format builds need a catalog lookup via specializationId.
      let eliteSpec = null;
      for (const spec of build.specializations || []) {
        if (spec?.elite && spec?.name) { eliteSpec = spec.name; break; }
        const specId = Number(spec?.specializationId || spec?.id) || 0;
        if (!specId) continue;
        const specData = catalog.specializationById?.get(specId);
        if (specData?.elite) { eliteSpec = specData.name || null; break; }
      }

      for (const boon of coverage.boons) {
        if (!lineBoonMap.has(boon.name)) {
          lineBoonMap.set(boon.name, { count: 0, providers: [] });
        }
        const lineEntry = lineBoonMap.get(boon.name);
        lineEntry.count++;
        const sources = (boon.sources || [])
          .filter(s => s.duration > 0)
          .map(s => ({
            type: s.type,
            name: s.name,
            stacks: s.stacks,
            effectiveDuration: +((s.duration * (1 + concentrationBonus)).toFixed(1)),
          }));
        lineEntry.providers.push({ buildId, buildName, profession: build.profession, eliteSpec, sources });

        if (!squadMap.has(boon.name)) {
          squadMap.set(boon.name, { count: 0, providers: [] });
        }
        const squadEntry = squadMap.get(boon.name);
        squadEntry.count++;
        squadEntry.providers.push({ buildId, buildName, lineLabel: label, profession: build.profession, eliteSpec });
      }
    }

    lineResults.push({ lineId: line.id, label, hasFilledSlots, boons: lineBoonMap });
  }

  return { squad: squadMap, lines: lineResults };
}

// ── HTML rendering ────────────────────────────────────────────────────────────

export function buildBoonCoverageHTML(data) {
  const { squad, lines } = data;

  const squadIcons = _renderIconRow(squad, "squad", "36", null);

  const lineRowsHtml = lines
    .filter((l) => l.hasFilledSlots)
    .map(
      (line) => `
      <div class="comp-boon-cov__line-row">
        <span class="comp-boon-cov__line-label">${escapeHtml(line.label)}</span>
        <div class="comp-boon-cov__icons">
          ${_renderIconRow(line.boons, "line", "28", line.label)}
        </div>
      </div>
      <div class="comp-boon-cov__duration-expand" data-line-label="${escapeHtml(line.label)}" hidden></div>`
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

    const isClickable = scope === "line" && covered;

    return `
      <div class="comp-boon-cov__icon ${covered ? "" : "comp-boon-cov__icon--uncovered"}"
           data-scope="${scope}"
           ${isClickable ? 'data-clickable="true"' : ""}
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
let _activeDurationExpand = null; // { expandEl: HTMLElement, iconEl: HTMLElement } | null

function _closeBoonTooltip() {
  if (_activeBoonTooltip) {
    _activeBoonTooltip.remove();
    _activeBoonTooltip = null;
  }
}

export function closeBoonTooltip() {
  _closeBoonTooltip();
}

function _closeDurationExpand() {
  if (!_activeDurationExpand) return;
  _activeDurationExpand.expandEl.hidden = true;
  _activeDurationExpand.iconEl.classList.remove("comp-boon-cov__icon--active");
  _activeDurationExpand = null;
}

export function closeDurationExpand() { _closeDurationExpand(); }

export function bindBoonCoverageEvents(container) {
  container.querySelectorAll(".comp-boon-cov__icon").forEach((iconEl) => {
    iconEl.addEventListener("mouseenter", () => {
      // Suppress tooltip if this icon has its expansion open
      if (_activeDurationExpand?.iconEl === iconEl) return;
      _closeBoonTooltip();
      const boonName = iconEl.dataset.boonName;
      const count    = Number(iconEl.dataset.count) || 0;
      const scope    = iconEl.dataset.scope;
      let providers  = [];
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

  // ── Click handler for per-line boon icons ──────────────────────
  container.querySelectorAll('.comp-boon-cov__icon[data-clickable="true"]').forEach((iconEl) => {
    iconEl.addEventListener("click", (e) => {
      e.stopPropagation();

      // Toggle: clicking the active icon closes it
      if (_activeDurationExpand?.iconEl === iconEl) {
        _closeDurationExpand();
        return;
      }

      // Close any existing expansion
      _closeDurationExpand();

      // Find the expansion div (next sibling of the parent .comp-boon-cov__line-row)
      const lineRow = iconEl.closest(".comp-boon-cov__line-row");
      const expandEl = lineRow?.nextElementSibling;
      if (!expandEl || !expandEl.classList.contains("comp-boon-cov__duration-expand")) return;

      // Parse providers and populate expansion
      let providers = [];
      try { providers = JSON.parse(iconEl.dataset.providers || "[]"); } catch (_) { /* ignore */ }
      const boonName = iconEl.dataset.boonName;
      const lineLabel = iconEl.dataset.lineLabel || "";

      expandEl.innerHTML = _buildDurationExpandHTML(boonName, lineLabel, providers);
      expandEl.hidden = false;
      iconEl.classList.add("comp-boon-cov__icon--active");
      _activeDurationExpand = { expandEl, iconEl };

      // Wire the close button inside the expansion
      expandEl.querySelector(".comp-boon-cov__dur-close")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _closeDurationExpand();
      });
    });
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
      const profSvg = _getProfSvg(p.profession, p.eliteSpec);
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
      const profSvg = _getProfSvg(p.profession, p.eliteSpec);
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

function _getProfSvg(profession, eliteSpec) {
  return (eliteSpec && getProfessionSvg(eliteSpec)) || getProfessionSvg(profession || "") || "";
}

function _buildDurationExpandHTML(boonName, lineLabel, providers) {
  const icon = BOON_CONDITION_ICONS[boonName] || "";

  const buildBlocks = providers
    .filter(p => p.sources && p.sources.length > 0)
    .map((p, i, arr) => {
      const profSvg = _getProfSvg(p.profession, p.eliteSpec);
      const sourceRows = p.sources.map(s => {
        const typeClass = s.type === "skill" ? "comp-boon-cov__dur-type--skill" : "comp-boon-cov__dur-type--trait";
        const typeLabel = s.type === "skill" ? "SKILL" : "TRAIT";
        const dur = `${s.effectiveDuration}s`;
        const stacksHtml = s.stacks > 1
          ? `<span class="comp-boon-cov__dur-stacks">&times;${s.stacks}</span>`
          : "";
        return `<div class="comp-boon-cov__dur-source">
          <span class="comp-boon-cov__dur-type ${typeClass}">${typeLabel}</span>
          <span class="comp-boon-cov__dur-source-name">${escapeHtml(s.name)}</span>
          <span class="comp-boon-cov__dur-duration">${escapeHtml(dur)}</span>
          ${stacksHtml}
        </div>`;
      }).join("");
      const sep = i < arr.length - 1 ? '<div class="comp-boon-cov__dur-sep"></div>' : "";
      return `<div class="comp-boon-cov__dur-build">
        <div class="comp-boon-cov__dur-build-header">
          <span class="comp-boon-cov__dur-prof">${profSvg}</span>
          <span class="comp-boon-cov__dur-build-name">${escapeHtml(p.buildName)}</span>
        </div>
        <div class="comp-boon-cov__dur-sources">${sourceRows}</div>
      </div>${sep}`;
    }).join("");

  return `
    <div class="comp-boon-cov__dur-header">
      <img class="comp-boon-cov__dur-boon-icon" src="${escapeHtml(icon)}" width="18" height="18" alt="${escapeHtml(boonName)}">
      <span class="comp-boon-cov__dur-boon-name">${escapeHtml(boonName)}</span>
      <span class="comp-boon-cov__dur-line-label">${escapeHtml(lineLabel)}</span>
      <button class="comp-boon-cov__dur-close" aria-label="Close">&#x2715;</button>
    </div>
    ${buildBlocks}
  `;
}
