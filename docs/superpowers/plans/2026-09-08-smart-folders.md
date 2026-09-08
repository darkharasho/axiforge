# Smart Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded smart-folder branches in the library sidebar with a rule engine, seed five new built-in smart folders as rules over it, and give users a modal to build their own.

**Architecture:** A new dependency-light module `smart-folders.js` owns a pure rule evaluator (`matchesSmartFolder(sf, build, ctx)`), the built-in rule constants, and a settings-backed persistence layer. `folder-store.js` gains one `smart-rule` branch and loses its `smart-profession`/`smart-gamemode` branches, which become generated rules. `sidebar.js` renders built-ins plus the user's own; `smart-folder-modal.js` edits them.

**Tech Stack:** Electron, vanilla ES modules in the renderer, CommonJS in main, Jest + jsdom for unit tests, plain CSS with custom properties.

**Spec:** `docs/superpowers/specs/2026-09-08-smart-folders-design.md`

## Global Constraints

- **Test runner is Jest, not vitest.** Run with `npx jest --maxWorkers=2 <path>`. This machine runs heavy apps alongside dev work; unbounded workers exhaust memory.
- **Playwright E2E is release-only.** Do not run `npm run test:e2e` during this work.
- Renderer modules are **ES modules** (`import`/`export`); Jest transforms `src/renderer/**` via babel-jest, and tests `require()` them. Follow the existing pattern in `tests/unit/renderer/smart-folder-filtering.test.js`.
- Tests that touch renderer modules need `/** @jest-environment jsdom */` as the **first** line of the file. The global default is `node`.
- **`smart-folders.js` must not import from `folder-store.js`.** `folder-store.js` imports the evaluator, so the reverse import would create a cycle. Anything the evaluator needs about folders arrives through its `ctx` argument.
- The evaluator must never call `Date.now()` internally — the current time arrives as `ctx.now`. This is what makes the date operators testable.
- Every operator is **total**: unknown field, unknown operator, or malformed value evaluates to `false`, never throws.
- Existing CSS custom properties only (`--accent`, `--panel-2`, `--line-soft`, `--input-bg`, `--input-border`, `--danger-text`, `--radius-sm`, `--radius-xs`, `--hover-subtle`, `--hover-accent`, `--text-dim`, `--muted`, `--text-light`). Do not introduce new colour literals.
- Commit after every task.

---

### Task 1: Rule evaluator — build-only fields

Creates the module and the half of the vocabulary that needs nothing but the build itself.

**Files:**
- Create: `src/renderer/modules/library/smart-folders.js`
- Test: `tests/unit/renderer/smart-folder-rules.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `matchesSmartFolder(smartFolder, build, ctx) -> boolean`
  - `evaluateNode(node, build, ctx) -> boolean`
  - `FIELDS` — internal map, not exported.
  - `ctx` shape so far: `{ folders: Array, now: number }` (unused by this task's fields, but every handler receives it).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/smart-folder-rules.test.js`:

```js
/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: { builds: [], folders: [], comps: [], currentFolder: null },
}));

const {
  matchesSmartFolder,
} = require("../../../src/renderer/modules/library/smart-folders");

const CTX = { folders: [], now: Date.parse("2026-09-08T00:00:00Z") };

function sf(children, match = "all") {
  return { id: "sf-test", name: "Test", rule: { type: "group", match, children } };
}
function cond(field, op, value) {
  return { type: "condition", field, op, value };
}
function build(overrides = {}) {
  return {
    id: "b1",
    title: "Zerg Firebrand",
    profession: "Guardian",
    gameMode: "wvw",
    tags: ["wvw", "support"],
    notes: "boonball",
    pinned: false,
    folderId: null,
    specializations: [
      { name: "Honor", elite: false },
      { name: "Firebrand", elite: true },
    ],
    updatedAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("group semantics", () => {
  test("empty conditions match everything — the Main Repository case", () => {
    expect(matchesSmartFolder(sf([]), build(), CTX)).toBe(true);
  });

  test("match:all requires every condition", () => {
    const rule = sf([
      cond("profession", "isAnyOf", ["Guardian"]),
      cond("gameMode", "isAnyOf", ["pve"]),
    ]);
    expect(matchesSmartFolder(rule, build(), CTX)).toBe(false);
  });

  test("match:any requires only one condition", () => {
    const rule = sf(
      [cond("profession", "isAnyOf", ["Guardian"]), cond("gameMode", "isAnyOf", ["pve"])],
      "any",
    );
    expect(matchesSmartFolder(rule, build(), CTX)).toBe(true);
  });

  test("recurses into nested groups the editor cannot yet produce", () => {
    const rule = sf([
      cond("profession", "isAnyOf", ["Guardian"]),
      {
        type: "group",
        match: "any",
        children: [cond("gameMode", "isAnyOf", ["pve"]), cond("gameMode", "isAnyOf", ["wvw"])],
      },
    ]);
    expect(matchesSmartFolder(rule, build(), CTX)).toBe(true);
  });
});

describe("totality", () => {
  test("unknown field is false, not a throw", () => {
    expect(matchesSmartFolder(sf([cond("nope", "isAnyOf", ["x"])]), build(), CTX)).toBe(false);
  });

  test("unknown operator is false, not a throw", () => {
    expect(matchesSmartFolder(sf([cond("profession", "nope", ["x"])]), build(), CTX)).toBe(false);
  });

  test("malformed value is false, not a throw", () => {
    expect(matchesSmartFolder(sf([cond("profession", "isAnyOf", null)]), build(), CTX)).toBe(false);
  });

  test("a smart folder with no rule matches nothing", () => {
    expect(matchesSmartFolder({ id: "x", name: "x" }, build(), CTX)).toBe(false);
  });
});

describe("profession / gameMode", () => {
  test("isAnyOf matches", () => {
    expect(matchesSmartFolder(sf([cond("profession", "isAnyOf", ["Guardian", "Warrior"])]), build(), CTX)).toBe(true);
  });

  test("isNoneOf excludes", () => {
    expect(matchesSmartFolder(sf([cond("profession", "isNoneOf", ["Guardian"])]), build(), CTX)).toBe(false);
  });

  test("missing gameMode is treated as pve", () => {
    const b = build({ gameMode: "" });
    expect(matchesSmartFolder(sf([cond("gameMode", "isAnyOf", ["pve"])]), b, CTX)).toBe(true);
  });
});

describe("eliteSpec", () => {
  test("matches the elite specialization", () => {
    expect(matchesSmartFolder(sf([cond("eliteSpec", "isAnyOf", ["Firebrand"])]), build(), CTX)).toBe(true);
  });

  test("does not match a non-elite specialization line", () => {
    expect(matchesSmartFolder(sf([cond("eliteSpec", "isAnyOf", ["Honor"])]), build(), CTX)).toBe(false);
  });

  test("a build with no elite spec matches isNoneOf", () => {
    const b = build({ specializations: [{ name: "Honor", elite: false }] });
    expect(matchesSmartFolder(sf([cond("eliteSpec", "isNoneOf", ["Firebrand"])]), b, CTX)).toBe(true);
  });
});

describe("tags", () => {
  test("hasAnyOf", () => {
    expect(matchesSmartFolder(sf([cond("tags", "hasAnyOf", ["support", "dps"])]), build(), CTX)).toBe(true);
  });

  test("hasAllOf requires all", () => {
    expect(matchesSmartFolder(sf([cond("tags", "hasAllOf", ["wvw", "dps"])]), build(), CTX)).toBe(false);
  });

  test("hasNoneOf excludes", () => {
    expect(matchesSmartFolder(sf([cond("tags", "hasNoneOf", ["support"])]), build(), CTX)).toBe(false);
  });

  test("isEmpty is true for a missing tags array", () => {
    const b = build({ tags: undefined });
    expect(matchesSmartFolder(sf([cond("tags", "isEmpty")]), b, CTX)).toBe(true);
  });

  test("isEmpty is true for a zero-length tags array", () => {
    expect(matchesSmartFolder(sf([cond("tags", "isEmpty")]), build({ tags: [] }), CTX)).toBe(true);
  });

  test("isNotEmpty is the negation", () => {
    expect(matchesSmartFolder(sf([cond("tags", "isNotEmpty")]), build(), CTX)).toBe(true);
  });
});

describe("title / notes", () => {
  test("contains is case-insensitive", () => {
    expect(matchesSmartFolder(sf([cond("title", "contains", "ZERG")]), build(), CTX)).toBe(true);
  });

  test("notContains excludes", () => {
    expect(matchesSmartFolder(sf([cond("notes", "notContains", "boon")]), build(), CTX)).toBe(false);
  });

  test("an empty search string matches everything", () => {
    expect(matchesSmartFolder(sf([cond("title", "contains", "")]), build(), CTX)).toBe(true);
  });
});

describe("pinned", () => {
  test("isTrue", () => {
    expect(matchesSmartFolder(sf([cond("pinned", "isTrue")]), build({ pinned: true }), CTX)).toBe(true);
  });

  test("isFalse treats a missing flag as not pinned", () => {
    expect(matchesSmartFolder(sf([cond("pinned", "isFalse")]), build({ pinned: undefined }), CTX)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-rules.test.js`
Expected: FAIL — "Cannot find module '.../library/smart-folders'"

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/modules/library/smart-folders.js`:

```js
/**
 * Smart folders: a rule over the library, evaluated per build.
 *
 * The evaluator is pure on purpose. Everything it needs about the world --
 * the folder tree, the current time -- arrives in `ctx`, so it can be tested
 * against plain objects with no DOM and no clock, and so the live "N builds
 * match" count in the editor is a synchronous array filter.
 *
 * This module must NOT import from folder-store.js: folder-store imports the
 * evaluator, and the reverse import would close a cycle.
 */

/** Values that arrive from persisted JSON, so nothing here may assume a shape. */
const asArray = (v) => (Array.isArray(v) ? v : null);
const asString = (v) => (typeof v === "string" ? v : null);

const lower = (v) => String(v ?? "").toLowerCase();

/** The elite specialization line, or "" when the build has none. */
function eliteSpecOf(build) {
  for (const s of build.specializations || []) {
    if (s && s.elite && s.name) return s.name;
  }
  return "";
}

/** isAnyOf / isNoneOf over a single scalar. */
const SCALAR_OPS = {
  isAnyOf: (val, value) => {
    const values = asArray(value);
    return values ? values.includes(val) : false;
  },
  isNoneOf: (val, value) => {
    const values = asArray(value);
    return values ? !values.includes(val) : false;
  },
};

/** contains / notContains over a string, case-insensitively. */
const TEXT_OPS = {
  contains: (val, value) => {
    const needle = asString(value);
    return needle === null ? false : lower(val).includes(needle.toLowerCase());
  },
  notContains: (val, value) => {
    const needle = asString(value);
    return needle === null ? false : !lower(val).includes(needle.toLowerCase());
  },
};

const TAG_OPS = {
  hasAnyOf: (tags, value) => {
    const values = asArray(value);
    return values ? values.some((t) => tags.includes(t)) : false;
  },
  hasAllOf: (tags, value) => {
    const values = asArray(value);
    return values ? values.every((t) => tags.includes(t)) : false;
  },
  hasNoneOf: (tags, value) => {
    const values = asArray(value);
    return values ? !values.some((t) => tags.includes(t)) : false;
  },
  isEmpty: (tags) => tags.length === 0,
  isNotEmpty: (tags) => tags.length > 0,
};

const BOOL_OPS = {
  isTrue: (val) => val === true,
  isFalse: (val) => val !== true,
};

