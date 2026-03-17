// AxiForge Renderer — Entry Point
// Imports all feature modules and wires them together via init callbacks.
// Application-level orchestration (init, wireEvents, setProfession, etc.) lives here.

import { state, createEmptyEditor } from "./modules/state.js";
import { delay } from "./modules/utils.js";
import { injectSkeleton } from "./modules/skeleton.js";

let _lastGameMode = "pve";
import { initCustomSelect, closeCustomSelect } from "./modules/custom-select.js";
import {
  initDetailPanel, bindHoverPreview, hideHoverPreview,
  renderDetailPanel, selectDetail, triggerDetailPanelAnimation,
} from "./modules/detail-panel.js";
import {
  initSpecializations, initSpecializationsCallbacks, renderSpecializations, drawSpecConnector,
} from "./modules/specializations.js";
import {
  initSkills, initSkillsCallbacks, renderSkills, syncRevenantSkillsFromLegend,
  buildMechanicSlotsForRender, getSkillOptionsByType, getEquippedWeaponSkills,
  buildRevenantEliteByProfSlot,
} from "./modules/skills.js";
import {
  initEquipment, initEquipmentCallbacks, renderEquipmentPanel, openSlotPicker,
} from "./modules/equipment.js";
import {
  initNotes, initNotesCallbacks, renderNotesPanel,
} from "./modules/notes.js";
import {
  initEditorCallbacks, enforceEditorConsistency, markEditorChanged, captureEditorBaseline,
  loadBuildIntoEditor, serializeEditorToBuild, parseBuildImportPayload, confirmDiscardDirty,
  createDefaultSpecializationSelections, createDefaultSkillSelections,
  computeEditorSignature,
  computeUnsavedChangeSummary,
} from "./modules/editor.js";
import {
  initRenderPagesDom, initRenderPagesCallbacks,
  render, renderEditor, renderEditorForm, renderEditorMeta, renderBuildList,
  setPublishStatus, showError, runPagesBuildPoll, getSelectedTarget,
  showPublishProgress, advancePublishStep, completeAllPublishSteps,
  failPublishStep, showPublishResult,
} from "./modules/render-pages.js";
import { resolveEntityFacts } from "./modules/detail-panel.js";
import { initWikiModal, openWikiModal } from "./modules/wiki-modal.js";
import { initDetailModal, openDetailModal } from "./modules/detail-modal.js";
import { initConfirmModal } from "./modules/confirm-modal.js";
import { initLibrary, renderLibrary, handleLibraryKeydown } from "./modules/library/library.js";

// ── DOM element cache ────────────────────────────────────────────────────────

function q(selector) {
  return typeof document !== "undefined" ? document.querySelector(selector) : null;
}

const el = {
  authRow:           q("#authRow"),
  onboarding:        q("#onboarding"),
  workspaceBtn:      q("#workspaceBtn"),
  workspaceMenu:     q("#workspaceMenu"),
  subnav:            q("#subnav"),
  appLayout:         q(".app-layout"),
  buildList:         q("#buildList"),
  buildSearch:       q("#buildSearch"),
  editorTitle:       q("#editorTitle"),
  professionSelect:  q("#professionSelect"),
  tagsInput:         q("#tagsInput"),
  equipmentPanel:    q("#equipmentPanel"),
  notesPanel:        q("#notesPanel"),
  newBuildBtn:       q("#newBuildBtn"),
  saveBuildBtn:      q("#saveBuildBtn"),
  saveDot:           q("#saveDot"),
  saveStatus:        q("#saveStatus"),
  copyPublishLink:   q("#copyPublishLink"),
  duplicateBuildBtn: q("#duplicateBuildBtn"),
  copyBuildBtn:      q("#copyBuildBtn"),
  pasteBuildBtn:     q("#pasteBuildBtn"),
  overflowMenuBtn:   q("#overflowMenuBtn"),
  overflowMenu:      q("#overflowMenu"),
  publishSiteBtn:    q("#publishSiteBtn"),
  specializationsHost: q("#specializationsHost"),
  skillsHost:        q("#skillsHost"),
  detailHost:        q("#detailHost"),
  detailExpandBtn:   q("#detail-expand-btn"),
  publishStatus:     q("#publishStatus"),
  hoverPreview:      q("#hoverPreview"),
  winMin:            q("#winMin"),
  winMax:            q("#winMax"),
  winClose:          q("#winClose"),
  titlebar:          q("#titlebar"),
  updateVersionLabel: q("#updateVersionLabel"),
  updateProgressLabel: q("#updateProgressLabel"),
  updateRestartBtn:    q("#updateRestartBtn"),
};

