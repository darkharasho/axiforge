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

/* Spec icon */
.spec-icon{width:36px;height:36px;border-radius:50%;border:2px solid var(--line);object-fit:cover}
.spec-info{display:flex;flex-direction:column;gap:4px;flex:1}
.elite-badge{color:var(--accent);font-size:.65rem;font-weight:700;letter-spacing:.08em;margin-left:6px}

/* Trait grid */
.trait-grid{
  display:flex;
  gap:6px;
  align-items:center;
  margin-top:6px;
  flex-wrap:wrap;
}
.tier-group{display:flex;gap:4px;align-items:center}
.tier-sep{width:1px;height:24px;background:var(--line);margin:0 4px}
.trait-icon{
  width:24px;height:24px;
  border-radius:50%;
  border:2px solid var(--line);
  overflow:hidden;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  opacity:.5;
}
.trait-icon--selected{border-color:var(--accent);opacity:1}
.trait-img{width:24px;height:24px;border-radius:50%;object-fit:cover}
.minorTrait{
  width:20px;height:20px;
  border-radius:50%;
  border:2px solid var(--accent-2);
  overflow:hidden;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  margin-right:2px;
}
.minorTrait img{width:20px;height:20px;border-radius:50%;object-fit:cover}

/* Skill separator & icon */
.skill-sep{width:2px;height:36px;background:var(--line);margin:0 4px;align-self:center}
.skill-icon{width:36px;height:36px;border-radius:6px;border:1px solid var(--line);background:#0a1020;cursor:pointer}

/* Underwater section */
.uw-section{margin-top:12px;padding-top:8px;border-top:1px solid var(--line)}
.uw-section .section-heading{margin-top:8px}

/* Mechanic section */
.mechanic-section{
  display:flex;
  gap:8px;
  align-items:center;
  margin-top:8px;
  padding:6px 10px;
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:8px;
  font-size:.85rem;
  color:var(--muted);
}

/* Equipment panel (two-column) */
.eq-panel{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
  margin-top:12px;
}
@media(max-width:640px){.eq-panel{grid-template-columns:1fr}}
.eq-col{display:flex;flex-direction:column;gap:8px}
.eq-card{
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:10px;
  padding:10px 14px;
}
.eq-label{color:var(--accent-2);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.eq-value{font-size:.95rem}
.eq-slot{
  display:flex;
  gap:8px;
  align-items:center;
  padding:4px 0;
  border-bottom:1px solid var(--line);
  font-size:.85rem;
}
.eq-slot:last-child{border-bottom:none}
.eq-slot-name{font-weight:600;min-width:80px;text-transform:capitalize}
.eq-slot-stat{color:var(--muted);flex:1}
.eq-slot-rune{color:var(--accent);font-size:.8rem}
.eq-weapon-row{
  display:flex;
  gap:8px;
  align-items:center;
  padding:6px 0;
  border-bottom:1px solid var(--line);
  font-size:.85rem;
}
.eq-weapon-row:last-child{border-bottom:none}
.eq-sigils{display:flex;gap:6px;flex-wrap:wrap}
.eq-sigil{
  background:rgba(72,168,255,.1);
  border:1px solid rgba(72,168,255,.3);
  border-radius:6px;
  padding:2px 8px;
  font-size:.78rem;
  color:var(--accent-2);
}

/* Tooltip */
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
  display:none;
}
.tooltip.visible{display:block}
.tooltip__name{font-weight:700;color:var(--accent);margin-bottom:4px}
.tooltip__desc{color:var(--muted);font-size:.78rem;line-height:1.4}

/* Bundle expansion */
.bundle-expand{
  display:none;
  flex-direction:column;
  gap:4px;
  padding:6px 8px;
  margin-top:4px;
  background:rgba(16,25,48,.8);
  border:1px solid var(--line);
  border-radius:6px;
}
.bundle-expand.open{display:flex}
.bundle-skill{
  display:flex;
  align-items:center;
  gap:6px;
  font-size:.8rem;
  color:var(--muted);
}
.bundle-skill img{width:24px;height:24px;border-radius:4px}

/* Notes box */
.notes-box{
  color:var(--muted);
  padding:12px 14px;
  border:1px solid var(--line);
  border-radius:8px;
  background:var(--panel);
  font-size:.88rem;
  line-height:1.5;
  margin-top:12px;
  white-space:pre-wrap;
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
  html.push(renderSkills(build.skills, build));
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
    if (s.icon) {
      html += '<img class="spec-icon" src="' + escapeAttr(s.icon) + '" alt="" loading="lazy" />';
    }
    html += '<div class="spec-info">';
    html += '<span class="spec-name">' + escapeHtml(s.name || "Unknown");
    if (s.elite) html += '<span class="elite-badge">ELITE</span>';
    html += '</span>';
    html += renderTraitGrid(s);
    html += '</div>';
    html += '</div>';
  }
  return html;
}