/**
 * field -> { get(build, ctx), ops }.
 * Each op is `(extractedValue, conditionValue, build, ctx) => boolean`.
 */
const FIELDS = {
  profession: { get: (b) => b.profession || "", ops: SCALAR_OPS },
  eliteSpec: { get: (b) => eliteSpecOf(b), ops: SCALAR_OPS },
  gameMode: { get: (b) => b.gameMode || "pve", ops: SCALAR_OPS },
  tags: { get: (b) => (Array.isArray(b.tags) ? b.tags : []), ops: TAG_OPS },
  title: { get: (b) => b.title || "", ops: TEXT_OPS },
  notes: { get: (b) => b.notes || "", ops: TEXT_OPS },
  pinned: { get: (b) => b.pinned === true, ops: BOOL_OPS },
};

function evaluateCondition(node, build, ctx) {
  const field = FIELDS[node.field];
  if (!field) return false;
  const op = field.ops[node.op];
  if (typeof op !== "function") return false;
  try {
    return op(field.get(build, ctx), node.value, build, ctx) === true;
  } catch {
    return false;
  }
}

/** Recurse on groups, dispatch on conditions. Anything else is false. */
export function evaluateNode(node, build, ctx) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "group") {
    const children = Array.isArray(node.children) ? node.children : [];
    // No conditions means no constraint -- this is how Main Repository works.
    if (children.length === 0) return true;
    return node.match === "any"
      ? children.some((c) => evaluateNode(c, build, ctx))
      : children.every((c) => evaluateNode(c, build, ctx));
  }
  if (node.type === "condition") return evaluateCondition(node, build, ctx);
  return false;
}

