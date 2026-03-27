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

  test("detects mismatch when combo finisher_type differs", () => {
    const wikiFacts = [
      { type: "ComboFinisher", text: "Combo Finisher", finisher_type: "Blast", percent: 100 },
    ];
    const splitEntry = {
      facts: [{ type: "ComboFinisher", text: "Combo Finisher", finisher_type: "Whirl", percent: 100 }],
      complete: true,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    expect(result.category).toBe("mismatch");
    expect(result.fact_diffs[0].fields.finisher_type).toEqual({ wiki: "Blast", splits: "Whirl" });
  });

  test("detects mismatch when combo field_type differs", () => {
    const wikiFacts = [
      { type: "ComboField", text: "Combo Field", field_type: "Fire" },
    ];
    const splitEntry = {
      facts: [{ type: "ComboField", text: "Combo Field", field_type: "Water" }],
      complete: true,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    expect(result.category).toBe("mismatch");
    expect(result.fact_diffs[0].fields.field_type).toEqual({ wiki: "Fire", splits: "Water" });
  });

  test("returns match when combo finisher facts agree", () => {
    const wikiFacts = [
      { type: "ComboFinisher", text: "Combo Finisher", finisher_type: "Blast", percent: 100 },
    ];
    const splitEntry = {
      facts: [{ type: "ComboFinisher", text: "Combo Finisher", finisher_type: "Blast", percent: 100 }],
      complete: true,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    expect(result.category).toBe("match");
  });
});

const { compareRelicFacts } = require("../wiki-audit/compare");

describe("compareRelicFacts", () => {
  test("returns match when wiki facts equal stored facts", () => {
    const wikiFacts = [
      { type: "Recharge", text: "Cooldown", value: 30 },
      { type: "Number", text: "Number of Targets", value: 5 },
    ];
    const storedFacts = [
      { type: "Recharge", text: "Cooldown", value: 30 },
      { type: "Number", text: "Number of Targets", value: 5 },
    ];
    const result = compareRelicFacts(wikiFacts, storedFacts);
    expect(result.category).toBe("match");
  });

  test("returns mismatch when a fact value differs", () => {
    const wikiFacts = [
      { type: "Recharge", text: "Cooldown", value: 20 },
    ];
    const storedFacts = [
      { type: "Recharge", text: "Cooldown", value: 30 },
    ];
    const result = compareRelicFacts(wikiFacts, storedFacts);
    expect(result.category).toBe("mismatch");
    expect(result.fact_diffs[0].fields.value).toEqual({ wiki: 20, splits: 30 });
  });

  test("returns missing_from_splits when wiki has facts but stored is empty", () => {
    const wikiFacts = [
      { type: "Recharge", text: "Cooldown", value: 10 },
    ];
    const result = compareRelicFacts(wikiFacts, []);
    expect(result.category).toBe("missing_from_splits");
  });

  test("returns missing_from_splits when stored is null", () => {
    const wikiFacts = [
      { type: "Recharge", text: "Cooldown", value: 10 },
    ];
    const result = compareRelicFacts(wikiFacts, null);
    expect(result.category).toBe("missing_from_splits");
  });

  test("returns no_split when both wiki and stored are empty", () => {
    const result = compareRelicFacts([], []);
    expect(result.category).toBe("no_split");
  });

  test("returns no_split when wiki is empty and stored is null", () => {
    const result = compareRelicFacts([], null);
    expect(result.category).toBe("no_split");
  });
});

const { splitValueChanged, SPLIT_VALUE_KEYS } = require("../../lib/gw2-balance-splits/match");

describe("SPLIT_VALUE_KEYS includes combo keys", () => {
  test("includes finisher_type", () => {
    expect(SPLIT_VALUE_KEYS).toContain("finisher_type");
  });

  test("includes field_type", () => {
    expect(SPLIT_VALUE_KEYS).toContain("field_type");
  });
});

describe("splitValueChanged detects combo type changes", () => {
  test("detects finisher_type change", () => {
    const before = { type: "ComboFinisher", finisher_type: "Blast", percent: 100 };
    const after = { type: "ComboFinisher", finisher_type: "Whirl", percent: 100 };
    expect(splitValueChanged(before, after)).toBe(true);
  });

  test("detects field_type change", () => {
    const before = { type: "ComboField", field_type: "Fire" };
    const after = { type: "ComboField", field_type: "Water" };
    expect(splitValueChanged(before, after)).toBe(true);
  });

  test("no change when combo facts match", () => {
    const before = { type: "ComboFinisher", finisher_type: "Blast", percent: 100 };
    const after = { type: "ComboFinisher", finisher_type: "Blast", percent: 100 };
    expect(splitValueChanged(before, after)).toBe(false);
  });
});