// ── Module initialization ────────────────────────────────────────────────────
// Pass DOM refs and cross-module callbacks to all feature modules.

initCustomSelect({ bindHoverPreview, onError: showError });

initWikiModal();
initDetailModal();
initConfirmModal();
initDetailPanel(
  { detailHost: el.detailHost, hoverPreview: el.hoverPreview, expandBtn: el.detailExpandBtn },
  {
    openWikiModal,
    // Capture state.detail and state.activeCatalog at click time (not at init time)
    // so the modal always reflects the current profession catalog.
    openDetailModal: () => openDetailModal(state.detail, state.activeCatalog, state.editor?.profession),
  }
);

initSpecializations({ specializationsHost: el.specializationsHost });
initSpecializationsCallbacks({
  enforceEditorConsistency,
  markEditorChanged,
  renderEditor,
  renderSkills,
});

initSkills({ skillsHost: el.skillsHost });
initSkillsCallbacks({
  renderEditor,
  markEditorChanged,
  enforceEditorConsistency,
  openSlotPicker,
});

initEquipment({ equipmentPanel: el.equipmentPanel });
initEquipmentCallbacks({
  markEditorChanged,
  render,
  renderSkills,
});

initNotes({ notesPanel: el.notesPanel });
initNotesCallbacks({
  markEditorChanged,
});

initEditorCallbacks({
  render,
  renderEditorMeta,
  renderSpecializations,
  renderSkills,
  renderEquipmentPanel,
  syncRevenantSkillsFromLegend,
  getSkillOptionsByType,
  setProfession: (id, opts) => setProfession(id, opts),
  reloadBuilds,
  renderBuildList,
});

initRenderPagesDom(el);
initRenderPagesCallbacks({
  refreshOnboardingStatus,
  confirmDiscardDirty,
  loadBuildIntoEditor,
  reloadBuilds,
  setProfession: (id, opts) => setProfession(id, opts),
  captureEditorBaseline,
  markEditorChanged,
  renderSpecializations,
  renderSkills,
  renderEquipmentPanel,
  renderNotesPanel,
  renderDetailPanel,
  serializeEditorToBuild,
  parseBuildImportPayload,
  enforceEditorConsistency,
  startNewBuild,
  saveCurrentBuild,
  duplicateCurrentBuild,
  copyBuildJsonToClipboard,
  importBuildJsonFromClipboard,
  runPagesBuildPoll,
  showError,
  setPublishStatus,
  navigateToPage,
});

// ── Auto-update titlebar UI ──────────────────────────────────────────────────

