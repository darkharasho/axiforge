"use strict";

import { escapeHtml } from "./main.js";
import { renderMiniBuildCard } from "../renderer/modules/mini-build-card.js";
import { initMobileDetection } from "./mobile.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function getProfIcon(build) {
  if (build.professionIcon) return build.professionIcon;
  return `<span style="font-size:1.2em">${(build.profession || "?")[0]}</span>`;
}

function getEliteSpecName(build) {
  if (!build.specializations) return null;
  for (const s of build.specializations) {
    if (s.elite && s.name) return s.name;
  }
  return null;
}

function profClass(profession) {
  if (!profession) return "";
  return `lib-prof--${profession.toLowerCase()}`;
}

function getDisplayName(build) {
  return build.title || getEliteSpecName(build) || build.profession || "Untitled";
}

// ── Party Lines ──────────────────────────────────────────────────────────

function renderSlot(build) {
  if (!build) {
    return `<div class="comp-slot comp-slot--empty"></div>`;
  }
  const pClass = profClass(build.profession);
  const title = escapeHtml(getDisplayName(build));
  if (build.spaUrl) {
    return `
      <a href="${escapeHtml(build.spaUrl)}" target="_blank" rel="noopener"
         class="comp-slot comp-slot--filled ${pClass}" title="${title}">
        <span class="comp-slot__icon">${getProfIcon(build)}</span>
      </a>`;
  }
  return `
    <div class="comp-slot comp-slot--filled ${pClass}" title="${title}">
      <span class="comp-slot__icon">${getProfIcon(build)}</span>
    </div>`;
}

function renderPartyLines(comp) {
  return (comp.partyLines || []).map((line, idx) => {
    const slots = line.slots || [];
    const capacity = line.capacity || 5;
    const slotBoxes = slots.map((buildId) => renderSlot(comp.builds?.[buildId]));
    for (let i = slots.length; i < capacity; i++) {
      slotBoxes.push(`<div class="comp-slot comp-slot--empty"></div>`);
    }
    return `
      <div class="comp-line">
        <span class="comp-line__label">P${idx + 1}</span>
        <div class="comp-line__slots">${slotBoxes.join("")}</div>
        <div class="comp-line__controls">
          <span class="comp-line__count">${slots.length} / ${capacity}</span>
        </div>
      </div>`;
  }).join("");
}

// ── Pool Panel ───────────────────────────────────────────────────────────

function renderPoolCard(build) {
  // Render the shared mini card (no desktop action buttons in read-only SPA)
  return renderMiniBuildCard(build, null, {
    showActions: false,
    linkUrl: build.spaUrl || null,
    chatLink: build.chatLink || null,
  });
}

function renderBuildPool(comp) {
  const builds = comp.builds || {};
  const cards = Object.values(builds).map(renderPoolCard).join("");
  return `
    <div class="comp-pool">
      <div class="comp-pool-header">
        <span class="comp-pool-title">BUILDS <span class="comp-pool-count">(${Object.keys(builds).length})</span></span>
      </div>
      <div class="comp-pool-list">
        ${cards || '<p class="comp-pool-empty">No builds</p>'}
      </div>
    </div>`;
}

// ── Tags + Notes ─────────────────────────────────────────────────────────

function renderTagsRow(comp) {
  const tags = comp.tags || [];
  if (!tags.length) return "";
  const pills = tags.map((t) => `<span class="comp-detail__tag">${escapeHtml(t)}</span>`).join("");
  return `<div class="comp-detail__tags-row">${pills}</div>`;
}

function renderNotes(comp) {
  if (!comp.notes?.trim()) return "";
  return `
    <div class="comp-detail__notes-panel">
      <pre class="comp-detail__notes-textarea" style="white-space:pre-wrap;resize:none;cursor:default;">${escapeHtml(comp.notes)}</pre>
    </div>`;
}

// ── Boon Coverage ────────────────────────────────────────────────────────

function renderBoonCoverage(comp) {
  if (!comp.boonCoverageHtml) return "";
  return `
    <div class="comp-boon-cov">
      <div class="comp-boon-cov__header">
        <span class="comp-boon-cov__chevron">\u25be</span>
        <span class="comp-boon-cov__title">BOON COVERAGE</span>
      </div>
      <div class="comp-boon-cov__body">${comp.boonCoverageHtml}</div>
    </div>`;
}

// ── Boon Coverage Interactions ───────────────────────────────────────────

let _activeExpand = null; // { expandEl, iconEl }
let _activeTooltip = null;

function closeBoonTooltip() {
  if (_activeTooltip) { _activeTooltip.remove(); _activeTooltip = null; }
}

function closeDurationExpand() {
  if (!_activeExpand) return;
  _activeExpand.expandEl.classList.remove("comp-boon-cov__duration-expand--open");
  _activeExpand.iconEl.classList.remove("comp-boon-cov__icon--active");
  _activeExpand = null;
}

