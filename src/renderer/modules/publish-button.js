// The "Copy link" button that replaced Publish (publish on save). One pure
// function decides what it says and does; the editor and the comp board draw
// the same view with applyPublishButton.

const ICONS = {
  spinner: '<span class="publish-btn__icon publish-btn__icon--spinner" aria-hidden="true"></span>',
  check: '<svg class="publish-btn__icon publish-btn__icon--check" viewBox="0 0 20 20" width="12" height="12" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clip-rule="evenodd"/></svg>',
  clock: '<svg class="publish-btn__icon publish-btn__icon--clock" viewBox="0 0 20 20" width="12" height="12" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .2.08.39.22.53l3 3a.75.75 0 1 0 1.06-1.06l-2.78-2.78V5Z" clip-rule="evenodd"/></svg>',
};
const TONES = ["busy", "warn", "ok"];

function view(label, action, { tone = "", icon = "", title = "" } = {}) {
  return { label, action, tone, icon, title, disabled: false };
}

const COPY_ACTIONS = new Set(["copy", "publish-and-copy"]);

function waitingTitle(item, now) {
  const why = item.reason === "rate-limit" ? "GitHub rate limit reached" : "Offline";
  const secs = item.retryAt ? Math.max(0, Math.ceil((item.retryAt - now) / 1000)) : null;
  return `${why} — the link shows your previous save.${secs !== null ? ` Retrying in ${secs}s.` : ""}`;
}

/**
 * `dirty` (the editor has unsaved edits): a copy would hand out the last save,
 * so the copy actions are disabled until the edits are saved, like the Discord
 * share buttons. Setup, sign-in, Retry and the owner choice stay available.
 * @param {{queueItem?: {state: string, error?: string, reason?: string, retryAt?: number, owner?: string}|null,
 *          receipt?: "never"|"current"|"stale", connection?: {signedIn: boolean, connected: boolean}, now?: number,
 *          dirty?: boolean}} input
 */
export function publishButtonState({ dirty = false, ...input } = {}) {
  const v = baseButtonState(input);
  if (dirty && COPY_ACTIONS.has(v.action)) return { ...v, disabled: true, title: "Save your changes first" };
  return v;
}

function baseButtonState({ queueItem = null, receipt = "never", connection = {}, now = Date.now() } = {}) {
  const state = queueItem?.state || null;
  if (state === "unauthorized") {
    return view("Sign in to publish", "sign-in", { tone: "warn", title: "Your GitHub sign-in expired. Sign in again to keep publishing." });
  }
  if (!connection.connected || state === "disconnected") {
    return view("Set up publishing", "setup", { title: connection.signedIn ? "Choose where your builds publish" : "Sign in with GitHub to publish" });
  }
  if (state === "failed") {
    return view("Retry", "retry", { tone: "warn", title: `Publishing failed: ${queueItem.error || "unknown error"}` });
  }
  if (state === "declined") {
    return view("Publish my copy", "choose-owner", { title: queueItem.owner ? `Published by @${queueItem.owner}` : "Published by someone else" });
  }
  if (state === "queued" || state === "publishing") {
    return view("Publishing…", "copy", {
      tone: "busy", icon: "spinner",
      title: receipt === "never" ? "Uploading — the link is copied once it's live" : "Uploading your latest save — the link already works",
    });
  }
  if (state === "waiting") return view("Copy link", "copy", { icon: "clock", title: waitingTitle(queueItem, now) });
  if (receipt === "current") return view("Copy link", "copy", { tone: "ok", icon: "check", title: "Up to date" });
  if (receipt === "stale") return view("Copy link", "publish-and-copy", { title: "Your latest save isn't published yet — copying publishes it" });
  return view("Copy link", "copy", { title: "Not published yet — copying publishes it" });
}

export function queueItemFor(snapshot, kind, id) {
  return snapshot?.items?.[`${kind}:${id}`] || null;
}

export function connectionFrom(onboarding) {
  const signedIn = Boolean(onboarding?.isAuthenticated);
  return { signedIn, connected: Boolean(signedIn && onboarding?.repoReady) };
}

export function applyPublishButton(btn, v) {
  btn.dataset.action = v.action;
  btn.title = v.title || "";
  btn.disabled = Boolean(v.disabled);
  for (const tone of TONES) btn.classList.toggle(`publish-btn--${tone}`, v.tone === tone);
  btn.classList.add("publish-btn");
  btn.innerHTML = `${ICONS[v.icon] || ""}<span class="publish-btn__label"></span>`;
  btn.querySelector(".publish-btn__label").textContent = v.label;
}

/**
 * @param {string} action from publishButtonState
 * @param {{kind: "build"|"comp", id: string, owner?: string}} target
 * @param {{api: object, openSetup: Function, signIn: Function, askOwnerChoice: Function, notify: Function}} deps
 */
export async function runPublishButtonAction(action, { kind, id, owner = "" }, deps) {
  const { api, openSetup, signIn, askOwnerChoice, notify } = deps;
  if (action === "setup") return openSetup();
  if (action === "sign-in") return signIn();
  if (action === "retry") return api.retryPublish(kind, id);
  if (action === "choose-owner") return askOwnerChoice(kind, id, owner);
  if (action === "publish-and-copy") await api.retryPublish(kind, id);
  const url = await api.getPublishLink(kind, id);
  if (!url) throw new Error("This link isn't available yet. Try again once publishing finishes.");
  await api.writeClipboardText(url);
  notify("Link copied!");
  return undefined;
}
