/**
 * @jest-environment jsdom
 *
 * Icon resolution for the history diff. The point of this module is that a
 * change reads as the equipment changing, so every test here asks the same
 * question: did the right artwork come out, and when it could not, did the
 * change still describe itself?
 *
 * NOTE: test files are not run through babel by this repo's jest transform
 * (only src/renderer, packages/forge-render, src/site, src/web are), so this
 * uses require() rather than import — same module, same exports.
 */
"use strict";

const {
  resolveOpVisual,
  renderOpIconStrip,
} = require("../../../src/renderer/modules/library/history-diff-view.js");

const catalog = {
  runeById: new Map([[24836, { id: 24836, name: "Superior Rune of the Scholar", icon: "https://x/rune.png" }]]),
  sigilById: new Map([[24615, { id: 24615, name: "Superior Sigil of Force", icon: "https://x/sigil.png" }]]),
  enrichmentById: new Map([[87417, { id: 87417, name: "WxP Enrichment", icon: "https://x/enrich.png" }]]),
  relicByName: new Map([["Relic of Fireworks", { name: "Relic of Fireworks", icon: "https://x/relic.png" }]]),
};

describe("resolveOpVisual", () => {
  test("names and pictures a rune from the upgrade catalog", () => {
    const vis = resolveOpVisual(
      { t: "gear", slot: "head", part: "rune", noun: "head rune", before: 24836, after: 24836 },
      { catalog },
    );
    expect(vis.before).toMatchObject({ kind: "img", icon: "https://x/rune.png", name: "Superior Rune of the Scholar" });
  });

  test("takes a skill's icon straight off the op — skill ops carry the whole skill", () => {
    const vis = resolveOpVisual(
      { t: "skill", slot: "utility2", noun: "utility 2", before: { id: 1, name: "Spectral Walk", icon: "https://x/a.png" }, after: { id: 2, name: "Well of Suffering", icon: "https://x/b.png" } },
      {},
    );
    expect(vis.before).toMatchObject({ kind: "img", name: "Spectral Walk" });
    expect(vis.after).toMatchObject({ kind: "img", name: "Well of Suffering" });
  });

  test("names a trait from op.vis rather than showing its id", () => {
    const vis = resolveOpVisual(
      { t: "trait", line: 0, tier: 3, noun: "trait tier 3", before: 903, after: 909, vis: { before: { name: "Spiteful Spirit", icon: "https://x/t1.png" }, after: { name: "Signets of Suffering", icon: "https://x/t2.png" } } },
      {},
    );
    expect(vis.before.name).toBe("Spiteful Spirit");
    expect(vis.after.name).toBe("Signets of Suffering");
  });

  // Entries written before diffBuild resolved `vis` still have the documents
  // available in the compare modal, and a saved spec line embeds its catalog.
  test("falls back to the compared documents for a trait with no op.vis", () => {
    const doc = (id, name) => ({
      specializations: [{ id: 53, majorTraitsByTier: { 3: [{ id, name, icon: `https://x/${id}.png` }] } }],
    });
    const vis = resolveOpVisual(
      { t: "trait", line: 0, tier: 3, noun: "trait tier 3", before: 903, after: 909 },
      { fromDoc: doc(903, "Spiteful Spirit"), toDoc: doc(909, "Signets of Suffering") },
    );
    expect(vis.before).toMatchObject({ kind: "img", name: "Spiteful Spirit" });
    expect(vis.after).toMatchObject({ kind: "img", name: "Signets of Suffering" });
  });

  test("resolves a relic by name and every other consumable by id", () => {
    const relic = resolveOpVisual({ t: "consumable", path: "relic", noun: "relic", before: "", after: "Relic of Fireworks" }, { catalog });
    expect(relic.after).toMatchObject({ kind: "img", icon: "https://x/relic.png" });
    const enrich = resolveOpVisual({ t: "consumable", path: "enrichment", noun: "enrichment", before: "", after: 87417 }, { catalog });
    expect(enrich.after).toMatchObject({ kind: "img", name: "WxP Enrichment" });
  });

  // The bug that started this: an unset consumable is stored as "", and
  // "None → 87417" was the whole of what the user saw.
  test("shows an unset value as None, not as an empty chip", () => {
    const vis = resolveOpVisual({ t: "consumable", path: "enrichment", noun: "enrichment", before: "", after: 87417 }, { catalog });
    expect(vis.before).toMatchObject({ kind: "none", name: "None" });
  });

  // Jest maps every `?raw` SVG import to an empty string, so the weapon
  // outline cannot be asserted here — the chip degrades to text under the
  // mock. What IS testable is that a weapon reads as its own name and not as
  // the lowercase key the document stores.
  test("a weapon change names the weapon type", () => {
    const vis = resolveOpVisual({ t: "gear", slot: "mainhand1", part: "weapon", noun: "main hand", before: "axe", after: "dagger" }, {});
    expect(vis.before.name).toBe("Axe");
    expect(vis.after.name).toBe("Dagger");
  });

  // Armor and trinket values are stat prefixes, which have no artwork
  // anywhere in the app — and neither does a stat package.
  test("falls back to a text chip where the app has no icon", () => {
    const item = resolveOpVisual({ t: "gear", slot: "chest", part: "item", noun: "chest", before: "Berserker's", after: "Marauder" }, { catalog });
    expect(item.after).toEqual({ kind: "text", name: "Marauder" });
    const stat = resolveOpVisual({ t: "stat", noun: "stats", before: "Berserker's", after: "Marauder" }, { catalog });
    expect(stat.after).toEqual({ kind: "text", name: "Marauder" });
  });

  test("leaves ops with no two-sided value to the main process's sentence", () => {
    expect(resolveOpVisual({ t: "field", path: "notes", noun: "notes", before: "a", after: "b" }, {})).toBeNull();
    expect(resolveOpVisual({ t: "meta", path: "folderId", noun: "folder", before: "f1", after: "f2" }, {})).toBeNull();
    expect(resolveOpVisual({ t: "raw", path: "partyLines", before: 1, after: 2 }, {})).toBeNull();
  });

  test("an unresolvable id still renders as itself rather than vanishing", () => {
    const vis = resolveOpVisual({ t: "gear", slot: "head", part: "rune", noun: "head rune", before: "", after: 99999 }, { catalog });
    expect(vis.after).toEqual({ kind: "text", name: "99999" });
  });
});

