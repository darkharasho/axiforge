"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { encryptBuild } = require("./buildEncryption");

// Read desktop CSS files for the SPA bundle
const RENDERER_STYLES_DIR = path.join(__dirname, "../renderer/styles");
function readStyle(name) {
  return fs.readFileSync(path.join(RENDERER_STYLES_DIR, name), "utf8");
}

const DESKTOP_CSS = [
  readStyle("base.css"),
  readStyle("specializations.css"),
  readStyle("skills.css"),
  readStyle("equipment.css"),
  readStyle("detail-panel.css"),
  readStyle("buttons.css"),
].join("\n");

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

const SPA_EXTRA_CSS = `
/* Navbar */
.navbar { display:flex; align-items:center; justify-content:space-between; padding:12px 24px; background:var(--panel); border-bottom:1px solid var(--line-soft); }
.navbar-brand { display:flex; align-items:center; gap:10px; }
.navbar-logo { font-size:1.5rem; }
.navbar-title { font-family:'Cinzel',serif; font-size:1.2rem; color:var(--accent); font-weight:700; }
.navbar-links { display:flex; gap:16px; }
.navbar-link { color:var(--accent-2); text-decoration:none; font-size:.9rem; }
.navbar-link:hover { text-decoration:underline; }

/* SPA container */
#app { width:min(1100px,94vw); margin:32px auto 48px; }

/* Landing page */
.landing { text-align:center; padding:80px 0; }
.landing h1 { font-size:2rem; color:var(--accent); margin-bottom:12px; }
.landing p { color:var(--muted); font-size:1.05rem; }

/* Loading & error */
.loading { text-align:center; padding:48px 0; color:var(--muted); font-size:1.1rem; }
.error-box { background:rgba(255,60,60,.12); border:1px solid rgba(255,60,60,.4); border-radius:10px; padding:20px; color:#ff8888; text-align:center; }

/* Build header */
.build-header { margin-bottom:24px; }
.build-header h1 { font-size:1.8rem; margin-bottom:6px; }
.build-meta { color:var(--muted); font-size:.9rem; margin-bottom:8px; }
.tag-pills { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.tag-pill { background:var(--panel); border:1px solid var(--line-soft); border-radius:999px; padding:4px 10px; font-size:.78rem; color:var(--accent-2); }

/* Tabs */
.tab-bar { display:flex; gap:4px; margin-bottom:20px; border-bottom:2px solid var(--line-soft); }
.tab { background:none; border:none; color:var(--muted); font-family:'Exo 2',sans-serif; font-size:.9rem; font-weight:600; padding:10px 20px; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-2px; transition:color .15s,border-color .15s; }
.tab:hover { color:var(--text); }
.tab.active { color:var(--accent); border-bottom-color:var(--accent); }
.tab-content { display:none; }
.tab-content.active { display:block; }

/* Section headings */
.section-heading { color:var(--accent-2); font-size:.78rem; text-transform:uppercase; letter-spacing:.08em; margin:20px 0 8px; font-family:'Exo 2',sans-serif; }

/* Notes box */
.notes-box { color:var(--muted); padding:12px 14px; border:1px solid var(--line-soft); border-radius:8px; background:var(--panel); font-size:.88rem; line-height:1.5; margin-top:12px; white-space:pre-wrap; }

/* Mechanic section */
.mechanic-section { display:flex; gap:8px; align-items:center; margin-top:8px; padding:6px 10px; background:var(--panel); border:1px solid var(--line-soft); border-radius:8px; font-size:.85rem; color:var(--muted); }

/* Read-only tooltip (reuses desktop .hover-preview) */
.spa-tooltip { position:fixed; z-index:120; display:none; }
.spa-tooltip.visible { display:block; }

/* SPA spec card read-only — disable interactive cursor */
.spec-card { cursor:default; }
.spec-emblem { cursor:default; }
.trait-btn { cursor:default; }

/* Underwater section */
.uw-section { margin-top:12px; padding-top:8px; border-top:1px solid var(--line-soft); }
.uw-section .section-heading { margin-top:8px; }

/* SPA skill bar legacy compat */
.skill-sep { width:2px; height:40px; background:var(--line-soft); margin:0 6px; align-self:center; }
`;

