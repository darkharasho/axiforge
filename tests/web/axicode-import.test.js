const { encodeAxicodeFile } = require("@axiapps/code");
const { decodeAxicodeBuffer, createAxicodeApi } = require("../../src/web/webApi/axicode.js");

describe("decodeAxicodeBuffer", () => {
  it("returns the builds from a valid .axicode buffer", () => {
    const builds = [
      { id: "a", title: "Alpha", profession: "Guardian" },
      { id: "b", title: "Bravo", profession: "Warrior" },
    ];
    const buffer = encodeAxicodeFile({ builds, folders: [], comps: [] });
    const out = decodeAxicodeBuffer(buffer);
    expect(out.builds.map((b) => b.title)).toEqual(["Alpha", "Bravo"]);
  });

  it("throws a clear error on a non-axicode buffer", () => {
    expect(() => decodeAxicodeBuffer(Buffer.from("not gzip"))).toThrow(/axicode/i);
  });
});

describe("createAxicodeApi", () => {
  it("returns cancelled when the picker resolves with no file", async () => {
    const api = createAxicodeApi({ pick: async () => null });
    const out = await api.importAxicodeFile();
    expect(out).toEqual({ cancelled: true });
  });

  it("returns builds when the picker resolves with a valid file", async () => {
    const builds = [{ id: "a", title: "Alpha" }];
    const buffer = encodeAxicodeFile({ builds, folders: [], comps: [] });
    const fakeFile = { arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
    const api = createAxicodeApi({ pick: async () => fakeFile });
    const out = await api.importAxicodeFile();
    expect(out.builds.map((b) => b.title)).toEqual(["Alpha"]);
  });

  it("returns an error when the picked file fails to decode", async () => {
    const fakeFile = { arrayBuffer: async () => Buffer.from("not gzip").buffer };
    const api = createAxicodeApi({ pick: async () => fakeFile });
    const out = await api.importAxicodeFile();
    expect(out.error).toMatch(/axicode/i);
  });
});
