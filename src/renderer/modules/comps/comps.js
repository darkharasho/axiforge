import { state } from "../state.js";
import { showConfirmModal } from "../confirm-modal.js";
import { showPrompt } from "../prompt-modal.js";
import { initCompList, renderCompList, clearCompSelection } from "./comp-list.js";
import { initCompDetail, renderCompDetail } from "./comp-detail.js";

let _app = {};

export function initComps(appCallbacks) {
  _app = appCallbacks;

  initCompList({
    onOpenComp: (comp) => {
      clearCompSelection();
      state.activeComp = comp;
      state.compPage = "detail";
      renderComps();
    },
    onNewComp: async () => {
      const saved = await window.desktopApi.saveComp({ name: "Untitled Comp" });
      await loadComps();
      // Open the newly created comp in detail mode
      const newComp = state.comps.find((c) => c.id === saved.id) || saved;
      state.activeComp = newComp;
      state.compPage = "detail";
      renderComps();
    },
    onDeleteComp: async (id) => {
      const comp = state.comps.find((c) => c.id === id);
      const name = comp?.name || "this comp";
      const confirmed = await showConfirmModal({
        title: `Delete "${name}"?`,
        body: "This cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;
      await window.desktopApi.deleteComp(id);
      await loadComps();
      renderComps();
    },
    onRenameComp: async (id, currentName) => {
      // NOT window.prompt(): Chromium in Electron does not implement it. It
      // returns null and logs "prompt() is and will not be supported", so
      // right-click -> Rename on this page silently did nothing. Every other
      // dialog in the app already goes through these modals for that reason.
      const newName = await showPrompt("Rename comp", currentName || "");
      if (!newName || newName === currentName) return;
      const existing = state.comps.find((c) => c.id === id);
      if (existing) {
        await window.desktopApi.saveComp({ ...existing, name: newName });
      } else {
        await window.desktopApi.saveComp({ id, name: newName });
      }
      await loadComps();
      renderComps();
    },
    onDuplicateComp: async (id) => {
      const comp = state.comps.find((c) => c.id === id);
      if (!comp) return;
      const { id: _id, createdAt, updatedAt, ...rest } = comp;
      await window.desktopApi.saveComp({ ...rest, name: `Copy of ${comp.name}` });
      await loadComps();
      renderComps();
    },
    onDeleteComps: async (ids) => {
      const count = ids.length;
      const confirmed = await showConfirmModal({
        title: `Delete ${count} comp${count > 1 ? "s" : ""}?`,
        body: "This cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;
      await window.desktopApi.deleteComps(ids);
      clearCompSelection();
      await loadComps();
      renderComps();
    },
    onAddTags: async (ids, tags) => {
      await window.desktopApi.addTagsToComps(ids, tags);
      await loadComps();
      renderComps();
    },
    onRemoveTags: async (ids, tags) => {
      await window.desktopApi.removeTagsFromComps(ids, tags);
      await loadComps();
      renderComps();
    },
    onExportComps: async (ids) => {
      const selected = state.comps.filter((c) => ids.includes(c.id));
      const json = JSON.stringify(selected, null, 2);
      await window.desktopApi.writeClipboardText(json);
    },
    getCatalog: _app.getCatalog,
  });

  initCompDetail({
    onRerender: () => renderComps(),
    getCatalog: _app.getCatalog,
    onAddTags: async (ids, tags) => {
      await window.desktopApi.addTagsToComps(ids, tags);
      await loadComps();
      renderComps();
    },
    onRemoveTags: async (ids, tags) => {
      await window.desktopApi.removeTagsFromComps(ids, tags);
      await loadComps();
      renderComps();
    },
    onOpenBuild: (build) => {
      if (!build) return;
      if (_app.confirmDiscardDirty && !_app.confirmDiscardDirty("Load another build")) return;
      _app.loadBuildIntoEditor?.(build);
      _app.navigateToPage?.("editor");
    },
  });
}

export async function loadComps() {
  state.comps = await window.desktopApi.listComps();
  // Re-point the open comp at the record we just loaded. Every callback that
  // changes a comp reloads the list, and the detail view renders from
  // state.activeComp — leave it pointing at the copy it was opened with and an
  // edit made anywhere but in that object vanishes on the next render.
  if (state.activeComp) {
    const fresh = state.comps.find((c) => c.id === state.activeComp.id);
    if (fresh) state.activeComp = fresh;
  }
}

export function renderComps() {
  const container = document.getElementById("comps-container");
  if (!container) return;

  if (state.compPage === "detail" && state.activeComp) {
    renderCompDetail();
  } else {
    renderCompList();
  }
}
