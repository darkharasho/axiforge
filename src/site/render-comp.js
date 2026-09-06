"use strict";

import { escapeHtml } from "./main.js";
import { renderMiniBuildCard } from "../renderer/modules/mini-build-card.js";
import { formatFactHtml } from "../renderer/modules/detail-panel.js";
import { initMobileDetection } from "./mobile.js";
import { partyNumberIcon } from "../renderer/modules/library/heroicons.js";
import { renderNotes } from "./render-notes.js";

// ── Helpers ──────────────────────────────────────────────────────────────

const LINE_COLORS = { red: "#d63a3a", blue: "#3a8fd6" };

function recolorSvg(svg, color) {
  if (!color || color === "normal" || !LINE_COLORS[color]) return svg;
  return svg.replace(/fill:#(?!000000)[0-9a-fA-F]{6}/gi, `fill:${LINE_COLORS[color]}`);
}

function getProfIcon(build, color) {
  if (build.professionIcon) return recolorSvg(build.professionIcon, color);
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

// A slot id is either a build id or a category reference "tag:<id>".
const TAG_PREFIX = "tag:";
const isTagSlot = (id) => typeof id === "string" && id.startsWith(TAG_PREFIX);

// A tag slot is a single placeholder showing the category icon; its tooltip lists the
// member builds so hovering reveals the options, matching the desktop app.
function renderTagSlot(category, builds) {
  if (!category) return `<div class="comp-slot comp-slot--empty"></div>`;
  const name = category.name || "Tag";
  const members = (category.buildIds || [])
    .map((id) => builds?.[id])
    .filter(Boolean)
    .map((b) => getDisplayName(b));
  // title is a no-JS fallback; the rich popover (bound in renderCompPage) is primary.
  const title = members.length ? `${name}: ${members.join(", ")}` : name;
  const inner = category.icon
    ? `<img class="comp-slot__tag-img" src="${escapeHtml(category.icon)}" alt="${escapeHtml(name)}" />`
    : `<span class="comp-slot__tag-text">${escapeHtml(name.slice(0, 3))}</span>`;
  return `
    <div class="comp-slot comp-slot--filled comp-slot--tag" title="${escapeHtml(title)}"
         data-category-id="${escapeHtml(category.id || "")}">
      <span class="comp-slot__icon">${inner}</span>
    </div>`;
}

// ── Tag-slot hover popover (parity with the desktop app) ───────────────────
let _tagHoverData = new Map();   // categoryId → { name, builds: [{ name, icon, pClass }] }
let _tagHoverEl = null;

function buildTagHoverData(comp) {
  _tagHoverData = new Map();
  for (const cat of (comp.categories || [])) {
    const builds = (cat.buildIds || [])
      .map((id) => comp.builds?.[id])
      .filter(Boolean)
      .map((b) => ({ name: getDisplayName(b), icon: getProfIcon(b, "normal"), pClass: profClass(b.profession) }));
    _tagHoverData.set(cat.id, { name: cat.name || "Tag", builds });
  }
}

function hideTagHover() {
  if (_tagHoverEl) { _tagHoverEl.remove(); _tagHoverEl = null; }
}

function showTagHover(slotEl) {
  const data = _tagHoverData.get(slotEl.dataset.categoryId);
  if (!data) return;
  hideTagHover();
  const rows = data.builds.length
    ? data.builds.map((b) => `<div class="comp-tag-pop__row ${b.pClass}">
        <span class="comp-tag-pop__icon">${b.icon}</span>
        <span class="comp-tag-pop__name">${escapeHtml(b.name)}</span>
      </div>`).join("")
    : `<div class="comp-tag-pop__empty">No builds in this tag</div>`;
  const el = document.createElement("div");
  el.className = "comp-tag-pop";
  el.innerHTML = `<div class="comp-tag-pop__title">${escapeHtml(data.name)}</div>${rows}`;
  document.body.appendChild(el);
  const r = slotEl.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  let left = r.left;
  if (left + er.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - er.width - 8);
  el.style.left = `${left}px`;
  el.style.top = `${r.bottom + 6}px`;
  _tagHoverEl = el;
}

function renderSlot(build, color) {
  if (!build) {
    return `<div class="comp-slot comp-slot--empty"></div>`;
  }
  const pClass = profClass(build.profession);
  const title = escapeHtml(getDisplayName(build));
  const colorAttr = color && color !== "normal" ? ` data-slot-color="${color}"` : "";
  if (build.spaUrl) {
    return `
      <a href="${escapeHtml(build.spaUrl)}" target="_blank" rel="noopener"
         class="comp-slot comp-slot--filled ${pClass}"${colorAttr} title="${title}">
        <span class="comp-slot__icon">${getProfIcon(build, color)}</span>
      </a>`;
  }
  return `
    <div class="comp-slot comp-slot--filled ${pClass}"${colorAttr} title="${title}">
      <span class="comp-slot__icon">${getProfIcon(build, color)}</span>
    </div>`;
}

function renderPartyLines(comp) {
  return (comp.partyLines || []).map((line, idx) => {
    const slots = line.slots || [];
    const capacity = line.capacity || 5;
    const buildColors = comp.buildColors || {};
    const categoryById = new Map((comp.categories || []).map((c) => [c.id, c]));
    const slotBoxes = slots.map((slotId) =>
      isTagSlot(slotId)
        ? renderTagSlot(categoryById.get(slotId.slice(TAG_PREFIX.length)), comp.builds)
        : renderSlot(comp.builds?.[slotId], buildColors[slotId] || "normal")
    );
    for (let i = slots.length; i < capacity; i++) {
      slotBoxes.push(`<div class="comp-slot comp-slot--empty"></div>`);
    }
    return `
      <div class="comp-line">
        <span class="comp-line__label">${partyNumberIcon(idx + 1)}</span>
        <div class="comp-line__slots">${slotBoxes.join("")}</div>
        <div class="comp-line__controls">
          <span class="comp-line__count">${slots.length} / ${capacity}</span>
        </div>
      </div>`;
  }).join("");
}

// ── Pool Panel ───────────────────────────────────────────────────────────

function renderPoolCard(build, slotColor) {
  // Render the shared mini card (no desktop action buttons in read-only SPA)
  return renderMiniBuildCard(build, null, {
    showActions: false,
    linkUrl: build.spaUrl || null,
    chatLink: build.chatLink || null,
    slotColor: slotColor || null,
  });
}

function renderBuildPool(comp) {
  const builds = comp.builds || {};
  const buildColors = comp.buildColors || {};
  const cards = Object.entries(builds).map(([id, build]) => renderPoolCard(build, buildColors[id])).join("");
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

const COMBO_FIELD_COLORS = {
  Fire: { text: "#f96" }, Water: { text: "#6af" }, Light: { text: "#ee8" },
  Dark: { text: "#c8a" }, Ethereal: { text: "#aaf" }, Ice: { text: "#8de" },
  Lightning: { text: "#ee6" }, Smoke: { text: "#aaa" }, Poison: { text: "#8d8" },
};

let _activeExpand = null; // { expandEl, pillEl }
let _skillTooltip = null;

function showSkillTooltip(iconEl) {
  hideSkillTooltip();
  const name = iconEl.dataset.skillName || "";
  const desc = iconEl.dataset.skillDesc || "";
  const icon = iconEl.dataset.skillIcon || "";
  if (!name) return;

  let factsHtml = "";
  try {
    const facts = JSON.parse(iconEl.dataset.skillFacts || "[]");
    const items = facts
      .filter(f => f.type !== "NoData")
      .map(f => formatFactHtml(f))
      .filter(Boolean)
      .slice(0, 12);
    if (items.length) {
      factsHtml = `<ul class="hover-preview__facts">${items.map(h => `<li>${h}</li>`).join("")}</ul>`;
    }
  } catch { /* */ }

  const tip = document.createElement("div");
  tip.className = "party-cov__skill-tooltip";
  tip.innerHTML = `
    <div class="party-cov__skill-tooltip-head">
      ${icon ? `<img src="${escapeHtml(icon)}" width="40" height="40" class="party-cov__skill-tooltip-icon" />` : ""}
      <span class="party-cov__skill-tooltip-name">${escapeHtml(name)}</span>
    </div>
    ${desc ? `<p class="party-cov__skill-tooltip-desc">${escapeHtml(desc)}</p>` : ""}
    ${factsHtml}`;
  document.body.appendChild(tip);
  _skillTooltip = tip;

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
}

function hideSkillTooltip() {
  if (_skillTooltip) { _skillTooltip.remove(); _skillTooltip = null; }
}

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
      const profIconHtml = p.profIcon || "";
      const skillIconHtml = s.skillIcon
        ? `<img src="${escapeHtml(s.skillIcon)}" width="20" height="20" alt="${escapeHtml(s.name)}"
                class="party-cov__src-skill-icon"
                data-skill-name="${escapeHtml(s.name)}"
                data-skill-desc="${escapeHtml(s.skillDescription || "")}"
                data-skill-icon="${escapeHtml(s.skillIcon)}"
                data-skill-facts="${escapeHtml(JSON.stringify(s.skillFacts || []))}" />`
        : "";
      const dur = `${s.effectiveDuration}s`;
      const stacksHtml = s.stacks > 1
        ? `<span class="party-cov__src-stacks">&times;${s.stacks}</span>` : "";
      const targetClass = s.isAlly ? "party-cov__src-target--ally" : "party-cov__src-target--self";
      const targetLabel = s.isAlly ? "ALLY" : "SELF";
      return `<div class="party-cov__src-row">
        <span class="party-cov__src-icon">${profIconHtml}</span>
        ${skillIconHtml}
        <span class="party-cov__src-name">${escapeHtml(s.name)}</span>
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
    const profIconHtml = s.profIcon || "";
    const skillIconHtml = s.skillIcon
      ? `<img src="${escapeHtml(s.skillIcon)}" width="20" height="20" alt="${escapeHtml(s.sourceName)}"
              class="party-cov__src-skill-icon"
              data-skill-name="${escapeHtml(s.sourceName)}"
              data-skill-desc="${escapeHtml(s.skillDescription || "")}"
              data-skill-icon="${escapeHtml(s.skillIcon)}"
              data-skill-facts="${escapeHtml(JSON.stringify(s.skillFacts || []))}" />`
      : "";
    const kitHtml = s.kitName ? ` <span class="party-cov__src-kit">(${escapeHtml(s.kitName)})</span>` : "";
    const durHtml = s.duration ? `<span class="party-cov__src-dur">${s.duration}s</span>` : "";
    const radiusHtml = s.radius ? `<span class="party-cov__src-radius">${s.radius} radius</span>` : "";
    return `<div class="party-cov__src-row">
      <span class="party-cov__src-icon">${profIconHtml}</span>
      ${skillIconHtml}
      <span class="party-cov__src-name">${escapeHtml(s.sourceName)}${kitHtml}</span>
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

const COMBO_FINISHER_COLORS_SPA = {
  Blast: { text: "#c8f" }, Whirl: { text: "#8dd" },
  Leap: { text: "#dd8" }, Projectile: { text: "#d88" },
};

function buildFinisherExpandHTML(finisherType, sources) {
  const colors = COMBO_FINISHER_COLORS_SPA[finisherType] || { text: "#aaa" };
  const sourceRows = sources.map(s => {
    const profIconHtml = s.profIcon || "";
    const skillIconHtml = s.skillIcon
      ? `<img src="${escapeHtml(s.skillIcon)}" width="20" height="20" alt="${escapeHtml(s.sourceName)}"
              class="party-cov__src-skill-icon"
              data-skill-name="${escapeHtml(s.sourceName)}"
              data-skill-desc="${escapeHtml(s.skillDescription || "")}"
              data-skill-icon="${escapeHtml(s.skillIcon)}"
              data-skill-facts="${escapeHtml(JSON.stringify(s.skillFacts || []))}" />`
      : "";
    const kitHtml = s.kitName ? ` <span class="party-cov__src-kit">(${escapeHtml(s.kitName)})</span>` : "";
    const countLabel = s.hitCount > 1 ? `<span class="party-cov__src-blasts">&times;${s.hitCount}</span>` : "";
    const pctHtml = s.percent < 100
      ? `<span class="party-cov__src-pct">(${s.percent}%)</span>` : "";
    return `<div class="party-cov__src-row">
      <span class="party-cov__src-icon">${profIconHtml}</span>
      ${skillIconHtml}
      <span class="party-cov__src-name">${escapeHtml(s.sourceName)}${kitHtml}</span>
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

function bindPartyCoverageEvents(container, builds) {
  // Skill icon hover tooltip (delegated)
  container.addEventListener("mouseenter", (e) => {
    if (e.target.classList?.contains("party-cov__src-skill-icon")) showSkillTooltip(e.target);
  }, true);
  container.addEventListener("mouseleave", (e) => {
    if (e.target.classList?.contains("party-cov__src-skill-icon")) hideSkillTooltip();
  }, true);

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

  // Self-boon toggle — updates pills, header icons, and expanded source rows
  container.querySelectorAll('[data-action="toggle-self-boons"]').forEach(toggle => {
    toggle.addEventListener("change", () => {
      const lineEl = toggle.closest(".party-cov__line");
      if (!lineEl) return;
      const showSelf = toggle.checked;
      // Update body pills — grey out self-only boons
      lineEl.querySelectorAll(".party-cov__pill--boon").forEach(pill => {
        const hasAlly = pill.dataset.hasAlly === "true";
        const totalCount = Number(pill.dataset.count) || 0;
        if (!totalCount) return;
        if (!showSelf && !hasAlly) {
          pill.classList.add("party-cov__pill--self-only");
        } else {
          pill.classList.remove("party-cov__pill--self-only");
        }
        // Recount providers based on toggle
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
      // Hide/show SELF source rows in any open expansion
      lineEl.querySelectorAll(".party-cov__src-target--self").forEach(badge => {
        const row = badge.closest(".party-cov__src-row");
        if (row) row.style.display = showSelf ? "" : "none";
      });
      // Update "N sources" count in expand headers
      lineEl.querySelectorAll(".party-cov__expand--open").forEach(expandEl => {
        const rows = expandEl.querySelectorAll(".party-cov__src-row");
        let visible = 0;
        rows.forEach(r => { if (r.style.display !== "none") visible++; });
        const titleEl = expandEl.querySelector(".party-cov__expand-title");
        if (titleEl) {
          titleEl.textContent = titleEl.textContent.replace(/— \d+ source(s?)/, `— ${visible} source${visible !== 1 ? "s" : ""}`);
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

      // Don't expand uncovered or self-only boon pills
      if (pillEl.classList.contains("party-cov__pill--uncovered") ||
          pillEl.classList.contains("party-cov__pill--self-only")) return;

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
      } else if (category === "finisher") {
        let sources = [];
        try { sources = JSON.parse(pillEl.dataset.sources || "[]"); } catch { /* */ }
        html = buildFinisherExpandHTML(pillEl.dataset.finisherType, sources);
      }

      expandEl.innerHTML = html;
      pillEl.classList.add("party-cov__pill--active");
      _activeExpand = { expandEl, pillEl };

      // Apply current self-toggle state to newly rendered SELF source rows + update count
      const lineEl = pillEl.closest(".party-cov__line");
      const toggleEl = lineEl?.querySelector('[data-action="toggle-self-boons"]');
      if (toggleEl && !toggleEl.checked) {
        expandEl.querySelectorAll(".party-cov__src-target--self").forEach(badge => {
          const row = badge.closest(".party-cov__src-row");
          if (row) row.style.display = "none";
        });
        const rows = expandEl.querySelectorAll(".party-cov__src-row");
        let visible = 0;
        rows.forEach(r => { if (r.style.display !== "none") visible++; });
        const titleEl = expandEl.querySelector(".party-cov__expand-title");
        if (titleEl) {
          titleEl.textContent = titleEl.textContent.replace(/— \d+ source(s?)/, `— ${visible} source${visible !== 1 ? "s" : ""}`);
        }
      }

      requestAnimationFrame(() => expandEl.classList.add("party-cov__expand--open"));
    });
  });
}

// ── Main Entry ───────────────────────────────────────────────────────────

function bindCompTabs(app) {
  const tabs = [...app.querySelectorAll("[data-comp-tab]")];
  const panels = [...app.querySelectorAll("[data-comp-panel]")];
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.toggle("site-tab--active", t === tab));
      panels.forEach((p) => {
        p.classList.toggle("site-tab-content--active", p.dataset.compPanel === tab.dataset.compTab);
      });
    });
  });
}

export function renderCompPage(app, comp) {
  const name = escapeHtml(comp.name || "Untitled Comp");
  const gameMode = comp.gameMode || "";
  const hasNotes = Boolean(comp.notes?.trim());

  app.innerHTML = `
    <div class="comp-detail">
      <div class="comp-detail__topbar">
        <span class="comp-detail__name">${name}</span>
        <span class="comp-detail__spacer"></span>
        ${gameMode ? `<span class="comp-detail__slot-counter">${escapeHtml(gameMode.toUpperCase())}</span>` : ""}
      </div>
      ${renderTagsRow(comp)}
      ${hasNotes ? `
      <div class="site-tabs">
        <button type="button" class="site-tab site-tab--active" data-comp-tab="comp">COMP</button>
        <button type="button" class="site-tab" data-comp-tab="notes">NOTES</button>
      </div>` : ""}
      <div class="site-tab-content site-tab-content--active" data-comp-panel="comp">
        <div class="comp-detail__body">
          <div class="comp-detail__party-panel">
            ${renderPartyLines(comp)}
            ${renderPartyCoverage(comp)}
          </div>
          <div class="comp-detail__pool-panel">
            ${renderBuildPool(comp)}
          </div>
        </div>
      </div>
      ${hasNotes ? '<div class="site-tab-content comp-detail__notes-tab" data-comp-panel="notes"></div>' : ""}
    </div>`;

  if (hasNotes) {
    app.querySelector('[data-comp-panel="notes"]').append(renderNotes(comp));
    bindCompTabs(app);
  }

  // Bind tag-slot hover popovers (lists the builds the tag stands for)
  buildTagHoverData(comp);
  app.querySelectorAll(".comp-slot--tag").forEach((slot) => {
    slot.removeAttribute("title"); // suppress the native tooltip in favor of the rich popover
    slot.addEventListener("mouseenter", () => showTagHover(slot));
    slot.addEventListener("mouseleave", hideTagHover);
  });

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
