import { formatFactHtml, resolveEntityFacts } from "./detail-panel.js";
import { getProfessionSvg } from "./profession-icons.js";
import { escapeHtml } from "./utils.js";

// Module-level singleton — one modal for the app lifetime
let _overlay = null;
let _el = {};
let _escHandler = null;

// Navigation history: array of {detail, catalog, professionName}
let _history = [];
let _historyIndex = -1;
// Incremented each time content loads; guards stale async callbacks
let _renderId = 0;

export function initDetailModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "detail-modal-overlay detail-modal-overlay--hidden";
  _overlay.innerHTML = `
    <div class="detail-modal">
      <div class="detail-modal-toolbar">
        <button class="wiki-modal-btn dm-nav-btn" id="dm-back" title="Back" disabled><svg viewBox="0 0 7 12" width="7" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6,1 1,6 6,11"/></svg></button>
        <button class="wiki-modal-btn dm-nav-btn" id="dm-fwd" title="Forward" disabled><svg viewBox="0 0 7 12" width="7" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,1 6,6 1,11"/></svg></button>
        <nav class="dm-breadcrumbs" id="dm-breadcrumbs" aria-label="Navigation history"></nav>
        <button class="wiki-modal-btn" id="dm-wiki-btn">Open Wiki Page</button>
        <button class="wiki-modal-btn wiki-modal-btn--close" id="dm-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg></button>
      </div>
      <div class="detail-modal-body" id="dm-body">
        <div class="dm-hero">
          <img class="dm-hero__icon" id="dm-icon" src="" alt="" />
          <div class="dm-hero__prof-icon" id="dm-prof-icon"></div>
          <div class="dm-hero__text">
            <h2 class="dm-hero__name" id="dm-name"></h2>
            <p class="dm-hero__meta" id="dm-meta"></p>
            <p class="dm-hero__desc" id="dm-desc"></p>
          </div>
        </div>
        <section class="dm-section" id="dm-facts-section">
          <h3 class="dm-section__heading">Facts</h3>
          <ul class="dm-facts-grid" id="dm-facts"></ul>
        </section>
        <section class="dm-section dm-section--loading" id="dm-related-skills-section">
          <h3 class="dm-section__heading">Related Skills</h3>
          <div class="dm-spinner" id="dm-skills-spinner"></div>
          <ul class="dm-related-grid dm-related-grid--hidden" id="dm-related-skills"></ul>
        </section>
        <section class="dm-section dm-section--loading" id="dm-related-traits-section">
          <h3 class="dm-section__heading">Related Traits</h3>
          <div class="dm-spinner" id="dm-traits-spinner"></div>
          <div class="dm-related-grid--hidden" id="dm-related-traits"></div>
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _el = {
    breadcrumbs:    document.getElementById("dm-breadcrumbs"),
    wikiBtn:        document.getElementById("dm-wiki-btn"),
    close:          document.getElementById("dm-close"),
    backBtn:        document.getElementById("dm-back"),
    fwdBtn:         document.getElementById("dm-fwd"),
    body:           document.getElementById("dm-body"),
    icon:           document.getElementById("dm-icon"),
    profIcon:       document.getElementById("dm-prof-icon"),
    name:           document.getElementById("dm-name"),
    meta:           document.getElementById("dm-meta"),
    desc:           document.getElementById("dm-desc"),
    facts:          document.getElementById("dm-facts"),
    skillsSection:  document.getElementById("dm-related-skills-section"),
    traitsSection:  document.getElementById("dm-related-traits-section"),
    skillsSpinner:  document.getElementById("dm-skills-spinner"),
    traitsSpinner:  document.getElementById("dm-traits-spinner"),
    skillsList:     document.getElementById("dm-related-skills"),
    traitsList:     document.getElementById("dm-related-traits"),
  };

  _el.close.addEventListener("click", closeDetailModal);

  _el.wikiBtn.addEventListener("click", () => {
    const url = _el.wikiBtn.dataset.url;
    if (url) window.open(url, "_blank");
  });

  _el.backBtn.addEventListener("click", () => {
    if (_historyIndex > 0) {
      _historyIndex--;
      const { detail, catalog, professionName } = _history[_historyIndex];
      _el.body.scrollTop = 0;
      _loadModalContent(detail, catalog, professionName);
      _updateNav();
    }
  });

  _el.fwdBtn.addEventListener("click", () => {
    if (_historyIndex < _history.length - 1) {
      _historyIndex++;
      const { detail, catalog, professionName } = _history[_historyIndex];
      _el.body.scrollTop = 0;
      _loadModalContent(detail, catalog, professionName);
      _updateNav();
    }
  });

  // Breadcrumb navigation — click a past crumb to jump back
  _el.breadcrumbs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-crumb-idx]");
    if (!btn) return;
    const idx = Number(btn.dataset.crumbIdx);
    if (idx >= 0 && idx < _historyIndex) {
      _historyIndex = idx;
      const { detail, catalog, professionName } = _history[_historyIndex];
      _el.body.scrollTop = 0;
      _loadModalContent(detail, catalog, professionName);
      _updateNav();
    }
  });

  // Click delegate for related item navigation
  _el.body.addEventListener("click", (e) => {
    const li = e.target.closest("[data-nav-name]");
    if (!li) return;
    const name = li.dataset.navName;
    const iconUrl = li.dataset.navIcon || "";
    const { catalog, professionName } = _history[_historyIndex] || {};
    if (!catalog || !name) return;
    _navigateToName(name, iconUrl, catalog, professionName);
  });
}

export function openDetailModal(detail, catalog, professionName) {
  if (!_overlay || !detail) return;

  // Reset history for a fresh open from the reference panel
  _history = [{ detail, catalog, professionName }];
  _historyIndex = 0;

  // Show modal
  _overlay.classList.remove("detail-modal-overlay--hidden");
  _el.body.scrollTop = 0;
  _escHandler = (e) => { if (e.key === "Escape") closeDetailModal(); };
  document.addEventListener("keydown", _escHandler);

  _loadModalContent(detail, catalog, professionName);
  _updateNav();
}

export function closeDetailModal() {
  if (!_overlay) return;
  _renderId++; // cancel in-flight async callbacks
  _history = [];
  _historyIndex = -1;
  _overlay.classList.add("detail-modal-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

function _navigateToName(name, iconUrl, catalog, professionName) {
  const found = _findEntityByName(name, catalog);
  let detail;
  if (found) {
    detail = _buildModalDetail(found.kind, found.entity);
  } else {
    // Minimal placeholder for items not in the current catalog
    detail = {
      kind: "skill",
      entityId: null,
      kindLabel: "Skill",
      title: name,
      icon: iconUrl || "",
      iconFallback: "",
      description: "",
      facts: [],
      wiki: { loading: false, summary: "", url: "" },
      hasSplit: false,
    };
  }
  // Truncate forward history, push new entry
  _history = _history.slice(0, _historyIndex + 1);
  _history.push({ detail, catalog, professionName });
  _historyIndex++;
  _el.body.scrollTop = 0;
  _loadModalContent(detail, catalog, professionName);
  _updateNav();
}

function _findEntityByName(name, catalog) {
  if (!name || !catalog) return null;
  // Non-weapon skills
  if (Array.isArray(catalog.skills)) {
    const s = catalog.skills.find((e) => e.name === name);
    if (s) return { entity: s, kind: "skill" };
  }
  // Weapon skills (not included in catalog.skills array)
  if (catalog.weaponSkillById instanceof Map) {
    for (const s of catalog.weaponSkillById.values()) {
      if (s.name === name) return { entity: s, kind: "skill" };
    }
  }
  // Traits
  if (Array.isArray(catalog.traits)) {
    const t = catalog.traits.find((e) => e.name === name);
    if (t) return { entity: t, kind: "trait" };
  }
  return null;
}

function _buildModalDetail(kind, entity) {
  return {
    kind,
    entityId: Number(entity.id) || null,
    kindLabel: kind === "trait" ? "Trait" : "Skill",
    title: entity.name || "Unknown",
    icon: entity.icon || "",
    iconFallback: entity.iconFallback || "",
    description: entity.description || "",
    facts: resolveEntityFacts(entity),
    wiki: { loading: false, summary: "", url: "" },
    hasSplit: Boolean(entity.hasSplit),
  };
}

function _loadModalContent(detail, catalog, professionName) {
  const myId = ++_renderId;

  // ── Hero ──────────────────────────────────────────────────────────────────
  _el.name.textContent = detail.title;
  _el.desc.textContent = detail.description || "";

  const specializations = catalog?.specializations || [];
  const spec = specializations.find((s) => s.id === detail.entityId);
  const specName = spec?.name || professionName || "";
  const kindLabel = detail.kindLabel || detail.kind || "";
  _el.meta.textContent = specName ? `${specName} · ${kindLabel}` : kindLabel;

  // Icon
  if (detail.icon) {
    _el.icon.style.visibility = "";
    _el.icon.src = detail.icon;
    _el.icon.alt = detail.title;
    _el.icon.onerror = () => {
      _el.icon.onerror = null;
      if (detail.iconFallback) _el.icon.src = detail.iconFallback;
      else _el.icon.style.visibility = "hidden";
    };
  } else {
    _el.icon.style.visibility = "hidden";
  }

  // Profession SVG
  const svg = getProfessionSvg(specName) ?? getProfessionSvg(professionName) ?? "";
  _el.profIcon.innerHTML = svg;

  // Wiki button — always show; fallback URL until a real URL is known
  const wikiUrl = detail.wiki?.url
    || `https://wiki.guildwars2.com/wiki/${encodeURIComponent((detail.title || "").replaceAll(" ", "_"))}`;
  _el.wikiBtn.dataset.url = wikiUrl;
  _el.wikiBtn.style.display = "";

  // ── Facts ─────────────────────────────────────────────────────────────────
  const facts = Array.isArray(detail.facts) ? detail.facts : [];
  _el.facts.innerHTML = facts
    .map((fact) => `<li>${formatFactHtml(fact, null)}</li>`)
    .join("") || "<li>No facts.</li>";

  // ── Related sections — show spinners, hide lists ───────────────────────────
  _el.skillsSection.className = "dm-section dm-section--loading";
  _el.traitsSection.className = "dm-section dm-section--loading";
  _el.skillsList.className = "dm-related-grid dm-related-grid--hidden";
  _el.skillsList.innerHTML = "";
  _el.traitsList.className = "dm-related-grid--hidden";
  _el.traitsList.innerHTML = "";

  // ── Async: fetch related data ─────────────────────────────────────────────
  window.desktopApi?.getWikiRelatedData(detail.title).then((related) => {
    if (_renderId !== myId) return;
    _renderRelatedSkills(related.relatedSkills, catalog);
    _renderRelatedTraits(related.relatedTraits, catalog);
  }).catch(() => {
    if (_renderId !== myId) return;
    _showRelatedError(_el.skillsSection, _el.skillsSpinner, _el.skillsList);
    _showRelatedError(_el.traitsSection, _el.traitsSpinner, _el.traitsList);
  });
}

