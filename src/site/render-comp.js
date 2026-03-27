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

// ── Party Coverage ───────────────────────────────────────────────────────

function renderPartyCoverage(comp) {
  if (!comp.boonCoverageHtml) return "";
  return `
    <div class="comp-boon-cov">
      <div class="comp-boon-cov__header">
        <span class="comp-boon-cov__chevron">\u25be</span>
        <span class="comp-boon-cov__title">PARTY COVERAGE</span>
      </div>
      <div class="comp-boon-cov__body">${comp.boonCoverageHtml}</div>
    </div>`;
}

// ── Party Coverage Interactions ───────────────────────────────────────────

// Profession color pips (same as desktop)
const PROF_PIP_COLORS = {
  Guardian: "#6ea8ff", Warrior: "#ff9944", Necromancer: "#4dca7a",
  Engineer: "#cc8844", Ranger: "#77cc55", Thief: "#cc6677",
  Mesmer: "#b07acc", Elementalist: "#dd5555", Revenant: "#aa6655",
};

const COMBO_FIELD_COLORS = {
  Fire: { text: "#f96" }, Water: { text: "#6af" }, Light: { text: "#ee8" },
  Dark: { text: "#c8a" }, Ethereal: { text: "#aaf" }, Ice: { text: "#8de" },
  Lightning: { text: "#ee6" }, Smoke: { text: "#aaa" }, Poison: { text: "#8d8" },
};

let _activeExpand = null; // { expandEl, pillEl }

function closePartyCoverageExpand() {
  if (!_activeExpand) return;
  _activeExpand.expandEl.classList.remove("party-cov__expand--open");
  _activeExpand.pillEl.classList.remove("party-cov__pill--active");
  _activeExpand = null;
}