/** Does this build belong in this smart folder? @param ctx {{folders, now}} */
export function matchesSmartFolder(smartFolder, build, ctx) {
  if (!smartFolder || !smartFolder.rule || !build) return false;
  return evaluateNode(smartFolder.rule, build, ctx);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-rules.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/library/smart-folders.js tests/unit/renderer/smart-folder-rules.test.js
git commit -m "feat(library): pure rule evaluator for smart folders"
```

---

### Task 2: Rule evaluator — context-dependent fields

Adds the fields that need the folder tree or the clock: `location`, `ownership`, `team`, `updatedAt`, `createdAt`. These are what make `Shared with me`, `Unfiled`, and `Recently Modified` expressible.

**Files:**
- Modify: `src/renderer/modules/library/smart-folders.js`
- Modify: `tests/unit/renderer/smart-folder-rules.test.js`

**Interfaces:**
- Consumes: `FIELDS`, `SCALAR_OPS`, `evaluateNode` from Task 1.
- Produces: `ruleContext() -> { folders: Array, now: number }` — the live context built from `state`, used by every caller outside tests.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/renderer/smart-folder-rules.test.js`:

```js
describe("location", () => {
  const FOLDERS = [
    { id: "f-root", name: "wvw", parentId: null },
    { id: "f-child", name: "zerg", parentId: "f-root" },
    { id: "f-other", name: "raids", parentId: null },
  ];
  const ctx = { folders: FOLDERS, now: CTX.now };

  test("isUnfiled matches a build with no folder", () => {
    expect(matchesSmartFolder(sf([cond("location", "isUnfiled")]), build({ folderId: null }), ctx)).toBe(true);
  });

  test("isUnfiled does not match a filed build", () => {
    expect(matchesSmartFolder(sf([cond("location", "isUnfiled")]), build({ folderId: "f-root" }), ctx)).toBe(false);
  });

  test("inFolder matches the folder itself", () => {
    expect(matchesSmartFolder(sf([cond("location", "inFolder", "f-root")]), build({ folderId: "f-root" }), ctx)).toBe(true);
  });

  test("inFolder includes subfolders", () => {
    expect(matchesSmartFolder(sf([cond("location", "inFolder", "f-root")]), build({ folderId: "f-child" }), ctx)).toBe(true);
  });

  test("inFolder excludes a sibling tree", () => {
    expect(matchesSmartFolder(sf([cond("location", "inFolder", "f-root")]), build({ folderId: "f-other" }), ctx)).toBe(false);
  });

  test("notInFolder is the exact negation, so an unfiled build satisfies it", () => {
    expect(matchesSmartFolder(sf([cond("location", "notInFolder", "f-root")]), build({ folderId: null }), ctx)).toBe(true);
  });

  test("a rule pointing at a deleted folder matches nothing instead of throwing", () => {
    expect(matchesSmartFolder(sf([cond("location", "inFolder", "f-gone")]), build({ folderId: "f-root" }), ctx)).toBe(false);
  });
});

describe("ownership / team", () => {
  const FOLDERS = [
    { id: "t-mine", name: "My Team", parentId: null, teamId: "team-a", shared: true, role: "owner" },
    { id: "t-theirs", name: "Their Team", parentId: null, teamId: "team-b", shared: true, role: "member" },
    { id: "t-theirs-sub", name: "wvw", parentId: "t-theirs" },
    { id: "f-plain", name: "personal", parentId: null },
  ];
  const ctx = { folders: FOLDERS, now: CTX.now };

  test("sharedWithMe matches a build under a team the user does not own", () => {
    const rule = sf([cond("ownership", "is", "sharedWithMe")]);
    expect(matchesSmartFolder(rule, build({ folderId: "t-theirs" }), ctx)).toBe(true);
  });

  test("sharedWithMe reaches through subfolders of a team root", () => {
    const rule = sf([cond("ownership", "is", "sharedWithMe")]);
    expect(matchesSmartFolder(rule, build({ folderId: "t-theirs-sub" }), ctx)).toBe(true);
  });

  test("a team the user owns is theirs, not shared with them", () => {
    const rule = sf([cond("ownership", "is", "sharedWithMe")]);
    expect(matchesSmartFolder(rule, build({ folderId: "t-mine" }), ctx)).toBe(false);
  });

  test("mine covers both unfiled builds and owned teams", () => {
    const rule = sf([cond("ownership", "is", "mine")]);
    expect(matchesSmartFolder(rule, build({ folderId: null }), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, build({ folderId: "f-plain" }), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, build({ folderId: "t-mine" }), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, build({ folderId: "t-theirs" }), ctx)).toBe(false);
  });

  test("team isAnyOf matches by team id", () => {
    const rule = sf([cond("team", "isAnyOf", ["team-b"])]);
    expect(matchesSmartFolder(rule, build({ folderId: "t-theirs-sub" }), ctx)).toBe(true);
    expect(matchesSmartFolder(rule, build({ folderId: "t-mine" }), ctx)).toBe(false);
  });

  test("an unknown ownership value matches nothing", () => {
    const rule = sf([cond("ownership", "is", "somebody-else")]);
    expect(matchesSmartFolder(rule, build({ folderId: null }), ctx)).toBe(false);
  });
});

describe("dates", () => {
  const now = Date.parse("2026-09-08T00:00:00Z");
  const ctx = { folders: [], now };

  test("withinDays matches a recent timestamp", () => {
    const b = build({ updatedAt: "2026-09-01T00:00:00Z" });
    expect(matchesSmartFolder(sf([cond("updatedAt", "withinDays", 14)]), b, ctx)).toBe(true);
  });

  test("withinDays excludes an older timestamp", () => {
    const b = build({ updatedAt: "2026-01-01T00:00:00Z" });
    expect(matchesSmartFolder(sf([cond("updatedAt", "withinDays", 14)]), b, ctx)).toBe(false);
  });

  test("olderThanDays is the complement for records that have a timestamp", () => {
    const b = build({ createdAt: "2026-01-01T00:00:00Z" });
    expect(matchesSmartFolder(sf([cond("createdAt", "olderThanDays", 14)]), b, ctx)).toBe(true);
  });

  test("a record with no timestamp matches neither operator", () => {
    const b = build({ updatedAt: undefined });
    expect(matchesSmartFolder(sf([cond("updatedAt", "withinDays", 14)]), b, ctx)).toBe(false);
    expect(matchesSmartFolder(sf([cond("updatedAt", "olderThanDays", 14)]), b, ctx)).toBe(false);
  });

  test("an unparseable timestamp matches neither operator", () => {
    const b = build({ updatedAt: "not a date" });
    expect(matchesSmartFolder(sf([cond("updatedAt", "withinDays", 14)]), b, ctx)).toBe(false);
    expect(matchesSmartFolder(sf([cond("updatedAt", "olderThanDays", 14)]), b, ctx)).toBe(false);
  });

  test("a non-numeric day count matches nothing", () => {
    expect(matchesSmartFolder(sf([cond("updatedAt", "withinDays", "soon")]), build(), ctx)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-rules.test.js`
Expected: FAIL — the new describes fail because `location`, `ownership`, `team`, `updatedAt`, `createdAt` are not in `FIELDS`, so every condition returns `false`.

- [ ] **Step 3: Write minimal implementation**

In `src/renderer/modules/library/smart-folders.js`, add these imports at the very top of the file:

```js
import { state } from "../state.js";
import { teamRootFor } from "../teams.js";
```

Add these helpers immediately after the `eliteSpecOf` function:

```js
/**
 * The folder plus every folder beneath it, as a Set of ids.
 *
 * folder-store.js has its own copy of this walk, but importing it here would
 * close an import cycle (folder-store -> smart-folders -> folder-store), and
 * this version reads the tree out of `ctx` rather than out of `state` so the
 * evaluator stays pure.
 */
function subtreeIds(folderId, folders) {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f && f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Milliseconds since epoch, or null when the stamp is missing or unparseable. */
function timestampMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

const DAY_MS = 86400000;

const DATE_OPS = {
  withinDays: (ms, value, _build, ctx) => {
    if (ms === null || typeof value !== "number" || !Number.isFinite(value)) return false;
    return ctx.now - ms <= value * DAY_MS;
  },
  olderThanDays: (ms, value, _build, ctx) => {
    if (ms === null || typeof value !== "number" || !Number.isFinite(value)) return false;
    return ctx.now - ms > value * DAY_MS;
  },
};

const LOCATION_OPS = {
  isUnfiled: (folderId) => !folderId,
  inFolder: (folderId, value, _build, ctx) => {
    const target = asString(value);
    if (!target || !folderId) return false;
    return subtreeIds(target, ctx.folders || []).has(folderId);
  },
  // The exact negation of inFolder, so an unfiled build satisfies it.
  notInFolder: (folderId, value, build, ctx) =>
    !LOCATION_OPS.inFolder(folderId, value, build, ctx),
};

const OWNERSHIP_OPS = {
  is: (ownership, value) => {
    const want = asString(value);
    if (want !== "mine" && want !== "sharedWithMe") return false;
    return ownership === want;
  },
};
```

Then extend the `FIELDS` map with the five new entries:

```js
const FIELDS = {
  profession: { get: (b) => b.profession || "", ops: SCALAR_OPS },
  eliteSpec: { get: (b) => eliteSpecOf(b), ops: SCALAR_OPS },
  gameMode: { get: (b) => b.gameMode || "pve", ops: SCALAR_OPS },
  tags: { get: (b) => (Array.isArray(b.tags) ? b.tags : []), ops: TAG_OPS },
  title: { get: (b) => b.title || "", ops: TEXT_OPS },
  notes: { get: (b) => b.notes || "", ops: TEXT_OPS },
  pinned: { get: (b) => b.pinned === true, ops: BOOL_OPS },
  location: { get: (b) => b.folderId || null, ops: LOCATION_OPS },
  // "Shared with me" means: it sits under a team root somebody else owns.
  ownership: {
    get: (b, ctx) => {
      const root = teamRootFor(b.folderId, ctx.folders || []);
      return root && root.role !== "owner" ? "sharedWithMe" : "mine";
    },
    ops: OWNERSHIP_OPS,
  },
  team: {
    get: (b, ctx) => teamRootFor(b.folderId, ctx.folders || [])?.teamId || "",
    ops: SCALAR_OPS,
  },
  updatedAt: { get: (b) => timestampMs(b.updatedAt), ops: DATE_OPS },
  createdAt: { get: (b) => timestampMs(b.createdAt), ops: DATE_OPS },
};
```

Finally, append the live-context helper at the end of the file:

```js
/**
 * The evaluation context for the running app. Tests build their own instead,
 * which is the whole reason `now` is a value here rather than a Date.now()
 * call inside the operators.
 */
export function ruleContext() {
  return { folders: state.folders || [], now: Date.now() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-rules.test.js`
Expected: PASS — including the Task 1 tests, which must not regress.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/library/smart-folders.js tests/unit/renderer/smart-folder-rules.test.js
git commit -m "feat(library): location, ownership, team and date rule fields"
```

---

### Task 3: Built-in rules and the persistence layer

Seeds the five built-ins and gives the sidebar a synchronous `listSmartFolders()` to render from.

**Files:**
- Modify: `src/renderer/modules/library/smart-folders.js`
- Test: `tests/unit/renderer/smart-folder-store.test.js`

**Interfaces:**
- Consumes: `matchesSmartFolder`, `ruleContext` from Tasks 1–2.
- Produces:
  - `BUILTIN_SMART_FOLDERS` — frozen array of smart folder records, each with `builtin: true`.
  - `loadSmartFolders() -> Promise<void>` — reads settings into the module cache. Called once at library init.
  - `listSmartFolders() -> Array` — **synchronous**; built-ins (minus hidden) followed by user folders.
  - `getSmartFolder(id) -> object | null` — resolves hidden built-ins too.
  - `saveSmartFolder(sf) -> Promise<object>` — creates when `sf.id` is absent, updates otherwise; returns the saved record.
  - `deleteSmartFolder(id) -> Promise<void>`
  - `setBuiltinHidden(id, hidden) -> Promise<void>`

`listSmartFolders()` is synchronous because `renderSidebar()` is synchronous. The cache is what makes that possible.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/smart-folder-store.test.js`:

```js
/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: { builds: [], folders: [], comps: [], currentFolder: null },
}));

const mod = require("../../../src/renderer/modules/library/smart-folders");
const {
  BUILTIN_SMART_FOLDERS,
  loadSmartFolders,
  listSmartFolders,
  getSmartFolder,
  saveSmartFolder,
  deleteSmartFolder,
  setBuiltinHidden,
} = mod;

let settings;

beforeEach(async () => {
  settings = {};
  global.window.desktopApi = {
    getSetting: jest.fn(async (k) => (k in settings ? settings[k] : null)),
    setSetting: jest.fn(async (k, v) => {
      settings[k] = v;
    }),
  };
  await loadSmartFolders();
});

describe("built-ins", () => {
  test("ships the five seeded rules", () => {
    const ids = BUILTIN_SMART_FOLDERS.map((f) => f.id);
    expect(ids).toEqual([
      "__sf-main",
      "__sf-recent",
      "__sf-shared",
      "__sf-unfiled",
      "__sf-untagged",
    ]);
  });

  test("Main Repository has no conditions, so it matches everything", () => {
    const main = BUILTIN_SMART_FOLDERS.find((f) => f.id === "__sf-main");
    expect(main.rule.children).toEqual([]);
  });

  test("every built-in is flagged builtin", () => {
    expect(BUILTIN_SMART_FOLDERS.every((f) => f.builtin === true)).toBe(true);
  });

  test("listSmartFolders returns them with no user data present", () => {
    expect(listSmartFolders().map((f) => f.id)).toEqual(BUILTIN_SMART_FOLDERS.map((f) => f.id));
  });
});

describe("user smart folders", () => {
  test("save assigns an id and persists", async () => {
    const saved = await saveSmartFolder({ name: "Mine", rule: { type: "group", match: "all", children: [] } });
    expect(saved.id).toMatch(/^sf_/);
    expect(settings["library.smartFolders"]).toHaveLength(1);
    expect(listSmartFolders().map((f) => f.name)).toContain("Mine");
  });

  test("save with an existing id updates in place rather than appending", async () => {
    const saved = await saveSmartFolder({ name: "Mine", rule: { type: "group", match: "all", children: [] } });
    await saveSmartFolder({ ...saved, name: "Renamed" });
    expect(settings["library.smartFolders"]).toHaveLength(1);
    expect(getSmartFolder(saved.id).name).toBe("Renamed");
  });

  test("user folders sort after built-ins", async () => {
    await saveSmartFolder({ name: "Mine", rule: { type: "group", match: "all", children: [] } });
    const list = listSmartFolders();
    expect(list[list.length - 1].name).toBe("Mine");
  });

  test("delete removes it", async () => {
    const saved = await saveSmartFolder({ name: "Mine", rule: { type: "group", match: "all", children: [] } });
    await deleteSmartFolder(saved.id);
    expect(listSmartFolders().map((f) => f.id)).not.toContain(saved.id);
    expect(settings["library.smartFolders"]).toEqual([]);
  });
});

describe("hiding built-ins", () => {
  test("a hidden built-in drops out of the list", async () => {
    await setBuiltinHidden("__sf-untagged", true);
    expect(listSmartFolders().map((f) => f.id)).not.toContain("__sf-untagged");
  });

  test("but is still resolvable by id, so a stale navigation can recover", async () => {
    await setBuiltinHidden("__sf-untagged", true);
    expect(getSmartFolder("__sf-untagged")).toBeTruthy();
  });

  test("unhiding restores it", async () => {
    await setBuiltinHidden("__sf-untagged", true);
    await setBuiltinHidden("__sf-untagged", false);
    expect(listSmartFolders().map((f) => f.id)).toContain("__sf-untagged");
  });

  test("only hidden ids are persisted — no dead sort order", async () => {
    await setBuiltinHidden("__sf-untagged", true);
    expect(settings["library.smartFolderOverrides"]).toEqual({ hidden: ["__sf-untagged"] });
  });
});

describe("corrupt settings degrade instead of breaking the library", () => {
  test("a non-array smartFolders setting falls back to built-ins only", async () => {
    settings["library.smartFolders"] = "not an array";
    await loadSmartFolders();
    expect(listSmartFolders().map((f) => f.id)).toEqual(BUILTIN_SMART_FOLDERS.map((f) => f.id));
  });

  test("malformed entries are dropped and valid ones survive", async () => {
    settings["library.smartFolders"] = [
      null,
      { name: "no id" },
      { id: "sf_ok", name: "Good", rule: { type: "group", match: "all", children: [] } },
    ];
    await loadSmartFolders();
    const ids = listSmartFolders().map((f) => f.id);
    expect(ids).toContain("sf_ok");
    expect(ids).toHaveLength(BUILTIN_SMART_FOLDERS.length + 1);
  });

  test("a getSetting rejection still leaves the built-ins usable", async () => {
    global.window.desktopApi.getSetting = jest.fn(async () => {
      throw new Error("no settings store");
    });
    await loadSmartFolders();
    expect(listSmartFolders().map((f) => f.id)).toEqual(BUILTIN_SMART_FOLDERS.map((f) => f.id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-store.test.js`
Expected: FAIL — "BUILTIN_SMART_FOLDERS is not defined" / `loadSmartFolders is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/renderer/modules/library/smart-folders.js`:

```js
// ─── Built-ins ─────────────────────────────────────────────────────────────────

const group = (children, match = "all") => ({ type: "group", match, children });
const when = (field, op, value) => ({ type: "condition", field, op, value });

/**
 * Built-ins are code, not persisted rows. That way improving one of these
 * rules in a later release reaches everybody -- the only thing we persist
 * about them is which ones the user has hidden.
 */
export const BUILTIN_SMART_FOLDERS = Object.freeze([
  { id: "__sf-main", name: "Main Repository", icon: "folderOpen", builtin: true, rule: group([]) },
  { id: "__sf-recent", name: "Recently Modified", icon: "clock", builtin: true, rule: group([when("updatedAt", "withinDays", 14)]) },
  { id: "__sf-shared", name: "Shared with me", icon: "share", builtin: true, rule: group([when("ownership", "is", "sharedWithMe")]) },
  { id: "__sf-unfiled", name: "Unfiled", icon: "bars", builtin: true, rule: group([when("location", "isUnfiled")]) },
  { id: "__sf-untagged", name: "Untagged", icon: "tag", builtin: true, rule: group([when("tags", "isEmpty")]) },
]);

// ─── Persistence ───────────────────────────────────────────────────────────────

const SETTING_FOLDERS = "library.smartFolders";
const SETTING_OVERRIDES = "library.smartFolderOverrides";

// The sidebar renders synchronously, so the persisted state is cached here and
// listSmartFolders() reads the cache rather than awaiting the settings store.
let _userFolders = [];
let _hidden = new Set();

/** A record is usable only if we can address it and evaluate it. */
function isWellFormed(sf) {
  return Boolean(
    sf && typeof sf === "object" && typeof sf.id === "string" && sf.id && sf.rule && typeof sf.rule === "object",
  );
}

/** Read persisted smart folders into the cache. Safe to call more than once. */
export async function loadSmartFolders() {
  _userFolders = [];
  _hidden = new Set();
  try {
    const raw = await window.desktopApi.getSetting(SETTING_FOLDERS);
    if (Array.isArray(raw)) _userFolders = raw.filter(isWellFormed);
  } catch {
    // A library that opens with only the built-ins beats one that does not open.
  }
  try {
    const raw = await window.desktopApi.getSetting(SETTING_OVERRIDES);
    if (raw && Array.isArray(raw.hidden)) _hidden = new Set(raw.hidden.filter((id) => typeof id === "string"));
  } catch {
    // Same.
  }
}

async function persistFolders() {
  try {
    await window.desktopApi.setSetting(SETTING_FOLDERS, _userFolders);
  } catch {
    // Caller surfaces the failure; the in-memory list stays usable this session.
  }
}

async function persistOverrides() {
  try {
    await window.desktopApi.setSetting(SETTING_OVERRIDES, { hidden: [..._hidden] });
  } catch {
    // Same.
  }
}

/** Built-ins the user has not hidden, then their own, in creation order. */
export function listSmartFolders() {
  return [...BUILTIN_SMART_FOLDERS.filter((f) => !_hidden.has(f.id)), ..._userFolders];
}

/** Resolve by id, including built-ins the user has hidden. */
export function getSmartFolder(id) {
  return (
    BUILTIN_SMART_FOLDERS.find((f) => f.id === id) || _userFolders.find((f) => f.id === id) || null
  );
}

function newId() {
  return `sf_${Math.random().toString(36).slice(2, 10)}`;
}

/** Create when `sf.id` is absent, update in place otherwise. */
export async function saveSmartFolder(sf) {
  const record = { ...sf, id: sf.id || newId(), builtin: false };
  const at = _userFolders.findIndex((f) => f.id === record.id);
  if (at >= 0) _userFolders[at] = record;
  else _userFolders.push(record);
  await persistFolders();
  return record;
}

export async function deleteSmartFolder(id) {
  _userFolders = _userFolders.filter((f) => f.id !== id);
  await persistFolders();
}

export async function setBuiltinHidden(id, hidden) {
  if (hidden) _hidden.add(id);
  else _hidden.delete(id);
  await persistOverrides();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-store.test.js tests/unit/renderer/smart-folder-rules.test.js`
Expected: PASS — both suites.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/library/smart-folders.js tests/unit/renderer/smart-folder-store.test.js
git commit -m "feat(library): built-in smart folder rules and settings persistence"
```

---

### Task 4: Wire the engine into folder-store

The behaviour-preserving core of the change: `smart-rule` starts working, and `smart-profession`/`smart-gamemode` are re-expressed as generated rules. The existing test file is the regression guard — it must keep passing untouched.

**Files:**
- Modify: `src/renderer/modules/library/folder-store.js:154-239` (`getVisibleBuilds`), `:244-279` (`getVisibleFolders`), `:293-325` (`getVisibleComps`)
- Modify: `src/renderer/modules/library/content.js:252-259` (`isCombinedView`)
- Modify: `tests/unit/renderer/smart-folder-filtering.test.js` (add cases; **do not alter the existing ones**)

**Interfaces:**
- Consumes: `matchesSmartFolder`, `ruleContext`, `getSmartFolder` from Tasks 1–3.
- Produces: a navigation folder shape `{ type: "smart-rule", id: string, smartFolder: object }` that Task 5 dispatches and Task 6 edits.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/renderer/smart-folder-filtering.test.js`:

```js
describe("getVisibleBuilds — smart-rule folder", () => {
  function ruleFolder(children, match = "all") {
    return {
      type: "smart-rule",
      id: "sf-test",
      smartFolder: { id: "sf-test", name: "Test", rule: { type: "group", match, children } },
    };
  }

  test("filters by the rule", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian" }),
      makeBuild({ id: "w1", profession: "Warrior" }),
    ];
    state.currentFolder = ruleFolder([
      { type: "condition", field: "profession", op: "isAnyOf", value: ["Guardian"] },
    ]);

    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["g1"]);
  });

  test("a rule with no conditions shows every build, filed or not — Main Repository", () => {
    state.builds = [
      makeBuild({ id: "b1", folderId: null }),
      makeBuild({ id: "b2", folderId: "folder-1" }),
    ];
    state.folders = [{ id: "folder-1", name: "wvw", parentId: null, sortOrder: 0 }];
    state.currentFolder = ruleFolder([]);

    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  test("this is what distinguishes Main Repository from All Builds", () => {
    state.builds = [
      makeBuild({ id: "b1", folderId: null }),
      makeBuild({ id: "b2", folderId: "folder-1" }),
    ];
    state.folders = [{ id: "folder-1", name: "wvw", parentId: null, sortOrder: 0 }];

    state.currentFolder = { type: "all" };
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["b1"]);

    state.currentFolder = ruleFolder([]);
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  test("archived builds stay out", () => {
    state.builds = [
      makeBuild({ id: "b1" }),
      makeBuild({ id: "b2", archivedAt: "2026-01-01T00:00:00Z" }),
    ];
    state.currentFolder = ruleFolder([]);

    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["b1"]);
  });

  test("the search box narrows within a smart folder", () => {
    state.builds = [
      makeBuild({ id: "b1", title: "Zerg Firebrand" }),
      makeBuild({ id: "b2", title: "Roaming Willbender" }),
    ];
    state.currentFolder = ruleFolder([]);
    state.buildSearch = "zerg";

    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["b1"]);
  });

  test("toolbar filters still apply on top of the rule", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian", gameMode: "wvw" }),
      makeBuild({ id: "g2", profession: "Guardian", gameMode: "pve" }),
    ];
    state.currentFolder = ruleFolder([
      { type: "condition", field: "profession", op: "isAnyOf", value: ["Guardian"] },
    ]);
    state.libraryPrefs.activeFilters = { gameModes: ["wvw"] };

    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["g1"]);
  });

  test("shows no sub-folders and no comps, like every other smart folder", () => {
    state.builds = [makeBuild({ id: "b1" })];
    state.folders = [{ id: "folder-1", name: "wvw", parentId: null, sortOrder: 0 }];
    state.comps = [{ id: "comp-1", name: "Comp", buildIds: [] }];
    state.currentFolder = ruleFolder([]);

    expect(getVisibleFolders()).toEqual([]);
    expect(getVisibleComps()).toEqual([]);
  });
});
```

Also add `getVisibleFolders` to the `require` destructure at the top of that file:

```js
const {
  getVisibleBuilds,
  getVisibleComps,
  getVisibleFolders,
} = require("../../../src/renderer/modules/library/folder-store");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-filtering.test.js`
Expected: FAIL — the `smart-rule` cases fall through to the final `else`, so with no `folderId` filter applied the results are wrong (e.g. `["g1","w1"]` instead of `["g1"]`).

- [ ] **Step 3: Write minimal implementation**

In `src/renderer/modules/library/folder-store.js`, add to the imports at the top:

```js
import { matchesSmartFolder, ruleContext } from "./smart-folders.js";
```

Replace the `smart-profession` / `smart-gamemode` branches in `getVisibleBuilds()` with a single `smart-rule` branch:

```js
    } else if (folder.id === "__all-comps") {
      // "All Comps" smart folder: no builds shown
      return [];
    } else if (folder.type === "smart-rule") {
      // Every smart folder is a rule now -- including By Profession and By Game
      // Mode, whose rows carry a generated rule instead of a magic type string.
      // Smart folders aggregate ALL matching builds, wherever they are filed.
      const ctx = ruleContext();
      builds = builds.filter((b) => matchesSmartFolder(folder.smartFolder, b, ctx));
    } else {
```

In `getVisibleFolders()`, the existing `else` already returns `[]` for anything that is not `all` or `custom`, so `smart-rule` is covered — **verify this by reading the function**, and change nothing if so.

In `getVisibleComps()`, the trailing `else` likewise already returns `[]`. Verify and leave alone.

Then in `src/renderer/modules/library/content.js`, update `isCombinedView()`:

```js
function isCombinedView() {
  // Search results are drawn flat from across the tree, so each row has to say
  // where it actually lives -- same reason the smart folders do.
  if (hasSearchQuery()) return true;
  const f = state.currentFolder;
  if (!f) return false;
  return f.type === "smart-rule" || f.type === "all";
}
```

Note `smart-profession` and `smart-gamemode` are gone from this list because Task 5 stops emitting them; `smart-rule` covers both.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-filtering.test.js`
Expected: The new `smart-rule` describes PASS. The pre-existing `smart-profession` and `smart-gamemode` describes now **FAIL**, because nothing emits those types any more — that is expected at this step and is fixed in Step 5.

- [ ] **Step 5: Port the legacy regression tests to generated rules**

The old `smart-profession` / `smart-gamemode` tests are the guard that this conversion preserves behaviour. Rewrite each one to navigate via a generated rule while asserting **the same expected build ids**. Add this helper next to `makeBuild`:

```js
// Mirrors what sidebar.js now generates for a By Profession / By Game Mode row.
function professionFolder(prof) {
  return {
    type: "smart-rule",
    id: `__sf-prof:${prof}`,
    smartFolder: {
      id: `__sf-prof:${prof}`,
      name: prof,
      rule: {
        type: "group",
        match: "all",
        children: [{ type: "condition", field: "profession", op: "isAnyOf", value: [prof] }],
      },
    },
  };
}

function gameModeFolder(mode) {
  return {
    type: "smart-rule",
    id: `__sf-mode:${mode}`,
    smartFolder: {
      id: `__sf-mode:${mode}`,
      name: mode,
      rule: {
        type: "group",
        match: "all",
        children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: [mode] }],
      },
    },
  };
}
```

Then replace each occurrence of

```js
state.currentFolder = { type: "smart-profession", id: "Guardian" };
```

with

```js
state.currentFolder = professionFolder("Guardian");
```

and each occurrence of

```js
state.currentFolder = { type: "smart-gamemode", id: "pvp" };
```

with

```js
state.currentFolder = gameModeFolder("pvp");
```

(likewise `"wvw"` and `"pve"`). **Leave every `expect(...)` assertion exactly as it is** — unchanged expectations against a changed navigation path is precisely what makes this a regression test.

Update the file's header comment to say the rows are generated rules now.

- [ ] **Step 6: Run the full unit suite**

Run: `npx jest --maxWorkers=2 tests/unit`
Expected: PASS. If another suite constructs `{ type: "smart-profession" }` or `{ type: "smart-gamemode" }`, port it the same way.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/library/folder-store.js src/renderer/modules/library/content.js tests/unit/renderer/smart-folder-filtering.test.js
git commit -m "refactor(library): evaluate smart folders through the rule engine"
```