function renderTraitGrid(s) {
  var html = '<div class="trait-grid">';
  var tiers = [1, 2, 3];
  for (var t = 0; t < tiers.length; t++) {
    var tier = tiers[t];
    if (t > 0) html += '<span class="tier-sep"></span>';
    // Minor trait
    if (s.minorTraits && s.minorTraits[t]) {
      var mt = s.minorTraits[t];
      html += '<span class="minorTrait" data-name="' + escapeAttr(mt.name || "") + '" data-desc="' + escapeAttr(mt.description || "") + '">';
      if (mt.icon) html += '<img src="' + escapeAttr(mt.icon) + '" alt="" loading="lazy" />';
      html += '</span>';
    }
    // Major traits
    html += '<span class="tier-group">';
    var majors = (s.majorTraitsByTier && s.majorTraitsByTier[tier]) || [];
    var selectedId = (s.majorChoices && s.majorChoices[tier]) || null;
    for (var m = 0; m < majors.length; m++) {
      var tr = majors[m];
      var sel = (tr.id === selectedId) ? " trait-icon--selected" : "";
      html += '<span class="trait-icon' + sel + '" data-name="' + escapeAttr(tr.name || "") + '" data-desc="' + escapeAttr(tr.description || "") + '">';
      if (tr.icon) html += '<img class="trait-img" src="' + escapeAttr(tr.icon) + '" alt="" loading="lazy" />';
      html += '</span>';
    }
    html += '</span>';
  }
  html += '</div>';
  return html;
}

function renderSkills(skills, build) {
  if (!skills) return '';
  var html = '<h3 class="section-heading">Skills</h3><div class="skill-bar">';
  // Heal
  if (skills.heal) html += renderSkillSlot(skills.heal, "heal");
  html += '<span class="skill-sep"></span>';
  // Utilities
  if (Array.isArray(skills.utility)) {
    for (var i = 0; i < skills.utility.length; i++) {
      if (skills.utility[i]) html += renderSkillSlot(skills.utility[i], "utility");
    }
  }
  html += '<span class="skill-sep"></span>';
  // Elite
  if (skills.elite) html += renderSkillSlot(skills.elite, "elite");
  html += '</div>';

  // Underwater skills
  if (build && build.underwaterSkills) {
    var uw = build.underwaterSkills;
    html += '<div class="uw-section">';
    html += '<h3 class="section-heading">Underwater Skills</h3><div class="skill-bar">';
    if (uw.heal) html += renderSkillSlot(uw.heal, "heal");
    html += '<span class="skill-sep"></span>';
    if (Array.isArray(uw.utility)) {
      for (var u = 0; u < uw.utility.length; u++) {
        if (uw.utility[u]) html += renderSkillSlot(uw.utility[u], "utility");
      }
    }
    html += '<span class="skill-sep"></span>';
    if (uw.elite) html += renderSkillSlot(uw.elite, "elite");
    html += '</div></div>';
  }

  // Profession mechanics
  if (build) {
    if (build.selectedLegends && build.selectedLegends.length) {
      html += '<div class="mechanic-section"><strong>Legends:</strong> ' + escapeHtml(build.selectedLegends.join(", ")) + '</div>';
    }
    if (build.selectedPets && build.selectedPets.length) {
      html += '<div class="mechanic-section"><strong>Pets:</strong> ' + escapeHtml(build.selectedPets.join(", ")) + '</div>';
    }
    if (build.activeAttunement) {
      var att = escapeHtml(build.activeAttunement);
      if (build.activeAttunement2) att += " / " + escapeHtml(build.activeAttunement2);
      html += '<div class="mechanic-section"><strong>Attunement:</strong> ' + att + '</div>';
    }
  }

  return html;
}

