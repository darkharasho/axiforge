import { state, createEmptyEditor } from "./state.js";
import { escapeHtml, formatDate, formatPagesStatus, makeButton, matchesBuildQuery, delay } from "./utils.js";
import { renderCustomSelect } from "./custom-select.js";
import { closeCustomSelect } from "./custom-select.js";
import { hideHoverPreview } from "./detail-panel.js";

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
// renderOnboarding
// ---------------------------------------------------------------------------
export function renderOnboarding() {
  const status = state.onboarding;
  _el.onboarding.innerHTML = "";
  if (!status) return;

  const target = getSelectedTarget();

  // Device code display — shown during active login flow regardless of auth state
  if (state.loginFlow.beginData) {
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

  // Pages poll status — shown during active Pages build poll
  if (state.pagesPoll.active) {
    const card = document.createElement("article");
    card.className = "status-card";
    const heading = document.createElement("h3");
    heading.innerHTML = `<span class="setup-step__spinner" style="vertical-align:middle;margin-right:8px"></span>Waiting For GitHub Pages`;
    const statusLine = document.createElement("p");
    statusLine.innerHTML = `Current status: <strong>${escapeHtml(formatPagesStatus(state.pagesPoll.status))}</strong>`;

    const steps = document.createElement("div");
    steps.className = "setup-steps";
    steps.style.marginTop = "8px";

    const pageSteps = [
      { key: "queued", label: "Queued for build" },
      { key: "building", label: "Building site" },
      { key: "deploying", label: "Deploying to Pages" },
      { key: "built", label: "Live" },
    ];
    const currentStatus = String(state.pagesPoll.status || "queued").toLowerCase();
    const statusOrder = ["queued", "building", "deploying", "built"];
    const currentIdx = statusOrder.indexOf(currentStatus);

    for (let i = 0; i < pageSteps.length; i++) {
      const step = pageSteps[i];
      const row = document.createElement("div");
      if (i < currentIdx) {
        row.className = "setup-step setup-step--done";
        row.innerHTML = `<span class="setup-step__icon">\u2713</span><span class="setup-step__label">${escapeHtml(step.label)}</span>`;
      } else if (i === currentIdx && currentStatus !== "built") {
        row.className = "setup-step setup-step--active";
        row.innerHTML = `<span class="setup-step__icon"><span class="setup-step__spinner"></span></span><span class="setup-step__label">${escapeHtml(step.label)}</span>`;
      } else if (currentStatus === "built" && step.key === "built") {
        row.className = "setup-step setup-step--done";
        row.innerHTML = `<span class="setup-step__icon">\u2713</span><span class="setup-step__label">${escapeHtml(step.label)}</span>`;
      } else {
        row.className = "setup-step setup-step--pending";
        row.innerHTML = `<span class="setup-step__icon">&#9679;</span><span class="setup-step__label">${escapeHtml(step.label)}</span>`;
      }
      steps.append(row);
    }

    card.append(heading, statusLine, steps);
    if (state.pagesPoll.error) {
      const errLine = document.createElement("p");
      errLine.className = "error-line";
      errLine.textContent = state.pagesPoll.error;
      card.append(errLine);
    }
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

  // Setup status steps container (hidden until setup starts)
  const stepsContainer = document.createElement("div");
  stepsContainer.className = "setup-steps";
  stepsContainer.style.display = "none";
  card.append(stepsContainer);

  if (target) {
    const setupReady = repoReady && pagesReady;
    const btn = makeButton(setupReady ? "Re-run Setup" : "Setup Publishing", setupReady ? "secondary" : "primary", async () => {
      try {
        btn.disabled = true;
        btn.style.display = "none";
        stepsContainer.style.display = "";

        const steps = [
          { label: "Creating repository", key: "repo" },
          { label: "Configuring GitHub Pages", key: "pages" },
          { label: "Deploying site files", key: "deploy" },
          { label: "Triggering first build", key: "trigger" },
          { label: "Waiting for Pages to go live", key: "poll" },
        ];

        const stepEls = {};
        for (const step of steps) {
          const row = document.createElement("div");
          row.className = "setup-step setup-step--pending";
          row.innerHTML = `<span class="setup-step__icon">&#9679;</span><span class="setup-step__label">${escapeHtml(step.label)}</span>`;
          stepsContainer.append(row);
          stepEls[step.key] = row;
        }

        const activate = (key) => {
          const el = stepEls[key];
          if (!el) return;
          el.className = "setup-step setup-step--active";
          el.querySelector(".setup-step__icon").innerHTML = `<span class="setup-step__spinner"></span>`;
        };
        const complete = (key) => {
          const el = stepEls[key];
          if (!el) return;
          el.className = "setup-step setup-step--done";
          el.querySelector(".setup-step__icon").textContent = "\u2713";
        };
        const fail = (key, msg) => {
          const el = stepEls[key];
          if (!el) return;
          el.className = "setup-step setup-step--error";
          el.querySelector(".setup-step__icon").textContent = "\u2717";
          if (msg) {
            const err = document.createElement("span");
            err.className = "setup-step__error";
            err.textContent = ` ${msg}`;
            el.append(err);
          }
        };

        // Run setup with animated steps
        let currentStep = "repo";
        try {
          activate("repo");
          await window.desktopApi.setupRepoPages(target.login, target.type);
          complete("repo");

          activate("pages");
          await delay(400);
          complete("pages");

          activate("deploy");
          await delay(400);
          complete("deploy");

          activate("trigger");
          await delay(300);
          complete("trigger");

          activate("poll");
          currentStep = "poll";
          await runPagesBuildPoll();
          complete("poll");

          await _callbacks.refreshOnboardingStatus();
          render();
        } catch (err) {
          fail(currentStep, err.message);
          btn.style.display = "";
          btn.disabled = false;
        }
      } catch (err) {
        showError(err);
        btn.style.display = "";
        btn.disabled = false;
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
    card.innerHTML = `
      <h3>${escapeHtml(build.title || "Untitled Build")}</h3>
      <p>${escapeHtml(build.profession || "Unknown Profession")} | ${escapeHtml((build.gameMode || "pve").toUpperCase())} | Updated ${escapeHtml(formatDate(build.updatedAt))}${escapeHtml(dirtySuffix)}</p>
    `;

    const actions = document.createElement("div");
    actions.className = "build-card__actions";

    const loadBtn = makeButton("Load", "secondary", async () => {
      if (!_callbacks.confirmDiscardDirty("Load a different build")) return;
      await _callbacks.loadBuildIntoEditor(build);
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
    card.append(actions);
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
      state.editor.profession = professionId;
      await _callbacks.setProfession(professionId, { preserveSelections: false });
      state.detail = null;
      _callbacks.markEditorChanged({ updateBuildList: true });
      renderEditor();
    },
  });

  _el.editorTitle.value = state.editor.title || "";
  _el.tagsInput.value = state.editor.tagsText || "";

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
  _el.saveBuildBtn.textContent = state.editorDirty ? "Save Build*" : "Save Build";
  if (state.editorDirty) {
    _el.editorDirtyBadge.classList.remove("hidden");
  } else {
    _el.editorDirtyBadge.classList.add("hidden");
  }

  const catalog = state.activeCatalog;
  const professionName =
    state.professions.find((entry) => entry.id === state.editor.profession)?.name ||
    state.editor.profession ||
    "Not selected";
  const specNames = (state.editor.specializations || [])
    .map((entry) => catalog?.specializationById.get(Number(entry.specializationId))?.name || "")
    .filter(Boolean);
  const eliteSpec = (state.editor.specializations || [])
    .map((entry) => catalog?.specializationById.get(Number(entry.specializationId)))
    .find((entry) => entry?.elite);
  const skillById = catalog?.skillById || new Map();
  const utilityNames = (state.editor.skills?.utilityIds || [])
    .map((id) => skillById.get(Number(id))?.name || "")
    .filter(Boolean);
  const skills = [
    skillById.get(Number(state.editor.skills?.healId))?.name || "",
    ...utilityNames,
    skillById.get(Number(state.editor.skills?.eliteId))?.name || "",
  ].filter(Boolean);
  const summaryRows = [
    { label: "Status", value: state.editorDirty ? "Unsaved draft" : "Saved" },
    { label: "Profession", value: professionName },
    { label: "Specializations", value: specNames.join(" | ") || "None selected" },
    { label: "Skills", value: skills.join(" | ") || "None selected" },
  ];
  if (eliteSpec) {
    summaryRows.push({ label: "Elite Line", value: eliteSpec.name });
  }
  _el.buildSummary.innerHTML = summaryRows
    .map(
      (row) =>
        `<div class="build-summary__row"><span class="build-summary__label">${escapeHtml(row.label)}</span><span class="build-summary__value">${escapeHtml(row.value)}</span></div>`
    )
    .join("");
}

// ---------------------------------------------------------------------------
// runPagesBuildPoll
// ---------------------------------------------------------------------------
export async function runPagesBuildPoll() {
  state.pagesPoll.active = true;
  state.pagesPoll.status = "queued";
  state.pagesPoll.error = null;
  renderOnboarding();

  try {
    for (let i = 0; i < 120; i += 1) {
      const poll = await window.desktopApi.pollPagesStatus();
      state.pagesPoll.status = poll.status || "unknown";
      state.pagesPoll.error = poll.error || null;
      renderOnboarding();

      if (poll.ready && poll.pagesUrl) return;
      if (poll.status === "errored" || poll.status === "error") {
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

export function showPublishProgress() {
  _el.publishStatus.innerHTML = "";

  // Dismiss button
  const dismiss = document.createElement("button");
  dismiss.className = "publish-status__dismiss";
  dismiss.textContent = "\u00d7";
  dismiss.title = "Dismiss";
  dismiss.addEventListener("click", () => { _el.publishStatus.innerHTML = ""; });
  _el.publishStatus.append(dismiss);

  const container = document.createElement("div");
  container.className = "publish-progress";

  for (const step of PUBLISH_STEPS) {
    const row = document.createElement("div");
    row.className = "setup-step setup-step--pending";
    row.dataset.publishStep = step.key;
    row.innerHTML = `<span class="setup-step__icon">&#9679;</span><span class="setup-step__label">${escapeHtml(step.label)}</span>`;
    container.append(row);
  }

  _el.publishStatus.append(container);
  return container;
}

export function advancePublishStep(stepKey) {
  const container = _el.publishStatus.querySelector(".publish-progress");
  if (!container) return;

  // Complete all previous steps
  const rows = container.querySelectorAll(".setup-step");
  let found = false;
  for (const row of rows) {
    if (row.dataset.publishStep === stepKey) {
      found = true;
      row.className = "setup-step setup-step--active";
      row.querySelector(".setup-step__icon").innerHTML = `<span class="setup-step__spinner"></span>`;
    } else if (!found) {
      // Mark previous steps as done
      if (row.classList.contains("setup-step--active") || row.classList.contains("setup-step--pending")) {
        row.className = "setup-step setup-step--done";
        row.querySelector(".setup-step__icon").textContent = "\u2713";
      }
    }
  }
}

export function completeAllPublishSteps() {
  const container = _el.publishStatus.querySelector(".publish-progress");
  if (!container) return;
  for (const row of container.querySelectorAll(".setup-step")) {
    row.className = "setup-step setup-step--done";
    row.querySelector(".setup-step__icon").textContent = "\u2713";
  }
}

export function failPublishStep(stepKey, message) {
  const container = _el.publishStatus.querySelector(".publish-progress");
  if (!container) return;
  for (const row of container.querySelectorAll(".setup-step")) {
    if (row.dataset.publishStep === stepKey) {
      row.className = "setup-step setup-step--error";
      row.querySelector(".setup-step__icon").textContent = "\u2717";
      if (message) {
        const err = document.createElement("span");
        err.className = "setup-step__error";
        err.textContent = ` ${message}`;
        row.append(err);
      }
      break;
    }
  }
}

export function showPublishResult(url) {
  const container = _el.publishStatus.querySelector(".publish-progress");
  if (!container) return;

  const result = document.createElement("div");
  result.className = "publish-result";
  result.innerHTML = `
    <div class="publish-result__header">Published successfully!</div>
    <div class="publish-result__url-row">
      <input type="text" class="publish-result__url" value="${escapeHtml(url)}" readonly />
      <button class="btn btn-secondary publish-result__copy">Copy URL</button>
    </div>
    <div class="publish-result__live-status">Waiting for page to go live...</div>
  `;

  const copyBtn = result.querySelector(".publish-result__copy");
  const urlInput = result.querySelector(".publish-result__url");
  const liveStatus = result.querySelector(".publish-result__live-status");

  copyBtn.addEventListener("click", async () => {
    await window.desktopApi.writeClipboardText(url);
    copyBtn.textContent = "Copied!";
    urlInput.select();
    setTimeout(() => { copyBtn.textContent = "Copy URL"; }, 2000);
  });

  urlInput.addEventListener("click", () => urlInput.select());

  container.append(result);

  // Poll until the page is actually reachable
  pollPageLive(url, liveStatus);
}

async function pollPageLive(url, statusEl) {
  let lastStatus = "deploying";
  for (let i = 0; i < 40; i++) {
    try {
      const poll = await window.desktopApi.pollPagesStatus();
      if (poll.ready) {
        completeAllPublishSteps();
        statusEl.innerHTML = `<span style="color:var(--accent)">&#10003; Page is live!</span>`;
        return;
      }
      lastStatus = poll.status || "deploying";
      const label = formatPagesStatus(lastStatus);
      statusEl.textContent = `${label}...`;
      if (poll.error) {
        statusEl.textContent = `${label} — ${poll.error}`;
      }
    } catch {
      statusEl.textContent = "Checking deploy status...";
    }
    await delay(4000);
  }
  completeAllPublishSteps();
  statusEl.innerHTML = `Pages deploy in progress. <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" style="color:var(--accent-2)">Check link</a>`;
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
