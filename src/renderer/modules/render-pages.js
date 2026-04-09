import { state, createEmptyEditor } from "./state.js";
import { escapeHtml, formatDate, formatShortDate, formatRelativeTime, makeButton, matchesBuildQuery, delay, renderTagPills } from "./utils.js";
import { renderCustomSelect } from "./custom-select.js";
import { closeCustomSelect } from "./custom-select.js";
import { hideHoverPreview } from "./detail-panel.js";
import { showConfirmModal } from "./confirm-modal.js";
import { openSettingsModal } from "./settings-modal.js";
import { computeUnsavedChangeSummary } from "./editor.js";
import { getProfessionSvg } from "./profession-icons.js";

// ---------------------------------------------------------------------------
// DOM refs — injected by the host (renderer.js) after DOM is ready
// ---------------------------------------------------------------------------
let _el = {};
export function initRenderPagesDom(el) { _el = el; }

// ---------------------------------------------------------------------------
// Cross-module callbacks — injected by the host
// ---------------------------------------------------------------------------
let _callbacks = {};
export function initRenderPagesCallbacks(callbacks) { _callbacks = callbacks; }

// ---------------------------------------------------------------------------
// render — top-level page refresh
// ---------------------------------------------------------------------------
export function render() {
  hideHoverPreview();
  closeCustomSelect();
  renderAuth();
  renderOnboarding();
  renderBuildList();
  renderEditor();
  // Update titlebar user display
  const titlebarUser = document.querySelector("#titlebarUser");
  if (titlebarUser) {
    titlebarUser.textContent = state.user ? state.user.login : "Sign in";
  }
  if (_el.workspaceBtn) {
    _el.workspaceBtn.title = state.user ? `Workspace (${state.user.login})` : "Workspace (not signed in)";
    _el.workspaceBtn.classList.toggle("titlebar__workspace-btn--active", Boolean(state.user));
  }
}

// ---------------------------------------------------------------------------
// renderAuth
// ---------------------------------------------------------------------------
// SVG icons for workspace menu items (Heroicons outline, 20x20)
const _wsIcons = {
  github: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`,
  refresh: `<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.127l.209.209a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.465l.312.311h-2.451a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.127l-.209-.209A7 7 0 002.829 8.476a.75.75 0 101.449.39z" clip-rule="evenodd"/></svg>`,
  settings: `<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 011.262.125l.962.962a1 1 0 01.125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.295a1 1 0 01.804.98v1.36a1 1 0 01-.804.98l-1.473.295a6.95 6.95 0 01-.587 1.416l.834 1.25a1 1 0 01-.125 1.262l-.962.962a1 1 0 01-1.262.125l-1.25-.834a6.953 6.953 0 01-1.416.587l-.295 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a6.957 6.957 0 01-1.416-.587l-1.25.834a1 1 0 01-1.262-.125l-.962-.962a1 1 0 01-.125-1.262l.834-1.25a6.957 6.957 0 01-.587-1.416l-1.473-.295A1 1 0 011 11.36V10a1 1 0 01.804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 01.125-1.262l.962-.962A1 1 0 015.38 3.71l1.25.834a6.957 6.957 0 011.416-.587l.295-1.473zM13 10a3 3 0 11-6 0 3 3 0 016 0z" clip-rule="evenodd"/></svg>`,
  logout: `<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M19 10a.75.75 0 00-.75-.75H8.704l1.048-.943a.75.75 0 10-1.004-1.114l-2.5 2.25a.75.75 0 000 1.114l2.5 2.25a.75.75 0 101.004-1.114l-1.048-.943h9.546A.75.75 0 0019 10z" clip-rule="evenodd"/></svg>`,
};

function _menuItem(icon, label, onClick, className = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `ws-menu-item${className ? ` ${className}` : ""}`;
  btn.innerHTML = `<span class="ws-menu-item__icon">${icon}</span><span class="ws-menu-item__label">${escapeHtml(label)}</span>`;
  btn.addEventListener("click", onClick);
  return btn;
}

function _menuSeparator() {
  const div = document.createElement("div");
  div.className = "ws-menu-sep";
  return div;
}

