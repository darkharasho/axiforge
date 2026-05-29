"use strict";

const detailPanel = require("../../../src/renderer/modules/detail-panel");
const { state } = require("../../../src/renderer/modules/state");

function makeDetachHost() {
  return { addEventListener: jest.fn() };
}

describe("initDetailPanel — openWikiModal callback injection", () => {
  test("registers a click listener on detailHost", () => {
    const detailHost = makeDetachHost();
    detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, {});
    expect(detailHost.addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
  });

  test("calls openWikiModal with the data-url when a [data-url] element is clicked", () => {
    const openWikiModal = jest.fn();
    const detailHost = makeDetachHost();
    detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, { openWikiModal });

    const [, handler] = detailHost.addEventListener.mock.calls.at(-1);
    const btn = { dataset: { url: "https://wiki.guildwars2.com/wiki/Fireball" } };
    handler({ target: { closest: () => btn } });

    expect(openWikiModal).toHaveBeenCalledWith("https://wiki.guildwars2.com/wiki/Fireball");
  });

  test("does not call openWikiModal when the clicked element has no [data-url]", () => {
    const openWikiModal = jest.fn();
    const detailHost = makeDetachHost();
    detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, { openWikiModal });

    const [, handler] = detailHost.addEventListener.mock.calls.at(-1);
    handler({ target: { closest: () => null } });

    expect(openWikiModal).not.toHaveBeenCalled();
  });

  test("does not throw when no openWikiModal callback is provided", () => {
    const detailHost = makeDetachHost();
    detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, {});

    const [, handler] = detailHost.addEventListener.mock.calls.at(-1);
    const btn = { dataset: { url: "https://wiki.guildwars2.com/wiki/Fireball" } };
    expect(() => handler({ target: { closest: () => btn } })).not.toThrow();
  });
});

