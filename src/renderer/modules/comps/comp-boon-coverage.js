// Comp-level party coverage — aggregates boons, combo fields, and blast finishers
// across all builds in a comp, per party line (no squad-wide summary).

import { computePartyCoverage } from "../boon-coverage.js";
import { resolveEquippedWeaponSkills } from "../equipment-weapon-skills.js";
import {
  BOON_DISPLAY_ORDER, BOON_CONDITION_ICONS,
  COMBO_FIELD_COLORS, COMBO_FIELD_DISPLAY_ORDER,
  COMBO_FINISHER_COLORS, COMBO_FINISHER_DISPLAY_ORDER,
} from "../constants.js";
import { getProfessionSvg } from "../profession-icons.js";
import { escapeHtml } from "../utils.js";
import { computeBuildConcentration } from "../stats.js";


/**
 * Compute party coverage for all filled slots in a comp, per line.
 */
export async function computeCompPartyCoverage(comp, builds, catalogCache, getCatalog, upgradeCatalog = null) {
  const lines = comp.partyLines || [];
  const buildMap = new Map(builds.map((b) => [b.id, b]));

  // Pre-warm catalog cache
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

  const lineResults = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = `P${i + 1}`;
    const lineBoonMap = new Map();
    const lineFieldMap = new Map();
    const lineFinisherMap = new Map(); // keyed by finisher type (Blast, Whirl, Leap, Projectile)
    const lineBuilds = []; // { profession, eliteSpec } per build in this line
    let hasFilledSlots = false;

    for (const buildId of line.slots || []) {
      const build = buildMap.get(buildId);
      if (!build || !build.profession) continue;

      const cacheKey = `${build.profession}_${build.gameMode || "pve"}`;
      const catalog = catalogCache.get(cacheKey);
      if (!catalog) continue;

      hasFilledSlots = true;
      const weaponSkills = resolveEquippedWeaponSkills(catalog, build);
      const coverage = computePartyCoverage(catalog, build, weaponSkills);
      const buildName = build.title || build.id;
      const concentrationBonus = computeBuildConcentration(build, upgradeCatalog) / 1500;

      // Resolve elite spec
      let eliteSpec = null;
      for (const spec of build.specializations || []) {
        if (spec?.elite && spec?.name) { eliteSpec = spec.name; break; }
        const specId = Number(spec?.specializationId || spec?.id) || 0;
        if (!specId) continue;
        const specData = catalog.specializationById?.get(specId);
        if (specData?.elite) { eliteSpec = specData.name || null; break; }
      }

      const profIcon = (eliteSpec && getProfessionSvg(eliteSpec)) || getProfessionSvg(build.profession) || "";
      lineBuilds.push({ profession: build.profession, eliteSpec, profIcon });

      // Aggregate boons
      for (const boon of coverage.boons) {
        if (!lineBoonMap.has(boon.name)) {
          lineBoonMap.set(boon.name, { count: 0, providers: [] });
        }
        const entry = lineBoonMap.get(boon.name);
        entry.count++;
        const sources = (boon.sources || [])
          .filter(s => s.duration > 0)
          .map(s => ({
            type: s.type,
            name: s.name,
            stacks: s.stacks,
            effectiveDuration: +((s.duration * (1 + concentrationBonus)).toFixed(1)),
            context: s.context || "",
            isAlly: s.isAlly,
          }));
        entry.providers.push({ buildId, buildName, profession: build.profession, eliteSpec, profIcon, sources });
      }

      // Aggregate combo fields
      for (const field of coverage.comboFields) {
        if (!lineFieldMap.has(field.fieldType)) {
          lineFieldMap.set(field.fieldType, { count: 0, sources: [] });
        }
        const entry = lineFieldMap.get(field.fieldType);
        entry.count++;
        entry.sources.push({
          sourceName: field.sourceName,
          profession: build.profession,
          eliteSpec,
          profIcon,
          kitName: field.kitName || "",
          duration: field.duration,
          radius: field.radius,
        });
      }

      // Aggregate combo finishers (Blast, Whirl, Leap, Projectile)
      for (const fin of coverage.comboFinishers) {
        if (!lineFinisherMap.has(fin.finisherType)) {
          lineFinisherMap.set(fin.finisherType, { count: 0, sources: [] });
        }
        const entry = lineFinisherMap.get(fin.finisherType);
        entry.count++;
        entry.sources.push({
          sourceName: fin.sourceName,
          profession: build.profession,
          eliteSpec,
          profIcon,
          kitName: fin.kitName || "",
          hitCount: fin.hitCount,
          percent: fin.percent,
        });
      }
    }

    lineResults.push({
      lineId: line.id,
      label,
      hasFilledSlots,
      builds: lineBuilds,
      boons: lineBoonMap,
      comboFields: lineFieldMap,
      comboFinishers: lineFinisherMap,
    });
  }

  return { lines: lineResults };
}

