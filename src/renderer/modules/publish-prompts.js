import { escapeHtml } from "./utils.js";

export const BULK_PROMPT_SETTING = "bulkPublishPrompted";

/** `login` is teammate-controlled and the body goes to innerHTML: escaped here. */
export function ownerChoiceBody(kind, login) {
  const noun = kind === "comp" ? "comp" : "build";
  const who = login ? `<strong>@${escapeHtml(login)}</strong>` : "someone else";
  return `<p>This ${noun} was published by ${who}.</p><p>Your link will point at your account; their link keeps working but stops updating.</p>`;
}

/** The once-per-item foreign-owner prompt. Resolves true for "Publish my copy". */
export async function askOwnerChoice(kind, id, owner, { confirm, api }) {
  const mine = await confirm({
    title: "Publish your own copy?",
    body: ownerChoiceBody(kind, owner),
    confirmLabel: "Publish my copy",
    cancelLabel: "Keep theirs",
  });
  await api.setPublishChoice(kind, id, mine ? "mine" : "theirs");
  return mine;
}

export function bulkPromptBody(count) {
  const n = Number(count) || 0;
  return `<p>Builds and comps now publish automatically when you save. You have ${n} that ${n === 1 ? "has" : "have"} never been published. Publish them all now?</p><p><em>It runs in the background, 50 at a time.</em></p>`;
}

let inFlight = false;

/**
 * The one-time bulk-publish prompt. Shown only once publishing is connected;
 * the answer (either one) is remembered so it never shows again.
 */
export async function maybeShowBulkPublishPrompt({ api, onboarding, confirm }) {
  if (inFlight) return false;
  if (!(onboarding?.isAuthenticated && onboarding?.repoReady)) return false;
  inFlight = true;
  try {
    if (await api.getSetting(BULK_PROMPT_SETTING)) return false;
    const count = await api.getBulkPublishCount();
    if (!count) {
      await api.setSetting(BULK_PROMPT_SETTING, true);
      return false;
    }
    const yes = await confirm({
      title: "Publish your library?",
      body: bulkPromptBody(count),
      confirmLabel: "Publish all",
      cancelLabel: "Not now",
    });
    await api.setSetting(BULK_PROMPT_SETTING, true);
    if (yes) await api.bulkPublish();
    return yes;
  } finally {
    inFlight = false;
  }
}
