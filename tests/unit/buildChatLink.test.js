"use strict";

const { mapBuildToTemplateInput, generateChatLink, generateChatLinkReport } = require("../../src/main/buildChatLink");

describe("mapBuildToTemplateInput", () => {
  const baseBuild = {
    profession: "Guardian",
    specializations: [
      { id: 42, majorChoices: { 1: 566, 2: 567, 3: 568 } },
      { id: 16, majorChoices: { 1: 600, 2: 601, 3: 602 } },
      { id: 27, majorChoices: { 1: 1896, 2: 1898, 3: 1955 } },
    ],
    skills: {
      heal: { id: 9083 },
      utility: [{ id: 9093 }, { id: 9150 }, { id: 9153 }],
      elite: { id: 30461 },
    },
    underwaterSkills: {
      heal: { id: 9083 },
      utility: [{ id: 9093 }, null, null],
      elite: null,
    },
    equipment: {
      weapons: { mainhand1: "Greatsword", offhand1: "", mainhand2: "Sword", offhand2: "Focus" },
    },
    selectedLegends: ["", ""],
    selectedUnderwaterLegends: ["", ""],
    selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
  };

  it("maps profession as-is", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.profession).toBe("Guardian");
  });

  it("maps specializations with trait IDs", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.specializations).toEqual([
      { id: 42, traits: [566, 567, 568] },
      { id: 16, traits: [600, 601, 602] },
      { id: 27, traits: [1896, 1898, 1955] },
    ]);
  });

  it("preserves trait ID 0 as a valid trait", () => {
    const build = {
      ...baseBuild,
      specializations: [
        { id: 42, majorChoices: { 1: 0, 2: 567, 3: 568 } },
      ],
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations[0].traits[0]).toBe(0);
  });

  it("pads specializations to 3 when fewer exist", () => {
    const build = { ...baseBuild, specializations: [{ id: 42, majorChoices: { 1: 566, 2: 567, 3: 568 } }] };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations).toHaveLength(3);
    expect(input.specializations[1]).toEqual({ id: null });
    expect(input.specializations[2]).toEqual({ id: null });
  });

  it("pads specializations when array is empty", () => {
    const build = { ...baseBuild, specializations: [] };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations).toHaveLength(3);
  });

  it("maps terrestrial skills", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.skills.terrestrial).toEqual({
      heal: 9083,
      utilities: [9093, 9150, 9153],
      elite: 30461,
    });
  });

  it("maps aquatic skills with undefined for missing", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.skills.aquatic).toEqual({
      heal: 9083,
      utilities: [9093, undefined, undefined],
      elite: undefined,
    });
  });

  it("maps weapons, filtering empties", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.weapons).toEqual(["greatsword", "sword", "focus"]);
  });

  it("maps revenant legends from Legend strings", () => {
    const build = {
      ...baseBuild,
      profession: "Revenant",
      selectedLegends: ["Legend2", "Legend5"],
      selectedUnderwaterLegends: ["Legend3", "Legend6"],
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.revenantLegends).toEqual([2, 5, 3, 6]);
  });

  it("omits revenantLegends for non-Revenant", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.revenantLegends).toBeUndefined();
  });

  // Revenant skill slots use a FIXED set of palette IDs; the active legend
  // resolves the concrete skill in-game. The legend's actual skill IDs (e.g.
  // 26937) are NOT in the profession's skills_by_palette, so passing them made
  // gw2buildlink throw and produce no link; leaving them empty dropped the
  // skills from the imported build — both were issue #283.
  it("uses fixed legend palette IDs for Revenant terrestrial skills", () => {
    const build = {
      ...baseBuild,
      profession: "Revenant",
      selectedLegends: ["Legend2", "Legend3"],
      selectedUnderwaterLegends: ["", ""],
      // Legend skill IDs synced into the selection — must NOT reach the encoder.
      skills: {
        heal: { id: 26937 },
        utility: [{ id: 29209 }, { id: 28231 }, { id: 27107 }],
        elite: { id: 28406 },
      },
      underwaterSkills: { heal: { id: 26937 }, utility: [], elite: null },
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.revenantLegends).toEqual([2, 3, undefined, undefined]);
    // Fixed Revenant palettes (heal 4572, utilities 4564/4614/4651, elite 4554).
    expect(input.skills.terrestrial).toEqual({
      heal: 4572,
      utilities: [4564, 4614, 4651],
      elite: 4554,
    });
    // No aquatic legend → aquatic slots stay empty.
    expect(input.skills.aquatic).toEqual({
      heal: undefined,
      utilities: [undefined, undefined, undefined],
      elite: undefined,
    });
    // Second terrestrial legend present → its inactive utility palettes are set;
    // no aquatic legends → aquatic inactive slots stay empty.
    expect(input.revenantInactiveSkills).toEqual([4564, 4614, 4651, undefined, undefined, undefined]);
  });

  it("fills aquatic Revenant palettes when an underwater legend is slotted", () => {
    const build = {
      ...baseBuild,
      profession: "Revenant",
      selectedLegends: ["Legend2", ""],
      selectedUnderwaterLegends: ["Legend3", ""],
      skills: { heal: { id: 26937 }, utility: [], elite: null },
      underwaterSkills: { heal: { id: 26974 }, utility: [], elite: null },
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.skills.aquatic).toEqual({
      heal: 4572,
      utilities: [4564, 4614, 4651],
      elite: 4554,
    });
    expect(input.revenantInactiveSkills).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("still maps heal/utility/elite skills for non-Revenant professions", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.skills.terrestrial.heal).toBe(9083);
    expect(input.skills.terrestrial.utilities).toEqual([9093, 9150, 9153]);
    expect(input.skills.terrestrial.elite).toBe(30461);
  });

  it("maps ranger pets", () => {
    const build = {
      ...baseBuild,
      profession: "Ranger",
      selectedPets: { terrestrial1: 1, terrestrial2: 5, aquatic1: 12, aquatic2: 3 },
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.rangerPets).toEqual([1, 5, 12, 3]);
  });

  it("omits rangerPets for non-Ranger", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.rangerPets).toBeUndefined();
  });

  it("handles completely empty build gracefully", () => {
    const build = {
      profession: "",
      specializations: [],
      skills: { heal: null, utility: [], elite: null },
      underwaterSkills: { heal: null, utility: [], elite: null },
      equipment: { weapons: {} },
      selectedLegends: ["", ""],
      selectedUnderwaterLegends: ["", ""],
      selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations).toHaveLength(3);
    expect(input.skills.terrestrial.heal).toBeUndefined();
    expect(input.weapons).toBeUndefined();
    expect(input.skills.aquatic.heal).toBeUndefined();
    expect(input.revenantLegends).toBeUndefined();
    expect(input.rangerPets).toBeUndefined();
  });
});

