"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { VersionLog } = require("../../../src/main/history/versionLog");
const { TAIL_BYTES } = require("../../../src/main/history/constants");

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

describe("VersionLog — non-ENOENT read failures degrade and log (fix round 1)", () => {
  test("readAll logs and degrades on a non-ENOENT read error instead of throwing", async () => {
    const file = path.join(dir, "r1.jsonl");
    const log = new VersionLog(file);
    await log.append({ v: 1 });

    const err = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const readSpy = jest.spyOn(fs, "readFile").mockRejectedValueOnce(err);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const { entries, dropped } = await log.readAll();
    expect(entries).toEqual([]);
    expect(dropped).toBe(0);
    expect(errorSpy).toHaveBeenCalled();

    readSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("readTail and lastEntry degrade to empty instead of throwing on a non-ENOENT stat error", async () => {
    const file = path.join(dir, "r1.jsonl");
    const log = new VersionLog(file);
    await log.append({ v: 1 });

    const err = Object.assign(new Error("I/O error"), { code: "EIO" });
    const statSpy = jest.spyOn(fs, "stat").mockRejectedValue(err);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(log.readTail(5)).resolves.toEqual([]);
    await expect(log.lastEntry()).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();

    statSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("ENOENT stays silent — no log call for a missing file", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const log = logAt("nope.jsonl");

    await log.readAll();
    await log.readTail(5);
    await log.lastEntry();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("VersionLog — lines larger than TAIL_BYTES (fix round 1)", () => {
  // The controller's images decision keeps full before/after values in every
  // patch, so a single JSONL line can legitimately exceed TAIL_BYTES in
  // production. These force the ">TAIL_BYTES, no newline in the tail window"
  // fallback branch in _repairTornTail, _findLastLineOffset, and readTail —
  // built programmatically, not as a committed fixture.
  function bigPayload() {
    return "x".repeat(TAIL_BYTES + 1000);
  }

  test("repairs a torn tail even when the unterminated line exceeds TAIL_BYTES", async () => {
    const file = path.join(dir, "r1.jsonl");
    const log = new VersionLog(file);
    await log.append({ v: 1 });
    // Simulate a crash mid-write of an oversized entry: no closing brace, no
    // trailing newline, and long enough that the tail window contains no
    // newline at all.
    await fs.appendFile(file, `{"v":2,"blob":"${bigPayload()}`);

    const recovered = new VersionLog(file);
    await recovered.append({ v: 3 });

    const { entries, dropped } = await new VersionLog(file).readAll();
    expect(entries.map((e) => e.v)).toEqual([1, 3]);
    expect(dropped).toBe(0);
  });

  test("replaceLast on a cold start locates the offset when the last line exceeds TAIL_BYTES", async () => {
    const file = path.join(dir, "r1.jsonl");
    const warm = new VersionLog(file);
    await warm.append({ v: 1 });
    await warm.append({ v: 2, blob: bigPayload() });

    const cold = new VersionLog(file);           // fresh instance, no cached offset
    await cold.replaceLast({ v: 2, blob: "small" });

    const { entries } = await new VersionLog(file).readAll();
    expect(entries).toEqual([{ v: 1 }, { v: 2, blob: "small" }]);
  });

  test("readTail falls back to a full read when an oversized line dominates the tail window", async () => {
    const file = path.join(dir, "r1.jsonl");
    const log = new VersionLog(file);
    await log.append({ v: 1 });
    await log.append({ v: 2, blob: bigPayload() });
    await log.append({ v: 3 });

    const tail = await new VersionLog(file).readTail(5);
    expect(tail.map((e) => e.v)).toEqual([3, 2, 1]);
  });
});

// ─── fix round 2 ────────────────────────────────────────────────────────────

describe("VersionLog — replaceLast serializes before it destroys", () => {
  test("an unserializable entry leaves the previous version intact", async () => {
    const log = logAt();
    await log.append({ v: 1 });
    await log.append({ v: 2, summary: "real" });

    const cyclic = { v: 2 };
    cyclic.self = cyclic;
    await expect(log.replaceLast(cyclic)).rejects.toThrow();

    // The destructive write is the one place an ordering mistake costs a
    // version outright, so the previous one has to survive the failure.
    const { entries } = await new VersionLog(log.filePath).readAll();
    expect(entries).toEqual([{ v: 1 }, { v: 2, summary: "real" }]);
  });

  test("a throwing toJSON is caught by the same ordering", async () => {
    const log = logAt();
    await log.append({ v: 1, summary: "real" });
    const hostile = { v: 1, toJSON() { throw new Error("nope"); } };
    await expect(log.replaceLast(hostile)).rejects.toThrow("nope");
    expect((await new VersionLog(log.filePath).readAll()).entries).toEqual([{ v: 1, summary: "real" }]);
  });

  test("the log is still writable after a failed replaceLast", async () => {
    const log = logAt();
    await log.append({ v: 1 });
    const cyclic = {}; cyclic.self = cyclic;
    await expect(log.replaceLast(cyclic)).rejects.toThrow();
    await log.append({ v: 2 });
    expect((await log.readAll()).entries).toEqual([{ v: 1 }, { v: 2 }]);
  });
});

describe("VersionLog — removeLast", () => {
  test("drops the final entry, leaving nothing in its place", async () => {
    const log = logAt();
    await log.append({ v: 1 });
    await log.append({ v: 2 });
    await log.removeLast();
    expect((await new VersionLog(log.filePath).readAll()).entries).toEqual([{ v: 1 }]);
  });

  test("the remaining entry is still the one replaceLast rewrites", async () => {
    // removeLast invalidates the cached offset; a stale one would point at the
    // end of the file and turn the next replaceLast into an append.
    const log = logAt();
    await log.append({ v: 1, summary: "first" });
    await log.append({ v: 2 });
    await log.removeLast();
    await log.replaceLast({ v: 1, summary: "rewritten" });
    expect((await new VersionLog(log.filePath).readAll()).entries).toEqual([{ v: 1, summary: "rewritten" }]);
  });

  test("works on a cold instance with no cached offset", async () => {
    const file = path.join(dir, "r1.jsonl");
    const warm = new VersionLog(file);
    await warm.append({ v: 1 });
    await warm.append({ v: 2 });
    await new VersionLog(file).removeLast();
    expect((await new VersionLog(file).readAll()).entries).toEqual([{ v: 1 }]);
  });

  test("emptying the log leaves a readable empty file, not a torn one", async () => {
    const log = logAt();
    await log.append({ v: 1 });
    await log.removeLast();
    expect((await new VersionLog(log.filePath).readAll()).entries).toEqual([]);
    await log.append({ v: 1, summary: "again" });
    expect((await log.readAll()).entries).toEqual([{ v: 1, summary: "again" }]);
  });
});

// ─── fix round 3 ────────────────────────────────────────────────────────────

// `append` has repaired a torn tail since Task 3; the two destructive ops did
// not. On a file whose final line is a crash fragment, the offset of "the last
// line" is the FRAGMENT's start, so truncating there eats only the fragment and
// leaves the entry the caller meant to act on standing.
describe("VersionLog — destructive writes repair a torn tail first", () => {
  const TORN = '{"v":1}\n{"v":2,"summary":"old"}\n{"v":3,"tor';

  test("replaceLast does not leave two entries with the same v", async () => {
    const file = path.join(dir, "r1.jsonl");
    await fs.writeFile(file, TORN);
    // The store reads lastEntry() first, which drops the fragment, so it
    // replaces v2 — and the log must agree with it.
    await new VersionLog(file).replaceLast({ v: 2, summary: "new" });

    const { entries, dropped } = await new VersionLog(file).readAll();
    expect(entries).toEqual([{ v: 1 }, { v: 2, summary: "new" }]);
    expect(dropped).toBe(0);
    const versions = entries.map((e) => e.v);
    expect(versions).toEqual([...new Set(versions)]);
  });

  test("removeLast removes the last complete entry, not just the fragment", async () => {
    const file = path.join(dir, "r1.jsonl");
    await fs.writeFile(file, TORN);
    await new VersionLog(file).removeLast();

    const { entries, dropped } = await new VersionLog(file).readAll();
    expect(entries).toEqual([{ v: 1 }]);
    expect(dropped).toBe(0);
  });

  // Deliberately NOT titled "a stale cached offset is dropped". The cache here
  // holds the start of the last line this instance wrote, which still precedes
  // the fragment, so truncating at it would discard the fragment either way —
  // the offset is stale-looking but correct. What this pins is that the repair
  // runs on the WARM route too, not only on a cold instance that has to go
  // through _findLastLineOffset.
  test("a warm instance whose file is torn underneath it still replaces coherently", async () => {
    const file = path.join(dir, "r1.jsonl");
    const log = new VersionLog(file);
    await log.append({ v: 1 });
    await log.append({ v: 2, summary: "old" });
    await fs.appendFile(file, '{"v":3,"tor');

    await log.replaceLast({ v: 2, summary: "new" });

    const { entries, dropped } = await new VersionLog(file).readAll();
    expect(entries).toEqual([{ v: 1 }, { v: 2, summary: "new" }]);
    expect(dropped).toBe(0);
  });

  // The one shape in which the cached offset is genuinely WRONG rather than
  // merely stale-looking, and so the only place the invalidation in
  // _lastLineOffset does any work: a SECOND writer appended a complete line
  // after ours and then died mid-append. Our cache now points behind a line we
  // did not write, and truncating there would destroy it.
  //
  // This is outside the single-in-flight-writer contract this class documents,
  // so no current caller can reach it — the version store holds one VersionLog
  // per record in one process. It is pinned because the invalidation is kept as
  // defence in depth, and an untested defence is a claim rather than a guard.
  describe("a second writer appended before dying mid-append", () => {
    async function tornBySecondWriter() {
      const file = path.join(dir, "r1.jsonl");
      const log = new VersionLog(file);
      await log.append({ v: 1 });                                  // caches offset 0
      await fs.appendFile(file, '{"v":2,"summary":"old"}\n');       // not ours
      await fs.appendFile(file, '{"v":3,"tor');                    // ...and it crashed
      return { file, log };
    }

    test("replaceLast does not truncate away the line it never wrote", async () => {
      const { file, log } = await tornBySecondWriter();
      await log.replaceLast({ v: 2, summary: "new" });
      const { entries, dropped } = await new VersionLog(file).readAll();
      expect(entries).toEqual([{ v: 1 }, { v: 2, summary: "new" }]);
      expect(dropped).toBe(0);
    });

    test("removeLast drops one entry, not everything after its cached offset", async () => {
      const { file, log } = await tornBySecondWriter();
      await log.removeLast();
      const { entries, dropped } = await new VersionLog(file).readAll();
      expect(entries).toEqual([{ v: 1 }]);
      expect(dropped).toBe(0);
    });
  });

  test("the log is coherent after a torn removal followed by a fresh append", async () => {
    const file = path.join(dir, "r1.jsonl");
    await fs.writeFile(file, TORN);
    const log = new VersionLog(file);
    await log.removeLast();
    await log.append({ v: 2, summary: "fresh" });

    const { entries, dropped } = await new VersionLog(file).readAll();
    expect(entries).toEqual([{ v: 1 }, { v: 2, summary: "fresh" }]);
    expect(dropped).toBe(0);
  });
});
