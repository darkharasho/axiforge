import "@axiapps/axi-design/axi.css";
import "@axiapps/axi-design/accents.css";
import "./styles.css";
import { resolvePinnedBase, pinnedRawBase } from "./rawBase.js";
import { renderBuildPage } from "./render-build.js";
import { renderCompPage } from "./render-comp.js";
import { setReadOnly as setSkillsReadOnly } from "@renderer/modules/skills.js";
import { setReadOnly as setEquipmentReadOnly } from "@renderer/modules/equipment.js";
import { setReadOnly as setSpecsReadOnly } from "@renderer/modules/specializations.js";
import { setReadOnly as setDetailReadOnly } from "@renderer/modules/detail-panel.js";
import { accentFromParams } from "./accent.js";
import { escapeHtml } from "./escape.js";
import { loadCompMembers } from "./comp-members.js";
import { computeViewerCoverageHtml } from "./comp-coverage.js";
import { fetchPayload, assertCompFormat, loadErrorMessage } from "./payload.js";
import { movedOwner, movedPageUrl, isOwnSite } from "./moved.js";

export { escapeHtml };

// Scope class for @axiapps/forge-render styles (mini cards, role badges, hover previews).
document.body.classList.add("forge-render");

const app = document.getElementById("app");

// ── SPA Routing ──────────────────────────────────────────────────────────
function init() {
  const params = new URLSearchParams(location.search);

  // Apply color accent from URL
  const accent = accentFromParams(params);
  if (accent) document.documentElement.setAttribute("data-axi-accent", accent);

  // New format: ?b=fileId.key&n=slug
  let buildParam = params.get("b");

  // Legacy format: /slug#fileId.key (via 404.html redirect → ?legacy=fileId.key)
  if (!buildParam) buildParam = params.get("legacy");

  // Oldest format: #fileId.key (direct hash, no redirect needed)
  if (!buildParam && location.hash.length > 1) buildParam = location.hash.substring(1);

  // Comp format: ?c=fileId.key&n=slug
  const compParam = params.get("c");
  if (compParam) {
    const dotIdx = compParam.indexOf(".");
    if (dotIdx < 1) { showError("Invalid comp link."); return; }
    const fileId = compParam.substring(0, dotIdx);
    const key = compParam.substring(dotIdx + 1);
    showLoading();
    loadComp(fileId, key);
    return;
  }

  if (!buildParam) { showLanding(); return; }

  const dotIdx = buildParam.indexOf(".");
  if (dotIdx < 1) { showError("Invalid build link."); return; }

  const fileId = buildParam.substring(0, dotIdx);
  const key = buildParam.substring(dotIdx + 1);

  showLoading();
  loadBuild(fileId, key);
}

function showLanding() {
  app.innerHTML = `<div class="site-landing"><h1>AxiForge Builds</h1><p>Share your Guild Wars 2 builds with encrypted links.<br>Publish from the <a href="https://github.com/darkharasho/axiforge">AxiForge desktop app</a>.</p></div>`;
}

function showLoading() {
  app.innerHTML = `<div class="site-loading">Decrypting build\u2026</div>`;
}

function showError(msg) {
  app.innerHTML = `<div class="site-error">${escapeHtml(msg)}</div>`;
}

// ── Fetch & Decrypt ──────────────────────────────────────────────────────

// A payload that's gone may have moved to another account: go there instead.
// Resolves only when it didn't (the caller shows its error).
async function followIfMoved(err, base, fileId) {
  if (err?.status !== 404) return;
  const owner = await movedOwner(base, fileId);
  if (!owner || isOwnSite(owner, location)) return;
  location.replace(movedPageUrl(owner, location));
  await new Promise(() => {}); // navigating away
}

async function loadBuild(fileId, base64urlKey) {
  let base = "";
  try {
    base = await resolvePinnedBase(location, new URLSearchParams(location.search));
    const build = await fetchPayload(`${base}builds/${encodeURIComponent(fileId)}.enc`, base64urlKey);
    renderBuild(build);
  } catch (err) {
    await followIfMoved(err, base, fileId);
    showError(loadErrorMessage(err, "Build"));
  }
}

async function loadComp(fileId, base64urlKey) {
  let base = "";
  try {
    base = await resolvePinnedBase(location, new URLSearchParams(location.search));
    let comp;
    try {
      comp = await fetchPayload(`${base}comps/${encodeURIComponent(fileId)}.enc`, base64urlKey);
    } catch (err) {
      await followIfMoved(err, base, fileId);
      throw err;
    }
    assertCompFormat(comp);
    if (comp.v === 2) {
      // A v2 comp links its builds: fetch them, then compute coverage here.
      const builds = await loadCompMembers(comp, {
        fallbackBase: base,
        loc: location,
        baseForOwner: (owner) => pinnedRawBase(owner, "axibuilds"),
      });
      let boonCoverageHtml = "";
      try {
        boonCoverageHtml = await computeViewerCoverageHtml(comp, builds);
      } catch (err) {
        console.warn("Party coverage unavailable:", err);
      }
      comp = { ...comp, builds, boonCoverageHtml };
    }
    renderComp(comp);
  } catch (err) {
    showError(loadErrorMessage(err, "Comp"));
  }
}

function renderComp(comp) {
  renderCompPage(app, comp);
}

// ── Build renderer ────────────────────────────────────────────────────────
function renderBuild(build) {
  setSkillsReadOnly(true);
  setEquipmentReadOnly(true);
  setSpecsReadOnly(true);
  setDetailReadOnly(true);
  renderBuildPage(app, build);
}

// ── Start ────────────────────────────────────────────────────────────────
init();
