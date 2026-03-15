"use strict";
const { encryptBuild } = require("./buildEncryption");

function buildSpaBundle() {
  return {
    "site/index.html": SPA_INDEX_HTML,
    "site/styles.css": SPA_STYLES_CSS,
    "site/app.js": SPA_APP_JS,
    "site/404.html": SPA_404_HTML,
    "site/.nojekyll": "\n",
  };
}

function buildEncryptedBuildFile(buildData, fileId, base64urlKey) {
  const content = encryptBuild(buildData, base64urlKey);
  return {
    filePath: `site/builds/${fileId}.enc`,
    content,
  };
}

const SPA_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>AxiForge Builds</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Exo+2:wght@300;400;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <nav class="navbar">
      <div class="navbar-brand">
        <span class="navbar-logo">&#9876;</span>
        <span class="navbar-title">AxiForge Builds</span>
      </div>
      <div class="navbar-links">
        <a href="https://github.com/darkharasho/axiforge" target="_blank" rel="noopener noreferrer" class="navbar-link">GitHub</a>
        <a href="https://discord.gg/UjzMXMGXEg" target="_blank" rel="noopener noreferrer" class="navbar-link">Discord</a>
      </div>
    </nav>
    <main id="app"></main>
    <script src="app.js" defer></script>
  </body>
</html>
`;

const SPA_404_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>AxiForge Builds — Redirecting</title>
    <script>
      var seg = location.pathname.split('/').filter(Boolean);
      var repoName = seg.length > 0 ? seg[0] : '';
      var buildPath = seg.slice(1).join('/');
      if (buildPath || location.hash) {
        sessionStorage.setItem('spa-redirect', JSON.stringify({ path: buildPath, hash: location.hash }));
        location.replace('/' + repoName + '/');
      }
    </script>
  </head>
  <body>
    <p>Redirecting&hellip;</p>
  </body>
</html>
`;

const SPA_STYLES_CSS = `:root{
  color-scheme: dark;
  --bg:#04070f;
  --panel:#101930;
  --accent:#4fd897;
  --accent-2:#48a8ff;
  --text:#e8f0ff;
  --muted:#9bb0d9;
  --line:#1f3157;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  min-height:100vh;
  font-family:'Exo 2','Segoe UI',ui-sans-serif,system-ui,sans-serif;
  background:var(--bg);
  color:var(--text);
}
h1,h2,h3{font-family:'Cinzel','Exo 2',serif}

/* Navbar */
.navbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:12px 24px;
  background:var(--panel);
  border-bottom:1px solid var(--line);
}
.navbar-brand{display:flex;align-items:center;gap:10px}
.navbar-logo{font-size:1.5rem}
.navbar-title{font-family:'Cinzel',serif;font-size:1.2rem;color:var(--accent);font-weight:700}
.navbar-links{display:flex;gap:16px}
.navbar-link{color:var(--accent-2);text-decoration:none;font-size:.9rem}
.navbar-link:hover{text-decoration:underline}

/* Main container */
#app{
  width:min(960px,94vw);
  margin:32px auto 48px;
}

/* Loading & error */
.loading{text-align:center;padding:48px 0;color:var(--muted);font-size:1.1rem}
.error-box{
  background:rgba(255,60,60,.12);
  border:1px solid rgba(255,60,60,.4);
  border-radius:10px;
  padding:20px;
  color:#ff8888;
  text-align:center;
}

/* Landing page */
.landing{text-align:center;padding:80px 0}
.landing h1{font-size:2rem;color:var(--accent);margin-bottom:12px}
.landing p{color:var(--muted);font-size:1.05rem}

/* Build header */
.build-header{margin-bottom:24px}
.build-header h1{font-size:1.8rem;margin-bottom:6px}
.build-meta{color:var(--muted);font-size:.9rem;margin-bottom:8px}
.tag-pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tag-pill{
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:999px;
  padding:4px 10px;
  font-size:.78rem;
  color:var(--accent-2);
}

/* Tabs */
.tab-bar{display:flex;gap:4px;margin-bottom:20px;border-bottom:2px solid var(--line)}
.tab{
  background:none;
  border:none;
  color:var(--muted);
  font-family:'Exo 2',sans-serif;
  font-size:.9rem;
  font-weight:600;
  padding:10px 20px;
  cursor:pointer;
  border-bottom:2px solid transparent;
  margin-bottom:-2px;
  transition:color .15s,border-color .15s;
}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-content{display:none}
.tab-content.active{display:block}

/* Spec row */
.spec-row{
  display:flex;
  gap:12px;
  align-items:center;
  padding:10px 14px;
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:10px;
  margin-bottom:8px;
}
.spec-row .spec-name{font-weight:600;font-size:1rem}
.spec-row .spec-traits{color:var(--muted);font-size:.85rem}

/* Trait grid */
.trait-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(180px,1fr));
  gap:8px;
  margin-top:8px;
}

/* Skill bar */
.skill-bar{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-top:12px;
}
.skill-bar .skill-slot{
  display:flex;
  align-items:center;
  gap:8px;
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:8px;
  padding:8px 12px;
  font-size:.85rem;
}
.skill-bar .skill-slot img{
  width:32px;height:32px;
  border-radius:6px;
  border:1px solid var(--line);
  background:#0a1020;
}

/* Equipment panel */
.equipment-panel{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(200px,1fr));
  gap:10px;
  margin-top:12px;
}
.equipment-panel .equip-field{
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:10px;
  padding:12px;
}
.equipment-panel .equip-label{color:var(--accent-2);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.equipment-panel .equip-value{font-size:.95rem}

/* Tooltip (placeholder) */
.tooltip{
  position:absolute;
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:8px;
  padding:8px 12px;
  font-size:.82rem;
  pointer-events:none;
  z-index:100;
  max-width:280px;
}

/* Section headings */
.section-heading{
  color:var(--accent-2);
  font-size:.78rem;
  text-transform:uppercase;
  letter-spacing:.08em;
  margin:20px 0 8px;
}
`;