// An unselected trait line reaches here as `id: 0` — that is what
// serializeEditorToBuild() emits (`Number(spec?.id || entry.specializationId || 0)`),
// and an imported build can carry `id: ""`. Only `id == null` was treated as an
// empty line, so 0 was passed through as a real specialization and gw2buildlink
// asked the GW2 API for /v2/specializations/0 — a 404 that rejected the whole
// encode. The user got "Failed" on every build with a trait line left open, on
// both the Share menu and the title bar's Chat Link button, because both call
// the same generator.
describe("mapBuildToTemplateInput — an unfilled trait line is not specialization 0", () => {
  const skeleton = {
    profession: "Necromancer",
    skills: { heal: null, utility: [], elite: null },
    underwaterSkills: { heal: null, utility: [], elite: null },
    equipment: { weapons: {} },
  };

  for (const [label, emptyId] of [["0", 0], ['""', ""], ["null", null], ["undefined", undefined]]) {
    it(`treats a specialization id of ${label} as an empty line`, () => {
      const input = mapBuildToTemplateInput({ ...skeleton, specializations: [{ id: emptyId, majorChoices: {} }] });
      expect(input.specializations[0]).toEqual({ id: null });
    });
  }

  it("keeps the filled lines when only some are open", () => {
    const input = mapBuildToTemplateInput({
      ...skeleton,
      specializations: [
        { id: 53, majorChoices: { 1: 914, 2: 899, 3: 919 } },
        { id: 0, majorChoices: {} },
        { id: 0, majorChoices: {} },
      ],
    });
    expect(input.specializations).toEqual([
      { id: 53, traits: [914, 899, 919] },
      { id: null },
      { id: null },
    ]);
  });

  it("never emits a zero specialization id for any shape of empty line", () => {
    const input = mapBuildToTemplateInput({
      ...skeleton,
      specializations: [{ id: "0" }, { id: 0 }, { id: "" }],
    });
    for (const spec of input.specializations) expect(spec.id).not.toBe(0);
  });
});

