# Local Build History v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 50-entry snapshot-per-entry history store with uncapped append-only per-record logs that store structural diffs, and surface those diffs in a side-by-side compare view.

**Architecture:** One JSONL file per record under `data/history/{builds,comps}/<id>.jsonl`. Each line is a version: a keyframe with a verbatim document every 20 versions, structural patches in between. A domain-aware differ produces ops that serve three consumers — the stored patch, the summary line, and the compare UI. Reconstructing any version walks back to the nearest keyframe and applies ops forward.

**Tech Stack:** Node 20 / Electron main process, CommonJS (`src/main/**`). Renderer is ESM with Babel transform. Jest for unit tests, Playwright for E2E (release gate only). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-06-local-build-history-v2-design.md`

## Global Constraints

- **No new dependencies.** `isomorphic-git` and `better-sqlite3` were both explicitly rejected in the spec. Everything here uses `node:fs`, `node:path`, `node:crypto`.
- **`src/main/**` is CommonJS** (`"use strict"`, `require`, `module.exports`). `src/renderer/**` and `packages/forge-render/**` are ESM. Do not mix.
- **Jest only during development**, at `--maxWorkers=2` (global CLAUDE.md — this machine runs heavy apps alongside dev work). Playwright E2E specs are written in this plan but **run only at the release gate**, never mid-session.
- **Constants** (define once in `src/main/history/constants.js`, import everywhere):
  - `KEYFRAME_INTERVAL = 20`
  - `COALESCE_WINDOW_MS = 5 * 60 * 1000`
  - `TAIL_BYTES = 65536`
- **History must never block app launch.** Every failure path logs and degrades; none throws out of `init()`.
- **The round-trip invariant is load-bearing:** `applyOps(before, diff(before, after))` deep-equals `after`, ignoring `updatedAt` and `version`. Any task that touches the differ re-runs its property test.
- Branch: `feat/build-history-v2`. Commit after every task.

---

## Correction to the spec, applied throughout this plan

The spec says `appendVersion({recordId, before, after, ...})` diffs the caller's `before` against `after`. That is wrong in one case and the plan fixes it:

When a save produces only derived-data ops (see Task 1), no version is written. The next real edit would then be diffed against the caller's `before` — the *live* doc — while the stored chain's tail is an *older* state. The chain would silently gain a gap.

**The store owns its own diff base.** `appendVersion` reconstructs its own last stored version and diffs *that* against `after`. The caller's `before` is used only when the log is empty. Reconstruction costs at most 20 lines and the tail is cached in memory, so this is close to free. Task 4 implements it this way.

---

## File structure

**Create:**

| File | Responsibility |
|---|---|
| `src/main/history/constants.js` | The three tuning constants and the field-class lists |
| `src/main/history/diffBuild.js` | `diff` / `applyOps` / `invert` for builds |
| `src/main/history/diffComp.js` | Same vocabulary for comps, slot-level |
| `src/main/history/renderSummary.js` | ops → human summary string |
| `src/main/history/versionLog.js` | Append-only JSONL primitives: append, tail-read, replace-last, torn-tail recovery |
| `src/main/history/migrateV1.js` | One-time `build-history.json` / `comp-history.json` → per-record logs |
| `src/renderer/modules/library/history-compare.js` | The compare modal |
| `scripts/verify-history-migration.mjs` | Migrates a copy of a real profile and asserts every version round-trips |

**Modify:**

| File | Change |
|---|---|
| `src/main/historyStore.js` | Storage half rewritten onto `versionLog`; new API |
| `src/main/buildHistoryStore.js` | Wire to `diffBuild`; delete `summarizeBuildChange` |
| `src/main/compHistoryStore.js` | Wire to `diffComp`; delete `summarizeCompChange` |
| `src/main/index.js:104-120,435,464,620-650,721,729-800,827` | Store construction, save, revert, folder feed |
| `src/main/teamSync.js:630-646,830-850` | Remote-pull and tombstone versions |
| `src/main/trash.js:181-184` | Unlink instead of corpus rewrite |
| `src/preload/index.js:54-58` | New IPC surface |
| `src/renderer/modules/library/history-panel.js` | Version-keyed entries, click-to-compare |
| `packages/forge-render/src/mini-build-card.js` | Additive `data-*` highlight anchors |

---

### Task 1: The build differ

The load-bearing component. Everything else consumes its output.

**Files:**
- Create: `src/main/history/constants.js`
- Create: `src/main/history/diffBuild.js`
- Test: `tests/unit/history/diffBuild.test.js`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `diff(before, after) → Op[]`
  - `applyOps(doc, ops) → doc` (pure, returns a new object)
  - `invert(ops) → Op[]`
  - `classify(ops) → {substantive: Op[], incidental: Op[], derived: Op[]}`
  - Op shapes, exactly:
    ```js
    {t:"skill", slot:"heal"|"utility1"|"utility2"|"utility3"|"elite", uw:boolean, before:object|null, after:object|null}
    {t:"trait", line:number, tier:1|2|3, before:number|null, after:number|null}
    {t:"spec",  line:number, before:{id,name}|null, after:{id,name}|null}
    {t:"gear",  slot:string, part:"item"|"rune"|"infusion"|"sigil0"|"sigil1"|"weapon", before:string|null, after:string|null}
    {t:"stat",  before:string|null, after:string|null}
    {t:"consumable", path:"relic"|"food"|"utility"|"enrichment", before:string|null, after:string|null}
    {t:"field", path:"title"|"notes"|"tags"|"profession"|"gameMode", before:any, after:any}
    {t:"meta",  path:"folderId"|"compIds"|"archivedAt"|"deletedAt", before:any, after:any}
    {t:"derived", path:string, before:any, after:any}
    {t:"raw",   path:string, before:any, after:any}
    ```

**Three field classes, not two.** The spec named substantive and incidental. Real build objects need a third: `specializations[i].majorTraitsByTier` and `.minorTraits` embed the *catalog of trait options*, not the user's choice — the choice is `majorChoices: {"1":675,"2":668,"3":1687}`. A game patch that edits any option's description currently trips `JSON.stringify(before.specializations) !== ...` in `buildHistoryStore.js:35` and logs "specializations changed" on a build nobody touched. Those become `t:"derived"` ops: they round-trip faithfully, but they never produce a summary line and never justify writing a version.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/history/diffBuild.test.js`:

```js
"use strict";

const { diff, applyOps, invert, classify } = require("../../../src/main/history/diffBuild");

function baseBuild() {
  return {
    id: "b1",
    version: 3,
    title: "Power Berserker",
    profession: "Warrior",
    gameMode: "pve",
    updatedAt: "2026-09-01T10:00:00.000Z",
    specializations: [
      {
        id: 45, name: "Chaos", elite: false,
        majorChoices: { 1: 675, 2: 668, 3: 1687 },
        majorTraitsByTier: { 1: [{ id: 670, name: "Method of Madness", description: "old text" }] },
        minorTraits: [{ id: 666, name: "Metaphysical Rejuvenation", description: "old text" }],
      },
    ],
    skills: {
      heal: { id: 9093, name: "Healing Signet", description: "old text" },
      utility: [
        { id: 14405, name: "Endure Pain" },
        { id: 14512, name: "Signet of Might" },
        { id: 14404, name: "Bull's Charge" },
      ],
      elite: { id: 14415, name: "Signet of Rage" },
    },
    underwaterSkills: { heal: null, utility: [], elite: null },
    equipment: {
      statPackage: "Berserker",
      relic: "Relic of Fireworks",
      food: "", utility: "", enrichment: "",
      slots: { head: "Zojja's Visage", chest: "Zojja's Breastplate" },
      weapons: { mainhand1: "Greatsword", offhand1: "" },
      runes: { head: "Superior Rune of the Scholar", chest: "Superior Rune of the Scholar" },
      sigils: { mainhand1: ["74326", "82876"], offhand1: [""] },
      infusions: { head: "", mainhand1: [] },
    },
    tags: ["raid"],
    notes: "opener: F1",
    folderId: "f1",
    compIds: [],
  };
}

describe("diffBuild — round-trip invariant", () => {
  const mutations = {
    "swap a rune": (b) => { b.equipment.runes.head = "Superior Rune of Durability"; },
    "swap a skill": (b) => { b.skills.utility[1] = { id: 14509, name: "Frenzy" }; },
    "empty the utility bar": (b) => { b.skills.utility = []; },
    "change a trait choice": (b) => { b.specializations[0].majorChoices[2] = 999; },
    "swap a whole spec line": (b) => { b.specializations[0] = { id: 51, name: "Defense", majorChoices: { 1: 1, 2: 2, 3: 3 } }; },
    "drop the spec line": (b) => { b.specializations = []; },
    "change stats": (b) => { b.equipment.statPackage = "Dragon"; },
    "swap a sigil": (b) => { b.equipment.sigils.mainhand1 = ["74326", "24615"]; },
    "clear a weapon": (b) => { b.equipment.weapons.mainhand1 = ""; },
    "edit notes": (b) => { b.notes = "opener: F1, then F2"; },
    "retag": (b) => { b.tags = ["raid", "strike"]; },
    "move folder": (b) => { b.folderId = "f2"; },
    "null out equipment": (b) => { b.equipment = null; },
    "add an unknown top-level key": (b) => { b.somethingNobodyPlanned = { a: [1, 2] }; },
    "remove a known key": (b) => { delete b.notes; },
    "derived catalog text changes": (b) => {
      b.specializations[0].majorTraitsByTier[1][0].description = "new text";
      b.skills.heal.description = "new text";
    },
  };

  for (const [name, mutate] of Object.entries(mutations)) {
    test(`${name} round-trips`, () => {
      const before = baseBuild();
      const after = baseBuild();
      mutate(after);
      const ops = diff(before, after);
      const rebuilt = applyOps(before, ops);
      expect(rebuilt).toEqual(after);
    });

    test(`${name} inverts`, () => {
      const before = baseBuild();
      const after = baseBuild();
      mutate(after);
      const ops = diff(before, after);
      expect(applyOps(after, invert(ops))).toEqual(before);
    });
  }

  test("identical documents produce no ops", () => {
    expect(diff(baseBuild(), baseBuild())).toEqual([]);
  });

  test("updatedAt and version alone produce no ops", () => {
    const after = baseBuild();
    after.updatedAt = "2026-09-02T11:00:00.000Z";
    after.version = 4;
    expect(diff(baseBuild(), after)).toEqual([]);
  });

  test("a first version diffs from null", () => {
    const ops = diff(null, baseBuild());
    expect(applyOps({}, ops)).toEqual(baseBuild());
  });
});

describe("diffBuild — op shapes", () => {
  test("a rune swap is a gear op naming the slot and part", () => {
    const after = baseBuild();
    after.equipment.runes.head = "Superior Rune of Durability";
    expect(diff(baseBuild(), after)).toEqual([
      { t: "gear", slot: "head", part: "rune",
        before: "Superior Rune of the Scholar", after: "Superior Rune of Durability" },
    ]);
  });

  test("a utility swap names the numbered slot", () => {
    const after = baseBuild();
    after.skills.utility[1] = { id: 14509, name: "Frenzy" };
    const ops = diff(baseBuild(), after);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ t: "skill", slot: "utility2", uw: false });
    expect(ops[0].after).toEqual({ id: 14509, name: "Frenzy" });
  });

  test("a trait choice is a trait op with line and tier", () => {
    const after = baseBuild();
    after.specializations[0].majorChoices[2] = 999;
    expect(diff(baseBuild(), after)).toEqual([
      { t: "trait", line: 0, tier: 2, before: 668, after: 999 },
    ]);
  });

  test("an unknown key produces a raw op rather than being dropped", () => {
    const after = baseBuild();
    after.somethingNobodyPlanned = { a: [1, 2] };
    expect(diff(baseBuild(), after)).toEqual([
      { t: "raw", path: "somethingNobodyPlanned", before: undefined, after: { a: [1, 2] } },
    ]);
  });
});

describe("diffBuild — identity comparison", () => {
  test("a description rewrite on an otherwise identical skill is derived, not substantive", () => {
    const after = baseBuild();
    after.skills.heal.description = "new text";
    const ops = diff(baseBuild(), after);
    expect(ops.every((o) => o.t === "derived")).toBe(true);
    expect(classify(ops).substantive).toHaveLength(0);
  });

  test("a trait option catalog change is derived", () => {
    const after = baseBuild();
    after.specializations[0].majorTraitsByTier[1][0].description = "new text";
    expect(classify(diff(baseBuild(), after)).substantive).toHaveLength(0);
  });

  test("skills compare on id, not object identity", () => {
    const after = baseBuild();
    after.skills.elite = { id: 14415, name: "Signet of Rage", icon: "http://new.png" };
    expect(classify(diff(baseBuild(), after)).substantive).toHaveLength(0);
  });
});

describe("diffBuild — classify", () => {
  test("splits substantive, incidental and derived", () => {
    const after = baseBuild();
    after.equipment.runes.head = "Superior Rune of Durability";  // substantive
    after.folderId = "f2";                                       // incidental
    after.skills.heal.description = "new text";                  // derived
    const { substantive, incidental, derived } = classify(diff(baseBuild(), after));
    expect(substantive).toHaveLength(1);
    expect(incidental).toHaveLength(1);
    expect(derived).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/history/diffBuild.test.js --maxWorkers=2
```

Expected: FAIL — `Cannot find module '../../../src/main/history/diffBuild'`.

- [ ] **Step 3: Write the constants**

Create `src/main/history/constants.js`:

```js
"use strict";

// How often a verbatim document is written instead of a patch. Reconstruction
// never walks more than this many lines; raising it shrinks files and
// lengthens the walk.
const KEYFRAME_INTERVAL = 20;

// Successive edits by the same author and source inside this window merge into
// one version instead of appending a new one.
const COALESCE_WINDOW_MS = 5 * 60 * 1000;

// How much of a log's tail is read to locate the final newline on a cold start.
const TAIL_BYTES = 65536;

// Changed by every save; excluded from ops entirely, otherwise every save would
// log a version and defeat the zero-ops rule. Keyframes still carry them.
const IGNORED_FIELDS = ["updatedAt", "version"];

// A change here is a real edit worth a summary line.
const SUBSTANTIVE_OPS = ["skill", "trait", "spec", "gear", "stat", "consumable", "field", "raw"];

// A change here is bookkeeping: it is logged (a folder move matters in a shared
// folder feed) but it is not a build edit and gets its own phrasing.
const INCIDENTAL_PATHS = ["folderId", "compIds", "archivedAt", "deletedAt"];

module.exports = {
  KEYFRAME_INTERVAL,
  COALESCE_WINDOW_MS,
  TAIL_BYTES,
  IGNORED_FIELDS,
  SUBSTANTIVE_OPS,
  INCIDENTAL_PATHS,
};
```

- [ ] **Step 4: Implement the differ**

Create `src/main/history/diffBuild.js`. The structure is: a table of *field handlers* that own a known path and emit a domain op, plus a generic walker that emits `raw` ops for everything else. `applyOps` is the inverse table. The `raw` fallback is what makes the round-trip invariant hold for keys nobody planned for.

Key implementation notes for the engineer:

- **Identity comparison.** A helper `sameEntity(a, b)` returns true when both are objects and `a.id === b.id`, or when both lack `id` and `a.name === b.name`. Skills, traits and spec lines use it. When `sameEntity` is true but the objects differ, emit a `derived` op carrying the full before/after (so the round-trip still holds) rather than a `skill`/`spec` op.
- **`applyOps` must be pure.** Deep-clone via `structuredClone` (available in Node 20) before mutating; never touch the input.
- **`undefined` vs missing.** `applyOps` must delete a key when `after` is `undefined`, not set it to `undefined`, or `toEqual` will pass while `Object.keys` diverges. The "remove a known key" test covers this.
- **`invert(ops)`** swaps `before`/`after` on every op and reverses array order.
- **Ordering must be deterministic** — iterate known paths in a fixed declared order, then unknown keys sorted alphabetically — so the op-shape tests can assert on exact arrays.
- **Null-safety.** `before` may be `null` (first version) and `after.equipment` may be `null` (the "null out equipment" test). Guard every descent.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx jest tests/unit/history/diffBuild.test.js --maxWorkers=2
```

Expected: PASS, all describes green. If a round-trip test fails, the fix is always in the walker's coverage — never loosen the assertion.

- [ ] **Step 6: Commit**

```bash
git add src/main/history/constants.js src/main/history/diffBuild.js tests/unit/history/diffBuild.test.js
git commit -m "feat(history): structural differ for builds with round-trip invariant"
```

---

### Task 2: Summary rendering

**Files:**
- Create: `src/main/history/renderSummary.js`
- Test: `tests/unit/history/renderSummary.test.js`

**Interfaces:**
- Consumes: `Op[]` and `classify` from Task 1
- Produces: `renderSummary(ops, {folderNameOf} = {}) → string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/history/renderSummary.test.js`:

```js
"use strict";

const { renderSummary } = require("../../../src/main/history/renderSummary");

describe("renderSummary", () => {
  test("names a gear swap by slot and part", () => {
    expect(renderSummary([
      { t: "gear", slot: "head", part: "rune",
        before: "Superior Rune of the Scholar", after: "Superior Rune of Durability" },
    ])).toBe("helm rune: Superior Rune of the Scholar → Superior Rune of Durability");
  });

  test("names a skill swap by slot", () => {
    expect(renderSummary([
      { t: "skill", slot: "utility2", uw: false,
        before: { id: 1, name: "Endure Pain" }, after: { id: 2, name: "Frenzy" } },
    ])).toBe("utility 2: Endure Pain → Frenzy");
  });

  test("marks underwater skills", () => {
    expect(renderSummary([
      { t: "skill", slot: "heal", uw: true,
        before: { id: 1, name: "A" }, after: { id: 2, name: "B" } },
    ])).toBe("underwater heal: A → B");
  });

  test("describes a folder move by name when a resolver is given", () => {
    expect(renderSummary(
      [{ t: "meta", path: "folderId", before: "f1", after: "f2" }],
      { folderNameOf: (id) => ({ f1: "Drafts", f2: "Raids/Support" })[id] },
    )).toBe("moved to Raids/Support");
  });

  test("falls back to a bare move when the folder cannot be named", () => {
    expect(renderSummary(
      [{ t: "meta", path: "folderId", before: "f1", after: "f2" }],
    )).toBe("moved to another folder");
  });

  test("groups above four ops", () => {
    const ops = [
      { t: "gear", slot: "head", part: "rune", before: "a", after: "b" },
      { t: "gear", slot: "chest", part: "rune", before: "a", after: "b" },
      { t: "gear", slot: "hands", part: "rune", before: "a", after: "b" },
      { t: "gear", slot: "mainhand1", part: "sigil0", before: "a", after: "b" },
      { t: "gear", slot: "offhand1", part: "sigil0", before: "a", after: "b" },
      { t: "field", path: "notes", before: "a", after: "b" },
    ];
    expect(renderSummary(ops)).toBe("3 gear slots, 2 sigils, notes");
  });

  test("joins two or three ops with semicolons", () => {
    expect(renderSummary([
      { t: "field", path: "title", before: "Old", after: "New" },
      { t: "field", path: "notes", before: "a", after: "b" },
    ])).toBe('title: "Old" → "New"; notes updated');
  });

  test("derived ops never appear", () => {
    expect(renderSummary([
      { t: "derived", path: "skills.heal.description", before: "a", after: "b" },
      { t: "field", path: "notes", before: "a", after: "b" },
    ])).toBe("notes updated");
  });

  test("an empty op list is never summarised", () => {
    expect(renderSummary([])).toBe("");
  });

  test('"build updated" is not a reachable output', () => {
    const shapes = [
      [{ t: "raw", path: "mystery", before: 1, after: 2 }],
      [{ t: "stat", before: "Berserker", after: "Dragon" }],
      [{ t: "meta", path: "archivedAt", before: null, after: "2026-09-01" }],
    ];
    for (const ops of shapes) {
      expect(renderSummary(ops)).not.toBe("build updated");
      expect(renderSummary(ops).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/unit/history/renderSummary.test.js --maxWorkers=2
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/main/history/renderSummary.js`. It needs:

- A `SLOT_LABELS` map turning storage keys into the words the UI already uses: `head → "helm"`, `mainhand1 → "main hand"`, `offhand1 → "off hand"`, `utility1..3 → "utility 1..3"`, and so on. Match the vocabulary in `renderMiniBuildCard` so the panel and the card agree.
- A per-op-type renderer producing the single-op strings the tests assert.
- Grouping above four ops: count by category (`gear slots`, `sigils`, `skills`, `traits`), pluralise, and join with commas. `field` ops keep their bare noun (`notes`), which is why the grouped example ends with `notes`.
- `derived` ops filtered out at entry.
- Empty input returns `""`. Callers must never write a version with no ops, so an empty summary is a bug signal rather than a display string.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tests/unit/history/renderSummary.test.js --maxWorkers=2
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/history/renderSummary.js tests/unit/history/renderSummary.test.js
git commit -m "feat(history): derive summaries from ops instead of hand-written checks"
```

---

### Task 3: Append-only log primitives

**Files:**
- Create: `src/main/history/versionLog.js`
- Test: `tests/unit/history/versionLog.test.js`

**Interfaces:**
- Consumes: `TAIL_BYTES` from Task 1's constants
- Produces: class `VersionLog`
  - `new VersionLog(filePath)`
  - `async append(entry) → entry` — appends one JSON line, caches its byte offset
  - `async replaceLast(entry) → entry` — truncates to the last line's offset, then appends
  - `async readAll() → {entries: object[], dropped: number}` — oldest-first
  - `async readTail(limit) → object[]` — newest-first, at most `limit`
  - `async lastEntry() → object | null`
  - `async unlink() → void`

This task is pure file mechanics with no domain knowledge. Keep it that way — the store in Task 4 is where versions get meaning.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/history/versionLog.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/unit/history/versionLog.test.js --maxWorkers=2
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/main/history/versionLog.js`. Implementation notes:

- **`append`** — `fs.mkdir(dirname, {recursive:true})`, then `stat` for the current size (that size is the new line's offset), then `fs.appendFile(file, JSON.stringify(entry) + "\n")`. Cache `this.#lastOffset = sizeBeforeAppend`. A missing file means offset 0.
- **Repairing before appending.** If the file's final byte is not `\n`, the previous write was torn. Truncate back to the last `\n` *before* appending, which is what the "does not compound the damage" test asserts.
- **`replaceLast`** — if `#lastOffset` is cached, `fs.truncate(file, offset)` then append. Cold start: read the final `TAIL_BYTES`, find the last `\n` that is not the terminating one, and derive the offset. Guard the single-line case, where the offset is 0.
- **`readAll`** — read the whole file, split on `\n`, drop empty trailing entries, `JSON.parse` each inside a try/catch, count failures into `dropped`. Never throw on a parse failure.
- **`readTail(limit)`** — read the final `TAIL_BYTES` (or the whole file if smaller), discard the first partial line *only when the read did not start at byte 0*, parse the rest, reverse, slice to `limit`. If fewer than `limit` entries survive and the read was truncated, fall back to `readAll`.
- Everything is `node:fs/promises`. No streams; these files are small by construction.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tests/unit/history/versionLog.test.js --maxWorkers=2
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/history/versionLog.js tests/unit/history/versionLog.test.js
git commit -m "feat(history): append-only jsonl log with torn-tail recovery"
```

---

### Task 4: The v2 HistoryStore

**Files:**
- Modify: `src/main/historyStore.js` (rewrite the storage half)
- Modify: `src/main/buildHistoryStore.js` (delete `summarizeBuildChange`, wire `diffBuild`)
- Modify: `src/main/compHistoryStore.js` (delete `summarizeCompChange`, wire `diffComp`)
- Create: `src/main/history/diffComp.js`
- Modify: `tests/unit/buildHistoryStore.test.js` (rewrite against the new API)
- Test: `tests/unit/history/historyStore.test.js`

**Interfaces:**
- Consumes: `VersionLog` (Task 3), `diff`/`applyOps`/`classify` (Task 1), `renderSummary` (Task 2), constants (Task 1)
- Produces:
  ```js
  new BuildHistoryStore(baseDir)   // → data/history/builds/<id>.jsonl
  new CompHistoryStore(baseDir)    // → data/history/comps/<id>.jsonl

  async init()
  async appendVersion({recordId, before, after, author, source, kind, ts}) → version | null
  // `ts` is injected (ISO string), defaulting to now. Tests always pass it;
  // production never does. The store must not call Date.now() internally.
  async listVersions(recordId, {limit = 100, cursor = null}) → {versions, nextCursor}
  async getVersion(recordId, v) → doc | null
  async listTails(recordIds, limit) → version[]   // newest-first across records, each tagged {recordId}
  async deleteHistory(recordId) → void
  ```
  A `version` is `{v, ts, author, source, kind, summary, ops?, doc?, recordId}`.

**The store owns its diff base** (see "Correction to the spec"): `appendVersion` reconstructs its own last stored version and diffs that against `after`. The caller's `before` is used only when the log is empty.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/history/historyStore.test.js`:

```js
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildHistoryStore } = require("../../../src/main/buildHistoryStore");
const { KEYFRAME_INTERVAL } = require("../../../src/main/history/constants");

let dir, store;
const T0 = Date.parse("2026-09-01T10:00:00.000Z");

function build(over = {}) {
  return {
    id: "b1", title: "Power Berserker", profession: "Warrior",
    equipment: { statPackage: "Berserker", runes: { head: "Superior Rune of the Scholar" }, slots: {}, weapons: {}, sigils: {}, infusions: {} },
    skills: { heal: { id: 9093, name: "Healing Signet" }, utility: [], elite: null },
    specializations: [], tags: [], notes: "", folderId: "f1",
    ...over,
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-hstore-"));
  store = new BuildHistoryStore(dir);
  await store.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

// Every append gets an explicit clock so coalescing is deterministic.
function at(ms) { return new Date(T0 + ms).toISOString(); }

describe("appendVersion — basics", () => {
  test("the first version is a keyframe carrying the whole doc", async () => {
    const v = await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "local", source: "local", ts: at(0) });
    expect(v).toMatchObject({ v: 1, kind: "key", author: "local", source: "local" });
    expect(v.doc).toEqual(build());
  });

  test("a later version stores ops, not a doc", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const v = await store.appendVersion({
      recordId: "b1", after: build({ title: "Renamed" }), author: "local", source: "local", ts: at(10 * 60_000),
    });
    expect(v.v).toBe(2);
    expect(v.doc).toBeUndefined();
    expect(v.ops).toEqual([{ t: "field", path: "title", before: "Power Berserker", after: "Renamed" }]);
    expect(v.summary).toBe('title: "Power Berserker" → "Renamed"');
  });

  test("an unchanged save writes nothing and returns null", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const v = await store.appendVersion({ recordId: "b1", after: build(), ts: at(10 * 60_000) });
    expect(v).toBeNull();
    expect((await store.listVersions("b1")).versions).toHaveLength(1);
  });

  test("a derived-only change writes nothing", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const patched = build();
    patched.skills.heal.description = "reworded by a game patch";
    const v = await store.appendVersion({ recordId: "b1", after: patched, ts: at(10 * 60_000) });
    expect(v).toBeNull();
  });

  test("an incidental-only change is logged as kind meta", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const v = await store.appendVersion({ recordId: "b1", after: build({ folderId: "f2" }), ts: at(10 * 60_000) });
    expect(v).toMatchObject({ kind: "meta" });
    expect(v.summary).toContain("moved to");
  });
});

describe("appendVersion — the store owns its diff base", () => {
  test("a skipped derived-only save does not create a gap in the chain", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });

    const patched = build();
    patched.skills.heal.description = "reworded";
    await store.appendVersion({ recordId: "b1", after: patched, ts: at(10 * 60_000) });   // → null

    // Caller's `before` is now the patched doc, but the log's tail is the original.
    const edited = { ...patched, title: "Renamed" };
    await store.appendVersion({ recordId: "b1", before: patched, after: edited, ts: at(20 * 60_000) });

    expect(await store.getVersion("b1", 2)).toEqual(edited);
  });
});

describe("appendVersion — coalescing", () => {
  test("edits inside the window by the same author merge into one version", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(10 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(11 * 60_000) });

    const { versions } = await store.listVersions("b1");
    expect(versions).toHaveLength(2);
    expect(versions[0].v).toBe(2);
    expect(await store.getVersion("b1", 2)).toEqual(build({ title: "B" }));
  });

  test("edits outside the window stay separate", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(10 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(30 * 60_000) });
    expect((await store.listVersions("b1")).versions).toHaveLength(3);
  });

  test("a different author breaks coalescing", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(10 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "teammate", source: "local", ts: at(11 * 60_000) });
    expect((await store.listVersions("b1")).versions).toHaveLength(3);
  });

  test("a different source breaks coalescing", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(10 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "team-sync", ts: at(11 * 60_000) });
    expect((await store.listVersions("b1")).versions).toHaveLength(3);
  });

  test("coalescing never swallows the first version", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(60_000) });
    const { versions } = await store.listVersions("b1");
    expect(versions.map((x) => x.v)).toEqual([2, 1]);
    expect(await store.getVersion("b1", 1)).toEqual(build());
  });
});

describe("keyframes and reconstruction", () => {
  test(`every ${KEYFRAME_INTERVAL}th version is a keyframe`, async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "t0" }), author: "me", source: "local", ts: at(0) });
    for (let i = 1; i < KEYFRAME_INTERVAL * 2; i++) {
      await store.appendVersion({
        recordId: "b1", after: build({ title: `t${i}` }),
        author: "me", source: "local", ts: at((i + 1) * 60 * 60_000),   // an hour apart: never coalesces
      });
    }
    const { versions } = await store.listVersions("b1", { limit: 100 });
    const keyframes = versions.filter((x) => x.kind === "key").map((x) => x.v).sort((a, b) => a - b);
    expect(keyframes).toEqual([1, KEYFRAME_INTERVAL + 1]);
  });

  test("every version reconstructs exactly", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "t0" }), author: "me", source: "local", ts: at(0) });
    for (let i = 1; i < 45; i++) {
      await store.appendVersion({
        recordId: "b1", after: build({ title: `t${i}` }),
        author: "me", source: "local", ts: at((i + 1) * 60 * 60_000),
      });
    }
    for (let i = 0; i < 45; i++) {
      expect(await store.getVersion("b1", i + 1)).toEqual(build({ title: `t${i}` }));
    }
  });

  test("getVersion on a missing version is null", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    expect(await store.getVersion("b1", 99)).toBeNull();
    expect(await store.getVersion("nope", 1)).toBeNull();
  });
});

describe("listVersions and listTails", () => {
  test("listVersions is newest-first and paginates", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "t0" }), author: "me", source: "local", ts: at(0) });
    for (let i = 1; i < 10; i++) {
      await store.appendVersion({ recordId: "b1", after: build({ title: `t${i}` }), author: "me", source: "local", ts: at((i + 1) * 60 * 60_000) });
    }
    const first = await store.listVersions("b1", { limit: 4 });
    expect(first.versions.map((x) => x.v)).toEqual([10, 9, 8, 7]);
    const second = await store.listVersions("b1", { limit: 4, cursor: first.nextCursor });
    expect(second.versions.map((x) => x.v)).toEqual([6, 5, 4, 3]);
  });

  test("listTails merges records newest-first and tags each with its record id", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ id: "b1" }), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b2", before: null, after: build({ id: "b2" }), author: "me", source: "local", ts: at(60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ id: "b1", title: "Renamed" }), author: "me", source: "local", ts: at(120 * 60_000) });

    const feed = await store.listTails(["b1", "b2"], 10);
    expect(feed.map((x) => x.recordId)).toEqual(["b1", "b2", "b1"]);
  });

  test("listTails ignores record ids with no history", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    expect(await store.listTails(["b1", "ghost"], 10)).toHaveLength(1);
  });
});

describe("deleteHistory", () => {
  test("removes the record's log", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    await store.deleteHistory("b1");
    expect((await store.listVersions("b1")).versions).toEqual([]);
  });
});

describe("concurrency", () => {
  test("parallel appends to one record do not drop versions", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "t0" }), author: "me", source: "local", ts: at(0) });
    await Promise.all([1, 2, 3, 4, 5].map((i) => store.appendVersion({
      recordId: "b1", after: build({ title: `t${i}` }),
      author: `author${i}`, source: "local", ts: at((i + 1) * 60 * 60_000),
    })));
    const { versions } = await store.listVersions("b1", { limit: 50 });
    expect(versions.map((x) => x.v)).toEqual([6, 5, 4, 3, 2, 1]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/unit/history/historyStore.test.js --maxWorkers=2
```

Expected: FAIL — `store.appendVersion is not a function`.

- [ ] **Step 3: Rewrite `historyStore.js`**

Keep the class shape and the `#writeQueue` serialization; replace the storage half.

- Constructor becomes `(baseDir, {subdir, idField, differ})` where `differ` is `{diff, applyOps, classify, renderSummary}`. `this.dir = path.join(baseDir, "history", subdir)`.
- `init()` is `fs.mkdir(this.dir, {recursive: true})`. It must not throw.
- `#logFor(recordId)` returns a cached `VersionLog` for `path.join(this.dir, `${sanitize(recordId)}.jsonl`)`. **Sanitize the id** — it reaches the filesystem. Reject anything outside `[A-Za-z0-9_-]` by hashing it with `crypto.createHash("sha1")`; record ids are UUIDs today, so this is a guard, not a transformation.
- `appendVersion` — enqueue on `#writeQueue`, then:
  1. `last = await log.lastEntry()`. If none: write `{v:1, kind:"key", doc: after, summary: "Created"}`.
  2. Otherwise `base = await this.getVersion(recordId, last.v)` — **the store's own base**.
  3. `ops = diff(base, after)`. Empty → return `null`.
  4. `{substantive, incidental, derived} = classify(ops)`. If `substantive.length === 0 && incidental.length === 0` → return `null` (derived-only).
  5. `kind = substantive.length === 0 ? "meta" : undefined`.
  6. Coalesce when `last.author === author && last.source === source && ts - Date.parse(last.ts) <= COALESCE_WINDOW_MS && last.v > 1`: recompute `ops` from the version *before* `last` and `log.replaceLast(...)`, keeping `last.v`. Note the `last.v > 1` guard — the first version is a keyframe and coalescing into it would erase the record's origin, which the "never swallows the first version" test pins.
  7. Otherwise `v = last.v + 1`; write a keyframe when `v % KEYFRAME_INTERVAL === 1`, else a delta. A `kind:"delete"` version always writes a keyframe regardless of interval, so "Bring it back" always has a doc to restore.
  8. `summary = renderSummary(ops, {folderNameOf})` where `folderNameOf` is an optional injected resolver.
- `ts` is an injected parameter defaulting to `new Date().toISOString()`. Tests pass it explicitly; production does not. Do not call `Date.now()` inside the store.
- `getVersion(recordId, v)` — `readAll()`, walk back from `v` to the nearest `kind:"key"`, `applyOps` forward. Return `null` when `v` is absent.
- `listVersions(recordId, {limit, cursor})` — `readAll()`, reverse, slice from `cursor` (a version number), return `{versions, nextCursor}`; `nextCursor` is `null` at the end.
- `listTails(recordIds, limit)` — `Promise.all` of `readTail(limit)` per id, tag each with `recordId`, merge-sort by `ts` descending, slice to `limit`.
- `deleteHistory(recordId)` — `log.unlink()` and drop the cache entry.

Then in `buildHistoryStore.js`: delete `summarizeBuildChange` and its three `_describe*` helpers entirely, and construct with `{subdir: "builds", idField: "buildId", differ: require("./history/diffBuild")}`. Keep the module's export shape otherwise.

- [ ] **Step 4: Write `diffComp.js` and wire `compHistoryStore.js`**

`src/main/history/diffComp.js` exports the same four functions. Comp ops:

```js
{t:"slot", line:number, index:number, before:string|null, after:string|null}  // build id or "tag:<id>"
{t:"field", path:"name"|"notes"|"tags", before:any, after:any}
{t:"meta", path:"folderId"|"archivedAt"|"deletedAt", before:any, after:any}
{t:"raw", path:string, before:any, after:any}
```

It compares `partyLines[i].slots[j]` positionally and does **not** recurse into embedded build objects — a comp's 2.2 MB is mostly per-slot build data, and a slot swap must be a small patch. `renderSummary` gains comp cases: `party 2 slot 3: Heal Druid → Alacrity Mechanist`.

Add matching tests in `tests/unit/history/diffComp.test.js`, mirroring Task 1's round-trip block over comp mutations: swap a slot, empty a party line, add a party line, rename, retag, move folder, unknown key.

- [ ] **Step 5: Rewrite `tests/unit/buildHistoryStore.test.js`**

The existing 337 lines test `addEntry`/`getHistory`/`deleteHistory`, which no longer exist. Port each behavioural assertion that still has meaning (author and source recorded, deletion removes history, concurrent writes do not drop entries) onto the new API, and delete the ones that tested the cap — the cap is gone, which is the point. Do the same for `tests/unit/compHistoryStore.test.js`.

- [ ] **Step 6: Run the full history suite**

```bash
npx jest tests/unit/history tests/unit/buildHistoryStore.test.js tests/unit/compHistoryStore.test.js --maxWorkers=2
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/historyStore.js src/main/buildHistoryStore.js src/main/compHistoryStore.js \
        src/main/history/diffComp.js tests/unit/history tests/unit/buildHistoryStore.test.js \
        tests/unit/compHistoryStore.test.js
git commit -m "feat(history): per-record append-only store with keyframes and coalescing"
```

---

### Task 5: Migration from v1

**Files:**
- Create: `src/main/history/migrateV1.js`
- Create: `scripts/verify-history-migration.mjs`
- Test: `tests/unit/history/migrateV1.test.js`

**Interfaces:**
- Consumes: `HistoryStore` (Task 4), `diff` (Task 1)
- Produces: `async migrateV1({baseDir, store, fileName, idField, liveDocs}) → {migrated, failed, skipped}`
  - `liveDocs` is a `Map<recordId, doc>` of the currently live records

**The chronology.** v1 entries are newest-first and each `snapshot` is the state *before* its change. For entries `e₁…eₙ` (newest→oldest): `eₙ.snapshot` is the oldest state, change `eₖ` produced `eₖ₋₁.snapshot`, and `e₁`'s change produced the live doc. Summaries are **recomputed** through the new differ, so old `"build updated"` lines become descriptive.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/history/migrateV1.test.js`:

```js
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { migrateV1 } = require("../../../src/main/history/migrateV1");
const { BuildHistoryStore } = require("../../../src/main/buildHistoryStore");

let dir, store;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-migrate-"));
  store = new BuildHistoryStore(dir);
  await store.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function doc(title, rune = "Scholar") {
  return { id: "b1", title, equipment: { runes: { head: rune }, slots: {}, weapons: {}, sigils: {}, infusions: {} } };
}

async function writeV1(data) {
  await fs.writeFile(path.join(dir, "build-history.json"), JSON.stringify(data), "utf8");
}

function run(liveDocs = new Map()) {
  return migrateV1({ baseDir: dir, store, fileName: "build-history.json", idField: "buildId", liveDocs });
}

describe("migrateV1", () => {
  test("replays a record oldest-first and ends at the live doc", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "build updated", snapshot: doc("v2") },
        { id: "e2", buildId: "b1", timestamp: "2026-09-02T10:00:00.000Z", authorLogin: "me", source: "local", summary: "build updated", snapshot: doc("v1") },
      ],
    });
    const res = await run(new Map([["b1", doc("v3")]]));

    expect(res).toMatchObject({ migrated: 1, failed: 0 });
    const { versions } = await store.listVersions("b1", { limit: 10 });
    expect(versions.map((v) => v.v)).toEqual([3, 2, 1]);
    expect(await store.getVersion("b1", 1)).toEqual(doc("v1"));
    expect(await store.getVersion("b1", 2)).toEqual(doc("v2"));
    expect(await store.getVersion("b1", 3)).toEqual(doc("v3"));
  });

  test("carries each entry's timestamp and author onto the version it produced", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "teammate", source: "team-sync", summary: "x", snapshot: doc("v1") },
      ],
    });
    await run(new Map([["b1", doc("v2")]]));
    const { versions } = await store.listVersions("b1");
    expect(versions[0]).toMatchObject({ v: 2, author: "teammate", source: "team-sync", ts: "2026-09-03T10:00:00.000Z" });
  });

  test('recomputes summaries, so "build updated" does not survive', async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "build updated", snapshot: doc("Same", "Scholar") },
      ],
    });
    await run(new Map([["b1", doc("Same", "Durability")]]));
    const { versions } = await store.listVersions("b1");
    expect(versions[0].summary).toBe("helm rune: Scholar → Durability");
  });

  test("a record whose build is gone stops at the newest snapshot", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") },
      ],
    });
    await run(new Map());
    expect((await store.listVersions("b1")).versions.map((v) => v.v)).toEqual([1]);
    expect(await store.getVersion("b1", 1)).toEqual(doc("v1"));
  });

  test("legacy entries with no snapshot are skipped without aborting the record", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v2") },
        { id: "e2", buildId: "b1", timestamp: "2026-09-02T10:00:00.000Z", authorLogin: "me", source: "local", summary: "legacy" },
      ],
    });
    const res = await run(new Map([["b1", doc("v3")]]));
    expect(res.failed).toBe(0);
    expect(await store.getVersion("b1", 1)).toEqual(doc("v2"));
  });

  test("a corrupt record starts fresh from the live doc and is counted as failed", async () => {
    await writeV1({ b1: "this is not an array" });
    const res = await run(new Map([["b1", doc("live")]]));
    expect(res.failed).toBe(1);
    const { versions } = await store.listVersions("b1");
    expect(versions).toHaveLength(1);
    expect(await store.getVersion("b1", 1)).toEqual(doc("live"));
  });

  test("renames the source file rather than deleting it", async () => {
    await writeV1({ b1: [{ id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") }] });
    await run(new Map([["b1", doc("v2")]]));
    await expect(fs.access(path.join(dir, "build-history.json.pre-v2"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dir, "build-history.json"))).rejects.toThrow();
  });

  test("is a no-op when there is nothing to migrate", async () => {
    expect(await run()).toMatchObject({ migrated: 0, failed: 0, skipped: true });
  });

  test("does not run twice", async () => {
    await writeV1({ b1: [{ id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") }] });
    await run(new Map([["b1", doc("v2")]]));
    expect(await run(new Map([["b1", doc("v2")]]))).toMatchObject({ skipped: true });
    expect((await store.listVersions("b1")).versions).toHaveLength(2);
  });

  test("migration never throws, even on unreadable input", async () => {
    await fs.writeFile(path.join(dir, "build-history.json"), "{not json", "utf8");
    await expect(run(new Map())).resolves.toMatchObject({ failed: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/unit/history/migrateV1.test.js --maxWorkers=2
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `migrateV1.js`**

- Return `{migrated: 0, failed: 0, skipped: true}` when the v1 file is absent — that is the already-migrated case and the fresh-install case.
- Read with `readJsonFile(filePath, null)` from `jsonFile.js` so a corrupt file is quarantined by the existing machinery rather than crashing.
- Per record: validate the value is an array; reverse it to oldest-first; drop entries with no `snapshot`; write `v1` as a keyframe of the oldest snapshot; then for each subsequent state call `store.appendVersion({recordId, after: nextState, author: entry.authorLogin, source: entry.source, ts: entry.timestamp})`. Coalescing must not interfere — pass the entries' real timestamps, which are far apart, and the guard from Task 4 protects `v1`.
- A record that throws is caught, counted in `failed`, its partial log unlinked, and re-seeded with a single keyframe of the live doc (or skipped entirely when there is no live doc). Log at `console.warn` with the record id.
- Rename the source file to `<fileName>.pre-v2` with `fs.rename` **only after** every record has been attempted.
- The whole function is wrapped so it can never reject.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tests/unit/history/migrateV1.test.js --maxWorkers=2
```

Expected: PASS.

- [ ] **Step 5: Write the corpus verification script**

Create `scripts/verify-history-migration.mjs`. This is the check that must be green before the feature touches a live profile — 131 real versions of real builds are a better adversary than any fixture.

```js
// Usage: node scripts/verify-history-migration.mjs [profileDataDir]
// Copies a real profile's history into a temp dir, migrates it, and asserts
// that every reconstructed version deep-equals the v1 snapshot it came from.
// Never writes to the profile it is pointed at.
```

It must:
1. Default the profile to `~/.config/axiforge-desktop/data`, overridable by argv.
2. `fs.cp` `build-history.json`, `comp-history.json`, `builds.json` and `comps.json` into a temp dir. **Never** open the originals for writing.
3. Build `liveDocs` from `builds.json` / `comps.json`.
4. Run `migrateV1`, then for every v1 entry assert `store.getVersion(recordId, mappedV)` deep-equals that entry's `snapshot`, using `node:assert/strict`'s `deepStrictEqual`.
5. Print `checked N versions across M records, 0 mismatches` and exit non-zero on any mismatch.
6. Exit 0 with a clear message when the profile has no history, so it is safe to run anywhere.

- [ ] **Step 6: Run it against the real profile**

```bash
node scripts/verify-history-migration.mjs
```

Expected: `checked 131 versions across 39 records, 0 mismatches`. **A mismatch here means the differ loses data — stop and fix Task 1 before continuing.**

- [ ] **Step 7: Commit**

```bash
git add src/main/history/migrateV1.js scripts/verify-history-migration.mjs tests/unit/history/migrateV1.test.js
git commit -m "feat(history): migrate v1 snapshot history, recomputing summaries"
```

---

### Task 6: Main-process wiring

**Files:**
- Modify: `src/main/index.js:104-120,435-437,462-467,620-650,721,729-800,827-860`
- Modify: `src/main/teamSync.js:630-646,830-850`
- Modify: `src/main/trash.js:181-184`
- Modify: `src/preload/index.js:54-58`
- Test: `tests/unit/history/wiring.test.js`, plus edits to `tests/unit/trash.test.js` and `tests/unit/teamSync.pull.test.js`

**Interfaces:**
- Consumes: the Task 4 store API and Task 5 migration
- Produces: the IPC surface the renderer uses in Tasks 7–8:
  ```js
  getBuildHistory(buildId, {limit, cursor}) → {versions, nextCursor}
  getFolderHistory(folderId, {limit})       → version[]
  getHistoryVersion(kind, recordId, v)      → doc | null      // kind: "build" | "comp"
  getHistoryOps(kind, recordId, v)          → Op[]
  revertBuild(buildId, v)                   → build
  getCompHistory(compId, {limit, cursor})   → {versions, nextCursor}
  revertComp(compId, v)                     → comp
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/history/wiring.test.js`. `index.js` is excluded from coverage and is hard to import directly, so this suite tests the extracted handler bodies. Extract the folder-feed assembly into `src/main/history/folderFeed.js` as `buildFolderFeed({folderId, folders, builds, comps, buildHistory, compHistory, limit})` and test that directly — it is the piece with real logic, and it is currently 70 lines inline in `index.js:729-790`.

```js
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { buildFolderFeed } = require("../../../src/main/history/folderFeed");
const { BuildHistoryStore } = require("../../../src/main/buildHistoryStore");
const { CompHistoryStore } = require("../../../src/main/compHistoryStore");

let dir, buildHistory, compHistory;
const T0 = Date.parse("2026-09-01T10:00:00.000Z");
const at = (m) => new Date(T0 + m * 60_000).toISOString();

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-feed-"));
  buildHistory = new BuildHistoryStore(dir);
  compHistory = new CompHistoryStore(dir);
  await buildHistory.init();
  await compHistory.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const folders = [
  { id: "root", parentId: null, name: "Raids" },
  { id: "child", parentId: "root", name: "Support" },
  { id: "other", parentId: null, name: "Elsewhere" },
];

describe("buildFolderFeed", () => {
  test("includes descendants and excludes unrelated folders", async () => {
    await buildHistory.appendVersion({ recordId: "b1", before: null, after: { id: "b1", title: "In root" }, author: "me", source: "local", ts: at(0) });
    await buildHistory.appendVersion({ recordId: "b2", before: null, after: { id: "b2", title: "In child" }, author: "me", source: "local", ts: at(1) });
    await buildHistory.appendVersion({ recordId: "b3", before: null, after: { id: "b3", title: "Elsewhere" }, author: "me", source: "local", ts: at(2) });

    const feed = await buildFolderFeed({
      folderId: "root", folders, limit: 50,
      builds: [
        { id: "b1", title: "In root", folderId: "root" },
        { id: "b2", title: "In child", folderId: "child" },
        { id: "b3", title: "Elsewhere", folderId: "other" },
      ],
      comps: [],
      buildHistory, compHistory,
    });

    expect(feed.map((e) => e.recordId).sort()).toEqual(["b1", "b2"]);
  });

  test("interleaves builds and comps newest-first", async () => {
    await buildHistory.appendVersion({ recordId: "b1", before: null, after: { id: "b1" }, author: "me", source: "local", ts: at(0) });
    await compHistory.appendVersion({ recordId: "c1", before: null, after: { id: "c1" }, author: "me", source: "local", ts: at(5) });
    await buildHistory.appendVersion({ recordId: "b1", after: { id: "b1", title: "Renamed" }, author: "me", source: "local", ts: at(90) });

    const feed = await buildFolderFeed({
      folderId: "root", folders, limit: 50,
      builds: [{ id: "b1", title: "B", folderId: "root" }],
      comps: [{ id: "c1", name: "C", folderId: "root" }],
      buildHistory, compHistory,
    });

    expect(feed.map((e) => `${e.recordKind}:${e.recordId}`)).toEqual(["build:b1", "comp:c1", "build:b1"]);
  });

  test("annotates trashed records so the panel can offer an undelete", async () => {
    await buildHistory.appendVersion({ recordId: "b1", before: null, after: { id: "b1" }, author: "me", source: "local", ts: at(0) });
    const feed = await buildFolderFeed({
      folderId: "root", folders, limit: 50,
      builds: [{ id: "b1", title: "Gone", folderId: "root", deletedAt: "2026-09-02T00:00:00.000Z" }],
      comps: [], buildHistory, compHistory,
    });
    expect(feed[0]).toMatchObject({ recordDeleted: true, recordTitle: "Gone" });
  });

  test("respects the limit", async () => {
    for (let i = 0; i < 30; i++) {
      await buildHistory.appendVersion({ recordId: "b1", ...(i === 0 ? { before: null } : {}), after: { id: "b1", title: `t${i}` }, author: "me", source: "local", ts: at(i * 90) });
    }
    const feed = await buildFolderFeed({
      folderId: "root", folders, limit: 10,
      builds: [{ id: "b1", title: "B", folderId: "root" }], comps: [], buildHistory, compHistory,
    });
    expect(feed).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/unit/history/wiring.test.js --maxWorkers=2
```

Expected: FAIL — module not found.

- [ ] **Step 3: Extract `folderFeed.js` and rewrite the handler**

Create `src/main/history/folderFeed.js` with the logic currently inline at `index.js:729-790`, changed in two ways: it collects record ids first and calls `listTails(ids, limit)` instead of `getAllHistory()`, and it renames the annotation fields to `recordId` / `recordKind` / `recordTitle` / `recordDeleted` (today's `buildTitle` / `buildDeleted` carry builds' names on comps, which the panel then has to un-confuse). Keep the existing comment about trashed builds being included on purpose — it explains a real decision.

Then in `index.js`, replace the handler body with a call to it.

- [ ] **Step 4: Rewire the save, revert and init paths**

- `index.js:435-437` — after `await buildHistoryStore.init()`, run `migrateV1` for both stores, passing `liveDocs` built from `store.listBuilds()` / `compStore.listComps()`. Log the returned counts.
- `index.js:620-650` `builds:save` — replace both `addEntry` calls with one `appendVersion({recordId: saved.id, before: existing, after: saved, author, source: "local"})` placed **after** `store.upsertBuild(build)`, because v2 logs the state after the change. Delete the separate `if (!existing)` creation branch: `appendVersion` already writes a `Created` keyframe when the log is empty. Keep `.catch()` — history must never fail a save.
- `index.js:721` `builds:get-history` — `listVersions(buildId, {limit, cursor})`.
- `index.js:827-860` `builds:revert` — take `(buildId, v)`; `const doc = await buildHistoryStore.getVersion(buildId, v)`; throw `new Error("Version not found")` when null; keep the existing trash-restore and team-enqueue behaviour verbatim; keep writing the revert's own version with `source: "revert"`. Same for `comps:revert` at `index.js:795-825`.
- Add `history:get-version` and `history:get-ops` handlers dispatching on `kind`.
- `preload/index.js:54-58` — update to the seven-method surface in the Interfaces block above.

- [ ] **Step 5: Rewire teamSync and trash**

- `teamSync.js:830-850` — `appendVersion({recordId, before: localDoc, after: incoming, author: entry.authorLogin, source: "team-sync"})`. The `isOwnWrite` guard is unchanged. Delete the `require("./buildHistoryStore")` for `summarizeBuildChange` at line 830; the store derives the summary now.
- `teamSync.js:630-646` — deletions become `appendVersion({recordId, after: lastKnownDoc, kind: "delete", source: "team-sync"})`, and the store writes a keyframe for `kind:"delete"` regardless of interval so "Bring it back" always has a doc.
- `trash.js:181-184` — unchanged call sites; `deleteHistory` now unlinks. Add an assertion to `tests/unit/trash.test.js` that the record's `.jsonl` is gone after a purge.
- Add to `tests/unit/teamSync.pull.test.js`: a remote pull writes a version with `source: "team-sync"`, and a tombstone writes a `kind:"delete"` version carrying a doc.

- [ ] **Step 6: Run the affected suites**

```bash
npx jest tests/unit/history tests/unit/trash.test.js tests/unit/teamSync --maxWorkers=2
```

Expected: PASS.

- [ ] **Step 7: Run the whole unit suite for regressions**

```bash
npx jest tests/unit --maxWorkers=2
```

Expected: PASS. Anything importing `summarizeBuildChange` or `getAllHistory` fails here — both are deleted, and those call sites need updating rather than the functions restoring.

- [ ] **Step 8: Commit**

```bash
git add src/main src/preload tests/unit
git commit -m "feat(history): wire v2 store through save, revert, sync and trash"
```

---

### Task 7: Highlight anchors in forge-render

**Files:**
- Modify: `packages/forge-render/src/mini-build-card.js`
- Test: `tests/unit/renderer/mini-build-card-anchors.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `data-*` attributes matching Task 1's op vocabulary, so `history-compare.js` can map an op to a DOM node:
  - `data-hist-slot="<slot>"` on each gear slot element
  - `data-hist-part="item|rune|infusion|sigil0|sigil1|weapon"` alongside it
  - `data-hist-skill="heal|utility1|utility2|utility3|elite"` on each skill element
  - `data-hist-spec="<lineIndex>"` on each spec line, `data-hist-trait="<lineIndex>:<tier>"` on each trait

**Additive only.** This package is also consumed by the SPA (`src/site/render-comp.js`) and by comps and the editor. Adding attributes cannot change existing behaviour — but do not rename classes, reorder elements, or change the existing markup structure.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/mini-build-card-anchors.test.js`:

```js
import { renderMiniBuildCard } from "../../../packages/forge-render/src/mini-build-card.js";

function fixture() {
  return {
    id: "b1", title: "Power Berserker", profession: "Warrior", gameMode: "pve",
    specializations: [{ id: 45, name: "Chaos", elite: false, majorChoices: { 1: 675, 2: 668, 3: 1687 }, majorTraitsByTier: {}, minorTraits: [] }],
    skills: { heal: { id: 9093, name: "Healing Signet" }, utility: [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }], elite: { id: 4, name: "D" } },
    equipment: {
      statPackage: "Berserker",
      slots: { head: "Zojja's Visage" },
      runes: { head: "Superior Rune of the Scholar" },
      weapons: { mainhand1: "Greatsword" },
      sigils: { mainhand1: ["74326", "82876"] },
      infusions: { head: "" },
    },
    tags: [],
  };
}

function parse(html) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("mini-build-card highlight anchors", () => {
  test("gear slots carry slot and part anchors", () => {
    const el = parse(renderMiniBuildCard(fixture(), null, { showActions: false }));
    expect(el.querySelector('[data-hist-slot="head"][data-hist-part="rune"]')).not.toBeNull();
    expect(el.querySelector('[data-hist-slot="head"][data-hist-part="item"]')).not.toBeNull();
  });

  test("skills carry slot anchors", () => {
    const el = parse(renderMiniBuildCard(fixture(), null, { showActions: false }));
    for (const slot of ["heal", "utility1", "utility2", "utility3", "elite"]) {
      expect(el.querySelector(`[data-hist-skill="${slot}"]`)).not.toBeNull();
    }
  });

  test("trait choices carry line:tier anchors", () => {
    const el = parse(renderMiniBuildCard(fixture(), null, { showActions: false }));
    expect(el.querySelector('[data-hist-trait="0:2"]')).not.toBeNull();
    expect(el.querySelector('[data-hist-spec="0"]')).not.toBeNull();
  });

  test("existing markup is unchanged apart from the new attributes", () => {
    const html = renderMiniBuildCard(fixture(), null, { showActions: false });
    expect(html).toContain("mini-card");
    expect(parse(html).querySelectorAll("[class]").length).toBeGreaterThan(3);
  });
});
```

This test needs the jsdom environment. Add `/** @jest-environment jsdom */` as the first line of the file — the project's default is `node`, and `tests/unit/renderer/*` files already do this; match whichever convention the neighbouring files use.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/unit/renderer/mini-build-card-anchors.test.js --maxWorkers=2
```

Expected: FAIL — the selectors find nothing.

- [ ] **Step 3: Add the attributes**

Thread them into the existing template literals in `mini-build-card.js`. Where a slot is rendered in a loop, the loop variable supplies the value; where sigils render as an array, the index supplies `sigil0` / `sigil1`.

- [ ] **Step 4: Run the test to verify it passes, and check for regressions**

```bash
npx jest tests/unit/renderer/mini-build-card-anchors.test.js --maxWorkers=2
npx jest tests/unit/renderer tests/spa --maxWorkers=2
```

Expected: PASS for both. The second command is the regression check on the SPA, which shares this package.

- [ ] **Step 5: Commit**

```bash
git add packages/forge-render/src/mini-build-card.js tests/unit/renderer/mini-build-card-anchors.test.js
git commit -m "feat(forge-render): data anchors for history diff highlighting"
```

---

### Task 8: The compare modal

**Files:**
- Create: `src/renderer/modules/library/history-compare.js`
- Modify: `src/renderer/modules/library/history-panel.js`
- Test: `tests/unit/renderer/history-compare.test.js`

**Interfaces:**
- Consumes: `getHistoryVersion` / `getHistoryOps` from Task 6, anchors from Task 7, `renderMiniBuildCard`
- Produces:
  - `showCompareModal({kind, recordId, version, title})`
  - `closeCompareModal()`
  - `renderChangeTable(ops) → string` (exported for testing)
  - `highlightOps(rootEl, ops) → void` (exported for testing)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/history-compare.test.js` (jsdom environment, as in Task 7):

```js
import { renderChangeTable, highlightOps } from "../../../src/renderer/modules/library/history-compare.js";

describe("renderChangeTable", () => {
  test("renders one row per op with before and after", () => {
    const html = renderChangeTable([
      { t: "gear", slot: "head", part: "rune", before: "Superior Rune of the Scholar", after: "Superior Rune of Durability" },
      { t: "field", path: "notes", before: "old", after: "new" },
    ]);
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.querySelectorAll("[data-hist-row]")).toHaveLength(2);
    expect(el.textContent).toContain("Superior Rune of the Scholar");
    expect(el.textContent).toContain("Superior Rune of Durability");
  });

  test("omits derived ops", () => {
    const html = renderChangeTable([
      { t: "derived", path: "skills.heal.description", before: "a", after: "b" },
      { t: "field", path: "notes", before: "a", after: "b" },
    ]);
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.querySelectorAll("[data-hist-row]")).toHaveLength(1);
  });

  test("escapes user-supplied text", () => {
    const html = renderChangeTable([
      { t: "field", path: "title", before: "<img src=x onerror=alert(1)>", after: "safe" },
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("says so when a version has nothing to show", () => {
    const el = document.createElement("div");
    el.innerHTML = renderChangeTable([]);
    expect(el.textContent).toMatch(/no changes/i);
  });
});

describe("highlightOps", () => {
  test("marks the anchored elements an op refers to", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <span data-hist-slot="head" data-hist-part="rune"></span>
      <span data-hist-slot="chest" data-hist-part="rune"></span>
      <span data-hist-skill="utility2"></span>
      <span data-hist-trait="0:2"></span>`;
    highlightOps(root, [
      { t: "gear", slot: "head", part: "rune", before: "a", after: "b" },
      { t: "skill", slot: "utility2", uw: false, before: null, after: null },
      { t: "trait", line: 0, tier: 2, before: 1, after: 2 },
    ]);
    expect(root.querySelectorAll(".hist-changed")).toHaveLength(3);
    expect(root.querySelector('[data-hist-slot="chest"]').classList.contains("hist-changed")).toBe(false);
  });

  test("an op with no matching anchor is ignored rather than throwing", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span data-hist-slot="head" data-hist-part="rune"></span>`;
    expect(() => highlightOps(root, [{ t: "gear", slot: "gloves", part: "rune", before: "a", after: "b" }])).not.toThrow();
  });

  test("underwater skill ops do not highlight the land skill of the same name", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span data-hist-skill="heal"></span>`;
    highlightOps(root, [{ t: "skill", slot: "heal", uw: true, before: null, after: null }]);
    expect(root.querySelectorAll(".hist-changed")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/unit/renderer/history-compare.test.js --maxWorkers=2
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the modal**

Follow the structure of `detail-modal.js`: an overlay element, an injected `<style>` block guarded by an id, an Escape handler, and a click-outside-to-close on the overlay. `history-panel.js` already does all four — copy its idiom rather than inventing a new one.

- **Header:** two `<select>` pickers, `Compare [vN] with [vM]`. The left defaults to the clicked version, the right to `N-1`. The right picker's first option is **Current**, then every version descending. Changing either re-fetches and re-renders.
- **Body:** two columns, each `renderMiniBuildCard(doc, state.upgradeCatalog, {showActions: false})`, then `renderChangeTable(ops)` full-width beneath. Call `highlightOps` on each column after insertion — left with `invert(ops)`, right with `ops`, so each side highlights its own changed pieces.
- `.hist-changed` gets a 1px accent outline and a subtle background, using the existing `--accent-rgb` custom property the panel already uses.
- **Footer:** a `Restore this version` button reusing the panel's existing inline-confirm flow. Its copy must name the version and say what restoring means under the new semantics — `Restore v12 (the state after "helm rune: Scholar → Durability")`.
- Escape closes the compare modal only, leaving the history panel open beneath it.
- **`highlightOps` maps op → selector:** `gear` → `[data-hist-slot="<slot>"][data-hist-part="<part>"]`; `skill` with `uw:false` → `[data-hist-skill="<slot>"]`; `skill` with `uw:true` → no anchor (the mini card does not render underwater skills, which the third test pins); `trait` → `[data-hist-trait="<line>:<tier>"]`; `spec` → `[data-hist-spec="<line>"]`; everything else → no anchor, and the change table carries it.

- [ ] **Step 4: Wire the panel**

In `history-panel.js`: entries become version-keyed (`entry.v`, not `entry.id`); the revert call passes `v`; each entry row gets a click handler opening the compare modal; `_renderFolderEntries` reads the renamed `recordTitle` / `recordKind` / `recordDeleted` fields from Task 6. Keep `_isSync()` and its comment about the legacy `shared-sync` source — old migrated entries still carry it.

- [ ] **Step 5: Run the tests**

```bash
npx jest tests/unit/renderer --maxWorkers=2
```

Expected: PASS.

- [ ] **Step 6: See it in the real app**

```bash
npm run dev
```

Open a build with history, right-click → View History, click an entry. Confirm: two cards render side by side, changed pieces are outlined on both sides, the change table lists every op, the pickers re-render, and `Restore` still works. Check a `kind:"meta"` entry (move a build between folders first) shows "moved to …" and no gear diff.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/library tests/unit/renderer/history-compare.test.js
git commit -m "feat(history): side-by-side version compare with op highlighting"
```

---

### Task 9: E2E specs

**Files:**
- Modify: `tests/e2e/specs/comp-history.spec.js`
- Create: `tests/e2e/specs/build-history-compare.spec.js`

**Interfaces:**
- Consumes: the full stack from Tasks 1–8
- Produces: nothing other code depends on

**Do not run the Playwright suite in this session.** E2E is the release gate; the dev loop is jest. Write the specs, verify they parse, and commit.

- [ ] **Step 1: Write the build-history compare spec**

Create `tests/e2e/specs/build-history-compare.spec.js` following the existing conventions in `tests/e2e/specs/comp-history.spec.js` — same fixture bootstrap, same Electron launch helper. Cover:

1. Create a build, save it, change its helm rune, save again.
2. Right-click → View History shows two entries, the newest summarised as a rune change and **not** as "build updated".
3. Clicking the newest entry opens the compare modal with two cards.
4. The changed rune is outlined in both columns (`.hist-changed`).
5. The change table has exactly one row naming both runes.
6. Switching the right picker to **Current** re-renders without error.
7. `Restore this version` returns the build to the original rune and adds a further entry whose source is `revert`.
8. Editing a build twice within the coalesce window produces one entry, not two.

- [ ] **Step 2: Extend the comp spec**

Add to `comp-history.spec.js`: a slot swap produces a `party N slot M:` summary, and the compare modal opens on a comp entry with a slot-level change table.

- [ ] **Step 3: Verify the specs parse**

```bash
npx playwright test --list tests/e2e/specs/build-history-compare.spec.js tests/e2e/specs/comp-history.spec.js
```

Expected: the test titles list without a syntax error. **This lists only — it does not run them.**

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs
git commit -m "test(history): e2e coverage for version compare and coalescing"
```

---

## Final verification

- [ ] **Full unit suite**

```bash
npx jest --maxWorkers=2
```

Expected: PASS.

- [ ] **Corpus migration check against the real profile**

```bash
node scripts/verify-history-migration.mjs
```

Expected: `checked 131 versions across 39 records, 0 mismatches`.

- [ ] **Storage check on a migrated copy**

```bash
du -sh /tmp/axiforge-migration-check/history
```

Expected: on the order of 160–220 KB, against the 2.9 MB `build-history.json` it came from. A result near or above 2.9 MB means keyframes are being written far too often — check `KEYFRAME_INTERVAL` threading and the coalescing guard.

- [ ] **Manual smoke on a copied profile before touching the live one**

Copy `~/.config/axiforge-desktop/data` to a scratch dir, point a dev run at it, and confirm the library loads, history panels open, and old entries read better than they did. Only then run against the real profile.

- [ ] The E2E suite runs at the release gate, per `feedback_e2e_is_release_only`. It is not part of this plan's verification.
