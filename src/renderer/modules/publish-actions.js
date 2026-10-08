import { state } from "./state.js";
import { openSettingsModal } from "./settings-modal.js";
import { signInAndRefresh } from "./render-pages.js";
import { showConfirmModal, whenConfirmModalIdle } from "./confirm-modal.js";
import { showToast } from "./library/toast.js";
import { askOwnerChoice } from "./publish-prompts.js";
import { queueItemFor, connectionFrom } from "./publish-button.js";
import { PUBLISH_RECEIPT_FIELDS } from "./publish-status.js";

const SETUP_EXPLAINER = {
  title: "Publishing puts your build online",
  body:
    "<p>Publishing uploads your builds to your own GitHub Pages site so the shareable link " +
    "(including Discord) actually works for other people.</p>" +
    "<p>Once it's set up, saving publishes automatically in the background, using the " +
    "one-time GitHub sign-in. Your links stay private unless you share them.</p>",
  confirmLabel: "Set up publishing",
  cancelLabel: "Cancel",
};

/**
 * "Set up publishing": sign in if needed, explain what publishing does, then
 * open the Publishing settings pane. Stops on a cancelled sign-in or explainer;
 * a failed sign-in throws to the caller.
 * @returns {Promise<boolean>} whether the settings pane was opened
 */
async function openPublishingSetup() {
  if (!state.onboarding?.isAuthenticated) {
    if (!(await signInAndRefresh())) return false;
    // An account that already publishes needs no setup.
    if (connectionFrom(state.onboarding).connected) return false;
  }
  if (!(await showConfirmModal(SETUP_EXPLAINER))) return false;
  await openSettingsModal({ initialPane: "publishing" });
  return true;
}

/** What the Copy link button needs from the app, for runPublishButtonAction. */
export function publishButtonDeps() {
  return {
    api: window.desktopApi,
    openSetup: openPublishingSetup,
    signIn: signInAndRefresh,
    askOwnerChoice: (kind, id, owner) => askOwnerChoice(kind, id, owner, { confirm: showConfirmModal, api: window.desktopApi, whenIdle: whenConfirmModalIdle }),
    notify: (message) => showToast(message),
  };
}

export function isPublishInFlight(kind, id) {
  const s = queueItemFor(state.publishQueue, kind, id)?.state;
  return s === "queued" || s === "publishing";
}

// Reloads overlap when snapshots arrive close together; only the newest one
// may land, so an older list response never overwrites newer data.
let reloadSeq = 0;

/**
 * Store a queue snapshot. When items just published, reload the lists so their
 * receipts (status dots, links) are current. The open comp takes only the
 * receipt: it may hold edits newer than the stored record.
 * @returns {Promise<boolean>} whether the lists were reloaded
 */
export async function applyPublishSnapshot(snapshot) {
  state.publishQueue = snapshot || { items: {}, paused: null, published: [] };
  if (!snapshot?.published?.length) return false;
  const seq = ++reloadSeq;
  const [builds, comps] = await Promise.all([window.desktopApi.listBuilds(), window.desktopApi.listComps()]);
  if (seq !== reloadSeq) return false;
  state.builds = builds;
  state.comps = comps;
  if (state.activeComp) {
    const fresh = comps.find((c) => c.id === state.activeComp.id);
    if (fresh) {
      const receipt = {};
      for (const key of PUBLISH_RECEIPT_FIELDS) if (key in fresh) receipt[key] = fresh[key];
      state.activeComp = { ...state.activeComp, ...receipt };
    }
  }
  return true;
}
