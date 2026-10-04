/**
 * The e2e mock GW2 API has to answer every request gw2buildlink makes, or the
 * Playwright chat-link specs cannot run: since GW2_API_ROOT reaches the chat-link
 * path, those specs talk to the mock, not the live API. gw2buildlink asks for things
 * the catalog code never does — `ids=all` lists, single-resource paths like
 * /specializations/53, and professions with `code` + `skills_by_palette`.
 *
 * This runs the real gw2buildlink against the mock's routes and round-trips full
 * builds. It runs in a Node child because Jest cannot load gw2buildlink's ESM, and it
 * calls handleRequest directly rather than binding the mock's port, which a running
 * e2e suite may hold.
 */
const { execFileSync } = require("child_process");
const path = require("path");

const modulePath = path.resolve(__dirname, "../../src/main/buildChatLink.js");
const routesPath = path.resolve(__dirname, "../e2e/mock-server/routes.js");

const NECROMANCER = {
  profession: "Necromancer",
  specializations: [
    { id: 53, majorChoices: { 1: 914, 2: 829, 3: 853 } }, // Spite
    { id: 19, majorChoices: { 1: 788, 2: 799, 3: 1692 } }, // Blood Magic
    { id: 34, majorChoices: { 1: 1974, 2: 2008, 3: 2021 } }, // Reaper
  ],
  skills: { heal: { id: 10527 }, utility: [{ id: 10546 }, { id: 10545 }, { id: 10609 }], elite: { id: 10646 } },
  underwaterSkills: { heal: { id: 10547 }, utility: [{ id: 10546 }, null, null], elite: null },
  equipment: { weapons: { mainhand1: "Scepter", offhand1: "Warhorn", mainhand2: "Greatsword" } },
};

const RANGER = {
  profession: "Ranger",
  specializations: [
    { id: 8, majorChoices: { 1: 1021, 2: 1000, 3: 1015 } }, // Marksmanship
    { id: 32, majorChoices: { 1: 1072, 2: 975, 3: 968 } }, // Beastmastery
    { id: 55, majorChoices: { 1: 2134, 2: 2085, 3: 2143 } }, // Soulbeast
  ],
  skills: { heal: { id: 12483 }, utility: [{ id: 12476 }, { id: 12499 }, { id: 12492 }], elite: { id: 45717 } },
  underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
  equipment: { weapons: { mainhand1: "Longbow" } },
  selectedPets: { terrestrial1: 3, terrestrial2: 4, aquatic1: 0, aquatic2: 0 },
};

function roundTrip(build) {
  const script = `
    const { handleRequest } = require(${JSON.stringify(routesPath)});
    const unrouted = [];
    globalThis.fetch = async (url) => {
      const result = handleRequest("GET", String(url).replace(/^http:\\/\\/mock/, ""));
      if (result === null) unrouted.push(String(url));
      return new Response(JSON.stringify(result ?? { text: "not found" }), {
        status: result === null ? 404 : 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const { generateChatLink, previewChatLink, decodeChatLinkToBuild } = require(${JSON.stringify(modulePath)});
    (async () => {
      const out = { unrouted };
      try {
        out.link = await generateChatLink(${JSON.stringify(build)});
        out.preview = await previewChatLink(out.link);
        out.decoded = await decodeChatLinkToBuild(out.link, "Round trip", null, "pve");
      } catch (err) {
        out.error = String(err && err.message || err);
      }
      process.stdout.write(JSON.stringify(out));
    })();
  `;
  const env = { ...process.env, GW2_API_ROOT: "http://mock/v2" };
  return JSON.parse(execFileSync(process.execPath, ["-e", script], { env, encoding: "utf8" }));
}

const skillIds = (set) => [set.heal?.id ?? null, ...set.utility.map((s) => s?.id ?? null), set.elite?.id ?? null];
const traitChoices = (specs) => specs.map((s) => [s.id, s.majorChoices[1], s.majorChoices[2], s.majorChoices[3]]);

describe("e2e mock GW2 API serves gw2buildlink", () => {
  it.each([
    ["Necromancer", NECROMANCER],
    ["Ranger", RANGER],
  ])("round-trips a full %s build through a chat link", (_name, build) => {
    const out = roundTrip(build);

    expect(out.error).toBeUndefined();
    expect(out.unrouted).toEqual([]);
    expect(out.link).toMatch(/^\[&[A-Za-z0-9+/=]+\]$/);

    expect(out.preview).toEqual({ profession: build.profession, eliteSpec: expect.any(String) });
    expect(out.decoded.profession).toBe(build.profession);
    expect(traitChoices(out.decoded.specializations)).toEqual(traitChoices(build.specializations));
    expect(out.decoded.specializations[2].elite).toBe(true);
    expect(skillIds(out.decoded.skills)).toEqual(skillIds(build.skills));
    expect(skillIds(out.decoded.underwaterSkills)).toEqual(skillIds(build.underwaterSkills));
    expect(out.decoded.equipment.weapons).toEqual(build.equipment.weapons);
    expect(out.decoded.weaponSkills.length).toBeGreaterThan(0);
    if (build.selectedPets) expect(out.decoded.selectedPets).toEqual(build.selectedPets);
  });
});