---

### Task 5: Sidebar rendering

Draws the built-ins, the generated profession/game-mode rows, and the user's own smart folders, and dispatches navigation.

**Files:**
- Modify: `src/renderer/modules/library/sidebar.js:79-176` (`renderSmartFolders`), `:311-361` (`bindSidebarEvents`)
- Modify: `src/renderer/modules/library/library.js` (init: await `loadSmartFolders()`; navigation fallback)
- Modify: `src/renderer/styles/library.css`
- Test: `tests/unit/renderer/smart-folder-sidebar.test.js`

**Interfaces:**
- Consumes: `listSmartFolders`, `getSmartFolder`, `loadSmartFolders`, `matchesSmartFolder`, `ruleContext` from Tasks 1–3; `libraryBuilds` from `folder-store.js`.
- Produces:
  - `countSmartFolder(sf) -> number`, exported from `sidebar.js` (it lives here, not in `smart-folders.js`, because counting needs `libraryBuilds()` and `smart-folders.js` must not import `folder-store.js`).
  - DOM contract: `[data-navigate-smart-folder="<id>"]` on every smart folder row; `#lib-new-smart-folder-btn` on the section's `+`.
  - Callback contract: `_callbacks.onNavigate({ type: "smart-rule", id, smartFolder })` and `_callbacks.onNewSmartFolder()`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/smart-folder-sidebar.test.js`:

```js
/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [],
    folders: [],
    comps: [],
    currentFolder: null,
    buildSearch: "",
    archiveItems: [],
    trashItems: [],
    libraryPrefs: {
      viewMode: "list",
      sortField: "sortOrder",
      sortDirection: "asc",
      activeFilters: {},
      sidebarOpen: true,
      sidebarExpandedFolders: [],
    },
  },
}));

const { state } = require("../../../src/renderer/modules/state");
const { initSidebar, renderSidebar, countSmartFolder } = require("../../../src/renderer/modules/library/sidebar");
const { loadSmartFolders, saveSmartFolder, BUILTIN_SMART_FOLDERS } = require("../../../src/renderer/modules/library/smart-folders");

function makeBuild(o = {}) {
  return {
    id: "b1", title: "B", profession: "Guardian", gameMode: "pve",
    folderId: null, tags: [], specializations: [], pinned: false, sortOrder: 0,
    updatedAt: new Date().toISOString(), ...o,
  };
}

let settings;
let onNavigate;

beforeEach(async () => {
  settings = {};
  global.window.desktopApi = {
    getSetting: jest.fn(async (k) => (k in settings ? settings[k] : null)),
    setSetting: jest.fn(async (k, v) => { settings[k] = v; }),
  };
  await loadSmartFolders();

  document.body.innerHTML = `<div id="lib-sidebar"></div>`;
  state.builds = [];
  state.folders = [];
  state.comps = [];
  state.currentFolder = null;
  onNavigate = jest.fn();
  initSidebar({ onNavigate, onNewSmartFolder: jest.fn() });
});