function buildBoonExpandHTML(boonName, providers, builds, iconSrc) {
  const totalSources = providers.reduce((n, p) => n + (p.sources?.length || 0), 0);
  const iconHtml = iconSrc
    ? `<img src="${escapeHtml(iconSrc)}" width="18" height="18" alt="${escapeHtml(boonName)}" class="party-cov__expand-icon" />`
    : "";

  const sourceRows = providers.flatMap(p => {
    return (p.sources || []).map(s => {
      const pipColor = PROF_PIP_COLORS[p.profession] || "#888";
      const specLabel = p.eliteSpec || p.profession || "";
      const dur = `${s.effectiveDuration}s`;
      const stacksHtml = s.stacks > 1
        ? `<span class="party-cov__src-stacks">&times;${s.stacks}</span>` : "";
      const targetClass = s.isAlly ? "party-cov__src-target--ally" : "party-cov__src-target--self";
      const targetLabel = s.isAlly ? "ALLY" : "SELF";
      return `<div class="party-cov__src-row">
        <span class="party-cov__src-pip" style="background:${pipColor};"></span>
        <span class="party-cov__src-name">${escapeHtml(s.name)}</span>
        <span class="party-cov__src-spec">${escapeHtml(specLabel)}</span>
        ${stacksHtml}
        <span class="party-cov__src-dur">${escapeHtml(dur)}</span>
        <span class="party-cov__src-target ${targetClass}">${targetLabel}</span>
      </div>`;
    });
  }).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: #8f8;">
      ${iconHtml}
      <span class="party-cov__expand-title" style="color: #afa;">${escapeHtml(boonName)} — ${totalSources} source${totalSources !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: #8f8;">
      ${sourceRows}
    </div>`;
}

function buildFieldExpandHTML(fieldType, sources) {
  const colors = COMBO_FIELD_COLORS[fieldType] || { text: "#aaa" };
  const sourceRows = sources.map(s => {
    const pipColor = PROF_PIP_COLORS[s.profession] || "#888";
    const specLabel = s.kitName
      ? `${s.eliteSpec || s.profession} <span class="party-cov__src-kit">(${escapeHtml(s.kitName)})</span>`
      : escapeHtml(s.eliteSpec || s.profession || "");
    const durHtml = s.duration ? `<span class="party-cov__src-dur">${s.duration}s duration</span>` : "";
    const radiusHtml = s.radius ? `<span class="party-cov__src-radius">${s.radius} radius</span>` : "";
    return `<div class="party-cov__src-row">
      <span class="party-cov__src-pip" style="background:${pipColor};"></span>
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

function buildBlastExpandHTML(blasts) {
  const sourceRows = blasts.map(b => {
    const pipColor = PROF_PIP_COLORS[b.profession] || "#888";
    const specLabel = b.kitName
      ? `${b.eliteSpec || b.profession} <span class="party-cov__src-kit">(${escapeHtml(b.kitName)})</span>`
      : escapeHtml(b.eliteSpec || b.profession || "");
    const countLabel = `&times;${b.blastCount} blast${b.blastCount !== 1 ? "s" : ""}`;
    const pctHtml = b.percent < 100
      ? ` <span class="party-cov__src-pct">(${b.percent}%)</span>` : "";
    return `<div class="party-cov__src-row">
      <span class="party-cov__src-pip" style="background:${pipColor};"></span>
      <span class="party-cov__src-name">${escapeHtml(b.sourceName)}</span>
      <span class="party-cov__src-spec">${specLabel}</span>
      <span class="party-cov__src-blasts">${countLabel}${pctHtml}</span>
    </div>`;
  }).join("");

  return `
    <div class="party-cov__expand-header" style="border-left-color: #c8f;">
      <span class="party-cov__expand-title" style="color: #c8f;">Blast Finishers — ${blasts.length} source${blasts.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="party-cov__expand-body" style="border-left-color: #c8f;">
      ${sourceRows}
    </div>`;
}

function bindPartyCoverageEvents(container, builds) {
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

  // Self-boon toggle — updates both body pills and header boon icons
  container.querySelectorAll('[data-action="toggle-self-boons"]').forEach(toggle => {
    toggle.addEventListener("change", () => {
      const lineEl = toggle.closest(".party-cov__line");
      if (!lineEl) return;
      const showSelf = toggle.checked;
      // Update body pills
      lineEl.querySelectorAll(".party-cov__pill--boon").forEach(pill => {
        if (showSelf) {
          pill.classList.remove("party-cov__pill--self-hidden");
        } else {
          const hasAlly = pill.dataset.hasAlly === "true";
          const covered = Number(pill.dataset.count) > 0;
          if (covered && !hasAlly) {
            pill.classList.add("party-cov__pill--self-hidden");
          }
        }
      });
      // Update header boon icons to match
      lineEl.querySelectorAll(".party-cov__header-boon").forEach(img => {
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
    });
    // Apply initial state
    toggle.dispatchEvent(new Event("change"));
  });

  // Click to expand
  container.querySelectorAll('.party-cov__pill[data-clickable="true"]').forEach(pillEl => {
    pillEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (_activeExpand?.pillEl === pillEl) { closePartyCoverageExpand(); return; }
      closePartyCoverageExpand();

      const section = pillEl.closest(".party-cov__section");
      const expandEl = section?.querySelector(".party-cov__expand");
      if (!expandEl) return;

      const category = pillEl.dataset.category;
      let html = "";

      if (category === "boon") {
        let providers = [];
        try { providers = JSON.parse(pillEl.dataset.providers || "[]"); } catch { /* */ }
        const iconSrc = pillEl.querySelector(".party-cov__pill-icon")?.src || "";
        html = buildBoonExpandHTML(pillEl.dataset.boonName, providers, builds, iconSrc);
      } else if (category === "field") {
        let sources = [];
        try { sources = JSON.parse(pillEl.dataset.sources || "[]"); } catch { /* */ }
        html = buildFieldExpandHTML(pillEl.dataset.fieldType, sources);
      } else if (category === "blast") {
        let sources = [];
        try { sources = JSON.parse(pillEl.dataset.sources || "[]"); } catch { /* */ }
        html = buildBlastExpandHTML(sources);
      }

      expandEl.innerHTML = html;
      pillEl.classList.add("party-cov__pill--active");
      _activeExpand = { expandEl, pillEl };
      requestAnimationFrame(() => expandEl.classList.add("party-cov__expand--open"));
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
          ${renderPartyCoverage(comp)}
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
    bindPartyCoverageEvents(app, comp.builds || {});

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
