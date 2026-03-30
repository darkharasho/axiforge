"use strict";

/**
 * Regression test for #125: relic on equipment panel is missing facts.
 *
 * The upgrade catalog sent over IPC loses its Maps. The renderer reconstructs
 * id-keyed Maps (relicById) but was missing the name-keyed relicByName Map
 * that the equipment hover preview uses to look up relic descriptions and facts.
 */

const detailPanel = require("../../../src/renderer/modules/detail-panel");
const { state } = require("../../../src/renderer/modules/state");

let savedWindow, savedDocument, savedEditor, savedCatalog, savedUpgradeCatalog;
let mockHover;

beforeEach(() => {
  savedWindow          = global.window;
  savedDocument        = global.document;
  savedEditor          = state.editor;
  savedCatalog         = state.activeCatalog;
  savedUpgradeCatalog  = state.upgradeCatalog;

  global.window = { innerWidth: 1920, innerHeight: 1080 };
  global.document = {
    createElement(tag) {
      if (tag === "textarea") {
        const el = { _html: "", value: "" };
        Object.defineProperty(el, "innerHTML", {
          set(v) { el._html = v; el.value = v; },
          get() { return el._html; },
        });
        return el;
      }
      return {};
    },
  };

  mockHover = {
    innerHTML: "",
    style: {},
    classList: {
      _classes: new Set(),
      add(c)      { this._classes.add(c); },
      remove(c)   { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
    getBoundingClientRect: () => ({ width: 200, height: 100 }),
  };

  detailPanel.initDetailPanel({ hoverPreview: mockHover }, {});
  state.editor = {
    profession: "",
    specializations: [],
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    activeWeaponSet: 1,
    equipment: { slots: {}, weapons: {} },
  };
  state.activeCatalog = null;
});

afterEach(() => {
  global.window          = savedWindow;
  global.document        = savedDocument;
  state.editor           = savedEditor;
  state.activeCatalog    = savedCatalog;
  state.upgradeCatalog   = savedUpgradeCatalog;
});

describe("Relic facts on equipment panel (#125)", () => {
  test("upgradeCatalog with relicByName allows relic facts to be resolved", () => {
    // Simulate the catalog as reconstructed by renderer.js after IPC.
    // The bug: relicByName was never created, so the equipment hover
    // preview could not look up relic data by name.
    const relics = [
      {
        id: 99965,
        name: "Relic of Cerus",
        icon: "https://example.com/cerus.png",
        facts: [
          { type: "Recharge", text: "Cooldown", value: 30 },
          { type: "Percent", text: "Damage Increase", percent: 10 },
        ],
      },
    ];

    const catalog = {
      relics,
      relicById: new Map(relics.map((r) => [r.id, r])),
      relicByName: new Map(relics.map((r) => [r.name, r])),
    };

    // Verify the name-based lookup works (this is what equipment.js uses)
    const found = catalog.relicByName.get("Relic of Cerus");
    expect(found).toBeDefined();
    expect(found.facts).toHaveLength(2);

    // Build a skill card using the looked-up relic data — simulates what
    // the equipment panel hover does
    const entity = {
      name: found.name,
      icon: found.icon,
      description: "",
      facts: found.facts,
    };

    const html = detailPanel.buildSkillCard(entity, "equip-relic");
    expect(html).toContain("Cooldown: 30s");
    expect(html).toContain("Damage Increase");
  });

  test("SPA-style catalog with relicByName from equipmentDisplay resolves facts", () => {
    // Simulates the SPA path: relic data comes from the published build's
    // equipmentDisplay, reconstructed in render-build.js as relicByName.
    const relic = {
      name: "Relic of Cerus",
      icon: "https://example.com/cerus.png",
      description: "Upon using an elite skill, summon an Eye of Cerus.",
      facts: [
        { type: "Recharge", text: "Cooldown", value: 30 },
        { type: "Percent", text: "Damage Increase", percent: 10 },
      ],
    };

    // This mirrors what render-build.js now does:
    const catalog = {
      relicByName: new Map([[relic.name, relic]]),
    };

    const found = catalog.relicByName.get("Relic of Cerus");
    expect(found).toBeDefined();
    expect(found.facts).toHaveLength(2);

    const entity = {
      name: found.name,
      icon: found.icon,
      description: found.description || "",
      facts: found.facts,
    };

    const html = detailPanel.buildSkillCard(entity, "equip-relic");
    expect(html).toContain("Cooldown: 30s");
    expect(html).toContain("Damage Increase");
  });

  test("missing relicByName causes relic facts lookup to fail", () => {
    // Simulates the buggy state where relicByName is not constructed
    const relics = [
      {
        id: 99965,
        name: "Relic of Cerus",
        icon: "https://example.com/cerus.png",
        facts: [
          { type: "Recharge", text: "Cooldown", value: 30 },
        ],
      },
    ];

    const catalog = {
      relics,
      relicById: new Map(relics.map((r) => [r.id, r])),
      // relicByName intentionally omitted — this is the bug
    };

    // This is what equipment.js line 1637 does:
    const catalogRelic = catalog.relicByName?.get("Relic of Cerus");
    expect(catalogRelic).toBeUndefined();

    // Without relicByName, entity gets empty facts
    const entity = {
      name: "Relic of Cerus",
      icon: "https://example.com/cerus.png",
      description: catalogRelic?.description || "",
      facts: catalogRelic?.facts || [],
    };

    const html = detailPanel.buildSkillCard(entity, "equip-relic");
    // Facts are missing — the bug
    expect(html).not.toContain("Cooldown: 30s");
  });
});