export function renderAuth() {
  _el.authRow.innerHTML = "";

  const status = state.onboarding;
  const target = getSelectedTarget();

  if (state.user) {
    const who = document.createElement("div");
    who.className = "workspace-menu__user";
    who.innerHTML = `<span class="workspace-menu__avatar">${_wsIcons.github}</span><span>${escapeHtml(state.user.login)}</span>`;
    _el.authRow.append(who);

    _el.authRow.append(_menuSeparator());

    _el.authRow.append(_menuItem(_wsIcons.refresh, "Re-authenticate", async () => {
      try {
        await startLoginFlow();
        await _callbacks.refreshOnboardingStatus();
        render();
      } catch (err) { showError(err); }
    }));

    _el.authRow.append(_menuItem(_wsIcons.settings, "Settings", () => {
      _el.workspaceMenu?.classList.add("hidden");
      openSettingsModal();
    }));

    _el.authRow.append(_menuSeparator());

    _el.authRow.append(_menuItem(_wsIcons.logout, "Log out", async () => {
      await window.desktopApi.logout();
      state.loginFlow.beginData = null;
      await _callbacks.refreshOnboardingStatus();
      render();
    }, "ws-menu-item--danger"));

    return;
  }

  _el.authRow.append(_menuItem(_wsIcons.github, "Sign in with GitHub", async () => {
    try {
      await startLoginFlow();
      await _callbacks.refreshOnboardingStatus();
      render();
    } catch (err) {
      showError(err);
    }
  }, "ws-menu-item--primary"));

  _el.authRow.append(_menuSeparator());

  _el.authRow.append(_menuItem(_wsIcons.settings, "Settings", () => {
    _el.workspaceMenu?.classList.add("hidden");
    openSettingsModal();
  }));
}

// ---------------------------------------------------------------------------
// renderOnboarding
// ---------------------------------------------------------------------------
export function renderOnboarding() {
  const status = state.onboarding;
  _el.onboarding.innerHTML = "";
  if (!status) return;

  // Device code display — shown during active login flow, hidden once authenticated
  if (state.loginFlow.beginData && !status.isAuthenticated) {
    const card = document.createElement("article");
    card.className = "status-card";
    const heading = document.createElement("h3");
    heading.textContent = "GitHub Device Code";
    const instruction = document.createElement("p");
    instruction.textContent = "Approve login at GitHub using this code.";

    const codeDisplay = document.createElement("div");
    codeDisplay.style.cssText = "text-align:center;font-size:1.5rem;font-family:monospace;padding:0.75rem;background:var(--input-bg);border-radius:6px;margin:8px 0;letter-spacing:0.15em;";
    codeDisplay.textContent = state.loginFlow.beginData.userCode || "";

    const copyBtn = makeButton("Copy code", "secondary", async () => {
      await window.desktopApi.writeClipboardText(state.loginFlow.beginData.userCode);
      copyBtn.textContent = "Copied";
      setTimeout(() => { copyBtn.textContent = "Copy code"; }, 1000);
    });

    const link = document.createElement("p");
    link.style.fontSize = "0.85rem";
    const a = document.createElement("a");
    a.href = state.loginFlow.beginData.verificationUri || "";
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = state.loginFlow.beginData.verificationUri || "";
    link.append("Open ", a);

    card.append(heading, instruction, codeDisplay, copyBtn, link);
    _el.onboarding.append(card);
  }
}

