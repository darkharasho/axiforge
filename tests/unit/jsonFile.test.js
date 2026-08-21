"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { readJsonFile, writeJsonAtomic, snapshotDaily } = require("../../src/main/jsonFile");
const { BuildStore } = require("../../src/main/buildStore");

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-jsonfile-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("readJsonFile", () => {
  test("returns fallback when file is missing", async () => {
    expect(await readJsonFile(path.join(dir, "nope.json"), [])).toEqual([]);
  });

  test("returns fallback when file is empty", async () => {
    const p = path.join(dir, "empty.json");
    await fs.writeFile(p, "");
    expect(await readJsonFile(p, { a: 1 })).toEqual({ a: 1 });
  });

  test("recovers from .bak when the primary is corrupt and quarantines the primary", async () => {
    const p = path.join(dir, "data.json");
    await fs.writeFile(p, "{not json");
    await fs.writeFile(`${p}.bak`, JSON.stringify([{ id: "kept" }]));
    expect(await readJsonFile(p, [])).toEqual([{ id: "kept" }]);
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.startsWith("data.json.corrupt-"))).toBe(true);
  });

  test("quarantines a corrupt file with no .bak and returns fallback", async () => {
    const p = path.join(dir, "data.json");
    await fs.writeFile(p, "garbage");
    expect(await readJsonFile(p, [])).toEqual([]);
    const files = await fs.readdir(dir);
    const quarantined = files.find((f) => f.startsWith("data.json.corrupt-"));
    expect(quarantined).toBeTruthy();
    expect(await fs.readFile(path.join(dir, quarantined), "utf8")).toBe("garbage");
  });
});

describe("writeJsonAtomic", () => {
  test("writes the file and keeps the previous generation in .bak", async () => {
    const p = path.join(dir, "data.json");
    await writeJsonAtomic(p, { v: 1 });
    await writeJsonAtomic(p, { v: 2 });
    expect(JSON.parse(await fs.readFile(p, "utf8"))).toEqual({ v: 2 });
    expect(JSON.parse(await fs.readFile(`${p}.bak`, "utf8"))).toEqual({ v: 1 });
  });

  test("does not overwrite a good .bak with a corrupt primary", async () => {
    const p = path.join(dir, "data.json");
    await writeJsonAtomic(p, { v: 1 });
    await writeJsonAtomic(p, { v: 2 }); // .bak = v1
    await fs.writeFile(p, "corrupt!!"); // simulate damage
    await writeJsonAtomic(p, { v: 3 });
    expect(JSON.parse(await fs.readFile(`${p}.bak`, "utf8"))).toEqual({ v: 1 });
    expect(JSON.parse(await fs.readFile(p, "utf8"))).toEqual({ v: 3 });
  });

  test("leaves no temp files behind", async () => {
    const p = path.join(dir, "data.json");
    await writeJsonAtomic(p, [1, 2, 3]);
    const files = await fs.readdir(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("backup: false skips .bak", async () => {
    const p = path.join(dir, "data.json");
    await writeJsonAtomic(p, { v: 1 }, { backup: false });
    await writeJsonAtomic(p, { v: 2 }, { backup: false });
    await expect(fs.access(`${p}.bak`)).rejects.toThrow();
  });
});

describe("snapshotDaily", () => {
  test("copies parseable store files into backups/<day> once and prunes old days", async () => {
    await fs.writeFile(path.join(dir, "builds.json"), "[]");
    await fs.writeFile(path.join(dir, "comps.json"), "not json");
    for (const d of ["2026-01-01", "2026-01-02", "2026-01-03"]) {
      await fs.mkdir(path.join(dir, "backups", d), { recursive: true });
    }
    const out = await snapshotDaily(dir, ["builds.json", "comps.json", "missing.json"], {
      keep: 2, now: new Date("2026-02-01T10:00:00Z"),
    });
    expect(out).toBe(path.join(dir, "backups", "2026-02-01"));
    const snap = await fs.readdir(out);
    expect(snap).toEqual(["builds.json"]); // corrupt + missing skipped
    const days = (await fs.readdir(path.join(dir, "backups"))).sort();
    expect(days).toEqual(["2026-01-03", "2026-02-01"]);
  });
});

describe("BuildStore corruption safety", () => {
  test("a corrupt builds.json is never overwritten by the next save — it is quarantined", async () => {
    const store = new BuildStore(dir);
    await store.init();
    await store.upsertBuild({ title: "Precious" });
    await store.upsertBuild({ title: "Second" }); // .bak now holds [Precious]
    const p = path.join(dir, "builds.json");
    await fs.writeFile(p, "{truncated");
    await store.upsertBuild({ title: "New" });
    const files = await fs.readdir(dir);
    const quarantined = files.find((f) => f.startsWith("builds.json.corrupt-"));
    expect(quarantined).toBeTruthy();
    expect(await fs.readFile(path.join(dir, quarantined), "utf8")).toBe("{truncated");
    // The previous good generation (.bak) was used as the base for the new save
    const builds = await store.listBuilds();
    expect(builds.map((b) => b.title).sort()).toEqual(["New", "Precious"]);
  });
});

describe("BuildStore.markPublished", () => {
  test("stamps publish fields without bumping updatedAt", async () => {
    const store = new BuildStore(dir);
    await store.init();
    const saved = await store.upsertBuild({ title: "B" });
    const out = await store.markPublished(saved.id, {
      publishedFileId: "abc123", publishedKey: "k", publishedSlug: "b", snapshotUpdatedAt: saved.updatedAt,
    });
    expect(out.updatedAt).toBe(saved.updatedAt);
    expect(out.publishedAt).toBe(saved.updatedAt);
    expect(out.publishedFileId).toBe("abc123");
  });

  test("does not clobber a save made during the publish, and reports it stale", async () => {
    const store = new BuildStore(dir);
    await store.init();
    const snapshot = await store.upsertBuild({ title: "Before" });
    await new Promise((r) => setTimeout(r, 5));
    const during = await store.upsertBuild({ ...snapshot, title: "Edited mid-publish" });
    const out = await store.markPublished(snapshot.id, {
      publishedFileId: "abc123", publishedKey: "k", publishedSlug: "before", snapshotUpdatedAt: snapshot.updatedAt,
    });
    expect(out.title).toBe("Edited mid-publish");
    expect(out.updatedAt).toBe(during.updatedAt);
    expect(out.publishedAt).toBe(snapshot.updatedAt);
    const { buildPublishState } = require("../../src/shared/publishState");
    expect(buildPublishState(out).stale).toBe(true);
  });

  test("returns null for unknown id", async () => {
    const store = new BuildStore(dir);
    await store.init();
    expect(await store.markPublished("nope", { publishedFileId: "x" })).toBeNull();
  });
});
