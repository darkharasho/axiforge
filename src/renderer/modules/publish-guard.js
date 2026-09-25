import { escapeHtml } from "./utils.js";

// Matched anywhere in the message, not just at the start: Electron rejects an
// ipcRenderer.invoke with "Error invoking remote method '<channel>': Error:
// <original message>", so the main process's sentinel always arrives wrapped.
// A GitHub login is [A-Za-z0-9-], which also stops the capture before any
// trailing stack frames.
const SENTINEL = /PUBLISHED_BY_OTHER:([A-Za-z0-9-]+)/;

/**
 * Team items publish under whoever clicks Publish. If someone else published
 * this item before, warn that a new link will be created (the old one stays
 * but stops updating) and only proceed with explicit consent.
 */
export async function publishWithOwnerCheck(invoke, confirm) {
  try {
    return await invoke({});
  } catch (err) {
    const match = SENTINEL.exec(String(err?.message || ""));
    if (!match) throw err;
    const login = match[1];
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