(async function initUpdateUI() {
  if (typeof window === "undefined" || !window.desktopApi?.getAppVersion) return;

  if (import.meta.env.DEV) {
    if (el.updateVersionLabel) {
      el.updateVersionLabel.textContent = "dev";
      el.updateVersionLabel.classList.add("titlebar__dev-badge");
    }
    return;
  }

  try {
    const version = await window.desktopApi.getAppVersion();
    if (el.updateVersionLabel) el.updateVersionLabel.textContent = `v${version}`;
  } catch { /* not available in web builds */ }

  let errorTimeout = null;

  window.desktopApi.onUpdateAvailable?.((info) => {
    if (el.updateVersionLabel) el.updateVersionLabel.textContent = `v${info.version} available`;
  });

  window.desktopApi.onUpdateNotAvailable?.((info) => {
    if (el.updateVersionLabel) el.updateVersionLabel.textContent = `v${info.version}`;
  });

  window.desktopApi.onDownloadProgress?.((info) => {
    if (el.updateProgressLabel) {
      el.updateProgressLabel.textContent = `Updating... ${Math.round(info.percent)}%`;
      el.updateProgressLabel.classList.add("visible");
    }
    if (el.updateVersionLabel) el.updateVersionLabel.style.opacity = "0";
  });

  window.desktopApi.onUpdateDownloaded?.(() => {
    if (el.updateProgressLabel) {
      el.updateProgressLabel.textContent = "";
      el.updateProgressLabel.classList.remove("visible");
    }
    if (el.updateVersionLabel) el.updateVersionLabel.style.opacity = "";
    if (el.updateRestartBtn) {
      el.updateRestartBtn.classList.remove("hidden");
      // Trigger reflow before adding visible class for transition
      void el.updateRestartBtn.offsetWidth;
      el.updateRestartBtn.classList.add("visible");
    }
  });

  window.desktopApi.onUpdateError?.((info) => {
    if (errorTimeout) clearTimeout(errorTimeout);
    if (el.updateVersionLabel) {
      el.updateVersionLabel.classList.add("titlebar__version--error");
      el.updateVersionLabel.textContent = "Update failed";
    }
    if (el.updateProgressLabel) {
      el.updateProgressLabel.textContent = "";
      el.updateProgressLabel.classList.remove("visible");
    }
    errorTimeout = setTimeout(async () => {
      if (el.updateVersionLabel) {
        el.updateVersionLabel.classList.remove("titlebar__version--error");
        try {
          const version = await window.desktopApi.getAppVersion();
          el.updateVersionLabel.textContent = `v${version}`;
        } catch {
          el.updateVersionLabel.textContent = "";
        }
      }
    }, 5000);
  });

  if (el.updateRestartBtn) {
    el.updateRestartBtn.addEventListener("click", () => {
      window.desktopApi.restartApp?.();
    });
  }
})();

// ── Entry point ──────────────────────────────────────────────────────────────

if (typeof window !== "undefined" && !window.__GW2_RENDERER_TEST__) {
  init().catch((err) => showError(err));
}

async function init() {
  wireWindowControls();
  wireEvents();

  try { _lastGameMode = (await window.desktopApi.getSetting("lastGameMode")) || "pve"; } catch { /* first run */ }
  syncGameModeToggleUI(_lastGameMode);

  const [builds, professions] = await Promise.all([
    window.desktopApi.listBuilds(),
    window.desktopApi.listProfessions(),
  ]);
  state.builds = Array.isArray(builds) ? builds : [];
  state.professions = Array.isArray(professions) ? professions : [];

  // Load upgrade catalog (runes/sigils/infusions) in the background — not profession-dependent.
  // Maps don't survive IPC serialization, so rebuild them from the arrays.
  window.desktopApi.getUpgradeCatalog().then((raw) => {
    raw.runeById = new Map((raw.runes || []).map((r) => [r.id, r]));
    raw.sigilById = new Map((raw.sigils || []).map((s) => [s.id, s]));
    raw.infusionById = new Map((raw.infusions || []).map((i) => [i.id, i]));
    raw.enrichmentById = new Map((raw.enrichments || []).map((e) => [e.id, e]));
    raw.foodById = new Map((raw.foods || []).map((f) => [f.id, f]));
    raw.utilityById = new Map((raw.utilities || []).map((u) => [u.id, u]));
    raw.relicById = new Map((raw.relics || []).map((r) => [r.id, r]));
    state.upgradeCatalog = raw;
  }).catch((err) => {
    console.warn("Failed to load upgrade catalog:", err);
  });
  renderEditorForm();
  await refreshOnboardingStatus();

  await initLibrary({
    navigateToPage,
    loadBuildIntoEditor,
    startNewBuild,
    confirmDiscardDirty,
    saveCurrentBuild,
    duplicateCurrentBuild,
    copyBuildJsonToClipboard,
    importBuildJsonFromClipboard,
    render,
  });

  if (state.builds.length) {
    await loadBuildIntoEditor(state.builds[0], { captureBaseline: true });
  } else if (state.professions.length) {
    state.editor = createEmptyEditor(state.professions[0].id, _lastGameMode);
    await setProfession(state.professions[0].id, { preserveSelections: false });
    captureEditorBaseline();
  }

  await refreshWindowControls();
  render();
  syncGameModeToggleUI(state.editor.gameMode || "pve");
}