// ── HTML rendering ────────────────────────────────────────────────────────────

export function buildPartyCoverageHTML(data) {
  const { lines } = data;

  return lines
    .filter((l) => l.hasFilledSlots)
    .map((line) => _renderPartyLine(line))
    .join("");
}

function _renderPartyLine(line) {
  const boonPills = _renderBoonPills(line.boons, line.label);
  const fieldPills = _renderFieldPills(line.comboFields, line.label);
  const finisherPills = _renderFinisherPills(line.comboFinishers, line.label);

  // Profession icons for the collapsed header (SVGs embedded for SPA portability)
  const profIcons = (line.builds || []).map(b => {
    const label = b.eliteSpec || b.profession || "";
    return `<span class="party-cov__header-prof" title="${escapeHtml(label)}">${b.profIcon || ""}</span>`;
  }).join("");

  // Mini boon icons for the collapsed header (all 12, greyed if uncovered)
  // Respects self-boon toggle: data-has-ally marks whether the boon has ally sources
  const headerBoons = BOON_DISPLAY_ORDER.map(boonName => {
    const entry = line.boons.get(boonName);
    const covered = entry && entry.count > 0;
    const hasAllySource = entry?.providers?.some(p =>
      p.sources?.some(s => s.isAlly)
    ) || false;
    const icon = BOON_CONDITION_ICONS[boonName] || "";
    return `<img src="${escapeHtml(icon)}" width="16" height="16" alt="${escapeHtml(boonName)}"
                 class="party-cov__header-boon ${covered ? "" : "party-cov__header-boon--uncovered"}"
                 data-boon-name="${escapeHtml(boonName)}"
                 data-has-ally="${hasAllySource}"
                 data-covered="${covered}" />`;
  }).join("");

  return `
    <div class="party-cov__line" data-line-label="${escapeHtml(line.label)}">
      <div class="party-cov__line-header" data-action="toggle-line">
        <span class="party-cov__line-chevron">&#x25b8;</span>
        <span class="party-cov__line-label">${escapeHtml(line.label)}</span>
        <span class="party-cov__header-profs">${profIcons}</span>
        <span class="party-cov__header-boons">${headerBoons}</span>
      </div>
      <div class="party-cov__line-body party-cov__line-body--collapsed">
        <div class="party-cov__body-toolbar">
          <label class="party-cov__toggle">
            <input type="checkbox" class="party-cov__toggle-input" data-action="toggle-self-boons" />
            <span class="party-cov__toggle-switch"></span>
            <span class="party-cov__toggle-text">Show self boons</span>
          </label>
        </div>
        <div class="party-cov__section" data-section="boons">
          <div class="party-cov__section-label">BOONS</div>
          <div class="party-cov__pills">${boonPills}</div>
          <div class="party-cov__expand" data-expand-for="boons"></div>
        </div>
        <div class="party-cov__section" data-section="fields">
          <div class="party-cov__section-label">COMBO FIELDS</div>
          <div class="party-cov__pills">${fieldPills}</div>
          <div class="party-cov__expand" data-expand-for="fields"></div>
        </div>
        <div class="party-cov__section" data-section="finishers">
          <div class="party-cov__section-label">FINISHERS</div>
          <div class="party-cov__pills">${finisherPills}</div>
          <div class="party-cov__expand" data-expand-for="finishers"></div>
        </div>
      </div>
    </div>`;
}