// ---------------------------------------------------------------------------
// renderBuildList
// ---------------------------------------------------------------------------
export function renderBuildList() {
  // New library module handles rendering when present
  if (document.getElementById("lib-content")) return;

  const query = state.buildSearch;
  const visible = state.builds
    .filter((build) => matchesBuildQuery(build, query))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  _el.buildList.innerHTML = "";
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = "No local builds yet.";
    _el.buildList.append(empty);
    return;
  }

  for (const build of visible) {
    const card = document.createElement("article");
    const active = build.id && build.id === state.editor.id;
    const dirtySuffix = active && state.editorDirty ? " | Unsaved edits" : "";
    card.className = `build-card ${active ? "build-card--active" : ""}`;

    // Extract enriched data from saved build
    const specNames = (build.specializations || [])
      .map((s) => s.name)
      .filter(Boolean);
    const eliteSpec = (build.specializations || []).find((s) => s.elite);
    const skillNames = [
      build.skills?.heal?.name || "",
      ...((build.skills?.utility || []).map((s) => s?.name || "")),
      build.skills?.elite?.name || "",
    ].filter(Boolean);

    // Build pills
    let pillsHtml = `<span class="build-card__pill">${escapeHtml(build.profession || "Unknown")}</span>`;
    pillsHtml += `<span class="build-card__pill build-card__pill--mode">${escapeHtml((build.gameMode || "pve").toUpperCase())}</span>`;
    if (eliteSpec) {
      pillsHtml += `<span class="build-card__pill build-card__pill--elite">${escapeHtml(eliteSpec.name)}</span>`;
    }

    // Build detail lines
    let detailHtml = "";
    if (specNames.length) {
      detailHtml += `<div class="build-card__detail"><span class="build-card__detail-label">Specs:</span> ${escapeHtml(specNames.join(" \u00B7 "))}</div>`;
    }
    if (skillNames.length) {
      detailHtml += `<div class="build-card__detail"><span class="build-card__detail-label">Skills:</span> ${escapeHtml(skillNames.join(" \u00B7 "))}</div>`;
    }

    const iconName = eliteSpec?.name || build.profession;
    const profSvg = getProfessionSvg(iconName) || getProfessionSvg(build.profession) || "";
    card.innerHTML = `
      <div class="build-card__icon">${profSvg}</div>
      <div class="build-card__content">
        <div class="build-card__header">
          <h3>${escapeHtml(build.title || "Untitled Build")}${escapeHtml(dirtySuffix)}</h3>
          <span class="build-card__date">${escapeHtml(formatShortDate(build.updatedAt))}</span>
        </div>
        <div class="build-card__pills">${pillsHtml}</div>
        ${detailHtml}
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "build-card__actions";

    const loadBtn = makeButton("Load", "secondary", async () => {
      if (!_callbacks.confirmDiscardDirty("Load a different build")) return;
      await _callbacks.loadBuildIntoEditor(build);
      _callbacks.navigateToPage("editor");
      render();
    });
    const deleteBtn = makeButton("Delete", "danger", async () => {
      await window.desktopApi.deleteBuild(build.id);
      await _callbacks.reloadBuilds();
      if (state.editor.id === build.id) {
        const next = state.builds[0] || null;
        if (next) await _callbacks.loadBuildIntoEditor(next);
        else {
          const profession = state.professions[0]?.id || "";
          state.editor = createEmptyEditor(profession);
          if (profession) {
            await _callbacks.setProfession(profession, { preserveSelections: false });
          }
          _callbacks.captureEditorBaseline();
        }
      }
      render();
    });
    const publishBtn = makeButton("Publish", "secondary", async () => {
      const status = state.onboarding;
      if (!status?.isAuthenticated || !status?.repoReady) {
        showError(new Error("Set up publishing in the user menu first."));
        return;
      }
      try {
        publishBtn.disabled = true;
        publishBtn.textContent = "Publishing...";
        state.publishProgress[build.id] = { currentStep: "saving" };
        showPublishProgress(build.id);
        advancePublishStep("saving");

        if (build.id === state.editor.id && state.editorDirty) {
          const serialized = _callbacks.serializeEditorToBuild();
          await window.desktopApi.saveBuild({ ...serialized, id: build.id });
          await _callbacks.reloadBuilds();
        }

        const result = await window.desktopApi.publishBuild(build.id);

        advancePublishStep("pages");

        if (result?.pagesUrl) {
          state.publishProgress[build.id] = { ...state.publishProgress[build.id], result: result.pagesUrl };
          await window.desktopApi.writeClipboardText(result.pagesUrl);
          showPublishResult(result.pagesUrl);
        } else {
          state.publishProgress[build.id] = { ...state.publishProgress[build.id], result: "complete" };
          completeAllPublishSteps();
        }

        await _callbacks.reloadBuilds();
        renderBuildList();
        renderEditorMeta();
      } catch (err) {
        if (state.publishProgress[build.id]) {
          state.publishProgress[build.id].error = { step: "saving", message: err.message };
        }
        showError(err);
      } finally {
        publishBtn.disabled = false;
        publishBtn.textContent = "Publish";
      }
    });
    const canPublish = Boolean(state.onboarding?.isAuthenticated && state.onboarding?.repoReady);
    publishBtn.disabled = !canPublish;
    actions.append(loadBtn, publishBtn, deleteBtn);
    card.querySelector(".build-card__content").append(actions);
    _el.buildList.append(card);
  }
}

// ---------------------------------------------------------------------------
// renderEditor
// ---------------------------------------------------------------------------
export function renderEditor() {
  closeCustomSelect();
  hideHoverPreview();
  renderEditorForm();
  renderEditorMeta();
  _callbacks.renderSpecializations();
  _callbacks.renderSkills();
  _callbacks.renderEquipmentPanel();
  _callbacks.renderNotesPanel();
  _callbacks.renderDetailPanel();
}

// ---------------------------------------------------------------------------
// renderEditorForm
// ---------------------------------------------------------------------------
export function renderEditorForm() {
  // Build grouped options: each profession is a group with Core + elite spec children.
  // Uses SVG class icons from gw2-class-icons package via getProfessionSvg().
  const currentProfession = state.editor.profession;
  const gameMode = state.editor.gameMode || "pve";

  // Pre-fetch catalogs for all professions in the background so elite specs appear
  if (_callbacks.getCatalog) {
    for (const prof of state.professions) {
      const cacheKey = `${prof.id}_${gameMode}`;
      if (!state.catalogCache.has(cacheKey)) {
        _callbacks.getCatalog(prof.id, gameMode).then(() => {
          // Re-render once the catalog arrives so the dropdown shows elite specs
          renderEditorForm();
        }).catch(() => {});
      }
    }
  }

  const profSpecGroups = state.professions.map((profession) => {
    const isActive = profession.id === currentProfession;
    const catalog = isActive
      ? state.activeCatalog
      : state.catalogCache.get(`${profession.id}_${gameMode}`) || null;
    const eliteSpecs = catalog
      ? (Array.isArray(catalog.specializations) ? catalog.specializations : []).filter((s) => s.elite)
      : [];
    const profSvg = getProfessionSvg(profession.name) || "";

    if (eliteSpecs.length > 0) {
      return {
        label: profession.name,
        iconSvg: profSvg,
        options: [
          { value: `${profession.id}:core`, label: `Core ${profession.name}`, iconSvg: profSvg },
          ...eliteSpecs.map((spec) => ({
            value: `${profession.id}:${spec.id}`,
            label: spec.name,
            iconSvg: getProfessionSvg(spec.name) || profSvg,
          })),
        ],
      };
    }
    // No catalog loaded yet — show profession as a single selectable option
    return {
      label: profession.name,
      iconSvg: profSvg,
      options: [
        { value: `${profession.id}:core`, label: profession.name, iconSvg: profSvg },
      ],
    };
  });

  // Determine current value: "ProfessionId:eliteSpecId" or "ProfessionId:core"
  // Empty string when no profession is selected — shows the placeholder.
  const profSpecValue = (() => {
    if (!currentProfession) return "";
    const catalog = state.activeCatalog;
    if (!catalog) return `${currentProfession}:core`;
    const slot2 = state.editor.specializations[2];
    const specId = Number(slot2?.specializationId) || 0;
    const spec = catalog.specializationById.get(specId);
    return `${currentProfession}:${spec?.elite ? String(specId) : "core"}`;
  })();

  renderCustomSelect(_el.professionSelect, {
    value: profSpecValue,
    className: "cselect--toolbar",
    searchable: true,
    groups: profSpecGroups,
    placeholder: "Select profession / elite spec",
    onChange: async (nextValue) => {
      const [professionId, specPart] = nextValue.split(":");
      if (!professionId) return;
      const eliteSpecId = specPart === "core" ? 0 : Number(specPart) || 0;
      const isSameProfession = professionId === state.editor.profession;

      if (isSameProfession) {
        // Same profession — swap elite spec in slot 3, preserve slots 1-2
        const catalog = state.activeCatalog;
        if (!catalog) return;
        if (eliteSpecId) {
          if (Number(state.editor.specializations[2]?.specializationId) === eliteSpecId) return;
          state.editor.specializations[2] = {
            specializationId: eliteSpecId,
            majorChoices: { 1: 0, 2: 0, 3: 0 },
          };
        } else {
          // Core — clear elite from slot 3
          const allSpecs = Array.isArray(catalog.specializations) ? catalog.specializations : [];
          const usedIds = new Set(
            state.editor.specializations.slice(0, 2).map((s) => Number(s?.specializationId) || 0).filter(Boolean)
          );
          const replacement = allSpecs.find((s) => !s.elite && !usedIds.has(s.id));
          state.editor.specializations[2] = replacement
            ? { specializationId: replacement.id, majorChoices: { 1: 0, 2: 0, 3: 0 } }
            : { specializationId: 0, majorChoices: { 1: 0, 2: 0, 3: 0 } };
        }
        _callbacks.enforceEditorConsistency({ preferredEliteSlot: 2 });
        _callbacks.markEditorChanged({ updateBuildList: true });
        renderEditor();
      } else {
        // Different profession — full switch
        if (state.editor.id) {
          if (state.editorDirty) {
            const changes = computeUnsavedChangeSummary();
            const body = changes.length
              ? `<ul>${changes.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
              : "<p>You have unsaved changes that will be lost.</p>";
            const confirmed = await showConfirmModal({
              title: "Discard unsaved changes?",
              body,
              confirmLabel: "Discard & Switch",
              cancelLabel: "Cancel",
            });
            if (!confirmed) {
              renderEditorForm();
              return;
            }
          }
          await _callbacks.startNewBuild(professionId, { skipDirtyCheck: true });
        } else {
          state.editor.profession = professionId;
          await _callbacks.setProfession(professionId, { preserveSelections: false });
          state.detail = null;
          _callbacks.captureEditorBaseline();
          renderEditor();
        }
        // After profession loads, set elite spec if requested
        if (eliteSpecId) {
          const catalog = state.activeCatalog;
          if (catalog) {
            state.editor.specializations[2] = {
              specializationId: eliteSpecId,
              majorChoices: { 1: 0, 2: 0, 3: 0 },
            };
            _callbacks.enforceEditorConsistency({ preferredEliteSlot: 2 });
            _callbacks.markEditorChanged({ updateBuildList: true });
            renderEditor();
          }
        }
      }
    },
  });

  _el.editorTitle.value = state.editor.title || "";
  renderTagPills(_el.tagsInput, state.editor.tags || []);

  // Update window title to reflect current build name
  const buildName = state.editor.title;
  document.title = buildName ? `AxiForge — ${buildName}` : "AxiForge";

  const status = state.onboarding;
  const canPublish = Boolean(status?.isAuthenticated && status?.repoReady);
  _el.publishSiteBtn.disabled = !canPublish;
  if (!status?.isAuthenticated) {
    _el.publishSiteBtn.title = "Sign in and set up publishing to enable this";
  } else if (!status?.repoReady) {
    _el.publishSiteBtn.title = "Set up publishing in the user menu to enable this";
  } else {
    _el.publishSiteBtn.title = "";
  }
  _el.copyBuildBtn.disabled = !state.editor.profession;
  _el.duplicateBuildBtn.disabled = !state.editor.profession;
}

