import { state } from "./state.js";
import { openSettingsModal } from "./settings-modal.js";
import { startLoginFlow } from "./render-pages.js";
import { showConfirmModal } from "./confirm-modal.js";
import { showToast } from "./library/toast.js";
import { askOwnerChoice } from "./publish-prompts.js";
import { queueItemFor } from "./publish-button.js";
import { PUBLISH_RECEIPT_FIELDS } from "./publish-status.js";

/** What the Copy link button needs from the app, for runPublishButtonAction. */
export function publishButtonDeps() {
  return {
    api: window.desktopApi,
    openSetup: () => openSettingsModal({ initialPane: "publishing" }),
    signIn: async () => {
      await startLoginFlow();
      state.onboarding = await window.desktopApi.getOnboardingStatus();
    },
    askOwnerChoice: (kind, id, owner) => askOwnerChoice(kind, id, owner, { confirm: showConfirmModal, api: window.desktopApi }),
    notify: (message) => showToast(message),
  };
}

export function isPublishInFlight(kind, id) {
  const s = queueItemFor(state.publishQueue, kind, id)?.state;
  return s === "queued" || s === "publishing";
}

/**
 * Store a queue snapshot. When items just published, reload the lists so their
 * receipts (status dots, links) are current. The open comp takes only the
 * receipt: it may hold edits newer than the stored record.
 * @returns {Promise<boolean>} whether the lists were reloaded
 */
export async function applyPublishSnapshot(snapshot) {
  state.publishQueue = snapshot || { items: {}, paused: null, published: [] };
  if (!snapshot?.published?.length) return false;
  const [builds, comps] = await Promise.all([window.desktopApi.listBuilds(), window.desktopApi.listComps()]);
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
