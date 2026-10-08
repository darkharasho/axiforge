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

describe("v2 payload envelope", () => {
  const {
    encryptPayload, decryptPayload, payloadVersion, PayloadVersionError, encryptBuild, generateEncryptionKey,
  } = require("../../src/main/buildEncryption");
  const key = generateEncryptionKey();
  const data = { title: "Firebrand", notes: "x".repeat(5000), nested: { a: [1, 2, 3] } };

  test("round-trips through encryptPayload/decryptPayload", () => {
    expect(decryptPayload(encryptPayload(data, key), key)).toEqual(data);
  });

  test("writes the 00 'A' 'X' 02 header and no base64", () => {
    const bytes = encryptPayload(data, key);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x41, 0x58, 0x02]);
    expect(payloadVersion(bytes)).toBe(2);
  });

  test("compresses before encrypting", () => {
    const big = { catalog: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: "Skill name", facts: [] })) };
    const v1 = Buffer.byteLength(encryptBuild(big, key));
    expect(encryptPayload(big, key).length).toBeLessThan(v1 / 5);
  });

  test("still decodes a v1 base64 string, with or without trailing whitespace", () => {
    const v1 = encryptBuild(data, key);
    expect(payloadVersion(v1)).toBe(1);
    expect(decryptPayload(v1, key)).toEqual(data);
    expect(decryptPayload(`${v1}\n`, key)).toEqual(data);
    expect(decryptPayload(Buffer.from(v1, "utf8"), key)).toEqual(data);
  });

  test("an unknown header version throws PayloadVersionError", () => {
    const bytes = encryptPayload(data, key);
    bytes[3] = 0x03;
    expect(() => decryptPayload(bytes, key)).toThrow(PayloadVersionError);
    try { decryptPayload(bytes, key); } catch (err) { expect(err.version).toBe(3); }
  });

  test("a wrong key fails rather than returning garbage", () => {
    expect(() => decryptPayload(encryptPayload(data, key), generateEncryptionKey())).toThrow();
  });
});
