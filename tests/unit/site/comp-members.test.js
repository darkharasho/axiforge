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

  test("spaUrl uses the member's published slug and theme, as v1 member links did", () => {
    expect(memberSpaUrl({ owner: "mate", fileId: "ab12cd34", key: "KEY", slug: "old-name", theme: "guardian" }, { title: "New Name" }, loc))
      .toBe("https://mate.github.io/axibuilds/?n=old-name&b=ab12cd34.KEY&t=guardian");
    // No theme recorded at publish: no &t.
    expect(memberSpaUrl({ owner: "mate", fileId: "ab12cd34", key: "KEY", slug: "x", theme: "" }, { title: "X" }, { ...loc, search: "?c=f.k&t=dark" }))
      .toBe("https://mate.github.io/axibuilds/?n=x&b=ab12cd34.KEY");
  });

  test("a member written without slug/theme falls back to the title and this page's theme", () => {
    expect(memberSpaUrl({ owner: "mate", fileId: "ab12cd34", key: "KEY" }, { title: "Heal FB" }, { ...loc, search: "?c=f.k&t=dark" }))
      .toBe("https://mate.github.io/axibuilds/?n=heal-fb&b=ab12cd34.KEY&t=dark");
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

  test("a member's data is read from the base its owner resolves to", async () => {
    const kA = generateEncryptionKey();
    const comp = { members: { a: { fileId: "aaaa1111", key: kA, owner: "mate" } } };
    const fetchImpl = jest.fn(async () => okBytes({ title: "A", profession: "Guardian" }, kA));
    const baseForOwner = jest.fn(async (owner) => `https://raw.githubusercontent.com/${owner}/axibuilds/SHA/site/`);
    await loadCompMembers(comp, { fallbackBase: "BASE/", loc, fetchImpl, baseForOwner });
    expect(baseForOwner).toHaveBeenCalledWith("mate");
    expect(fetchImpl.mock.calls[0][0]).toBe("https://raw.githubusercontent.com/mate/axibuilds/SHA/site/builds/aaaa1111.enc");
  });

  // The member moved to its team's account after this comp was published: its
  // old host left a pointer, and the same file id and key work at the new one.
  test("a member that moved is read from its new host, and links there", async () => {
    const k = generateEncryptionKey();
    const comp = { members: { a: { fileId: "aaaa1111", key: k, owner: "mate", slug: "fb" } } };
    const fetchImpl = jest.fn(async (url) => {
      if (url === "https://raw.githubusercontent.com/mate/axibuilds/main/site/moved/aaaa1111.json") return { ok: true, json: async () => ({ owner: "guild" }) };
      if (url === "https://raw.githubusercontent.com/guild/axibuilds/main/site/builds/aaaa1111.enc") return okBytes({ title: "FB", profession: "Guardian" }, k);
      return { ok: false, status: 404 };
    });
    const out = await loadCompMembers(comp, { fallbackBase: "BASE/", loc, fetchImpl });
    expect(out.a).toMatchObject({ title: "FB", spaUrl: `https://guild.github.io/axibuilds/?n=fb&b=aaaa1111.${k}` });
  });
});
