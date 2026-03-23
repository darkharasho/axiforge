import { state } from "@renderer/modules/state.js";
import { initSkills, renderSkills } from "@renderer/modules/skills.js";
import { initSpecializations, renderSpecializations } from "@renderer/modules/specializations.js";
import { initEquipment, initEquipmentCallbacks, renderEquipmentPanel } from "@renderer/modules/equipment.js";
import { initDetailPanel, bindHoverPreview, setOnHoverPreview } from "@renderer/modules/detail-panel.js";
import { initReferencePanel, updateReferencePanel } from "./render-reference.js";
import { renderNotes } from "./render-notes.js";
import { initMobileDetection, initSkillBarMobile, initSpecAccordion, initEquipmentSubTabs, isMobile, openBottomSheet } from "./mobile.js";

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Normalize skill selection from build store format { heal: {obj}, utility: [{obj}], elite: {obj} }
 * to editor format { healId: number, utilityIds: [number], eliteId: number }.
 * Also handles the editor format passthrough if already in { healId, utilityIds, eliteId }.
 */
function normalizeSkillSelection(sel) {
  if (!sel) return { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 };
  // Already in editor format
  if ("healId" in sel) return sel;
  // Build store format — extract IDs
  return {
    healId: sel.heal?.id || 0,
    utilityIds: Array.isArray(sel.utility)
      ? sel.utility.map(s => s?.id || 0)
      : [0, 0, 0],
    eliteId: sel.elite?.id || 0,
  };
}

/**
 * Collect skill objects from a build store skill selection { heal, utility, elite }.
 */
