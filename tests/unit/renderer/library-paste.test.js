"use strict";

const {
  nextCopyTitle,
  isGameModeCompatible,
} = require("../../../src/renderer/modules/library/library.js");

describe("nextCopyTitle", () => {
  test("appends (1) when no existing copies", () => {
    expect(nextCopyTitle("My Build", [])).toBe("My Build (1)");
  });

  test("increments to (2) when (1) already exists", () => {
    expect(nextCopyTitle("My Build", ["My Build (1)"])).toBe("My Build (2)");
  });

  test("finds the next gap-free number", () => {
    const existing = ["My Build (1)", "My Build (2)", "My Build (3)"];
    expect(nextCopyTitle("My Build", existing)).toBe("My Build (4)");
  });

  test("skips gaps and uses max+1", () => {
    const existing = ["My Build (1)", "My Build (5)"];
    expect(nextCopyTitle("My Build", existing)).toBe("My Build (6)");
  });

  test("handles title that already has a copy suffix", () => {
    expect(nextCopyTitle("My Build (1)", ["My Build (1)"])).toBe("My Build (2)");
  });

  test("handles title with (Copy) suffix", () => {
    expect(nextCopyTitle("My Build (Copy)", [])).toBe("My Build (Copy) (1)");
  });

  test("returns (1) when existing titles list is empty", () => {
    expect(nextCopyTitle("Test", [])).toBe("Test (1)");
  });

  test("handles base title matching an existing numbered copy", () => {
    const existing = ["My Build (1)", "My Build (2)"];
    expect(nextCopyTitle("My Build (2)", existing)).toBe("My Build (3)");
  });
});

describe("isGameModeCompatible", () => {
  test("open comp (null) is compatible with any build", () => {
    expect(isGameModeCompatible({ gameMode: null }, { gameMode: "pve" })).toBe(true);
    expect(isGameModeCompatible({ gameMode: null }, { gameMode: "wvw" })).toBe(true);
  });

  test("pve comp is compatible with pve build", () => {
    expect(isGameModeCompatible({ gameMode: "pve" }, { gameMode: "pve" })).toBe(true);
  });

  test("pve comp is incompatible with wvw build", () => {
    expect(isGameModeCompatible({ gameMode: "pve" }, { gameMode: "wvw" })).toBe(false);
  });

  test("wvw comp is compatible with wvw build", () => {
    expect(isGameModeCompatible({ gameMode: "wvw" }, { gameMode: "wvw" })).toBe(true);
  });

  test("wvw comp is incompatible with pve build", () => {
    expect(isGameModeCompatible({ gameMode: "wvw" }, { gameMode: "pve" })).toBe(false);
  });
});
