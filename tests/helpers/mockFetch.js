/**
 * Mock fetch factory for GW2 API tests.
 * Dispatches by URL pattern, parsing requested IDs and returning the appropriate fixture data.
 */
const {
  MOCK_PROFESSIONS,
  MOCK_SPECIALIZATIONS,
  MOCK_TRAITS,
  MOCK_LEGEND_IDS,
  MOCK_LEGENDS_DATA,
  MOCK_PETS_RAW,
  getAllMockSkills,
} = require("../fixtures/gw2Api");

/**
 * Parse the `ids` query param from a GW2 API URL.
 * Returns an array of the raw values (strings like profession names, or numeric strings).
 */
function parseIds(url) {
  try {
    const u = new URL(url);
    const ids = u.searchParams.get("ids") || "";
    return ids.split(",").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Build a successful fetch response.
 */
function okResponse(data) {
  const body = JSON.stringify(data);
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(body),
    headers: { get: () => null },
  });
}

/**
 * Build a 404 fetch response.
 */
function notFoundResponse() {
  return Promise.resolve({
    ok: false,
    status: 404,
    json: () => Promise.resolve({ message: "Not Found" }),
    text: () => Promise.resolve("Not Found"),
    headers: { get: () => null },
  });
}

/**
 * Create the GW2 API mock fetch handler.
 * Covers: /v2/professions, /v2/specializations, /v2/skills, /v2/traits, /v2/legends, /v2/pets
 *
 * All skill lookups are served from getAllMockSkills(), which merges MOCK_SKILLS,
 * MOCK_LEGEND_SKILLS, and MOCK_PET_SKILLS.
 */
function createGw2MockFetch(overrides = {}) {
  const allSkills = getAllMockSkills();

  return jest.fn(async (url, _options) => {
    const urlStr = String(url);

    // Allow test-specific URL overrides (highest priority)
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (urlStr.includes(pattern)) {
        const result = typeof handler === "function" ? handler(urlStr) : handler;
        return okResponse(result);
      }
    }

    // /v2/professions?ids=...
    if (urlStr.includes("/v2/professions")) {
      const ids = parseIds(urlStr);
      const data = ids.map((id) => MOCK_PROFESSIONS[id]).filter(Boolean);
      return okResponse(data);
    }

    // /v2/specializations?ids=...
    if (urlStr.includes("/v2/specializations")) {
      const ids = parseIds(urlStr).map(Number);
      const data = ids.map((id) => MOCK_SPECIALIZATIONS[id]).filter(Boolean);
      return okResponse(data);
    }

    // /v2/skills?ids=all (for morph pool — return all skills in the database)
    if (urlStr.includes("/v2/skills") && urlStr.includes("ids=all")) {
      return okResponse(Object.keys(allSkills).map(Number));
    }

    // /v2/skills?ids=...
    if (urlStr.includes("/v2/skills")) {
      const ids = parseIds(urlStr).map(Number);
      const data = ids.map((id) => allSkills[id]).filter(Boolean);
      return okResponse(data);
    }

    // /v2/traits?ids=...
    if (urlStr.includes("/v2/traits")) {
      const ids = parseIds(urlStr).map(Number);
      const data = ids.map((id) => MOCK_TRAITS[id]).filter(Boolean);
      return okResponse(data);
    }

    // /v2/legends (bare — returns array of IDs)
    if (urlStr.includes("/v2/legends") && !urlStr.includes("ids=")) {
      return okResponse(MOCK_LEGEND_IDS);
    }

    // /v2/legends?ids=...
    if (urlStr.includes("/v2/legends")) {
      const ids = parseIds(urlStr);
      const data = ids.map((id) => MOCK_LEGENDS_DATA.find((l) => l.id === id)).filter(Boolean);
      return okResponse(data);
    }

    // /v2/pets?ids=all
    if (urlStr.includes("/v2/pets")) {
      return okResponse(MOCK_PETS_RAW);
    }

    // Wiki API — wikitext batch queries (used by WikiClient.getWikitextBatch)
    if (urlStr.includes("wiki.guildwars2.com") && urlStr.includes("rvprop=content")) {
      // Parse requested titles from URL and return stub wikitext for each
      const titlesMatch = urlStr.match(/titles=([^&]+)/);
      const titles = titlesMatch ? decodeURIComponent(titlesMatch[1]).split("|") : [];
      const pages = {};
      titles.forEach((title, i) => {
        pages[String(i + 1)] = {
          pageid: i + 1,
          title,
          revisions: [{ "*": `{{Skill infobox\n| description = Mock description for ${title}\n}}` }],
        };
      });
      return okResponse({ query: { pages } });
    }

    // Wiki API — other queries (summaries, etc.)
    if (urlStr.includes("wiki.guildwars2.com")) {
      return okResponse({ query: { pages: [{ title: "Test", extract: "Summary", fullurl: "https://wiki.guildwars2.com/wiki/Test", missing: false }] } });
    }

    // Unknown URL — return 404
    console.warn(`[mockFetch] Unhandled URL: ${urlStr.slice(0, 120)}`);
    return notFoundResponse();
  });
}

/**
 * Create a simple GitHub API mock fetch.
 * Accepts a map of URL substring → response data (or handler function).
 */
function createGithubMockFetch(routes = {}) {
  return jest.fn(async (url, options) => {
    const urlStr = String(url);
    const method = (options?.method || "GET").toUpperCase();

    for (const [pattern, handler] of Object.entries(routes)) {
      if (urlStr.includes(pattern)) {
        const data = typeof handler === "function" ? handler(urlStr, method, options) : handler;
        if (data === null) return notFoundResponse();
        const body = JSON.stringify(data);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(data),
          text: () => Promise.resolve(body),
          headers: { get: () => "" },
        });
      }
    }

    // Default 404
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Not Found" }),
      text: () => Promise.resolve("Not Found"),
      headers: { get: () => "" },
    });
  });
}

/**
 * Install a mock fetch globally and return the mock function.
 * Restores the original fetch (or removes it) in afterEach/afterAll.
 */
function installMockFetch(mockFn) {
  global.fetch = mockFn;
}

module.exports = {
  createGw2MockFetch,
  createGithubMockFetch,
  installMockFetch,
  okResponse,
  notFoundResponse,
  parseIds,
};
