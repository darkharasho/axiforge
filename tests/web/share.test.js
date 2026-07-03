const { createShareApi } = require("../../src/web/webApi/share.js");

const BUILD = {
  name: "Test",
  profession: "Guardian",
  gameMode: "pve",
  specializations: [null, null, null],
  skills: { heal: null, utility: [null, null, null], elite: null },
  underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
  equipment: {
    weapons: { mainhand1: null, offhand1: null, mainhand2: null, offhand2: null, aquatic1: null, aquatic2: null },
    runes: { head: null, shoulders: null, chest: null, hands: null, legs: null, feet: null },
    sigils: { mainhand1: [], offhand1: [], mainhand2: [], offhand2: [], aquatic1: [], aquatic2: [] },
    infusions: {},
    slots: {},
    statPackage: "",
    relic: null,
    food: null,
    utility: null,
    enrichment: null,
  },
};

test("encode → decode round-trips a build", async () => {
  const api = createShareApi();
  const code = await api.encodeShareCode(BUILD);
  expect(typeof code).toBe("string");
  expect(code.length).toBeGreaterThan(0);
  const decoded = await api.decodeShareCode(code);
  expect(decoded.profession).toBe("Guardian");
});

test("isShareCode recognizes a real code and rejects garbage", async () => {
  const api = createShareApi();
  const code = await api.encodeShareCode(BUILD);
  expect(await api.isShareCode(code)).toBe(true);
  expect(await api.isShareCode("not a code !!")).toBe(false);
});

test("buildToHash then hashToBuild round-trips (with leading #)", async () => {
  const api = createShareApi();
  const hash = await api.buildToHash(BUILD);
  const back = await api.hashToBuild("#" + hash);
  expect(back.profession).toBe("Guardian");
});

test("the b= param is URL-safe (base64url only) — survives address bar / Discord", async () => {
  const api = createShareApi();
  const named = { ...BUILD, title: "WvW Power Core Necro" };
  const hash = await api.buildToHash(named);
  const params = new URLSearchParams(hash);
  const b = params.get("b");
  // Only base64url characters — no <, >, %, &, +, # etc. that mangle in transit.
  expect(b).toMatch(/^[A-Za-z0-9_-]+$/);
  // Name still round-trips and the build decodes.
  const back = await api.hashToBuild("#" + hash);
  expect(back.profession).toBe("Guardian");
  expect(back.title).toBe("WvW Power Core Necro");
});

test("name is carried and restored via the n= param", async () => {
  const api = createShareApi();
  const hash = await api.buildToHash({ ...BUILD, title: "My Build" });
  expect(await api.hashToBuild("#" + hash).then((b) => b.title)).toBe("My Build");
});

// A build with real heal/utility/elite skills, in the nested shape the editor and
// build store use (serializeEditorToBuild / loadBuildIntoEditor / saveBuild).
const BUILD_WITH_SKILLS = {
  ...BUILD,
  title: "WvW Power Core Necro",
  profession: "Necromancer",
  gameMode: "wvw",
  skills: {
    heal: { id: 10561 },
    utility: [{ id: 10547 }, { id: 10557 }, { id: 19117 }],
    elite: { id: 10553 },
  },
};

test("heal, utility, and elite skills survive buildToHash → hashToBuild", async () => {
  const api = createShareApi();
  const hash = await api.buildToHash(BUILD_WITH_SKILLS);
  const back = await api.hashToBuild("#" + hash);
  // Skills must come back in the nested shape loadBuildIntoEditor/saveBuild read
  // — NOT the codec's flat { healId, utilityIds, eliteId }.
  expect(back.skills.heal).toEqual({ id: 10561 });
  expect(back.skills.utility.map((s) => s.id)).toEqual([10547, 10557, 19117]);
  expect(back.skills.elite).toEqual({ id: 10553 });
});

test("underwater skills are also nested on hash load", async () => {
  const api = createShareApi();
  const withUw = {
    ...BUILD_WITH_SKILLS,
    underwaterSkills: {
      heal: { id: 10561 },
      utility: [{ id: 10547 }],
      elite: { id: 10553 },
    },
  };
  const hash = await api.buildToHash(withUw);
  const back = await api.hashToBuild("#" + hash);
  expect(back.underwaterSkills.heal).toEqual({ id: 10561 });
  expect(back.underwaterSkills.utility.map((s) => s.id)).toEqual([10547]);
  expect(back.underwaterSkills.elite).toEqual({ id: 10553 });
});

test("empty skills decode to the nested empty shape (no crash, no phantom ids)", async () => {
  const api = createShareApi();
  const hash = await api.buildToHash(BUILD);
  const back = await api.hashToBuild("#" + hash);
  expect(back.skills.heal).toBeNull();
  expect(back.skills.utility).toEqual([]);
  expect(back.skills.elite).toBeNull();
});

test("hashToBuild returns null for empty or invalid hash", async () => {
  const api = createShareApi();
  expect(await api.hashToBuild("")).toBeNull();
  expect(await api.hashToBuild("#")).toBeNull();
  expect(await api.hashToBuild("#garbage-not-a-code")).toBeNull();
});
