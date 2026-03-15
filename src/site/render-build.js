import { state } from "@renderer/modules/state.js";
import { initSkills, renderSkills } from "@renderer/modules/skills.js";
import { initSpecializations, renderSpecializations } from "@renderer/modules/specializations.js";
import { initEquipment, renderEquipmentPanel } from "@renderer/modules/equipment.js";
import { initDetailPanel, bindHoverPreview } from "@renderer/modules/detail-panel.js";
import { initReferencePanel, updateReferencePanel } from "./render-reference.js";

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Collects every skill object from a serialized build so we can build
 * the activeCatalog skill maps.
 */
function collectAllSkills(build) {
  const skills = [];
  for (const source of [build.landSkills, build.waterSkills]) {
    if (!source) continue;
    const ws = source.weaponSkills || {};
    for (const set of [ws.set1, ws.set2, ws.aquatic1, ws.aquatic2]) {
      if (Array.isArray(set)) skills.push(...set);
    }
    if (Array.isArray(source.professionMechanics)) skills.push(...source.professionMechanics);
    const sk = source.skills || {};
    if (sk.heal) skills.push(sk.heal);
    if (Array.isArray(sk.utility)) skills.push(...sk.utility.filter(Boolean));
    if (sk.elite) skills.push(sk.elite);
    if (source.attunementSkills) {
      for (const att of Object.values(source.attunementSkills)) {
        if (Array.isArray(att.set1)) skills.push(...att.set1);
        if (Array.isArray(att.set2)) skills.push(...att.set2);
        if (Array.isArray(att.professionMechanics)) skills.push(...att.professionMechanics);
      }
    }
  }
  for (const legend of (build.legendDisplay || [])) {
    if (legend.swap) skills.push(legend.swap);
  }
  return skills.filter(s => s && s.id);
}

/**
 * Maps the flat serialized build onto state.editor, state.activeCatalog,
 * and state.upgradeCatalog so the shared renderer modules can read from them.
 */
function populateStateFromBuild(build) {
  // ── state.editor ──
  state.editor.profession              = build.profession;
  state.editor.gameMode                = build.gameMode || "pve";
  state.editor.equipment               = build.equipment;
  state.editor.specializations         = build.specializations;
  state.editor.skills                  = build.landSkills?.skills || {};
  state.editor.weaponSkills            = build.landSkills?.weaponSkills || {};
  state.editor.professionMechanics     = build.landSkills?.professionMechanics || [];
  state.editor.attunements             = build.landSkills?.attunementSkills || null;
  state.editor.activeAttunement        = build.activeAttunement || "Fire";
  state.editor.underwaterSkills        = build.waterSkills || null;
  state.editor.underwaterMode          = false;
  state.editor.activeWeaponSet         = 1;
  state.editor.activeKit               = 0;
  state.editor.morphSkillIds           = build.morphSkillIds || [0, 0, 0];
  state.editor.selectedLegends         = build.selectedLegends || [];
  state.editor.selectedUnderwaterLegends = build.selectedUnderwaterLegends || [];
  state.editor.activeLegendSlot        = build.activeLegendSlot || 0;
  state.editor.selectedPets            = build.selectedPets || {};
  state.editor.notes                   = build.notes || "";
  state.renderedSkillIconIds           = new Map();
  state.openCustomSelect               = null;

  // ── state.activeCatalog ──
  const allSkills = collectAllSkills(build);
  const allTraits = (build.specializations || []).flatMap(s =>
    [...(s.minorTraits || []), ...(s.majorTraitsByTier || []).flat()]
  ).filter(t => t && t.id);

  state.activeCatalog = {
    profession:         { id: build.profession },
    skills:             allSkills,
    skillById:          new Map(allSkills.map(s => [s.id, s])),
    weaponSkillById:    new Map(allSkills.filter(s => s.slot?.startsWith("Weapon_")).map(s => [s.id, s])),
    specializations:    build.specializations || [],
    specializationById: new Map((build.specializations || []).map(s => [s.id, s])),
    traits:             allTraits,
    traitById:          new Map(allTraits.map(t => [t.id, t])),
    legends:            (build.legendDisplay || []).map(l => ({
      id: l.id, name: l.name, icon: l.icon, swap: l.swap?.id || null,
    })),
    legendById:         new Map((build.legendDisplay || []).map(l => [l.id, {
      id: l.id, name: l.name, icon: l.icon, swap: l.swap?.id || null,
    }])),
    pets:               (build.petDisplay || []).map(p => ({ id: p.id, name: p.name, icon: p.icon })),
    petById:            new Map((build.petDisplay || []).map(p => [p.id, p])),
    professionWeapons:  build.professionWeapons || {},
  };

  // ── state.upgradeCatalog ──
  const eqd = build.equipmentDisplay || {};
  const runeEntries = Object.values(eqd.runes || {}).filter(Boolean);
  const sigilEntries = Object.values(eqd.sigils || {}).flat().filter(Boolean);
  const infusionEntries = Object.values(eqd.infusions || {}).flat().filter(Boolean);

  state.upgradeCatalog = {
    runeById:       new Map(runeEntries.map(r => [r.id, r])),
    sigilById:      new Map(sigilEntries.map(s => [s.id, s])),
    infusionById:   new Map(infusionEntries.map(i => [i.id, i])),
    enrichmentById: new Map(eqd.enrichment ? [[eqd.enrichment.id, eqd.enrichment]] : []),
    foodById:       new Map(eqd.food ? [[eqd.food.id, eqd.food]] : []),
    utilityById:    new Map(eqd.utility ? [[eqd.utility.id, eqd.utility]] : []),
  };
}