// ── Build operations ─────────────────────────────────────────────────────────

async function reloadBuilds() {
  const builds = await window.desktopApi.listBuilds();
  state.builds = Array.isArray(builds) ? builds : [];
}

async function startNewBuild(profession, { skipDirtyCheck = false } = {}) {
  if (!skipDirtyCheck && !confirmDiscardDirty("Start a new build")) return;
  profession = profession || state.editor.profession || state.professions[0]?.id || "";
  state.editor = createEmptyEditor(profession, _lastGameMode);
  if (profession) {
    await setProfession(profession, { preserveSelections: false });
  }
  state.detail = null;
  captureEditorBaseline();
  render();
  syncGameModeToggleUI(state.editor.gameMode || "pve");
  setPublishStatus("");
}

async function saveCurrentBuild() {
  try {
    const saved = await window.desktopApi.saveBuild(serializeEditorToBuild());
    state.editor.id = saved.id;
    await reloadBuilds();
    const savedBuild = state.builds.find((entry) => entry.id === saved.id);
    if (savedBuild) await loadBuildIntoEditor(savedBuild, { captureBaseline: true });
    else captureEditorBaseline();
    render();
    syncGameModeToggleUI(state.editor.gameMode || "pve");
    setPublishStatus("");
  } catch (err) {
    showError(err);
  }
}

async function duplicateCurrentBuild() {
  const baseTitle = String(state.editor.title || "Untitled Build").trim();
  state.editor.id = "";
  state.editor.title = baseTitle ? `${baseTitle} (Copy)` : "Copied Build";
  markEditorChanged({ updateBuildList: true });
  renderEditorForm();
  setPublishStatus("Build duplicated. Save to keep it in your library.");
}

async function copyBuildJsonToClipboard() {
  try {
    const payload = serializeEditorToBuild();
    const json = JSON.stringify(payload, null, 2);
    await window.desktopApi.writeClipboardText(json);
    setPublishStatus("Build JSON copied to clipboard.");
  } catch (err) {
    showError(err);
  }
}

async function importBuildJsonFromClipboard() {
  try {
    if (!confirmDiscardDirty("Import another build")) return;
    const text = await window.desktopApi.readClipboardText();
    if (!text || !String(text).trim()) {
      throw new Error("Clipboard is empty.");
    }
    const parsed = parseBuildImportPayload(String(text));
    await loadBuildIntoEditor(parsed, { captureBaseline: false });
    state.editor.id = "";
    markEditorChanged({ updateBuildList: true });
    state.editorDirty = true;
    renderEditorMeta();
    render();
    syncGameModeToggleUI(state.editor.gameMode || "pve");
    setPublishStatus("Imported build JSON from clipboard. Save to keep it locally.");
  } catch (err) {
    showError(err);
  }
}

// ── Profession / catalog management ─────────────────────────────────────────

async function setProfession(professionId, options = {}) {
  const selected = String(professionId || "");
  if (!selected) return;

  // Show skeleton placeholders while catalog loads
  injectSkeleton(el.skillsHost, "skills");
  injectSkeleton(el.specializationsHost, "specs");
  injectSkeleton(el.equipmentPanel, "equipment");
  injectSkeleton(el.detailHost, "detail");

  const catalog = await getCatalog(selected, state.editor.gameMode || "pve");
  state.activeCatalog = catalog;
  state.editor.profession = selected;

  if (!options.preserveSelections) {
    state.editor.specializations = createDefaultSpecializationSelections(catalog);
    state.editor.skills = createDefaultSkillSelections(catalog, state.editor.specializations);
  }

  enforceEditorConsistency({ preferredEliteSlot: options.preferredEliteSlot });
  renderEditor();
}

