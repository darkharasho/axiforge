"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { VersionLog } = require("../../../src/main/history/versionLog");

let dir;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-vlog-")); });
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function logAt(name = "r1.jsonl") { return new VersionLog(path.join(dir, name)); }

describe("VersionLog — append and read", () => {
  test("append creates the file and its parent directory", async () => {
    const log = new VersionLog(path.join(dir, "nested", "deep", "r1.jsonl"));
    await log.append({ v: 1, summary: "Created" });
    const { entries } = await log.readAll();
    expect(entries).toEqual([{ v: 1, summary: "Created" }]);
  });

  test("readAll returns entries oldest-first", async () => {
    const log = logAt();
    await log.append({ v: 1 });
    await log.append({ v: 2 });
    await log.append({ v: 3 });
    const { entries } = await log.readAll();
    expect(entries.map((e) => e.v)).toEqual([1, 2, 3]);
  });

  test("readTail returns entries newest-first, capped", async () => {
    const log = logAt();
    for (let v = 1; v <= 10; v++) await log.append({ v });
    expect((await log.readTail(3)).map((e) => e.v)).toEqual([10, 9, 8]);
  });

  test("readTail on a missing file returns an empty array", async () => {
    expect(await logAt("nope.jsonl").readTail(5)).toEqual([]);
  });

  test("lastEntry returns the newest entry", async () => {
    const log = logAt();
    await log.append({ v: 1 });
    await log.append({ v: 2 });
    expect(await log.lastEntry()).toEqual({ v: 2 });
  });

  test("lastEntry on a missing file is null", async () => {
    expect(await logAt("nope.jsonl").lastEntry()).toBeNull();
  });
});

describe("VersionLog — replaceLast", () => {
  test("replaces the final line in place", async () => {
    const log = logAt();
    await log.append({ v: 1, summary: "a" });
    await log.append({ v: 2, summary: "b" });
    await log.replaceLast({ v: 2, summary: "b+c" });
    const { entries } = await log.readAll();
    expect(entries).toEqual([{ v: 1, summary: "a" }, { v: 2, summary: "b+c" }]);
  });

  test("works on a cold start with no cached offset", async () => {
    const file = path.join(dir, "r1.jsonl");
    const warm = new VersionLog(file);
    await warm.append({ v: 1, summary: "a" });
    await warm.append({ v: 2, summary: "b" });

    const cold = new VersionLog(file);           // fresh instance, no cached offset
    await cold.replaceLast({ v: 2, summary: "rewritten" });

    const { entries } = await new VersionLog(file).readAll();
    expect(entries).toEqual([{ v: 1, summary: "a" }, { v: 2, summary: "rewritten" }]);
  });

  test("replacing the only line leaves exactly one line", async () => {
    const log = logAt();
    await log.append({ v: 1, summary: "a" });
    await log.replaceLast({ v: 1, summary: "b" });
    const { entries } = await log.readAll();
    expect(entries).toEqual([{ v: 1, summary: "b" }]);
  });
});

describe("VersionLog — corruption recovery", () => {
  test("drops a torn final line and reports it", async () => {
    const file = path.join(dir, "r1.jsonl");
    const log = new VersionLog(file);
    await log.append({ v: 1 });
    await log.append({ v: 2 });
    await fs.appendFile(file, '{"v":3,"ops":[{"t":"gea');   // power loss mid-write

    const { entries, dropped } = await new VersionLog(file).readAll();
    expect(entries.map((e) => e.v)).toEqual([1, 2]);
    expect(dropped).toBe(1);
  });

  test("appending after a torn line does not compound the damage", async () => {
    const file = path.join(dir, "r1.jsonl");
    const log = new VersionLog(file);
    await log.append({ v: 1 });
    await fs.appendFile(file, '{"v":2,"tr');

    const recovered = new VersionLog(file);
    await recovered.append({ v: 3 });
    const { entries, dropped } = await new VersionLog(file).readAll();
    expect(entries.map((e) => e.v)).toEqual([1, 3]);
    expect(dropped).toBe(0);
  });

  test("a torn line in the middle is dropped without losing the tail", async () => {
    const file = path.join(dir, "r1.jsonl");
    await fs.writeFile(file, '{"v":1}\n{"v":2,"br\n{"v":3}\n');
    const { entries, dropped } = await new VersionLog(file).readAll();
    expect(entries.map((e) => e.v)).toEqual([1, 3]);
    expect(dropped).toBe(1);
  });

  test("readTail skips unparseable lines", async () => {
    const file = path.join(dir, "r1.jsonl");
    await fs.writeFile(file, '{"v":1}\n{"v":2,"br\n{"v":3}\n');
    expect((await new VersionLog(file).readTail(5)).map((e) => e.v)).toEqual([3, 1]);
  });
});

describe("VersionLog — unlink", () => {
  test("removes the file", async () => {
    const log = logAt();
    await log.append({ v: 1 });
    await log.unlink();
    expect(await log.lastEntry()).toBeNull();
  });

  test("unlinking a missing file is not an error", async () => {
    await expect(logAt("nope.jsonl").unlink()).resolves.toBeUndefined();
  });
});
