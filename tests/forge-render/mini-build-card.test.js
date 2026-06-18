const { renderMiniBuildCard, renderMissingMiniBuildCard } = require("../../packages/forge-render/src/index.js");

const build = {
  id: "b1",
  title: "Quickness Firebrand",
  profession: "Guardian",
  gameMode: "wvw",
  tags: ["meta"],
  specializations: [
    { name: "Radiance" },
    { name: "Honor" },
    { name: "Firebrand", elite: true },
  ],
  equipment: {
    weapons: { mainhand1: "axe", offhand1: "shield", mainhand2: "staff" },
    statPackage: "Celestial",
    runes: { helm: "24836", chest: "24836" },
    relic: "Relic of the Defender",
  },
};

describe("@axiapps/forge-render mini build card", () => {
  test("renders name, profession class, mode, and weapon labels", () => {
    const html = renderMiniBuildCard(build, null, { showActions: false });
    expect(html).toContain("Quickness Firebrand");
    expect(html).toContain("lib-prof--guardian");
    expect(html).toContain("wvw");
    expect(html).toContain("Axe");
    expect(html).toContain("Staff");
    expect(html).toContain("Celestial");
    expect(html).toContain("Relic of the Defender");
  });

  test("escapes html in titles", () => {
    const html = renderMiniBuildCard({ ...build, title: "<img src=x>" }, null, { showActions: false });
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img");
  });

  test("sanitizes the profession class slug against attribute injection", () => {
    const html = renderMiniBuildCard(
      { ...build, profession: 'Warrior" onmouseover="x' },
      null,
      { showActions: false }
    );
    // The quote and space are stripped, so the payload can never escape the
    // class attribute: no `" onmouseover="x"` ends up in the markup.
    expect(html).not.toContain('"x"');
    expect(html).not.toContain('onmouseover=');
    expect(html).not.toContain('" onmouseover');
    expect(html).toContain('class="mini-card lib-prof--warrioronmouseoverx"');
  });

  test("renders the missing-build placeholder", () => {
    expect(renderMissingMiniBuildCard("deadbeefdeadbeef")).toContain("Missing Build");
  });

  test("renders weapon + utility skills (named), trait icons with hover names, and a chat-code bar", () => {
    const enriched = {
      ...build,
      specializations: [
        { name: "Strength", selectedTraits: [{ id: 1, name: "Peak Performance", icon: "https://render.guildwars2.com/file/A/1.png" }] },
        { name: "Berserker", elite: true, selectedTraits: [{ id: 2, name: "Bloody Roar", icon: "https://render.guildwars2.com/file/B/2.png" }] },
      ],
      weaponSkills: [
        { id: 100, name: "Hundred Blades", icon: "https://render.guildwars2.com/file/W/hb.png" },
      ],
      skills: {
        heal: { id: 10, name: "Blood Reckoning", icon: "https://render.guildwars2.com/file/C/h.png" },
        utility: [{ id: 11, name: "Balanced Stance", icon: "https://render.guildwars2.com/file/D/u.png" }],
        elite: { id: 12, name: "Battle Standard", icon: "https://render.guildwars2.com/file/E/e.png" },
      },
      chatCode: "[&DQIRGgYZIzaU...]",
    };
    const html = renderMiniBuildCard(enriched, null, { showActions: false, chatLink: enriched.chatCode });
    expect(html).toContain("mini-card__trait");
    expect(html).toContain('data-name="Peak Performance"'); // hover tooltip source
    expect(html).toContain("/file/A/1.png");
    expect(html).toContain("mini-card__skills");
    expect(html).toContain("/file/W/hb.png"); // weapon skill on the top row
    expect(html).toContain("/file/C/h.png"); // utility (heal) skill
    expect(html).toContain("mini-card__skill-name"); // skills are named
    expect(html).toContain("Hundred Blades");
    expect(html).toContain("mini-card__skill-div"); // weapon|utility divider
    expect(html).toContain("mini-card__chatbar");
    expect(html).toContain("[&amp;DQIRGgYZIzaU...]");
    // The chatbar is the only copy affordance — no redundant header button.
    expect(html).not.toContain("mini-card__btn-copy-code");
  });

  test("renders page-scraped gear (weapons+sigils, stats, rune) with its own icons", () => {
    const withGear = {
      ...build,
      scrapedGear: {
        weapons: [{ type: "Scepter", name: "Scepter", icon: null, sigils: [{ name: "Sigil of Force", icon: "https://render.guildwars2.com/file/G/s.png" }] }],
        rune: { name: "Superior Rune of Divinity", icon: "https://render.guildwars2.com/file/G/r.png", count: 6 },
        sigils: [],
        stats: "Celestial",
        infusions: [],
        weaponSkills: [],
      },
    };
    const html = renderMiniBuildCard(withGear, null, { showActions: false });
    expect(html).toContain("Scepter");
    expect(html).toContain("/file/G/s.png"); // sigil icon
    expect(html).toContain("Celestial");
    expect(html).toContain("Superior Rune of Divinity");
    expect(html).toContain("x6");
    expect(html).toContain("/file/G/r.png"); // rune icon
  });

  test("renders a relic row in the scraped-gear column when present", () => {
    const withRelic = {
      ...build,
      scrapedGear: {
        weapons: [],
        rune: null,
        sigils: [],
        stats: "Celestial",
        infusions: [],
        weaponSkills: [],
        relic: { name: "Relic of the Water", icon: "https://render.guildwars2.com/file/G/relic.png" },
      },
    };
    const html = renderMiniBuildCard(withRelic, null, { showActions: false });
    expect(html).toContain("mini-card__relic");
    expect(html).toContain("Relic of the Water");
    expect(html).toContain("/file/G/relic.png");
  });

  test("renders the source link-badge as a clickable anchor when linkUrl is given", () => {
    const html = renderMiniBuildCard(build, null, {
      showActions: false,
      linkUrl: "https://metabattle.com/wiki/Build:Firebrand",
      linkBadge: { label: "MetaBattle", tooltip: "Source: https://metabattle.com/wiki/Build:Firebrand" },
    });
    expect(html).toContain('<a class="mini-card__link-badge"');
    expect(html).toContain('href="https://metabattle.com/wiki/Build:Firebrand"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("MetaBattle");
  });

  test("omits trait/skill/chat sections when the build lacks that data", () => {
    const html = renderMiniBuildCard(build, null, { showActions: false });
    expect(html).not.toContain("mini-card__trait-icon");
    expect(html).not.toContain("mini-card__skills");
    expect(html).not.toContain("mini-card__chatbar");
  });
});
