// Settings Modal — App-wide settings dialog.
// Singleton overlay, follows the confirm-modal pattern.

import { state } from "./state.js";
import { renderCustomSelect } from "./custom-select.js";
import { escapeHtml, delay } from "./utils.js";
import { showConfirmModal } from "./confirm-modal.js";

let _overlay = null;
let _el = {};
let _escHandler = null;
let _callbacks = {};

// Webhook lists are managed identically for comps and builds.
let _webhooks = { comp: [], build: [] };
let _debouncedSaveWebhooks = { comp: () => {}, build: () => {} };

const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//;

const WEBHOOK_KINDS = {
  comp:  { setting: "discord.compWebhooks",  empty: "No webhooks yet. Add one to share comps to Discord." },
  build: { setting: "discord.buildWebhooks", empty: "No webhooks yet. Add one to share builds to Discord." },
};

const THEMES = [
  { id: "",                label: "Golden Amber",     type: "full",   warm: true,  swatches: ["#c89848", "#64aaf0"] },
  { id: "molten-core",     label: "Molten Core",      type: "full",   warm: true,  swatches: ["#dc6930", "#e8a538"] },
  { id: "cinderfall",      label: "Cinderfall",       type: "full",   warm: true,  swatches: ["#c85050", "#d89060"] },
  { id: "frostforge",      label: "Frostforge",       type: "full",   warm: false, swatches: ["#64afe6", "#9bd2f0"] },
  { id: "verdant-crucible", label: "Verdant Crucible", type: "full",   warm: false, swatches: ["#4bbe78", "#3ca5b4"] },
  { id: "copper",          label: "Copper Alloy",     type: "accent", warm: true,  swatches: ["#d28c60", "#64aaf0"] },
  { id: "rose-gold",       label: "Rose Gold",        type: "accent", warm: true,  swatches: ["#c8738c", "#64aaf0"] },
  { id: "cobalt",          label: "Cobalt Steel",     type: "accent", warm: false, swatches: ["#5888c8", "#82b4f0"] },
  { id: "mithril",         label: "Mithril",          type: "accent", warm: false, swatches: ["#aab4c8", "#8cbee6"] },
];

const SETUP_STEPS = [
  { key: "repo", label: "Creating repository" },
  { key: "pages", label: "Configuring GitHub Pages" },
  { key: "deploy", label: "Deploying site files" },
  { key: "trigger", label: "Triggering first build" },
  { key: "poll", label: "Waiting for Pages to go live" },
];

const ICON = {
  gear:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  appearance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><path d="M17.5 10.5 21 3"/><path d="M3 21l5.5-5.5"/><circle cx="8" cy="16" r="3"/><path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4z"/></svg>`,
  discord:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  publishing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`,
  shared:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  data:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  close:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg>`,
};

const CATEGORIES = [
  { id: "appearance",     label: "Appearance",     desc: "Theme and build-page appearance.",                       icon: ICON.appearance },
  { id: "discord",        label: "Discord",        desc: "Post comps and builds to Discord channels via webhooks.", icon: ICON.discord },
  { id: "publishing",     label: "Publishing",     desc: "Publish your builds to a public web page.",              icon: ICON.publishing },
  { id: "teams",          label: "Teams",          desc: "Share build libraries with your team.",                  icon: ICON.shared },
  { id: "data",           label: "Data & Cache",   desc: "Manage cached GW2 API data.",                            icon: ICON.data },
];

export function initSettingsCallbacks(callbacks) {
  _callbacks = callbacks;
}