// ---------------------------------------------------------------------------
// renderEditorMeta
// ---------------------------------------------------------------------------
export function renderEditorMeta() {
  if (state.editorDirty) {
    _el.saveDot.classList.remove("hidden");
  } else {
    _el.saveDot.classList.add("hidden");
  }

  // Save status badge: "Draft" or "Last saved: Xm ago"
  if (_el.saveStatus) {
    const isDraft = !state.editor.id;
    if (isDraft) {
      _el.saveStatus.textContent = "Draft";
    } else {
      const build = state.builds.find((b) => b.id === state.editor.id);
      const relative = build ? formatRelativeTime(build.updatedAt) : "";
      _el.saveStatus.textContent = relative ? `Last saved: ${relative}` : "";
    }
    _el.saveStatus.classList.toggle("subnav__save-status--draft", isDraft);
    _el.saveStatus.classList.toggle("subnav__save-status--saved", !isDraft);
  }

  // Published link button (inside share dropdown)
  if (_el.editorSharePubLink) {
    const publishUrl = _getPublishedUrl();
    if (publishUrl) {
      _el.editorSharePubLink.disabled = false;
      _el.editorSharePubLink.removeAttribute("title");
    } else {
      _el.editorSharePubLink.disabled = true;
      _el.editorSharePubLink.title = "Publish first";
    }
  }
}

