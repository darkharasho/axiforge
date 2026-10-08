import { escapeHtml } from "./utils.js";

export const BULK_PROMPT_SETTING = "bulkPublishPrompted";

/** `login` is teammate-controlled and the body goes to innerHTML: escaped here. */
export function ownerChoiceBody(kind, login) {
  const noun = kind === "comp" ? "comp" : "build";
  const who = login ? `<strong>@${escapeHtml(login)}</strong>` : "someone else";
  return `<p>This ${noun} was published by ${who}.</p><p>Your link will point at your account; their link keeps working but stops updating.</p>`;
}

// Publishing prompts take turns: one never replaces another, nor a confirm
// that is already open (whenIdle). Each waits for the one before it.
let promptChain = Promise.resolve();
const queuedOwnerPrompts = new Map(); // "kind:id" → its queued prompt

function queuePrompt(run, whenIdle) {
  const next = promptChain.then(async () => {
    await whenIdle();
    return run();
  });
  promptChain = next.catch(() => {});
  return next;
}

const alwaysIdle = async () => {};

/**
 * The once-per-item foreign-owner prompt. Resolves true for "Publish my copy",
 * false for an explicit "Keep theirs", and null when the prompt was closed
 * (Esc, the X) or replaced: the item then stays undecided and nothing is stored.
 * `confirm` is showConfirmModal; `whenIdle` resolves once no confirm is open.
 */
export function askOwnerChoice(kind, id, owner, { confirm, api, whenIdle = alwaysIdle }) {
  const key = `${kind}:${id}`;
  if (queuedOwnerPrompts.has(key)) return queuedOwnerPrompts.get(key);
  const prompt = queuePrompt(async () => {
    const outcome = await confirm({
      title: "Publish your own copy?",
      body: ownerChoiceBody(kind, owner),
      confirmLabel: "Publish my copy",
      cancelLabel: "Keep theirs",
      detailed: true,
    });
    if (outcome === "confirm") {
      await api.setPublishChoice(kind, id, "mine");
      return true;
    }
    if (outcome === "cancel") {
      await api.setPublishChoice(kind, id, "theirs");
      return false;
    }
    return null;
  }, whenIdle || alwaysIdle).finally(() => queuedOwnerPrompts.delete(key));
  queuedOwnerPrompts.set(key, prompt);
  return prompt;
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
export async function maybeShowBulkPublishPrompt({ api, onboarding, confirm, whenIdle = alwaysIdle }) {
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
    const outcome = await queuePrompt(() => confirm({
      title: "Publish your library?",
      body: bulkPromptBody(count),
      confirmLabel: "Publish all",
      cancelLabel: "Not now",
      detailed: true,
    }), whenIdle || alwaysIdle);
    // Replaced by another confirm before the user saw it through: ask again later.
    if (outcome === "displaced") return false;
    await api.setSetting(BULK_PROMPT_SETTING, true);
    const yes = outcome === "confirm";
    if (yes) await api.bulkPublish();
    return yes;
  } finally {
    inFlight = false;
  }
}