describe("initDetailPanel — openDetailModal expand button", () => {
  function makeExpandBtn() {
    return { addEventListener: jest.fn(), disabled: true };
  }

  test("adds click listener to expandBtn when provided", () => {
    const expandBtn = makeExpandBtn();
    detailPanel.initDetailPanel(
      { detailHost: null, hoverPreview: null, expandBtn },
      {}
    );
    expect(expandBtn.addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
  });

  test("calls openDetailModal when expand button is clicked", () => {
    const openDetailModal = jest.fn();
    const expandBtn = makeExpandBtn();
    detailPanel.initDetailPanel(
      { detailHost: null, hoverPreview: null, expandBtn },
      { openDetailModal }
    );
    const [, handler] = expandBtn.addEventListener.mock.calls.at(-1);
    handler();
    expect(openDetailModal).toHaveBeenCalled();
  });

  test("does not throw when expandBtn is null", () => {
    expect(() =>
      detailPanel.initDetailPanel({ detailHost: null, hoverPreview: null, expandBtn: null }, {})
    ).not.toThrow();
  });
});

// ── showHoverPreview — flip-chain suppression for mismatched elite spec ────────
//
// Root cause: the mechBar candidate pool falls back to ALL specialization
// candidates when no skills match the active elite spec.  For Elementalist,
// this means Tempest attunement skills (specialization: 48) can appear on the
// bar even when Catalyst or core is active.  Those Tempest skills carry a
// flipSkill pointer to the corresponding Overload (also spec 48), and because
// both the entity and the flip target share the same spec the while-loop
// mismatch guard inside showHoverPreview never fires — the Overload card would
// be appended.  The fix (suppressMismatchedEliteFlip) checks the entity's own
// specialization against the currently active elite spec and skips the flip
// chain entirely when they differ.

describe("showHoverPreview — flip-chain suppression for mismatched elite spec", () => {
  // Minimal mock specialization catalog (Tempest=48, Weaver=56, Catalyst=67, all elite).
  const MOCK_CATALOG = {
    specializationById: new Map([
      [48, { id: 48, name: "Tempest",  elite: true }],
      [56, { id: 56, name: "Weaver",   elite: true }],
      [67, { id: 67, name: "Catalyst", elite: true }],
    ]),
    skillById: new Map([
      [2001, {
        id: 2001, name: "Overload Fire", specialization: 48, flipSkill: 0,
        icon: "", iconFallback: "", description: "", facts: [], traitedFacts: [],
        slot: "Profession_1", type: "Profession", professions: ["Elementalist"],
        attunement: "", weaponType: "", hasSplit: false,
      }],
      [2002, {
        id: 2002, name: "Overload Fire (Weaver target)", specialization: 0, flipSkill: 0,
        icon: "", iconFallback: "", description: "", facts: [], traitedFacts: [],
        slot: "Profession_1", type: "Profession", professions: ["Elementalist"],
        attunement: "", weaponType: "", hasSplit: false,
      }],
      [3002, {
        id: 3002, name: "Core Flip Target", specialization: 0, flipSkill: 0,
        icon: "", iconFallback: "", description: "", facts: [], traitedFacts: [],
        slot: "", type: "Profession", professions: [],
        attunement: "", weaponType: "", hasSplit: false,
      }],
    ]),
    weaponSkillById: new Map(),
  };

  // A Tempest-spec attunement skill (spec 48) whose flipSkill points to Overload Fire.
  const TEMPEST_ATTUNEMENT = {
    id: 1001, name: "Attune to Fire (Tempest)", specialization: 48, flipSkill: 2001,
    icon: "", iconFallback: "", description: "", facts: [], traitedFacts: [],
    slot: "Profession_1", type: "Profession", professions: ["Elementalist"],
    attunement: "Fire", weaponType: "", hasSplit: false,
  };

  // A Weaver-spec attunement skill (spec 56) whose flipSkill points to an Overload (spec 0).
  // Models real Weaver attunements like Fire Attunement (76703) which have flip chains in the live API.
  const WEAVER_ATTUNEMENT = {
    id: 4001, name: "Fire Attunement (Weaver)", specialization: 56, flipSkill: 2002,
    icon: "", iconFallback: "", description: "", facts: [], traitedFacts: [],
    slot: "Profession_2", type: "Profession", professions: ["Elementalist"],
    attunement: "Fire", weaponType: "", hasSplit: false,
  };

  // A core (spec 0) skill whose flipSkill points to another core (spec 0) skill.
  const CORE_SKILL_WITH_FLIP = {
    id: 3001, name: "Core Skill", specialization: 0, flipSkill: 3002,
    icon: "", iconFallback: "", description: "", facts: [], traitedFacts: [],
    slot: "Profession_1", type: "Profession", professions: [],
    attunement: "", weaponType: "", hasSplit: false,
  };

  let savedEditor;
  let savedCatalog;
  let savedWindow;
  let savedDocument;
  let mockHover;

  beforeEach(() => {
    savedEditor   = state.editor;
    savedCatalog  = state.activeCatalog;
    savedWindow   = global.window;
    savedDocument = global.document;

    global.window = { innerWidth: 1920, innerHeight: 1080 };
    // Minimal document mock: decodeHtmlEntities in utils.js creates a textarea to
    // decode HTML entities — stub it so it returns the raw string (our test data
    // has no entities that need decoding).
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

    // Wire up hoverPreview so showHoverPreview can write to it.
    detailPanel.initDetailPanel({ hoverPreview: mockHover }, {});

    state.activeCatalog = MOCK_CATALOG;
    state.editor = {
      profession: "Elementalist",
      specializations: [],
      skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
      activeWeaponSet: 1,
      equipment: {
        slots: {},
        weapons: { mainhand1: "", offhand1: "", mainhand2: "", offhand2: "" },
      },
    };
  });

  afterEach(() => {
    state.editor        = savedEditor;
    state.activeCatalog = savedCatalog;
    global.window       = savedWindow;
    global.document     = savedDocument;
  });

  test("suppresses Overload flip chain when Catalyst (spec 67) is the active elite spec", () => {
    state.editor.specializations = [{ specializationId: 67, majorChoices: {} }];
    detailPanel.showHoverPreview("skill", TEMPEST_ATTUNEMENT, 100, 100);
    expect(mockHover.innerHTML).not.toContain("hover-preview__chain-divider");
    expect(mockHover.innerHTML).not.toContain("Overload Fire");
  });

  test("suppresses Overload flip chain for core Elementalist (no elite spec selected)", () => {
    state.editor.specializations = [];
    detailPanel.showHoverPreview("skill", TEMPEST_ATTUNEMENT, 100, 100);
    expect(mockHover.innerHTML).not.toContain("hover-preview__chain-divider");
    expect(mockHover.innerHTML).not.toContain("Overload Fire");
  });

  test("shows Overload flip chain when Tempest (spec 48) is the active elite spec", () => {
    state.editor.specializations = [{ specializationId: 48, majorChoices: {} }];
    detailPanel.showHoverPreview("skill", TEMPEST_ATTUNEMENT, 100, 100);
    expect(mockHover.innerHTML).toContain("hover-preview__chain-divider");
    expect(mockHover.innerHTML).toContain("Overload Fire");
  });

  test("does not suppress flip chain for a core (spec 0) non-Elementalist skill", () => {
    // spec=0 entity with a flip to another spec=0 skill should be allowed for non-Elementalist
    state.editor.profession = "Warrior";
    state.editor.specializations = [{ specializationId: 67, majorChoices: {} }];
    detailPanel.showHoverPreview("skill", CORE_SKILL_WITH_FLIP, 100, 100);
    expect(mockHover.innerHTML).toContain("hover-preview__chain-divider");
    expect(mockHover.innerHTML).toContain("Core Flip Target");
  });

  test("suppresses flip chain for a core (spec 0) Elementalist attunement when not Tempest", () => {
    // Core attunement skills (spec=0) fall back into Weaver/Catalyst pool via skill lookup
    // cascade — their flipSkill still points to the Overload and must be suppressed
    state.editor.specializations = [{ specializationId: 56, majorChoices: {} }];
    detailPanel.showHoverPreview("skill", CORE_SKILL_WITH_FLIP, 100, 100);
    expect(mockHover.innerHTML).not.toContain("hover-preview__chain-divider");
    expect(mockHover.innerHTML).not.toContain("Core Flip Target");
  });

  test("suppresses Overload flip chain for Weaver (spec 56) attunement when Weaver is active elite", () => {
    // Weaver entity spec (56) matches active elite spec (56) — suppressMismatchedEliteFlip is false,
    // but suppressElemNonTempestFlip should catch this (Elementalist, active≠48, entitySpec>0).
    state.editor.specializations = [{ specializationId: 56, majorChoices: {} }];
    detailPanel.showHoverPreview("skill", WEAVER_ATTUNEMENT, 100, 100);
    expect(mockHover.innerHTML).not.toContain("hover-preview__chain-divider");
    expect(mockHover.innerHTML).not.toContain("Overload Fire (Weaver target)");
  });

  test("suppresses Overload flip chain for Weaver attunement when Catalyst is active elite", () => {
    state.editor.specializations = [{ specializationId: 67, majorChoices: {} }];
    detailPanel.showHoverPreview("skill", WEAVER_ATTUNEMENT, 100, 100);
    expect(mockHover.innerHTML).not.toContain("hover-preview__chain-divider");
    expect(mockHover.innerHTML).not.toContain("Overload Fire (Weaver target)");
  });
});

// ── showHoverPreview — trait-associated skill cards ─────────────────────────
//
// When hovering over a trait that has traitSkillIds (skills triggered by the
// trait), the hover preview should show the associated skill card(s) below the
// trait card, separated by a "Trait skill" divider.

describe("showHoverPreview — trait-associated skill cards", () => {
  const LESSER_SIGNET = {
    id: 79344, name: "Lesser Signet of the Locust", specialization: 0,
    icon: "", iconFallback: "", description: "Strikes nearby foes", facts: [],
    traitedFacts: [], slot: "", type: "", professions: [],
    attunement: "", weaponType: "", hasSplit: false,
  };

  const TRAIT_WITH_SKILLS = {
    id: 916, name: "Malicious Swarm", tier: 3, slot: "Major",
    specialization: 53, icon: "", iconFallback: "",
    description: "Minions have a chance to inflict poison.",
    facts: [], traitedFacts: [],
    traitSkillIds: [79344],
    traitSkillIcons: { 79344: "" },
  };

  const TRAIT_WITHOUT_SKILLS = {
    id: 900, name: "Plain Trait", tier: 1, slot: "Major",
    specialization: 53, icon: "", iconFallback: "",
    description: "A basic trait.", facts: [], traitedFacts: [],
    traitSkillIds: [],
    traitSkillIcons: {},
  };

  const MOCK_CATALOG = {
    specializationById: new Map(),
    skillById: new Map([
      [79344, LESSER_SIGNET],
    ]),
    weaponSkillById: new Map(),
  };

  let savedEditor;
  let savedCatalog;
  let savedWindow;
  let savedDocument;
  let mockHover;

  beforeEach(() => {
    savedEditor   = state.editor;
    savedCatalog  = state.activeCatalog;
    savedWindow   = global.window;
    savedDocument = global.document;

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

    state.activeCatalog = MOCK_CATALOG;
    state.editor = {
      profession: "Necromancer",
      specializations: [{ specializationId: 53, majorChoices: { 3: 916 } }],
      skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
      activeWeaponSet: 1,
      equipment: {
        slots: {},
        weapons: { mainhand1: "", offhand1: "", mainhand2: "", offhand2: "" },
      },
    };
  });

  afterEach(() => {
    state.editor        = savedEditor;
    state.activeCatalog = savedCatalog;
    global.window       = savedWindow;
    global.document     = savedDocument;
  });

  test("shows associated skill card when trait has traitSkillIds", () => {
    detailPanel.showHoverPreview("trait", TRAIT_WITH_SKILLS, 100, 100);
    expect(mockHover.innerHTML).toContain("Lesser Signet of the Locust");
    expect(mockHover.innerHTML).toContain("hover-preview__trait-skill-divider");
  });

  test("does not show trait-skill divider when trait has no traitSkillIds", () => {
    detailPanel.showHoverPreview("trait", TRAIT_WITHOUT_SKILLS, 100, 100);
    expect(mockHover.innerHTML).not.toContain("hover-preview__trait-skill-divider");
    expect(mockHover.innerHTML).not.toContain("Lesser Signet of the Locust");
  });

  test("does not show trait-skill divider when traitSkillIds is absent", () => {
    const traitNoField = { ...TRAIT_WITH_SKILLS, traitSkillIds: undefined };
    detailPanel.showHoverPreview("trait", traitNoField, 100, 100);
    expect(mockHover.innerHTML).not.toContain("hover-preview__trait-skill-divider");
  });

  test("gracefully skips skill IDs not found in skillById", () => {
    const traitMissing = { ...TRAIT_WITH_SKILLS, traitSkillIds: [99999] };
    detailPanel.showHoverPreview("trait", traitMissing, 100, 100);
    expect(mockHover.innerHTML).not.toContain("hover-preview__trait-skill-divider");
  });
});

describe("formatFactHtml — ComboFinisher / ComboField", () => {
  test("renders combo finisher with type name", () => {
    const html = detailPanel.formatFactHtml({
      type: "ComboFinisher", text: "Combo Finisher", finisher_type: "Blast", percent: 100,
    });
    expect(html).toContain("Combo Finisher: Blast");
    expect(html).not.toContain("100");
  });

  test("renders combo finisher with percent when below 100", () => {
    const html = detailPanel.formatFactHtml({
      type: "ComboFinisher", text: "Combo Finisher", finisher_type: "Whirl", percent: 20,
    });
    expect(html).toContain("Combo Finisher: Whirl (20%)");
  });

  test("renders combo field with field type name", () => {
    const html = detailPanel.formatFactHtml({
      type: "ComboField", text: "Combo Field", field_type: "Fire",
    });
    expect(html).toContain("Combo Field: Fire");
  });

  test("renders combo field type name not a numeric fallback", () => {
    const html = detailPanel.formatFactHtml({
      type: "ComboField", text: "Combo Field", field_type: "Water",
    });
    expect(html).toContain("Combo Field: Water");
    expect(html).not.toContain("Combo Field: 0");
  });
});

describe("getHoverMetaLine — food/utility consumables", () => {
  test("equip-food returns 'Food' meta label, not 'Skill'", () => {
    const entity = { id: 91805, name: "Cilantro Lime Sous-Vide Steak" };
    expect(detailPanel.getHoverMetaLine("equip-food", entity)).toBe("Food");
  });

  test("equip-utility returns 'Utility' meta label, not 'Skill'", () => {
    const entity = { id: 78305, name: "Superior Sharpening Stone" };
    expect(detailPanel.getHoverMetaLine("equip-utility", entity)).toBe("Utility");
  });
});
