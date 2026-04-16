// AxiForge Renderer — Entry Point
// Imports all feature modules and wires them together via init callbacks.
// Application-level orchestration (init, wireEvents, setProfession, etc.) lives here.

import { state, createEmptyEditor } from "./modules/state.js";
import { delay, wireTagInput, escapeHtml } from "./modules/utils.js";
import { injectSkeleton } from "./modules/skeleton.js";

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
  normalizeImportedSkills,
} from "./modules/editor.js";
import {
  initRenderPagesDom, initRenderPagesCallbacks,
  render, renderEditor, renderEditorForm, renderEditorMeta, renderBuildList,
  setPublishStatus, showError, runPagesBuildPoll, getSelectedTarget,
  showPublishProgress, advancePublishStep, completeAllPublishSteps,
  failPublishStep, showPublishResult, getPublishTargetId, syncPublishStatus,
} from "./modules/render-pages.js";
import { resolveEntityFacts } from "./modules/detail-panel.js";
import { resetWikiResolution } from "./modules/wiki-updates.js";
import { initWikiModal, openWikiModal } from "./modules/wiki-modal.js";
import { initDetailModal, openDetailModal } from "./modules/detail-modal.js";
import { initConfirmModal } from "./modules/confirm-modal.js";
import { initImportConflictModal } from "./modules/import-conflict-modal.js";
import { initSettingsModal, initSettingsCallbacks } from "./modules/settings-modal.js";
import { initLibrary, renderLibrary, handleLibraryKeydown, showToast } from "./modules/library/library.js";
import { clearUndo as clearLibraryUndo } from "./modules/library/undo.js";
import { initComps, loadComps, renderComps } from "./modules/comps/comps.js";
import { getProfessionSvg } from "./modules/profession-icons.js";
import { getEliteSpecName, profClass } from "./modules/build-helpers.js";
import { renderMiniBuildCard } from "./modules/mini-build-card.js";
import { PROFESSION_THEMES } from "./modules/constants.js";

let _lastGameMode = "pve";
let _stashedTheme = null;
let _themedBuildsEnabled = false;

// ── Sync-status helpers ──────────────────────────────────────────────────────

// Walk up the parentId chain in state.folders to find the nearest folder with shared:true.
function _findRootSharedFolderInState(folderId) {
  let current = state.folders.find((f) => f.id === folderId);
  while (current) {
    if (current.shared) return current;
    if (!current.parentId) return null;
    current = state.folders.find((f) => f.id === current.parentId);
  }
  return null;
}

// Inline SVGs for sync indicators (no external imports needed)
const _syncSpinnerSvg = `<svg class="sync-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
const _syncCheckSvg = `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd"/></svg>`;

// Apply or remove a sync indicator on all sidebar/content folder elements for folderId.
function _updateFolderSyncIndicators(folderId, status) {
  // Sidebar nav items
  document.querySelectorAll(`[data-navigate-folder="${CSS.escape(folderId)}"]`).forEach((navEl) => {
    let badge = navEl.querySelector(".lib-nav-item__sync-indicator");
    if (!status) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "lib-nav-item__sync-indicator";
      const countEl = navEl.querySelector(".lib-nav-item__count");
      if (countEl) {
        navEl.insertBefore(badge, countEl);
      } else {
        navEl.appendChild(badge);
      }
    }
    badge.className = `lib-nav-item__sync-indicator lib-nav-item__sync-indicator--${status}`;
    badge.innerHTML = status === "syncing" ? _syncSpinnerSvg : status === "synced" ? _syncCheckSvg : "";
    badge.title = status === "syncing" ? "Syncing to shared library…" : status === "synced" ? "Synced" : "Sync error";
  });

  // Content area folder cards (list/table/grid/icon/columns views)
  document.querySelectorAll(`[data-folder-id="${CSS.escape(folderId)}"]`).forEach((cardEl) => {
    let badge = cardEl.querySelector(".lib-content-sync-indicator");
    if (!status) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      // Find the best anchor: a name/title/label span, or fall back to the card itself
      const nameEl =
        cardEl.querySelector(".lib-list-row__title, .lib-tv__name, .lib-grid-card__title, .lib-icon-item__label, .lib-col__name") ||
        cardEl;
      nameEl.appendChild(badge);
    }
    badge.className = `lib-content-sync-indicator lib-content-sync-indicator--${status}`;
    badge.innerHTML = status === "syncing" ? _syncSpinnerSvg : status === "synced" ? _syncCheckSvg : "";
    badge.title = status === "syncing" ? "Syncing…" : status === "synced" ? "Synced" : "Sync error";
  });
}

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
  chatLinkBtn:       q("#chatLinkBtn"),
  editorShareDropdown: q("#editorShareDropdown"),
  professionSelect:  q("#professionSelect"),
  tagsInput:         q("#tagsInput"),
  equipmentPanel:    q("#equipmentPanel"),
  notesPanel:        q("#notesPanel"),
  compsPanel:        q("#compsPanel"),
  newBuildBtn:       q("#newBuildBtn"),
  saveBuildBtn:      q("#saveBuildBtn"),
  saveDot:           q("#saveDot"),
  saveStatus:        q("#saveStatus"),
  syncStatus:        q("#syncStatus"),
  editorSharePubLink: document.querySelector("#editorShareDropdown [data-action='copy-published-link']"),
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
initImportConflictModal();
initSettingsModal();
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
  renderEquipmentPanel,
});