function rowFor(id) {
  return document.querySelector(`[data-navigate-smart-folder="${id}"]`);
}

describe("built-in rows", () => {
  test("every visible built-in gets a row", () => {
    state.builds = [makeBuild()];
    renderSidebar();
    for (const f of BUILTIN_SMART_FOLDERS) expect(rowFor(f.id)).toBeTruthy();
  });

  test("All Builds is renamed so it is distinguishable from Main Repository", () => {
    state.builds = [makeBuild()];
    renderSidebar();
    const labels = [...document.querySelectorAll(".lib-nav-item__label")].map((e) => e.textContent);
    expect(labels).toContain("Main Repository");
    expect(labels).toContain("All Builds (by folder)");
    expect(labels).not.toContain("All Builds");
  });

  test("a hidden built-in is not rendered", async () => {
    settings["library.smartFolderOverrides"] = { hidden: ["__sf-untagged"] };
    await loadSmartFolders();
    state.builds = [makeBuild()];
    renderSidebar();
    expect(rowFor("__sf-untagged")).toBeNull();
  });
});

describe("counts", () => {
  test("Main Repository counts every build, filed or not", () => {
    state.builds = [makeBuild({ id: "b1" }), makeBuild({ id: "b2", folderId: "f1" })];
    state.folders = [{ id: "f1", name: "wvw", parentId: null, sortOrder: 0 }];
    const main = BUILTIN_SMART_FOLDERS.find((f) => f.id === "__sf-main");
    expect(countSmartFolder(main)).toBe(2);
  });

  test("Untagged counts only builds with no tags", () => {
    state.builds = [makeBuild({ id: "b1", tags: [] }), makeBuild({ id: "b2", tags: ["wvw"] })];
    const untagged = BUILTIN_SMART_FOLDERS.find((f) => f.id === "__sf-untagged");
    expect(countSmartFolder(untagged)).toBe(1);
  });

  test("archived builds are not counted", () => {
    state.builds = [makeBuild({ id: "b1" }), makeBuild({ id: "b2", archivedAt: "2026-01-01T00:00:00Z" })];
    const main = BUILTIN_SMART_FOLDERS.find((f) => f.id === "__sf-main");
    expect(countSmartFolder(main)).toBe(1);
  });
});

describe("user smart folders", () => {
  test("render below the built-ins under their own label", async () => {
    await saveSmartFolder({
      name: "WvW Firebrands",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] }] },
    });
    state.builds = [makeBuild({ gameMode: "wvw" })];
    renderSidebar();

    const labels = [...document.querySelectorAll(".lib-nav-item__label")].map((e) => e.textContent);
    expect(labels).toContain("WvW Firebrands");
    expect(document.querySelector(".lib-sidebar__subsection-label")?.textContent).toBe("My Smart Folders");
  });

  test("the label is absent when the user has none", () => {
    state.builds = [makeBuild()];
    renderSidebar();
    expect(document.querySelector(".lib-sidebar__subsection-label")).toBeNull();
  });
});

describe("navigation", () => {
  test("clicking a built-in navigates with the resolved rule", () => {
    state.builds = [makeBuild()];
    renderSidebar();
    rowFor("__sf-main").click();

    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "smart-rule", id: "__sf-main" }),
    );
    expect(onNavigate.mock.calls[0][0].smartFolder.rule.children).toEqual([]);
  });

  test("generated profession rows navigate as rules", () => {
    state.builds = [makeBuild({ profession: "Guardian" })];
    state.libraryPrefs.sidebarExpandedFolders = ["__smart-profession"];
    renderSidebar();

    document.querySelector('[data-navigate-smart-folder="__sf-prof:Guardian"]').click();
    const arg = onNavigate.mock.calls[0][0];
    expect(arg.type).toBe("smart-rule");
    expect(arg.smartFolder.rule.children).toEqual([
      { type: "condition", field: "profession", op: "isAnyOf", value: ["Guardian"] },
    ]);
  });

  test("the active row is marked", () => {
    state.builds = [makeBuild()];
    state.currentFolder = { type: "smart-rule", id: "__sf-main", smartFolder: BUILTIN_SMART_FOLDERS[0] };
    renderSidebar();
    expect(rowFor("__sf-main").classList.contains("lib-nav-item--active")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-sidebar.test.js`
Expected: FAIL — `countSmartFolder is not a function`, and no `[data-navigate-smart-folder]` rows exist.

- [ ] **Step 3: Write minimal implementation**

In `src/renderer/modules/library/sidebar.js`, add to the imports:

```js
import { listSmartFolders, matchesSmartFolder, ruleContext } from "./smart-folders.js";
```

Add the count helper near the other helpers (above `renderSmartFolders`):

```js
/**
 * How many builds a smart folder would show.
 *
 * This lives here rather than in smart-folders.js because it needs
 * libraryBuilds(), and smart-folders.js must not import folder-store.js.
 */
export function countSmartFolder(sf) {
  const ctx = ruleContext();
  return libraryBuilds().filter((b) => matchesSmartFolder(sf, b, ctx)).length;
}

/** The row a By Profession / By Game Mode entry navigates to. */
function generatedRuleFolder(idPrefix, name, field, value) {
  const id = `${idPrefix}${value}`;
  return {
    id,
    name,
    // Not a persisted record: there is nothing to edit, rename or delete, which
    // is what the context menu in Task 7 checks before it opens.
    generated: true,
    rule: {
      type: "group",
      match: "all",
      children: [{ type: "condition", field, op: "isAnyOf", value: [value] }],
    },
  };
}

function smartRowHtml(sf, { sub = false } = {}) {
  const isActive = state.currentFolder?.type === "smart-rule" && state.currentFolder.id === sf.id;
  return `
    <button type="button"
      class="lib-nav-item ${sub ? "lib-nav-item--sub" : ""} ${isActive ? "lib-nav-item--active" : ""}"
      data-navigate-smart-folder="${escapeHtml(sf.id)}"
    >
      <span class="lib-nav-item__icon">${smartFolderIcon(sf.icon)}</span>
      <span class="lib-nav-item__label">${escapeHtml(sf.name)}</span>
      <span class="lib-nav-item__count">${countSmartFolder(sf)}</span>
    </button>
  `;
}

/** Icon name -> svg, falling back to the generic folder icon. */
function smartFolderIcon(name) {
  const icons = {
    folderOpen: folderOpenIcon,
    clock: clockIcon,
    share: shareIcon,
    bars: bars3Icon,
    tag: tagIcon,
    funnel: funnelIcon,
  };
  return icons[name] || funnelIcon;
}
```

Add `clockIcon`, `shareIcon`, `bars3Icon`, `tagIcon`, `funnelIcon` to the `heroicons.js` import list at the top of `sidebar.js`. Of these, **only `funnelIcon` is missing** — `clockIcon`, `shareIcon`, `bars3Icon`, `tagIcon`, `folderOpenIcon` and `plusIcon` already exist. Define `funnelIcon` in `src/renderer/modules/library/heroicons.js` following the existing export style there: a template-literal string holding a `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">` — solid Heroicons mini, **not** 24×24 stroke icons.

Now rewrite `renderSmartFolders(profExpanded, modeExpanded)`. Keep the profession/game-mode facet collection exactly as it is, but build the rows through `smartRowHtml`:

```js
function renderSmartFolders(profExpanded, modeExpanded) {
  const current = state.currentFolder;
  const allActive = !current || current.type === "all";
  const allCompsActive = current?.id === "__all-comps";

  const builds = libraryBuilds();
  const totalBuilds = builds.length;
  const totalComps = libraryComps().length;

  const all = listSmartFolders();
  const builtins = all.filter((f) => f.builtin);
  const mine = all.filter((f) => !f.builtin);

  const professions = [...new Set(builds.map((b) => b.profession).filter(Boolean))].sort();
  const profItems = professions
    .map((prof) =>
      smartRowHtml(generatedRuleFolder("__sf-prof:", prof, "profession", prof), { sub: true }),
    )
    .join("");

  const gameModes = [...new Set(builds.map((b) => b.gameMode || "pve").filter(Boolean))].sort();
  const modeItems = gameModes
    .map((mode) => {
      const sf = generatedRuleFolder("__sf-mode:", gameModeLabel(mode), "gameMode", mode);
      return smartRowHtml(sf, { sub: true });
    })
    .join("");

  return `
    <div class="lib-sidebar__section">
      <div class="lib-sidebar__section-header">
        <span class="lib-sidebar__section-label">Smart Folders</span>
        <button type="button" class="lib-sidebar__new-folder-btn" id="lib-new-smart-folder-btn"
          title="New smart folder" aria-label="New smart folder">${plusIcon}</button>
      </div>

      ${builtins.map((f) => smartRowHtml(f)).join("")}

      <button type="button"
        class="lib-nav-item ${allActive ? "lib-nav-item--active" : ""}"
        data-navigate-all="1"
      >
        <span class="lib-nav-item__icon">${folderOpenIcon}</span>
        <span class="lib-nav-item__label">All Builds (by folder)</span>
        <span class="lib-nav-item__count">${totalBuilds}</span>
      </button>

      ${professions.length > 0 ? `
        <button type="button" class="lib-nav-item lib-nav-item--group" data-toggle-group="__smart-profession">
          <span class="lib-nav-item__chevron">${profExpanded ? chevronDownIcon : chevronRightIcon}</span>
          <span class="lib-nav-item__icon">${folderIcon}</span>
          <span class="lib-nav-item__label">By Profession</span>
        </button>
        ${profExpanded ? `<div class="lib-nav-group">${profItems}</div>` : ""}
      ` : ""}

      ${gameModes.length > 0 ? `
        <button type="button" class="lib-nav-item lib-nav-item--group" data-toggle-group="__smart-gamemode">
          <span class="lib-nav-item__chevron">${modeExpanded ? chevronDownIcon : chevronRightIcon}</span>
          <span class="lib-nav-item__icon">${folderIcon}</span>
          <span class="lib-nav-item__label">By Game Mode</span>
        </button>
        ${modeExpanded ? `<div class="lib-nav-group">${modeItems}</div>` : ""}
      ` : ""}

      ${totalComps > 0 ? `
        <button type="button" class="lib-nav-item ${allCompsActive ? "lib-nav-item--active" : ""}" data-navigate-all-comps="1">
          <span class="lib-nav-item__icon">${compIcon}</span>
          <span class="lib-nav-item__label">All Comps</span>
          <span class="lib-nav-item__count">${totalComps}</span>
        </button>
      ` : ""}

      ${mine.length > 0 ? `
        <div class="lib-sidebar__divider"></div>
        <div class="lib-sidebar__subsection-label">My Smart Folders</div>
        ${mine.map((f) => smartRowHtml(f)).join("")}
      ` : ""}
    </div>
  `;
}
```

`plusIcon` already exists and is what `renderMyFolders` uses for its own new-folder button — reuse it rather than adding a duplicate.

In `bindSidebarEvents(container)`, **delete** the two `data-navigate-profession` and `data-navigate-gamemode` blocks and add:

```js
  // Navigate to any smart folder -- built-in, generated, or user-defined.
  container.querySelectorAll("[data-navigate-smart-folder]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.navigateSmartFolder;
      const sf = resolveSidebarSmartFolder(id);
      if (sf) _callbacks.onNavigate?.({ type: "smart-rule", id, smartFolder: sf });
    });
  });

  container.querySelector("#lib-new-smart-folder-btn")?.addEventListener("click", () => {
    _callbacks.onNewSmartFolder?.();
  });
```

and add the resolver next to `generatedRuleFolder`, since generated rows are not in `listSmartFolders()`:

```js
/** Generated rows are not persisted, so they are rebuilt from their id. */
function resolveSidebarSmartFolder(id) {
  if (id.startsWith("__sf-prof:")) {
    const prof = id.slice("__sf-prof:".length);
    return generatedRuleFolder("__sf-prof:", prof, "profession", prof);
  }
  if (id.startsWith("__sf-mode:")) {
    const mode = id.slice("__sf-mode:".length);
    return generatedRuleFolder("__sf-mode:", gameModeLabel(mode), "gameMode", mode);
  }
  return listSmartFolders().find((f) => f.id === id) || null;
}
```

In `src/renderer/modules/library/library.js`, import and await the loader wherever `loadPrefs()` is awaited during library init:

```js
import { loadSmartFolders, getSmartFolder } from "./smart-folders.js";
```

```js
  await loadSmartFolders();
```

and harden `onNavigate` against a smart folder that no longer exists:

```js
    async onNavigate(folder) {
      // A smart folder can vanish between renders -- deleted in the editor, or
      // a hidden built-in restored from a stale saved navigation.
      if (folder?.type === "smart-rule" && !folder.smartFolder) {
        const resolved = getSmartFolder(folder.id);
        folder = resolved ? { ...folder, smartFolder: resolved } : { type: "all" };
      }
      state.currentFolder = folder || null;
      if (folder?.type === "trash") await refreshTrash();
      if (folder?.type === "archive") await refreshArchive();
      clearSelection();
      savePrefs();
      renderLibrary();
    },
```

Add the callback pass-through where `initSidebar` is called in `library.js`, alongside `onNewFolderSidebar`:

```js
    onNewSmartFolder: handleNewSmartFolder,
```

and a temporary stub next to the other handlers (Task 6 replaces the body):

```js
function handleNewSmartFolder() {
  // Wired to the editor in the next task.
}
```

Finally add to `src/renderer/styles/library.css`, next to the existing `.lib-sidebar__section-label` rules:

```css
.lib-sidebar__divider {
  height: 1px;
  background: var(--line-soft);
  margin: 6px 10px;
}

.lib-sidebar__subsection-label {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-dim);
  padding: 2px 10px 3px;
  opacity: 0.75;
  font-weight: 700;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-sidebar.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite for sidebar regressions**

Run: `npx jest --maxWorkers=2 tests/unit`
Expected: PASS. Any suite asserting on the literal text `"All Builds"` needs updating to `"All Builds (by folder)"`; any suite clicking `[data-navigate-profession]` needs the new attribute.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/library/sidebar.js src/renderer/modules/library/library.js src/renderer/modules/library/heroicons.js src/renderer/styles/library.css tests/unit/renderer/smart-folder-sidebar.test.js
git commit -m "feat(library): render built-in and user smart folders in the sidebar"
```

---

### Task 6: The rule editor modal

**Files:**
- Create: `src/renderer/modules/library/smart-folder-modal.js`
- Create: `src/renderer/styles/smart-folder-modal.css`
- Modify: `src/renderer/renderer.js` (init + stylesheet import, following `share-modal` at `:58` and `:322`)
- Modify: `src/renderer/modules/library/library.js` (`handleNewSmartFolder` body)
- Test: `tests/unit/renderer/smart-folder-modal.test.js`

**Interfaces:**
- Consumes: `saveSmartFolder`, `deleteSmartFolder`, `getSmartFolder`, `matchesSmartFolder`, `ruleContext` from Tasks 1–3; `libraryBuilds` from `folder-store.js`.
- Produces:
  - `initSmartFolderModal(callbacks) -> void` where `callbacks = { onSaved(sf), onDeleted(id) }`
  - `openSmartFolderModal(smartFolderOrNull) -> void` — `null` opens a blank new folder.
  - `closeSmartFolderModal() -> void`
  - `FIELD_DEFS` — exported for tests: `[{ field, label, ops: [{ op, label, valueKind }] }]` where `valueKind` is one of `"multi" | "text" | "number" | "folder" | "none"`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/smart-folder-modal.test.js`:

```js
/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [], folders: [], comps: [], currentFolder: null, buildSearch: "",
    libraryPrefs: { viewMode: "list", sortField: "sortOrder", sortDirection: "asc", activeFilters: {} },
  },
}));

