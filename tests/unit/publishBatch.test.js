"use strict";

const { createPublishBatch, publishedPageUrl, displayTitle } = require("../../src/main/publishBatch");
const { resolvePublishTarget } = require("../../src/main/publishTarget");
const { buildFingerprint } = require("../../src/main/publishFingerprint");
const { generateEncryptionKey } = require("../../src/main/buildEncryption");

const SHA = "a".repeat(40);
const AUTH = { token: "tok", viewer: { login: "me" }, onboarding: { targetOwner: "me", targetOwnerType: "user", branch: "main", repoReady: true } };
const TEAM_ROOT = { id: "team", teamId: "T1", shared: true, publishOwner: "guild", publishOwnerType: "org" };

function setup({ builds = [], comps = [], auth = AUTH, choice = {}, upload = {}, live = true, publishImpl = null } = {}) {
  const calls = { bundles: [], polls: [], marks: [], onboarding: [] };
  let n = 0;
  const deps = {
    getSession: jest.fn(async () => ({ token: "tok", viewer: { login: "me" } })),
    getAuthRecord: async () => auth,
    patchAuthRecord: async (p) => { calls.onboarding.push(p); },
    findTeamRoot: async (folderId) => (folderId === "team" ? TEAM_ROOT : null),
    resolvePublishTarget,
    listBuilds: async () => builds,
    listComps: async () => comps,
    markBuildPublished: async (id, patch) => { calls.marks.push({ kind: "build", id, patch }); return { ...builds.find((b) => b.id === id), ...patch }; },
    markCompPublished: async (id, patch) => { calls.marks.push({ kind: "comp", id, patch }); return { ...comps.find((c) => c.id === id), ...patch }; },
    getSetting: async () => null,
    enrichBuildForPublish: jest.fn(async (b) => ({ title: b.title, profession: b.profession })),
    buildSpaBundle: jest.fn(() => ({ "site/index.html": "<!doctype html>" })),
    addFormatMigrations: jest.fn(async () => ({ builds: [], comps: [] })),
    stampFormatMigrations: jest.fn(async () => {}),
    ensurePublishInfra: jest.fn(async () => {}),
    invalidatePublishInfra: jest.fn(),
    publishSiteBundle: jest.fn(publishImpl || (async (token, owner, bundle) => {
      calls.bundles.push({ owner, bundle });
      return { commitSha: SHA, changed: true, shellChanged: false, ...upload };
    })),
    triggerPagesWorkflow: jest.fn(async () => {}),
    pollUrlLive: jest.fn(async (url, opts) => { calls.polls.push({ url, opts }); return live; }),
    teamPut: jest.fn(async () => {}),
    choiceOf: (kind, id) => choice[`${kind}:${id}`] || null,
    newFileId: () => `new${++n}`,
    newKey: generateEncryptionKey,
  };
  return { publishBatch: createPublishBatch(deps), deps, calls };
}

const b = (over) => ({ title: "Heal FB", profession: "Guardian", folderId: null, updatedAt: "t1", ...over });
const pub = (over) => b({ publishedFileId: `f-${over.id}`, publishedKey: generateEncryptionKey(), publishedSlug: "heal-fb", publishedOwner: "me", ...over });
const encFiles = (bundle) => Object.keys(bundle).filter((p) => /^site\/builds\/.+\.enc$/.test(p));