function _getPublishedUrl() {
  if (!state.editor.id) return null;
  const build = state.builds.find((b) => b.id === state.editor.id);
  if (!build?.publishedSlug || !build?.publishedFileId || !build?.publishedKey) return null;
  const owner = state.onboarding?.targetOwner;
  const repo = state.onboarding?.repoName;
  if (!owner || !repo) return null;
  const theme = document.documentElement.getAttribute("data-theme");
  return `https://${owner}.github.io/${repo}/?n=${encodeURIComponent(build.publishedSlug)}&b=${build.publishedFileId}.${build.publishedKey}${theme ? `&t=${theme}` : ""}`;
}

// ---------------------------------------------------------------------------
// runPagesBuildPoll
// ---------------------------------------------------------------------------
/**
 * @param {number} [triggeredAfter] — timestamp (ms) of when the build was triggered.
 *   If provided, poll results with updatedAt before this time are treated as stale
 *   (from a previous build) and ignored until a newer build appears.
 */
export async function runPagesBuildPoll(triggeredAfter) {
  state.pagesPoll.active = true;
  state.pagesPoll.status = "queued";
  state.pagesPoll.error = null;
  renderOnboarding();

  try {
    for (let i = 0; i < 120; i += 1) {
      const poll = await window.desktopApi.pollPagesStatus();

      // If a trigger time was provided, ignore stale results from a previous build
      const buildTime = poll.updatedAt ? new Date(poll.updatedAt).getTime() : 0;
      const isStale = triggeredAfter && poll.ready && buildTime < triggeredAfter;

      state.pagesPoll.status = isStale ? "queued" : (poll.status || "unknown");
      state.pagesPoll.error = poll.error || null;
      renderOnboarding();

      if (poll.ready && !isStale && poll.pagesUrl) return;
      if (!isStale && (poll.status === "errored" || poll.status === "error")) {
        throw new Error(poll.error || "GitHub Pages build failed.");
      }
      await delay(3000);
    }
    throw new Error("Timed out waiting for GitHub Pages to finish building.");
  } finally {
    state.pagesPoll.active = false;
    renderOnboarding();
  }
}