const { state } = require("../../../src/renderer/modules/state");
const {
  initSmartFolderModal,
  openSmartFolderModal,
  closeSmartFolderModal,
  FIELD_DEFS,
} = require("../../../src/renderer/modules/library/smart-folder-modal");
const { loadSmartFolders, getSmartFolder } = require("../../../src/renderer/modules/library/smart-folders");

function makeBuild(o = {}) {
  return {
    id: "b1", title: "Zerg Firebrand", profession: "Guardian", gameMode: "wvw",
    folderId: null, tags: ["wvw"], pinned: false, sortOrder: 0,
    specializations: [{ name: "Firebrand", elite: true }],
    updatedAt: "2026-09-01T00:00:00Z", ...o,
  };
}

let settings, onSaved;

beforeEach(async () => {
  settings = {};
  global.window.desktopApi = {
    getSetting: jest.fn(async (k) => (k in settings ? settings[k] : null)),
    setSetting: jest.fn(async (k, v) => { settings[k] = v; }),
  };
  await loadSmartFolders();
  document.body.innerHTML = "";
  state.builds = [makeBuild({ id: "b1", gameMode: "wvw" }), makeBuild({ id: "b2", gameMode: "pve" })];
  state.folders = [];
  onSaved = jest.fn();
  initSmartFolderModal({ onSaved, onDeleted: jest.fn() });
});

afterEach(() => closeSmartFolderModal());

const $ = (sel) => document.querySelector(sel);

describe("field definitions", () => {
  test("every field the evaluator supports is offered", () => {
    expect(FIELD_DEFS.map((f) => f.field).sort()).toEqual(
      ["createdAt", "eliteSpec", "gameMode", "location", "notes", "ownership", "pinned", "profession", "tags", "team", "title", "updatedAt"].sort(),
    );
  });

  test("value-less operators are marked so no input renders", () => {
    const tags = FIELD_DEFS.find((f) => f.field === "tags");
    expect(tags.ops.find((o) => o.op === "isEmpty").valueKind).toBe("none");
  });

  test("date operators take a number", () => {
    const updated = FIELD_DEFS.find((f) => f.field === "updatedAt");
    expect(updated.ops.every((o) => o.valueKind === "number")).toBe(true);
  });
});

describe("opening", () => {
  test("a new folder starts with one empty condition row", () => {
    openSmartFolderModal(null);
    expect(document.querySelectorAll("[data-cond-index]")).toHaveLength(1);
    expect($("#sfm-name").value).toBe("");
  });

  test("an existing folder is loaded into the form", () => {
    openSmartFolderModal({
      id: "sf_x", name: "WvW", icon: "funnel",
      rule: { type: "group", match: "any", children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] }] },
    });
    expect($("#sfm-name").value).toBe("WvW");
    expect($("#sfm-match").value).toBe("any");
    expect(document.querySelectorAll("[data-cond-index]")).toHaveLength(1);
  });
});

describe("live match count", () => {
  test("reflects the current rule", () => {
    openSmartFolderModal({
      id: "sf_x", name: "WvW",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] }] },
    });
    expect($("#sfm-count").textContent).toContain("1");
    expect($("#sfm-total").textContent).toContain("2");
  });

  test("updates when a condition changes", () => {
    openSmartFolderModal({
      id: "sf_x", name: "WvW",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] }] },
    });
    const opSel = $('[data-cond-index="0"] [data-cond-op]');
    opSel.value = "isNoneOf";
    opSel.dispatchEvent(new Event("change", { bubbles: true }));
    expect($("#sfm-count").textContent).toContain("1");
  });

  test("an empty rule matches everything", () => {
    openSmartFolderModal({ id: "sf_x", name: "All", rule: { type: "group", match: "all", children: [] } });
    expect($("#sfm-count").textContent).toContain("2");
  });
});

describe("editing conditions", () => {
  test("add condition appends a row", () => {
    openSmartFolderModal(null);
    $("#sfm-add-cond").click();
    expect(document.querySelectorAll("[data-cond-index]")).toHaveLength(2);
  });

  test("remove drops the row", () => {
    openSmartFolderModal(null);
    $("#sfm-add-cond").click();
    $('[data-cond-index="0"] [data-cond-remove]').click();
    expect(document.querySelectorAll("[data-cond-index]")).toHaveLength(1);
  });

  test("changing the field resets the operator and value", () => {
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "title", op: "contains", value: "zerg" }] },
    });
    const fieldSel = $('[data-cond-index="0"] [data-cond-field]');
    fieldSel.value = "pinned";
    fieldSel.dispatchEvent(new Event("change", { bubbles: true }));

    expect($('[data-cond-index="0"] [data-cond-op]').value).toBe("isTrue");
    expect($('[data-cond-index="0"] [data-cond-value]')).toBeNull();
  });

  test("negative operators mark the row so exclusions are legible", () => {
    openSmartFolderModal({
      id: "sf_x", name: "X",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "tags", op: "hasNoneOf", value: ["retired"] }] },
    });
    expect($('[data-cond-index="0"]').classList.contains("sfm-cond--negative")).toBe(true);
  });
});

describe("saving", () => {
  test("persists and reports the saved folder", async () => {
    openSmartFolderModal(null);
    $("#sfm-name").value = "Mine";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    $("#sfm-save").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onSaved).toHaveBeenCalled();
    expect(settings["library.smartFolders"][0].name).toBe("Mine");
  });

  test("refuses to save without a name", async () => {
    openSmartFolderModal(null);
    $("#sfm-save").click();
    await Promise.resolve();

    expect(onSaved).not.toHaveBeenCalled();
    expect($("#sfm-status").textContent).toMatch(/name/i);
  });

  test("incomplete condition rows are dropped rather than saved as broken rules", async () => {
    openSmartFolderModal(null);
    $("#sfm-name").value = "Mine";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    $("#sfm-save").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(settings["library.smartFolders"][0].rule.children).toEqual([]);
  });

  test("cancel persists nothing", async () => {
    openSmartFolderModal(null);
    $("#sfm-name").value = "Mine";
    $("#sfm-name").dispatchEvent(new Event("input", { bubbles: true }));
    $("#sfm-cancel").click();
    await Promise.resolve();

    expect(settings["library.smartFolders"]).toBeUndefined();
  });
});

