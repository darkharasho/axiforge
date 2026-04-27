"use strict";

const {
  parseVersion,
  compareVersion,
  extractReleaseNotesRangeFromFile,
} = require("../../src/main/versionUtils");

describe("parseVersion", () => {
  test("parses plain semver", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
  });
  test("strips leading v", () => {
    expect(parseVersion("v0.6.18")).toEqual([0, 6, 18]);
  });
  test("returns null for non-semver", () => {
    expect(parseVersion("not-a-version")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe("compareVersion", () => {
  test("orders by major, minor, patch", () => {
    expect(compareVersion([1, 0, 0], [0, 9, 9])).toBeGreaterThan(0);
    expect(compareVersion([1, 2, 3], [1, 2, 4])).toBeLessThan(0);
    expect(compareVersion([0, 6, 18], [0, 6, 18])).toBe(0);
  });
});

const SAMPLE_NOTES = `## Version v0.6.18 — April 26, 2026

### Bug Fixes

- Cross-profession traits resolve.

## Version v0.6.17 — April 24, 2026

### Bug Fixes

- Shared folder contents reload after sync.

## Version v0.6.16 — April 24, 2026

### Bug Fixes

- Forces full re-sync on reconnect.
`;

describe("extractReleaseNotesRangeFromFile", () => {
  test("returns all sections up to current when no lastSeenVersion", () => {
    const result = extractReleaseNotesRangeFromFile(SAMPLE_NOTES, "0.6.18", null);
    expect(result).toContain("## Version v0.6.18");
    expect(result).toContain("## Version v0.6.17");
    expect(result).toContain("## Version v0.6.16");
  });

  test("excludes versions <= lastSeenVersion", () => {
    const result = extractReleaseNotesRangeFromFile(SAMPLE_NOTES, "0.6.18", "0.6.17");
    expect(result).toContain("## Version v0.6.18");
    expect(result).not.toContain("## Version v0.6.17");
    expect(result).not.toContain("## Version v0.6.16");
  });

  test("excludes versions > currentVersion (e.g. an entry for an unreleased build)", () => {
    const notes = `## Version v0.7.0 — May 1, 2026\n\n- future\n\n${SAMPLE_NOTES}`;
    const result = extractReleaseNotesRangeFromFile(notes, "0.6.18", null);
    expect(result).not.toContain("0.7.0");
    expect(result).toContain("0.6.18");
  });

  test("returns null when no sections fall in range", () => {
    expect(extractReleaseNotesRangeFromFile(SAMPLE_NOTES, "0.6.18", "0.6.18")).toBeNull();
  });

  test("returns null for empty/invalid input", () => {
    expect(extractReleaseNotesRangeFromFile("", "0.6.18", null)).toBeNull();
    expect(extractReleaseNotesRangeFromFile(SAMPLE_NOTES, "not-semver", null)).toBeNull();
  });

  test("orders newest first", () => {
    const result = extractReleaseNotesRangeFromFile(SAMPLE_NOTES, "0.6.18", null);
    const idx18 = result.indexOf("0.6.18");
    const idx17 = result.indexOf("0.6.17");
    const idx16 = result.indexOf("0.6.16");
    expect(idx18).toBeLessThan(idx17);
    expect(idx17).toBeLessThan(idx16);
  });
});
