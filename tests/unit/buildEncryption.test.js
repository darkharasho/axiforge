"use strict";
const { slugifyBuildName, generateFileId, generateEncryptionKey, encryptBuild, decryptBuild, getDefaultBuildName } = require("../../src/main/buildEncryption");

describe("slugifyBuildName", () => {
  test("lowercases and replaces spaces with hyphens", () => { expect(slugifyBuildName("Power Reaper")).toBe("power-reaper"); });
  test("strips special characters", () => { expect(slugifyBuildName("My Build! @#$%")).toBe("my-build"); });
  test("collapses multiple hyphens", () => { expect(slugifyBuildName("Power --- Reaper")).toBe("power-reaper"); });
  test("trims leading/trailing hyphens", () => { expect(slugifyBuildName(" --Power Reaper-- ")).toBe("power-reaper"); });
  test("handles unicode by stripping non-ascii", () => { expect(slugifyBuildName("Über Build")).toBe("ber-build"); });
  test("returns 'build' for empty input", () => { expect(slugifyBuildName("")).toBe("build"); expect(slugifyBuildName("!!!")).toBe("build"); });
});

describe("generateFileId", () => {
  test("returns 8-char hex string", () => { expect(generateFileId()).toMatch(/^[0-9a-f]{8}$/); });
  test("generates unique IDs", () => { const ids = new Set(Array.from({ length: 100 }, () => generateFileId())); expect(ids.size).toBe(100); });
});

describe("encryptBuild / decryptBuild", () => {
  const buildData = { title: "Power Reaper", profession: "Necromancer", skills: { healId: 123 } };
  test("generateEncryptionKey returns base64url ~43 chars", () => { const key = generateEncryptionKey(); expect(key.length).toBe(43); expect(key).toMatch(/^[A-Za-z0-9_-]+$/); });
  test("round-trip", () => { const key = generateEncryptionKey(); expect(decryptBuild(encryptBuild(buildData, key), key)).toEqual(buildData); });
  test("encrypted differs from plaintext", () => { const key = generateEncryptionKey(); expect(encryptBuild(buildData, key)).not.toContain("Power Reaper"); });
  test("different keys produce different ciphertext", () => { const k1 = generateEncryptionKey(); const k2 = generateEncryptionKey(); expect(encryptBuild(buildData, k1)).not.toBe(encryptBuild(buildData, k2)); });
  test("wrong key throws", () => { const k1 = generateEncryptionKey(); const k2 = generateEncryptionKey(); expect(() => decryptBuild(encryptBuild(buildData, k1), k2)).toThrow(); });
  test("handles large objects", () => { const big = { ...buildData, notes: "x".repeat(50000) }; const key = generateEncryptionKey(); expect(decryptBuild(encryptBuild(big, key), key)).toEqual(big); });
});

describe("getDefaultBuildName", () => {
  test("returns elite spec name", () => { expect(getDefaultBuildName([{ id: 1, name: "Spite", elite: false }, { id: 3, name: "Reaper", elite: true }], "Necromancer")).toBe("Reaper"); });
  test("returns Core {profession} for all core", () => { expect(getDefaultBuildName([{ id: 1, name: "Spite", elite: false }], "Necromancer")).toBe("Core Necromancer"); });
  test("returns Build for no specs no profession", () => { expect(getDefaultBuildName([], "")).toBe("Build"); });
});