function buildDurationExpandHTML(boonName, lineLabel, providers, builds) {
  const buildBlocks = providers
    .filter(p => p.sources && p.sources.length > 0)
    .map((p, i, arr) => {
      // Look up professionIcon SVG from the comp's builds map
      const buildData = builds?.[p.buildId];
      const profIcon = buildData?.professionIcon || getProfIcon(buildData || { profession: p.profession });
      const sourceRows = p.sources.map(s => {
        const typeClass = s.type === "skill" ? "comp-boon-cov__dur-type--skill" : "comp-boon-cov__dur-type--trait";
        const typeLabel = s.type === "skill" ? "SKILL" : "TRAIT";
        const dur = `${s.effectiveDuration}s`;
        const stacksHtml = s.stacks > 1
          ? `<span class="comp-boon-cov__dur-stacks">&times;${s.stacks}</span>`
          : "";
        const targetHtml = s.isAlly
          ? `<span class="comp-boon-cov__dur-target comp-boon-cov__dur-target--ally">ALLY</span>`
          : `<span class="comp-boon-cov__dur-target comp-boon-cov__dur-target--self">SELF</span>`;
        const descHtml = s.context
          ? `<span class="comp-boon-cov__dur-source-desc">${escapeHtml(s.context)}</span>`
          : "";
        return `<div class="comp-boon-cov__dur-source">
          <span class="comp-boon-cov__dur-type ${typeClass}">${typeLabel}</span>
          <span class="comp-boon-cov__dur-source-name">${escapeHtml(s.name)}${descHtml}</span>
          <span class="comp-boon-cov__dur-duration">${escapeHtml(dur)}</span>
          ${stacksHtml}
          ${targetHtml}
        </div>`;
      }).join("");
      const sep = i < arr.length - 1 ? '<div class="comp-boon-cov__dur-sep"></div>' : "";
      return `<div class="comp-boon-cov__dur-build">
        <div class="comp-boon-cov__dur-build-header">
          <span class="comp-boon-cov__dur-prof">${profIcon}</span>
          <span class="comp-boon-cov__dur-build-name">${escapeHtml(p.buildName)}</span>
        </div>
        <div class="comp-boon-cov__dur-sources">${sourceRows}</div>
      </div>${sep}`;
    }).join("");

  // Get the icon URL from the data-providers parent icon's img src
  return `
    <div class="comp-boon-cov__dur-header">
      <span class="comp-boon-cov__dur-boon-name">${escapeHtml(boonName)}</span>
      <span class="comp-boon-cov__dur-line-label">${escapeHtml(lineLabel)}</span>
      <button class="comp-boon-cov__dur-close" aria-label="Close">&#x2715;</button>
    </div>
    ${buildBlocks}
  `;
}

function buildTooltipHTML(boonName, count, providers, scope, builds) {
  const headerLabel = count > 0
    ? `${count} ${count === 1 ? "build" : "builds"}`
    : "Not covered";

  if (count === 0) {
    return `<div class="comp-boon-tooltip__header">
      <span class="comp-boon-tooltip__name">${escapeHtml(boonName)}</span>
      <span class="comp-boon-tooltip__count">${escapeHtml(headerLabel)}</span>
    </div>`;
  }

  if (scope === "line") {
    const rows = providers.map(p => {
      const bd = builds?.[p.buildId];
      const icon = bd?.professionIcon || getProfIcon(bd || { profession: p.profession });
      return `<div class="comp-boon-tooltip__row">
        <span class="comp-boon-tooltip__prof">${icon}</span>
        <span class="comp-boon-tooltip__build-name">${escapeHtml(p.buildName)}</span>
      </div>`;
    }).join("");
    return `<div class="comp-boon-tooltip__header">
      <span class="comp-boon-tooltip__name">${escapeHtml(boonName)}</span>
      <span class="comp-boon-tooltip__count">${escapeHtml(headerLabel)}</span>
    </div>
    <div class="comp-boon-tooltip__sep"></div>
    <div class="comp-boon-tooltip__providers">${rows}</div>`;
  }

  // Squad scope — group by line
  const byLine = new Map();
  for (const p of providers) {
    if (!byLine.has(p.lineLabel)) byLine.set(p.lineLabel, []);
    byLine.get(p.lineLabel).push(p);
  }
  const lineGroups = [...byLine.entries()].map(([lbl, lps]) => {
    const rows = lps.map(p =>
      `<div class="comp-boon-tooltip__row">
        <span class="comp-boon-tooltip__build-name">${escapeHtml(p.buildName)}</span>
      </div>`
    ).join("");
    return `<div class="comp-boon-tooltip__line-group">
      <div class="comp-boon-tooltip__line-label">${escapeHtml(lbl)}</div>
      ${rows}
    </div>`;
  }).join("");

  return `<div class="comp-boon-tooltip__header">
    <span class="comp-boon-tooltip__name">${escapeHtml(boonName)}</span>
    <span class="comp-boon-tooltip__count">${escapeHtml(headerLabel)}</span>
  </div>
  <div class="comp-boon-tooltip__sep"></div>
  <div class="comp-boon-tooltip__providers">${lineGroups}</div>`;
}