function _updateNav() {
  _el.backBtn.disabled = _historyIndex <= 0;
  _el.fwdBtn.disabled = _historyIndex >= _history.length - 1;

  // Breadcrumbs — show history trail; past items are clickable, current is plain
  const parts = _history.slice(0, _historyIndex + 1).map((entry, i) => {
    const name = escapeHtml(entry.detail.title);
    return i < _historyIndex
      ? `<button class="dm-crumb dm-crumb--link" data-crumb-idx="${i}">${name}</button>`
      : `<span class="dm-crumb dm-crumb--current">${name}</span>`;
  });
  _el.breadcrumbs.innerHTML = parts.join('<span class="dm-crumb-sep" aria-hidden="true">›</span>');
}

function _showRelatedError(section, spinner, list) {
  section.className = "dm-section";
  spinner.style.display = "none";
  list.innerHTML = '<p class="dm-related-error">Could not load related data.</p>';
  list.className = list.className.replace("dm-related-grid--hidden", "dm-related-grid");
}

function _renderRelatedSkills(items, catalog) {
  if (!items || items.length === 0) {
    _el.skillsSection.className = "dm-section dm-section--hidden";
    return;
  }
  const skillMap = _buildNameMap(catalog?.skills);
  _el.skillsList.innerHTML = items.map((item) => {
    const icon = item.icon || skillMap.get(item.name)?.icon || "";
    return _relatedItemHtml(item.name, item.context, icon);
  }).join("");
  _el.skillsSection.className = "dm-section";
  _el.skillsSpinner.style.display = "none";
  _el.skillsList.className = "dm-related-grid";
}

