import { escapeHtml } from "./utils.js";

const PREFIX = "PUBLISHED_BY_OTHER:";

/**
 * Team items publish under whoever clicks Publish. If someone else published
 * this item before, warn that a new link will be created (the old one stays
 * but stops updating) and only proceed with explicit consent.
 */
export async function publishWithOwnerCheck(invoke, confirm) {
  try {
    return await invoke({});
  } catch (err) {
    const msg = String(err?.message || "");
    if (!msg.startsWith(PREFIX)) throw err;
    const login = msg.slice(PREFIX.length);
    if (!(await confirm(login))) return null;
    return invoke({ force: true });
  }
}

/**
 * Confirm-modal body for the publish-by-other prompt.
 *
 * `login` is teammate-controlled data and the result is fed to innerHTML, so the
 * escaping lives HERE rather than at each call site — a new call site that
 * forgot would otherwise be a stored XSS in a renderer with full desktopApi
 * access.
 */
export function publishedByOtherBody(login) {
  return `This was published by <strong>${escapeHtml(login)}</strong>. Publishing from your account creates a new link; the old one keeps working but won't update.`;
}