describe("renderOpIconStrip", () => {
  test("shows a pair per change that has artwork", () => {
    const html = renderOpIconStrip([
      { t: "gear", slot: "head", part: "rune", before: 24836, after: 24836 },
      { t: "gear", slot: "mainhand1", part: "sigil0", before: 24615, after: 24615 },
    ], { catalog });
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.querySelectorAll(".hist-strip__pair")).toHaveLength(2);
    expect(el.querySelectorAll("img")).toHaveLength(4);
  });

  test("contributes nothing for changes with no artwork", () => {
    expect(renderOpIconStrip([
      { t: "field", path: "notes", before: "a", after: "b" },
      { t: "stat", before: "Berserker's", after: "Marauder" },
    ], { catalog })).toBe("");
  });

  test("omits derived ops, which are game-patch churn and not edits", () => {
    expect(renderOpIconStrip([
      { t: "derived", path: "skills.heal.icon", before: "a", after: "b" },
    ], { catalog })).toBe("");
  });

  test("counts the changes it could not fit rather than dropping them silently", () => {
    const ops = Array.from({ length: 9 }, () => ({ t: "gear", slot: "head", part: "rune", before: 24836, after: 24836 }));
    const el = document.createElement("div");
    el.innerHTML = renderOpIconStrip(ops, { catalog }, 6);
    expect(el.querySelectorAll(".hist-strip__pair")).toHaveLength(6);
    expect(el.querySelector(".hist-strip__more").textContent).toBe("+3");
  });

  test("escapes names that came from user data", () => {
    const evil = { runeById: new Map([[1, { id: 1, name: '"><img src=x onerror=alert(1)>', icon: "https://x/a.png" }]]) };
    const html = renderOpIconStrip([{ t: "gear", slot: "head", part: "rune", before: 1, after: 1 }], { catalog: evil });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});