const SPA_APP_JS = `(function() {
"use strict";

var app = document.getElementById("app");

// ---- Utilities ----

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function base64urlDecode(str) {
  var base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  var pad = base64.length % 4;
  if (pad) base64 += "====".slice(pad);
  var bin = atob(base64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---- SPA Routing ----

function init() {
  // Check sessionStorage for redirect from 404.html
  var redirect = null;
  try {
    var stored = sessionStorage.getItem("spa-redirect");
    if (stored) {
      redirect = JSON.parse(stored);
      sessionStorage.removeItem("spa-redirect");
    }
  } catch(e) {}

  var hash = redirect ? redirect.hash : location.hash;
  var path = redirect ? redirect.path : getBuildPath();

  if (!hash || hash.length < 2) {
    showLanding();
    return;
  }

  var fragment = hash.substring(1);
  var dotIndex = fragment.indexOf(".");
  if (dotIndex < 1) {
    showError("Invalid build link. Expected format: #fileId.key");
    return;
  }

  var fileId = fragment.substring(0, dotIndex);
  var key = fragment.substring(dotIndex + 1);

  showLoading();
  loadBuild(fileId, key);
}

function getBuildPath() {
  var seg = location.pathname.split("/").filter(Boolean);
  return seg.slice(1).join("/");
}

function showLanding() {
  app.innerHTML = '<div class="landing"><h1>AxiForge Builds</h1><p>Share your Guild Wars 2 builds with encrypted links.</p></div>';
}

function showLoading() {
  app.innerHTML = '<div class="loading">Loading build&hellip;</div>';
}

function showError(msg) {
  app.innerHTML = '<div class="error-box">' + escapeHtml(msg) + '</div>';
}

// ---- Fetch & Decrypt ----

function loadBuild(fileId, base64urlKey) {
  fetch("builds/" + fileId + ".enc", { cache: "no-store" })
    .then(function(res) {
      if (!res.ok) throw new Error("Build not found (HTTP " + res.status + ")");
      return res.text();
    })
    .then(function(base64Data) {
      return decryptPayload(base64Data, base64urlKey);
    })
    .then(function(buildData) {
      renderBuild(buildData);
    })
    .catch(function(err) {
      showError(err.message || String(err));
    });
}

function decryptPayload(base64Data, base64urlKey) {
  var combined = Uint8Array.from(atob(base64Data), function(c) { return c.charCodeAt(0); });
  var iv = combined.slice(0, 12);
  var ciphertext = combined.slice(12);
  var keyBytes = base64urlDecode(base64urlKey);

  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"])
    .then(function(cryptoKey) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, cryptoKey, ciphertext);
    })
    .then(function(plainBuf) {
      var decoder = new TextDecoder();
      return JSON.parse(decoder.decode(plainBuf));
    });
}

// ---- Render ----

function renderBuild(build) {
  var html = [];

  // Header
  html.push('<div class="build-header">');
  html.push('<h1>' + escapeHtml(build.title || "Untitled Build") + '</h1>');
  html.push('<div class="build-meta">');
  if (build.profession) html.push(escapeHtml(build.profession));
  if (build.gameMode) html.push(' &middot; ' + escapeHtml(build.gameMode));
  html.push('</div>');
  if (Array.isArray(build.tags) && build.tags.length) {
    html.push('<div class="tag-pills">');
    for (var i = 0; i < build.tags.length; i++) {
      html.push('<span class="tag-pill">' + escapeHtml(build.tags[i]) + '</span>');
    }
    html.push('</div>');
  }
  html.push('</div>');

  // Tabs
  html.push('<div class="tab-bar">');
  html.push('<button class="tab active" data-tab="build">BUILD</button>');
  html.push('<button class="tab" data-tab="equipment">EQUIPMENT</button>');
  html.push('</div>');

  // BUILD tab content
  html.push('<div class="tab-content active" id="tab-build">');
  html.push(renderSpecializations(build.specializations));
  html.push(renderSkills(build.skills));
  html.push('</div>');

  // EQUIPMENT tab content
  html.push('<div class="tab-content" id="tab-equipment">');
  html.push(renderEquipment(build.equipment));
  html.push('</div>');

  app.innerHTML = html.join("");

  // Tab switching
  var tabs = app.querySelectorAll(".tab");
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener("click", onTabClick);
  }
}

function onTabClick(e) {
  var tabName = e.currentTarget.getAttribute("data-tab");
  var tabs = app.querySelectorAll(".tab");
  var contents = app.querySelectorAll(".tab-content");
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");
  for (var j = 0; j < contents.length; j++) contents[j].classList.remove("active");
  e.currentTarget.classList.add("active");
  var target = document.getElementById("tab-" + tabName);
  if (target) target.classList.add("active");
}

function renderSpecializations(specs) {
  if (!Array.isArray(specs) || !specs.length) return '<p class="section-heading">No specializations.</p>';
  var html = '<h3 class="section-heading">Specializations</h3>';
  for (var i = 0; i < specs.length; i++) {
    var s = specs[i];
    if (!s) continue;
    html += '<div class="spec-row">';
    html += '<span class="spec-name">' + escapeHtml(s.name || "Unknown") + '</span>';
    html += '</div>';
  }
  return html;
}

function renderSkills(skills) {
  if (!skills) return '';
  var html = '<h3 class="section-heading">Skills</h3><div class="skill-bar">';
  if (skills.heal) html += renderSkillSlot(skills.heal);
  if (Array.isArray(skills.utility)) {
    for (var i = 0; i < skills.utility.length; i++) {
      if (skills.utility[i]) html += renderSkillSlot(skills.utility[i]);
    }
  }
  if (skills.elite) html += renderSkillSlot(skills.elite);
  html += '</div>';
  return html;
}

function renderSkillSlot(skill) {
  var icon = skill.icon
    ? '<img src="' + escapeAttr(skill.icon) + '" alt="" loading="lazy" />'
    : '';
  return '<div class="skill-slot">' + icon + '<span>' + escapeHtml(skill.name || "Unknown Skill") + '</span></div>';
}

function renderEquipment(equip) {
  if (!equip || typeof equip !== "object") return '<p class="section-heading">No equipment data.</p>';
  var fields = ["statPackage", "relic", "food", "utility", "enrichment"];
  var labels = { statPackage: "Stat Package", relic: "Relic", food: "Food", utility: "Utility", enrichment: "Enrichment" };
  var html = '<h3 class="section-heading">Equipment</h3><div class="equipment-panel">';
  for (var i = 0; i < fields.length; i++) {
    var key = fields[i];
    var val = equip[key];
    if (!val) continue;
    html += '<div class="equip-field">';
    html += '<div class="equip-label">' + escapeHtml(labels[key] || key) + '</div>';
    html += '<div class="equip-value">' + escapeHtml(val) + '</div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// ---- Start ----
init();

})();
`;

module.exports = { buildSpaBundle, buildEncryptedBuildFile };