initSkills({ skillsHost: el.skillsHost });
initSkillsCallbacks({
  renderEditor,
  markEditorChanged,
  enforceEditorConsistency,
  openSlotPicker,
  renderEquipmentPanel,
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
  renderCompsPanel,
  renderDetailPanel,
  serializeEditorToBuild,
  parseBuildImportPayload,
  enforceEditorConsistency,
  startNewBuild,
  saveCurrentBuild,
  duplicateCurrentBuild,
  copyBuildJsonToClipboard,
  copyShareCodeToClipboard,
  importBuildJsonFromClipboard,
  runPagesBuildPoll,
  showError,
  setPublishStatus,
  navigateToPage,
  getCatalog,
});
initSettingsCallbacks({
  refreshOnboardingStatus,
  render,
  onThemedBuildsToggle: (enabled) => {
    _themedBuildsEnabled = enabled;
    if (state.activePage === "editor") {
      if (enabled) {
        applyProfessionThemeIfEnabled();
      } else {
        restoreUserThemeIfNeeded();
      }
    }
  },
  onThemeChange: (themeId) => {
    const current = document.documentElement.getAttribute("data-theme") || "";
    if (current.startsWith("prof-")) _stashedTheme = themeId;
  },
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

  if (el.updateVersionLabel) {
    el.updateVersionLabel.style.cursor = "pointer";
    el.updateVersionLabel.title = "Click to check for updates";
    el.updateVersionLabel.addEventListener("click", () => {
      if (el.updateVersionLabel.classList.contains("titlebar__dev-badge")) return;
      const prev = el.updateVersionLabel.textContent;
      el.updateVersionLabel.textContent = "Checking...";
      window.desktopApi.checkForUpdates?.();
      // Restore after timeout if no update event fires
      setTimeout(() => {
        if (el.updateVersionLabel.textContent === "Checking...") {
          el.updateVersionLabel.textContent = prev;
        }
      }, 10000);
    });
  }

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

  // Apply saved color theme
  try {
    const savedTheme = await window.desktopApi.getSetting("appearance.theme");
    if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
  } catch { /* first run */ }

  _themedBuildsEnabled = !!(await window.desktopApi.getSetting("appearance.themedBuildPages"));

  // Library skeleton: read saved view mode and show matching skeleton during the data load window.
  // The static HTML in index.html already shows the list skeleton for first paint; this re-injects
  // the correct template if the user's saved view mode differs from list.
  let _libViewMode = "list";
  try { _libViewMode = (await window.desktopApi.getSetting("library.viewMode")) || "list"; } catch { /* first run */ }
  injectSkeleton(q("#lib-toolbar"), "library-toolbar");
  injectSkeleton(q("#lib-filters"), "library-filters");
  injectSkeleton(q("#lib-sidebar"), "library-sidebar");
  injectSkeleton(q("#lib-content"), `library-${_libViewMode}`);

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
    raw.relicByName = new Map((raw.relics || []).map((r) => [r.name, r]));
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
  // ── Global sync-status / conflict handlers ───────────────────────────────
  // Registered once here (after initLibrary) so preload's removeAllListeners
  // doesn't clobber a handler added in library.js.
  window.desktopApi.onSyncStatus?.((data) => {
    if (!data || typeof data !== "object") return;
    const { status, folderId } = data;
    if (!folderId || !status) return;

    // Resolve to root shared folder so we key by the folder visible in the sidebar
    const rootShared = _findRootSharedFolderInState(folderId);
    const trackId = rootShared?.id || folderId;
    state.folderSyncStatus[trackId] = status;

    renderEditorMeta();
    _updateFolderSyncIndicators(trackId, status);

    if (status === "synced") {
      setTimeout(() => {
        if (state.folderSyncStatus[trackId] === "synced") {
          delete state.folderSyncStatus[trackId];
          renderEditorMeta();
          _updateFolderSyncIndicators(trackId, null);
        }
      }, 3000);
    }

    if (status === "error") {
      showToast("Sync failed — check your connection or library access.", "error");
    }
  });

  window.desktopApi.onSyncConflict?.((data) => {
    showToast(`Sync conflict on \u201c${data?.title || "item"}\u201d \u2014 pull to refresh`, "warning");
  });

  initComps({
    navigateToPage,
    loadBuildIntoEditor,
    confirmDiscardDirty,
    getCatalog,
  });
  await loadComps();

  // Always start with a blank editor — the user loads a build when they want one.
  state.editor = createEmptyEditor("", _lastGameMode);
  captureEditorBaseline();

  await refreshWindowControls();
  render();
  syncGameModeToggleUI(state.editor.gameMode || "pve");

  // Render library if it's the default/active page on startup
  if (state.activePage === "library") {
    renderLibrary();
  }
}

// ── Build operations ─────────────────────────────────────────────────────────

async function reloadBuilds() {
  const builds = await window.desktopApi.listBuilds();
  state.builds = Array.isArray(builds) ? builds : [];
}

async function startNewBuild(profession, { skipDirtyCheck = false } = {}) {
  if (!skipDirtyCheck && !confirmDiscardDirty("Start a new build")) return;
  profession = profession || "";
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
    const activeCompId = state.editor.activeCompId;
    const saved = await window.desktopApi.saveBuild(serializeEditorToBuild());
    state.editor.id = saved.id;
    // If this build was created inside a comp, ensure the comp's buildIds includes it
    if (activeCompId) {
      const comp = state.comps?.find((c) => c.id === activeCompId);
      if (comp && !(comp.buildIds || []).includes(saved.id)) {
        const newGameMode = comp.gameMode || saved.gameMode || null;
        await window.desktopApi.saveComp({ ...comp, gameMode: newGameMode, buildIds: [...(comp.buildIds || []), saved.id] });
        state.comps = await window.desktopApi.listComps();
      }
      state.editor.activeCompId = "";
    }
    await reloadBuilds();
    const savedBuild = state.builds.find((entry) => entry.id === saved.id);
    if (savedBuild) await loadBuildIntoEditor(savedBuild, { captureBaseline: true });
    else captureEditorBaseline();
    render();
    syncGameModeToggleUI(state.editor.gameMode || "pve");
    setPublishStatus("");
    window.desktopApi.prewarmChatLinks?.([saved]);
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

async function copyShareCodeToClipboard() {
  try {
    const payload = serializeEditorToBuild();
    const code = await window.desktopApi.encodeShareCode(payload);
    await window.desktopApi.writeClipboardText(code);
    setPublishStatus("AxiCode copied to clipboard.");
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
    const trimmed = String(text).trim();
    let parsed;
    if (trimmed.startsWith("<AxiForge:") && trimmed.endsWith(">")) {
      const decoded = await window.desktopApi.decodeShareCode(trimmed);
      // Normalize axicode skills format (flat healId/utilityIds/eliteId → nested heal.id)
      const skills = normalizeImportedSkills(decoded);
      const underwaterSkills = normalizeImportedSkills({ skills: decoded.underwaterSkills || {} });
      // Preserve traitChoices on each spec so enforceEditorConsistency can resolve them
      const specializations = (decoded.specializations || []).map((s) => ({
        ...s,
        _traitChoices: Array.isArray(s.traitChoices) ? s.traitChoices : null,
      }));
      parsed = { ...decoded, skills, underwaterSkills, specializations };
    } else {
      parsed = parseBuildImportPayload(trimmed);
    }
    await loadBuildIntoEditor(parsed, { captureBaseline: false });
    state.editor.id = "";
    markEditorChanged({ updateBuildList: true });
    state.editorDirty = true;
    renderEditorMeta();
    render();
    syncGameModeToggleUI(state.editor.gameMode || "pve");
    const source = trimmed.startsWith("<AxiForge:") ? "AxiCode" : "JSON";
    setPublishStatus(`Imported build from ${source}. Save to keep it locally.`);
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

  resetWikiResolution();
  const catalog = await getCatalog(selected, state.editor.gameMode || "pve");
  state.activeCatalog = catalog;
  state.editor.profession = selected;

  if (!options.preserveSelections) {
    state.editor.specializations = createDefaultSpecializationSelections(catalog);
    state.editor.skills = createDefaultSkillSelections(catalog, state.editor.specializations);
  }

  enforceEditorConsistency({ preferredEliteSlot: options.preferredEliteSlot });
  renderEditor();
  if (state.activePage === "editor") applyProfessionThemeIfEnabled();
}

export async function getCatalog(professionId, gameMode = "pve") {
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

function applyThemeWithTransition(themeId) {
  document.documentElement.classList.add("theme-transitioning");
  if (themeId) {
    document.documentElement.setAttribute("data-theme", themeId);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 500);
}

function applyProfessionThemeIfEnabled() {
  if (!_themedBuildsEnabled) return;
  const profession = state.editor?.profession;
  const profTheme = profession ? PROFESSION_THEMES[profession] : null;
  if (!profTheme) return;
  const current = document.documentElement.getAttribute("data-theme") || "";
  if (current === profTheme) return;
  if (!current.startsWith("prof-")) _stashedTheme = current;
  applyThemeWithTransition(profTheme);
}

function restoreUserThemeIfNeeded() {
  const current = document.documentElement.getAttribute("data-theme") || "";
  if (!current.startsWith("prof-")) return;
  applyThemeWithTransition(_stashedTheme || "");
  _stashedTheme = null;
}

function navigateToPage(page) {
  if (!page) return;
  // Clear library undo stack when navigating away from the library
  if (state.activePage === "library" && page !== "library") clearLibraryUndo();
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
    // Eagerly pull shared library updates whenever the user opens the library
    if (state.sharedLibraryConfig?.orgName) {
      window.desktopApi.pullAllShared?.().then(async () => {
        state.builds = await window.desktopApi.listBuilds();
        state.comps = await window.desktopApi.listComps();
        state.folders = await window.desktopApi.listFolders();
        renderLibrary();
      }).catch((err) => {
        console.warn("[library] pull-on-navigate failed:", err);
      });
    }
  }
  // Render comps when navigating to comps page
  if (page === "comps") {
    renderComps();
  }
  // Redraw spec connectors when editor page becomes visible (they need layout dimensions)
  if (page === "editor") {
    // Restore publish ticker for the current editor build (if any active publish)
    syncPublishStatus(state.editor.id);
    requestAnimationFrame(() => {
      document.querySelectorAll(".spec-card__body").forEach((body) => drawSpecConnector(body));
    });
  }
  if (page === "editor") {
    applyProfessionThemeIfEnabled();
  } else {
    restoreUserThemeIfNeeded();
  }
}

// ── Comps panel (editor tab) ─────────────────────────────────────────────────

const PROF_COLORS = {
  guardian: "#6ea8ff", warrior: "#ff9944", necromancer: "#4dca7a",
  engineer: "#cc8844", ranger: "#77cc55", thief: "#cc6677",
  mesmer: "#b07acc", elementalist: "#dd5555", revenant: "#aa6655",
};

function _compTabProfIcons(comp) {
  const specs = [];
  const seen = new Set();
  for (const line of (comp.partyLines || [])) {
    for (const slotBuildId of (line.slots || [])) {
      if (!slotBuildId) continue;
      const build = state.builds.find((b) => b.id === slotBuildId);
      if (!build) continue;
      const specName = getEliteSpecName(build) || build.profession;
      if (!specName || seen.has(specName)) continue;
      seen.add(specName);
      specs.push({ specName, profession: build.profession });
      if (specs.length >= 5) break;
    }
    if (specs.length >= 5) break;
  }
  if (specs.length === 0) return "";
  return specs.map(({ specName, profession }) => {
    const svg = getProfessionSvg(specName) || getProfessionSvg(profession) || "";
    const color = PROF_COLORS[(profession || "").toLowerCase()] || "#888";
    return `<span class="comp-list-row__prof-icon ${profClass(profession)}" style="background:${color}" title="${escapeHtml(specName)}">${svg}</span>`;
  }).join("");
}

function _compTabPartySummary(comp) {
  const lines = comp.partyLines || [];
  const parties = lines.length;
  const slots = lines.reduce((sum, l) => sum + (l.capacity || 0), 0);
  return `${parties} ${parties === 1 ? "party" : "parties"} &middot; ${slots} ${slots === 1 ? "slot" : "slots"}`;
}

function renderCompsPanel() {
  const panel = el.compsPanel;
  if (!panel) return;

  const compIds = state.editor.compIds || [];
  const comps = (state.comps || []).filter((c) => compIds.includes(c.id));
  if (comps.length === 0) {
    panel.innerHTML = `<div class="comps-tab__empty">
      <span class="comps-tab__empty-icon"><svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" opacity="0.3"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg></span>
      <span class="comps-tab__empty-text">This build is not linked to any comps.</span>
    </div>`;
    return;
  }

  const cards = comps.map((c) => {
    const name = escapeHtml(c.name || "Untitled Comp");
    const gmBadge = c.gameMode === "pve"
      ? `<span class="comp-badge comp-badge--sm comp-badge--pve">PvE</span>`
      : c.gameMode === "wvw"
        ? `<span class="comp-badge comp-badge--sm comp-badge--wvw">WvW</span>`
        : "";
    const profIcons = _compTabProfIcons(c);
    const summary = _compTabPartySummary(c);

    const allBuildIds = new Set(c.buildIds || []);
    for (const line of (c.partyLines || [])) {
      for (const sid of (line.slots || [])) {
        if (sid) allBuildIds.add(sid);
      }
    }
    const buildCount = allBuildIds.size;

    return `<div class="comps-tab__card" data-comp-id="${escapeHtml(c.id)}">
      <div class="comps-tab__card-header">
        <span class="comps-tab__card-name">${name}</span>
        ${gmBadge}
        <span class="comps-tab__card-spacer"></span>
        <span class="comps-tab__card-open" title="Open comp">&#8599;</span>
      </div>
      <div class="comps-tab__card-meta">
        <div class="comp-list-row__prof-icons">${profIcons}</div>
        ${profIcons ? `<span class="comp-list-row__pipe">|</span>` : ""}
        <span class="comp-list-row__summary">${summary}</span>
      </div>
      <button type="button" class="comps-tab__toggle" data-comp-toggle="${escapeHtml(c.id)}">
        <svg class="comps-tab__toggle-chevron" width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clip-rule="evenodd"/></svg>
        <span>${buildCount} build${buildCount !== 1 ? "s" : ""}</span>
      </button>
      <div class="comps-tab__card-builds comps-tab__card-builds--collapsed" data-comp-builds="${escapeHtml(c.id)}"></div>
    </div>`;
  }).join("");

  panel.innerHTML = `<div class="comps-tab">
    <div class="comps-tab__header">Linked Comps <span class="comps-tab__badge">${comps.length}</span></div>
    <div class="comps-tab__list">${cards}</div>
  </div>`;

  panel.querySelectorAll(".comps-tab__card-header").forEach((header) => {
    header.addEventListener("click", () => {
      const compId = header.closest("[data-comp-id]").dataset.compId;
      const comp = (state.comps || []).find((c) => c.id === compId);
      if (!comp) return;
      state.activeComp = comp;
      state.compPage = "detail";
      navigateToPage("comps");
    });
  });

  panel.querySelectorAll(".comps-tab__toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const compId = btn.dataset.compToggle;
      const buildsEl = panel.querySelector(`[data-comp-builds="${compId}"]`);
      if (!buildsEl) return;
      const isCollapsed = buildsEl.classList.toggle("comps-tab__card-builds--collapsed");
      btn.classList.toggle("comps-tab__toggle--open", !isCollapsed);
      if (!isCollapsed && !buildsEl.dataset.rendered) {
        const comp = (state.comps || []).find((c) => c.id === compId);
        if (!comp) return;
        const allIds = new Set(comp.buildIds || []);
        for (const line of (comp.partyLines || [])) {
          for (const sid of (line.slots || [])) { if (sid) allIds.add(sid); }
        }
        const html = [...allIds].map((bid) => {
          const b = state.builds.find((x) => x.id === bid);
          if (!b) return "";
          return `<div class="comps-tab__build">${renderMiniBuildCard(b, state.upgradeCatalog, { showActions: false })}</div>`;
        }).filter(Boolean).join("");
        buildsEl.innerHTML = html || `<span class="comps-tab__card-empty">No builds</span>`;
        buildsEl.dataset.rendered = "1";
      }
    });
  });
}