// ---------------------------------------------------------------------------
// startLoginFlow
// ---------------------------------------------------------------------------
export async function startLoginFlow() {
  state.loginFlow.pending = true;
  state.loginFlow.waitingForApproval = true;
  renderOnboarding();
  try {
    const beginData = await window.desktopApi.beginLogin();
    state.loginFlow.beginData = beginData;
    renderOnboarding();
    await window.desktopApi.completeLogin(beginData);
  } finally {
    state.loginFlow.waitingForApproval = false;
    state.loginFlow.pending = false;
  }
}

// ---------------------------------------------------------------------------
// setPublishStatus
// ---------------------------------------------------------------------------
export function setPublishStatusEl(el) { _el.publishStatus = el; }

export function setPublishStatus(message) {
  // Don't overwrite an active publish ticker
  const pid = _el.publishStatus.dataset.publishId;
  if (pid && state.publishProgress[pid]) return;
  _el.publishStatus.textContent = message || "";
}

export function getPublishTargetId() {
  return _el.publishStatus?.dataset?.publishId || null;
}

export function syncPublishStatus(id) {
  if (id && state.publishProgress[id]) {
    restorePublishProgress(id);
  } else {
    _el.publishStatus.innerHTML = "";
    delete _el.publishStatus.dataset.publishId;
  }
}

// ---------------------------------------------------------------------------
// renderPublishProgress — animated step-by-step publish status
// ---------------------------------------------------------------------------

const PUBLISH_STEPS = [
  { key: "saving", label: "Saving build" },
  { key: "loading", label: "Preparing build data" },
  { key: "repo", label: "Connecting to repository" },
  { key: "site", label: "Deploying site infrastructure" },
  { key: "builds", label: "Publishing builds" },
  { key: "encrypt", label: "Encrypting" },
  { key: "upload", label: "Uploading to GitHub" },
  { key: "deploy", label: "Triggering Pages deploy" },
  { key: "pages", label: "Waiting for Pages to go live" },
];

// Ticker row height must match CSS --ticker-row-h (20px)
const TICKER_ROW_H = 20;

export function showPublishProgress(id) {
  _el.publishStatus.innerHTML = "";
  if (id) _el.publishStatus.dataset.publishId = id;

  // Dismiss button
  const dismiss = document.createElement("button");
  dismiss.className = "publish-status__dismiss";
  dismiss.textContent = "\u00d7";
  dismiss.title = "Dismiss";
  dismiss.addEventListener("click", () => {
    const pid = _el.publishStatus.dataset.publishId;
    if (pid) delete state.publishProgress[pid];
    _el.publishStatus.innerHTML = "";
    delete _el.publishStatus.dataset.publishId;
  });

  // Ticker window — shows 3 rows: prev (done), current (active), next (pending)
  const ticker = document.createElement("div");
  ticker.className = "publish-ticker";

  const strip = document.createElement("div");
  strip.className = "publish-ticker__strip";

  // Leading blank so first step appears in the middle slot
  const blank = document.createElement("div");
  blank.className = "publish-ticker__row publish-ticker__row--blank";
  blank.innerHTML = "&nbsp;";
  strip.append(blank);

  for (const step of PUBLISH_STEPS) {
    const row = document.createElement("div");
    row.className = "publish-ticker__row publish-ticker__row--pending";
    row.dataset.publishStep = step.key;
    row.innerHTML = `<span class="publish-ticker__icon">\u2022</span>${escapeHtml(step.label)}`;
    strip.append(row);
  }

  // Trailing blank so last step can sit in the middle slot
  const blankEnd = document.createElement("div");
  blankEnd.className = "publish-ticker__row publish-ticker__row--blank";
  blankEnd.innerHTML = "&nbsp;";
  strip.append(blankEnd);

  ticker.append(strip);

  // Result slot (populated on success)
  const resultSlot = document.createElement("div");
  resultSlot.className = "publish-result";

  _el.publishStatus.append(dismiss, ticker, resultSlot);
}

