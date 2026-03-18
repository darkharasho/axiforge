import { state } from "../state.js";
import { initCompList, renderCompList } from "./comp-list.js";

let _app = {};

export function initComps(appCallbacks) {
  _app = appCallbacks;

  initCompList({
    onOpenComp: (comp) => {
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
      await window.desktopApi.deleteComp(id);
      await loadComps();
      renderComps();
    },
    onRenameComp: async (id, name) => {
      const existing = state.comps.find((c) => c.id === id);
      if (existing) {
        await window.desktopApi.saveComp({ ...existing, name });
      } else {
        await window.desktopApi.saveComp({ id, name });
      }
      await loadComps();
      renderComps();
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
    container.innerHTML = `<p style="padding:20px;color:#888;">Detail view — coming in Task 5</p>`;
  } else {
    renderCompList();
  }
}