// ── Event wiring ─────────────────────────────────────────────────────────────

function wireEvents() {
  el.editorTitle.addEventListener("input", () => {
    state.editor.title = String(el.editorTitle.value || "");
    markEditorChanged({ updateBuildList: true });
    updateWindowTitle();
  });

  wireTagInput(
    el.tagsInput,
    () => state.editor.tags || [],
    (tags) => { state.editor.tags = tags; },
    markEditorChanged,
  );

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

  // Chat link button
  const chatLinkDefaultHTML = el.chatLinkBtn.innerHTML;
  let chatLinkTimeout = null;
  el.chatLinkBtn.addEventListener("click", async () => {
    el.chatLinkBtn.classList.remove("title-input-group__btn--success", "title-input-group__btn--error");
    const build = serializeEditorToBuild();
    try {
      const link = await window.desktopApi.generateChatLink(build);
      await window.desktopApi.writeClipboardText(link);
      el.chatLinkBtn.classList.add("title-input-group__btn--success");
      el.chatLinkBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg> Copied!`;
    } catch (err) {
      el.chatLinkBtn.classList.add("title-input-group__btn--error");
      el.chatLinkBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 18L18 6M6 6l12 12"/></svg> Failed`;
    }
    clearTimeout(chatLinkTimeout);
    chatLinkTimeout = setTimeout(() => {
      el.chatLinkBtn.classList.remove("title-input-group__btn--success", "title-input-group__btn--error");
      el.chatLinkBtn.innerHTML = chatLinkDefaultHTML;
    }, 2000);
  });

  // Editor share dropdown (subnav)
  {
    const dropdown = el.editorShareDropdown;
    const trigger = dropdown.querySelector(".editor-share-dropdown__trigger");
    const checkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd"/></svg>`;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.toggle("editor-share-dropdown--open");
      if (isOpen) {
        setTimeout(() => {
          const close = () => {
            dropdown.classList.remove("editor-share-dropdown--open");
            document.removeEventListener("click", close);
          };
          document.addEventListener("click", close);
        }, 0);
      }
    });

    function flashItem(item, origHTML) {
      item.innerHTML = `${checkSvg} Copied!`;
      item.classList.add("editor-share-dropdown__item--copied");
      setTimeout(() => {
        item.innerHTML = origHTML;
        item.classList.remove("editor-share-dropdown__item--copied");
      }, 1500);
    }

    function failItem(item, origHTML) {
      item.innerHTML = "Failed";
      item.classList.add("editor-share-dropdown__item--error");
      setTimeout(() => {
        item.innerHTML = origHTML;
        item.classList.remove("editor-share-dropdown__item--error");
      }, 1500);
    }

    // Chat Link
    const chatLinkItem = dropdown.querySelector("[data-action='copy-chat-link']");
    const chatLinkItemDefault = chatLinkItem?.innerHTML;
    chatLinkItem?.addEventListener("click", async () => {
      if (chatLinkItem.classList.contains("editor-share-dropdown__item--copied")) return;
      const build = serializeEditorToBuild();
      try {
        const link = await window.desktopApi.generateChatLink(build);
        await window.desktopApi.writeClipboardText(link);
        flashItem(chatLinkItem, chatLinkItemDefault);
      } catch {
        failItem(chatLinkItem, chatLinkItemDefault);
      }
    });

    // AxiCode
    const axicodeItem = dropdown.querySelector("[data-action='copy-axicode']");
    const axicodeDefault = axicodeItem?.innerHTML;
    axicodeItem?.addEventListener("click", async () => {
      if (axicodeItem.classList.contains("editor-share-dropdown__item--copied")) return;
      const build = serializeEditorToBuild();
      try {
        const code = await window.desktopApi.encodeShareCode(build);
        await window.desktopApi.writeClipboardText(code);
        flashItem(axicodeItem, axicodeDefault);
      } catch {
        failItem(axicodeItem, axicodeDefault);
      }
    });

    // Discord Copy
    const discordCopyItem = dropdown.querySelector("[data-action='discord-copy']");
    const discordCopyDefault = discordCopyItem?.innerHTML;
    discordCopyItem?.addEventListener("click", async () => {
      if (discordCopyItem.classList.contains("editor-share-dropdown__item--copied")) return;
      try {
        const buildId = state.editor?.id;
        if (!buildId) throw new Error("No build loaded");
        const text = await window.desktopApi.getBuildDiscordCopyText(buildId);
        await window.desktopApi.writeClipboardText(text);
        flashItem(discordCopyItem, discordCopyDefault);
      } catch {
        failItem(discordCopyItem, discordCopyDefault);
      }
    });

    // Discord Embed
    const discordEmbedItem = dropdown.querySelector("[data-action='discord-embed']");
    const discordEmbedDefault = discordEmbedItem?.innerHTML;
    discordEmbedItem?.addEventListener("click", async () => {
      if (discordEmbedItem.classList.contains("editor-share-dropdown__item--copied")) return;
      try {
        const webhookUrl = await window.desktopApi.getSetting("discord.buildWebhookUrl");
        if (!webhookUrl) {
          showError(new Error("Set build webhook URL in Settings first."));
          return;
        }
        const buildId = state.editor?.id;
        if (!buildId) throw new Error("No build loaded");

        // Auto-save + publish if not yet published
        let build = state.builds.find((b) => b.id === buildId);
        if (!build?.publishedFileId) {
          el.publishSiteBtn.disabled = true;
          state.publishProgress[buildId] = { currentStep: "saving" };
          showPublishProgress(buildId);
          advancePublishStep("saving");

          if (state.editorDirty) {
            const serialized = serializeEditorToBuild();
            await window.desktopApi.saveBuild({ ...serialized, id: buildId });
            state.builds = await window.desktopApi.listBuilds();
            captureEditorBaseline();
          }

          const pubResult = await window.desktopApi.publishBuild(buildId);
          advancePublishStep("pages");

          if (pubResult?.pagesUrl) {
            state.publishProgress[buildId] = { ...state.publishProgress[buildId], result: pubResult.pagesUrl };
            showPublishResult(pubResult.pagesUrl);
          } else {
            state.publishProgress[buildId] = { ...state.publishProgress[buildId], result: "complete" };
            completeAllPublishSteps();
          }

          state.builds = await window.desktopApi.listBuilds();
          renderBuildList();
          renderEditorMeta();
          el.publishSiteBtn.disabled = false;
        }

        discordEmbedItem.innerHTML = "Sharing...";
        const result = await window.desktopApi.shareBuildToDiscord(buildId);
        if (result.success) {
          flashItem(discordEmbedItem, discordEmbedDefault);
        } else {
          showError(new Error(result.error || "Failed to share"));
          discordEmbedItem.innerHTML = discordEmbedDefault;
        }
      } catch (err) {
        if (state.editor?.id && state.publishProgress[state.editor.id]) {
          failPublishStep("saving", err.message);
        }
        el.publishSiteBtn.disabled = false;
        failItem(discordEmbedItem, discordEmbedDefault);
      }
    });

    // Published Link
    const pubLinkItem = dropdown.querySelector("[data-action='copy-published-link']");
    const pubLinkDefault = pubLinkItem?.innerHTML;
    pubLinkItem?.addEventListener("click", async () => {
      if (pubLinkItem.disabled) return;
      if (pubLinkItem.classList.contains("editor-share-dropdown__item--copied")) return;
      try {
        const buildId = state.editor?.id;
        if (!buildId) throw new Error("No build loaded");
        const build = state.builds.find((b) => b.id === buildId);
        if (!build?.publishedFileId) throw new Error("Build not published");
        const config = await window.desktopApi.getConfig();
        const slug = build.publishedSlug || "";
        const theme = document.documentElement.getAttribute("data-theme");
        const url = `${config.pagesUrl}?n=${encodeURIComponent(slug)}&b=${build.publishedFileId}.${build.publishedKey}${theme ? `&t=${theme}` : ""}`;
        await window.desktopApi.writeClipboardText(url);
        flashItem(pubLinkItem, pubLinkDefault);
      } catch {
        failItem(pubLinkItem, pubLinkDefault);
      }
    });
  }

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
  window.desktopApi.onPublishProgress((payload) => {
    const id = typeof payload === "object" ? payload.id : null;
    const step = typeof payload === "object" ? payload.step : payload;
    // Store in per-ID state
    if (id && state.publishProgress[id]) {
      state.publishProgress[id].currentStep = step;
    }
    // Only advance the visible ticker if it matches the current target
    if (!id || id === getPublishTargetId()) {
      advancePublishStep(step);
    }
  });

  el.publishSiteBtn.addEventListener("click", async () => {
    const buildId = state.editor.id;
    if (!buildId) {
      showError(new Error("Save the build first before publishing."));
      return;
    }
    let lastStep = "saving";
    try {
      el.publishSiteBtn.disabled = true;
      state.publishProgress[buildId] = { currentStep: "saving" };
      showPublishProgress(buildId);
      advancePublishStep("saving");

      if (state.editorDirty) {
        const serialized = serializeEditorToBuild();
        await window.desktopApi.saveBuild({ ...serialized, id: buildId });
        state.builds = await window.desktopApi.listBuilds();
        captureEditorBaseline();
      }

      // The main process sends progress events for loading, repo, site, encrypt, upload, deploy
      const result = await window.desktopApi.publishBuild(buildId);

      // Mark all upload steps done, advance to Pages polling
      advancePublishStep("pages");

      if (result?.pagesUrl) {
        state.publishProgress[buildId] = { ...state.publishProgress[buildId], result: result.pagesUrl };
        await window.desktopApi.writeClipboardText(result.pagesUrl);
        // showPublishResult marks "pages" done and polls until live
        showPublishResult(result.pagesUrl);
      } else {
        state.publishProgress[buildId] = { ...state.publishProgress[buildId], result: "complete" };
        completeAllPublishSteps();
      }

      state.builds = await window.desktopApi.listBuilds();
      renderBuildList();
      renderEditorMeta();
    } catch (err) {
      if (state.publishProgress[buildId]) {
        state.publishProgress[buildId].error = { step: lastStep, message: err.message };
      }
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
      if (tab === "comps") {
        renderCompsPanel();
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

        // Sync the library list entry so drag-drop game mode checks see the current mode
        if (state.editor.id) {
          const listEntry = state.builds.find((b) => b.id === state.editor.id);
          if (listEntry) listEntry.gameMode = mode;
        }

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
              const newFacts = resolveEntityFacts(freshEntity);

              // Delta comparison for split highlighting:
              // Compare current mode's facts against PvE facts to find changed values.
              if (mode !== "pve" && freshEntity.hasSplit) {
                const pveFacts = Array.isArray(freshEntity.facts) ? freshEntity.facts : [];
                const factKey = (f) => f.status
                  ? `${f.type}:${f.status}`
                  : `${f.type}:${(f.text || "").toLowerCase()}`;
                const pveByKey = new Map(pveFacts.map((f) => [factKey(f), f]));

                const VALUE_KEYS = ["value", "duration", "percent", "distance", "dmg_multiplier", "hit_count", "apply_count", "coefficient"];
                const annotatedFacts = newFacts.map((f) => {
                  const key = factKey(f);
                  const pveFact = pveByKey.get(key);
                  if (!pveFact) return { ...f, _newFact: true };
                  const changed = VALUE_KEYS.some((k) => f[k] !== undefined && pveFact[k] !== undefined && f[k] !== pveFact[k]);
                  if (changed) return { ...f, _splitFact: true };
                  return f;
                });

                state.detail = {
                  ...state.detail,
                  facts: annotatedFacts,
                  hasSplit: true,
                };
              } else {
                state.detail = {
                  ...state.detail,
                  facts: newFacts,
                  hasSplit: Boolean(freshEntity.hasSplit),
                };
              }
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
