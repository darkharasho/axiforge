// Where the editor was opened from, so it can offer a way back.
//
// Lives here rather than inline in renderer.js so the labelling rules can be
// unit-tested without booting Electron (same reasoning as main/teamGuards.js).

/**
 * Name the place the editor is being opened from.
 *
 * The result is a SNAPSHOT taken at navigation time, not a live lookup: the
 * folder or comp it names can be renamed, moved, deleted or synced away while
 * you edit, and a label resolved on click would then read wrong.
 *
 * @param {object} state the renderer state object
 * @param {string} page the page being left ("library", "comps", …)
 * @returns {string|null} the label to show, or null when there is nowhere
 *   meaningful to go back to (so no button is offered).
 */
export function describeEditorOrigin(state, page) {
  if (page === "comps") {
    if (state.compPage === "detail" && state.activeComp) {
      return state.activeComp.name || state.activeComp.title || "Comp";
    }
    return "Comps";
  }
  if (page === "library") {
    const cur = state.currentFolder;
    if (cur?.type === "custom") {
      const folder = (state.folders || []).find((f) => f.id === cur.id);
      if (folder?.name) return folder.name;
    }
    return "Library";
  }
  return null;
}

/**
 * Decide what `state.editorReturn` should become for a navigation to `page`.
 *
 * MUST be called BEFORE `state.activePage` is reassigned — it reads the page
 * being left to work out where "back" goes.
 *
 * @param {object} state the renderer state object
 * @param {string} page the page being navigated to
 * @returns {{page: string, label: string}|null}
 */
export function nextEditorReturn(state, page) {
  // Leaving the editor: there is no longer an editor session to return from.
  if (page !== "editor") return null;
  // Already in the editor (a subtab click, a reload of the same page): keep the
  // origin we captured on the way in rather than pointing "back" at the editor.
  if (state.activePage === "editor") return state.editorReturn || null;
  const label = describeEditorOrigin(state, state.activePage);
  return label ? { page: state.activePage, label } : null;
}