describe("grouping", () => {
  test("one commit per owner", async () => {
    const { publishBatch, calls } = setup({ builds: [b({ id: "a" }), b({ id: "t", folderId: "team" })] });
    const { results } = await publishBatch([{ kind: "build", id: "a" }, { kind: "build", id: "t" }]);
    expect(calls.bundles.map((x) => x.owner).sort()).toEqual(["guild", "me"]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  test("several items for one owner share one commit", async () => {
    const { publishBatch, calls } = setup({ builds: [b({ id: "a" }), b({ id: "c" })] });
    await publishBatch([{ kind: "build", id: "a" }, { kind: "build", id: "c" }]);
    expect(calls.bundles).toHaveLength(1);
    expect(encFiles(calls.bundles[0].bundle)).toHaveLength(2);
  });

  test("no session is a round-level PUBLISH_DISCONNECTED", async () => {
    const { publishBatch, deps } = setup({ builds: [b({ id: "a" })] });
    deps.getSession.mockResolvedValue(null);
    await expect(publishBatch([{ kind: "build", id: "a" }])).rejects.toMatchObject({ code: "PUBLISH_DISCONNECTED" });
  });

  test("a personal target that was never set up reports PUBLISH_DISCONNECTED", async () => {
    const auth = { ...AUTH, onboarding: { targetOwner: "me", branch: "main" } };
    const { publishBatch, calls } = setup({ auth, builds: [b({ id: "a" }), b({ id: "t", folderId: "team" })] });
    const { results } = await publishBatch([{ kind: "build", id: "a" }, { kind: "build", id: "t" }]);
    expect(results.find((r) => r.id === "a").error).toMatchObject({ code: "PUBLISH_DISCONNECTED" });
    expect(results.find((r) => r.id === "t").ok).toBe(true);
    expect(calls.bundles.map((x) => x.owner)).toEqual(["guild"]);
  });
});

describe("ownership", () => {
  test("a build published by someone else needs a choice", async () => {
    const { publishBatch, calls } = setup({ builds: [pub({ id: "x", publishedOwner: "mate" })] });
    const { results } = await publishBatch([{ kind: "build", id: "x" }]);
    expect(results[0].ok).toBe(false);
    expect(results[0].error.message).toBe("PUBLISHED_BY_OTHER:mate");
    expect(calls.bundles).toHaveLength(0);
  });

  test("\"mine\" republishes it under this owner", async () => {
    const { publishBatch, calls } = setup({ builds: [pub({ id: "x", publishedOwner: "mate" })], choice: { "build:x": "mine" } });
    const { results } = await publishBatch([{ kind: "build", id: "x" }]);
    expect(results[0].ok).toBe(true);
    expect(calls.marks[0].patch.publishedOwner).toBe("me");
  });
});

describe("preparing", () => {
  test("an item that fails to prepare fails alone", async () => {
    const { publishBatch, calls } = setup({ builds: [b({ id: "bad", profession: "" }), b({ id: "good" })] });
    const { results } = await publishBatch([{ kind: "build", id: "bad" }, { kind: "build", id: "good" }]);
    expect(results.find((r) => r.id === "bad")).toMatchObject({ ok: false });
    expect(results.find((r) => r.id === "bad").error.message).toMatch(/profession/);
    expect(results.find((r) => r.id === "good").ok).toBe(true);
    expect(calls.bundles).toHaveLength(1);
  });

  test("a record that no longer exists is dropped, not failed", async () => {
    const { publishBatch, calls } = setup({ builds: [b({ id: "trashed", deletedAt: "2026-10-07T00:00:00.000Z" })] });
    const { results } = await publishBatch([{ kind: "build", id: "gone" }, { kind: "build", id: "trashed" }]);
    expect(results).toEqual([
      { kind: "build", id: "gone", ok: true, skipped: "gone" },
      { kind: "build", id: "trashed", ok: true, skipped: "gone" },
    ]);
    expect(calls.bundles).toHaveLength(0);
  });

  test("an untitled build publishes under its default name without renaming the record", async () => {
    const untitled = b({ id: "u", title: "", profession: "Warrior", specializations: [] });
    const { publishBatch, deps, calls } = setup({ builds: [untitled] });
    const { results } = await publishBatch([{ kind: "build", id: "u" }]);
    expect(deps.enrichBuildForPublish).toHaveBeenCalledWith(expect.objectContaining({ title: "Core Warrior" }));
    expect(results[0].slug).toBe("core-warrior");
    expect(calls.marks[0].patch.publishedHash).toBe(buildFingerprint(untitled));
    expect(deps).not.toHaveProperty("upsertBuild");
    expect(displayTitle({ title: "Untitled Build", profession: "Thief" })).toBe("Core Thief");
  });

  test("a member shared by two comps and queued itself is uploaded once", async () => {
    const member = b({ id: "m" });
    const comps = [
      { id: "c1", name: "Raid A", buildIds: ["m"], partyLines: [], updatedAt: "t1" },
      { id: "c2", name: "Raid B", buildIds: ["m"], partyLines: [], updatedAt: "t1" },
    ];
    const { publishBatch, deps, calls } = setup({ builds: [member], comps });
    const { results } = await publishBatch([{ kind: "comp", id: "c1" }, { kind: "build", id: "m" }, { kind: "comp", id: "c2" }]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(encFiles(calls.bundles[0].bundle)).toEqual(["site/builds/new1.enc"]);
    expect(deps.enrichBuildForPublish).toHaveBeenCalledTimes(1);
    expect(calls.marks.filter((m) => m.kind === "build")).toEqual([
      expect.objectContaining({ id: "m", patch: expect.objectContaining({ publishedFileId: "new1" }) }),
    ]);
  });

  test("a never-published member that is not itself queued is stamped by the comp", async () => {
    const comps = [{ id: "c1", name: "Raid", buildIds: ["m"], partyLines: [], updatedAt: "t1" }];
    const { publishBatch, calls } = setup({ builds: [b({ id: "m" })], comps });
    await publishBatch([{ kind: "comp", id: "c1" }]);
    expect(calls.marks.map((m) => `${m.kind}:${m.id}`)).toEqual(["build:m", "comp:c1"]);
  });
});

describe("upload", () => {
  test("format migrations ride along and are stamped after the upload", async () => {
    const { publishBatch, deps } = setup({ builds: [b({ id: "a" })] });
    await publishBatch([{ kind: "build", id: "a" }]);
    expect(deps.addFormatMigrations).toHaveBeenCalledWith(expect.any(Object), "me", ["a"]);
    expect(deps.stampFormatMigrations).toHaveBeenCalledTimes(1);
  });

  test("receipts carry the hash of the snapshot that was uploaded", async () => {
    const builds = [b({ id: "a" })];
    const original = builds[0];
    const { publishBatch, calls } = setup({
      builds,
      publishImpl: async (token, owner, bundle) => {
        builds[0] = { ...builds[0], notes: "edited mid-upload" };
        calls.bundles.push({ owner, bundle });
        return { commitSha: SHA, changed: true, shellChanged: false };
      },
    });
    await publishBatch([{ kind: "build", id: "a" }]);
    expect(calls.marks[0].patch.publishedHash).toBe(buildFingerprint(original));
    expect(calls.marks[0].patch.publishedHash).not.toBe(buildFingerprint(builds[0]));
  });

  test("a 404 clears the infra cache and retries once", async () => {
    let attempts = 0;
    const { publishBatch, deps } = setup({
      builds: [b({ id: "a" })],
      publishImpl: async () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("Not Found"), { status: 404 });
        return { commitSha: SHA, changed: true, shellChanged: false };
      },
    });
    const { results } = await publishBatch([{ kind: "build", id: "a" }]);
    expect(results[0].ok).toBe(true);
    expect(deps.invalidatePublishInfra).toHaveBeenCalledWith("me", "main");
    expect(deps.ensurePublishInfra).toHaveBeenCalledTimes(2);
  });

  test("a second 404 fails the owner's items", async () => {
    const { publishBatch } = setup({
      builds: [b({ id: "a" })],
      publishImpl: async () => { throw Object.assign(new Error("Not Found"), { status: 404 }); },
    });
    const { results } = await publishBatch([{ kind: "build", id: "a" }]);
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[0].error.status).toBe(404);
  });
});

describe("live check", () => {
  test("polls the data file pinned to the new commit", async () => {
    const { publishBatch, calls } = setup({ builds: [pub({ id: "a" })] });
    await publishBatch([{ kind: "build", id: "a" }]);
    expect(calls.polls).toEqual([{ url: `https://raw.githubusercontent.com/me/axibuilds/${SHA}/site/builds/f-a.enc`, opts: undefined }]);
  });

  test("a first publish also waits for its /r/ page", async () => {
    const { publishBatch, calls } = setup({ builds: [b({ id: "a" })] });
    await publishBatch([{ kind: "build", id: "a" }]);
    expect(calls.polls[1]).toEqual({ url: "https://me.github.io/axibuilds/r/new1/", opts: { timeoutMs: 180000 } });
  });

  test("a viewer change waits for the site and triggers Pages", async () => {
    const { publishBatch, deps, calls } = setup({ builds: [pub({ id: "a" })], upload: { shellChanged: true } });
    await publishBatch([{ kind: "build", id: "a" }]);
    expect(deps.triggerPagesWorkflow).toHaveBeenCalledWith("tok", "me", "main", "axibuilds");
    expect(calls.polls[1]).toEqual({ url: "https://me.github.io/axibuilds/", opts: { timeoutMs: 180000 } });
  });

  test("a link that never goes live leaves items unstamped with PUBLISH_NOT_LIVE", async () => {
    const { publishBatch, calls } = setup({ builds: [pub({ id: "a" })], live: false });
    const { results } = await publishBatch([{ kind: "build", id: "a" }]);
    expect(results[0].error).toMatchObject({ code: "PUBLISH_NOT_LIVE" });
    expect(calls.marks).toHaveLength(0);
  });
});

describe("results and side effects", () => {
  test("results carry the old publish handlers' response shape", async () => {
    const comps = [{ id: "c1", name: "Raid Night", buildIds: [], partyLines: [], updatedAt: "t1" }];
    const { publishBatch } = setup({ builds: [b({ id: "a" })], comps });
    const { results } = await publishBatch([{ kind: "build", id: "a" }, { kind: "comp", id: "c1" }]);
    const build = results.find((r) => r.kind === "build");
    expect(build).toMatchObject({ ok: true, slug: "heal-fb", fileId: "new1", changed: true });
    expect(build.pagesUrl).toMatch(/^https:\/\/me\.github\.io\/axibuilds\/\?n=heal-fb&b=new1\./);
    const comp = results.find((r) => r.kind === "comp");
    expect(comp).toMatchObject({ ok: true, slug: "raid-night", skippedForeignBuilds: [] });
    expect(comp.pagesUrl).toMatch(/&c=new2\./);
  });

  test("team items are pushed to their team; only a personal publish touches onboarding", async () => {
    const { publishBatch, deps, calls } = setup({ builds: [b({ id: "t", folderId: "team" })] });
    await publishBatch([{ kind: "build", id: "t" }]);
    expect(deps.teamPut).toHaveBeenCalledWith("T1", "t", "build");
    expect(calls.onboarding).toHaveLength(0);

    const personal = setup({ builds: [b({ id: "a" })] });
    await personal.publishBatch([{ kind: "build", id: "a" }]);
    expect(personal.calls.onboarding[0].onboarding).toMatchObject({ targetOwner: "me", repoReady: true, repoName: "axibuilds" });
  });
});

test("publishedPageUrl", () => {
  expect(publishedPageUrl({ kind: "build", owner: "me", slug: "a b", fileId: "f", key: "k", theme: "" }))
    .toBe("https://me.github.io/axibuilds/?n=a%20b&b=f.k");
  expect(publishedPageUrl({ kind: "comp", owner: "me", slug: "r", fileId: "f", key: "k", theme: "dark" }))
    .toBe("https://me.github.io/axibuilds/?n=r&c=f.k&t=dark");
});
