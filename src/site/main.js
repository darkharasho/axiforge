import "./styles.css";
import { renderSpecializations } from "./render-specs.js";
import { renderSkills } from "./render-skills.js";
import { renderEquipment } from "./render-equipment.js";

const app = document.getElementById("app");

// ── SPA Routing ──────────────────────────────────────────────────────────
function init() {
  let redirect = null;
  try {
    const stored = sessionStorage.getItem("spa-redirect");
    if (stored) { redirect = JSON.parse(stored); sessionStorage.removeItem("spa-redirect"); }
  } catch (e) { /* ignore */ }

  const hash = redirect ? redirect.hash : location.hash;
  const path = redirect ? redirect.path : getBuildPath();

  if (!hash || hash.length < 2) { showLanding(); return; }

  const fragment = hash.substring(1);
  const dotIdx = fragment.indexOf(".");
  if (dotIdx < 1) { showError("Invalid build link."); return; }

  const fileId = fragment.substring(0, dotIdx);
  const key = fragment.substring(dotIdx + 1);

  showLoading();
  loadBuild(fileId, key);
}

function getBuildPath() {
  return location.pathname.split("/").filter(Boolean).slice(1).join("/");
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
    const res = await fetch("builds/" + encodeURIComponent(fileId) + ".enc", { cache: "no-store" });
    if (!res.ok) throw new Error("Build not found (HTTP " + res.status + ")");
    const base64Data = await res.text();
    const build = await decrypt(base64Data, base64urlKey);
    renderBuild(build);
  } catch (err) {
    showError(err.message || String(err));
  }
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
  // Build header
  const header = document.createElement("div");
  header.className = "build-header";
  header.innerHTML = `<div class="build-header__info"><h1>${escapeHtml(build.title || "Untitled Build")}</h1><p class="build-header__meta">${escapeHtml(build.profession || "")} &middot; ${escapeHtml((build.gameMode || "pve").toUpperCase())}</p></div>`;

  // Specializations section
  const specsHeading = document.createElement("h2");
  specsHeading.className = "site-section-heading";
  specsHeading.textContent = "Specializations";

  const specsContainer = document.createElement("div");
  renderSpecializations(specsContainer, build.specializations || []);

  // Skills section
  const skillsHeading = document.createElement("h2");
  skillsHeading.className = "site-section-heading";
  skillsHeading.textContent = "Skills";

  const skillsContainer = document.createElement("div");
  renderSkills(skillsContainer, build);

  // Equipment section
  const equipHeading = document.createElement("h2");
  equipHeading.className = "site-section-heading";
  equipHeading.textContent = "Equipment";

  const equipContainer = document.createElement("div");
  renderEquipment(equipContainer, build);

  app.innerHTML = "";
  app.append(header, specsHeading, specsContainer, skillsHeading, skillsContainer, equipHeading, equipContainer);
}

export function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ── Start ────────────────────────────────────────────────────────────────
init();