const SPA_STYLES_CSS = DESKTOP_CSS + "\n" + SPA_EXTRA_CSS;

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

// ---- Specialization Rendering (desktop DOM structure) ----

function renderSpecializations(specs) {
  if (!Array.isArray(specs) || !specs.length) return '<p class="section-heading">No specializations.</p>';
  var html = '<h3 class="section-heading">Specializations</h3>';
  html += '<div class="specializations-host">';
  for (var i = 0; i < specs.length; i++) {
    var s = specs[i];
    if (!s) continue;
    var elitePanelClass = s.elite ? " spec-card__panel--elite" : "";
    var bgStyle = s.background ? 'background-image:url(' + escapeAttr(s.background) + ')' : '';

    html += '<article class="spec-card">';
    html += '<div class="spec-card__panel' + elitePanelClass + '" style="' + bgStyle + '">';
    html += '<div class="spec-card__body">';

    // Emblem
    var emblemClass = s.elite ? "spec-emblem spec-emblem--elite" : "spec-emblem";
    html += '<div class="' + emblemClass + '">';
    if (s.icon) {
      html += '<img src="' + escapeAttr(s.icon) + '" alt="' + escapeAttr(s.name || "Specialization") + '" loading="lazy" />';
    }
    html += '</div>';

    // Trait tiers (1, 2, 3)
    var tiers = [1, 2, 3];
    for (var t = 0; t < tiers.length; t++) {
      var tier = tiers[t];
      // Minor trait anchor
      html += '<div class="trait-minor-anchor">';
      if (s.minorTraits && s.minorTraits[t]) {
        var mt = s.minorTraits[t];
        html += '<button type="button" class="trait-btn trait-btn--always" disabled data-name="' + escapeAttr(mt.name || "") + '" data-desc="' + escapeAttr(mt.description || "") + '">';
        if (mt.icon) html += '<img src="' + escapeAttr(mt.icon) + '" alt="" loading="lazy" />';
        html += '</button>';
      }
      html += '</div>';

      // Major trait column
      html += '<div class="trait-column trait-column--major">';
      var majors = (s.majorTraitsByTier && s.majorTraitsByTier[tier]) || [];
      var selectedId = (s.majorChoices && s.majorChoices[tier]) || null;
      for (var m = 0; m < majors.length; m++) {
        var tr = majors[m];
        var isActive = (tr.id === selectedId);
        var traitClass = "trait-btn" + (isActive ? " trait-btn--active" : "");
        html += '<button type="button" class="' + traitClass + '" disabled data-name="' + escapeAttr(tr.name || "") + '" data-desc="' + escapeAttr(tr.description || "") + '">';
        if (tr.icon) html += '<img src="' + escapeAttr(tr.icon) + '" alt="" loading="lazy" />';
        html += '</button>';
      }
      html += '</div>';
    }

    html += '</div>'; // spec-card__body
    html += '</div>'; // spec-card__panel
    html += '</article>'; // spec-card
  }
  html += '</div>'; // specializations-host
  return html;
}

// ---- Skill Rendering (desktop DOM structure) ----

