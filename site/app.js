const grid = document.getElementById("buildGrid");
const searchInput = document.getElementById("searchInput");
const generatedAt = document.getElementById("generatedAt");

let allBuilds = [];

init().catch((err) => {
  grid.innerHTML = '<article class="build-card"><h2>Failed To Load</h2><p class="meta">' + escapeHtml(err?.message || String(err)) + "</p></article>";
});

async function init() {
  const res = await fetch("./data/builds.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load builds data.");
  const payload = await res.json();
  allBuilds = Array.isArray(payload?.builds) ? payload.builds : [];
  generatedAt.textContent = payload?.generatedAt ? "Generated: " + formatDate(payload.generatedAt) : "";
  render();
  searchInput.addEventListener("input", render);
}

function render() {
  const query = (searchInput.value || "").trim().toLowerCase();
  const builds = allBuilds.filter((build) => matchesQuery(build, query));
  grid.innerHTML = "";
  if (!builds.length) {
    grid.innerHTML = '<article class="build-card"><h2>No Builds</h2><p class="meta">No build matches your search.</p></article>';
    return;
  }
  for (const build of builds) {
    const card = document.createElement("article");
    card.className = "build-card";
    const specNames = (build.specializations || []).map((spec) => spec.name).filter(Boolean);
    const equip = build.equipment || {};

    card.innerHTML = [
      '<h2>' + escapeHtml(build.title || "Untitled Build") + "</h2>",
      '<p class="meta">' + escapeHtml(build.profession || "Unknown Profession") + " | Updated " + escapeHtml(formatDate(build.updatedAt)) + "</p>",
      section("Specializations", specNames.map((name) => token(name)).join("")),
      section("Skills", skillRows(build.skills)),
      section("Equipment", equipmentTokens(equip)),
      build.notes ? section("Notes", '<p class="meta">' + escapeHtml(build.notes) + "</p>") : "",
      Array.isArray(build.tags) && build.tags.length ? section("Tags", build.tags.map((tag) => token(tag)).join("")) : "",
    ].join("");

    grid.append(card);
  }
}

function skillRows(skills) {
  const list = [];
  if (skills?.heal) list.push(skills.heal);
  if (Array.isArray(skills?.utility)) {
    for (const item of skills.utility) {
      if (item) list.push(item);
    }
  }
  if (skills?.elite) list.push(skills.elite);
  if (!list.length) return '<p class="meta">No skills selected.</p>';
  return list.map((skill) => {
    const icon = skill.icon ? '<img src="' + escapeAttr(skill.icon) + '" alt="" loading="lazy" />' : '<div></div>';
    return '<div class="skill">' + icon + '<span>' + escapeHtml(skill.name || "Unknown Skill") + "</span></div>";
  }).join("");
}

function equipmentTokens(equipment) {
  const tokens = [];
  if (equipment.statPackage) tokens.push(token("Stats: " + equipment.statPackage));
  if (equipment.relic) tokens.push(token("Relic: " + equipment.relic));
  if (equipment.food) tokens.push(token("Food: " + equipment.food));
  if (equipment.utility) tokens.push(token("Utility: " + equipment.utility));
  return tokens.length ? tokens.join("") : '<p class="meta">Not specified.</p>';
}

function section(title, body) {
  return '<section class="section"><h3>' + escapeHtml(title) + '</h3><div class="token-row">' + body + "</div></section>";
}

function token(label) {
  return '<span class="token">' + escapeHtml(label) + "</span>";
}

function matchesQuery(build, query) {
  if (!query) return true;
  const haystack = [
    build.title || "",
    build.profession || "",
    build.notes || "",
    ...(build.tags || []),
    ...((build.specializations || []).map((spec) => spec.name || "")),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function formatDate(value) {
  if (!value) return "unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