function _renderBoonPills(boonMap, lineLabel) {
  return BOON_DISPLAY_ORDER.map((boonName) => {
    const entry = boonMap.get(boonName);
    const count = entry?.count || 0;
    const covered = count > 0;
    const icon = BOON_CONDITION_ICONS[boonName] || "";

    // Check if any provider has an ally source
    const hasAllySource = entry?.providers?.some(p =>
      p.sources?.some(s => s.isAlly)
    ) || false;

    const providersJson = covered
      ? escapeHtml(JSON.stringify(entry.providers))
      : "[]";

    return `
      <div class="party-cov__pill party-cov__pill--boon ${covered ? "" : "party-cov__pill--uncovered"}"
           data-category="boon"
           data-boon-name="${escapeHtml(boonName)}"
           data-has-ally="${hasAllySource}"
           data-count="${count}"
           data-providers="${providersJson}"
           data-line-label="${escapeHtml(lineLabel)}"
           ${covered ? 'data-clickable="true"' : ""}>
        <img src="${escapeHtml(icon)}" width="20" height="20" alt="${escapeHtml(boonName)}"
             class="party-cov__pill-icon" />
        <span class="party-cov__pill-name">${escapeHtml(boonName)}</span>
        ${count > 1 ? `<span class="party-cov__pill-badge">&times;${count}</span>` : ""}
      </div>`;
  }).join("");
}

function _renderFieldPills(fieldMap, lineLabel) {
  return COMBO_FIELD_DISPLAY_ORDER
    .filter((ft) => fieldMap.has(ft))
    .map((fieldType) => {
      const entry = fieldMap.get(fieldType);
      const count = entry.count || 0;
      const colors = COMBO_FIELD_COLORS[fieldType] || { bg: "#333", text: "#aaa", border: "#555" };
      const sourcesJson = escapeHtml(JSON.stringify(entry.sources));

      return `
        <div class="party-cov__pill party-cov__pill--field"
             data-category="field"
             data-field-type="${escapeHtml(fieldType)}"
             data-count="${count}"
             data-sources="${sourcesJson}"
             data-line-label="${escapeHtml(lineLabel)}"
             data-clickable="true"
             style="background:${colors.bg}; color:${colors.text}; border-color:${colors.border};">
          <span class="party-cov__pill-name">${escapeHtml(fieldType)}</span>
          ${count > 1 ? `<span class="party-cov__pill-badge" style="color:${colors.text};">&times;${count}</span>` : ""}
        </div>`;
    }).join("");
}

function _renderFinisherPills(finisherMap, lineLabel) {
  return COMBO_FINISHER_DISPLAY_ORDER
    .filter((ft) => finisherMap.has(ft))
    .map((finisherType) => {
      const entry = finisherMap.get(finisherType);
      const count = entry.count || 0;
      const colors = COMBO_FINISHER_COLORS[finisherType] || { bg: "#333", text: "#aaa", border: "#555" };
      const sourcesJson = escapeHtml(JSON.stringify(entry.sources));

      return `
        <div class="party-cov__pill party-cov__pill--finisher"
             data-category="finisher"
             data-finisher-type="${escapeHtml(finisherType)}"
             data-count="${count}"
             data-sources="${sourcesJson}"
             data-line-label="${escapeHtml(lineLabel)}"
             data-clickable="true"
             style="background:${colors.bg}; color:${colors.text}; border-color:${colors.border};">
          <span class="party-cov__pill-name">${escapeHtml(finisherType)}</span>
          ${count > 1 ? `<span class="party-cov__pill-badge" style="color:${colors.text};">&times;${count}</span>` : ""}
        </div>`;
    }).join("");
}

// ── Expanded source detail panels ──────────────────────────────────────────