function renderSkillSlot(skill, slotType) {
  var bundleAttr = '';
  if (skill.bundle) {
    bundleAttr = ' data-bundle="' + escapeAttr(JSON.stringify(skill.bundle)) + '"';
  }
  var icon = skill.icon
    ? '<img class="skill-icon" src="' + escapeAttr(skill.icon) + '" alt="" loading="lazy" />'
    : '';
  return '<div class="skill-slot" data-slot="' + escapeAttr(slotType || "") + '" data-name="' + escapeAttr(skill.name || "") + '" data-desc="' + escapeAttr(skill.description || "") + '"' + bundleAttr + '>'
    + icon + '<span>' + escapeHtml(skill.name || "Unknown Skill") + '</span>'
    + '<div class="bundle-expand"></div>'
    + '</div>';
}

function renderEquipment(equip) {
  if (!equip || typeof equip !== "object") return '<p class="section-heading">No equipment data.</p>';
  var html = '<h3 class="section-heading">Equipment</h3><div class="eq-panel">';

  // Left column
  html += '<div class="eq-col">';

  // Stat package card
  if (equip.statPackage) {
    html += '<div class="eq-card"><div class="eq-label">Stat Package</div><div class="eq-value">' + escapeHtml(equip.statPackage) + '</div></div>';
  }

  // Armor slots
  var armorSlots = ["head", "shoulders", "chest", "hands", "legs", "feet"];
  html += '<div class="eq-card"><div class="eq-label">Armor</div>';
  for (var a = 0; a < armorSlots.length; a++) {
    var slotName = armorSlots[a];
    var slotStat = (equip.slots && equip.slots[slotName]) || "";
    var slotRune = (equip.runes && equip.runes[slotName]) || "";
    html += '<div class="eq-slot">';
    html += '<span class="eq-slot-name">' + escapeHtml(slotName) + '</span>';
    html += '<span class="eq-slot-stat">' + escapeHtml(slotStat) + '</span>';
    if (slotRune) html += '<span class="eq-slot-rune">' + escapeHtml(slotRune) + '</span>';
    html += '</div>';
  }
  html += '</div>';

  // Trinkets
  var trinketSlots = ["back", "amulet", "ring1", "ring2", "accessory1", "accessory2"];
  html += '<div class="eq-card"><div class="eq-label">Trinkets</div>';
  for (var tr = 0; tr < trinketSlots.length; tr++) {
    var tName = trinketSlots[tr];
    var tStat = (equip.slots && equip.slots[tName]) || "";
    html += '<div class="eq-slot">';
    html += '<span class="eq-slot-name">' + escapeHtml(tName) + '</span>';
    html += '<span class="eq-slot-stat">' + escapeHtml(tStat) + '</span>';
    html += '</div>';
  }
  html += '</div>';

  html += '</div>'; // end left col

  // Right column
  html += '<div class="eq-col">';

  // Weapons
  var weaponSets = [
    { label: "Set 1", slots: ["mainhand1", "offhand1"] },
    { label: "Set 2", slots: ["mainhand2", "offhand2"] },
    { label: "Aquatic 1", slots: ["aquaticMainhand1", "aquaticOffhand1"] },
    { label: "Aquatic 2", slots: ["aquaticMainhand2", "aquaticOffhand2"] }
  ];
  html += '<div class="eq-card"><div class="eq-label">Weapons</div>';
  for (var ws = 0; ws < weaponSets.length; ws++) {
    var wset = weaponSets[ws];
    var hasWeapon = false;
    for (var wi = 0; wi < wset.slots.length; wi++) {
      if (equip.weapons && equip.weapons[wset.slots[wi]]) { hasWeapon = true; break; }
    }
    if (!hasWeapon) continue;
    html += '<div class="eq-label" style="margin-top:6px">' + escapeHtml(wset.label) + '</div>';
    for (var wj = 0; wj < wset.slots.length; wj++) {
      var wSlot = wset.slots[wj];
      var wName = (equip.weapons && equip.weapons[wSlot]) || "";
      if (!wName) continue;
      html += '<div class="eq-weapon-row">';
      html += '<span class="eq-slot-name">' + escapeHtml(wSlot) + '</span>';
      html += '<span>' + escapeHtml(wName) + '</span>';
      // Sigils
      var sigils = (equip.sigils && equip.sigils[wSlot]) || [];
      if (sigils.length) {
        html += '<span class="eq-sigils">';
        for (var si = 0; si < sigils.length; si++) {
          if (sigils[si]) html += '<span class="eq-sigil">' + escapeHtml(sigils[si]) + '</span>';
        }
        html += '</span>';
      }
      html += '</div>';
    }
  }
  html += '</div>';

  // Rune summary
  if (equip.runes) {
    var runeCounts = {};
    var runeKeys = Object.keys(equip.runes);
    for (var ri = 0; ri < runeKeys.length; ri++) {
      var rv = equip.runes[runeKeys[ri]];
      if (rv) runeCounts[rv] = (runeCounts[rv] || 0) + 1;
    }
    var runeNames = Object.keys(runeCounts);
    if (runeNames.length) {
      html += '<div class="eq-card"><div class="eq-label">Runes</div>';
      for (var rn = 0; rn < runeNames.length; rn++) {
        html += '<div class="eq-value">' + runeCounts[runeNames[rn]] + '\\u00d7 ' + escapeHtml(runeNames[rn]) + '</div>';
      }
      html += '</div>';
    }
  }

  // Relic, food, utility, enrichment
  var consumables = [
    { key: "relic", label: "Relic" },
    { key: "food", label: "Food" },
    { key: "utility", label: "Utility" },
    { key: "enrichment", label: "Enrichment" }
  ];
  for (var ci = 0; ci < consumables.length; ci++) {
    var cv = equip[consumables[ci].key];
    if (cv) {
      html += '<div class="eq-card"><div class="eq-label">' + escapeHtml(consumables[ci].label) + '</div><div class="eq-value">' + escapeHtml(cv) + '</div></div>';
    }
  }

  // Infusions summary
  if (equip.infusions) {
    var infCounts = {};
    var infKeys = Object.keys(equip.infusions);
    for (var ii = 0; ii < infKeys.length; ii++) {
      var infVal = equip.infusions[infKeys[ii]];
      if (Array.isArray(infVal)) {
        for (var ij = 0; ij < infVal.length; ij++) {
          if (infVal[ij]) infCounts[infVal[ij]] = (infCounts[infVal[ij]] || 0) + 1;
        }
      } else if (infVal) {
        infCounts[infVal] = (infCounts[infVal] || 0) + 1;
      }
    }
    var infNames = Object.keys(infCounts);
    if (infNames.length) {
      html += '<div class="eq-card"><div class="eq-label">Infusions</div>';
      for (var ink = 0; ink < infNames.length; ink++) {
        html += '<div class="eq-value">' + infCounts[infNames[ink]] + '\\u00d7 ' + escapeHtml(infNames[ink]) + '</div>';
      }
      html += '</div>';
    }
  }

  html += '</div>'; // end right col
  html += '</div>'; // end eq-panel
  return html;
}