function collectSkillsFromSelection(sel) {
  if (!sel) return [];
  const skills = [];
  if (sel.heal && typeof sel.heal === "object") skills.push(sel.heal);
  if (Array.isArray(sel.utility)) skills.push(...sel.utility.filter(Boolean));
  if (sel.elite && typeof sel.elite === "object") skills.push(sel.elite);
  return skills;
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
    if (Array.isArray(source.resolvedSkills)) skills.push(...source.resolvedSkills);
    if (source.attunementSkills) {
      for (const att of Object.values(source.attunementSkills)) {
        if (Array.isArray(att.set1)) skills.push(...att.set1);
        if (Array.isArray(att.set2)) skills.push(...att.set2);
        if (Array.isArray(att.professionMechanics)) skills.push(...att.professionMechanics);
      }
    }
  }
  // Collect heal/utility/elite skill objects from build store format
  skills.push(...collectSkillsFromSelection(build.skills));
  skills.push(...collectSkillsFromSelection(build.underwaterSkills));
  // Legend swap skills (Revenant)
  for (const legend of (build.legendDisplay || [])) {
    if (legend.swap) skills.push(legend.swap);
  }
  // Full profession catalog — includes bundle skills, flip chains, toolbelt skills, etc.
  if (Array.isArray(build.catalogSkills)) skills.push(...build.catalogSkills);
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
  // The renderer reads specializationId but the build store uses id.
  // Normalize so both fields are present.
  state.editor.specializations         = (build.specializations || []).map(s => ({
    ...s,
    specializationId: s.specializationId || s.id || 0,
  }));
  // The build store saves skills as { heal: {obj}, utility: [{obj}], elite: {obj} }
  // but the renderer expects { healId: number, utilityIds: [number], eliteId: number }.
  // Convert to the editor format.
  state.editor.skills                  = normalizeSkillSelection(build.skills);
  state.editor.underwaterSkills        = normalizeSkillSelection(build.underwaterSkills);
  state.editor.activeAttunement        = build.activeAttunement || "Fire";
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
  // Use full catalog traits if available (includes facts/traitedFacts), fall back to spec-embedded traits
  const allTraits = Array.isArray(build.catalogTraits) && build.catalogTraits.length
    ? build.catalogTraits
    : (build.specializations || []).flatMap(s => {
        const minors = Array.isArray(s.minorTraits) ? s.minorTraits : [];
        const majors = s.majorTraitsByTier
          ? Object.values(s.majorTraitsByTier).flat()
          : [];
        return [...minors, ...majors];
      }).filter(t => t && t.id);

  state.activeCatalog = {
    profession:         { id: build.profession },
    skills:             allSkills,
    skillById:          new Map(allSkills.map(s => [s.id, s])),
    // Weapon skills are a separate catalog from profession skills
    weaponSkills:       build.catalogWeaponSkills || [],
    weaponSkillById:    new Map((build.catalogWeaponSkills || []).map(s => [s.id, s])),
    // Enrich spec objects with majorTraits (flat ID array) derived from majorTraitsByTier.
    // The renderer's getMajorTraitsByTier reads spec.majorTraits and looks up each via traitById.
    specializations:    (build.specializations || []).map(s => ({
      ...s,
      majorTraits: s.majorTraits || (s.majorTraitsByTier
        ? Object.values(s.majorTraitsByTier).flat().map(t => typeof t === "object" ? t.id : t)
        : []),
    })),
    specializationById: new Map((build.specializations || []).map(s => [s.id, {
      ...s,
      majorTraits: s.majorTraits || (s.majorTraitsByTier
        ? Object.values(s.majorTraitsByTier).flat().map(t => typeof t === "object" ? t.id : t)
        : []),
    }])),
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

  // Update browser tab title with the build name
  document.title = build.title ? `AxiForge Builds - ${build.title}` : "AxiForge Builds";

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

  // ── Build code widget (inline in header, right-aligned) ────────────────
  if (build.chatLink) {
    const codeGroup = document.createElement("div");
    codeGroup.className = "build-code-group build-code-group--header";

    const codeInput = document.createElement("input");
    codeInput.type = "text";
    codeInput.readOnly = true;
    codeInput.className = "build-code-group__input";
    codeInput.value = build.chatLink;
    codeInput.addEventListener("click", () => codeInput.select());

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "build-code-group__btn";
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
    let copyTimeout = null;
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(build.chatLink);
        copyBtn.classList.add("build-code-group__btn--copied");
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg> Copied!`;
      } catch {
        copyBtn.textContent = "Failed";
      }
      clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copyBtn.classList.remove("build-code-group__btn--copied");
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
      }, 2000);
    });

    codeGroup.append(codeInput, copyBtn);
    header.append(codeGroup);
  }

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

  const hasNotes = Boolean(build.notes);
  let notesTab = null;
  if (hasNotes) {
    notesTab = document.createElement("button");
    notesTab.type = "button";
    notesTab.className = "site-tab";
    notesTab.textContent = "NOTES";
    tabBar.append(notesTab);
  }
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

  // Hover preview must be at document.body level for absolute positioning over all content
  let hoverPreview = document.getElementById("hoverPreview");
  if (!hoverPreview) {
    hoverPreview = document.createElement("div");
    hoverPreview.id = "hoverPreview";
    hoverPreview.className = "hover-preview hidden";
    document.body.append(hoverPreview);
  }

  initDetailPanel({ detailHost, hoverPreview, expandBtn: document.createElement("button") });
  initReferencePanel(detailPanel);

  specsWithDetail.append(specsPanel, detailPanel);
  buildContent.append(specsWithDetail);

  // Track last hovered entity so clicking selects it into the reference panel.
  let lastHoveredKind = null;
  let lastHoveredEntity = null;

  setOnHoverPreview((kind, entity) => {
    lastHoveredKind = kind;
    lastHoveredEntity = entity;
  });

  // Click on a skill/trait to pin it in the reference panel (or open bottom sheet on mobile).
  buildContent.addEventListener("click", () => {
    if (lastHoveredEntity) {
      if (isMobile()) {
        openBottomSheet(lastHoveredKind, lastHoveredEntity);
      } else {
        updateReferencePanel(lastHoveredKind, lastHoveredEntity);
      }
    }
  });

  // EQUIPMENT tab content
  const equipContent = document.createElement("div");
  equipContent.className = "site-tab-content";

  const equipmentPanel = document.createElement("div");
  equipContent.append(equipmentPanel);

  let notesContent = null;
  if (hasNotes) {
    notesContent = document.createElement("div");
    notesContent.className = "site-tab-content";
    notesContent.append(renderNotes(build));
  }

  // ── Append to DOM first, then render (renderers need elements in the document
  //    for getBoundingClientRect to work, e.g. spec connector lines) ──
  container.append(buildContent, equipContent);
  if (notesContent) container.append(notesContent);

  initSkills({ skillsHost });
  renderSkills();

  initSpecializations({ specializationsHost });
  renderSpecializations();

  initEquipment({ equipmentPanel });
  initEquipmentCallbacks({
    render: () => renderEquipmentPanel(),
    markEditorChanged: () => {},
    renderSkills: () => {},
  });
  renderEquipmentPanel();

  // ── Tab switching logic ─────────────────────────────────────────────────
  const allTabs = [buildTab, equipTab, notesTab].filter(Boolean);
  const allContents = [buildContent, equipContent, notesContent].filter(Boolean);

  function activateTab(index) {
    allTabs.forEach((t, i) => t.classList.toggle("site-tab--active", i === index));
    allContents.forEach((c, i) => c.classList.toggle("site-tab-content--active", i === index));
  }

  allTabs.forEach((tab, i) => {
    tab.addEventListener("click", () => activateTab(i));
  });

  // Mobile enhancements
  initMobileDetection();
  initSkillBarMobile();
  initSpecAccordion();
  initEquipmentSubTabs();
}
