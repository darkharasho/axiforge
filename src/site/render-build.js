import { escapeHtml } from "./main.js";
import { renderSpecializations } from "./render-specs.js";
import { renderSkills } from "./render-skills.js";
import { renderEquipment } from "./render-equipment.js";
import { initReferencePanel, updateReferencePanel } from "./render-reference.js";

/**
 * Orchestrates the full build page layout with header, tabs, and content.
 *
 * @param {HTMLElement} container - The top-level app container to render into.
 * @param {object} build - Enriched build object from serializeForPublish.
 */
export function renderBuildPage(container, build) {
  container.innerHTML = "";

  // ── Build header ─────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "build-header";

  if (build.professionIcon) {
    const iconWrapper = document.createElement("div");
    iconWrapper.className = "build-header__icon";
    iconWrapper.innerHTML = build.professionIcon;
    header.append(iconWrapper);
  }

  const info = document.createElement("div");
  info.className = "build-header__info";

  const title = document.createElement("h1");
  title.textContent = build.title || "Untitled Build";
  info.append(title);

  const meta = document.createElement("p");
  meta.className = "build-header__meta";
  const profText = escapeHtml(build.profession || "");
  const modeText = escapeHtml((build.gameMode || "pve").toUpperCase());
  meta.innerHTML = `${profText} &middot; ${modeText}`;
  info.append(meta);

  const tags = Array.isArray(build.tags) ? build.tags : [];
  if (tags.length > 0) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "build-header__tags";
    for (const tag of tags) {
      const tagEl = document.createElement("span");
      tagEl.className = "build-header__tag";
      tagEl.textContent = tag;
      tagsEl.append(tagEl);
    }
    info.append(tagsEl);
  }

  header.append(info);
  container.append(header);

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const tabBar = document.createElement("div");
  tabBar.className = "site-tabs";

  const buildTab = document.createElement("button");
  buildTab.type = "button";
  buildTab.className = "site-tab site-tab--active";
  buildTab.textContent = "BUILD";

  const equipTab = document.createElement("button");
  equipTab.type = "button";
  equipTab.className = "site-tab";
  equipTab.textContent = "EQUIPMENT";

  tabBar.append(buildTab, equipTab);
  container.append(tabBar);

  // ── Tab content panels ────────────────────────────────────────────────────

  // BUILD tab content
  const buildContent = document.createElement("div");
  buildContent.className = "site-tab-content site-tab-content--active";

  // Skills bar — full width, above specs-with-detail
  const skillsHeading = document.createElement("h2");
  skillsHeading.className = "site-section-heading";
  skillsHeading.textContent = "Skills";
  buildContent.append(skillsHeading);

  const skillsContainer = document.createElement("div");
  renderSkills(skillsContainer, build);
  buildContent.append(skillsContainer);

  // Side-by-side layout: specs panel + reference panel
  const specsWithDetail = document.createElement("div");
  specsWithDetail.className = "specs-with-detail";

  const specsPanel = document.createElement("div");
  specsPanel.className = "specs-panel";

  const specsHeading = document.createElement("h2");
  specsHeading.className = "site-section-heading";
  specsHeading.textContent = "Specializations";
  specsPanel.append(specsHeading);

  const specsContainer = document.createElement("div");
  renderSpecializations(specsContainer, build.specializations || []);
  specsPanel.append(specsContainer);

  const detailPanel = document.createElement("div");
  detailPanel.className = "detail-panel";
  initReferencePanel(detailPanel);

  specsWithDetail.append(specsPanel, detailPanel);
  buildContent.append(specsWithDetail);

  // Notes — shown at the bottom of the BUILD tab
  if (build.notes) {
    const notesHeading = document.createElement("h2");
    notesHeading.className = "site-section-heading";
    notesHeading.textContent = "Notes";
    buildContent.append(notesHeading);

    const notesEl = document.createElement("div");
    notesEl.className = "site-notes";
    notesEl.textContent = build.notes;
    buildContent.append(notesEl);
  }

  // Wire hover on the BUILD tab to update the reference panel
  buildContent.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-name][data-icon]");
    if (!target) return;
    let facts = [];
    try { facts = JSON.parse(target.dataset.facts || "[]"); } catch { /* ignore */ }
    updateReferencePanel({
      name: target.dataset.name || "",
      icon: target.dataset.icon || "",
      description: target.dataset.desc || "",
      meta: target.dataset.meta || "",
      facts,
    });
  });

  // EQUIPMENT tab content
  const equipContent = document.createElement("div");
  equipContent.className = "site-tab-content";

  const equipContainer = document.createElement("div");
  renderEquipment(equipContainer, build);
  equipContent.append(equipContainer);

  container.append(buildContent, equipContent);

  // ── Tab switching logic ───────────────────────────────────────────────────
  buildTab.addEventListener("click", () => {
    buildTab.classList.add("site-tab--active");
    equipTab.classList.remove("site-tab--active");
    buildContent.classList.add("site-tab-content--active");
    equipContent.classList.remove("site-tab-content--active");
  });

  equipTab.addEventListener("click", () => {
    equipTab.classList.add("site-tab--active");
    buildTab.classList.remove("site-tab--active");
    equipContent.classList.add("site-tab-content--active");
    buildContent.classList.remove("site-tab-content--active");
  });
}
