// Simple undo stack for reversible library actions.
// Each entry is { type: string, label?: string, undo: async () => void }.
// `label` is what the user is told on success ("Restored 2 builds"); entries
// without one fall back to a generic message.

const MAX_UNDO = 50;
const _stack = [];

export function pushUndo(action) {
  _stack.push(action);
  if (_stack.length > MAX_UNDO) _stack.shift();
}

export function popUndo() {
  return _stack.pop() || null;
}

export function clearUndo() {
  _stack.length = 0;
}

/**
 * Run an undo action and report the outcome.
 *
 * An undo can genuinely fail — restoring a build into a team folder goes back
 * through the sync layer, which rejects it if the user lacks permission. Show
 * that reason instead of letting the rejection escape unhandled and leaving the
 * user with a stale view and no explanation.
 *
 * @param {object|null} action - entry from popUndo()
 * @param {{toast: (msg: string, type?: string) => void, render?: () => void}} deps
 */
export async function applyUndo(action, { toast, render } = {}) {
  if (!action) return;
  try {
    await action.undo();
    render?.();
    toast?.(action.label || "Undone!", "success");
  } catch (err) {
    // Re-render regardless: a multi-item restore may have partly applied, and
    // the user should see what actually came back.
    render?.();
    toast?.(err?.message || "Couldn't undo that.", "error");
  }
}
