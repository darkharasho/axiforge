const { compareEntity } = require("../wiki-audit/compare");

describe("compareEntity", () => {
  test("returns match when facts agree", () => {
    const wikiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 },
    ];
    const splitEntry = {
      facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }],
      complete: true,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    expect(result.category).toBe("match");
    expect(result.fact_diffs).toHaveLength(0);
  });

  test("returns mismatch when coefficient differs", () => {
    const wikiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.8, hit_count: 1 },
    ];
    const splitEntry = {
      facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }],
      complete: true,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    expect(result.category).toBe("mismatch");
    expect(result.fact_diffs[0].fields.dmg_multiplier).toEqual({ wiki: 0.8, splits: 0.5 });
  });

  test("flags wiki-only facts for complete entries", () => {
    const wikiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 },
      { type: "Buff", text: "Fury", status: "Fury", duration: 4, apply_count: 1 },
    ];
    const splitEntry = {
      facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }],
      complete: true,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    expect(result.category).toBe("mismatch");
    expect(result.wiki_only_facts).toHaveLength(1);
    expect(result.wiki_only_facts[0].text).toBe("Fury");
  });

  test("does not flag missing wiki facts for partial entries", () => {
    const wikiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 },
      { type: "Buff", text: "Fury", status: "Fury", duration: 4, apply_count: 1 },
    ];
    const splitEntry = {
      facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }],
      complete: false,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    expect(result.category).toBe("match");
    expect(result.wiki_only_facts).toHaveLength(0);
  });

  test("returns missing_from_splits when splitEntry is null but wiki has toggle", () => {
    const wikiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 },
    ];
    const result = compareEntity(wikiFacts, null, { hasToggle: true });
    expect(result.category).toBe("missing_from_splits");
  });

  test("returns missing_from_wiki when splitEntry exists but wiki has no toggle", () => {
    const splitEntry = {
      facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }],
      complete: true,
    };
    const result = compareEntity([], splitEntry, { hasToggle: false });
    expect(result.category).toBe("missing_from_wiki");
    expect(result.splits_only_facts).toHaveLength(1);
  });
});