function _buildBoonExpandHTML(boonName, providers) {
  const icon = BOON_CONDITION_ICONS[boonName] || "";
  const totalSources = providers.reduce((n, p) => n + (p.sources?.length || 0), 0);

  const sourceRows = providers.flatMap(p =>
    (p.sources || []).map(s => {
      const iconHtml = p.profIcon || "";
      const specLabel = p.eliteSpec || p.profession || "";
      const dur = `${s.effectiveDuration}s`;
      const stacksHtml = s.stacks > 1
        ? `<span class="party-cov__src-stacks">&times;${s.stacks}</span>` : "";
      const targetClass = s.isAlly ? "party-cov__src-target--ally" : "party-cov__src-target--self";
      const targetLabel = s.isAlly ? "ALLY" : "SELF";
      return `<div class="party-cov__src-row">
        <span class="party-cov__src-icon">${iconHtml}</span>
        <span class="party-cov__src-name">${escapeHtml(s.name)}</span>
        <span class="party-cov__src-spec">${escapeHtml(specLabel)}</span>
        ${stacksHtml}
        <span class="party-cov__src-dur">${escapeHtml(dur)}</span>
        <span class="party-cov__src-target ${targetClass}">${targetLabel}</span>
      </div>`;
    })
  ).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: #8f8;">
      <img src="${escapeHtml(icon)}" width="18" height="18" alt="${escapeHtml(boonName)}" class="party-cov__expand-icon" />
      <span class="party-cov__expand-title" style="color: #afa;">${escapeHtml(boonName)} — ${totalSources} source${totalSources !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: #8f8;">
      ${sourceRows}
    </div>`;
}

function _buildFieldExpandHTML(fieldType, sources) {
  const colors = COMBO_FIELD_COLORS[fieldType] || { text: "#aaa", border: "#555" };

  const sourceRows = sources.map(s => {
    const iconHtml = s.profIcon || "";
    const specLabel = s.kitName
      ? `${s.eliteSpec || s.profession} <span class="party-cov__src-kit">(${escapeHtml(s.kitName)})</span>`
      : escapeHtml(s.eliteSpec || s.profession || "");
    const durHtml = s.duration ? `<span class="party-cov__src-dur">${s.duration}s duration</span>` : "";
    const radiusHtml = s.radius ? `<span class="party-cov__src-radius">${s.radius} radius</span>` : "";
    return `<div class="party-cov__src-row">
      <span class="party-cov__src-icon">${iconHtml}</span>
      <span class="party-cov__src-name">${escapeHtml(s.sourceName)}</span>
      <span class="party-cov__src-spec">${specLabel}</span>
      ${durHtml}
      ${radiusHtml}
    </div>`;
  }).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: ${colors.text};">
      <span class="party-cov__expand-title" style="color: ${colors.text};">${escapeHtml(fieldType)} Field — ${sources.length} source${sources.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: ${colors.text};">
      ${sourceRows}
    </div>`;
}

function _buildFinisherExpandHTML(finisherType, sources) {
  const colors = COMBO_FINISHER_COLORS[finisherType] || { text: "#aaa" };

  const sourceRows = sources.map(s => {
    const iconHtml = s.profIcon || "";
    const specLabel = s.kitName
      ? `${s.eliteSpec || s.profession} <span class="party-cov__src-kit">(${escapeHtml(s.kitName)})</span>`
      : escapeHtml(s.eliteSpec || s.profession || "");
    const countLabel = s.hitCount > 1 ? `<span class="party-cov__src-blasts">&times;${s.hitCount}</span>` : "";
    const pctHtml = s.percent < 100
      ? `<span class="party-cov__src-pct">(${s.percent}%)</span>` : "";
    return `<div class="party-cov__src-row">
      <span class="party-cov__src-icon">${iconHtml}</span>
      <span class="party-cov__src-name">${escapeHtml(s.sourceName)}</span>
      <span class="party-cov__src-spec">${specLabel}</span>
      ${countLabel}
      ${pctHtml}
    </div>`;
  }).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: ${colors.text};">
      <span class="party-cov__expand-title" style="color: ${colors.text};">${escapeHtml(finisherType)} — ${sources.length} source${sources.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: ${colors.text};">
      ${sourceRows}
    </div>`;
}

// ── Event binding ─────────────────────────────────────────────────────────

let _activeExpand = null; // { expandEl, pillEl }

function _closeExpand() {
  if (!_activeExpand) return;
  _activeExpand.expandEl.classList.remove("party-cov__expand--open");
  _activeExpand.pillEl.classList.remove("party-cov__pill--active");
  _activeExpand = null;
}

export function closePartyCoverageExpand() { _closeExpand(); }

export function bindPartyCoverageEvents(container) {
  // Line collapse/expand toggle
  container.querySelectorAll('[data-action="toggle-line"]').forEach(header => {
    header.addEventListener("click", () => {
      const lineEl = header.closest(".party-cov__line");
      if (!lineEl) return;
      const body = lineEl.querySelector(".party-cov__line-body");
      const chevron = header.querySelector(".party-cov__line-chevron");
      if (!body) return;
      const collapsed = body.classList.toggle("party-cov__line-body--collapsed");
      if (chevron) chevron.innerHTML = collapsed ? "&#x25b8;" : "&#x25be;";
    });
  });

  // Self-boon toggle — updates pills, header icons, badges, and expanded source rows
  container.querySelectorAll('[data-action="toggle-self-boons"]').forEach(toggle => {
    toggle.addEventListener("change", () => {
      const lineEl = toggle.closest(".party-cov__line");
      if (!lineEl) return;
      const showSelf = toggle.checked;
      // Update body pills — grey out self-only boons, update badge counts
      lineEl.querySelectorAll('.party-cov__pill--boon').forEach(pill => {
        const hasAlly = pill.dataset.hasAlly === "true";
        const totalCount = Number(pill.dataset.count) || 0;
        if (!totalCount) return; // naturally uncovered, leave as-is
        if (!showSelf && !hasAlly) {
          pill.classList.add("party-cov__pill--self-only");
        } else {
          pill.classList.remove("party-cov__pill--self-only");
        }
        // Recount providers based on toggle — count only providers with ally sources when self is off
        let visibleCount = totalCount;
        if (!showSelf) {
          try {
            const providers = JSON.parse(pill.dataset.providers || "[]");
            visibleCount = providers.filter(p => p.sources?.some(s => s.isAlly)).length;
          } catch { /* */ }
        }
        const badge = pill.querySelector(".party-cov__pill-badge");
        if (badge) {
          badge.textContent = visibleCount > 1 ? `×${visibleCount}` : "";
        }
      });
      // Update header boon icons to match
      lineEl.querySelectorAll('.party-cov__header-boon').forEach(img => {
        const covered = img.dataset.covered === "true";
        const hasAlly = img.dataset.hasAlly === "true";
        if (!covered) {
          img.classList.add("party-cov__header-boon--uncovered");
        } else if (!showSelf && !hasAlly) {
          img.classList.add("party-cov__header-boon--uncovered");
        } else {
          img.classList.remove("party-cov__header-boon--uncovered");
        }
      });
      // Hide/show SELF source rows in any open expansion, update source count header
      lineEl.querySelectorAll('.party-cov__src-target--self').forEach(badge => {
        const row = badge.closest('.party-cov__src-row');
        if (row) row.style.display = showSelf ? "" : "none";
      });
      // Update "N sources" count in expand headers
      lineEl.querySelectorAll('.party-cov__expand--open').forEach(expandEl => {
        const rows = expandEl.querySelectorAll('.party-cov__src-row');
        let visible = 0;
        rows.forEach(r => { if (r.style.display !== "none") visible++; });
        const titleEl = expandEl.querySelector('.party-cov__expand-title');
        if (titleEl) {
          titleEl.textContent = titleEl.textContent.replace(/— \d+ source(s?)/, `— ${visible} source${visible !== 1 ? "s" : ""}`);
        }
      });
    });
    // Apply initial state (toggle is unchecked = hide self-only)
    toggle.dispatchEvent(new Event("change"));
  });

  // Click to expand pills
  container.querySelectorAll('.party-cov__pill[data-clickable="true"]').forEach(pillEl => {
    pillEl.addEventListener("click", (e) => {
      e.stopPropagation();

      // Toggle: clicking active pill closes it
      if (_activeExpand?.pillEl === pillEl) {
        _closeExpand();
        return;
      }
      _closeExpand();

      const section = pillEl.closest(".party-cov__section");
      const expandEl = section?.querySelector(".party-cov__expand");
      if (!expandEl) return;

      const category = pillEl.dataset.category;
      let html = "";

      if (category === "boon") {
        let providers = [];
        try { providers = JSON.parse(pillEl.dataset.providers || "[]"); } catch { /* */ }
        html = _buildBoonExpandHTML(pillEl.dataset.boonName, providers);
      } else if (category === "field") {
        let sources = [];
        try { sources = JSON.parse(pillEl.dataset.sources || "[]"); } catch { /* */ }
        html = _buildFieldExpandHTML(pillEl.dataset.fieldType, sources);
      } else if (category === "finisher") {
        let sources = [];
        try { sources = JSON.parse(pillEl.dataset.sources || "[]"); } catch { /* */ }
        html = _buildFinisherExpandHTML(pillEl.dataset.finisherType, sources);
      }

      expandEl.innerHTML = html;
      pillEl.classList.add("party-cov__pill--active");
      _activeExpand = { expandEl, pillEl };

      // Apply current self-toggle state to newly rendered SELF source rows
      const lineEl = pillEl.closest(".party-cov__line");
      const toggleEl = lineEl?.querySelector('[data-action="toggle-self-boons"]');
      if (toggleEl && !toggleEl.checked) {
        expandEl.querySelectorAll('.party-cov__src-target--self').forEach(badge => {
          const row = badge.closest('.party-cov__src-row');
          if (row) row.style.display = "none";
        });
      }

      requestAnimationFrame(() => expandEl.classList.add("party-cov__expand--open"));
    });
  });
}
