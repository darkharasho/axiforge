import { state } from "../state.js";
import { showConfirmModal } from "../confirm-modal.js";
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
      const newName = prompt("Rename comp:", currentName || "");
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