export function initSettingsModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "settings-modal-overlay settings-modal-overlay--hidden";
  const navHtml = CATEGORIES.map((c, i) =>
    `<button type="button" class="settings-modal__nav-item${i === 0 ? " settings-modal__nav-item--active" : ""}" data-pane="${c.id}">${c.icon}<span>${c.label}</span></button>`
  ).join("");

  _overlay.innerHTML = `
    <div class="settings-modal">
      <aside class="settings-modal__sidebar">
        <div class="settings-modal__brand">${ICON.gear}<span>Settings</span></div>
        <nav class="settings-modal__nav" id="sm-nav">${navHtml}</nav>
      </aside>
      <div class="settings-modal__main">
        <div class="settings-modal__main-header">
          <h3 class="settings-modal__pane-title" id="sm-pane-title">${CATEGORIES[0].label}</h3>
          <p class="settings-modal__pane-desc" id="sm-pane-desc">${CATEGORIES[0].desc}</p>
          <button class="settings-modal__close" id="sm-close">${ICON.close}</button>
        </div>
        <div class="settings-modal__body">
          <section class="settings-modal__pane settings-modal__pane--active" data-pane="appearance" id="sm-appearance-section">
            <div class="settings-modal__theme-grid" id="sm-theme-grid"></div>
            <label class="settings-modal__toggle" id="sm-themed-builds-toggle">
              <input type="checkbox" class="settings-modal__toggle-input" id="sm-themed-builds">
              <span class="settings-modal__toggle-switch"></span>
              <span class="settings-modal__toggle-text">Themed build pages</span>
            </label>
          </section>
          <section class="settings-modal__pane" data-pane="discord">
            <div class="settings-modal__subsection">
              <label class="settings-modal__sublabel">Comp Webhooks</label>
              <div id="sm-comp-webhooks"></div>
              <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-add-comp-webhook" type="button">+ Add Webhook</button>
            </div>
            <div class="settings-modal__subsection">
              <label class="settings-modal__sublabel">Build Webhooks</label>
              <div id="sm-build-webhooks"></div>
              <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-add-build-webhook" type="button">+ Add Webhook</button>
            </div>
          </section>
          <section class="settings-modal__pane" data-pane="publishing" id="sm-publishing-section">
            <label class="settings-modal__label">Repository owner</label>
            <div id="sm-target-picker"></div>
            <div id="sm-setup-row" class="settings-modal__setup-row"></div>
          </section>
          <section class="settings-modal__pane" data-pane="teams" id="sm-teams-section">
            <span class="settings-modal__error" id="sm-teams-status" aria-live="polite"></span>
            <div id="sm-teams-migrate" hidden></div>
            <div id="sm-teams-off">
              <p class="settings-modal__hint">Teams let a group share build folders. Changes sync in seconds; everyone in the team can edit. Uses your GitHub sign-in.</p>
              <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-teams-enable" type="button">Enable team sync</button>
            </div>
            <div id="sm-teams-on" hidden>
              <div class="settings-modal__shared-info"><span>Signed in as</span> <span class="settings-modal__shared-org" id="sm-teams-user"></span></div>
              <div class="sm-teams-forms">
                <div class="sm-teams-form">
                  <label class="settings-modal__label" for="sm-team-create-name">Create a team</label>
                  <div class="sm-teams-row">
                    <input class="settings-modal__input" id="sm-team-create-name" maxlength="80" placeholder="Team name">
                    <button class="settings-modal__btn" id="sm-team-create" type="button">Create</button>
                  </div>
                </div>
                <div class="sm-teams-form">
                  <label class="settings-modal__label" for="sm-team-join-code">Join with an invite code</label>
                  <div class="sm-teams-row">
                    <input class="settings-modal__input" id="sm-team-join-code" maxlength="10" placeholder="ABCDEFGHJK" autocapitalize="characters">
                    <button class="settings-modal__btn" id="sm-team-join" type="button">Join</button>
                  </div>
                </div>
              </div>
              <div id="sm-teams-list" class="sm-teams-list"></div>
              <button class="settings-modal__btn settings-modal__btn--danger" id="sm-teams-signout" type="button">Sign out of team sync</button>
            </div>
          </section>
          <section class="settings-modal__pane" data-pane="data">
            <p class="settings-modal__hint">GW2 API responses are cached for 24 hours to speed up launch times.</p>
            <div class="settings-modal__cache-row">
              <button class="settings-modal__btn" id="sm-clear-cache" type="button">Clear API Cache</button>
              <span class="settings-modal__cache-status" id="sm-cache-status"></span>
            </div>
          </section>
        </div>
        <div class="settings-modal__actions">
          <span class="settings-modal__save-status" id="sm-save-status"></span>
          <div class="settings-modal__action-buttons">
            <button class="settings-modal__btn" id="sm-cancel" type="button">Close</button>
            <button class="settings-modal__btn settings-modal__btn--save" id="sm-done" type="button">Done</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _el = {
    close:          document.getElementById("sm-close"),
    themeGrid:      document.getElementById("sm-theme-grid"),
    targetPicker:   document.getElementById("sm-target-picker"),
    setupRow:       document.getElementById("sm-setup-row"),
    publishSection: document.getElementById("sm-publishing-section"),
    compWebhooks:      document.getElementById("sm-comp-webhooks"),
    addCompWebhook:    document.getElementById("sm-add-comp-webhook"),
    buildWebhooks:     document.getElementById("sm-build-webhooks"),
    addBuildWebhook:   document.getElementById("sm-add-build-webhook"),
    saveStatus:        document.getElementById("sm-save-status"),
    clearCache:        document.getElementById("sm-clear-cache"),
    cacheStatus:       document.getElementById("sm-cache-status"),
    teamsStatus:       document.getElementById("sm-teams-status"),
    teamsOff:          document.getElementById("sm-teams-off"),
    teamsEnable:       document.getElementById("sm-teams-enable"),
    teamsOn:           document.getElementById("sm-teams-on"),
    teamsUser:         document.getElementById("sm-teams-user"),
    teamCreateName:    document.getElementById("sm-team-create-name"),
    teamCreate:        document.getElementById("sm-team-create"),
    teamJoinCode:      document.getElementById("sm-team-join-code"),
    teamJoin:          document.getElementById("sm-team-join"),
    teamsList:         document.getElementById("sm-teams-list"),
    teamsSignout:      document.getElementById("sm-teams-signout"),
    teamsMigrate:      document.getElementById("sm-teams-migrate"),
  };
  _el.themedBuilds = _overlay.querySelector("#sm-themed-builds");

  _debouncedSaveWebhooks.comp  = _debounce(() => _saveWebhooks("comp"), 600);
  _debouncedSaveWebhooks.build = _debounce(() => _saveWebhooks("build"), 600);

  _el.addCompWebhook.addEventListener("click", () => _addWebhook("comp"));
  _el.addBuildWebhook.addEventListener("click", () => _addWebhook("build"));

  _el.close.addEventListener("click", _close);
  document.getElementById("sm-cancel").addEventListener("click", _close);
  document.getElementById("sm-done").addEventListener("click", _close);
  _el.clearCache.addEventListener("click", _clearCache);
  _el.teamsEnable.addEventListener("click", _enableTeams);
  _el.teamCreate.addEventListener("click", _createTeam);
  _el.teamJoin.addEventListener("click", _joinTeam);
  _el.teamsSignout.addEventListener("click", _signOutTeams);
  _el.teamsList.addEventListener("click", _onTeamsListClick);

  _overlay.querySelector("#sm-nav").addEventListener("click", (e) => {
    const item = e.target.closest(".settings-modal__nav-item");
    if (item) _switchPane(item.dataset.pane);
  });

  // Toggle themed build pages
  _el.themedBuilds.addEventListener("change", async () => {
    const enabled = _el.themedBuilds.checked;
    await window.desktopApi.setSetting("appearance.themedBuildPages", enabled);
    if (_callbacks.onThemedBuildsToggle) _callbacks.onThemedBuildsToggle(enabled);
  });
}

// Filled in by Task 6 (legacy GitHub-org library migration prompt).
let _renderLegacyMigration = async () => {};

function _switchPane(id) {
  const cat = CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
  for (const item of _overlay.querySelectorAll(".settings-modal__nav-item")) {
    item.classList.toggle("settings-modal__nav-item--active", item.dataset.pane === cat.id);
  }
  for (const pane of _overlay.querySelectorAll(".settings-modal__pane")) {
    pane.classList.toggle("settings-modal__pane--active", pane.dataset.pane === cat.id);
  }
  const title = document.getElementById("sm-pane-title");
  const desc = document.getElementById("sm-pane-desc");
  if (title) title.textContent = cat.label;
  if (desc) desc.textContent = cat.desc;
}

export async function openSettingsModal({ initialPane } = {}) {
  if (!_overlay) return;

  // Load current values
  const [compWebhooks, buildWebhooks, themedBuilds] = await Promise.all([
    window.desktopApi.getSetting("discord.compWebhooks"),
    _loadBuildWebhooks(),
    window.desktopApi.getSetting("appearance.themedBuildPages"),
  ]);

  // Comp webhooks
  _webhooks.comp = Array.isArray(compWebhooks) ? compWebhooks.map((w) => ({ ...w })) : [];
  _renderWebhooks("comp");

  // Build webhooks (migrates the legacy single build webhook the first time)
  _webhooks.build = buildWebhooks;
  _renderWebhooks("build");

  // Themed build pages toggle
  _el.themedBuilds.checked = !!themedBuilds;

  _el.saveStatus.textContent = "";
  _el.saveStatus.className = "settings-modal__save-status";

  // Populate appearance section
  _renderThemeGrid();

  // Populate publishing section
  _renderPublishing();

  // Populate Teams section
  _loadTeamsState();

  _overlay.classList.remove("settings-modal-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _close(); };
  document.addEventListener("keydown", _escHandler);

  if (initialPane) _switchPane(initialPane);
}

// ─── Theme grid ─────────────────────────────────────────────────────────────

async function _renderThemeGrid() {
  const grid = _el.themeGrid;
  grid.innerHTML = "";
  const domTheme = document.documentElement.getAttribute("data-theme") || "";
  const current = domTheme.startsWith("prof-")
    ? (await window.desktopApi.getSetting("appearance.theme")) || ""
    : domTheme;

  for (const theme of THEMES) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `settings-modal__theme-card${theme.id === current ? " settings-modal__theme-card--active" : ""}`;
    card.dataset.theme = theme.id;

    const swatchRow = theme.swatches
      .map((c) => `<span class="settings-modal__theme-swatch" style="background:${c}"></span>`)
      .join("");

    card.innerHTML = `
      <div class="settings-modal__theme-swatches">${swatchRow}</div>
      <span class="settings-modal__theme-label">${escapeHtml(theme.label)}</span>
      <span class="settings-modal__theme-tag">${theme.type === "full" ? "Full" : "Accent"}</span>
    `;

    card.addEventListener("click", () => _applyTheme(theme.id));
    grid.append(card);
  }
}

async function _applyTheme(themeId) {
  const current = document.documentElement.getAttribute("data-theme") || "";
  const profThemeActive = current.startsWith("prof-");
  if (!profThemeActive) {
    if (themeId) {
      document.documentElement.setAttribute("data-theme", themeId);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }
  await window.desktopApi.setSetting("appearance.theme", themeId || null);
  if (_callbacks.onThemeChange) _callbacks.onThemeChange(themeId || "");
  _renderThemeGrid();
}

// ─── Publishing section ─────────────────────────────────────────────────────

let _setupInProgress = false;

function _renderPublishing() {
  const status = state.onboarding;
  const isAuth = status?.isAuthenticated;

  // Target picker
  _el.targetPicker.innerHTML = "";
  if (isAuth && state.targets.length) {
    renderCustomSelect(_el.targetPicker, {
      value: state.selectedTarget?.login || state.targets[0]?.login || "",
      className: "cselect--target",
      options: state.targets.map((t) => ({
        value: t.login,
        label: t.login,
        meta: String(t.type || "").toUpperCase(),
        iconText: t.type === "org" ? "O" : "U",
      })),
      placeholder: "Select owner",
      onChange: (login) => {
        state.selectedTarget = state.targets.find((t) => t.login === String(login)) || null;
        _renderSetupRow();
      },
    });
  } else {
    const hint = document.createElement("p");
    hint.className = "settings-modal__hint";
    hint.textContent = isAuth ? "No targets available." : "Sign in to configure publishing.";
    _el.targetPicker.append(hint);
  }

  _renderSetupRow();
}

function _getSelectedTarget() {
  if (!state.targets.length) return null;
  return state.selectedTarget || state.targets[0];
}

function _renderSetupRow() {
  if (_setupInProgress) return;
  const row = _el.setupRow;
  row.innerHTML = "";

  const status = state.onboarding;
  if (!status?.isAuthenticated) return;

  const target = _getSelectedTarget();
  const repoReady = status.repoReady;
  const pagesReady = status.pagesReady;

  // Status badges
  const badges = document.createElement("div");
  badges.className = "settings-modal__status-badges";

  if (target) {
    const repoBadge = document.createElement("span");
    repoBadge.className = `settings-modal__badge ${repoReady ? "settings-modal__badge--ok" : "settings-modal__badge--pending"}`;
    repoBadge.textContent = repoReady ? "Repository ready" : "Repository not set up";
    badges.append(repoBadge);

    const pagesBadge = document.createElement("span");
    pagesBadge.className = `settings-modal__badge ${pagesReady ? "settings-modal__badge--ok" : "settings-modal__badge--pending"}`;
    pagesBadge.textContent = pagesReady ? "Pages live" : "Pages not deployed";
    badges.append(pagesBadge);
  }
  row.append(badges);

  if (!target) return;

  const setupReady = repoReady && pagesReady;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `settings-modal__btn ${setupReady ? "" : "settings-modal__btn--save"}`;
  btn.textContent = setupReady ? "Re-run Setup" : "Setup Publishing";
  btn.addEventListener("click", () => _runSetup(btn, target));
  row.append(btn);
}

async function _runSetup(btn, target) {
  _setupInProgress = true;
  btn.style.display = "none";

  const tickerCtrl = _createTicker(SETUP_STEPS);
  _el.setupRow.append(tickerCtrl.el);

  const triggeredAt = Date.now();
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
    await _runPagesBuildPoll(triggeredAt);

    tickerCtrl.complete();
    await delay(600);

    _setupInProgress = false;
    if (_callbacks.refreshOnboardingStatus) await _callbacks.refreshOnboardingStatus();
    if (_callbacks.render) _callbacks.render();
    _renderPublishing();
  } catch (err) {
    tickerCtrl.fail(currentStep, err.message);
    _setupInProgress = false;
    btn.style.display = "";
  }
}

async function _runPagesBuildPoll(triggeredAfter) {
  for (let i = 0; i < 120; i += 1) {
    const poll = await window.desktopApi.pollPagesStatus();
    const buildTime = poll.updatedAt ? new Date(poll.updatedAt).getTime() : 0;
    const isStale = triggeredAfter && poll.ready && buildTime < triggeredAfter;
    if (poll.ready && !isStale && poll.pagesUrl) return;
    if (!isStale && (poll.status === "errored" || poll.status === "error")) {
      throw new Error(poll.error || "GitHub Pages build failed.");
    }
    await delay(3000);
  }
  throw new Error("Timed out waiting for GitHub Pages to finish building.");
}

// ─── Ticker (mini copy for setup flow inside modal) ──────────────────────

function _createTicker(steps) {
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
      const r = rows[i];
      r.classList.remove("publish-ticker__row--pending", "publish-ticker__row--active", "publish-ticker__row--done", "publish-ticker__row--error");
      if (i < idx) {
        r.classList.add("publish-ticker__row--done");
        r.querySelector(".publish-ticker__icon").textContent = "\u2713";
      } else if (i === idx) {
        r.classList.add("publish-ticker__row--active");
        r.querySelector(".publish-ticker__icon").innerHTML = `<span class="publish-ticker__spinner"></span>`;
      } else {
        r.classList.add("publish-ticker__row--pending");
        r.querySelector(".publish-ticker__icon").textContent = "\u2022";
      }
    }
    if (!animate) strip.style.transition = "none";
    strip.style.transform = `translateY(${-idx * ROW_H}px)`;
    if (!animate) requestAnimationFrame(() => { strip.style.transition = ""; });
  };

  return {
    el: ticker,
    advance: (key) => _advance(key, true),
    complete: () => {
      const rows = strip.querySelectorAll("[data-ticker-step]");
      for (const r of rows) {
        r.classList.remove("publish-ticker__row--pending", "publish-ticker__row--active");
        r.classList.add("publish-ticker__row--done");
        r.querySelector(".publish-ticker__icon").textContent = "\u2713";
      }
      strip.style.transform = `translateY(${-(rows.length - 1) * ROW_H}px)`;
    },
    fail: (stepKey, message) => {
      for (const r of strip.querySelectorAll("[data-ticker-step]")) {
        if (r.dataset.tickerStep === stepKey) {
          r.classList.remove("publish-ticker__row--active", "publish-ticker__row--pending");
          r.classList.add("publish-ticker__row--error");
          r.querySelector(".publish-ticker__icon").textContent = "\u2717";
          if (message) {
            const err = document.createElement("span");
            err.className = "publish-ticker__error";
            err.textContent = ` \u2014 ${message}`;
            r.append(err);
          }
          break;
        }
      }
    },
  };
}

// ─── Clear API cache ────────────────────────────────────────────────────────

async function _clearCache() {
  _el.clearCache.disabled = true;
  _el.cacheStatus.textContent = "";
  try {
    await window.desktopApi.clearGw2Cache();
    _el.cacheStatus.textContent = "\u2713 Cache cleared";
    _el.cacheStatus.className = "settings-modal__cache-status settings-modal__cache-status--ok";
  } catch {
    _el.cacheStatus.textContent = "Failed to clear cache";
    _el.cacheStatus.className = "settings-modal__cache-status settings-modal__cache-status--error";
  }
  _el.clearCache.disabled = false;
}

// ─── Discord settings save ───────────────────────────────────────────────────

function _debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function _showSaved() {
  _el.saveStatus.textContent = "\u2713 Saved";
  _el.saveStatus.className = "settings-modal__save-status settings-modal__save-status--ok";
  setTimeout(() => {
    if (_el.saveStatus.textContent === "\u2713 Saved") {
      _el.saveStatus.textContent = "";
      _el.saveStatus.className = "settings-modal__save-status";
    }
  }, 2000);
}

function _newWebhookId() {
  return "wh-" + Math.abs(Date.now() ^ (Math.floor(Math.random() * 1e9))).toString(36);
}

// Loads the build webhook list, migrating the legacy single build webhook
// (discord.buildWebhookUrl + thread settings) into a one-entry list so an
// existing config still shows up the first time Settings is opened.
async function _loadBuildWebhooks() {
  const existing = await window.desktopApi.getSetting("discord.buildWebhooks");
  if (Array.isArray(existing)) return existing.map((w) => ({ ...w }));

  const url = await window.desktopApi.getSetting("discord.buildWebhookUrl");
  if (url && WEBHOOK_RE.test(url)) {
    const [mode, threadId] = await Promise.all([
      window.desktopApi.getSetting("discord.buildThreadMode"),
      window.desktopApi.getSetting("discord.buildThreadId"),
    ]);
    const m = mode || "none";
    return [{ id: _newWebhookId(), name: "Default", url, threadMode: m, threadId: m === "custom" && threadId ? threadId : null }];
  }
  return [];
}

function _addWebhook(kind) {
  _webhooks[kind].push({ id: _newWebhookId(), name: "", url: "", threadMode: "none", threadId: null });
  _renderWebhooks(kind);
  _saveWebhooks(kind);
}

function _renderWebhooks(kind) {
  const c = kind === "comp" ? _el.compWebhooks : _el.buildWebhooks;
  const list = _webhooks[kind];
  const debSave = _debouncedSaveWebhooks[kind];
  if (!list.length) {
    c.innerHTML = `<p class="settings-modal__hint">${WEBHOOK_KINDS[kind].empty}</p>`;
    return;
  }
  c.innerHTML = list.map((w) => {
    const mode = w.threadMode || "none";
    const hidden = mode === "custom" ? "" : " settings-modal__thread-id-input--hidden";
    const checked = (m) => (mode === m ? " checked" : "");
    return `
      <div class="settings-modal__webhook-row" data-id="${escapeHtml(w.id)}">
        <div class="settings-modal__webhook-head">
          <input type="text" class="settings-modal__input settings-modal__webhook-name" data-field="name" placeholder="Name (e.g. WvW Guild)" value="${escapeHtml(w.name || "")}" autocomplete="off" spellcheck="false">
          <button class="settings-modal__btn settings-modal__btn--danger settings-modal__webhook-remove" type="button" title="Remove">✕</button>
        </div>
        <input type="text" class="settings-modal__input" data-field="url" placeholder="https://discord.com/api/webhooks/..." value="${escapeHtml(w.url || "")}" autocomplete="off" spellcheck="false">
        <span class="settings-modal__error" data-field="url-error"></span>
        <div class="settings-modal__thread-inline" data-field="thread-mode">
          <label class="settings-modal__pill"><input type="radio" name="wh-mode-${escapeHtml(w.id)}" value="none"${checked("none")}><span>Channel</span></label>
          <label class="settings-modal__pill"><input type="radio" name="wh-mode-${escapeHtml(w.id)}" value="auto"${checked("auto")}><span>New Post</span></label>
          <label class="settings-modal__pill"><input type="radio" name="wh-mode-${escapeHtml(w.id)}" value="custom"${checked("custom")}><span>Thread ID</span></label>
          <input type="text" class="settings-modal__input settings-modal__thread-id-input${hidden}" data-field="thread-id" placeholder="Thread ID" value="${escapeHtml(w.threadId || "")}" autocomplete="off" spellcheck="false">
        </div>
        <span class="settings-modal__error" data-field="thread-error"></span>
      </div>`;
  }).join("");

  // Wire each row
  c.querySelectorAll(".settings-modal__webhook-row").forEach((row) => {
    const id = row.getAttribute("data-id");
    row.querySelector("[data-field='name']").addEventListener("input", debSave);
    row.querySelector("[data-field='url']").addEventListener("input", debSave);
    row.querySelector("[data-field='thread-id']").addEventListener("input", debSave);
    row.querySelector("[data-field='thread-mode']").addEventListener("change", (e) => {
      const tid = row.querySelector("[data-field='thread-id']");
      tid.classList.toggle("settings-modal__thread-id-input--hidden", e.target.value !== "custom");
      _saveWebhooks(kind);
    });
    row.querySelector(".settings-modal__webhook-remove").addEventListener("click", () => {
      _webhooks[kind] = _webhooks[kind].filter((w) => w.id !== id);
      _renderWebhooks(kind);
      _saveWebhooks(kind);
    });
  });
}

// Reads the current DOM rows for the given kind, validates, and persists the array.
async function _saveWebhooks(kind) {
  const c = kind === "comp" ? _el.compWebhooks : _el.buildWebhooks;
  const rows = Array.from(c.querySelectorAll(".settings-modal__webhook-row"));
  const next = [];
  for (const row of rows) {
    const id = row.getAttribute("data-id");
    const name = row.querySelector("[data-field='name']").value.trim();
    const url = row.querySelector("[data-field='url']").value.trim();
    const mode = row.querySelector("[data-field='thread-mode'] input:checked")?.value || "none";
    const threadId = row.querySelector("[data-field='thread-id']").value.trim();
    const urlErr = row.querySelector("[data-field='url-error']");
    const threadErr = row.querySelector("[data-field='thread-error']");
    urlErr.textContent = "";
    threadErr.textContent = "";

    if (url && !WEBHOOK_RE.test(url)) { urlErr.textContent = "Must be a Discord webhook URL"; return; }
    if (mode === "custom" && !threadId) { threadErr.textContent = "Thread ID is required"; return; }
    if (mode === "custom" && !/^\d+$/.test(threadId)) { threadErr.textContent = "Must be a numeric Discord ID"; return; }

    next.push({ id, name, url, threadMode: mode, threadId: mode === "custom" ? threadId : null });
  }
  _webhooks[kind] = next;
  try {
    await window.desktopApi.setSetting(WEBHOOK_KINDS[kind].setting, next);
    _showSaved();
  } catch {
    _el.saveStatus.textContent = "Save failed — please try again";
    _el.saveStatus.className = "settings-modal__save-status settings-modal__save-status--error";
  }
}

function _close() {
  if (!_overlay) return;
  _overlay.classList.add("settings-modal-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}

// ─── Teams section ───────────────────────────────────────────────────────────

function _setTeamsStatus(text, isError = false) {
  _el.teamsStatus.textContent = text || "";
  _el.teamsStatus.classList.toggle("settings-modal__error--ok", !isError && !!text);
}

async function _loadTeamsState() {
  if (!_el.teamsOff) return;
  _setTeamsStatus("");
  const session = await window.desktopApi.getTeamSession().catch(() => null);
  _el.teamsOff.hidden = !!session;
  _el.teamsOn.hidden = !session;
  if (!session) {
    const gh = await window.desktopApi.getSession().catch(() => null);
    _el.teamsEnable.disabled = !gh;
    if (!gh) _setTeamsStatus("Log in to GitHub (Publishing) first — team sync uses that sign-in.", true);
    return;
  }
  _el.teamsUser.textContent = session.login;
  await _renderTeamsList();
  _renderLegacyMigration?.(); // Task 6
}

async function _renderTeamsList() {
  const teams = await window.desktopApi.listTeams().catch((err) => { _setTeamsStatus(`Error: ${err.message}`, true); return []; });
  _el.teamsList.innerHTML = teams.length ? teams.map(({ team, role }) => `
    <div class="sm-team" data-team-id="${escapeHtml(team.id)}" data-role="${role}">
      <div class="sm-team__head">
        <span class="sm-team__name">${escapeHtml(team.name)}</span>
        <span class="sm-team__role">${role}</span>
        ${role === "owner" ? `<code class="sm-team__invite" title="Invite code">${escapeHtml(team.inviteCode || "")}</code>
          <button class="settings-modal__btn settings-modal__btn--small" data-act="copy-invite" type="button">Copy</button>
          <button class="settings-modal__btn settings-modal__btn--small" data-act="rotate" type="button" title="Invalidate the old code">Rotate</button>` : ""}
        <button class="settings-modal__btn settings-modal__btn--small" data-act="members" type="button">Members</button>
        ${role === "owner" ? `<button class="settings-modal__btn settings-modal__btn--small" data-act="rename" type="button">Rename</button>
          <button class="settings-modal__btn settings-modal__btn--small settings-modal__btn--danger" data-act="delete" type="button">Delete team</button>`
        : `<button class="settings-modal__btn settings-modal__btn--small settings-modal__btn--danger" data-act="leave" type="button">Leave</button>`}
      </div>
      <div class="sm-team__members" hidden></div>
    </div>`).join("") : `<p class="settings-modal__hint">You're not in any team yet. Create one and share the invite code, or paste a code to join.</p>`;
}

