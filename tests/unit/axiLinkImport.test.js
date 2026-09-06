"use strict";

const { importAxiLink, importAxiAny, _parseAxiLink, _toImportedBuild, _toImportedComp } = require("../../src/main/axiLinkImport");
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

// ── toImportedComp ───────────────────────────────────────────────────────────

// A published comp is self-contained: serializeCompForPublish embeds every build
// it references, keyed by the PUBLISHER's build id. Those ids mean nothing in
// this library, so the whole point of this function is that every reference to
// them is rewritten in step — miss one and the comp arrives with empty slots
// beside builds that imported fine.
describe("_toImportedComp", () => {
  const ids = () => { let n = 0; return () => `local-${++n}`; };

  const PUBLISHED = {
    id: "their-comp",
    name: "1200 Range Comp",
    gameMode: "wvw",
    createdAt: "2026-01-01T00:00:00.000Z",
    publishedFileId: "e4369a53",
    publishedKey: "secret",
    publishedOwner: "someone",
    boonCoverageHtml: "<div>their render</div>",
    folderId: "not-my-folder",
    partyLines: [
      { id: "line-1", capacity: 5, slots: ["b-chrono", "tag:cat-1", "b-evoker", null, ""] },
    ],
    buildColors: { "b-chrono": "red", "b-evoker": "blue" },
    categories: [{ id: "cat-1", name: "Support", buildIds: ["b-chrono"] }],
    builds: {
      "b-chrono": { id: "b-chrono", profession: "Mesmer", title: "U Chrono", gameMode: "wvw" },
      "b-evoker": { id: "b-evoker", profession: "Elementalist", title: "P Evoker", gameMode: "wvw" },
    },
  };

  test("rewrites every reference to a build in step with the build's new id", () => {
    const { comp, builds } = _toImportedComp(PUBLISHED, {}, ids());
    const [chrono, evoker] = builds.map((b) => b.id);
    expect(comp.buildIds).toEqual([chrono, evoker]);
    // Dense, with no holes: `slots` lists what is FILLED and the comp editor
    // pads the rest of the row with empty boxes. A null left in place is a shape
    // the renderer does not handle -- see the "empties rather than dangles" test.
    expect(comp.partyLines[0].slots).toEqual([chrono, "tag:cat-1", evoker]);
    expect(comp.buildColors).toEqual({ [chrono]: "red", [evoker]: "blue" });
    expect(comp.categories[0].buildIds).toEqual([chrono]);
    // Nothing anywhere still points at the publisher's ids.
    expect(JSON.stringify(comp)).not.toMatch(/b-chrono|b-evoker/);
  });

  test("wires each build back to the comp so it shows as a member", () => {
    const { comp, builds } = _toImportedComp(PUBLISHED, {}, ids());
    for (const build of builds) expect(build.compIds).toEqual([comp.id]);
  });

  test("a slot pointing at a build the payload didn't carry empties rather than dangles", () => {
    // Publishing skips a build that fails to enrich, so its slot arrives with an
    // id nothing will ever resolve. An empty slot is honest; a dangling one is not.
    //
    // "Empty" means ABSENT, not null. `slots` is dense everywhere else in the
    // app -- the editor splices on removal and renders empty boxes past
    // slots.length -- and renderPartyLine used to read `.length` straight off
    // the entry, so a null here took the entire comps page down with an
    // unhandled TypeError the moment the imported comp was opened.
    const payload = { ...PUBLISHED, partyLines: [{ id: "l", capacity: 5, slots: ["b-chrono", "b-missing"] }] };
    const { comp, builds } = _toImportedComp(payload, {}, ids());
    expect(comp.partyLines[0].slots).toEqual([builds[0].id]);
    expect(comp.partyLines[0].slots).not.toContain(null);
  });

  test("strips the original's identity so this copy is not a second publisher", () => {
    const { comp, builds } = _toImportedComp(PUBLISHED, {}, ids());
    for (const gone of [
      "publishedFileId", "publishedKey", "publishedOwner", "publishedAt", "publishedSlug",
      "createdAt", "updatedAt", "sortOrder", "builds", "deletedAt", "trashRoot",
    ]) {
      expect(comp).not.toHaveProperty(gone);
    }
    expect(comp.id).not.toBe("their-comp");
    // A rendered snapshot of THEIR comp; this copy regenerates its own.
    expect(comp).not.toHaveProperty("boonCoverageHtml");
    for (const build of builds) expect(build).not.toHaveProperty("publishedFileId");
  });

  test("keeps the notes and their pasted screenshots", () => {
    const payload = {
      ...PUBLISHED,
      notes: "Bring :Firebrand: to mid\n\n![image](~img:1)",
      images: { 1: "data:image/jpeg;base64,AAAA" },
    };
    const { comp } = _toImportedComp(payload, {}, ids());
    expect(comp.notes).toBe("Bring :Firebrand: to mid\n\n![image](~img:1)");
    expect(comp.images).toEqual({ 1: "data:image/jpeg;base64,AAAA" });
  });

  test("drops the baked class icons — this copy resolves its own", () => {
    // notesClassIcons is a publish-time artifact like boonCoverageHtml: the app
    // renders :Firebrand: from its own icon package, so carrying the publisher's
    // SVGs around would just bloat every imported comp.
    const payload = { ...PUBLISHED, notes: ":Firebrand:", notesClassIcons: { Firebrand: "<svg/>" } };
    const { comp } = _toImportedComp(payload, {}, ids());
    expect(comp).not.toHaveProperty("notesClassIcons");
  });

  test("keeps the published name and game mode unless the user supplied one", () => {
    expect(_toImportedComp(PUBLISHED, {}, ids()).comp.name).toBe("1200 Range Comp");
    expect(_toImportedComp(PUBLISHED, { name: "Mine" }, ids()).comp.name).toBe("Mine");
    // A WvW comp imported while the editor sits on PvE is still a WvW comp.
    expect(_toImportedComp(PUBLISHED, { gameMode: "pve" }, ids()).comp.gameMode).toBe("wvw");
  });

  test("the comp's game mode carries to builds that don't state their own", () => {
    const payload = { ...PUBLISHED, builds: { "b-x": { profession: "Mesmer", title: "X" } } };
    expect(_toImportedComp(payload, {}, ids()).builds[0].gameMode).toBe("wvw");
  });

  test("refuses a payload that decrypted to something that isn't a comp", () => {
    expect(() => _toImportedComp({ hello: "world" })).toThrow(/no comp inside/i);
  });
});

