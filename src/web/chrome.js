// Web-only chrome: slim top bar (share link / chat code / desktop CTA) + live
// URL-hash sync for transient sharing. Loaded by main-web.js AFTER the renderer
// boots. Reads the live editor via the renderer's own module exports.
import { serializeEditorToBuild, loadBuildIntoEditor } from "../renderer/modules/editor.js";
import { state } from "../renderer/modules/state.js";
import { createShareApi } from "./webApi/share.js";

const share = createShareApi();
const RELEASES_URL = "https://github.com/darkharasho/axiforge/releases/latest";

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function syncHashFromEditor() {
  if (state.activePage !== "editor") return;
  try {
    const build = serializeEditorToBuild();
    const code = await share.buildToHash(build);
    history.replaceState(null, "", `${location.pathname}#${code}`);
  } catch {
    /* encoding failure: leave the hash as-is */
  }
}

function navigateToEditor() {
  document.querySelector('.leftnav__item[data-page="editor"]')?.click();
}

function flash(btn, msg) {
  const prev = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = prev; }, 1500);
}

function mountTopBar() {
  const bar = document.createElement("div");
  bar.className = "web-topbar no-drag";
  bar.innerHTML = `
    <button id="webCopyLink" type="button" class="web-topbar__btn web-topbar__btn--primary">Copy share link</button>
    <button id="webCopyChat" type="button" class="web-topbar__btn">Copy chat code</button>
    <a id="webGetApp" class="web-topbar__cta" href="${RELEASES_URL}" target="_blank" rel="noopener noreferrer">Get the desktop app</a>
  `;
  document.body.prepend(bar);

  bar.querySelector("#webCopyLink").addEventListener("click", async () => {
    try {
      const build = serializeEditorToBuild();
      const code = await share.encodeShareCode(build);
      await window.desktopApi.writeClipboardText(`${location.origin}${location.pathname}#${code}`);
      flash(bar.querySelector("#webCopyLink"), "Link copied!");
    } catch {
      flash(bar.querySelector("#webCopyLink"), "Couldn't copy link");
    }
  });

  bar.querySelector("#webCopyChat").addEventListener("click", async () => {
    try {
      const build = serializeEditorToBuild();
      const chat = await window.desktopApi.generateChatLink(build);
      await window.desktopApi.writeClipboardText(chat);
      flash(bar.querySelector("#webCopyChat"), "Chat code copied!");
    } catch {
      flash(bar.querySelector("#webCopyChat"), "Couldn't generate code");
    }
  });
}

// Returns the shared build if the page opened with a valid #code, else null.
export async function seedDraftFromHash() {
  const build = await share.hashToBuild(location.hash);
  if (!build) return null;
  build.id = "web-draft";
  await window.desktopApi.saveBuild(build);
  return build;
}

// Run AFTER the renderer has booted. sharedBuild is the value seedDraftFromHash
// returned (or null).
export async function initWebChrome(sharedBuild) {
  if (sharedBuild) {
    try { await loadBuildIntoEditor(sharedBuild); } catch { /* fall through to fresh editor */ }
  }
  navigateToEditor();
  mountTopBar();
  const onEdit = debounce(syncHashFromEditor, 400);
  document.addEventListener("input", onEdit);
  document.addEventListener("change", onEdit);
  document.addEventListener("click", onEdit);
}
