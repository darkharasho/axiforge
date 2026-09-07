"use strict";

const { renderSummary } = require("../../../src/main/history/renderSummary");

describe("renderSummary", () => {
  test("names a gear swap by slot and part", () => {
    expect(renderSummary([
      { t: "gear", slot: "head", part: "rune",
        before: "Superior Rune of the Scholar", after: "Superior Rune of Durability" },
    ])).toBe("head rune: Superior Rune of the Scholar → Superior Rune of Durability");
  });

  test("names a skill swap by slot", () => {
    expect(renderSummary([
      { t: "skill", slot: "utility2", uw: false,
        before: { id: 1, name: "Endure Pain" }, after: { id: 2, name: "Frenzy" } },
    ])).toBe("utility 2: Endure Pain → Frenzy");
  });

  test("marks underwater skills", () => {
    expect(renderSummary([
      { t: "skill", slot: "heal", uw: true,
        before: { id: 1, name: "A" }, after: { id: 2, name: "B" } },
    ])).toBe("underwater heal: A → B");
  });

  test("describes a folder move by name when a resolver is given", () => {
    expect(renderSummary(
      [{ t: "meta", path: "folderId", before: "f1", after: "f2" }],
      { folderNameOf: (id) => ({ f1: "Drafts", f2: "Raids/Support" })[id] },
    )).toBe("moved to Raids/Support");
  });

  test("falls back to a bare move when the folder cannot be named", () => {
    expect(renderSummary(
      [{ t: "meta", path: "folderId", before: "f1", after: "f2" }],
    )).toBe("moved to another folder");
  });

  test("groups above four ops", () => {
    const ops = [
      { t: "gear", slot: "head", part: "rune", before: "a", after: "b" },
      { t: "gear", slot: "chest", part: "rune", before: "a", after: "b" },
      { t: "gear", slot: "hands", part: "rune", before: "a", after: "b" },
      { t: "gear", slot: "mainhand1", part: "sigil0", before: "a", after: "b" },
      { t: "gear", slot: "offhand1", part: "sigil0", before: "a", after: "b" },
      { t: "field", path: "notes", before: "a", after: "b" },
    ];
    expect(renderSummary(ops)).toBe("3 gear slots, 2 sigils, notes");
  });

  test("joins two or three ops with semicolons", () => {
    expect(renderSummary([
      { t: "field", path: "title", before: "Old", after: "New" },
      { t: "field", path: "notes", before: "a", after: "b" },
    ])).toBe('title: "Old" → "New"; notes updated');
  });

  test("derived ops never appear", () => {
    expect(renderSummary([
      { t: "derived", path: "skills.heal.description", before: "a", after: "b" },
      { t: "field", path: "notes", before: "a", after: "b" },
    ])).toBe("notes updated");
  });

  test("an empty op list is never summarised", () => {
    expect(renderSummary([])).toBe("");
  });

  test('"build updated" is not a reachable output', () => {
    const shapes = [
      [{ t: "raw", path: "mystery", before: 1, after: 2 }],
      [{ t: "stat", before: "Berserker", after: "Dragon" }],
      [{ t: "meta", path: "archivedAt", before: null, after: "2026-09-01" }],
    ];
    for (const ops of shapes) {
      expect(renderSummary(ops)).not.toBe("build updated");
      expect(renderSummary(ops).length).toBeGreaterThan(0);
    }
  });

  // Task 1 widened `field` paths past the brief's original five (title, notes,
  // tags, profession, gameMode). Each of the five extras needs its own label
  // or it renders unlabelled — see renderSummary.js FIELD_META.
  describe("labels the five field paths Task 1 added", () => {
    test("images", () => {
      expect(renderSummary([
        { t: "field", path: "images", before: [], after: ["a.png"] },
      ])).toBe("images updated");
    });

    test("selectedLegends", () => {
      expect(renderSummary([
        { t: "field", path: "selectedLegends", before: ["Jalis"], after: ["Shiro"] },
      ])).toBe("legends changed");
    });

    test("selectedUnderwaterLegends", () => {
      expect(renderSummary([
        { t: "field", path: "selectedUnderwaterLegends", before: ["Jalis"], after: ["Shiro"] },
      ])).toBe("underwater legends changed");
    });

    test("selectedPets", () => {
      expect(renderSummary([
        { t: "field", path: "selectedPets", before: ["Jacaranda"], after: ["Bristleback"] },
      ])).toBe("pets changed");
    });

    test("morphSkillIds", () => {
      expect(renderSummary([
        { t: "field", path: "morphSkillIds", before: [1], after: [2] },
      ])).toBe("morph skills changed");
    });

    test("each of the five gets its own grouped noun, not a generic fallback", () => {
      const ops = [
        { t: "field", path: "images", before: 1, after: 2 },
        { t: "field", path: "selectedLegends", before: 1, after: 2 },
        { t: "field", path: "selectedUnderwaterLegends", before: 1, after: 2 },
        { t: "field", path: "selectedPets", before: 1, after: 2 },
        { t: "field", path: "morphSkillIds", before: 1, after: 2 },
      ];
      expect(renderSummary(ops)).toBe(
        "images, legends, underwater legends, pets, morph skills",
      );
    });
  });
});