// The result cache is keyed by build id and invalidated on updatedAt. The editor's
// serializeEditorToBuild() emits neither a stamp nor a bumped one while you type —
// `updatedAt` is simply absent — so `cached.updatedAt === build.updatedAt` compared
// undefined to undefined and matched forever: after the first generation every
// later copy handed back the FIRST link, whatever the build looked like by then.
describe("generateChatLink caching", () => {
  function countingEncoder() {
    const calls = [];
    return {
      calls,
      encode: async (input) => {
        calls.push(input);
        return `[&link-${calls.length}-${input.specializations.map((s) => s.id).join(":")}]`;
      },
    };
  }

  // The cache lives at module scope, so each test needs its own build id or it
  // inherits the previous test's entry.
  let seq = 0;
  const freshId = () => `build-${++seq}`;

  const build = (specId, extra = {}) => ({
    id: extra.id || CURRENT_ID,
    profession: "Necromancer",
    specializations: [{ id: specId, majorChoices: {} }],
    skills: { heal: null, utility: [], elite: null },
    underwaterSkills: { heal: null, utility: [], elite: null },
    equipment: { weapons: {} },
    ...extra,
  });

  let CURRENT_ID;
  beforeEach(() => { CURRENT_ID = freshId(); });

  it("reuses the link for a saved build that has not changed", async () => {
    const { calls, encode } = countingEncoder();
    const saved = build(53, { updatedAt: "2026-10-04T00:00:00.000Z" });
    const first = await generateChatLink(saved, { encode });
    const second = await generateChatLink(saved, { encode });
    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it("regenerates when the saved build's updatedAt moves", async () => {
    const { calls, encode } = countingEncoder();
    await generateChatLink(build(53, { updatedAt: "2026-10-04T00:00:00.000Z" }), { encode });
    await generateChatLink(build(50, { updatedAt: "2026-10-04T00:05:00.000Z" }), { encode });
    expect(calls).toHaveLength(2);
  });

  it("does not serve a stale link to an unsaved editor build with no updatedAt", async () => {
    const { calls, encode } = countingEncoder();
    const before = await generateChatLink(build(53), { encode });
    const after = await generateChatLink(build(50), { encode });
    expect(calls).toHaveLength(2);
    expect(after).not.toBe(before);
    expect(after).toContain("50");
  });
});

// gw2buildlink resolves every id in a template against the GW2 API and rejects the
// WHOLE encode if a single lookup fails, so one stale id — a skill removed from the
// API, a hand-edited .axicode, a build saved on an older patch — produced no chat
// code at all. These cover the pre-flight pass that drops just the dead ids.
describe("generateChatLink tolerates ids the GW2 API cannot resolve", () => {
  const SPITE = {
    id: 53,
    name: "Spite",
    major_traits: [914, 899, 919, 1920, 1921, 1922, 1923, 1924, 1925],
  };
  const LIVE_SKILLS = new Set([10547, 10620, 10611, 10550, 10547]);
  const LIVE_PETS = new Set([42]);
  const LIVE_WEAPONS = new Set(["dagger", "greatsword"]);

  // Mirrors node_modules/gw2buildlink/dist/gw2ApiClient.js — same return shapes and
  // the same error messages, since the pre-flight pass classifies failures by them.
  function fakeApi(overrides = {}) {
    return {
      resolveProfession: async (name) => {
        if (String(name).toLowerCase() !== "necromancer") {
          throw new Error(`Unknown profession name ${name}`);
        }
        return { id: "Necromancer", name: "Necromancer", code: 8 };
      },
      getProfessionDetails: async (id) => ({ id }),
      resolveSpecialization: async (id) => {
        if (id !== SPITE.id) {
          throw new Error(
            `Failed to fetch https://api.guildwars2.com/v2/specializations/${id}?v=latest: 404 Not Found`
          );
        }
        return SPITE;
      },
      resolveTraitChoices: async (spec, traits) => {
        const choices = [0, 0, 0];
        (traits ?? []).forEach((input, tier) => {
          if (input == null) return;
          if (input >= 0 && input <= 3) { choices[tier] = input; return; }
          const index = spec.major_traits.indexOf(input);
          if (index === -1) {
            throw new Error(`Trait id ${input} is not part of specialization ${spec.name}`);
          }
          choices[tier] = (index % 3) + 1;
        });
        return choices;
      },
      resolveSkillPalette: async (_prof, value) => {
        if (value == null) return { paletteId: 0 };
        if (!LIVE_SKILLS.has(value)) throw new Error(`Unknown skill id ${value}`);
        return { paletteId: value + 1000, skillId: value };
      },
      resolvePet: async (value) => {
        if (value == null) return { id: 0 };
        if (!LIVE_PETS.has(value)) throw new Error(`Unknown pet id ${value}`);
        return { id: value };
      },
      resolveLegend: async (value) => {
        if (value == null) return { code: 0 };
        if (value < 1 || value > 8) throw new Error(`Unknown legend code ${value}`);
        return { code: value };
      },
      resolveWeapon: async (value) => {
        if (!LIVE_WEAPONS.has(value)) throw new Error(`Unknown weapon ${value}`);
        return { id: 47, name: value };
      },
      ...overrides,
    };
  }

  // Records the input the encoder actually receives — the assertions are about what
  // reached the encode, since that is what gw2buildlink would have rejected.
  function capturingEncoder() {
    const seen = [];
    return { seen, encode: async (input) => { seen.push(input); return "[&code]"; } };
  }

  let seq = 0;
  const unsavedBuild = (extra = {}) => ({
    // No `updatedAt`, so nothing here is cached between tests.
    id: `tolerant-${++seq}`,
    profession: "Necromancer",
    specializations: [{ id: 53, majorChoices: { 1: 914, 2: 899, 3: 919 } }],
    skills: { heal: { id: 10547 }, utility: [{ id: 10620 }, null, null], elite: null },
    underwaterSkills: { heal: null, utility: [], elite: null },
    equipment: { weapons: { mainhand1: "Dagger" } },
    ...extra,
  });

  it("still produces a code when one utility skill no longer exists", async () => {
    const { seen, encode } = capturingEncoder();
    const build = unsavedBuild({
      skills: { heal: { id: 10547 }, utility: [{ id: 999999 }, { id: 10620 }, null], elite: null },
    });
    const link = await generateChatLink(build, { api: fakeApi(), encode });
    expect(link).toBe("[&code]");
    // The dead id is gone; the live ones in the same set are untouched.
    expect(seen[0].skills.terrestrial.utilities[0]).toBeUndefined();
    expect(seen[0].skills.terrestrial.utilities[1]).toBe(10620);
    expect(seen[0].skills.terrestrial.heal).toBe(10547);
  });

  it("drops only the offending tier when one trait is not in the line", async () => {
    const { seen, encode } = capturingEncoder();
    const build = unsavedBuild({
      specializations: [{ id: 53, majorChoices: { 1: 914, 2: 123456, 3: 919 } }],
    });
    await generateChatLink(build, { api: fakeApi(), encode });
    expect(seen[0].specializations[0].id).toBe(53);
    expect(seen[0].specializations[0].traits).toEqual([914, undefined, 919]);
  });

  it("empties a trait line whose specialization is gone, keeping the others", async () => {
    const { seen, encode } = capturingEncoder();
    const build = unsavedBuild({
      specializations: [
        { id: 53, majorChoices: { 1: 914, 2: 899, 3: 919 } },
        { id: 404404, majorChoices: { 1: 1, 2: 2, 3: 3 } },
      ],
    });
    await generateChatLink(build, { api: fakeApi(), encode });
    expect(seen[0].specializations[0]).toEqual({ id: 53, traits: [914, 899, 919] });
    expect(seen[0].specializations[1]).toEqual({ id: null });
  });

  it("drops an unknown ranger pet rather than the whole code", async () => {
    const { seen, encode } = capturingEncoder();
    const build = unsavedBuild({
      profession: "Necromancer", // pets are mapped for Ranger only, so pass them directly
    });
    const input = { ...mapBuildToTemplateInput(build), rangerPets: [42, 777777, undefined, undefined] };
    // Exercise the sanitizer on an input that already carries pets.
    const { sanitizeTemplateInput } = require("../../src/main/buildChatLink");
    const result = await sanitizeTemplateInput(input, fakeApi());
    expect(result.input.rangerPets).toEqual([42, undefined, undefined, undefined]);
    expect(result.dropped.join(" ")).toContain("777777");
    expect(seen).toHaveLength(0);
    void encode;
  });

  it("drops a weapon the encoder does not know", async () => {
    const { seen, encode } = capturingEncoder();
    const build = unsavedBuild({
      equipment: { weapons: { mainhand1: "Dagger", offhand1: "Greatsword" } },
    });
    const input = mapBuildToTemplateInput(build);
    input.weapons = [...input.weapons, "flail"];
    const { sanitizeTemplateInput } = require("../../src/main/buildChatLink");
    const result = await sanitizeTemplateInput(input, fakeApi());
    expect(result.input.weapons).toEqual(["dagger", "greatsword"]);
    expect(result.dropped.join(" ")).toContain("flail");
    void seen; void encode;
  });

  it("reports every dropped entry so the caller can say what was lost", async () => {
    const { encode } = capturingEncoder();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const build = unsavedBuild({
      skills: { heal: { id: 999999 }, utility: [{ id: 888888 }, null, null], elite: null },
    });
    await generateChatLink(build, { api: fakeApi(), encode });
    expect(warn).toHaveBeenCalled();
    const message = warn.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(message).toContain("999999");
    expect(message).toContain("888888");
    warn.mockRestore();
  });

  // The copy buttons need the drop list itself, not a log line, to tell the user the
  // code they just copied is missing slots.
  it("hands the drop list back with the code, naming each slot", async () => {
    const { encode } = capturingEncoder();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const build = unsavedBuild({
      skills: { heal: { id: 999999 }, utility: [{ id: 10620 }, null, null], elite: null },
      underwaterSkills: { heal: null, utility: [{ id: 888888 }, null, null], elite: null },
    });
    const report = await generateChatLinkReport(build, { api: fakeApi(), encode });
    expect(report).toEqual({
      link: "[&code]",
      dropped: ["heal skill 999999", "underwater utility 1 skill 888888"],
    });
    console.warn.mockRestore();
  });

  it("reports nothing dropped for a build that resolves cleanly", async () => {
    const { encode } = capturingEncoder();
    const report = await generateChatLinkReport(unsavedBuild(), { api: fakeApi(), encode });
    expect(report).toEqual({ link: "[&code]", dropped: [] });
  });

  // A saved build is served from cache on the second copy; the warning must not
  // vanish just because the code was already generated once.
  it("keeps the drop list on a cached code", async () => {
    const { encode } = capturingEncoder();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const build = unsavedBuild({
      updatedAt: "2026-10-03T00:00:00.000Z",
      skills: { heal: { id: 999999 }, utility: [null, null, null], elite: null },
    });
    const first = await generateChatLinkReport(build, { api: fakeApi(), encode });
    const failingApi = fakeApi({ resolveProfession: async () => { throw new Error("should be cached"); } });
    const second = await generateChatLinkReport(build, { api: failingApi, encode });
    expect(second).toEqual(first);
    expect(second.dropped).toEqual(["heal skill 999999"]);
    expect(await generateChatLink(build, { api: failingApi, encode })).toBe("[&code]");
    console.warn.mockRestore();
  });

  it("still fails outright when the profession itself cannot be resolved", async () => {
    const { encode } = capturingEncoder();
    const build = unsavedBuild({ profession: "Bard" });
    await expect(generateChatLink(build, { api: fakeApi(), encode })).rejects.toThrow(/Unknown profession/);
  });

  // Dropping a slot because the network blipped would hand back a quietly truncated
  // build and call it success. Only a real answer from the API may retire an id.
  it("fails rather than truncating the build when a lookup hits a 429", async () => {
    const { encode } = capturingEncoder();
    const api = fakeApi({
      resolveSkillPalette: async (_prof, value) => {
        if (value == null) return { paletteId: 0 };
        throw new Error(
          "Failed to fetch https://api.guildwars2.com/v2/skills?ids=10547&v=latest: 429 Too Many Requests"
        );
      },
    });
    await expect(generateChatLink(unsavedBuild(), { api, encode })).rejects.toThrow(/429/);
  });

  it("fails rather than truncating the build when the network is down", async () => {
    const { encode } = capturingEncoder();
    const api = fakeApi({
      resolveSpecialization: async () => { throw new TypeError("fetch failed"); },
    });
    await expect(generateChatLink(unsavedBuild(), { api, encode })).rejects.toThrow(/fetch failed/);
  });

  // A 503 in the URL path must not read as a 503 status — the status is the number
  // after the URL, and confusing the two would turn a dead id into a hard failure.
  it("treats a 404 on an id that merely looks like a status code as a dead id", async () => {
    const { seen, encode } = capturingEncoder();
    const api = fakeApi({
      resolveSpecialization: async (id) => {
        throw new Error(
          `Failed to fetch https://api.guildwars2.com/v2/specializations/${id}?v=latest: 404 Not Found`
        );
      },
    });
    const build = unsavedBuild({ specializations: [{ id: 503, majorChoices: {} }] });
    await generateChatLink(build, { api, encode });
    expect(seen[0].specializations[0]).toEqual({ id: null });
  });

  // Baked mode (the Worker) answers an unknown single id with HTTP 200 and a `null`
  // body rather than a 404, so a miss arrives as a shapeless value, not a throw.
  it("treats a null specialization from baked data as a dead id", async () => {
    const { seen, encode } = capturingEncoder();
    const api = fakeApi({ resolveSpecialization: async () => null });
    await generateChatLink(unsavedBuild(), { api, encode });
    expect(seen[0].specializations[0]).toEqual({ id: null });
  });
});

// gw2buildlink hardcodes https://api.guildwars2.com/v2. With GW2_API_ROOT set (the e2e
// mock server, an offline run) the chat-link path must follow it like the rest of the
// app does, instead of being the one caller that still reaches the live API.
//
// gw2buildlink is ESM and Jest cannot run its dynamic import, so the real module runs
// in a plain Node child over a fetch that records every URL and answers 404. The encode
// fails at its first lookup; the URLs it tried are what is being checked.
describe("GW2_API_ROOT on the chat-link path", () => {
  const { execFileSync } = require("child_process");
  const path = require("path");
  const modulePath = path.resolve(__dirname, "../../src/main/buildChatLink.js");

  const script = `
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ text: "not found" }), { status: 404 });
    };
    console.error = () => {};
    const { generateChatLink } = require(${JSON.stringify(modulePath)});
    generateChatLink({ profession: "Guardian" })
      .catch(() => {})
      .then(() => process.stdout.write(JSON.stringify(urls)));
  `;

  function urlsRequestedBy(root) {
    const env = { ...process.env };
    if (root === undefined) delete env.GW2_API_ROOT;
    else env.GW2_API_ROOT = root;
    return JSON.parse(execFileSync(process.execPath, ["-e", script], { env, encoding: "utf8" }));
  }

  it("sends gw2buildlink's requests to GW2_API_ROOT", () => {
    const urls = urlsRequestedBy("http://localhost:9877/v2/");
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith("http://localhost:9877/v2/")).toBe(true);
      expect(url).not.toMatch(/api\.guildwars2\.com/);
    }
  });

  it("uses the live API when GW2_API_ROOT is unset", () => {
    const urls = urlsRequestedBy(undefined);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith("https://api.guildwars2.com/v2/")).toBe(true);
  });
});
