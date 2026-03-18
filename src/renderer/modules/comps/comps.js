import { state } from "../state.js";

let _app = {};

export function initComps(appCallbacks) {
  _app = appCallbacks;
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
    container.innerHTML = `<p style="padding:20px;color:#888;">Comp list — coming in Task 4</p>`;
  }
}
