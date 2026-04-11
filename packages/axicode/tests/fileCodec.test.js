const { encodeAxicodeFile, decodeAxicodeFile, isValidAxicodeFile } = require("../src/index");
const zlib = require("zlib");

describe("encodeAxicodeFile", () => {
  test("returns a Buffer", () => {
    const result = encodeAxicodeFile({ builds: [], folders: [], comps: [] });
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test("output is valid gzip", () => {
    const result = encodeAxicodeFile({ builds: [], folders: [], comps: [] });
    const json = JSON.parse(zlib.gunzipSync(result).toString("utf-8"));
    expect(json.version).toBe(1);
    expect(json.builds).toEqual([]);
    expect(json.folders).toEqual([]);
    expect(json.comps).toEqual([]);
    expect(typeof json.exportedAt).toBe("string");
  });

  test("includes provided builds, folders, comps", () => {
    const builds = [{ id: "b1", title: "Test Build" }];
    const folders = [{ id: "f1", name: "My Folder" }];
    const comps = [{ id: "c1", name: "My Comp" }];
    const result = encodeAxicodeFile({ builds, folders, comps });
    const json = JSON.parse(zlib.gunzipSync(result).toString("utf-8"));
    expect(json.builds).toEqual(builds);
    expect(json.folders).toEqual(folders);
    expect(json.comps).toEqual(comps);
  });
});

describe("decodeAxicodeFile", () => {
  test("round-trips encode → decode", () => {
    const input = {
      builds: [{ id: "b1", title: "Test" }],
      folders: [{ id: "f1", name: "Folder" }],
      comps: [{ id: "c1", name: "Comp" }],
    };
    const encoded = encodeAxicodeFile(input);
    const decoded = decodeAxicodeFile(encoded);
    expect(decoded.version).toBe(1);
    expect(decoded.builds).toEqual(input.builds);
    expect(decoded.folders).toEqual(input.folders);
    expect(decoded.comps).toEqual(input.comps);
    expect(typeof decoded.exportedAt).toBe("string");
  });

  test("throws on non-gzip data", () => {
    expect(() => decodeAxicodeFile(Buffer.from("not gzip"))).toThrow();
  });

  test("throws on invalid JSON inside gzip", () => {
    const badGzip = zlib.gzipSync(Buffer.from("not json", "utf-8"));
    expect(() => decodeAxicodeFile(badGzip)).toThrow();
  });

  test("throws on unknown version", () => {
    const payload = JSON.stringify({ version: 999, builds: [], folders: [], comps: [] });
    const gzipped = zlib.gzipSync(Buffer.from(payload, "utf-8"));
    expect(() => decodeAxicodeFile(gzipped)).toThrow(/newer version/i);
  });

  test("throws on missing version field", () => {
    const payload = JSON.stringify({ builds: [] });
    const gzipped = zlib.gzipSync(Buffer.from(payload, "utf-8"));
    expect(() => decodeAxicodeFile(gzipped)).toThrow();
  });
});

describe("isValidAxicodeFile", () => {
  test("returns true for valid encoded file", () => {
    const encoded = encodeAxicodeFile({ builds: [], folders: [], comps: [] });
    expect(isValidAxicodeFile(encoded)).toBe(true);
  });

  test("returns false for non-buffer", () => {
    expect(isValidAxicodeFile("string")).toBe(false);
  });

  test("returns false for non-gzip buffer", () => {
    expect(isValidAxicodeFile(Buffer.from("hello"))).toBe(false);
  });

  test("returns false for gzip with bad JSON", () => {
    expect(isValidAxicodeFile(zlib.gzipSync(Buffer.from("nope")))).toBe(false);
  });

  test("returns false for gzip with wrong version", () => {
    const bad = zlib.gzipSync(Buffer.from(JSON.stringify({ version: 99 })));
    expect(isValidAxicodeFile(bad)).toBe(false);
  });
});