async function getCatalog(professionId, gameMode = "pve") {
  const cacheKey = `${professionId}_${gameMode}`;
  if (state.catalogCache.has(cacheKey)) return state.catalogCache.get(cacheKey);
  const raw = await window.desktopApi.getProfessionCatalog(professionId, gameMode);
  const catalog = {
    ...raw,
    specializationById: new Map((raw.specializations || []).map((entry) => [Number(entry.id), entry])),
    traitById: new Map((raw.traits || []).map((entry) => [Number(entry.id), entry])),
    skillById: new Map((raw.skills || []).map((entry) => [Number(entry.id), entry])),
    weaponSkillById: new Map((raw.weaponSkills || []).map((entry) => [Number(entry.id), entry])),
    legendById: new Map((raw.legends || []).map((entry) => [String(entry.id), entry])),
    petById: new Map((raw.pets || []).map((entry) => [Number(entry.id), entry])),
  };
  state.catalogCache.set(cacheKey, catalog);

  // Pre-load all spec background images so they're cached before the user switches specs
  for (const spec of catalog.specializations || []) {
    const wikiUrl = `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(`${spec.name || ""} specialization.png`)}`;
    const img = new Image();
    img.src = wikiUrl;
  }

  return catalog;
}

function syncGameModeToggleUI(mode) {
  document.querySelectorAll(".game-mode-toggle__btn").forEach((btn) => {
    btn.classList.toggle("game-mode-toggle__btn--active", btn.dataset.mode === mode);
  });
}

// ── Auth / onboarding helpers ────────────────────────────────────────────────

async function refreshOnboardingStatus() {
  const status = await window.desktopApi.getOnboardingStatus();
  state.onboarding = status;
  state.user = status.viewer;

  if (status.isAuthenticated) {
    state.targets = await window.desktopApi.listTargets();
    if (!state.selectedTarget) {
      state.selectedTarget =
        state.targets.find((target) => target.login === status.targetOwner) ||
        state.targets[0] ||
        null;
    }
  } else {
    state.targets = [];
    state.selectedTarget = null;
  }

  if (status.isAuthenticated && status.repoReady && !status.pagesReady && !state.pagesPoll.active) {
    runPagesBuildPoll().catch((err) => showError(err));
  }
}

// ── Window controls ──────────────────────────────────────────────────────────

function wireWindowControls() {
  el.titlebar.addEventListener("dblclick", async (event) => {
    if (event.target.closest(".no-drag")) return;
    await window.desktopApi.toggleMaximizeWindow();
    await refreshWindowControls();
  });
  el.winMin.addEventListener("click", async () => {
    await window.desktopApi.minimizeWindow();
  });
  el.winMax.addEventListener("click", async () => {
    await window.desktopApi.toggleMaximizeWindow();
    await refreshWindowControls();
  });
  el.winClose.addEventListener("click", async () => {
    await window.desktopApi.closeWindow();
  });
}

async function refreshWindowControls() {
  const maximized = await window.desktopApi.isMaximizedWindow();
  el.winMax.title = maximized ? "Restore Down" : "Maximize";
  el.winMax.innerHTML = maximized
    ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="2.5" width="7" height="7"/><polyline points="2.5,2.5 2.5,0.5 9.5,0.5 9.5,7.5 7.5,7.5"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="0.5" width="9" height="9"/></svg>';
}

// ── Window title ─────────────────────────────────────────────────────────────

function updateWindowTitle() {
  const name = state.editor?.title;
  document.title = name ? `AxiForge — ${name}` : "AxiForge";
}

// ── Page navigation ─────────────────────────────────────────────────────────

function navigateToPage(page) {
  if (!page) return;
  state.activePage = page;
  document.querySelectorAll(".leftnav__item").forEach((b) => b.classList.remove("leftnav__item--active"));
  const activeBtn = document.querySelector(`.leftnav__item[data-page="${page}"]`);
  if (activeBtn) activeBtn.classList.add("leftnav__item--active");
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  const target = document.querySelector(`#page-${page}`);
  if (target) target.classList.remove("hidden");
  // Show/hide subnav for editor page
  el.subnav.classList.toggle("subnav--visible", page === "editor");
  // Render library when navigating to library page
  if (page === "library") {
    renderLibrary();
  }
  // Redraw spec connectors when editor page becomes visible (they need layout dimensions)
  if (page === "editor") {
    requestAnimationFrame(() => {
      document.querySelectorAll(".spec-card__body").forEach((body) => drawSpecConnector(body));
    });
  }
}