async function _onTeamsListClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const row = btn.closest(".sm-team");
  const teamId = row?.dataset.teamId;
  const memberRow = btn.closest(".sm-team__member");
  const act = btn.dataset.act;
  try {
    if (act === "copy-invite") {
      await window.desktopApi.writeClipboardText(row.querySelector(".sm-team__invite").textContent);
      _setTeamsStatus("Invite code copied.");
    } else if (act === "rotate") {
      if (!(await showConfirmModal({ title: "Rotate invite code?", body: "The old code stops working immediately. Anyone already in the team stays.", confirmLabel: "Rotate", cancelLabel: "Cancel" }))) return;
      const { inviteCode } = await window.desktopApi.rotateInvite(teamId);
      row.querySelector(".sm-team__invite").textContent = inviteCode;
      _setTeamsStatus("New invite code generated.");
    } else if (act === "members") {
      const box = row.querySelector(".sm-team__members");
      if (!box.hidden) { box.hidden = true; return; }
      const members = await window.desktopApi.listTeamMembers(teamId);
      const isOwner = row.dataset.role === "owner";
      box.innerHTML = members.map((m) => `
        <div class="sm-team__member" data-user-id="${escapeHtml(m.userId)}">
          <span>${escapeHtml(m.login)}</span><span class="sm-team__role">${m.role}</span>
          ${isOwner && m.role !== "owner" ? `<button class="settings-modal__btn settings-modal__btn--small settings-modal__btn--danger" data-act="remove" type="button">Remove</button>` : ""}
        </div>`).join("");
      box.hidden = false;
    } else if (act === "remove") {
      const userId = memberRow.dataset.userId;
      const login = memberRow.querySelector("span").textContent;
      if (!(await showConfirmModal({ title: `Remove ${login}?`, body: "They keep their local copies but stop receiving updates.", confirmLabel: "Remove", cancelLabel: "Cancel" }))) return;
      await window.desktopApi.removeTeamMember(teamId, userId);
      memberRow.remove();
    } else if (act === "rename") {
      const name = window.prompt("New team name", row.querySelector(".sm-team__name").textContent);
      if (!name?.trim()) return;
      await window.desktopApi.renameTeam(teamId, name.trim());
      await _renderTeamsList();
      await _callbacks.refreshLibraryState?.();
    } else if (act === "delete") {
      if (!(await showConfirmModal({ title: "Delete this team?", body: "Every member loses the shared folder. Everyone's local copies are kept as personal folders.", confirmLabel: "Delete team", cancelLabel: "Cancel" }))) return;
      await window.desktopApi.deleteTeam(teamId);
      await _renderTeamsList();
      await _callbacks.refreshLibraryState?.();
    } else if (act === "leave") {
      if (!(await showConfirmModal({ title: "Leave this team?", body: "Your local copy of the folder is kept as a personal folder.", confirmLabel: "Leave", cancelLabel: "Cancel" }))) return;
      await window.desktopApi.leaveTeam(teamId);
      await _renderTeamsList();
      await _callbacks.refreshLibraryState?.();
    }
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  }
}

