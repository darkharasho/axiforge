const { createShareApi } = require("../../src/web/webApi/share.js");

const BUILD = {
  title: "WvW Power Core Necro",
  profession: "Necromancer",
  gameMode: "wvw",
  specializations: [null, null, null],
  skills: {
    heal: { id: 10561 },
    utility: [{ id: 10547 }, { id: 10557 }, { id: 19117 }],
    elite: { id: 10553 },
  },
  underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
  equipment: {
    weapons: { mainhand1: null, offhand1: null, mainhand2: null, offhand2: null, aquatic1: null, aquatic2: null },
    runes: { head: null, shoulders: null, chest: null, hands: null, legs: null, feet: null },
    sigils: { mainhand1: [], offhand1: [], mainhand2: [], offhand2: [], aquatic1: [], aquatic2: [] },
    infusions: {}, slots: {}, statPackage: "", relic: null, food: null, utility: null, enrichment: null,
  },
};

// A fetch stub backed by an in-memory slug->{code,name} store, mimicking the
// Worker's POST /api/shorten and GET /api/b/<slug> contract.
function fakeShortener() {
  const store = new Map();
  let counter = 0;
  const calls = { shorten: [], resolve: [] };
  const fetch = async (url, opts) => {
    if (url === "/api/shorten") {
      const body = JSON.parse(opts.body);
      calls.shorten.push({ url, body });
      const slug = `slug${counter++}`;
      store.set(slug, { code: body.code, name: body.name || "" });
      return { ok: true, json: async () => ({ slug, url: `https://build.axi.link/b/${slug}` }) };
    }
    if (url.startsWith("/api/b/")) {
      const slug = url.slice("/api/b/".length);
      calls.resolve.push(slug);
      if (!store.has(slug)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => store.get(slug) };
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetch, calls };
}

test("buildToShortLink posts the share code and returns the Worker's url", async () => {
  const { fetch, calls } = fakeShortener();
  const api = createShareApi({ fetch });
  const url = await api.buildToShortLink(BUILD);
  expect(url).toBe("https://build.axi.link/b/slug0");
  expect(calls.shorten).toHaveLength(1);
  // Body carries the raw AxiForge share code and the readable name.
  expect(await api.isShareCode(calls.shorten[0].body.code)).toBe(true);
  expect(calls.shorten[0].body.name).toBe("WvW Power Core Necro");
});

test("buildToShortLink omits an Untitled/empty name from the body", async () => {
  const { fetch, calls } = fakeShortener();
  const api = createShareApi({ fetch });
  await api.buildToShortLink({ ...BUILD, title: "Untitled Build" });
  expect(calls.shorten[0].body.name).toBeUndefined();
});

test("buildToShortLink returns null on network failure (caller falls back to #b=)", async () => {
  const fetch = async () => { throw new Error("offline"); };
  const api = createShareApi({ fetch });
  expect(await api.buildToShortLink(BUILD)).toBeNull();
});

test("buildToShortLink returns null on a non-ok response", async () => {
  const fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const api = createShareApi({ fetch });
  expect(await api.buildToShortLink(BUILD)).toBeNull();
});

test("slugToBuild resolves a slug back to the nested-skill build", async () => {
  const { fetch } = fakeShortener();
  const api = createShareApi({ fetch });
  const url = await api.buildToShortLink(BUILD);
  const slug = url.split("/b/")[1];
  const back = await api.slugToBuild(slug);
  expect(back.profession).toBe("Necromancer");
  expect(back.title).toBe("WvW Power Core Necro");
  // Skills come back nested, like hashToBuild — not the codec's flat shape.
  expect(back.skills.heal).toEqual({ id: 10561 });
  expect(back.skills.utility.map((s) => s.id)).toEqual([10547, 10557, 19117]);
  expect(back.skills.elite).toEqual({ id: 10553 });
});

test("slugToBuild accepts a full /b/<slug> path, not just the bare slug", async () => {
  const { fetch } = fakeShortener();
  const api = createShareApi({ fetch });
  const url = await api.buildToShortLink(BUILD);
  const slug = url.split("/b/")[1];
  const back = await api.slugToBuild(`/b/${slug}`);
  expect(back.profession).toBe("Necromancer");
});

test("slugToBuild returns null for an unknown slug", async () => {
  const { fetch } = fakeShortener();
  const api = createShareApi({ fetch });
  expect(await api.slugToBuild("nope")).toBeNull();
});

test("slugToBuild returns null for empty input", async () => {
  const { fetch } = fakeShortener();
  const api = createShareApi({ fetch });
  expect(await api.slugToBuild("")).toBeNull();
});