// ─── comp ops (history/diffComp.js) ─────────────────────────────────────────

describe("renderSummary — comps", () => {
  test("names the party and the slot, one-based, resolving build ids to titles", () => {
    const ops = [{ t: "slot", line: 1, index: 2, before: "b1", after: "b2" }];
    const buildNameOf = (id) => ({ b1: "Heal Druid", b2: "Alacrity Mechanist" }[id]);
    expect(renderSummary(ops, { buildNameOf })).toBe("party 2 slot 3: Heal Druid → Alacrity Mechanist");
  });

  test("an unresolvable id still renders — the raw id beats saying nothing", () => {
    expect(renderSummary([{ t: "slot", line: 0, index: 0, before: null, after: "b9" }]))
      .toBe("party 1 slot 1: (none) → b9");
  });

  test("a category slot reads as the category it reserves, not as a build", () => {
    expect(renderSummary([{ t: "slot", line: 0, index: 4, before: null, after: "tag:heal" }]))
      .toBe("party 1 slot 5: (none) → any heal");
  });

  test("many slot moves group into a count rather than five clauses", () => {
    const ops = [0, 1, 2, 3, 4].map((index) => ({ t: "slot", line: 0, index, before: null, after: `b${index}` }));
    expect(renderSummary(ops)).toBe("5 party slots");
  });

  test("a comp rename quotes the name", () => {
    expect(renderSummary([{ t: "field", path: "name", before: "Zerg", after: "Havoc" }]))
      .toBe('name: "Zerg" → "Havoc"');
  });
});

describe("renderSummary — comp party lines", () => {
  test("a party added reads as such, not as serialised JSON", () => {
    expect(renderSummary([{ t: "raw", path: "partyLines.1", before: undefined, after: { id: "l2", slots: [] } }]))
      .toBe("party 2 added");
  });

  test("a party removed reads as such", () => {
    expect(renderSummary([{ t: "raw", path: "partyLines.1", before: { id: "l2", slots: [] }, after: undefined }]))
      .toBe("party 2 removed");
  });

  test("a line attribute names the party it belongs to", () => {
    expect(renderSummary([{ t: "raw", path: "partyLines.0.capacity", before: 5, after: 10 }]))
      .toBe("party 1 capacity: 5 → 10");
  });

  test("the whole container changing shape says so plainly", () => {
    expect(renderSummary([{ t: "raw", path: "partyLines", before: [], after: null }]))
      .toBe("party lines changed");
  });
});

// ─── final review, B5: two fallbacks nothing was pinning ─────────────────────

describe("a field with no entry in the vocabulary still says something", () => {
  // fieldDetail's fallback. Every field that HAS a FIELD_META entry is pinned
  // above; a field added to FIELD_PATHS and not to FIELD_META fell through to
  // this line, and the reviewer's mutation of it broke no test.
  test("an unmapped field names itself, humanized", () => {
    expect(renderSummary([{ t: "field", path: "gameplayNotes", before: "a", after: "b" }]))
      .toBe("gameplay notes updated");
  });

  test("a dotted unmapped field reads as words, not as a path", () => {
    expect(renderSummary([{ t: "field", path: "loadout.primaryWeapon", before: 1, after: 2 }]))
      .toBe("loadout primary weapon updated");
  });
});

