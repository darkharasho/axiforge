"use strict";

const { importAxiLink, _parseAxiLink, _toImportedBuild } = require("../../src/main/axiLinkImport");
const { encryptBuild, generateEncryptionKey } = require("../../src/main/buildEncryption");

const LINK = "https://someone.github.io/axibuilds/?n=u-chrono&b=f4c38d4f.KEY&t=prof-mesmer";

// ── parseAxiLink ─────────────────────────────────────────────────────────────

describe("_parseAxiLink", () => {
  test("reads the current ?b=<id>.<key> form", () => {
    const parsed = _parseAxiLink(LINK.replace("KEY", "abc123"));
    expect(parsed).toMatchObject({ kind: "build", fileId: "f4c38d4f", key: "abc123", name: "u-chrono" });
  });

  test("reads the legacy redirect and bare-hash forms the SPA still accepts", () => {
    expect(_parseAxiLink("https://x.github.io/axibuilds/?legacy=aa.bb")).toMatchObject({ fileId: "aa", key: "bb" });
    expect(_parseAxiLink("https://x.github.io/axibuilds/#aa.bb")).toMatchObject({ fileId: "aa", key: "bb" });
  });

  test("flags a comp link so the caller can say so instead of 404ing", () => {
    expect(_parseAxiLink("https://x.github.io/axibuilds/?c=aa.bb").kind).toBe("comp");
  });

  test("defers a /r/ short link, which carries no key", () => {
    const parsed = _parseAxiLink("https://x.github.io/axibuilds/r/f4c38d4f/");
    expect(parsed).toMatchObject({ shortId: "f4c38d4f", key: null });
  });

  test("tries raw.githubusercontent first, then the page's own directory", () => {
    // The SPA reads from raw so a fresh publish is live within seconds; Pages
    // serves the same files once it catches up.
    expect(_parseAxiLink(LINK).bases).toEqual([
      "https://raw.githubusercontent.com/someone/axibuilds/main/site/",
      "https://someone.github.io/axibuilds/",
    ]);
  });

  test("falls back to the page directory for a site that isn't on github.io", () => {
    expect(_parseAxiLink("https://builds.example.com/?b=aa.bb").bases).toEqual(["https://builds.example.com/"]);
  });

  test("rejects a link with no build in it", () => {
    expect(() => _parseAxiLink("https://x.github.io/axibuilds/")).toThrow(/no build/i);
    expect(() => _parseAxiLink("")).toThrow(/paste/i);
  });
});

// ── toImportedBuild ──────────────────────────────────────────────────────────

describe("_toImportedBuild", () => {
  test("strips the original's identity so the copy is not a second publisher", () => {
    // Publishing again from this copy must mint a new file, not overwrite the
    // build it was imported from.
    const build = _toImportedBuild({
      profession: "Mesmer",
      title: "U Chrono",
      id: "original-id",
      publishedFileId: "f4c38d4f",
      publishedKey: "secret",
      publishedAt: "2026-01-01T00:00:00.000Z",
      publishedOwner: "someone",
      publishedSlug: "u-chrono",
      folderId: "not-my-folder",
      compIds: ["not-my-comp"],
      deletedAt: "2026-01-01T00:00:00.000Z",
      trashRoot: true,
    });
    for (const gone of [
      "id", "publishedFileId", "publishedKey", "publishedAt", "publishedOwner",
      "publishedSlug", "compIds", "deletedAt", "trashRoot",
    ]) {
      expect(build).not.toHaveProperty(gone);
    }
    expect(build.folderId).toBeNull();
  });

  test("keeps the published name unless the user supplied one", () => {
    expect(_toImportedBuild({ profession: "Mesmer", title: "U Chrono" }).title).toBe("U Chrono");
    expect(_toImportedBuild({ profession: "Mesmer", title: "U Chrono" }, { name: "Mine" }).title).toBe("Mine");
  });

  test("keeps the build's own game mode over the editor's current one", () => {
    // A WvW build imported while the editor sits on PvE is still a WvW build.
    expect(_toImportedBuild({ profession: "Mesmer", gameMode: "wvw" }, { gameMode: "pve" }).gameMode).toBe("wvw");
  });

  test("refuses a payload that decrypted to something that isn't a build", () => {
    expect(() => _toImportedBuild({ hello: "world" })).toThrow(/no build inside/i);
  });
});