function renderSkills(skills, build) {
  if (!skills) return '';
  var html = '<h3 class="section-heading">Skills</h3>';

  // Weapon skills
  if (skills.weaponSkills && skills.weaponSkills.length) {
    html += '<div class="skills-bar__weapon-col">';
    html += '<div class="skills-bar__weapon-row">';
    html += '<div class="skills-bar">';
    html += '<div class="skill-group">';
    for (var w = 0; w < skills.weaponSkills.length; w++) {
      var ws = skills.weaponSkills[w];
      if (!ws) continue;
      html += '<div class="skill-slot">';
      html += '<div class="skill-icon-large skill-icon--weapon" data-name="' + escapeAttr(ws.name || "") + '" data-desc="' + escapeAttr(ws.description || "") + '">';
      if (ws.icon) html += '<img src="' + escapeAttr(ws.icon) + '" alt="" loading="lazy" />';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>'; // skill-group
    html += '</div>'; // skills-bar
    html += '</div>'; // skills-bar__weapon-row
    html += '</div>'; // skills-bar__weapon-col
  }

  // Heal / Utility / Elite bar
  html += '<div class="skills-bar">';
  html += '<div class="skill-group skill-group--utilities">';
  // Heal
  if (skills.heal) {
    html += renderSkillSlot(skills.heal, "Heal");
  }
  // Utilities
  if (Array.isArray(skills.utility)) {
    for (var u = 0; u < skills.utility.length; u++) {
      if (skills.utility[u]) html += renderSkillSlot(skills.utility[u], "Utility");
    }
  }
  // Elite
  if (skills.elite) {
    html += renderSkillSlot(skills.elite, "Elite");
  }
  html += '</div>'; // skill-group--utilities
  html += '</div>'; // skills-bar

  // Underwater skills
  if (build && build.underwaterSkills) {
    var uw = build.underwaterSkills;
    html += '<div class="uw-section">';
    html += '<h3 class="section-heading">Underwater Skills</h3>';
    html += '<div class="skills-bar">';
    html += '<div class="skill-group skill-group--utilities">';
    if (uw.heal) html += renderSkillSlot(uw.heal, "Heal");
    if (Array.isArray(uw.utility)) {
      for (var uw2 = 0; uw2 < uw.utility.length; uw2++) {
        if (uw.utility[uw2]) html += renderSkillSlot(uw.utility[uw2], "Utility");
      }
    }
    if (uw.elite) html += renderSkillSlot(uw.elite, "Elite");
    html += '</div>';
    html += '</div>';
    html += '</div>';
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

function renderSkillSlot(skill, label) {
  var bundleAttr = '';
  if (skill.bundle) {
    bundleAttr = ' data-bundle="' + escapeAttr(JSON.stringify(skill.bundle)) + '"';
  }
  var html = '<div class="skill-slot" data-name="' + escapeAttr(skill.name || "") + '" data-desc="' + escapeAttr(skill.description || "") + '"' + bundleAttr + '>';
  html += '<div class="skill-icon-large" data-name="' + escapeAttr(skill.name || "") + '" data-desc="' + escapeAttr(skill.description || "") + '">';
  if (skill.icon) html += '<img src="' + escapeAttr(skill.icon) + '" alt="" loading="lazy" />';
  html += '</div>';
  html += '<div class="skill-slot-label">' + escapeHtml(label || "") + '</div>';
  html += '<div class="bundle-expand"></div>';
  html += '</div>';
  return html;
}

// ---- Equipment Rendering (desktop DOM structure) ----

function renderEquipment(equip) {
  if (!equip || typeof equip !== "object") return '<p class="section-heading">No equipment data.</p>';
  var html = '<h3 class="section-heading">Equipment</h3>';
  html += '<div class="equip-layout">';

  // Left column
  html += '<div class="equip-col equip-col--left">';

  // Armor section
  var armorSlots = ["head", "shoulders", "chest", "hands", "legs", "feet"];
  html += '<section class="equip-section">';
  html += '<div class="equip-section__head"><span>ARMOR</span></div>';
  for (var a = 0; a < armorSlots.length; a++) {
    var slotName = armorSlots[a];
    var slotStat = (equip.slots && equip.slots[slotName]) || "";
    var slotRune = (equip.runes && equip.runes[slotName]) || "";
    var slotIcon = (equip.icons && equip.icons[slotName]) || "";
    var iconFilledClass = slotIcon ? " equip-slot__icon--filled" : "";
    html += '<div class="equip-slot equip-slot--compact">';
    html += '<div class="equip-slot__icon' + iconFilledClass + '">';
    if (slotIcon) html += '<img src="' + escapeAttr(slotIcon) + '" alt="" loading="lazy" />';
    html += '</div>';
    html += '<div class="equip-slot__info">';
    html += '<div class="equip-slot__label">' + escapeHtml(slotName.charAt(0).toUpperCase() + slotName.slice(1)) + '</div>';
    if (slotStat) {
      html += '<div class="equip-slot__value">' + escapeHtml(slotStat) + '</div>';
    } else {
      html += '<div class="equip-slot__value equip-slot__value--empty">Empty</div>';
    }
    html += '</div>';
    // Rune upgrade
    html += '<div class="equip-upgrade-slots">';
    if (slotRune) {
      html += '<div class="equip-upgrade-btn equip-upgrade-btn--rune equip-upgrade-btn--filled" data-name="' + escapeAttr(slotRune) + '">R</div>';
    } else {
      html += '<div class="equip-upgrade-btn equip-upgrade-btn--rune">R</div>';
    }
    html += '</div>';
    html += '</div>'; // equip-slot
  }
  html += '</section>';

  // Weapons section
  var weaponSets = [
    { label: "Set 1", slots: ["mainhand1", "offhand1"] },
    { label: "Set 2", slots: ["mainhand2", "offhand2"] },
    { label: "Aquatic 1", slots: ["aquaticMainhand1", "aquaticOffhand1"] },
    { label: "Aquatic 2", slots: ["aquaticMainhand2", "aquaticOffhand2"] }
  ];
  html += '<section class="equip-section">';
  html += '<div class="equip-section__head"><span>WEAPONS</span></div>';
  for (var ws = 0; ws < weaponSets.length; ws++) {
    var wset = weaponSets[ws];
    var hasWeapon = false;
    for (var wi = 0; wi < wset.slots.length; wi++) {
      if (equip.weapons && equip.weapons[wset.slots[wi]]) { hasWeapon = true; break; }
    }
    if (!hasWeapon) continue;
    html += '<div class="equip-set-label">' + escapeHtml(wset.label) + '</div>';
    for (var wj = 0; wj < wset.slots.length; wj++) {
      var wSlot = wset.slots[wj];
      var wName = (equip.weapons && equip.weapons[wSlot]) || "";
      if (!wName) continue;
      var wIcon = (equip.weaponIcons && equip.weaponIcons[wSlot]) || "";
      var wIconFilled = wIcon ? " equip-slot__icon--filled equip-slot__icon--weapon" : "";
      var wStat = (equip.weaponStats && equip.weaponStats[wSlot]) || "";
      html += '<div class="equip-slot equip-slot--weapon">';
      html += '<div class="equip-weapon-type-btn">';
      html += '<div class="equip-slot__icon' + wIconFilled + '">';
      if (wIcon) html += '<img src="' + escapeAttr(wIcon) + '" alt="" loading="lazy" />';
      html += '</div>';
      html += '<span class="equip-weapon-name">' + escapeHtml(wName) + '</span>';
      html += '</div>';
      if (wStat) {
        html += '<div class="equip-stat-pick-btn">' + escapeHtml(wStat) + '</div>';
      }
      // Sigils
      var sigils = (equip.sigils && equip.sigils[wSlot]) || [];
      if (sigils.length) {
        html += '<div class="equip-upgrade-slots">';
        for (var si = 0; si < sigils.length; si++) {
          if (sigils[si]) {
            html += '<div class="equip-upgrade-btn equip-upgrade-btn--sigil equip-upgrade-btn--filled" data-name="' + escapeAttr(sigils[si]) + '">S</div>';
          } else {
            html += '<div class="equip-upgrade-btn equip-upgrade-btn--sigil">S</div>';
          }
        }
        html += '</div>';
      }
      html += '</div>'; // equip-slot--weapon
    }
  }
  html += '</section>';

  // Consumables section
  var consumables = [
    { key: "relic", label: "Relic" },
    { key: "food", label: "Food" },
    { key: "utility", label: "Utility" },
    { key: "enrichment", label: "Enrichment" }
  ];
  var hasConsumable = false;
  for (var ci = 0; ci < consumables.length; ci++) {
    if (equip[consumables[ci].key]) { hasConsumable = true; break; }
  }
  if (hasConsumable) {
    html += '<section class="equip-section">';
    html += '<div class="equip-section__head"><span>CONSUMABLES</span></div>';
    for (var cj = 0; cj < consumables.length; cj++) {
      var cv = equip[consumables[cj].key];
      if (!cv) continue;
      var cIcon = (equip.consumableIcons && equip.consumableIcons[consumables[cj].key]) || "";
      var cIconFilled = cIcon ? " equip-slot__icon--filled equip-slot__icon--consumable" : "";
      html += '<div class="equip-slot equip-slot--consumable">';
      html += '<div class="equip-slot__icon' + cIconFilled + '">';
      if (cIcon) html += '<img src="' + escapeAttr(cIcon) + '" alt="" loading="lazy" />';
      html += '</div>';
      html += '<div class="equip-slot__info">';
      html += '<div class="equip-slot__label">' + escapeHtml(consumables[cj].label) + '</div>';
      html += '<div class="equip-slot__consumable-name">' + escapeHtml(cv) + '</div>';
      html += '</div>';
      html += '</div>';
    }
    html += '</section>';
  }

  html += '</div>'; // equip-col--left

  // Right column
  html += '<div class="equip-col equip-col--right">';

  // Stat package
  if (equip.statPackage) {
    html += '<section class="equip-section">';
    html += '<div class="equip-section__head"><span>STAT PACKAGE</span></div>';
    html += '<div class="equip-slot"><div class="equip-slot__info"><div class="equip-slot__value">' + escapeHtml(equip.statPackage) + '</div></div></div>';
    html += '</section>';
  }

  // Trinkets section
  var trinketSlots = ["back", "amulet", "ring1", "ring2", "accessory1", "accessory2"];
  html += '<section class="equip-section">';
  html += '<div class="equip-section__head"><span>TRINKETS</span></div>';
  html += '<div class="equip-trinket-grid">';
  for (var tr = 0; tr < trinketSlots.length; tr++) {
    var tName = trinketSlots[tr];
    var tStat = (equip.slots && equip.slots[tName]) || "";
    var tIcon = (equip.trinketIcons && equip.trinketIcons[tName]) || "";
    var tIconFilled = tIcon ? " equip-slot__icon--filled" : "";
    html += '<div class="equip-slot equip-slot--compact">';
    html += '<div class="equip-slot__icon' + tIconFilled + '">';
    if (tIcon) html += '<img src="' + escapeAttr(tIcon) + '" alt="" loading="lazy" />';
    html += '</div>';
    html += '<div class="equip-slot__info">';
    html += '<div class="equip-slot__label">' + escapeHtml(tName) + '</div>';
    if (tStat) {
      html += '<div class="equip-slot__value">' + escapeHtml(tStat) + '</div>';
    } else {
      html += '<div class="equip-slot__value equip-slot__value--empty">Empty</div>';
    }
    html += '</div>';
    html += '</div>';
  }
  html += '</div>'; // equip-trinket-grid
  html += '</section>';

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
      html += '<section class="equip-section">';
      html += '<div class="equip-section__head"><span>RUNES</span></div>';
      for (var rn = 0; rn < runeNames.length; rn++) {
        html += '<div class="equip-slot"><div class="equip-slot__info"><div class="equip-slot__value">' + runeCounts[runeNames[rn]] + '\\u00d7 ' + escapeHtml(runeNames[rn]) + '</div></div></div>';
      }
      html += '</section>';
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
      html += '<section class="equip-section">';
      html += '<div class="equip-section__head"><span>INFUSIONS</span></div>';
      for (var ink = 0; ink < infNames.length; ink++) {
        html += '<div class="equip-slot"><div class="equip-slot__info"><div class="equip-slot__value">' + infCounts[infNames[ink]] + '\\u00d7 ' + escapeHtml(infNames[ink]) + '</div></div></div>';
      }
      html += '</section>';
    }
  }

  html += '</div>'; // equip-col--right
  html += '</div>'; // equip-layout
  return html;
}

// ---- Tooltip System ----

function initTooltip() {
  var tip = document.createElement("div");
  tip.className = "tooltip hover-preview spa-tooltip";
  tip.innerHTML = '<div class="hover-preview__head"><div class="hover-preview__title tooltip__name"></div></div><div class="hover-preview__desc tooltip__desc"></div>';
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