export function advancePublishStep(stepKey) {
  const strip = _el.publishStatus.querySelector(".publish-ticker__strip");
  if (!strip) return;

  // Dynamic builds sub-step: "builds:N:M:Title"
  if (stepKey.startsWith("builds:")) {
    const parts = stepKey.split(":");
    const n = parts[1], total = parts[2], title = parts.slice(3).join(":");
    const buildsRow = strip.querySelector('[data-publish-step="builds"]');
    if (buildsRow) {
      buildsRow.innerHTML = `<span class="publish-ticker__icon">\u2022</span>Publishing build ${n} of ${total}: ${escapeHtml(title)}`;
    }
    stepKey = "builds";
  }

  const rows = strip.querySelectorAll("[data-publish-step]");
  let idx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].dataset.publishStep === stepKey) { idx = i; break; }
  }
  if (idx < 0) return;

  // Mark all previous as done, current as active, rest pending
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    row.classList.remove("publish-ticker__row--pending", "publish-ticker__row--active", "publish-ticker__row--done", "publish-ticker__row--error");
    if (i < idx) {
      row.classList.add("publish-ticker__row--done");
      row.querySelector(".publish-ticker__icon").textContent = "\u2713";
    } else if (i === idx) {
      row.classList.add("publish-ticker__row--active");
      row.querySelector(".publish-ticker__icon").innerHTML = `<span class="publish-ticker__spinner"></span>`;
    } else {
      row.classList.add("publish-ticker__row--pending");
      row.querySelector(".publish-ticker__icon").textContent = "\u2022";
    }
  }

  // Scroll strip so active row is in the middle slot
  // idx is 0-based among data rows; in the strip, row is at child index idx+1 (leading blank)
  strip.style.transform = `translateY(${-idx * TICKER_ROW_H}px)`;
}

export function completeAllPublishSteps() {
  const strip = _el.publishStatus.querySelector(".publish-ticker__strip");
  if (!strip) return;
  const rows = strip.querySelectorAll("[data-publish-step]");
  for (const row of rows) {
    row.classList.remove("publish-ticker__row--pending", "publish-ticker__row--active");
    row.classList.add("publish-ticker__row--done");
    row.querySelector(".publish-ticker__icon").textContent = "\u2713";
  }
  // Park on last step
  strip.style.transform = `translateY(${-(rows.length - 1) * TICKER_ROW_H}px)`;
}

export function failPublishStep(stepKey, message) {
  const strip = _el.publishStatus.querySelector(".publish-ticker__strip");
  if (!strip) return;
  for (const row of strip.querySelectorAll("[data-publish-step]")) {
    if (row.dataset.publishStep === stepKey) {
      row.classList.remove("publish-ticker__row--active", "publish-ticker__row--pending");
      row.classList.add("publish-ticker__row--error");
      row.querySelector(".publish-ticker__icon").textContent = "\u2717";
      if (message) {
        const err = document.createElement("span");
        err.className = "publish-ticker__error";
        err.textContent = ` \u2014 ${message}`;
        row.append(err);
      }
      break;
    }
  }
}

