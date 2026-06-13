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

  test("renders the missing-build placeholder", () => {
    expect(renderMissingMiniBuildCard("deadbeefdeadbeef")).toContain("Missing Build");
  });
});
