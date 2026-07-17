// Web-only chrome: slim top bar (share link / chat code / desktop CTA) + live
// URL-hash sync for transient sharing. Loaded by main-web.js AFTER the renderer
// boots. Reads the live editor via the renderer's own module exports.
import { serializeEditorToBuild, loadBuildIntoEditor } from "../renderer/modules/editor.js";
import { state } from "../renderer/modules/state.js";
import { createShareApi } from "./webApi/share.js";

const share = createShareApi();
const MARKETING_URL = "https://darkharasho.github.io/axiforge/";

// Icons mirror the desktop app's share menu (chat-link hexagon, AxiCode sparkles).
const ICON_LINK = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 11.5a3 3 0 0 0 4.24 0l2-2a3 3 0 1 0-4.24-4.24l-1 1"/><path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 1 0 4.24 4.24l1-1"/></svg>`;
const ICON_CHAT = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5L16.5 6.25V13.75L10 17.5L3.5 13.75V6.25L10 2.5Z"/><path d="M6.25 7.9H8.75M11.25 7.9H13.75"/><circle cx="10" cy="7.9" r="1.25" fill="currentColor" stroke="none"/><path d="M6.25 10H8.75M11.25 10H13.75"/><circle cx="10" cy="10" r="1.25" fill="currentColor" stroke="none"/><path d="M6.25 12.1H8.75M11.25 12.1H13.75"/><circle cx="10" cy="12.1" r="1.25" fill="currentColor" stroke="none"/></svg>`;
const ICON_AXI = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z"/></svg>`;

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
  const label = btn.querySelector(".web-topbar__btn-label") || btn;
  const prev = label.textContent;
  label.textContent = msg;
  setTimeout(() => { label.textContent = prev; }, 1500);
}

function mountTopBar() {
  const bar = document.createElement("div");
  bar.className = "web-topbar no-drag";
  bar.innerHTML = `
    <span class="web-topbar__brand">
      <img class="web-topbar__logo" src="/svg/axiforge-glyph.svg" alt="" aria-hidden="true" />
      <span class="web-topbar__name">Axi<span class="web-topbar__brand-accent">Forge</span></span>
      <span class="web-topbar__beta">Playground</span>
    </span>
    <button id="webCopyLink" type="button" class="web-topbar__btn web-topbar__btn--primary">${ICON_LINK}<span class="web-topbar__btn-label">Copy share link</span></button>
    <button id="webCopyAxi" type="button" class="web-topbar__btn">${ICON_AXI}<span class="web-topbar__btn-label">Copy axi code</span></button>
    <button id="webCopyChat" type="button" class="web-topbar__btn">${ICON_CHAT}<span class="web-topbar__btn-label">Copy chat code</span></button>
    <a id="webGetApp" class="web-topbar__cta" href="${MARKETING_URL}" target="_blank" rel="noopener noreferrer">Get the desktop app</a>
  `;
  document.body.prepend(bar);

  bar.querySelector("#webCopyLink").addEventListener("click", async () => {
    try {
      const build = serializeEditorToBuild();
      // Prefer a short link (build.axi.link/b/<slug>) — low-entropy URLs don't
      // trip Google Safe Browsing's phishing heuristic the way the long #b=
      // base64 blob does. Fall back to the serverless #b= form if the shortener
      // is unreachable so copying still works offline.
      let url = await share.buildToShortLink(build);
      if (!url) {
        const frag = await share.buildToHash(build);
        url = `${location.origin}${location.pathname}#${frag}`;
      }
      await window.desktopApi.writeClipboardText(url);
      flash(bar.querySelector("#webCopyLink"), "Link copied!");
    } catch {
      flash(bar.querySelector("#webCopyLink"), "Couldn't copy link");
    }
  });

  bar.querySelector("#webCopyAxi").addEventListener("click", async () => {
    try {
      const build = serializeEditorToBuild();
      const code = await share.encodeShareCode(build); // raw AxiCode share code
      await window.desktopApi.writeClipboardText(code);
      flash(bar.querySelector("#webCopyAxi"), "AxiCode copied!");
    } catch {
      flash(bar.querySelector("#webCopyAxi"), "Couldn't copy code");
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

// Returns the shared build if the page opened with a valid share URL, else null.
// Two entry shapes: a short link (build.axi.link/b/<slug>, resolved via the
// Worker) or the serverless #b= fragment. The short-link path is tried first
// since that's the default the Copy-link button now emits.
export async function seedDraftFromHash() {
  const slugMatch = location.pathname.match(/\/b\/([A-Za-z0-9]+)\/?$/);
  const build = slugMatch
    ? await share.slugToBuild(slugMatch[1])
    : await share.hashToBuild(location.hash);
  if (!build) return null;
  build.id = "web-draft";
  await window.desktopApi.saveBuild(build);
  return build;
}

// Run AFTER the renderer has booted. sharedBuild is the value seedDraftFromHash
// returned (or null).
// The renderer's init() is async and runs after this module's import resolves.
// loadBuildIntoEditor resolves the profession against state.professions, which is
// empty until init() finishes loading it — so wait for it (and the editor nav
// button) before loading a shared build, or the profession resolves to "".
async function whenRendererReady(timeoutMs = 10000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (
      Array.isArray(state.professions) &&
      state.professions.length > 0 &&
      document.querySelector('.leftnav__item[data-page="editor"]')
    ) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

export async function initWebChrome(sharedBuild) {
  await whenRendererReady();
  if (sharedBuild) {
    try { await loadBuildIntoEditor(sharedBuild); } catch { /* fall through to fresh editor */ }
  }
  navigateToEditor();
  // Ghost-text the title as "Untitled Build" (the desktop placeholder is a sample
  // build name); the field stays empty so an unnamed build isn't named in the URL.
  const titleInput = document.querySelector("#editorTitle");
  if (titleInput) titleInput.placeholder = "Untitled Build";
  mountTopBar();
  const onEdit = debounce(syncHashFromEditor, 400);
  document.addEventListener("input", onEdit);
  document.addEventListener("change", onEdit);
  document.addEventListener("click", onEdit);
  // Convergence safety net: an edit's triggering event can fire before the async
  // catalog load finishes (so the build isn't encodable yet and the debounced
  // sync silently no-ops). A low-frequency re-sync guarantees the share hash
  // catches up once the build becomes encodable, even with no further interaction.
  setInterval(syncHashFromEditor, 1500);
}