describe("the grouped form names incidental changes other than a folder move", () => {
  // groupBareNoun's meta branch. Grouping only kicks in past four ops, which is
  // why no existing test reached the non-folderId side of it.
  test("an archive stamp is named, and a folder move is still 'folder'", () => {
    const summary = renderSummary([
      { t: "meta", path: "archivedAt", before: null, after: "2026-09-01T00:00:00.000Z" },
      { t: "meta", path: "folderId", before: "f1", after: "f2" },
      { t: "field", path: "title", before: "a", after: "b" },
      { t: "stat", before: "Berserker", after: "Marauder" },
      { t: "spec", line: 0, before: { id: 1 }, after: { id: 2 } },
    ]);
    expect(summary).toBe("archived at, folder, title, stats, specialization");
  });

  test("a trash stamp is named too", () => {
    const summary = renderSummary([
      { t: "meta", path: "trashBatchId", before: null, after: "batch-1" },
      { t: "field", path: "title", before: "a", after: "b" },
      { t: "field", path: "notes", before: "a", after: "b" },
      { t: "stat", before: "Berserker", after: "Marauder" },
      { t: "spec", line: 0, before: { id: 1 }, after: { id: 2 } },
    ]);
    expect(summary).toContain("trash batch id");
  });
});

// ---------------------------------------------------------------------------
// Item ids
//
// Runes, sigils, infusions and the enrichment/food/utility consumables are all
// stored as GW2 item ids. Without a resolver the summary reads
// "enrichment: (none) → 79926" — and because the one-line summary is frozen
// into the log when the version is written, it reads that way forever.
// ---------------------------------------------------------------------------

describe("item ids are resolved to names when a resolver is given", () => {
  const itemNameOf = (id) => ({
    79926: "Vision Enrichment",
    91734: "Peppercorn-Crusted Sous-Vide Steak",
    24703: "Superior Rune of the Scholar",
    24618: "Superior Sigil of Force",
    43254: "Mighty +9 Agony Infusion",
  })[Number(id)];

  test("names an enrichment change on both sides", () => {
    expect(renderSummary(
      [{ t: "consumable", path: "enrichment", before: "43254", after: "79926" }],
      { itemNameOf },
    )).toBe("enrichment: Mighty +9 Agony Infusion → Vision Enrichment");
  });

  test("names a consumable set from nothing", () => {
    expect(renderSummary(
      [{ t: "consumable", path: "food", before: "", after: "91734" }],
      { itemNameOf },
    )).toBe("food: (none) → Peppercorn-Crusted Sous-Vide Steak");
  });

  test("names runes, sigils and infusions", () => {
    expect(renderSummary(
      [{ t: "gear", slot: "head", part: "rune", before: "", after: "24703" }],
      { itemNameOf },
    )).toBe("head rune: (none) → Superior Rune of the Scholar");
    expect(renderSummary(
      [{ t: "gear", slot: "mainhand1", part: "sigil0", before: "", after: "24618" }],
      { itemNameOf },
    )).toBe("main hand sigil: (none) → Superior Sigil of Force");
    expect(renderSummary(
      [{ t: "gear", slot: "chest", part: "infusion", before: "", after: "43254" }],
      { itemNameOf },
    )).toBe("chest infusion: (none) → Mighty +9 Agony Infusion");
  });

  // `relic` holds a name, and a gear slot holds a stat prefix or a weapon type.
  // Running those through the resolver must not mangle them.
  test("leaves values that are already words alone", () => {
    expect(renderSummary(
      [{ t: "consumable", path: "relic", before: "", after: "Relic of Bava Nisos" }],
      { itemNameOf },
    )).toBe("relic: (none) → Relic of Bava Nisos");
    expect(renderSummary(
      [{ t: "gear", slot: "head", part: "item", before: "Berserker's", after: "Marauder" }],
      { itemNameOf },
    )).toBe("head: Berserker's → Marauder");
    expect(renderSummary(
      [{ t: "gear", slot: "mainhand1", part: "weapon", before: "sword", after: "dagger" }],
      { itemNameOf },
    )).toBe("main hand: sword → dagger");
  });

  test("falls back to the raw id when there is no resolver, or it cannot name the id", () => {
    expect(renderSummary(
      [{ t: "consumable", path: "enrichment", before: "", after: "79926" }],
    )).toBe("enrichment: (none) → 79926");
    expect(renderSummary(
      [{ t: "consumable", path: "enrichment", before: "", after: "12345" }],
      { itemNameOf },
    )).toBe("enrichment: (none) → 12345");
  });
});