// ── importAxiLink ────────────────────────────────────────────────────────────

describe("importAxiLink", () => {
  const key = generateEncryptionKey();
  const published = {
    profession: "Mesmer",
    title: "U Chrono",
    gameMode: "wvw",
    // Display-only enrichment serializeForPublish adds. It rides along here and
    // is dropped by buildStore's allowlist, not by this module.
    computedStats: { Power: 3000 },
  };

  function serve(routes) {
    return jest.fn(async (url) => routes[url] || { status: 404, body: "" });
  }

  test("fetches, decrypts, and returns a normalize-ready build", async () => {
    const fetchText = serve({
      "https://raw.githubusercontent.com/someone/axibuilds/main/site/builds/f4c38d4f.enc": {
        status: 200,
        body: encryptBuild(published, key),
      },
    });
    const build = await importAxiLink(LINK.replace("KEY", key), {}, { fetchText });
    expect(build).toMatchObject({ profession: "Mesmer", title: "U Chrono", gameMode: "wvw" });
  });

  test("falls back to the Pages copy when raw hasn't got the file", async () => {
    // raw only reflects the publish branch; a site published elsewhere (or a
    // repo whose default branch differs) is still reachable through Pages.
    const fetchText = serve({
      "https://someone.github.io/axibuilds/builds/f4c38d4f.enc": { status: 200, body: encryptBuild(published, key) },
    });
    const build = await importAxiLink(LINK.replace("KEY", key), {}, { fetchText });
    expect(build.title).toBe("U Chrono");
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  test("says the build is gone when no base has it", async () => {
    await expect(importAxiLink(LINK.replace("KEY", key), {}, { fetchText: serve({}) }))
      .rejects.toThrow(/isn't published anymore/i);
  });

  test("stops on a bad key instead of retrying every base", async () => {
    // Reaching the file and failing to open it means the link is wrong; the next
    // base holds the same bytes, so trying it again only wastes a request.
    const fetchText = serve({
      "https://raw.githubusercontent.com/someone/axibuilds/main/site/builds/f4c38d4f.enc": {
        status: 200,
        body: encryptBuild(published, generateEncryptionKey()),
      },
    });
    await expect(importAxiLink(LINK.replace("KEY", key), {}, { fetchText })).rejects.toThrow(/couldn't decrypt/i);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  test("resolves a /r/ short link through its redirect page", async () => {
    const fetchText = serve({
      "https://someone.github.io/axibuilds/r/f4c38d4f/": {
        status: 200,
        body: `<!DOCTYPE html><meta http-equiv=refresh content="0;url=../../?b=f4c38d4f.${key}">`,
      },
      "https://raw.githubusercontent.com/someone/axibuilds/main/site/builds/f4c38d4f.enc": {
        status: 200,
        body: encryptBuild(published, key),
      },
    });
    const build = await importAxiLink("https://someone.github.io/axibuilds/r/f4c38d4f/", {}, { fetchText });
    expect(build.title).toBe("U Chrono");
  });

  test("tells the user a comp link is a comp link", async () => {
    await expect(importAxiLink("https://x.github.io/axibuilds/?c=aa.bb", {}, { fetchText: serve({}) }))
      .rejects.toThrow(/link to a comp/i);
  });

  test("puts the import in the folder it was started from", async () => {
    const fetchText = serve({
      "https://raw.githubusercontent.com/someone/axibuilds/main/site/builds/f4c38d4f.enc": {
        status: 200,
        body: encryptBuild(published, key),
      },
    });
    const build = await importAxiLink(LINK.replace("KEY", key), { folderId: "f1" }, { fetchText });
    expect(build.folderId).toBe("f1");
  });
});