// ── importAxiAny (comp links) ────────────────────────────────────────────────

describe("importAxiAny with a comp link", () => {
  const key = generateEncryptionKey();
  const COMP_LINK = `https://someone.github.io/axibuilds/?n=1200-range&c=e4369a53.${key}`;
  const published = {
    name: "1200 Range Comp",
    gameMode: "wvw",
    partyLines: [{ id: "l", capacity: 5, slots: ["b-chrono"] }],
    builds: { "b-chrono": { id: "b-chrono", profession: "Mesmer", title: "U Chrono" } },
  };

  function serve(routes) {
    return jest.fn(async (url) => routes[url] || { status: 404, body: "" });
  }

  test("reads the comp out of comps/, not builds/, and brings its builds with it", async () => {
    const fetchText = serve({
      "https://raw.githubusercontent.com/someone/axibuilds/main/site/comps/e4369a53.enc": {
        status: 200,
        body: encryptBuild(published, key),
      },
    });
    const result = await importAxiAny(COMP_LINK, {}, { fetchText });
    expect(result.kind).toBe("comp");
    expect(result.comp.name).toBe("1200 Range Comp");
    expect(result.builds).toHaveLength(1);
    expect(result.builds[0].title).toBe("U Chrono");
    // One fetch: a published comp carries its builds, so there is nothing to chase.
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  test("says the comp is gone rather than the build", async () => {
    await expect(importAxiAny(COMP_LINK, {}, { fetchText: serve({}) }))
      .rejects.toThrow(/that comp isn't published anymore/i);
  });

  test("a /r/ short link that redirects to a comp imports as a comp", async () => {
    const fetchText = serve({
      "https://someone.github.io/axibuilds/r/e4369a53/": {
        status: 200,
        body: `<!DOCTYPE html><meta http-equiv=refresh content="0;url=../../?c=e4369a53.${key}">`,
      },
      "https://raw.githubusercontent.com/someone/axibuilds/main/site/comps/e4369a53.enc": {
        status: 200,
        body: encryptBuild(published, key),
      },
    });
    const result = await importAxiAny("https://someone.github.io/axibuilds/r/e4369a53/", {}, { fetchText });
    expect(result.kind).toBe("comp");
  });

  test("a build link still comes back as a build", async () => {
    const fetchText = serve({
      "https://raw.githubusercontent.com/someone/axibuilds/main/site/builds/f4c38d4f.enc": {
        status: 200,
        body: encryptBuild({ profession: "Mesmer", title: "U Chrono" }, key),
      },
    });
    const result = await importAxiAny(LINK.replace("KEY", key), {}, { fetchText });
    expect(result).toMatchObject({ kind: "build", build: { title: "U Chrono" } });
  });
});