// ── Event wiring ─────────────────────────────────────────────────────────────

function wireEvents() {
  el.editorTitle.addEventListener("input", () => {
    state.editor.title = String(el.editorTitle.value || "");
    markEditorChanged({ updateBuildList: true });
    updateWindowTitle();
  });

  el.tagsInput.addEventListener("input", () => {
    state.editor.tagsText = String(el.tagsInput.value || "");
    markEditorChanged();
  });

  el.newBuildBtn?.addEventListener("click", async () => {
    await startNewBuild();
  });

  el.saveBuildBtn.addEventListener("click", async () => {
    await saveCurrentBuild();
  });

  el.duplicateBuildBtn.addEventListener("click", async () => {
    await duplicateCurrentBuild();
  });

  // Dev-only: show Copy/Paste JSON buttons
  if (location.port || location.hostname === "localhost") {
    el.copyBuildBtn.classList.remove("hidden");
    el.pasteBuildBtn.classList.remove("hidden");
  }

  el.copyBuildBtn.addEventListener("click", async () => {
    await copyBuildJsonToClipboard();
  });

  el.pasteBuildBtn.addEventListener("click", async () => {
    await importBuildJsonFromClipboard();
  });

  // Overflow menu toggle
  el.overflowMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    el.overflowMenu.classList.toggle("hidden");
  });

  // Close overflow menu on outside click or Escape
  document.addEventListener("click", () => {
    el.overflowMenu.classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") el.overflowMenu.classList.add("hidden");
  });

  // Close overflow menu when any item is clicked
  el.overflowMenu.addEventListener("click", () => {
    el.overflowMenu.classList.add("hidden");
  });

  // Listen for publish progress events from main process
  window.desktopApi.onPublishProgress((step) => {
    advancePublishStep(step);
  });

  el.publishSiteBtn.addEventListener("click", async () => {
    if (!state.editor.id) {
      showError(new Error("Save the build first before publishing."));
      return;
    }
    let lastStep = "saving";
    try {
      el.publishSiteBtn.disabled = true;
      showPublishProgress();
      advancePublishStep("saving");

      if (state.editorDirty) {
        const serialized = serializeEditorToBuild();
        await window.desktopApi.saveBuild({ ...serialized, id: state.editor.id });
        state.builds = await window.desktopApi.listBuilds();
        captureEditorBaseline();
      }

      // The main process sends progress events for loading, repo, site, encrypt, upload, deploy
      const result = await window.desktopApi.publishBuild(state.editor.id);

      // Mark all upload steps done, advance to Pages polling
      advancePublishStep("pages");

      if (result?.pagesUrl) {
        await window.desktopApi.writeClipboardText(result.pagesUrl);
        // showPublishResult marks "pages" done and polls until live
        showPublishResult(result.pagesUrl);
      } else {
        completeAllPublishSteps();
      }

      state.builds = await window.desktopApi.listBuilds();
      renderBuildList();
      renderEditorMeta();
    } catch (err) {
      failPublishStep(lastStep, err.message);
      showError(err);
    } finally {
      el.publishSiteBtn.disabled = false;
    }
  });

  if (el.buildSearch) {
    el.buildSearch.addEventListener("input", () => {
      state.buildSearch = String(el.buildSearch.value || "").trim().toLowerCase();
      renderBuildList();
    });
  }

  window.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") {
      closeCustomSelect();
      hideHoverPreview();
      return;
    }
    if (state.activePage === "library") {
      handleLibraryKeydown(event);
      return;
    }
    const key = String(event.key || "").toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    if (key === "s") {
      event.preventDefault();
      await saveCurrentBuild();
    } else if (key === "d") {
      event.preventDefault();
      await duplicateCurrentBuild();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".cselect")) return;
    closeCustomSelect();
  });

  document.addEventListener("scroll", (event) => {
    // Don't close when scrolling inside the open dropdown's own list
    const open = state.openCustomSelect;
    if (open && event.target instanceof Node && open.contains(event.target)) return;
    closeCustomSelect();
  }, { capture: true, passive: true });

  // Workspace menu toggle
  el.workspaceBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    el.workspaceMenu.classList.toggle("hidden");
  });

  document.addEventListener("pointerdown", (event) => {
    if (!el.workspaceMenu.classList.contains("hidden") &&
        !el.workspaceMenu.contains(event.target) &&
        event.target !== el.workspaceBtn) {
      el.workspaceMenu.classList.add("hidden");
    }
  });

  // Left nav page switching
  document.querySelectorAll(".leftnav__item").forEach((btn) => {
    btn.addEventListener("click", () => navigateToPage(btn.dataset.page));
  });

  // Subnav tab switching
  document.querySelectorAll(".subnav__item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.subtab;
      if (!tab) return;
      document.querySelectorAll(".subnav__item").forEach((b) => b.classList.remove("subnav__item--active"));
      btn.classList.add("subnav__item--active");
      document.querySelectorAll(".subtab").forEach((t) => t.classList.add("hidden"));
      const target = document.querySelector(`#subtab-${tab}`);
      if (target) target.classList.remove("hidden");
      // Redraw spec connectors when build tab becomes visible (they need layout dimensions)
      if (tab === "build") {
        requestAnimationFrame(() => {
          document.querySelectorAll(".spec-card__body").forEach((body) => drawSpecConnector(body));
        });
      }
    });
  });

  // Game mode toggle
  document.querySelectorAll(".game-mode-toggle__btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const mode = btn.dataset.mode;
        if (!mode || mode === state.editor.gameMode) return;

        state.editor.gameMode = mode;
        _lastGameMode = mode;
        window.desktopApi.setSetting("lastGameMode", mode);

        // Re-fetch catalog for the new mode (cache key includes mode)
        if (state.editor.profession) {
          // Show skeleton placeholders while catalog loads
          injectSkeleton(el.skillsHost, "skills");
          injectSkeleton(el.specializationsHost, "specs");
          injectSkeleton(el.equipmentPanel, "equipment");
          injectSkeleton(el.detailHost, "detail");

          const catalog = await getCatalog(state.editor.profession, mode);
          state.activeCatalog = catalog;
          enforceEditorConsistency();

          // Refresh the detail panel facts from the new catalog if an entity is selected
          if (state.detail?.entityId) {
            const { kind, entityId } = state.detail;
            const freshEntity = kind === "trait"
              ? catalog.traitById?.get(entityId)
              : (catalog.skillById?.get(entityId) || catalog.weaponSkillById?.get(entityId));
            if (freshEntity) {
              const oldFacts = state.detail.facts || [];
              const newFacts = resolveEntityFacts(freshEntity);
              // Key by type+status for buffs/conditions (wiki uses boon name as text,
              // GW2 API uses "Apply Buff/Condition"), or type+text for everything else.
              const factKey = (f) => f.status
                ? `${f.type}:${f.status}`
                : `${f.type}:${(f.text || "").toLowerCase()}`;
              const oldKeys = new Set(oldFacts.map(factKey));
              // _splitFact = value changed (already flagged by catalog) → yellow text + flash
              // _newFact   = fact newly appeared/disappeared in this mode → flash only, no yellow
              const annotatedFacts = newFacts.map((f) => {
                if (oldKeys.has(factKey(f))) return f;
                if (f._splitFact) return f; // catalog already flagged as value-changed
                return { ...f, _newFact: true };
              });
              state.detail = {
                ...state.detail,
                facts: annotatedFacts,
                hasSplit: Boolean(freshEntity.hasSplit),
              };
            }
          }
        }

        markEditorChanged();
        syncGameModeToggleUI(mode);
        renderEditor();
        if (state.detail) triggerDetailPanelAnimation();
      } catch (err) {
        console.error("Game mode toggle error:", err);
        showError(err);
      }
    });
  });
}

// ── Test-only exports (CommonJS compat for Jest) ─────────────────────────────
// Tests now import directly from module files. This shim remains for any legacy
// test that still requires renderer.__testOnly during the transition.

if (typeof module !== "undefined" && module.exports) {
  module.exports.__testOnly = {
    buildMechanicSlotsForRender,
    buildRevenantEliteByProfSlot,
    getSkillOptionsByType,
    getEquippedWeaponSkills,
    resolveEntityFacts,
    _state: state,
  };
}