// ---- Tooltip System ----

function initTooltip() {
  var tip = document.createElement("div");
  tip.className = "tooltip";
  tip.innerHTML = '<div class="tooltip__name"></div><div class="tooltip__desc"></div>';
  document.body.appendChild(tip);

  document.addEventListener("mouseover", function(e) {
    var el = e.target.closest("[data-name]");
    if (!el) return;
    var name = el.getAttribute("data-name");
    var description = el.getAttribute("data-desc");
    if (!name && !description) return;
    tip.querySelector(".tooltip__name").textContent = name || "";
    tip.querySelector(".tooltip__desc").textContent = description || "";
    var rect = el.getBoundingClientRect();
    tip.style.left = (rect.left + window.scrollX) + "px";
    tip.style.top = (rect.bottom + window.scrollY + 6) + "px";
    tip.classList.add("visible");
  });

  document.addEventListener("mouseout", function(e) {
    var el = e.target.closest("[data-name]");
    if (el) tip.classList.remove("visible");
  });
}

// ---- Bundle Expansion ----

function initBundleExpansion() {
  document.addEventListener("click", function(e) {
    var slot = e.target.closest("[data-bundle]");
    if (!slot) return;
    var expand = slot.querySelector(".bundle-expand");
    if (!expand) return;
    if (expand.classList.contains("open")) {
      expand.classList.remove("open");
      expand.innerHTML = "";
      return;
    }
    try {
      var bundle = JSON.parse(slot.getAttribute("data-bundle"));
      var bhtml = "";
      for (var b = 0; b < bundle.length; b++) {
        var bs = bundle[b];
        bhtml += '<div class="bundle-skill">';
        if (bs.icon) bhtml += '<img src="' + escapeAttr(bs.icon) + '" alt="" loading="lazy" />';
        bhtml += '<span>' + escapeHtml(bs.name || "") + '</span>';
        bhtml += '</div>';
      }
      expand.innerHTML = bhtml;
      expand.classList.add("open");
    } catch(ex) {}
  });
}

// ---- Start ----
init();
initTooltip();
initBundleExpansion();

})();
`;

module.exports = { buildSpaBundle, buildEncryptedBuildFile };