describe("delete", () => {
  test("is offered only for an existing user folder", () => {
    openSmartFolderModal(null);
    expect($("#sfm-delete")).toBeNull();

    closeSmartFolderModal();
    openSmartFolderModal({ id: "sf_x", name: "X", rule: { type: "group", match: "all", children: [] } });
    expect($("#sfm-delete")).toBeTruthy();
  });

  test("is not offered for a built-in", () => {
    closeSmartFolderModal();
    openSmartFolderModal(getSmartFolder("__sf-main"));
    expect($("#sfm-delete")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-modal.test.js`
Expected: FAIL — "Cannot find module '.../library/smart-folder-modal'".

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/modules/library/smart-folder-modal.js`. Structure it exactly like `share-modal.js`: a module-level `_overlay`, an `init` that builds the overlay once and appends it to `document.body`, an `open` that sets a working copy of the record and calls `_render()`, a `_render()` that writes `innerHTML`, and a single delegated `click`/`change`/`input` listener on the overlay body.

Key implementation points, in order:

```js
import { escapeHtml } from "../utils.js";
import { state } from "../state.js";
import { libraryBuilds } from "./folder-store.js";
import {
  matchesSmartFolder, ruleContext, saveSmartFolder, deleteSmartFolder,
} from "./smart-folders.js";

/**
 * The editor's vocabulary. It must stay in step with FIELDS in
 * smart-folders.js -- a field offered here that the evaluator does not know
 * silently matches nothing.
 */
export const FIELD_DEFS = [
  { field: "profession", label: "Profession", ops: [
    { op: "isAnyOf", label: "is any of", valueKind: "multi" },
    { op: "isNoneOf", label: "is none of", valueKind: "multi", negative: true },
  ]},
  { field: "eliteSpec", label: "Elite Spec", ops: [
    { op: "isAnyOf", label: "is any of", valueKind: "multi" },
    { op: "isNoneOf", label: "is none of", valueKind: "multi", negative: true },
  ]},
  { field: "gameMode", label: "Game Mode", ops: [
    { op: "isAnyOf", label: "is any of", valueKind: "multi" },
    { op: "isNoneOf", label: "is none of", valueKind: "multi", negative: true },
  ]},
  { field: "tags", label: "Tags", ops: [
    { op: "hasAnyOf", label: "has any of", valueKind: "multi" },
    { op: "hasAllOf", label: "has all of", valueKind: "multi" },
    { op: "hasNoneOf", label: "has none of", valueKind: "multi", negative: true },
    { op: "isEmpty", label: "is empty", valueKind: "none" },
    { op: "isNotEmpty", label: "is not empty", valueKind: "none" },
  ]},
  { field: "title", label: "Title", ops: [
    { op: "contains", label: "contains", valueKind: "text" },
    { op: "notContains", label: "does not contain", valueKind: "text", negative: true },
  ]},
  { field: "notes", label: "Notes", ops: [
    { op: "contains", label: "contains", valueKind: "text" },
    { op: "notContains", label: "does not contain", valueKind: "text", negative: true },
  ]},
  { field: "location", label: "Location", ops: [
    { op: "isUnfiled", label: "is unfiled", valueKind: "none" },
    { op: "inFolder", label: "is in folder", valueKind: "folder" },
    { op: "notInFolder", label: "is not in folder", valueKind: "folder", negative: true },
  ]},
  { field: "ownership", label: "Ownership", ops: [
    { op: "is", label: "is", valueKind: "ownership" },
  ]},
  { field: "team", label: "Team", ops: [
    { op: "isAnyOf", label: "is any of", valueKind: "team" },
    { op: "isNoneOf", label: "is none of", valueKind: "team", negative: true },
  ]},
  { field: "updatedAt", label: "Updated", ops: [
    { op: "withinDays", label: "within last", valueKind: "number" },
    { op: "olderThanDays", label: "older than", valueKind: "number" },
  ]},
  { field: "createdAt", label: "Created", ops: [
    { op: "withinDays", label: "within last", valueKind: "number" },
    { op: "olderThanDays", label: "older than", valueKind: "number" },
  ]},
  { field: "pinned", label: "Pinned", ops: [
    { op: "isTrue", label: "is pinned", valueKind: "none" },
    { op: "isFalse", label: "is not pinned", valueKind: "none" },
  ]},
];
```

Default value per `valueKind` when a field changes — this is what makes the "changing the field resets the operator and value" test pass:

```js
function defaultValueFor(valueKind) {
  switch (valueKind) {
    case "multi":
    case "team": return [];
    case "text": return "";
    case "number": return 14;
    case "folder": return null;
    case "ownership": return "mine";
    default: return undefined;   // "none"
  }
}
```

Facet options come from the library, mirroring how `toolbar.js:186-199` collects them:

```js
/** Options for a multi-select row, harvested from the browsable library. */
function optionsFor(field) {
  const builds = libraryBuilds();
  if (field === "profession") return [...new Set(builds.map((b) => b.profession).filter(Boolean))].sort();
  if (field === "eliteSpec") {
    const specs = new Set();
    for (const b of builds) for (const s of b.specializations || []) if (s?.elite && s.name) specs.add(s.name);
    return [...specs].sort();
  }
  if (field === "gameMode") return [...new Set(builds.map((b) => b.gameMode || "pve"))].sort();
  if (field === "tags") return [...new Set(builds.flatMap((b) => b.tags || []).filter(Boolean))].sort();
  return [];
}
```

The live count, recomputed at the end of every `_render()`:

```js
function matchCount(rule) {
  const sf = { id: "__preview", name: "", rule };
  const ctx = ruleContext();
  return libraryBuilds().filter((b) => matchesSmartFolder(sf, b, ctx)).length;
}
```

Markup requirements the tests depend on — honour these ids and attributes exactly:

- `#sfm-name` — text input, the name
- `#sfm-match` — `<select>` with options `all` / `any`
- one element per condition carrying `data-cond-index="<i>"`, with class `sfm-cond` and, when the selected operator has `negative: true`, an additional `sfm-cond--negative`
- inside each: `[data-cond-field]` (`<select>`), `[data-cond-op]` (`<select>`), `[data-cond-value]` (**absent entirely** when `valueKind === "none"`), `[data-cond-remove]` (button)
- `#sfm-add-cond`, `#sfm-save`, `#sfm-cancel`, `#sfm-status`
- `#sfm-delete` — rendered **only** when editing a record that has an id and is not `builtin`
- `#sfm-count` and `#sfm-total` — the two numbers in the footer, in separate elements so they can be asserted independently

For `valueKind: "number"`, put the `days` unit **inside** the input's trailing adornment (an absolutely-positioned `<span class="sfm-unit">days</span>` over a right-padded input), not as a sibling element. A sibling pushes the remove button out of the column the other rows sit in.

Saving drops incomplete rows rather than persisting rules that silently match nothing:

```js
/** A row is complete when its operator needs no value, or has a usable one. */
function isComplete(cond) {
  const def = FIELD_DEFS.find((f) => f.field === cond.field);
  const opDef = def?.ops.find((o) => o.op === cond.op);
  if (!opDef) return false;
  if (opDef.valueKind === "none") return true;
  if (Array.isArray(cond.value)) return cond.value.length > 0;
  if (typeof cond.value === "string") return cond.value.trim() !== "";
  if (typeof cond.value === "number") return Number.isFinite(cond.value);
  return cond.value != null;
}

async function _handleSave() {
  const name = _draft.name.trim();
  if (!name) {
    _setStatus("Give the smart folder a name.", true);
    return;
  }
  const children = _draft.rule.children.filter(isComplete);
  const saved = await saveSmartFolder({ ..._draft, name, rule: { ..._draft.rule, children } });
  _callbacks.onSaved?.(saved);
  closeSmartFolderModal();
}
```

Wrap the `saveSmartFolder` call in a `try/catch` that calls `_setStatus(...)` and leaves the modal open on failure, per the spec's error table.

Create `src/renderer/styles/smart-folder-modal.css` using the mockup's rules — reuse the class names above (`.sfm-overlay`, `.sfm`, `.sfm__body`, `.sfm-cond`, `.sfm-cond--negative`, `.sfm-chip`, `.sfm-unit`, `.sfm__footer`) and only the custom properties listed in Global Constraints.

In `src/renderer/renderer.js`, import the stylesheet where the other library stylesheets are imported, and initialise next to `initShareModal` at `:322`:

```js
import { initSmartFolderModal } from "./modules/library/smart-folder-modal.js";
```

```js
initSmartFolderModal({
  onSaved: () => renderLibrary(),
  onDeleted: () => renderLibrary(),
});
```

If `renderLibrary` is not in scope in `renderer.js`, pass the callbacks through from `library.js` instead — follow whichever pattern the file already uses for `initShareModal`.

Finally, replace the stub in `library.js`:

```js
function handleNewSmartFolder() {
  openSmartFolderModal(null);
}
```

with the matching import added at the top of `library.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-modal.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/library/smart-folder-modal.js src/renderer/styles/smart-folder-modal.css src/renderer/renderer.js src/renderer/modules/library/library.js tests/unit/renderer/smart-folder-modal.test.js
git commit -m "feat(library): smart folder rule editor modal"
```

---

### Task 7: Sidebar context menus

**Files:**
- Modify: `src/renderer/modules/library/context-menu.js:110-149` (`_onContextMenu`), plus a new `showSmartFolderMenu`
- Modify: `src/renderer/modules/library/library.js` (handlers)
- Test: `tests/unit/renderer/smart-folder-context-menu.test.js`

**Interfaces:**
- Consumes: `getSmartFolder`, `saveSmartFolder`, `deleteSmartFolder`, `setBuiltinHidden` from Task 3; `openSmartFolderModal` from Task 6.
- Produces: `showSmartFolderMenu(x, y, smartFolder)` in `context-menu.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/smart-folder-context-menu.test.js`:

```js
/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [], folders: [], comps: [], currentFolder: null, buildSearch: "",
    libraryPrefs: { viewMode: "list", sortField: "sortOrder", sortDirection: "asc", activeFilters: {} },
  },
}));

const { initContextMenu, showSmartFolderMenu, closeMenu } = require("../../../src/renderer/modules/library/context-menu");
const { loadSmartFolders, getSmartFolder } = require("../../../src/renderer/modules/library/smart-folders");

let cb;

beforeEach(async () => {
  global.window.desktopApi = {
    getSetting: jest.fn(async () => null),
    setSetting: jest.fn(async () => {}),
  };
  await loadSmartFolders();
  document.body.innerHTML = "";
  cb = {
    onEditSmartFolder: jest.fn(),
    onRenameSmartFolder: jest.fn(),
    onDuplicateSmartFolder: jest.fn(),
    onDeleteSmartFolder: jest.fn(),
    onHideSmartFolder: jest.fn(),
  };
  initContextMenu(cb);
});

afterEach(() => closeMenu());

const labels = () =>
  [...document.querySelectorAll(".lib-ctx__item")].map((e) => e.textContent.trim());

describe("built-in menu", () => {
  test("offers duplicate and hide, but not edit or delete", () => {
    showSmartFolderMenu(10, 10, getSmartFolder("__sf-shared"));
    const l = labels();
    expect(l.some((t) => /duplicate/i.test(t))).toBe(true);
    expect(l.some((t) => /hide/i.test(t))).toBe(true);
    expect(l.some((t) => /^edit/i.test(t))).toBe(false);
    expect(l.some((t) => /delete/i.test(t))).toBe(false);
  });

  test("hide reports the built-in id", () => {
    showSmartFolderMenu(10, 10, getSmartFolder("__sf-untagged"));
    document.querySelectorAll(".lib-ctx__item").forEach((el) => {
      if (/hide/i.test(el.textContent)) el.click();
    });
    expect(cb.onHideSmartFolder).toHaveBeenCalledWith("__sf-untagged");
  });
});

describe("user menu", () => {
  const mine = {
    id: "sf_x", name: "Mine", builtin: false,
    rule: { type: "group", match: "all", children: [] },
  };

  test("offers the full set", () => {
    showSmartFolderMenu(10, 10, mine);
    const l = labels();
    expect(l.some((t) => /^edit/i.test(t))).toBe(true);
    expect(l.some((t) => /rename/i.test(t))).toBe(true);
    expect(l.some((t) => /duplicate/i.test(t))).toBe(true);
    expect(l.some((t) => /delete/i.test(t))).toBe(true);
    expect(l.some((t) => /hide/i.test(t))).toBe(false);
  });

  test("edit reports the record", () => {
    showSmartFolderMenu(10, 10, mine);
    document.querySelectorAll(".lib-ctx__item").forEach((el) => {
      if (/^edit/i.test(el.textContent.trim())) el.click();
    });
    expect(cb.onEditSmartFolder).toHaveBeenCalledWith(expect.objectContaining({ id: "sf_x" }));
  });
});
```

Before writing the implementation, **read `_item()` at `context-menu.js:605` and `_showMenu()` at `:563`** and use the real class names that `_item` emits — the test above assumes `.lib-ctx__item`; if the codebase uses a different class, update the test to match the codebase rather than the reverse.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-context-menu.test.js`
Expected: FAIL — `showSmartFolderMenu is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `context-menu.js`, add the menu builder alongside `showFolderMenu`:

```js
/**
 * Built-ins are code, not rows, so they cannot be edited or deleted -- hiding
 * is the equivalent gesture, and duplicating is the on-ramp to making your own.
 */
export function showSmartFolderMenu(x, y, smartFolder) {
  if (!smartFolder) return;
  const items = [_header(smartFolder.name)];

  if (smartFolder.builtin) {
    items.push(
      _item(documentDuplicateIcon, "Duplicate as new…", null, () => _callbacks.onDuplicateSmartFolder?.(smartFolder)),
      _sep(),
      _item(eyeSlashIcon, "Hide from sidebar", null, () => _callbacks.onHideSmartFolder?.(smartFolder.id)),
    );
  } else {
    items.push(
      _item(funnelIcon, "Edit rules…", null, () => _callbacks.onEditSmartFolder?.(smartFolder)),
      _item(pencilIcon, "Rename", null, () => _callbacks.onRenameSmartFolder?.(smartFolder)),
      _item(documentDuplicateIcon, "Duplicate", null, () => _callbacks.onDuplicateSmartFolder?.(smartFolder)),
      _sep(),
      _item(trashIcon, "Delete", null, () => _callbacks.onDeleteSmartFolder?.(smartFolder), true),
    );
  }

  _showMenu(x, y, items);
}
```

`pencilIcon`, `documentDuplicateIcon` and `trashIcon` already exist in `heroicons.js`; `funnelIcon` was added in Task 5. Only `eyeSlashIcon` is new — add it in the same 20×20 `fill="currentColor"` style.

In `_onContextMenu`, add a branch **before** the `folderEl` branch (a smart folder row is not a `[data-folder-id]` element, but check ordering against the real DOM anyway):

```js
  const smartEl = e.target.closest("[data-navigate-smart-folder]");
```

```js
  } else if (smartEl) {
    const sf = _callbacks.onResolveSmartFolder?.(smartEl.dataset.navigateSmartFolder);
    // Generated By Profession / By Game Mode rows have no record to act on.
    if (sf && !sf.generated) showSmartFolderMenu(e.clientX, e.clientY, sf);
  } else if (folderEl) {
```

`generatedRuleFolder()` in Task 5 already sets `generated: true`, which is what this check reads. Add `onResolveSmartFolder` to the shared callbacks in `library.js`, delegating to the `resolveSidebarSmartFolder` logic (export it from `sidebar.js`).

Add the handlers in `library.js` next to the other folder handlers:

```js
function handleEditSmartFolder(sf) {
  openSmartFolderModal(sf);
}

// Duplicating a built-in is how you start your own: same rule, editable copy.
function handleDuplicateSmartFolder(sf) {
  openSmartFolderModal({
    name: `${sf.name} copy`,
    icon: sf.icon,
    rule: JSON.parse(JSON.stringify(sf.rule)),
  });
}

async function handleRenameSmartFolder(sf) {
  const name = await showPromptModal({ title: "Rename smart folder", value: sf.name });
  if (!name || name === sf.name) return;
  await saveSmartFolder({ ...sf, name });
  renderLibrary();
}

async function handleDeleteSmartFolder(sf) {
  const ok = await showConfirmModal({
    title: "Delete smart folder",
    message: `Delete "${sf.name}"? The builds it shows are not affected.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  await deleteSmartFolder(sf.id);
  if (state.currentFolder?.id === sf.id) state.currentFolder = { type: "all" };
  renderLibrary();
}

async function handleHideSmartFolder(id) {
  await setBuiltinHidden(id, true);
  if (state.currentFolder?.id === id) state.currentFolder = { type: "all" };
  renderLibrary();
}
```

Use the codebase's existing rename-prompt helper rather than `showPromptModal` if the name differs — check how `handleRenameFolder` prompts and copy that exactly. Register all five handlers in the `shared` callbacks object passed to `initContextMenu`.

Note the deliberate detail: deleting or hiding the smart folder you are currently viewing navigates back to `All Builds (by folder)` rather than leaving you on a folder that no longer exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-context-menu.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/library/context-menu.js src/renderer/modules/library/sidebar.js src/renderer/modules/library/library.js src/renderer/modules/library/heroicons.js tests/unit/renderer/smart-folder-context-menu.test.js
git commit -m "feat(library): context menus for smart folders"
```

---

### Task 8: "Save as smart folder" from the toolbar

The discovery path: filter first, then keep it.

**Files:**
- Modify: `src/renderer/modules/library/toolbar.js:278-284` (the clear button area), `:590-600` (filter click handling)
- Modify: `src/renderer/modules/library/library.js`
- Modify: `src/renderer/styles/library.css`
- Test: `tests/unit/renderer/smart-folder-from-filters.test.js`

**Interfaces:**
- Consumes: `openSmartFolderModal` from Task 6.
- Produces: `filtersToRule(activeFilters) -> { type: "group", match: "all", children: [...] }`, exported from `toolbar.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/smart-folder-from-filters.test.js`:

```js
/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [], folders: [], comps: [], currentFolder: null, buildSearch: "",
    libraryPrefs: { viewMode: "list", sortField: "sortOrder", sortDirection: "asc", activeFilters: {} },
  },
}));

const { filtersToRule } = require("../../../src/renderer/modules/library/toolbar");

describe("filtersToRule", () => {
  test("maps every toolbar filter onto the rule vocabulary", () => {
    const rule = filtersToRule({
      professions: ["Guardian"],
      eliteSpecs: ["Firebrand"],
      gameModes: ["wvw"],
      tags: ["support"],
    });

    expect(rule).toEqual({
      type: "group",
      match: "all",
      children: [
        { type: "condition", field: "profession", op: "isAnyOf", value: ["Guardian"] },
        { type: "condition", field: "eliteSpec", op: "isAnyOf", value: ["Firebrand"] },
        { type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] },
        { type: "condition", field: "tags", op: "hasAnyOf", value: ["support"] },
      ],
    });
  });

  test("tags become hasAnyOf, matching how the toolbar already behaves", () => {
    const rule = filtersToRule({ tags: ["a", "b"] });
    expect(rule.children[0].op).toBe("hasAnyOf");
  });

  test("empty filter arrays produce no conditions", () => {
    expect(filtersToRule({ professions: [], tags: [] }).children).toEqual([]);
  });

  test("no filters at all produce an empty rule", () => {
    expect(filtersToRule({}).children).toEqual([]);
    expect(filtersToRule(null).children).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-from-filters.test.js`
Expected: FAIL — `filtersToRule is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/renderer/modules/library/toolbar.js`:

```js
/**
 * The toolbar filters as a smart folder rule.
 *
 * The rule vocabulary was designed as a superset of these four filters, so the
 * mapping is direct -- which is the point: people filter first and then wish it
 * had stuck.
 */
export function filtersToRule(activeFilters) {
  const f = activeFilters || {};
  const children = [];
  const push = (field, op, value) => {
    if (Array.isArray(value) && value.length > 0) {
      children.push({ type: "condition", field, op, value: [...value] });
    }
  };
  push("profession", "isAnyOf", f.professions);
  push("eliteSpec", "isAnyOf", f.eliteSpecs);
  push("gameMode", "isAnyOf", f.gameModes);
  push("tags", "hasAnyOf", f.tags);
  return { type: "group", match: "all", children };
}
```

Render the button next to the existing Clear button (both appear only when something is filtered), around `:278`:

```js
  const hasActive = /* the same condition the existing clearBtn uses */;
  const saveBtn = hasActive
    ? `<button type="button" class="lib-fd__save-smart" data-filter-save-smart="1">${funnelIcon} Save as smart folder</button>`
    : "";

  container.innerHTML = `<div class="lib-filters__bar">${dropdowns.join("")}${clearBtn}${saveBtn}</div>`;
```

Bind it where the other filter buttons are bound (near `:595`):

```js
  container.querySelector("[data-filter-save-smart]")?.addEventListener("click", () => {
    _callbacks.onSaveFiltersAsSmartFolder?.(filtersToRule(state.libraryPrefs.activeFilters));
  });
```

In `library.js`, register the handler in the shared callbacks:

```js
function handleSaveFiltersAsSmartFolder(rule) {
  openSmartFolderModal({ name: "", icon: "funnel", rule });
}
```

In `src/renderer/styles/library.css`, add `.lib-fd__save-smart` styled like the neighbouring `.lib-fd__clear` — copy that rule block and change only the selector, so the two buttons read as a pair.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --maxWorkers=2 tests/unit/renderer/smart-folder-from-filters.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite**

Run: `npx jest --maxWorkers=2`
Expected: PASS — the whole suite, including every pre-existing library test.

- [ ] **Step 6: Manual smoke check**

Run: `npm start`

Verify by hand, since none of this is covered by unit tests:
1. The sidebar shows Main Repository, All Builds (by folder), Recently Modified, Shared with me, Unfiled, Untagged.
2. Main Repository lists filed builds **with their folder path** next to the title; All Builds (by folder) does not list them at the top level.
3. By Profession and By Game Mode still work exactly as before.
4. The `+` opens the editor; adding a condition updates the match count live; Save adds a row under "My Smart Folders".
5. Right-click a built-in → Hide removes it; right-click your own → Edit reopens it with its rule intact.
6. Filter in the toolbar → "Save as smart folder" opens the editor pre-filled.
7. Restart the app — user smart folders and hidden built-ins survive.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/library/toolbar.js src/renderer/modules/library/library.js src/renderer/styles/library.css tests/unit/renderer/smart-folder-from-filters.test.js
git commit -m "feat(library): save the current toolbar filters as a smart folder"
```

---

## Notes for the implementer

**The one risky change** is Task 4. Converting `smart-profession` / `smart-gamemode` to generated rules re-expresses behaviour people use every day. The existing `tests/unit/renderer/smart-folder-filtering.test.js` assertions are the guard — port the *navigation* in those tests and change *nothing* about the expectations. If an assertion has to change to make the suite pass, the conversion is wrong, not the test.

**Why `smart-folders.js` may not import `folder-store.js`:** `folder-store.js` imports the evaluator, so the reverse import closes a cycle. Two consequences the plan already accounts for — the evaluator gets the folder tree via `ctx.folders`, and `countSmartFolder()` lives in `sidebar.js` where `libraryBuilds()` is already in scope.

**`FIELD_DEFS` and `FIELDS` must stay in step.** The editor's `FIELD_DEFS` (Task 6) and the evaluator's `FIELDS` (Tasks 1–2) are two lists of the same vocabulary. A field or operator offered in the editor but missing from the evaluator produces a smart folder that silently matches nothing. The first test in Task 6 checks the field names line up; there is no equivalent guard on operators, so add operators to both at once.
