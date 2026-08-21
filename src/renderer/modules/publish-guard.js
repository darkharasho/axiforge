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

export function publishedByOtherBody(login) {
  return `This was published by <strong>${login}</strong>. Publishing from your account creates a new link; the old one keeps working but won't update.`;
}
