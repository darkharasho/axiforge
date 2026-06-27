import "./styles.css";
import { resolveDataBase } from "./rawBase.js";
import { renderBuildPage } from "./render-build.js";
import { renderCompPage } from "./render-comp.js";
import { setReadOnly as setSkillsReadOnly } from "@renderer/modules/skills.js";
import { setReadOnly as setEquipmentReadOnly } from "@renderer/modules/equipment.js";
import { setReadOnly as setSpecsReadOnly } from "@renderer/modules/specializations.js";
import { setReadOnly as setDetailReadOnly } from "@renderer/modules/detail-panel.js";

// Scope class for @axiapps/forge-render styles (mini cards, role badges, hover previews).
document.body.classList.add("forge-render");

const VALID_THEMES = new Set([
  "molten-core", "frostforge", "verdant-crucible", "cinderfall",
  "copper", "cobalt", "mithril", "rose-gold",
  "prof-guardian", "prof-warrior", "prof-necromancer", "prof-engineer",
  "prof-ranger", "prof-thief", "prof-mesmer", "prof-elementalist", "prof-revenant",
]);

const app = document.getElementById("app");

// ── SPA Routing ──────────────────────────────────────────────────────────
function init() {
  const params = new URLSearchParams(location.search);

  // Apply color theme from URL
  const theme = params.get("t");
  if (theme && VALID_THEMES.has(theme)) {
    document.documentElement.setAttribute("data-theme", theme);
  }

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
async function loadBuild(fileId, base64urlKey) {
  try {
    const params = new URLSearchParams(location.search);
    const base = resolveDataBase(location, params);
    const buildUrl = `${base}builds/${encodeURIComponent(fileId)}.enc`;
    const res = await fetch(buildUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("Build not found (HTTP " + res.status + ")");
    const base64Data = await res.text();
    const build = await decrypt(base64Data, base64urlKey);
    renderBuild(build);
  } catch (err) {
    showError(err.message || String(err));
  }
}

async function loadComp(fileId, base64urlKey) {
  try {
    const params = new URLSearchParams(location.search);
    const base = resolveDataBase(location, params);
    const compUrl = `${base}comps/${encodeURIComponent(fileId)}.enc`;
    const res = await fetch(compUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("Comp not found (HTTP " + res.status + ")");
    const base64Data = await res.text();
    const comp = await decrypt(base64Data, base64urlKey);
    renderComp(comp);
  } catch (err) {
    showError(err.message || String(err));
  }
}

function renderComp(comp) {
  renderCompPage(app, comp);
}

async function decrypt(base64Data, base64urlKey) {
  const combined = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const keyBytes = base64urlDecode(base64urlKey);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
  return JSON.parse(new TextDecoder().decode(plain));
}

function base64urlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ── Build renderer ────────────────────────────────────────────────────────
function renderBuild(build) {
  setSkillsReadOnly(true);
  setEquipmentReadOnly(true);
  setSpecsReadOnly(true);
  setDetailReadOnly(true);
  renderBuildPage(app, build);
}

export function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ── Start ────────────────────────────────────────────────────────────────
init();
