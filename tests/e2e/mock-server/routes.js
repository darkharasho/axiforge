const path = require("path");
const fs = require("fs");

const FIXTURES = path.join(__dirname, "..", "fixtures");

const professions = JSON.parse(fs.readFileSync(path.join(FIXTURES, "professions.json"), "utf-8"));

// Stand-in wiki pages, keyed by title. Anything absent is reported `missing`, which
// resolveEntityFacts() skips — so the entity simply keeps its API facts.
const wikiPages = JSON.parse(fs.readFileSync(path.join(FIXTURES, "wiki-pages.json"), "utf-8"));

const catalogs = {};
for (const file of fs.readdirSync(FIXTURES)) {
  const match = file.match(/^(.+)-catalog\.json$/);
  if (match) {
    catalogs[match[1]] = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf-8"));
  }
}

const allSpecs = {};
const allTraits = {};
const allSkills = {};
for (const catalog of Object.values(catalogs)) {
  for (const s of catalog.specializations) allSpecs[s.id] = s;
  for (const t of catalog.traits) allTraits[t.id] = t;
  for (const s of catalog.skills) allSkills[s.id] = s;
}

function parseIds(url) {
  const match = url.match(/[?&]ids=([^&]+)/);
  if (!match) return null;
  // fetchGw2ByIds URL-encodes the ids string with encodeURIComponent, which encodes commas
  // as %2C. Decode the matched value before splitting so "31%2C41" splits correctly.
  const decoded = decodeURIComponent(match[1]);
  if (decoded === "all") return "all";
  return decoded.split(",");
}

function handleRequest(method, url) {
  const pathname = new URL(url, "http://localhost").pathname;
  const ids = parseIds(url);

  if (pathname === "/v2/professions" && ids === null) {
    return professions.map((p) => p.id);
  }
  if (pathname === "/v2/professions" && Array.isArray(ids)) {
    return professions.filter((p) => ids.includes(p.id));
  }

  if (pathname === "/v2/specializations" && Array.isArray(ids)) {
    return ids.map((id) => allSpecs[id]).filter(Boolean);
  }

  if (pathname === "/v2/traits" && Array.isArray(ids)) {
    return ids.map((id) => allTraits[id]).filter(Boolean);
  }

  if (pathname === "/v2/skills" && ids === null) {
    return Object.keys(allSkills).map(Number);
  }
  if (pathname === "/v2/skills" && ids === "all") {
    return Object.values(allSkills);
  }
  if (pathname === "/v2/skills" && Array.isArray(ids)) {
    return ids.map((id) => allSkills[id]).filter(Boolean);
  }

  const legendsPath = path.join(FIXTURES, "legends.json");
  const legends = fs.existsSync(legendsPath) ? JSON.parse(fs.readFileSync(legendsPath, "utf-8")) : [];
  if (pathname === "/v2/legends" && ids === null) {
    return legends.map((l) => l.id);
  }
  if (pathname === "/v2/legends" && Array.isArray(ids)) {
    return legends.filter((l) => ids.includes(l.id));
  }

  const petsPath = path.join(FIXTURES, "pets.json");
  const pets = fs.existsSync(petsPath) ? JSON.parse(fs.readFileSync(petsPath, "utf-8")) : [];
  if (pathname === "/v2/pets" && ids === "all") {
    return pets;
  }
  if (pathname === "/v2/pets" && Array.isArray(ids)) {
    return pets.filter((p) => ids.includes(String(p.id)));
  }
  if (pathname === "/v2/pets" && ids === null) {
    return pets.map((p) => p.id);
  }

  if (pathname === "/v2/items") {
    const upgradesPath = path.join(FIXTURES, "upgrades.json");
    if (fs.existsSync(upgradesPath)) {
      const upgrades = JSON.parse(fs.readFileSync(upgradesPath, "utf-8"));
      if (Array.isArray(ids)) {
        return upgrades.filter((u) => ids.includes(String(u.id)));
      }
      return upgrades;
    }
    return [];
  }

  if (pathname === "/wiki-api.php") {
    return handleWikiQuery(url);
  }

  return null;
}

/**
 * Minimal stand-in for the MediaWiki `action=query&prop=revisions` call that
 * WikiClient.getWikitextBatch() makes. Only the fields the client reads are
 * produced: query.pages[].title, .missing, and .revisions[0]["*"].
 */
function handleWikiQuery(url) {
  const params = new URL(url, "http://localhost").searchParams;
  const titles = (params.get("titles") || "").split("|").filter(Boolean);

  const pages = {};
  titles.forEach((title, index) => {
    // Negative page ids are what MediaWiki itself uses for missing pages.
    const wikitext = Object.prototype.hasOwnProperty.call(wikiPages, title) && title !== "_comment"
      ? wikiPages[title]
      : null;
    pages[wikitext === null ? -(index + 1) : index + 1] =
      wikitext === null
        ? { title, missing: "" }
        : { title, revisions: [{ "*": wikitext }] };
  });

  return { query: { pages } };
}

module.exports = { handleRequest };
