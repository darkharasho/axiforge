// Settings Modal — App-wide settings dialog.
// Singleton overlay, follows the confirm-modal pattern.

import { state } from "./state.js";
import { renderCustomSelect } from "./custom-select.js";
import { escapeHtml, delay } from "./utils.js";

let _overlay = null;
let _el = {};
let _escHandler = null;
let _callbacks = {};

const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//;

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

export function initSettingsCallbacks(callbacks) {
  _callbacks = callbacks;
}

export function initSettingsModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "settings-modal-overlay settings-modal-overlay--hidden";
  _overlay.innerHTML = `
    <div class="settings-modal">
      <div class="settings-modal__header">
        <h3 class="settings-modal__title">
          <svg class="settings-modal__title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Settings
        </h3>
        <button class="settings-modal__close" id="sm-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg></button>
      </div>
      <div class="settings-modal__body">
        <div class="settings-modal__section" id="sm-appearance-section">
          <h4 class="settings-modal__section-title">
            <svg class="settings-modal__section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><path d="M17.5 10.5 21 3"/><path d="M3 21l5.5-5.5"/><circle cx="8" cy="16" r="3"/><path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4z"/></svg>
            Appearance
          </h4>
          <div class="settings-modal__theme-grid" id="sm-theme-grid"></div>
          <label class="settings-modal__toggle" id="sm-themed-builds-toggle">
            <input type="checkbox" class="settings-modal__toggle-input" id="sm-themed-builds">
            <span class="settings-modal__toggle-switch"></span>
            <span class="settings-modal__toggle-text">Themed build pages</span>
          </label>
        </div>
        <div class="settings-modal__section" id="sm-publishing-section">
          <h4 class="settings-modal__section-title">
            <svg class="settings-modal__section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            Publishing
          </h4>
          <label class="settings-modal__label">Repository owner</label>
          <div id="sm-target-picker"></div>
          <div id="sm-setup-row" class="settings-modal__setup-row"></div>
        </div>
        <div class="settings-modal__section">
          <h4 class="settings-modal__section-title">
            <svg class="settings-modal__section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Discord
          </h4>
          <div class="settings-modal__subsection">
            <label class="settings-modal__sublabel">Comp Webhook</label>
            <input type="text" class="settings-modal__input" id="sm-webhook-url" placeholder="https://discord.com/api/webhooks/..." autocomplete="off" spellcheck="false">
            <span class="settings-modal__error" id="sm-webhook-error"></span>
            <div class="settings-modal__thread-inline" id="sm-thread-mode">
              <label class="settings-modal__pill"><input type="radio" name="sm-thread-mode" value="none"><span>Channel</span></label>
              <label class="settings-modal__pill"><input type="radio" name="sm-thread-mode" value="auto"><span>New Post</span></label>
              <label class="settings-modal__pill"><input type="radio" name="sm-thread-mode" value="custom"><span>Thread ID</span></label>
              <input type="text" class="settings-modal__input settings-modal__thread-id-input settings-modal__thread-id-input--hidden" id="sm-thread-id" placeholder="Thread ID" autocomplete="off" spellcheck="false">
            </div>
            <span class="settings-modal__error" id="sm-thread-error"></span>
          </div>
          <div class="settings-modal__subsection">
            <label class="settings-modal__sublabel">Build Webhook</label>
            <input type="text" class="settings-modal__input" id="sm-build-webhook-url" placeholder="https://discord.com/api/webhooks/..." autocomplete="off" spellcheck="false">
            <span class="settings-modal__error" id="sm-build-webhook-error"></span>
            <div class="settings-modal__thread-inline" id="sm-build-thread-mode">
              <label class="settings-modal__pill"><input type="radio" name="sm-build-thread-mode" value="none"><span>Channel</span></label>
              <label class="settings-modal__pill"><input type="radio" name="sm-build-thread-mode" value="auto"><span>New Post</span></label>
              <label class="settings-modal__pill"><input type="radio" name="sm-build-thread-mode" value="custom"><span>Thread ID</span></label>
              <input type="text" class="settings-modal__input settings-modal__thread-id-input settings-modal__thread-id-input--hidden" id="sm-build-thread-id" placeholder="Thread ID" autocomplete="off" spellcheck="false">
            </div>
            <span class="settings-modal__error" id="sm-build-thread-error"></span>
          </div>
        </div>
        <div class="settings-modal__section">
          <h4 class="settings-modal__section-title">
            <svg class="settings-modal__section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            Data
          </h4>
          <p class="settings-modal__hint">GW2 API responses are cached for 24 hours to speed up launch times.</p>
          <div class="settings-modal__cache-row">
            <button class="settings-modal__btn" id="sm-clear-cache" type="button">Clear API Cache</button>
            <span class="settings-modal__cache-status" id="sm-cache-status"></span>
          </div>
        </div>
        <div class="settings-modal__section" id="sm-shared-library-section">
          <h4 class="settings-modal__section-title">
            <svg class="settings-modal__section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Shared Library
          </h4>
          <span class="settings-modal__error" id="sm-shared-status"></span>
          <div id="sm-shared-setup">
            <label class="settings-modal__label" for="sm-org-select">Organization</label>
            <select class="settings-modal__select" id="sm-org-select">
              <option value="">Select an organization...</option>
            </select>
            <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-shared-connect" type="button">Connect</button>
          </div>
          <div id="sm-shared-connected" class="settings-modal__shared-connected--hidden">
            <div class="settings-modal__shared-info">
              <span class="settings-modal__shared-org" id="sm-shared-org-name"></span>
              <span class="settings-modal__shared-repo"> / axibuilds-shared</span>
            </div>
            <button class="settings-modal__btn settings-modal__btn--danger" id="sm-shared-disconnect" type="button">Disconnect</button>
          </div>
        </div>
      </div>
      <div class="settings-modal__actions">
        <button class="settings-modal__btn settings-modal__btn--save" id="sm-save">Save</button>
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
    webhookUrl:        document.getElementById("sm-webhook-url"),
    webhookError:      document.getElementById("sm-webhook-error"),
    threadMode:        document.getElementById("sm-thread-mode"),
    threadId:          document.getElementById("sm-thread-id"),
    threadError:       document.getElementById("sm-thread-error"),
    buildWebhookUrl:   document.getElementById("sm-build-webhook-url"),
    buildWebhookError: document.getElementById("sm-build-webhook-error"),
    buildThreadMode:   document.getElementById("sm-build-thread-mode"),
    buildThreadId:     document.getElementById("sm-build-thread-id"),
    buildThreadError:  document.getElementById("sm-build-thread-error"),
    save:              document.getElementById("sm-save"),
    clearCache:        document.getElementById("sm-clear-cache"),
    cacheStatus:       document.getElementById("sm-cache-status"),
    sharedStatus:      document.getElementById("sm-shared-status"),
    sharedSetup:       document.getElementById("sm-shared-setup"),
    sharedConnected:   document.getElementById("sm-shared-connected"),
    orgSelect:         document.getElementById("sm-org-select"),
    sharedConnect:     document.getElementById("sm-shared-connect"),
    sharedDisconnect:  document.getElementById("sm-shared-disconnect"),
    sharedOrgName:     document.getElementById("sm-shared-org-name"),
  };
  _el.themedBuilds = _overlay.querySelector("#sm-themed-builds");

  _el.close.addEventListener("click", _close);
  _el.save.addEventListener("click", _save);
  _el.clearCache.addEventListener("click", _clearCache);
  _el.sharedConnect.addEventListener("click", _connectSharedLibrary);
  _el.sharedDisconnect.addEventListener("click", _disconnectSharedLibrary);

  // Toggle thread ID input visibility for comp webhook
  _el.threadMode.addEventListener("change", (e) => {
    _el.threadId.classList.toggle("settings-modal__thread-id-input--hidden", e.target.value !== "custom");
  });
  // Toggle thread ID input visibility for build webhook
  _el.buildThreadMode.addEventListener("change", (e) => {
    _el.buildThreadId.classList.toggle("settings-modal__thread-id-input--hidden", e.target.value !== "custom");
  });

  // Toggle themed build pages
  _el.themedBuilds.addEventListener("change", async () => {
    const enabled = _el.themedBuilds.checked;
    await window.desktopApi.setSetting("appearance.themedBuildPages", enabled);
    if (_callbacks.onThemedBuildsToggle) _callbacks.onThemedBuildsToggle(enabled);
  });
}

export async function openSettingsModal() {
  if (!_overlay) return;

  // Load current values
  const [webhookUrl, buildWebhookUrl, threadMode, threadId, buildThreadMode, buildThreadId, themedBuilds] = await Promise.all([
    window.desktopApi.getSetting("discord.webhookUrl"),
    window.desktopApi.getSetting("discord.buildWebhookUrl"),
    window.desktopApi.getSetting("discord.threadMode"),
    window.desktopApi.getSetting("discord.threadId"),
    window.desktopApi.getSetting("discord.buildThreadMode"),
    window.desktopApi.getSetting("discord.buildThreadId"),
    window.desktopApi.getSetting("appearance.themedBuildPages"),
  ]);

  // Comp webhook
  _el.webhookUrl.value = webhookUrl || "";
  _el.webhookError.textContent = "";
  const mode = threadMode || "none";
  const radio = _el.threadMode.querySelector(`input[value="${mode}"]`);
  if (radio) radio.checked = true;
  _el.threadId.classList.toggle("settings-modal__thread-id-input--hidden", mode !== "custom");
  _el.threadId.value = threadId || "";
  _el.threadError.textContent = "";

  // Build webhook
  _el.buildWebhookUrl.value = buildWebhookUrl || "";
  _el.buildWebhookError.textContent = "";
  const bMode = buildThreadMode || "none";
  const bRadio = _el.buildThreadMode.querySelector(`input[value="${bMode}"]`);
  if (bRadio) bRadio.checked = true;
  _el.buildThreadId.classList.toggle("settings-modal__thread-id-input--hidden", bMode !== "custom");
  _el.buildThreadId.value = buildThreadId || "";
  _el.buildThreadError.textContent = "";

  // Themed build pages toggle
  _el.themedBuilds.checked = !!themedBuilds;

  // Populate appearance section
  _renderThemeGrid();

  // Populate publishing section
  _renderPublishing();

  // Populate shared library section
  _loadSharedLibraryState();

  _overlay.classList.remove("settings-modal-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _close(); };
  document.addEventListener("keydown", _escHandler);
  _el.webhookUrl.focus();
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

async function _save() {
  const url = _el.webhookUrl.value.trim();
  const buildUrl = _el.buildWebhookUrl.value.trim();
  const mode = _el.threadMode.querySelector("input:checked")?.value || "none";
  const threadId = _el.threadId.value.trim();
  const bMode = _el.buildThreadMode.querySelector("input:checked")?.value || "none";
  const bThreadId = _el.buildThreadId.value.trim();

  // Validate webhook URLs
  if (url && !WEBHOOK_RE.test(url)) {
    _el.webhookError.textContent = "Must be a Discord webhook URL";
    return;
  }
  if (buildUrl && !WEBHOOK_RE.test(buildUrl)) {
    _el.buildWebhookError.textContent = "Must be a Discord webhook URL";
    return;
  }

  // Validate comp thread ID
  if (mode === "custom" && !threadId) {
    _el.threadError.textContent = "Thread ID is required";
    return;
  }
  if (mode === "custom" && !/^\d+$/.test(threadId)) {
    _el.threadError.textContent = "Must be a numeric Discord ID";
    return;
  }

  // Validate build thread ID
  if (bMode === "custom" && !bThreadId) {
    _el.buildThreadError.textContent = "Thread ID is required";
    return;
  }
  if (bMode === "custom" && !/^\d+$/.test(bThreadId)) {
    _el.buildThreadError.textContent = "Must be a numeric Discord ID";
    return;
  }

  _el.webhookError.textContent = "";
  _el.buildWebhookError.textContent = "";
  _el.threadError.textContent = "";
  _el.buildThreadError.textContent = "";
  await Promise.all([
    window.desktopApi.setSetting("discord.webhookUrl", url || null),
    window.desktopApi.setSetting("discord.threadMode", mode),
    window.desktopApi.setSetting("discord.threadId", mode === "custom" ? threadId : null),
    window.desktopApi.setSetting("discord.buildWebhookUrl", buildUrl || null),
    window.desktopApi.setSetting("discord.buildThreadMode", bMode),
    window.desktopApi.setSetting("discord.buildThreadId", bMode === "custom" ? bThreadId : null),
  ]);
  _close();
}

function _close() {
  if (!_overlay) return;
  _overlay.classList.add("settings-modal-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}

// ─── Shared Library section ──────────────────────────────────────────────────

async function _loadSharedLibraryState() {
  if (!_el.sharedSetup) return;
  _el.sharedStatus.textContent = "";
  const config = await window.desktopApi.getSharedLibraryConfig();
  if (config?.orgName) {
    _el.sharedSetup.style.display = "none";
    _el.sharedConnected.classList.remove("settings-modal__shared-connected--hidden");
    _el.sharedOrgName.textContent = config.orgName;
  } else {
    _el.sharedConnected.classList.add("settings-modal__shared-connected--hidden");
    _el.sharedSetup.style.display = "";
    const session = await window.desktopApi.getSession();
    if (session) {
      const orgs = await window.desktopApi.listOrgs();
      _el.orgSelect.innerHTML = '<option value="">Select an organization...</option>';
      for (const org of orgs) {
        const opt = document.createElement("option");
        opt.value = org.login;
        opt.textContent = org.login;
        _el.orgSelect.appendChild(opt);
      }
    } else {
      _el.sharedStatus.textContent = "Log in to GitHub first to set up sharing.";
    }
  }
}

async function _connectSharedLibrary() {
  const org = _el.orgSelect.value;
  if (!org) return;
  _el.sharedConnect.disabled = true;
  _el.sharedConnect.textContent = "Connecting...";
  _el.sharedStatus.textContent = "";
  try {
    await window.desktopApi.setupSharedLibrary(org);
    // connect returns immediately after creating folder stubs and firing the
    // background pull — refresh state now so folders appear in the library
    await window.desktopApi.connectSharedLibrary();
    await _callbacks.refreshLibraryState?.();
    await _loadSharedLibraryState();
    _close();
    _callbacks.navigateToPage?.("library");
  } catch (err) {
    _el.sharedStatus.textContent = `Error: ${err.message}`;
    _el.sharedConnect.disabled = false;
    _el.sharedConnect.textContent = "Connect";
  }
}

async function _disconnectSharedLibrary() {
  if (!confirm("Disconnect from shared library? Your local copies will be kept.")) return;
  await window.desktopApi.disconnectSharedLibrary();
  await _loadSharedLibraryState();
}