export function showPublishResult(url) {
  const resultSlot = _el.publishStatus.querySelector(".publish-result");
  if (!resultSlot) return;

  // Dev-only: show preview + mobile buttons immediately alongside the ticker
  if (location.port || location.hostname === "localhost") {
    try {
      const parsed = new URL(url);
      const remoteBase = `${parsed.origin}${parsed.pathname.replace(/[^/]*$/, "")}`;
      const localParams = new URLSearchParams(parsed.search);
      localParams.set("remoteBase", remoteBase);
      const localUrl = `http://localhost:3000/?${localParams.toString()}`;
      const localBtn = document.createElement("button");
      localBtn.className = "btn btn-dev publish-result__preview";
      localBtn.textContent = "Preview";
      localBtn.addEventListener("click", () => {
        window.desktopApi.openPreviewWindow(localUrl);
      });
      const mobileBtn = document.createElement("button");
      mobileBtn.className = "btn btn-dev publish-result__preview";
      mobileBtn.textContent = "Mobile";
      mobileBtn.addEventListener("click", () => {
        window.desktopApi.openPreviewWindow(localUrl, { mobile: true });
      });
      resultSlot.append(localBtn, mobileBtn);
    } catch { /* ignore malformed URL */ }
  }

  // Poll until live, then swap ticker for URL + Copy
  pollPageLive(url, resultSlot);
}

function _showUrlResult(url, resultSlot) {
  // Hide the ticker, show URL + Copy in its place
  const ticker = _el.publishStatus.querySelector(".publish-ticker");
  if (ticker) ticker.style.display = "none";

  resultSlot.innerHTML = `
    <span class="publish-result__label">Published</span>
    <input type="text" class="publish-result__url" value="${escapeHtml(url)}" readonly />
    <button class="btn btn-secondary publish-result__copy">Copy</button>
  `;

  const copyBtn = resultSlot.querySelector(".publish-result__copy");
  const urlInput = resultSlot.querySelector(".publish-result__url");

  copyBtn.addEventListener("click", async () => {
    await window.desktopApi.writeClipboardText(url);
    copyBtn.textContent = "Copied!";
    urlInput.select();
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
  });

  urlInput.addEventListener("click", () => urlInput.select());

  // Dev-only: preview + mobile buttons
  if (location.port || location.hostname === "localhost") {
    try {
      const parsed = new URL(url);
      const remoteBase = `${parsed.origin}${parsed.pathname.replace(/[^/]*$/, "")}`;
      const localParams = new URLSearchParams(parsed.search);
      localParams.set("remoteBase", remoteBase);
      const localUrl = `http://localhost:3000/?${localParams.toString()}`;
      const localBtn = document.createElement("button");
      localBtn.className = "btn btn-dev publish-result__preview";
      localBtn.textContent = "Preview";
      localBtn.addEventListener("click", () => {
        window.desktopApi.openPreviewWindow(localUrl);
      });
      const mobileBtn = document.createElement("button");
      mobileBtn.className = "btn btn-dev publish-result__preview";
      mobileBtn.textContent = "Mobile";
      mobileBtn.addEventListener("click", () => {
        window.desktopApi.openPreviewWindow(localUrl, { mobile: true });
      });
      resultSlot.append(localBtn, mobileBtn);
    } catch { /* ignore malformed URL */ }
  }
}

async function pollPageLive(url, resultSlot) {
  for (let i = 0; i < 40; i++) {
    try {
      const poll = await window.desktopApi.pollPagesStatus();
      if (poll.ready) {
        completeAllPublishSteps();
        _showUrlResult(url, resultSlot);
        return;
      }
    } catch { /* keep polling */ }
    await delay(4000);
  }
  // Timeout — show URL anyway
  completeAllPublishSteps();
  _showUrlResult(url, resultSlot);
}

// ---------------------------------------------------------------------------
// restorePublishProgress — rebuild ticker UI from state.publishProgress
// ---------------------------------------------------------------------------
export function restorePublishProgress(id) {
  const entry = state.publishProgress[id];
  if (!entry) {
    _el.publishStatus.innerHTML = "";
    delete _el.publishStatus.dataset.publishId;
    return;
  }
  showPublishProgress(id);
  if (entry.error) {
    // Advance to the error step first so prior steps show as done
    advancePublishStep(entry.error.step);
    failPublishStep(entry.error.step, entry.error.message);
  } else if (entry.result) {
    completeAllPublishSteps();
    if (entry.result !== "complete") {
      showPublishResult(entry.result);
    }
  } else if (entry.currentStep) {
    advancePublishStep(entry.currentStep);
  }
}

// ---------------------------------------------------------------------------
// getSelectedTarget
// ---------------------------------------------------------------------------
export function getSelectedTarget() {
  if (!state.targets.length) return null;
  return state.selectedTarget || state.targets[0];
}

// ---------------------------------------------------------------------------
// showError
// ---------------------------------------------------------------------------
export async function showError(err) {
  const message = err instanceof Error ? err.message : String(err);
  setPublishStatus(`Error: ${message}`);
  await window.desktopApi.showError("AxiForge Error", message);
}
