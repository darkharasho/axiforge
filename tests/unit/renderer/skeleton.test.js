"use strict";

const { skeletonTemplates, injectSkeleton } = require("../../../src/renderer/modules/skeleton");

describe("skeletonTemplates", () => {
  test("exports templates for all five panels", () => {
    expect(skeletonTemplates).toHaveProperty("skills");
    expect(skeletonTemplates).toHaveProperty("specs");
    expect(skeletonTemplates).toHaveProperty("equipment");
    expect(skeletonTemplates).toHaveProperty("detail");
    expect(skeletonTemplates).toHaveProperty("dropdown");
  });

  test("each template is a non-empty string containing skel class", () => {
    for (const [key, html] of Object.entries(skeletonTemplates)) {
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain("skel");
    }
  });

  test("skills template contains weapon-col, mechbar, swap, orb, and utility group", () => {
    expect(skeletonTemplates.skills).toContain("skel-skills__weapon-col");
    expect(skeletonTemplates.skills).toContain("skel-skills__mechbar");
    expect(skeletonTemplates.skills).toContain("skel-skills__swap");
    expect(skeletonTemplates.skills).toContain("skel-skills__orb");
    expect(skeletonTemplates.skills).toContain("skel-skills__group");
  });

  test("specs template contains 3 spec cards with hex emblems", () => {
    const matches = skeletonTemplates.specs.match(/skel-spec-card__emblem/g);
    expect(matches).toHaveLength(3);
    expect(skeletonTemplates.specs).toContain("skel-hex");
  });

  test("specs template has panel, body, major and minor traits", () => {
    expect(skeletonTemplates.specs).toContain("skel-spec-card__panel");
    expect(skeletonTemplates.specs).toContain("skel-spec-card__body");
    expect(skeletonTemplates.specs).toContain("skel-spec-card__major-trait");
    expect(skeletonTemplates.specs).toContain("skel-spec-card__minor");
  });

  test("equipment template contains full structure with sections and slot types", () => {
    expect(skeletonTemplates.equipment).toContain("skel-equip__col--art");
    expect(skeletonTemplates.equipment).toContain("skel-equip__col--right");
    expect(skeletonTemplates.equipment).toContain("skel-equip__slot-icon");
    expect(skeletonTemplates.equipment).toContain("skel-equip__stat-cell");
    expect(skeletonTemplates.equipment).toContain("skel-equip__section");
    expect(skeletonTemplates.equipment).toContain("skel-equip__section-head");
    expect(skeletonTemplates.equipment).toContain("skel-equip__slot--weapon");
    expect(skeletonTemplates.equipment).toContain("skel-equip__weapon-type");
    expect(skeletonTemplates.equipment).toContain("skel-equip__weapon-stat");
    expect(skeletonTemplates.equipment).toContain("skel-equip__slot--compact");
    expect(skeletonTemplates.equipment).toContain("skel-equip__set-label");
    expect(skeletonTemplates.equipment).toContain("skel-equip__text-input");
    expect(skeletonTemplates.equipment).toContain("skel-equip__trinket-grid--4");
  });

  test("detail template has card wrapper, icon, and fact rows", () => {
    expect(skeletonTemplates.detail).toContain("skel-detail\"");
    expect(skeletonTemplates.detail).toContain("skel-detail__icon");
    expect(skeletonTemplates.detail).toContain("skel-detail__fact-row");
    expect(skeletonTemplates.detail).toContain("skel-detail__fact-icon");
  });
});

describe("injectSkeleton", () => {
  test("sets innerHTML of element to the named template", () => {
    const el = { innerHTML: "" };
    injectSkeleton(el, "skills");
    expect(el.innerHTML).toBe(skeletonTemplates.skills);
  });

  test("does nothing if element is null", () => {
    expect(() => injectSkeleton(null, "skills")).not.toThrow();
  });

  test("does nothing if template name is unknown", () => {
    const el = { innerHTML: "existing" };
    injectSkeleton(el, "nonexistent");
    expect(el.innerHTML).toBe("existing");
  });
});

describe("library skeleton templates", () => {
  test("exports templates for all library panels including toolbar and filters", () => {
    expect(skeletonTemplates).toHaveProperty("library-toolbar");
    expect(skeletonTemplates).toHaveProperty("library-filters");
    expect(skeletonTemplates).toHaveProperty("library-sidebar");
    expect(skeletonTemplates).toHaveProperty("library-list");
    expect(skeletonTemplates).toHaveProperty("library-table");
    expect(skeletonTemplates).toHaveProperty("library-grid");
    expect(skeletonTemplates).toHaveProperty("library-icon");
  });

  test("library-toolbar contains breadcrumb and controls structure", () => {
    expect(skeletonTemplates["library-toolbar"]).toContain("lib-toolbar__breadcrumb");
    expect(skeletonTemplates["library-toolbar"]).toContain("lib-toolbar__controls");
  });

  test("library-filters contains filters bar structure", () => {
    expect(skeletonTemplates["library-filters"]).toContain("lib-filters__bar");
  });

  test("library-sidebar contains section structure and skeleton items", () => {
    expect(skeletonTemplates["library-sidebar"]).toContain("skel-lib-sidebar");
    expect(skeletonTemplates["library-sidebar"]).toContain("skel-lib-sidebar-item");
    expect(skeletonTemplates["library-sidebar"]).toContain("skel-lib-sidebar-icon");
    expect(skeletonTemplates["library-sidebar"]).toContain("skel-lib-sidebar-head");
  });

  test("library-list contains 6 rows with icon placeholder", () => {
    const icons = (skeletonTemplates["library-list"].match(/skel-lib-row-icon/g) || []).length;
    expect(icons).toBe(6);
    expect(skeletonTemplates["library-list"]).toContain("lib-list-row");
  });

  test("library-table contains header row and 6 data rows matching lib-tv grid", () => {
    expect(skeletonTemplates["library-table"]).toContain("lib-tv__header");
    const rows = (skeletonTemplates["library-table"].match(/class="lib-tv__row"/g) || []).length;
    expect(rows).toBe(6);
    expect(skeletonTemplates["library-table"]).toContain("skel-lib-row-icon");
  });

  test("library-grid contains 6 cards with centered icon using lib-grid classes", () => {
    const cards = (skeletonTemplates["library-grid"].match(/class="lib-grid-card"/g) || []).length;
    expect(cards).toBe(6);
    expect(skeletonTemplates["library-grid"]).toContain("lib-grid-card__header");
    expect(skeletonTemplates["library-grid"]).toContain("skel-lib-card-icon");
  });

  test("library-icon contains 10 icon items using lib-icon classes", () => {
    const items = (skeletonTemplates["library-icon"].match(/class="lib-icon-item"/g) || []).length;
    expect(items).toBe(10);
    expect(skeletonTemplates["library-icon"]).toContain("skel-lib-icon-img");
  });
});