function _renderRelatedTraits(groups, catalog) {
  if (!groups || groups.length === 0) {
    _el.traitsSection.className = "dm-section dm-section--hidden";
    return;
  }
  const traitMap = _buildNameMap(catalog?.traits);
  const specMap = new Map((catalog?.specializations || []).map((s) => [s.name, s]));

  _el.traitsList.innerHTML = groups.map((group) => {
    const spec = specMap.get(group.groupName);
    const specIconHtml = spec?.icon
      ? `<img class="dm-trait-group__spec-icon" src="${escapeHtml(spec.icon)}" alt="${escapeHtml(group.groupName)}" />`
      : "";
    const itemsHtml = group.items.map((item) => {
      const icon = item.icon || traitMap.get(item.name)?.icon || "";
      return _relatedItemHtml(item.name, item.desc || item.context || "", icon);
    }).join("");
    return `
      <div class="dm-trait-group">
        <div class="dm-trait-group__header">
          ${specIconHtml}
          <span class="dm-trait-group__name">${escapeHtml(group.groupName)}</span>
        </div>
        <ul class="dm-related-grid dm-related-grid--indented">${itemsHtml}</ul>
      </div>`;
  }).join("");

  _el.traitsSection.className = "dm-section";
  _el.traitsSpinner.style.display = "none";
  _el.traitsList.className = "";
}

function _buildNameMap(arr) {
  const map = new Map();
  if (!Array.isArray(arr)) return map;
  for (const item of arr) {
    if (item.name) map.set(item.name, item);
  }
  return map;
}

function _relatedItemHtml(name, context, iconUrl) {
  const iconEl = iconUrl
    ? `<img class="dm-related-item__icon" src="${escapeHtml(iconUrl)}" alt="${escapeHtml(name)}" onerror="this.style.visibility='hidden'" />`
    : `<div class="dm-related-item__icon dm-related-item__icon--missing"></div>`;
  return `
    <li class="dm-related-item" data-nav-name="${escapeHtml(name)}" data-nav-icon="${escapeHtml(iconUrl)}">
      ${iconEl}
      <span class="dm-related-item__name">${escapeHtml(name)}</span>
      ${context ? `<span class="dm-related-item__context">${escapeHtml(context)}</span>` : ""}
    </li>`;
}
