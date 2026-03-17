import { state, createEmptyEditor } from "./state.js";
import { escapeHtml, formatDate, formatShortDate, formatRelativeTime, makeButton, matchesBuildQuery, delay } from "./utils.js";
import { renderCustomSelect } from "./custom-select.js";
import { closeCustomSelect } from "./custom-select.js";
import { hideHoverPreview } from "./detail-panel.js";
import { showConfirmModal } from "./confirm-modal.js";
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
export function renderAuth() {
  _el.authRow.innerHTML = "";

  const status = state.onboarding;
  const target = getSelectedTarget();

  if (state.user) {
    const who = document.createElement("div");
    who.className = "workspace-menu__user";
    who.textContent = `Signed in as ${state.user.login}`;
    _el.authRow.append(who);

    const reauth = makeButton("Re-authenticate", "secondary", async () => {
      try {
        await startLoginFlow();
        await _callbacks.refreshOnboardingStatus();
        render();
      } catch (err) { showError(err); }
    });

    const logout = makeButton("Log out", "danger", async () => {
      await window.desktopApi.logout();
      state.loginFlow.beginData = null;
      await _callbacks.refreshOnboardingStatus();
      render();
    });

    _el.authRow.append(who, reauth, logout);
    return;
  }

  const loginBtn = makeButton("Login with GitHub", "primary", async () => {
    try {
      await startLoginFlow();
      await _callbacks.refreshOnboardingStatus();
      render();
    } catch (err) {
      showError(err);
    }
  });
  _el.authRow.append(loginBtn);
}

// ---------------------------------------------------------------------------
// Setup ticker — flag to prevent renderOnboarding from wiping during setup
// ---------------------------------------------------------------------------
let _setupInProgress = false;

const SETUP_STEPS = [
  { key: "repo", label: "Creating repository" },
  { key: "pages", label: "Configuring GitHub Pages" },
  { key: "deploy", label: "Deploying site files" },
  { key: "trigger", label: "Triggering first build" },
  { key: "poll", label: "Waiting for Pages to go live" },
];

const PAGES_POLL_STEPS = [
  { key: "queued", label: "Queued for build" },
  { key: "building", label: "Building site" },
  { key: "deploying", label: "Deploying to Pages" },
  { key: "built", label: "Live" },
];

/**
 * Creates a ticker element with scrolling step display.
 * @param {Array<{key:string,label:string}>} steps
 * @param {string} [initialActiveKey] — if provided, set to this position without animation
 * @returns {{ el: HTMLElement, advance(key:string):void, complete():void, fail(key:string, msg?:string):void }}
 */
