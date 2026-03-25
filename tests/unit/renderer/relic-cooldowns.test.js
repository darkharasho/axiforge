"use strict";

const detailPanel = require("../../../src/renderer/modules/detail-panel");
const { state } = require("../../../src/renderer/modules/state");

let savedWindow, savedDocument, savedEditor, savedCatalog;
let mockHover;

beforeEach(() => {
  savedWindow   = global.window;
  savedDocument = global.document;
  savedEditor   = state.editor;
  savedCatalog  = state.activeCatalog;

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
  global.window       = savedWindow;
  global.document     = savedDocument;
  state.editor        = savedEditor;
  state.activeCatalog = savedCatalog;
});

describe("Relic inner cooldown display", () => {
  test("buildSkillCard renders a Recharge fact for a relic entity with facts", () => {
    const entity = {
      name: "Relic of Cerus",
      icon: "https://example.com/cerus.png",
      description: "Upon using an elite skill, summon an Eye of Cerus.",
      facts: [{ type: "Recharge", text: "Cooldown", value: 30 }],
    };

    const html = detailPanel.buildSkillCard(entity, "equip-relic");

    expect(html).toContain("Cooldown: 30s");
  });

  test("showHoverPreview renders cooldown fact for relic with facts", () => {
    const entity = {
      name: "Relic of Cerus",
      icon: "https://example.com/cerus.png",
      description: "Upon using an elite skill, summon an Eye of Cerus.",
      facts: [{ type: "Recharge", text: "Cooldown", value: 30 }],
    };

    detailPanel.showHoverPreview("equip-relic", entity, 100, 100);

    expect(mockHover.innerHTML).toContain("Cooldown: 30s");
  });

  test("relic without facts shows no cooldown", () => {
    const entity = {
      name: "Relic of Speed",
      icon: "https://example.com/speed.png",
      description: "Increase movement speed when under the effect of swiftness.",
    };

    detailPanel.showHoverPreview("equip-relic", entity, 100, 100);

    expect(mockHover.innerHTML).not.toContain("Cooldown:");
    expect(mockHover.innerHTML).not.toContain("Recharge:");
  });

  test("buildSkillCard renders fractional cooldown values", () => {
    const entity = {
      name: "Relic of Nourys",
      icon: "https://example.com/nourys.png",
      description: "Gain barrier.",
      facts: [{ type: "Recharge", text: "Cooldown", value: 0.25 }],
    };

    const html = detailPanel.buildSkillCard(entity, "equip-relic");

    expect(html).toContain("Cooldown: 0.25s");
  });
});

describe("Relic facts data", () => {
  test("relicFacts.json contains expected relic entries with facts", () => {
    const data = require("../../../src/main/gw2Data/relicFacts.json");

    expect(data.relics).toBeDefined();
    // Relic of Cerus should have a Recharge fact (ICD)
    const cerus = data.relics["100074"];
    expect(cerus).toBeDefined();
    const cerusRecharge = cerus.facts.find(f => f.type === "Recharge");
    expect(cerusRecharge).toBeDefined();
    expect(cerusRecharge.value).toBe(30);
    // Relic of Speed has no ICD
    const speed = data.relics["100148"];
    expect(speed).toBeDefined();
    expect(speed.facts.find(f => f.type === "Recharge")).toBeUndefined();
  });
});
