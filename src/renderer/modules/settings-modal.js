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
        <h3 class="settings-modal__title">Settings</h3>
        <button class="settings-modal__close" id="sm-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg></button>
      </div>
      <div class="settings-modal__body">
        <div class="settings-modal__section" id="sm-publishing-section">
          <h4 class="settings-modal__section-title">Publishing</h4>
          <label class="settings-modal__label">Repository owner</label>
          <div id="sm-target-picker"></div>
          <div id="sm-setup-row" class="settings-modal__setup-row"></div>
        </div>
        <div class="settings-modal__section">
          <h4 class="settings-modal__section-title">Discord</h4>
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
          <h4 class="settings-modal__section-title">Data</h4>
          <p class="settings-modal__hint">GW2 API responses are cached for 24 hours to speed up launch times.</p>
          <div class="settings-modal__cache-row">
            <button class="settings-modal__btn" id="sm-clear-cache" type="button">Clear API Cache</button>
            <span class="settings-modal__cache-status" id="sm-cache-status"></span>
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
  };

  _el.close.addEventListener("click", _close);
  _el.save.addEventListener("click", _save);
  _el.clearCache.addEventListener("click", _clearCache);

  // Toggle thread ID input visibility for comp webhook
  _el.threadMode.addEventListener("change", (e) => {
    _el.threadId.classList.toggle("settings-modal__thread-id-input--hidden", e.target.value !== "custom");
  });
  // Toggle thread ID input visibility for build webhook
  _el.buildThreadMode.addEventListener("change", (e) => {
    _el.buildThreadId.classList.toggle("settings-modal__thread-id-input--hidden", e.target.value !== "custom");
  });
}

export async function openSettingsModal() {
  if (!_overlay) return;

  // Load current values
  const [webhookUrl, buildWebhookUrl, threadMode, threadId, buildThreadMode, buildThreadId] = await Promise.all([
    window.desktopApi.getSetting("discord.webhookUrl"),
    window.desktopApi.getSetting("discord.buildWebhookUrl"),
    window.desktopApi.getSetting("discord.threadMode"),
    window.desktopApi.getSetting("discord.threadId"),
    window.desktopApi.getSetting("discord.buildThreadMode"),
    window.desktopApi.getSetting("discord.buildThreadId"),
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

  // Populate publishing section
  _renderPublishing();

  _overlay.classList.remove("settings-modal-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _close(); };
  document.addEventListener("keydown", _escHandler);
  _el.webhookUrl.focus();
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
    _el.cacheStatus.textContent = "Cache cleared";
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