function createTicker(steps, initialActiveKey) {
  const ROW_H = 20;
  const ticker = document.createElement("div");
  ticker.className = "publish-ticker publish-ticker--card";

  const strip = document.createElement("div");
  strip.className = "publish-ticker__strip";

  const blank = document.createElement("div");
  blank.className = "publish-ticker__row publish-ticker__row--blank";
  blank.innerHTML = "&nbsp;";
  strip.append(blank);

  for (const step of steps) {
    const row = document.createElement("div");
    row.className = "publish-ticker__row publish-ticker__row--pending";
    row.dataset.tickerStep = step.key;
    row.innerHTML = `<span class="publish-ticker__icon">\u2022</span>${escapeHtml(step.label)}`;
    strip.append(row);
  }

  const blankEnd = document.createElement("div");
  blankEnd.className = "publish-ticker__row publish-ticker__row--blank";
  blankEnd.innerHTML = "&nbsp;";
  strip.append(blankEnd);

  ticker.append(strip);

  const _advance = (stepKey, animate) => {
    const rows = strip.querySelectorAll("[data-ticker-step]");
    let idx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].dataset.tickerStep === stepKey) { idx = i; break; }
    }
    if (idx < 0) return;
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
    if (!animate) strip.style.transition = "none";
    strip.style.transform = `translateY(${-idx * ROW_H}px)`;
    if (!animate) requestAnimationFrame(() => { strip.style.transition = ""; });
  };

  if (initialActiveKey) _advance(initialActiveKey, false);

  return {
    el: ticker,
    advance: (key) => _advance(key, true),
    complete: () => {
      const rows = strip.querySelectorAll("[data-ticker-step]");
      for (const row of rows) {
        row.classList.remove("publish-ticker__row--pending", "publish-ticker__row--active");
        row.classList.add("publish-ticker__row--done");
        row.querySelector(".publish-ticker__icon").textContent = "\u2713";
      }
      strip.style.transform = `translateY(${-(rows.length - 1) * ROW_H}px)`;
    },
    fail: (stepKey, message) => {
      for (const row of strip.querySelectorAll("[data-ticker-step]")) {
        if (row.dataset.tickerStep === stepKey) {
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
    },
  };
}

// ---------------------------------------------------------------------------
// renderOnboarding
// ---------------------------------------------------------------------------
export function renderOnboarding() {
  if (_setupInProgress) return;

  const status = state.onboarding;
  _el.onboarding.innerHTML = "";
  if (!status) return;

  const target = getSelectedTarget();

  // Device code display — shown during active login flow, hidden once authenticated
  if (state.loginFlow.beginData && !status.isAuthenticated) {
    const card = document.createElement("article");
    card.className = "status-card";
    const heading = document.createElement("h3");
    heading.textContent = "GitHub Device Code";
    const instruction = document.createElement("p");
    instruction.textContent = "Approve login at GitHub using this code.";

    const codeDisplay = document.createElement("div");
    codeDisplay.style.cssText = "text-align:center;font-size:1.5rem;font-family:monospace;padding:0.75rem;background:#060d1d;border-radius:6px;margin:8px 0;letter-spacing:0.15em;";
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

  // Onboarding steps — only show setup step when authenticated but not fully set up
  if (!status.isAuthenticated) return;

  const repoReady = status.repoReady;
  const pagesReady = status.pagesReady;

  // Target picker — always show when authenticated
  const pickerContainer = document.createElement("div");
  _el.onboarding.append(pickerContainer);
  renderTargetPicker(pickerContainer);

  // Setup Publishing card
  const card = document.createElement("article");
  card.className = "status-card";
  const title = document.createElement("h3");
  title.textContent = "Setup Publishing";
  const body = document.createElement("p");
  body.textContent = target ? `Target: ${target.login}` : "Pick a target first.";
  card.append(title, body);

  // Pages poll ticker — shown when poll is active (standalone, not during setup)
  if (state.pagesPoll.active) {
    const currentStatus = String(state.pagesPoll.status || "queued").toLowerCase();
    const { el: tickerEl } = createTicker(PAGES_POLL_STEPS, currentStatus);
    card.append(tickerEl);
    if (state.pagesPoll.error) {
      const errLine = document.createElement("p");
      errLine.className = "error-line";
      errLine.textContent = state.pagesPoll.error;
      card.append(errLine);
    }
  } else if (target) {
    const setupReady = repoReady && pagesReady;
    const btn = makeButton(setupReady ? "Re-run Setup" : "Setup Publishing", setupReady ? "secondary" : "primary", async () => {
      _setupInProgress = true;
      btn.style.display = "none";
      const triggeredAt = Date.now();

      const tickerCtrl = createTicker(SETUP_STEPS);
      card.append(tickerCtrl.el);

      let currentStep = "repo";
      try {
        tickerCtrl.advance("repo");
        currentStep = "repo";
        await window.desktopApi.setupRepoPages(target.login, target.type);

        tickerCtrl.advance("pages");
        currentStep = "pages";
        await delay(400);

        tickerCtrl.advance("deploy");
        currentStep = "deploy";
        await delay(400);

        tickerCtrl.advance("trigger");
        currentStep = "trigger";
        await delay(300);

        tickerCtrl.advance("poll");
        currentStep = "poll";
        await runPagesBuildPoll(triggeredAt);

        tickerCtrl.complete();
        await delay(600);

        _setupInProgress = false;
        await _callbacks.refreshOnboardingStatus();
        render();
      } catch (err) {
        tickerCtrl.fail(currentStep, err.message);
        _setupInProgress = false;
        btn.style.display = "";
      }
    });
    btn.classList.add("mt-8");
    card.append(btn);
  }
  _el.onboarding.append(card);
}

// ---------------------------------------------------------------------------
// renderTargetPicker
// ---------------------------------------------------------------------------
export function renderTargetPicker(container) {
  if (!container || !state.targets.length) return;
  const wrap = document.createElement("div");
  wrap.className = "target-picker";
  const label = document.createElement("label");
  label.textContent = "Repository owner";
  const host = document.createElement("div");
  renderCustomSelect(host, {
    value: state.selectedTarget?.login || state.targets[0]?.login || "",
    className: "cselect--target",
    options: state.targets.map((target) => ({
      value: target.login,
      label: target.login,
      meta: String(target.type || "").toUpperCase(),
      iconText: target.type === "org" ? "O" : "U",
    })),
    placeholder: "Select owner",
    onChange: (login) => {
      state.selectedTarget = state.targets.find((target) => target.login === String(login)) || null;
      render();
    },
  });
  label.append(host);
  wrap.append(label);
  container.innerHTML = "";
  container.append(wrap);
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
        showPublishProgress();
        advancePublishStep("saving");

        if (build.id === state.editor.id && state.editorDirty) {
          const serialized = _callbacks.serializeEditorToBuild();
          await window.desktopApi.saveBuild({ ...serialized, id: build.id });
          await _callbacks.reloadBuilds();
        }

        const result = await window.desktopApi.publishBuild(build.id);

        advancePublishStep("pages");

        if (result?.pagesUrl) {
          await window.desktopApi.writeClipboardText(result.pagesUrl);
          showPublishResult(result.pagesUrl);
        } else {
          completeAllPublishSteps();
        }

        await _callbacks.reloadBuilds();
        renderBuildList();
        renderEditorMeta();
      } catch (err) {
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
  renderCustomSelect(_el.professionSelect, {
    value: state.editor.profession,
    className: "cselect--toolbar",
    options: state.professions.map((profession) => ({
      value: profession.id,
      label: profession.name,
      icon: profession.icon || "",
    })),
    placeholder: "Select profession",
    onChange: async (nextProfession) => {
      const professionId = String(nextProfession || "");
      if (!professionId || professionId === state.editor.profession) return;

      if (state.editor.id) {
        // Saved build — class switch starts a new draft
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
        // Unsaved draft — swap in-place (current behavior)
        state.editor.profession = professionId;
        await _callbacks.setProfession(professionId, { preserveSelections: false });
        state.detail = null;
        _callbacks.captureEditorBaseline();
        renderEditor();
      }
    },
  });

  _el.editorTitle.value = state.editor.title || "";
  _el.tagsInput.value = state.editor.tagsText || "";

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

  // Published link button
  if (_el.copyPublishLink) {
    const publishUrl = _getPublishedUrl();
    if (publishUrl) {
      _el.copyPublishLink.classList.remove("hidden");
      _el.copyPublishLink.onclick = async () => {
        await window.desktopApi.writeClipboardText(publishUrl);
        _el.copyPublishLink.classList.add("subnav__link-btn--copied");
        _el.copyPublishLink.title = "Copied!";
        setTimeout(() => {
          _el.copyPublishLink.classList.remove("subnav__link-btn--copied");
          _el.copyPublishLink.title = "Copy published link";
        }, 2000);
      };
    } else {
      _el.copyPublishLink.classList.add("hidden");
      _el.copyPublishLink.onclick = null;
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
  return `https://${owner}.github.io/${repo}/?n=${encodeURIComponent(build.publishedSlug)}&b=${build.publishedFileId}.${build.publishedKey}`;
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
export function setPublishStatus(message) {
  _el.publishStatus.textContent = message || "";
}

// ---------------------------------------------------------------------------
// renderPublishProgress — animated step-by-step publish status
// ---------------------------------------------------------------------------

const PUBLISH_STEPS = [
  { key: "saving", label: "Saving build" },
  { key: "loading", label: "Preparing build data" },
  { key: "repo", label: "Connecting to repository" },
  { key: "site", label: "Deploying site infrastructure" },
  { key: "encrypt", label: "Encrypting build" },
  { key: "upload", label: "Uploading to GitHub" },
  { key: "deploy", label: "Triggering Pages deploy" },
  { key: "pages", label: "Waiting for Pages to go live" },
];

// Ticker row height must match CSS --ticker-row-h (20px)
const TICKER_ROW_H = 20;

export function showPublishProgress() {
  _el.publishStatus.innerHTML = "";

  // Dismiss button
  const dismiss = document.createElement("button");
  dismiss.className = "publish-status__dismiss";
  dismiss.textContent = "\u00d7";
  dismiss.title = "Dismiss";
  dismiss.addEventListener("click", () => { _el.publishStatus.innerHTML = ""; });

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

  // Dev-only: show preview button immediately alongside the ticker
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
      resultSlot.append(localBtn);
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

  // Dev-only: preview button
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
      resultSlot.append(localBtn);
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