/**
 * Orchestrates the full build page layout with header, tabs, and content.
 *
 * @param {HTMLElement} container - The top-level app container to render into.
 * @param {object} build - Enriched build object from serializeForPublish.
 */
export function renderBuildPage(container, build) {
  container.innerHTML = "";

  // Populate shared state so renderer modules can read from it
  populateStateFromBuild(build);

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

  // ── Tab content panels ──────────────────────────────────────────────────

  // BUILD tab content
  const buildContent = document.createElement("div");
  buildContent.className = "site-tab-content site-tab-content--active";

  // Skills bar
  const skillsSection = document.createElement("section");
  skillsSection.className = "panel panel--skillbar";
  const skillsHost = document.createElement("div");
  skillsHost.className = "skills-host";
  skillsSection.append(skillsHost);
  buildContent.append(skillsSection);

  initSkills({ skillsHost });
  renderSkills();

  // Side-by-side layout: specs panel + detail/reference panel
  const specsWithDetail = document.createElement("div");
  specsWithDetail.className = "specs-with-detail";

  // Specs panel
  const specsPanel = document.createElement("section");
  specsPanel.className = "panel specs-panel";

  const specsSectionHead = document.createElement("div");
  specsSectionHead.className = "section-head";
  const specsHeading = document.createElement("h2");
  specsHeading.textContent = "Specializations";
  specsSectionHead.append(specsHeading);
  specsPanel.append(specsSectionHead);

  const specializationsHost = document.createElement("div");
  specializationsHost.className = "specializations-host";
  specsPanel.append(specializationsHost);

  initSpecializations({ specializationsHost });
  renderSpecializations();

  // Detail / reference panel
  const detailPanel = document.createElement("section");
  detailPanel.className = "panel detail-panel";

  const detailSectionHead = document.createElement("div");
  detailSectionHead.className = "section-head";
  const detailHeading = document.createElement("h2");
  detailHeading.textContent = "Reference Panel";
  detailSectionHead.append(detailHeading);
  detailPanel.append(detailSectionHead);

  const detailHost = document.createElement("div");
  detailHost.id = "detailHost";
  detailPanel.append(detailHost);

  const hoverPreview = document.createElement("div");
  hoverPreview.className = "hover-preview";
  detailPanel.append(hoverPreview);

  initDetailPanel({ detailHost, hoverPreview, expandBtn: document.createElement("button") });
  initReferencePanel(detailPanel);

  specsWithDetail.append(specsPanel, detailPanel);
  buildContent.append(specsWithDetail);

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

  // Notes section
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

  // EQUIPMENT tab content
  const equipContent = document.createElement("div");
  equipContent.className = "site-tab-content";

  const equipmentPanel = document.createElement("div");
  equipContent.append(equipmentPanel);

  initEquipment({ equipmentPanel });
  renderEquipmentPanel();

  container.append(buildContent, equipContent);

  // ── Tab switching logic ─────────────────────────────────────────────────
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