async function _enableTeams() {
  _el.teamsEnable.disabled = true;
  _el.teamsEnable.textContent = "Enabling…";
  try {
    await window.desktopApi.enableTeamSync();
    _callbacks.onTeamSyncEnabled?.();
    await _callbacks.refreshLibraryState?.();
    await _loadTeamsState();
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  } finally {
    _el.teamsEnable.disabled = false;
    _el.teamsEnable.textContent = "Enable team sync";
  }
}

async function _createTeam() {
  const name = _el.teamCreateName.value.trim();
  if (!name) { _setTeamsStatus("Enter a team name.", true); return; }
  _el.teamCreate.disabled = true;
  try {
    const { team } = await window.desktopApi.createTeam(name);
    await window.desktopApi.writeClipboardText(team.inviteCode);
    _setTeamsStatus(`Team "${team.name}" created. Invite code ${team.inviteCode} copied — share it with your team.`);
    _el.teamCreateName.value = "";
    await _renderTeamsList();
    await _callbacks.refreshLibraryState?.();
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  } finally {
    _el.teamCreate.disabled = false;
  }
}

async function _joinTeam() {
  const code = _el.teamJoinCode.value.trim().toUpperCase();
  if (code.length !== 10) { _setTeamsStatus("Invite codes are 10 characters.", true); return; }
  _el.teamJoin.disabled = true;
  try {
    const { team } = await window.desktopApi.joinTeam(code);
    _setTeamsStatus(`Joined "${team.name}". Its folder is in your library.`);
    _el.teamJoinCode.value = "";
    await _renderTeamsList();
    await _callbacks.refreshLibraryState?.();
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  } finally {
    _el.teamJoin.disabled = false;
  }
}

async function _signOutTeams() {
  if (!(await showConfirmModal({ title: "Sign out of team sync?", body: "Team folders stay on this computer but stop syncing until you sign in again.", confirmLabel: "Sign out", cancelLabel: "Cancel" }))) return;
  try {
    await window.desktopApi.disableTeamSync();
    await _callbacks.refreshLibraryState?.();
    await _loadTeamsState();
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  }
}