function bindBoonEvents(container, builds) {
  // Hover tooltips
  container.querySelectorAll(".comp-boon-cov__icon").forEach(iconEl => {
    iconEl.addEventListener("mouseenter", () => {
      if (_activeExpand?.iconEl === iconEl) return;
      closeBoonTooltip();
      const boonName = iconEl.dataset.boonName;
      const count = Number(iconEl.dataset.count) || 0;
      const scope = iconEl.dataset.scope;
      let providers = [];
      try { providers = JSON.parse(iconEl.dataset.providers || "[]"); } catch { /* */ }

      const tip = document.createElement("div");
      tip.className = "comp-boon-tooltip";
      tip.innerHTML = buildTooltipHTML(boonName, count, providers, scope, builds);
      document.body.appendChild(tip);
      _activeTooltip = tip;

      const ir = iconEl.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      const vw = window.innerWidth;
      let top = ir.top - tr.height - 6;
      let left = ir.left + ir.width / 2 - tr.width / 2;
      if (top < 4) top = ir.bottom + 6;
      if (left < 4) left = 4;
      if (left + tr.width > vw - 4) left = vw - tr.width - 4;
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
    });
    iconEl.addEventListener("mouseleave", closeBoonTooltip);
  });

  // Click to expand duration details (per-line icons)
  container.querySelectorAll('.comp-boon-cov__icon[data-clickable="true"]').forEach(iconEl => {
    iconEl.addEventListener("click", (e) => {
      e.stopPropagation();
      closeBoonTooltip();
      if (_activeExpand?.iconEl === iconEl) { closeDurationExpand(); return; }
      closeDurationExpand();

      const lineRow = iconEl.closest(".comp-boon-cov__line-row");
      const expandEl = lineRow?.nextElementSibling;
      if (!expandEl || !expandEl.classList.contains("comp-boon-cov__duration-expand")) return;

      let providers = [];
      try { providers = JSON.parse(iconEl.dataset.providers || "[]"); } catch { /* */ }
      const boonName = iconEl.dataset.boonName;
      const lineLabel = iconEl.dataset.lineLabel || "";

      expandEl.innerHTML = buildDurationExpandHTML(boonName, lineLabel, providers, builds);
      iconEl.classList.add("comp-boon-cov__icon--active");
      _activeExpand = { expandEl, iconEl };

      expandEl.querySelector(".comp-boon-cov__dur-close")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeDurationExpand();
      });

      requestAnimationFrame(() => expandEl.classList.add("comp-boon-cov__duration-expand--open"));
    });
  });
}

// ── Main Entry ───────────────────────────────────────────────────────────

export function renderCompPage(app, comp) {
  const name = escapeHtml(comp.name || "Untitled Comp");
  const gameMode = comp.gameMode || "";

  app.innerHTML = `
    <div class="comp-detail">
      <div class="comp-detail__topbar">
        <span class="comp-detail__name">${name}</span>
        <span class="comp-detail__spacer"></span>
        ${gameMode ? `<span class="comp-detail__slot-counter">${escapeHtml(gameMode.toUpperCase())}</span>` : ""}
      </div>
      ${renderTagsRow(comp)}
      ${renderNotes(comp)}
      <div class="comp-detail__body">
        <div class="comp-detail__party-panel">
          ${renderPartyLines(comp)}
          ${renderBoonCoverage(comp)}
        </div>
        <div class="comp-detail__pool-panel">
          ${renderBuildPool(comp)}
        </div>
      </div>
    </div>`;

  // Bind build code copy buttons
  app.querySelectorAll(".mini-card__btn-copy-code").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const link = btn.dataset.chatLink;
      if (!link) return;
      const labelEl = btn.querySelector("span");
      try {
        await navigator.clipboard.writeText(link);
        btn.classList.add("mini-card__btn-copy-code--copied");
        if (labelEl) labelEl.textContent = "Copied!";
      } catch {
        if (labelEl) labelEl.textContent = "Failed";
      }
      setTimeout(() => {
        btn.classList.remove("mini-card__btn-copy-code--copied");
        if (labelEl) labelEl.textContent = "Code";
      }, 2000);
    });
  });

  // Bind boon coverage interactions after DOM is rendered
  if (comp.boonCoverageHtml) {
    bindBoonEvents(app, comp.builds || {});

    // Collapse/expand toggle for boon coverage header
    const boonHeader = app.querySelector(".comp-boon-cov__header");
    const boonBody = app.querySelector(".comp-boon-cov__body");
    const boonChevron = app.querySelector(".comp-boon-cov__chevron");
    if (boonHeader && boonBody && boonChevron) {
      boonHeader.addEventListener("click", () => {
        const collapsed = boonBody.classList.toggle("comp-boon-cov__body--hidden");
        boonChevron.textContent = collapsed ? "\u25b8" : "\u25be";
      });
    }
  }

  initMobileDetection();
}
