"use strict";

const web = require("node:stream/web");
globalThis.DecompressionStream ??= web.DecompressionStream;
globalThis.crypto ??= require("node:crypto").webcrypto;

const { encryptPayload, generateEncryptionKey } = require("../../../src/main/buildEncryption");
const { memberDataBase, memberSpaUrl, loadCompMembers } = require("../../../src/site/comp-members.js");

const loc = { origin: "https://me.github.io", pathname: "/axibuilds/" };
const okBytes = (data, key) => {
  const b = encryptPayload(data, key);
  return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

describe("comp members", () => {
  test("a member is read from its owner's repo; an ownerless one from this page's base", () => {
    expect(memberDataBase({ owner: "mate" }, "https://raw.githubusercontent.com/me/axibuilds/main/site/"))
      .toBe("https://raw.githubusercontent.com/mate/axibuilds/main/site/");
    expect(memberDataBase({ owner: "" }, "BASE/")).toBe("BASE/");
  });

  test("spaUrl points at the owner's page with the member's file and key", () => {
    expect(memberSpaUrl({ owner: "mate", fileId: "ab12cd34", key: "KEY" }, { title: "Heal Firebrand!" }, loc))
      .toBe("https://mate.github.io/axibuilds/?n=heal-firebrand&b=ab12cd34.KEY");
    expect(memberSpaUrl({ owner: "", fileId: "ab12cd34", key: "KEY" }, { title: "" }, loc))
      .toBe("https://me.github.io/axibuilds/?n=build&b=ab12cd34.KEY");
  });

  test("loads members in parallel; a 404, a bad key, or a v1 member are each handled", async () => {
    const kA = generateEncryptionKey();
    const kB = generateEncryptionKey();
    const comp = { members: {
      a: { fileId: "aaaa1111", key: kA, owner: "me" },
      b: { fileId: "bbbb2222", key: kB, owner: "mate" },
    } };
    const fetchImpl = jest.fn(async (url) =>
      url.endsWith("aaaa1111.enc") ? okBytes({ id: "a", title: "FB", profession: "Guardian" }, kA) : { ok: false, status: 404 });

    const out = await loadCompMembers(comp, { fallbackBase: "BASE/", loc, fetchImpl });

    expect(out.a).toMatchObject({ id: "a", title: "FB", spaUrl: "https://me.github.io/axibuilds/?n=fb&b=aaaa1111." + kA });
    expect(out.b).toEqual({ id: "b", unavailable: true });
    expect(fetchImpl).toHaveBeenCalledWith("https://raw.githubusercontent.com/mate/axibuilds/main/site/builds/bbbb2222.enc", { cache: "no-store" });
  });
});
