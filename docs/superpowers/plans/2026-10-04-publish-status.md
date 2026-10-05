# Publish Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every build and comp, local or in a team folder, shows whether it is never published, published and current, or published but out of date, and the answer is the same on every teammate's machine.

**Architecture:** Main fingerprints the content that appears on a published page (SHA-256 over stable-key JSON, 16 hex). Publishing stores the fingerprint as a receipt (`publishedHash`, plus `publishedMemberHashes` on comps). That receipt syncs to teammates like the other `published*` fields. Main attaches the current fingerprint as `contentHash` to every record it hands the renderer, and never stores it. Status is a plain comparison done by a CJS module in `src/shared` (main) and an ESM twin in the renderer, locked together by a parity test. A comp's member check reads `state.builds`, so it is right whenever the builds list is fresh.

**Tech Stack:** Electron (main is CommonJS, renderer is ESM served by Vite), node `crypto`, Jest 30 (`babel-jest` transforms `src/renderer/**`), jsdom for renderer tests.

**Spec:** `docs/superpowers/specs/2026-10-04-publish-status-design.md`

## Global Constraints

- Tests: Jest only. Run single files with `npx jest <path>` and the suite with `npm test`. Do **not** run Playwright (`test:e2e`, `test:spa`), which is release-only.
- The renderer cannot import CommonJS from `src/shared` (Vite serves first-party CJS untransformed in dev). Logic both sides need is written twice, in `src/shared/publishState.js` (CJS) and `src/renderer/modules/publish-status.js` (ESM), and a parity test locks them together.
- `contentHash` is attached by main for the renderer and is **never persisted**. The stores already drop unknown fields: `normalizeBuild` is an allowlist and `upsertComp` rebuilds the record field by field.
- Fingerprint: stable-key JSON (keys sorted recursively, `undefined` dropped) → SHA-256 → first 16 hex characters.
- Status values: `"never" | "current" | "stale"`. Comp stale reason: `"self" | "member" | null`.
- Library filter key: `libraryPrefs.activeFilters.publishStatus`, values `current` / `stale` / `never`, labels "Published" / "Out of date" / "Never published". The comps-list Status select values are `published` / `stale` / `draft`.
- Copy: badge labels "Published", "Out of date", "Not published". Tooltips: "Published — up to date", "Changed since last publish", "A build in this comp changed since publish", "Not published yet".
- Do not push, tag or release. Commit on `feat/publish-status` only.

## Review Focus

1. **Bookkeeping must not stale a published item.** A folder move, pin, archive, sort, a save that only fills in `upsertComp` defaults, or regenerated party-line ids must leave a published item "Published". Pinned by fingerprint tests in Task 1 and a store round-trip test in Task 3.
2. **A history revert must keep the current receipt.** History documents carry the receipt from their point in time. Restoring the version that was last published must not make an item read "Published" while the page shows a later publish. Pinned by `withoutPublishReceipt` tests in Task 2 and store tests in Task 3.
3. **Records that arrive outside a list reload must carry `contentHash`.** Team-sync events splice `data.item` straight into state. Pinned by an `annotateSyncEvent` test in Task 1, wired in Task 4.
4. **A stale build lookup must not freeze comp status.** The renderer memoizes the `state.builds` lookup by array identity, and `renderer.js` currently splices sync items into the array in place. Pinned by a `buildLookup` identity test in Task 2, with the in-place splices made immutable in Task 7.
5. **A comp whose member is gone must not read out of date forever.** A trashed member, or one only a teammate has, cannot be judged; republishing would just drop it. Pinned by a missing-member test in Task 2.

---

### Task 1: Fingerprint module

**Files:**
- Create: `src/main/publishFingerprint.js`
- Test: `tests/unit/publishFingerprint.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all CommonJS exports of `src/main/publishFingerprint.js`):
  - `buildFingerprint(build) → string` (16 hex)
  - `compFingerprint(comp) → string`
  - `memberHashes(builds: object[]) → { [buildId]: string }`
  - `buildReceipt(build) → { publishedHash }`
  - `compReceipt(comp, memberBuilds) → { publishedHash, publishedMemberHashes }`
  - `compReceiptAfterRepublish(comp, includedBuilds, skippedIds: string[]) → receipt | null`
  - `annotateBuild(build) → { ...build, contentHash }`, `annotateComp(comp) → { ...comp, contentHash }` (both pass `null`/`undefined` through)
  - `annotateSyncEvent(data) → data` with `data.item` annotated when `data.type` is `"build"` or `"comp"`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/publishFingerprint.test.js`:

```js
"use strict";

const {
  buildFingerprint, compFingerprint, memberHashes, buildReceipt, compReceipt,
  compReceiptAfterRepublish, annotateBuild, annotateComp, annotateSyncEvent,
} = require("../../src/main/publishFingerprint");

function build(over = {}) {
  return {
    id: "b1", version: 2, title: "Heal Druid", profession: "Ranger",
    specializations: [{ id: 5, name: "Druid", elite: true }],
    skills: { heal: { id: 1 }, utility: [{ id: 2 }, null, null], elite: null },
    underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
    equipment: { statPackage: "Harrier" }, tags: ["heal"], notes: "n", images: {},
    gameMode: "wvw", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    buildUrl: "", publishedSlug: "", publishedFileId: "", publishedKey: "", publishedAt: null,
    publishedOwner: "", publishedHash: "", folderId: null, compIds: [], pinned: false,
    deletedAt: null, trashBatchId: "", trashRoot: false, archivedAt: null, archiveBatchId: "",
    archiveRoot: false, sortOrder: 0, selectedLegends: ["", ""], selectedUnderwaterLegends: ["", ""],
    activeLegendSlot: 0, selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
    morphSkillIds: [0, 0, 0],
    ...over,
  };
}

function comp(over = {}) {
  return {
    id: "c1", name: "Squad", notes: "", images: {}, tags: [], folderId: null, sortOrder: 0,
    buildIds: ["b1"], partyLines: [{ id: "l1", capacity: 5, slots: ["b1"] }], gameMode: "wvw",
    buildColors: {}, categories: [], createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...over,
  };
}

describe("buildFingerprint", () => {
  test("is 16 hex characters", () => {
    expect(buildFingerprint(build())).toMatch(/^[0-9a-f]{16}$/);
  });

  test("does not depend on key order", () => {
    const b = build();
    const reversed = Object.fromEntries(Object.entries(b).reverse());
    expect(buildFingerprint(reversed)).toBe(buildFingerprint(b));
  });

  test("ignores identity, timestamps, receipts and library bookkeeping", () => {
    const base = buildFingerprint(build());
    expect(buildFingerprint(build({
      id: "other", updatedAt: "2027-01-01T00:00:00.000Z", createdAt: "2027-01-01T00:00:00.000Z",
      publishedFileId: "f", publishedKey: "k", publishedSlug: "s", publishedAt: "2027-01-01T00:00:00.000Z",
      publishedOwner: "o", publishedHash: "abc", folderId: "f1", compIds: ["c1"], pinned: true,
      sortOrder: 9, deletedAt: "2027-01-01T00:00:00.000Z", trashBatchId: "t", trashRoot: true,
      archivedAt: "2027-01-01T00:00:00.000Z", archiveBatchId: "a", archiveRoot: true,
      activeLegendSlot: 1, buildUrl: "https://x", contentHash: "zzz",
    }))).toBe(base);
  });

  test("changes when a title or a skill changes", () => {
    const base = buildFingerprint(build());
    expect(buildFingerprint(build({ title: "Heal Druid v2" }))).not.toBe(base);
    expect(buildFingerprint(build({ skills: { heal: { id: 99 }, utility: [{ id: 2 }, null, null], elite: null } }))).not.toBe(base);
  });

  test("covers content fields it was never told about", () => {
    expect(buildFingerprint(build({ someFutureField: 1 }))).not.toBe(buildFingerprint(build()));
  });
});

describe("compFingerprint", () => {
  test("ignores bookkeeping and party-line ids", () => {
    const base = compFingerprint(comp());
    expect(compFingerprint(comp({
      id: "x", folderId: "f", sortOrder: 4, updatedAt: "2027-01-01T00:00:00.000Z",
      publishedFileId: "f", publishedHash: "h", publishedMemberHashes: { b1: "m" },
      boonCoverageHtml: "<p>", archivedAt: "2027-01-01T00:00:00.000Z",
      partyLines: [{ id: "regenerated", capacity: 5, slots: ["b1"] }],
    }))).toBe(base);
  });

  test("absent fields hash as their upsertComp defaults", () => {
    const full = comp({ notes: "", images: {}, tags: [], buildColors: {}, categories: [] });
    const sparse = comp();
    for (const k of ["notes", "images", "tags", "buildColors", "categories"]) delete sparse[k];
    expect(compFingerprint(sparse)).toBe(compFingerprint(full));
  });

  test("changes when the name, a slot or the membership changes", () => {
    const base = compFingerprint(comp());
    expect(compFingerprint(comp({ name: "Squad 2" }))).not.toBe(base);
    expect(compFingerprint(comp({ partyLines: [{ id: "l1", capacity: 5, slots: [] }] }))).not.toBe(base);
    expect(compFingerprint(comp({ buildIds: ["b1", "b2"] }))).not.toBe(base);
  });
});

describe("receipts", () => {
  test("buildReceipt carries the build's fingerprint", () => {
    expect(buildReceipt(build())).toEqual({ publishedHash: buildFingerprint(build()) });
  });

  test("compReceipt carries the comp's own hash and one hash per member", () => {
    const b2 = build({ id: "b2", title: "Firebrand" });
    expect(compReceipt(comp(), [build(), b2])).toEqual({
      publishedHash: compFingerprint(comp()),
      publishedMemberHashes: { b1: buildFingerprint(build()), b2: buildFingerprint(b2) },
    });
    expect(memberHashes([build()])).toEqual({ b1: buildFingerprint(build()) });
  });

  test("a re-upload that left a member out yields no receipt", () => {
    expect(compReceiptAfterRepublish(comp(), [build()], ["b2"])).toBeNull();
    expect(compReceiptAfterRepublish(comp(), [build()], [])).toEqual(compReceipt(comp(), [build()]));
  });
});

describe("annotation", () => {
  test("annotateBuild / annotateComp attach the current fingerprint without mutating", () => {
    const b = build();
    const out = annotateBuild(b);
    expect(out.contentHash).toBe(buildFingerprint(b));
    expect(b.contentHash).toBeUndefined();
    expect(annotateComp(comp()).contentHash).toBe(compFingerprint(comp()));
    expect(annotateBuild(null)).toBeNull();
    expect(annotateComp(undefined)).toBeUndefined();
  });

  test("annotateSyncEvent annotates build and comp items only", () => {
    expect(annotateSyncEvent({ type: "build", id: "b1", item: build() }).item.contentHash)
      .toBe(buildFingerprint(build()));
    expect(annotateSyncEvent({ type: "comp", id: "c1", item: comp() }).item.contentHash)
      .toBe(compFingerprint(comp()));
    const folder = { type: "folder", id: "f", item: { name: "F" } };
    expect(annotateSyncEvent(folder)).toBe(folder);
    const noItem = { status: "synced", folderId: "t" };
    expect(annotateSyncEvent(noItem)).toBe(noItem);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/publishFingerprint.test.js`
Expected: FAIL with "Cannot find module '../../src/main/publishFingerprint'".

- [ ] **Step 3: Write the implementation**

Create `src/main/publishFingerprint.js`:

```js
"use strict";

const crypto = require("node:crypto");

// Everything on a normalized build that is NOT on its published page: identity,
// timestamps, the publish receipt itself, and this machine's library
// bookkeeping. An exclusion list rather than an allowlist, so a content field
// added to normalizeBuild later counts as content without anyone remembering to
// add it here. activeLegendSlot is a view toggle (history treats it as
// bookkeeping too); contentHash is what main attaches for the renderer.
const BUILD_NON_CONTENT = new Set([
  "id", "version", "createdAt", "updatedAt", "buildUrl",
  "publishedSlug", "publishedFileId", "publishedKey", "publishedAt", "publishedOwner", "publishedHash",
  "folderId", "compIds", "pinned", "sortOrder",
  "deletedAt", "trashBatchId", "trashRoot", "archivedAt", "archiveBatchId", "archiveRoot",
  "activeLegendSlot", "contentHash",
]);

// Keys sorted at every depth and undefined dropped, so two machines holding the
// same record hash it the same no matter how it was assembled.
function stable(value) {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : stable(v)));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = stable(value[key]);
    }
    return out;
  }
  return value;
}

function hashOf(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex").slice(0, 16);
}

/** Fingerprint of a normalized build's published-page content. */
function buildFingerprint(build) {
  const projection = {};
  for (const [key, value] of Object.entries(build || {})) {
    if (!BUILD_NON_CONTENT.has(key)) projection[key] = value;
  }
  return hashOf(projection);
}

/**
 * Fingerprint of a comp's OWN page fields. Member builds are receipted
 * separately (publishedMemberHashes) so the renderer can tell a comp edit from
 * a member edit. Absent fields hash as upsertComp's defaults, and party-line
 * ids are left out: they are not shown, and legacy lines get fresh ones on save.
 */
function compFingerprint(comp) {
  const c = comp || {};
  return hashOf({
    name: c.name || "",
    notes: c.notes || "",
    images: c.images || {},
    tags: c.tags || [],
    buildIds: c.buildIds || [],
    partyLines: (c.partyLines || []).map((line) => ({
      capacity: typeof line?.capacity === "number" ? line.capacity : 5,
      slots: Array.isArray(line?.slots) ? line.slots : [],
    })),
    gameMode: c.gameMode || null,
    buildColors: c.buildColors || {},
    categories: c.categories || [],
  });
}

function memberHashes(builds) {
  const out = {};
  for (const b of builds || []) out[b.id] = buildFingerprint(b);
  return out;
}

function buildReceipt(build) {
  return { publishedHash: buildFingerprint(build) };
}

function compReceipt(comp, memberBuilds) {
  return { publishedHash: compFingerprint(comp), publishedMemberHashes: memberHashes(memberBuilds) };
}

/**
 * Receipt for a comp a build publish re-uploaded, or null when that upload left
 * a member out (it failed to enrich): the page is incomplete, so the comp must
 * keep reading out of date.
 */
function compReceiptAfterRepublish(comp, includedBuilds, skippedIds) {
  if (skippedIds && skippedIds.length) return null;
  return compReceipt(comp, includedBuilds);
}

function annotateBuild(build) {
  return build ? { ...build, contentHash: buildFingerprint(build) } : build;
}

function annotateComp(comp) {
  return comp ? { ...comp, contentHash: compFingerprint(comp) } : comp;
}

// Team-sync events hand the renderer a freshly pulled record that it splices
// straight into state, bypassing the list handlers that normally annotate.
function annotateSyncEvent(data) {
  if (!data || !data.item) return data;
  if (data.type === "build") return { ...data, item: annotateBuild(data.item) };
  if (data.type === "comp") return { ...data, item: annotateComp(data.item) };
  return data;
}

module.exports = {
  buildFingerprint,
  compFingerprint,
  memberHashes,
  buildReceipt,
  compReceipt,
  compReceiptAfterRepublish,
  annotateBuild,
  annotateComp,
  annotateSyncEvent,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/publishFingerprint.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/publishFingerprint.js tests/unit/publishFingerprint.test.js
git commit -m "feat(publish): content fingerprint for builds and comps"
```

---

### Task 2: Status predicates (CJS + ESM twin) and share gating

**Files:**
- Modify: `src/shared/publishState.js` (whole file)
- Create: `src/renderer/modules/publish-status.js`
- Modify: `src/main/shareGate.js` (whole file)
- Modify: `src/renderer/modules/share-gate.js` (whole file)
- Modify: `src/renderer/modules/comps/comp-detail.js:454` (the `compShareDisabledTooltip(comp)` call)
- Test: `tests/unit/publishState.test.js` (rewrite), `tests/unit/shareGate.test.js` (add), `tests/unit/renderer/share-gate.test.js` (rewrite parity block), `tests/unit/renderer/publish-status.test.js` (create), `tests/unit/jsonFile.test.js:144-145`

**Interfaces:**
- Consumes: nothing at runtime. Tests use `buildFingerprint`/`compFingerprint` from Task 1 only to build fixtures.
- Produces:
  - CJS `src/shared/publishState.js`: `publishStatus(record) → "never"|"current"|"stale"`, `compPublishStatus(comp, buildOf?: (id) => record|undefined) → { status, reason }`, `withoutPublishReceipt(record) → copy`, `PUBLISH_RECEIPT_FIELDS: string[]`.
  - ESM `src/renderer/modules/publish-status.js`: the same four exports, plus `buildLookup(builds[]) → (id) => record|undefined`, `itemPublishStatus(type, item, builds) → { status, reason }`, `describePublishStatus(status, reason)`, `publishBadgeHtml(status, { reason, editor })`, `itemPublishBadgeHtml(type, item, builds)`, `matchesPublishFilter(type, item, builds, selected[])`, `compMatchesStatusFilter(comp, value, builds)`, `compPublishChipHtml(status, { small })`.
  - `shareRejectionReason(record, noun, buildOf?)`. With a `buildOf` it applies the comp member check.
  - `compShareDisabledTooltip(comp, builds?)` and `shareDisabledTooltip(build, editorDirty)`.

- [ ] **Step 1: Write the failing tests**

Replace all of `tests/unit/publishState.test.js` with:

```js
"use strict";
const {
  publishStatus, compPublishStatus, withoutPublishReceipt, PUBLISH_RECEIPT_FIELDS,
} = require("../../src/shared/publishState");

describe("publishStatus", () => {
  test("never published", () => {
    expect(publishStatus({ publishedFileId: "" })).toBe("never");
    expect(publishStatus(null)).toBe("never");
  });

  test("hash receipt: current when the content matches, stale when it does not", () => {
    expect(publishStatus({ publishedFileId: "f", publishedHash: "aaa", contentHash: "aaa" })).toBe("current");
    expect(publishStatus({ publishedFileId: "f", publishedHash: "aaa", contentHash: "bbb" })).toBe("stale");
  });

  test("hash receipt ignores timestamps — a team pull rewrites updatedAt", () => {
    expect(publishStatus({
      publishedFileId: "f", publishedHash: "aaa", contentHash: "aaa", updatedAt: "t9", publishedAt: "t1",
    })).toBe("current");
  });

  test("an un-annotated record with a receipt reads current until main annotates it", () => {
    expect(publishStatus({ publishedFileId: "f", publishedHash: "aaa" })).toBe("current");
  });

  test("legacy (no hash): falls back to updatedAt vs publishedAt", () => {
    expect(publishStatus({ publishedFileId: "f", updatedAt: "t1", publishedAt: "t1" })).toBe("current");
    expect(publishStatus({ publishedFileId: "f", updatedAt: "t2", publishedAt: "t1" })).toBe("stale");
    expect(publishStatus({ publishedFileId: "f", updatedAt: "t9", publishedAt: null })).toBe("current");
  });
});

describe("compPublishStatus", () => {
  const builds = new Map([
    ["b1", { id: "b1", contentHash: "h1" }],
    ["b2", { id: "b2", contentHash: "h2" }],
    ["b3", { id: "b3" }],
  ]);
  const buildOf = (id) => builds.get(id);
  const comp = (over = {}) => ({
    publishedFileId: "c", publishedHash: "self", contentHash: "self",
    publishedMemberHashes: { b1: "h1", b2: "h2" }, ...over,
  });

  test("never / own-field staleness come first", () => {
    expect(compPublishStatus({ publishedFileId: "" }, buildOf)).toEqual({ status: "never", reason: null });
    expect(compPublishStatus(comp({ contentHash: "edited" }), buildOf)).toEqual({ status: "stale", reason: "self" });
  });

  test("current when the comp and every member match", () => {
    expect(compPublishStatus(comp(), buildOf)).toEqual({ status: "current", reason: null });
  });

  test("a changed member makes the comp stale with reason member", () => {
    expect(compPublishStatus(comp({ publishedMemberHashes: { b1: "old", b2: "h2" } }), buildOf))
      .toEqual({ status: "stale", reason: "member" });
  });

  test("a member that is gone, or not annotated, cannot be judged and is skipped", () => {
    expect(compPublishStatus(comp({ publishedMemberHashes: { b1: "h1", gone: "x", b3: "y" } }), buildOf))
      .toEqual({ status: "current", reason: null });
  });

  test("legacy comps (no hash) and a missing lookup skip the member check", () => {
    expect(compPublishStatus({ publishedFileId: "c", updatedAt: "t", publishedAt: "t", publishedMemberHashes: { b1: "old" } }, buildOf))
      .toEqual({ status: "current", reason: null });
    expect(compPublishStatus(comp({ publishedMemberHashes: { b1: "old" } })))
      .toEqual({ status: "current", reason: null });
  });

  test("tolerates a null comp", () => {
    expect(compPublishStatus(null, buildOf)).toEqual({ status: "never", reason: null });
  });
});

describe("withoutPublishReceipt", () => {
  test("drops every receipt field and nothing else, without mutating", () => {
    const rec = {
      id: "b1", title: "T", publishedSlug: "s", publishedFileId: "f", publishedKey: "k",
      publishedAt: "t", publishedOwner: "o", publishedHash: "h", publishedMemberHashes: { b: "m" },
    };
    expect(withoutPublishReceipt(rec)).toEqual({ id: "b1", title: "T" });
    expect(rec.publishedHash).toBe("h");
    expect(PUBLISH_RECEIPT_FIELDS).toEqual([
      "publishedSlug", "publishedFileId", "publishedKey", "publishedAt", "publishedOwner",
      "publishedHash", "publishedMemberHashes",
    ]);
  });
});
```

Append to `tests/unit/shareGate.test.js`, inside the existing `describe("shareRejectionReason", ...)` block before its closing `});`:

```js
  test("hash receipt: a teammate-published build is shareable despite a newer local updatedAt", () => {
    expect(shareRejectionReason({
      publishedFileId: "x", publishedKey: "k", publishedHash: "h", contentHash: "h", updatedAt: "t9", publishedAt: "t1",
    }, "Build")).toBeNull();
  });
  test("hash receipt: edited content is rejected", () => {
    expect(shareRejectionReason({
      publishedFileId: "x", publishedKey: "k", publishedHash: "h", contentHash: "edited",
    }, "Build")).toBe("Build has unpublished changes — publish again before sharing.");
  });
  test("comps with a lookup: a changed member is rejected", () => {
    const buildOf = (id) => (id === "b1" ? { id: "b1", contentHash: "new" } : undefined);
    expect(shareRejectionReason({
      publishedFileId: "x", publishedKey: "k", publishedHash: "h", contentHash: "h", publishedMemberHashes: { b1: "old" },
    }, "Comp", buildOf)).toBe("Comp has unpublished changes — publish again before sharing.");
  });
```

In `tests/unit/renderer/share-gate.test.js`, replace line 3 and the final `describe("share-gate parity with buildPublishState", ...)` block (from line 41 to the end of the file) with the following. The top `require` of `buildPublishState` becomes this:

```js
const { publishStatus } = require("../../../src/shared/publishState");
```

and the parity block, plus new comp-member tests, becomes:

```js
// Parity: the renderer's tooltip must agree with the canonical CJS status.
describe("share-gate parity with publishStatus", () => {
  const matrix = [
    { publishedFileId: "", updatedAt: "t", publishedAt: null },
    { publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" },
    { publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" },
    { publishedFileId: "x", updatedAt: "t9", publishedAt: null },
    { publishedFileId: "x", publishedHash: "h", contentHash: "h", updatedAt: "t9", publishedAt: "t1" },
    { publishedFileId: "x", publishedHash: "h", contentHash: "other" },
  ];
  test.each(matrix)("enabled iff current for %j", (rec) => {
    const enabled = shareDisabledTooltip(rec, false) === null;
    expect(enabled).toBe(publishStatus(rec) === "current");
  });
});

describe("compShareDisabledTooltip with member builds", () => {
  const comp = { publishedFileId: "x", publishedHash: "h", contentHash: "h", publishedMemberHashes: { b1: "old" } };
  test("a changed member blocks sharing", () => {
    expect(compShareDisabledTooltip(comp, [{ id: "b1", contentHash: "new" }]))
      .toBe("Publish your latest changes first");
  });
  test("matching members allow it", () => {
    expect(compShareDisabledTooltip(comp, [{ id: "b1", contentHash: "old" }])).toBeNull();
  });
});
```

Create `tests/unit/renderer/publish-status.test.js`:

```js
/** @jest-environment jsdom */
"use strict";

const esm = require("../../../src/renderer/modules/publish-status.js");
const cjs = require("../../../src/shared/publishState");

// Parity: the ESM twin must agree with the CJS module main uses.
describe("publish-status parity with src/shared/publishState", () => {
  const records = [
    null,
    { publishedFileId: "" },
    { publishedFileId: "f", updatedAt: "t1", publishedAt: "t1" },
    { publishedFileId: "f", updatedAt: "t2", publishedAt: "t1" },
    { publishedFileId: "f", updatedAt: "t9", publishedAt: null },
    { publishedFileId: "f", publishedHash: "a", contentHash: "a" },
    { publishedFileId: "f", publishedHash: "a", contentHash: "b" },
    { publishedFileId: "f", publishedHash: "a" },
  ];
  test.each(records)("publishStatus agrees for %j", (rec) => {
    expect(esm.publishStatus(rec)).toBe(cjs.publishStatus(rec));
  });

  const builds = [{ id: "b1", contentHash: "h1" }, { id: "b2" }];
  const buildOf = (id) => builds.find((b) => b.id === id);
  const comps = [
    { publishedFileId: "" },
    { publishedFileId: "c", publishedHash: "s", contentHash: "s", publishedMemberHashes: { b1: "h1" } },
    { publishedFileId: "c", publishedHash: "s", contentHash: "s", publishedMemberHashes: { b1: "old" } },
    { publishedFileId: "c", publishedHash: "s", contentHash: "x", publishedMemberHashes: { b1: "h1" } },
    { publishedFileId: "c", publishedHash: "s", contentHash: "s", publishedMemberHashes: { b2: "z", gone: "y" } },
    { publishedFileId: "c", updatedAt: "t2", publishedAt: "t1" },
  ];
  test.each(comps)("compPublishStatus agrees for %j", (comp) => {
    expect(esm.compPublishStatus(comp, buildOf)).toEqual(cjs.compPublishStatus(comp, buildOf));
  });

  test("receipt field lists match", () => {
    expect(esm.PUBLISH_RECEIPT_FIELDS).toEqual(cjs.PUBLISH_RECEIPT_FIELDS);
    const rec = { id: "a", publishedHash: "h", publishedFileId: "f", title: "T" };
    expect(esm.withoutPublishReceipt(rec)).toEqual(cjs.withoutPublishReceipt(rec));
  });
});

describe("buildLookup", () => {
  test("finds builds by id and follows a replaced array", () => {
    const first = [{ id: "b1", contentHash: "a" }];
    expect(esm.buildLookup(first)("b1").contentHash).toBe("a");
    const second = [{ id: "b1", contentHash: "b" }];
    expect(esm.buildLookup(second)("b1").contentHash).toBe("b");
    expect(esm.buildLookup(undefined)("b1")).toBeUndefined();
  });
});

describe("publishBadgeHtml", () => {
  const el = (html) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild;
  };

  test("current and stale render a mark; never renders nothing in rows", () => {
    expect(el(esm.publishBadgeHtml("current")).className).toBe("publish-badge publish-badge--current");
    expect(el(esm.publishBadgeHtml("current")).title).toBe("Published — up to date");
    expect(el(esm.publishBadgeHtml("stale")).className).toBe("publish-badge publish-badge--stale");
    expect(el(esm.publishBadgeHtml("stale")).title).toBe("Changed since last publish");
    expect(el(esm.publishBadgeHtml("stale", { reason: "member" })).title)
      .toBe("A build in this comp changed since publish");
    expect(esm.publishBadgeHtml("never")).toBe("");
    expect(esm.publishBadgeHtml(undefined)).toBe("");
  });

  test("the editor variant carries a label and shows never", () => {
    const never = el(esm.publishBadgeHtml("never", { editor: true }));
    expect(never.className).toBe("publish-badge publish-badge--editor publish-badge--never");
    expect(never.textContent).toBe("Not published");
    expect(el(esm.publishBadgeHtml("stale", { editor: true })).textContent).toBe("Out of date");
    expect(el(esm.publishBadgeHtml("current", { editor: true })).textContent).toBe("Published");
  });

  test("itemPublishBadgeHtml resolves comps against the builds list", () => {
    const comp = { publishedFileId: "c", publishedHash: "s", contentHash: "s", publishedMemberHashes: { b1: "old" } };
    const html = esm.itemPublishBadgeHtml("comp", comp, [{ id: "b1", contentHash: "new" }]);
    expect(el(html).title).toBe("A build in this comp changed since publish");
    expect(esm.itemPublishBadgeHtml("build", { publishedFileId: "" }, [])).toBe("");
  });
});

describe("filters", () => {
  const builds = [{ id: "b1", contentHash: "new" }];
  const stale = { publishedFileId: "f", publishedHash: "a", contentHash: "b" };
  const never = { publishedFileId: "" };
  const current = { publishedFileId: "f", publishedHash: "a", contentHash: "a" };

  test("matchesPublishFilter passes everything when nothing is selected", () => {
    expect(esm.matchesPublishFilter("build", never, builds, [])).toBe(true);
    expect(esm.matchesPublishFilter("build", never, builds, undefined)).toBe(true);
  });

  test("matchesPublishFilter matches any selected status", () => {
    expect(esm.matchesPublishFilter("build", stale, builds, ["stale"])).toBe(true);
    expect(esm.matchesPublishFilter("build", current, builds, ["stale", "never"])).toBe(false);
    expect(esm.matchesPublishFilter("build", never, builds, ["stale", "never"])).toBe(true);
    const memberStale = { ...current, publishedMemberHashes: { b1: "old" } };
    expect(esm.matchesPublishFilter("comp", memberStale, builds, ["stale"])).toBe(true);
  });

  test("compMatchesStatusFilter maps the comps-list select values", () => {
    expect(esm.compMatchesStatusFilter(current, "published", builds)).toBe(true);
    expect(esm.compMatchesStatusFilter(stale, "published", builds)).toBe(false);
    expect(esm.compMatchesStatusFilter(stale, "stale", builds)).toBe(true);
    expect(esm.compMatchesStatusFilter(never, "draft", builds)).toBe(true);
    expect(esm.compMatchesStatusFilter(never, null, builds)).toBe(true);
  });

  test("compPublishChipHtml renders the three chips", () => {
    expect(esm.compPublishChipHtml("current")).toContain("Published");
    expect(esm.compPublishChipHtml("stale")).toContain("Out of date");
    expect(esm.compPublishChipHtml("stale")).toContain("axi-chip--warn");
    expect(esm.compPublishChipHtml("never")).toContain("Draft");
    expect(esm.compPublishChipHtml("current", { small: true })).toContain("comp-badge--sm");
  });
});
```

In `tests/unit/jsonFile.test.js`, replace lines 144-145:

```js
    const { buildPublishState } = require("../../src/shared/publishState");
    expect(buildPublishState(out).stale).toBe(true);
```

with:

```js
    const { publishStatus } = require("../../src/shared/publishState");
    expect(publishStatus(out)).toBe("stale");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/publishState.test.js tests/unit/shareGate.test.js tests/unit/renderer/share-gate.test.js tests/unit/renderer/publish-status.test.js tests/unit/jsonFile.test.js`
Expected: FAIL. `publishStatus is not a function`, and "Cannot find module .../publish-status.js".

- [ ] **Step 3: Write the CJS module**

Replace all of `src/shared/publishState.js` with:

```js
"use strict";

// The publish receipt: what a record says about its last publish. A history
// document or a duplicated record must not carry these over.
const PUBLISH_RECEIPT_FIELDS = [
  "publishedSlug", "publishedFileId", "publishedKey", "publishedAt", "publishedOwner",
  "publishedHash", "publishedMemberHashes",
];

/**
 * Publish status of a build, or of a comp's own fields.
 *
 * With a hash receipt (publishedHash) the answer is content-derived: main
 * attaches the current fingerprint as contentHash. A record main has not
 * annotated yet reads current until the next list reload. Legacy records,
 * published before receipts existed, fall back to updatedAt vs publishedAt.
 *
 * @returns {"never"|"current"|"stale"}
 */
function publishStatus(record) {
  const r = record || {};
  if (!r.publishedFileId) return "never";
  if (r.publishedHash) {
    if (!r.contentHash) return "current";
    return r.contentHash === r.publishedHash ? "current" : "stale";
  }
  return r.publishedAt && r.updatedAt !== r.publishedAt ? "stale" : "current";
}

/**
 * A comp is also out of date when a member build changed since the comp page
 * was uploaded. A member that is not in the library, or not annotated, cannot
 * be judged and is skipped.
 *
 * @param {object} comp
 * @param {(id: string) => object|undefined} [buildOf]
 * @returns {{status: "never"|"current"|"stale", reason: "self"|"member"|null}}
 */
function compPublishStatus(comp, buildOf) {
  const c = comp || {};
  const status = publishStatus(c);
  if (status !== "current") return { status, reason: status === "stale" ? "self" : null };
  if (c.publishedHash && typeof buildOf === "function") {
    for (const [id, hash] of Object.entries(c.publishedMemberHashes || {})) {
      const member = buildOf(id);
      if (member && member.contentHash && member.contentHash !== hash) {
        return { status: "stale", reason: "member" };
      }
    }
  }
  return { status: "current", reason: null };
}

function withoutPublishReceipt(record) {
  const out = { ...(record || {}) };
  for (const key of PUBLISH_RECEIPT_FIELDS) delete out[key];
  return out;
}

module.exports = { publishStatus, compPublishStatus, withoutPublishReceipt, PUBLISH_RECEIPT_FIELDS };
```

- [ ] **Step 4: Write the ESM twin**

Create `src/renderer/modules/publish-status.js`:

```js
// Mirrors src/shared/publishState.js (CJS, used by the main process). The
// renderer cannot import that CJS module — Vite serves first-party CommonJS
// untransformed in dev — so publishStatus, compPublishStatus and the receipt
// list are reimplemented here as ESM. tests/unit/renderer/publish-status.test.js
// locks the two in sync. Records arrive from main with contentHash attached.

export const PUBLISH_RECEIPT_FIELDS = [
  "publishedSlug", "publishedFileId", "publishedKey", "publishedAt", "publishedOwner",
  "publishedHash", "publishedMemberHashes",
];

export function publishStatus(record) {
  const r = record || {};
  if (!r.publishedFileId) return "never";
  if (r.publishedHash) {
    if (!r.contentHash) return "current";
    return r.contentHash === r.publishedHash ? "current" : "stale";
  }
  return r.publishedAt && r.updatedAt !== r.publishedAt ? "stale" : "current";
}

export function compPublishStatus(comp, buildOf) {
  const c = comp || {};
  const status = publishStatus(c);
  if (status !== "current") return { status, reason: status === "stale" ? "self" : null };
  if (c.publishedHash && typeof buildOf === "function") {
    for (const [id, hash] of Object.entries(c.publishedMemberHashes || {})) {
      const member = buildOf(id);
      if (member && member.contentHash && member.contentHash !== hash) {
        return { status: "stale", reason: "member" };
      }
    }
  }
  return { status: "current", reason: null };
}

export function withoutPublishReceipt(record) {
  const out = { ...(record || {}) };
  for (const key of PUBLISH_RECEIPT_FIELDS) delete out[key];
  return out;
}

// One id -> build map per builds array. state.builds is REPLACED on every
// reload and sync splice (never mutated in place), so array identity is a
// sound cache key.
const _lookups = new WeakMap();
export function buildLookup(builds) {
  if (!Array.isArray(builds)) return () => undefined;
  let map = _lookups.get(builds);
  if (!map) {
    map = new Map(builds.map((b) => [b.id, b]));
    _lookups.set(builds, map);
  }
  return (id) => map.get(id);
}

export function itemPublishStatus(type, item, builds) {
  return type === "comp"
    ? compPublishStatus(item, buildLookup(builds))
    : { status: publishStatus(item), reason: null };
}

const GLOBE = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/></svg>`;

export function describePublishStatus(status, reason) {
  if (status === "current") return { className: "--current", label: "Published", title: "Published — up to date" };
  if (status === "stale") {
    return {
      className: "--stale",
      label: "Out of date",
      title: reason === "member" ? "A build in this comp changed since publish" : "Changed since last publish",
    };
  }
  if (status === "never") return { className: "--never", label: "Not published", title: "Not published yet" };
  return null;
}

/**
 * Publish mark, styled after the sync indicator. Library rows show nothing for
 * a never-published item; the editor variant labels every state.
 */
export function publishBadgeHtml(status, { reason = null, editor = false } = {}) {
  if (!editor && status === "never") return "";
  const d = describePublishStatus(status, reason);
  if (!d) return "";
  const base = editor ? "publish-badge publish-badge--editor" : "publish-badge";
  const label = editor ? `<span class="publish-badge__label">${d.label}</span>` : "";
  return `<span class="${base} publish-badge${d.className}" title="${d.title}">${GLOBE}${label}</span>`;
}

export function itemPublishBadgeHtml(type, item, builds) {
  const { status, reason } = itemPublishStatus(type, item, builds);
  return publishBadgeHtml(status, { reason });
}

/** Library toolbar filter: `selected` is a list of statuses, empty = all. */
export function matchesPublishFilter(type, item, builds, selected) {
  if (!Array.isArray(selected) || selected.length === 0) return true;
  return selected.includes(itemPublishStatus(type, item, builds).status);
}

// The comps page Status select stores these values.
const COMP_LIST_STATUS = { published: "current", stale: "stale", draft: "never" };

export function compMatchesStatusFilter(comp, value, builds) {
  const want = COMP_LIST_STATUS[value];
  if (!want) return true;
  return compPublishStatus(comp, buildLookup(builds)).status === want;
}

export function compPublishChipHtml(status, { small = false } = {}) {
  const sm = small ? " comp-badge--sm" : "";
  if (status === "current") return `<span class="axi-chip axi-chip--ok comp-badge comp-badge--published${sm}">Published</span>`;
  if (status === "stale") return `<span class="axi-chip axi-chip--warn comp-badge comp-badge--stale${sm}" title="Changed since last publish">Out of date</span>`;
  return `<span class="axi-chip comp-badge comp-badge--draft${sm}">Draft</span>`;
}
```

- [ ] **Step 5: Switch the share gates**

Replace all of `src/main/shareGate.js` with:

```js
"use strict";
const { publishStatus, compPublishStatus } = require("../shared/publishState");

/**
 * @param {object} record build or comp, annotated with contentHash by main
 * @param {"Build"|"Comp"} noun
 * @param {(id: string) => object|undefined} [buildOf] comps only: resolves
 *   member builds (annotated) so a changed member blocks sharing too
 * @returns {string|null} rejection message, or null if shareable
 */
function shareRejectionReason(record, noun, buildOf) {
  const r = record || {};
  if (!r.publishedFileId || !r.publishedKey) {
    return `${noun} must be published before sharing`;
  }
  const status = buildOf ? compPublishStatus(r, buildOf).status : publishStatus(r);
  if (status === "stale") {
    return `${noun} has unpublished changes — publish again before sharing.`;
  }
  return null;
}

module.exports = { shareRejectionReason };
```

Replace all of `src/renderer/modules/share-gate.js` with:

```js
// Tooltips for the Discord share buttons. Status comes from publish-status.js,
// the ESM twin of src/shared/publishState.js (which main's shareGate.js uses).
import { publishStatus, compPublishStatus, buildLookup } from "./publish-status.js";

export function compShareDisabledTooltip(comp, builds) {
  const { status } = compPublishStatus(comp, buildLookup(builds));
  if (status === "never") return "Publish this comp first";
  if (status === "stale") return "Publish your latest changes first";
  return null;
}

export function shareDisabledTooltip(build, editorDirty) {
  const status = publishStatus(build);
  if (status === "never") return "Publish this build first";
  if (status === "stale" || editorDirty) return "Publish your latest changes first";
  return null;
}
```

In `src/renderer/modules/comps/comp-detail.js` (line 454), find:

```js
  const compShareTip = compShareDisabledTooltip(comp);
```

replace with:

```js
  const compShareTip = compShareDisabledTooltip(comp, state.builds);
```

- [ ] **Step 6: Confirm nothing else uses the old API**

Run: `grep -rn "buildPublishState" src tests`
Expected: no output.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest tests/unit/publishState.test.js tests/unit/shareGate.test.js tests/unit/renderer/share-gate.test.js tests/unit/renderer/publish-status.test.js tests/unit/jsonFile.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/publishState.js src/renderer/modules/publish-status.js src/main/shareGate.js src/renderer/modules/share-gate.js src/renderer/modules/comps/comp-detail.js tests/unit/publishState.test.js tests/unit/shareGate.test.js tests/unit/renderer/share-gate.test.js tests/unit/renderer/publish-status.test.js tests/unit/jsonFile.test.js
git commit -m "feat(publish): content-derived publish status, shared by main and renderer"
```

---

### Task 3: Stores, history and team pull carry the receipt

**Files:**
- Modify: `src/main/buildStore.js` (`upsertBuild` ~:220-240, `markPublished` ~:440-458, `normalizeBuild` ~:518)
- Modify: `src/main/compStore.js` (`upsertComp` `publishedPatch` ~:203-209, `markPublished` ~:333-343)
- Modify: `src/main/history/constants.js` (`NON_VERSIONED_PATHS`, ~:99-110)
- Test: `tests/unit/buildStore.test.js`, `tests/unit/compStore.test.js`, `tests/unit/buildHistoryStore.test.js`, `tests/unit/compHistoryStore.test.js`, `tests/unit/teamSync.pull.test.js`

**Interfaces:**
- Consumes: `buildFingerprint`, `compFingerprint`, `annotateBuild`, `annotateComp` (Task 1) and `publishStatus`, `withoutPublishReceipt` (Task 2), in tests only.
- Produces:
  - `BuildStore#markPublished(id, { publishedFileId, publishedKey, publishedSlug, publishedOwner, publishedHash, snapshotUpdatedAt })`.
  - `CompStore#markPublished(id, { publishedFileId, publishedKey, publishedSlug, publishedOwner, boonCoverageHtml, publishedHash, publishedMemberHashes, snapshotUpdatedAt })`. Every field is optional; an absent field leaves the stored value alone.
  - `upsertBuild`/`upsertComp` accept `publishedHash` (and `publishedMemberHashes` and `publishedAt` for comps), and keep stored values when the input omits them.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/buildStore.test.js`. The file already defines `makeTempStore`, `cleanupDir` and `makeBuild`:

```js
describe("BuildStore — publish receipt", () => {
  const { buildFingerprint, annotateBuild } = require("../../src/main/publishFingerprint");
  const { publishStatus, withoutPublishReceipt } = require("../../src/shared/publishState");
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(() => cleanupDir(dir));

  test("markPublished stores publishedHash", async () => {
    const saved = await store.upsertBuild(makeBuild());
    const out = await store.markPublished(saved.id, {
      publishedFileId: "f1", publishedKey: "k1", publishedSlug: "s", publishedHash: buildFingerprint(saved),
      snapshotUpdatedAt: saved.updatedAt,
    });
    expect(out.publishedHash).toBe(buildFingerprint(saved));
    expect(publishStatus(annotateBuild(out))).toBe("current");
  });

  test("an editor save (no receipt in the payload) keeps the receipt and reads stale after an edit", async () => {
    const saved = await store.upsertBuild(makeBuild());
    await store.markPublished(saved.id, { publishedFileId: "f1", publishedKey: "k1", publishedHash: buildFingerprint(saved) });
    const edited = await store.upsertBuild({ ...makeBuild(), id: saved.id, title: "Renamed" });
    expect(edited.publishedHash).toBe(buildFingerprint(saved));
    expect(publishStatus(annotateBuild(edited))).toBe("stale");
  });

  test("bookkeeping writes leave a published build current", async () => {
    const saved = await store.upsertBuild(makeBuild());
    await store.markPublished(saved.id, { publishedFileId: "f1", publishedKey: "k1", publishedHash: buildFingerprint(saved) });
    const moved = await store.upsertBuild({ ...saved, folderId: "f9", pinned: true, sortOrder: 4 });
    expect(publishStatus(annotateBuild(moved))).toBe("current");
  });

  test("an incoming receipt replaces the stored one (team pull)", async () => {
    const saved = await store.upsertBuild(makeBuild());
    await store.markPublished(saved.id, { publishedFileId: "f1", publishedKey: "k1", publishedHash: "old" });
    const pulled = await store.upsertBuild({ ...saved, publishedHash: "fromTeammate" });
    expect(pulled.publishedHash).toBe("fromTeammate");
  });

  test("a receipt-stripped history document keeps the current receipt", async () => {
    const saved = await store.upsertBuild(makeBuild());
    await store.markPublished(saved.id, { publishedFileId: "f1", publishedKey: "k1", publishedSlug: "s", publishedHash: "current-receipt" });
    const oldDoc = { ...saved, publishedHash: "old-receipt", publishedSlug: "old" };
    const reverted = await store.upsertBuild(withoutPublishReceipt(oldDoc));
    expect(reverted.publishedHash).toBe("current-receipt");
    expect(reverted.publishedSlug).toBe("s");
  });

  test("contentHash is never persisted", async () => {
    const saved = await store.upsertBuild({ ...makeBuild(), contentHash: "zzz" });
    expect(saved.contentHash).toBeUndefined();
    expect((await store.listBuilds())[0].contentHash).toBeUndefined();
  });
});
```

Append to `tests/unit/compStore.test.js`. The file already defines `makeTempStore`, `cleanupDir` and `makeComp`:

```js
describe("CompStore — publish receipt", () => {
  const { compFingerprint, annotateComp } = require("../../src/main/publishFingerprint");
  const { publishStatus, withoutPublishReceipt } = require("../../src/shared/publishState");
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(() => cleanupDir(dir));

  test("markPublished stores publishedHash and publishedMemberHashes", async () => {
    const saved = await store.upsertComp(makeComp());
    const out = await store.markPublished(saved.id, {
      publishedFileId: "c1", publishedKey: "k", publishedHash: compFingerprint(saved),
      publishedMemberHashes: { b1: "h1" }, snapshotUpdatedAt: saved.updatedAt,
    });
    expect(out.publishedHash).toBe(compFingerprint(saved));
    expect(out.publishedMemberHashes).toEqual({ b1: "h1" });
    expect(publishStatus(annotateComp(out))).toBe("current");
  });

  test("upsertComp accepts the receipt and publishedAt (team pull), and keeps them when absent", async () => {
    const pulled = await store.upsertComp(makeComp({
      id: "c1", publishedFileId: "f", publishedKey: "k", publishedAt: "2026-01-01T00:00:00.000Z",
      publishedHash: "h", publishedMemberHashes: { b1: "m1", bad: 7 },
    }));
    expect(pulled).toMatchObject({ publishedAt: "2026-01-01T00:00:00.000Z", publishedHash: "h", publishedMemberHashes: { b1: "m1" } });
    const renamed = await store.upsertComp({ id: "c1", name: "Renamed" });
    expect(renamed).toMatchObject({ publishedAt: "2026-01-01T00:00:00.000Z", publishedHash: "h", publishedMemberHashes: { b1: "m1" } });
  });

  test("bookkeeping and default-filling saves leave a published comp current", async () => {
    const saved = await store.upsertComp(makeComp({ buildIds: ["b1"], partyLines: [{ capacity: 5, slots: ["b1"] }] }));
    await store.markPublished(saved.id, { publishedFileId: "f", publishedKey: "k", publishedHash: compFingerprint(saved) });
    const moved = await store.upsertComp({ ...saved, folderId: "f9", sortOrder: 3 });
    expect(publishStatus(annotateComp(moved))).toBe("current");
  });

  test("a receipt-stripped history document keeps the current receipt", async () => {
    const saved = await store.upsertComp(makeComp({ id: "c1" }));
    await store.markPublished("c1", { publishedFileId: "f", publishedKey: "k", publishedHash: "now", publishedMemberHashes: { b1: "now" } });
    const reverted = await store.upsertComp(withoutPublishReceipt({ ...saved, publishedHash: "then", publishedMemberHashes: { b1: "then" } }));
    expect(reverted.publishedHash).toBe("now");
    expect(reverted.publishedMemberHashes).toEqual({ b1: "now" });
  });

  test("contentHash is never persisted", async () => {
    const saved = await store.upsertComp(makeComp({ contentHash: "zzz" }));
    expect(saved.contentHash).toBeUndefined();
  });
});
```

In `tests/unit/buildHistoryStore.test.js`, after the test `"publishing a build is not an edit either"` (inside the same `describe`), add:

```js
  test("a new publish receipt is not an edit either", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build() });
    expect(await store.appendVersion({ recordId: "b1", after: build({ publishedHash: "abc" }) })).toBeNull();
  });
```

Append to `tests/unit/compHistoryStore.test.js`. Module-level `store` and `comp()` already exist:

```js
describe("CompHistoryStore — publish receipt", () => {
  test("a new publish receipt writes no version", async () => {
    await store.appendVersion({ recordId: "c1", before: null, after: comp() });
    const published = comp({ publishedHash: "h", publishedMemberHashes: { b1: "m" } });
    expect(await store.appendVersion({ recordId: "c1", after: published })).toBeNull();
  });
});
```

Append to `tests/unit/teamSync.pull.test.js`, inside `describe("TeamSync — pull", ...)` before its closing `});`:

```js
  test("a teammate-published build reads current after the pull, whatever updatedAt the pull writes", async () => {
    const { buildFingerprint, annotateBuild } = require("../../src/main/publishFingerprint");
    const { publishStatus } = require("../../src/shared/publishState");
    h = await makeHarness();
    await seedTeam(h);
    // The teammate's normalized record, shaped the way their store holds it.
    const theirs = await h.buildStore.upsertBuild({ id: "seed", title: "Remote", profession: "Warrior", notes: "n" });
    const { folderId, pinned, sortOrder, compIds, archivedAt, archiveBatchId, archiveRoot, ...body } = theirs;
    h.api.changes.mockResolvedValueOnce({ items: [item({ id: "b1", body: {
      ...body, id: "b1", publishedFileId: "f1", publishedKey: "k1",
      // Long before the local updatedAt the pull stamps: the legacy check would say stale.
      publishedAt: "2020-01-01T00:00:00.000Z", publishedHash: buildFingerprint(theirs),
    } })], nextSeq: 1, hasMore: false });
    await h.sync.pullTeam("t");
    const pulled = (await h.buildStore.listBuilds()).find((b) => b.id === "b1");
    expect(pulled.publishedHash).toBe(buildFingerprint(theirs));
    expect(publishStatus(annotateBuild(pulled))).toBe("current");
  });

  test("a pulled comp keeps publishedAt and its receipt", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.changes.mockResolvedValueOnce({ items: [item({ id: "c1", type: "comp", body: {
      id: "c1", name: "Comp", buildIds: [], partyLines: [], publishedFileId: "cf", publishedKey: "ck",
      publishedAt: "2020-01-01T00:00:00.000Z", publishedHash: "self", publishedMemberHashes: { b1: "m1" },
    } })], nextSeq: 1, hasMore: false });
    await h.sync.pullTeam("t");
    expect((await h.compStore.listComps())[0]).toMatchObject({
      publishedAt: "2020-01-01T00:00:00.000Z", publishedHash: "self", publishedMemberHashes: { b1: "m1" },
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/buildStore.test.js tests/unit/compStore.test.js tests/unit/buildHistoryStore.test.js tests/unit/compHistoryStore.test.js tests/unit/teamSync.pull.test.js`
Expected: FAIL. The new tests fail: `publishedHash` is `undefined` and the receipt tests write a history version. The existing tests still pass.

- [ ] **Step 3: Build store**

In `src/main/buildStore.js` `normalizeBuild`, find:

```js
    publishedOwner: asString(input.publishedOwner, 80),
```

replace with:

```js
    publishedOwner: asString(input.publishedOwner, 80),
    // Fingerprint of the content last uploaded (publishFingerprint.js). Synced
    // with the other published* fields, so every teammate compares against it.
    publishedHash: asString(input.publishedHash, 64),
```

In `upsertBuild`, find:

```js
        if (!next.publishedOwner && existing.publishedOwner) next.publishedOwner = existing.publishedOwner;
```

replace with:

```js
        if (!next.publishedOwner && existing.publishedOwner) next.publishedOwner = existing.publishedOwner;
        if (!next.publishedHash && existing.publishedHash) next.publishedHash = existing.publishedHash;
```

In `markPublished`, change the signature line:

```js
  async markPublished(id, { publishedFileId, publishedKey, publishedSlug, publishedOwner, snapshotUpdatedAt }) {
```

to:

```js
  async markPublished(id, { publishedFileId, publishedKey, publishedSlug, publishedOwner, publishedHash, snapshotUpdatedAt }) {
```

and in the `next` object, after `publishedOwner: publishedOwner || existing.publishedOwner || "",` add:

```js
        publishedHash: publishedHash || existing.publishedHash || "",
```

- [ ] **Step 4: Comp store**

In `src/main/compStore.js`, add this function above `class CompStore`:

```js
// { buildId: fingerprint } from a synced or published comp; anything else is dropped.
function normalizeHashMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}
```

In `upsertComp`, find:

```js
        ...(typeof input.publishedOwner === "string" ? { publishedOwner: input.publishedOwner } : {}),
      };
```

replace with:

```js
        ...(typeof input.publishedOwner === "string" ? { publishedOwner: input.publishedOwner } : {}),
        // The receipt and publishedAt arrive in a team pull's body. Absent means
        // "not mentioned" (an editor save), so the stored values stay.
        ...(typeof input.publishedAt === "string" && input.publishedAt ? { publishedAt: input.publishedAt } : {}),
        ...(typeof input.publishedHash === "string" && input.publishedHash ? { publishedHash: input.publishedHash } : {}),
        ...(normalizeHashMap(input.publishedMemberHashes) ? { publishedMemberHashes: normalizeHashMap(input.publishedMemberHashes) } : {}),
      };
```

Change the `markPublished` signature:

```js
  async markPublished(id, { publishedFileId, publishedKey, publishedSlug, publishedOwner, boonCoverageHtml, snapshotUpdatedAt }) {
```

to:

```js
  async markPublished(id, { publishedFileId, publishedKey, publishedSlug, publishedOwner, boonCoverageHtml, publishedHash, publishedMemberHashes, snapshotUpdatedAt }) {
```

and after `if (typeof boonCoverageHtml === "string") existing.boonCoverageHtml = boonCoverageHtml;` add:

```js
      if (publishedHash) existing.publishedHash = publishedHash;
      const members = normalizeHashMap(publishedMemberHashes);
      if (members) existing.publishedMemberHashes = members;
```

- [ ] **Step 5: History bookkeeping**

In `src/main/history/constants.js`, in `NON_VERSIONED_PATHS`, find:

```js
  "publishedOwner",
```

replace with:

```js
  "publishedOwner",
  "publishedHash",
  "publishedMemberHashes",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/unit/buildStore.test.js tests/unit/compStore.test.js tests/unit/buildHistoryStore.test.js tests/unit/compHistoryStore.test.js tests/unit/teamSync.pull.test.js tests/unit/history`
Expected: PASS. If a `tests/unit/history` round-trip test lists `NON_VERSIONED_PATHS` literally, add the two new names there too.

- [ ] **Step 7: Commit**

```bash
git add src/main/buildStore.js src/main/compStore.js src/main/history/constants.js tests/unit/buildStore.test.js tests/unit/compStore.test.js tests/unit/buildHistoryStore.test.js tests/unit/compHistoryStore.test.js tests/unit/teamSync.pull.test.js
git commit -m "feat(publish): stores and team sync carry the publish receipt"
```

---

### Task 4: Main wiring — annotate, gate, revert, stamp on publish

**Files:**
- Modify: `src/main/index.js` (the `require` block near :58, `teamSyncEmit` :524, `builds:list`/`builds:save` :819-855, `comps:revert` :984-1011, `builds:revert` :1013-1047, `comps:list`/`comps:save` :1171-1203, `publishBuildImpl` :1562-1786, `publishCompImpl` :1789-1987, comp share :2097, build share :2151)

`index.js` is not unit-testable, so every decision it makes goes through a helper Task 1 or 2 already tested. This task is wiring only, verified by the full suite plus a reread.

**Interfaces:**
- Consumes:
  - Task 1: `annotateBuild`, `annotateComp`, `annotateSyncEvent`, `buildReceipt`, `compReceipt`, `compReceiptAfterRepublish`.
  - Task 2: `withoutPublishReceipt`, `shareRejectionReason(record, noun, buildOf)`.
  - Task 3: `markPublished` receipt params.
- Produces: `builds:list`, `builds:save`, `builds:revert`, `comps:list`, `comps:save`, `comps:revert` and `sync-status` events now return records with `contentHash`.

- [ ] **Step 1: Requires**

In `src/main/index.js`, find:

```js
const { shareRejectionReason } = require("./shareGate");
```

replace with:

```js
const { shareRejectionReason } = require("./shareGate");
const { withoutPublishReceipt } = require("../shared/publishState");
const {
  annotateBuild, annotateComp, annotateSyncEvent, buildReceipt, compReceipt, compReceiptAfterRepublish,
} = require("./publishFingerprint");
```

- [ ] **Step 2: Annotate what the renderer receives**

Find:

```js
function teamSyncEmit(channel, data) {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length) wins[0].webContents.send(channel, data);
}
```

replace with:

```js
function teamSyncEmit(channel, data) {
  const wins = BrowserWindow.getAllWindows();
  // A pulled record is spliced straight into renderer state, so it needs the
  // contentHash the list handlers would have attached.
  if (wins.length) wins[0].webContents.send(channel, channel === "sync-status" ? annotateSyncEvent(data) : data);
}
```

Find `handle("builds:list", async () => store.listBuilds());` and replace with:

```js
  // contentHash rides along for the renderer's publish status; never stored.
  handle("builds:list", async () => (await store.listBuilds()).map(annotateBuild));
```

At the end of the `builds:save` handler, change its final `return saved;` (the line just before `handle("builds:delete", ...`) to `return annotateBuild(saved);`.

Find `handle("comps:list", () => compStore.listComps());` and replace with:

```js
  handle("comps:list", async () => (await compStore.listComps()).map(annotateComp));
```

At the end of the `comps:save` handler, change its final `return saved;` (just before `handle("comps:delete", ...`) to `return annotateComp(saved);`.

- [ ] **Step 3: Reverts keep the current receipt**

In `comps:revert`, find:

```js
    const saved = await compStore.upsertComp(doc);
```

replace with:

```js
    // The history document carries the receipt from ITS point in time; the
    // published page reflects the latest publish, so the current receipt stays.
    const saved = await compStore.upsertComp(withoutPublishReceipt(doc));
```

and change that handler's final `return saved;` to `return annotateComp(saved);`.

In `builds:revert`, find:

```js
    const saved = await store.upsertBuild(doc);
```

replace with:

```js
    // See comps:revert — the current receipt stays.
    const saved = await store.upsertBuild(withoutPublishReceipt(doc));
```

and change that handler's final `return saved;` to `return annotateBuild(saved);`.

- [ ] **Step 4: Share gates compare content**

In the comp share handler (near :2097), find:

```js
    const compReject = shareRejectionReason(comp, "Comp");
```

replace with:

```js
    const buildsById = new Map((await store.listBuilds()).map((b) => [b.id, annotateBuild(b)]));
    const compReject = shareRejectionReason(annotateComp(comp), "Comp", (id) => buildsById.get(id));
```

In the build share handler (near :2151), find:

```js
    const buildReject = shareRejectionReason(build, "Build");
```

replace with:

```js
    const buildReject = shareRejectionReason(annotateBuild(build), "Build");
```

- [ ] **Step 5: Build publish stamps the build and the comps it re-uploaded**

In `publishBuildImpl`, find:

```js
    const allComps = await compStore.listComps();
    const affectedComps = allComps.filter(
      (c) => c.publishedFileId && (c.buildIds || []).includes(buildId)
    );
    if (affectedComps.length) {
```

replace with:

```js
    const allComps = await compStore.listComps();
    const affectedComps = allComps.filter(
      (c) => c.publishedFileId && (c.buildIds || []).includes(buildId)
    );
    // Receipts for the comps re-uploaded below, stamped once the upload is live.
    const compRestamps = [];
    if (affectedComps.length) {
```

Inside the `for (const comp of affectedComps)` loop, find:

```js
        const buildsMap = {};

        for (const cb of compBuilds) {
```

replace with:

```js
        const buildsMap = {};
        // The member records that went into this comp's payload, and the ones
        // that failed to enrich and were left out.
        const included = [];
        const skippedIds = [];

        for (const cb of compBuilds) {
```

Find:

```js
            } catch {
              continue; // Skip builds that fail to enrich — don't block the publish
            }
```

replace with:

```js
            } catch {
              skippedIds.push(cb.id);
              continue; // Skip builds that fail to enrich — don't block the publish
            }
```

Find:

```js
          buildsMap[cb.id] = { ...enriched, spaUrl: cbSpaUrl };
        }
```

replace with:

```js
          buildsMap[cb.id] = { ...enriched, spaUrl: cbSpaUrl };
          // The published build is the snapshot serialized above, not the re-read.
          included.push(cb.id === buildId ? build : cb);
        }
```

Find:

```js
        combinedBundle[compEncFile.filePath] = compEncFile.content;
      }
    }
```

replace with:

```js
        combinedBundle[compEncFile.filePath] = compEncFile.content;
        compRestamps.push({ comp, receipt: compReceiptAfterRepublish(comp, included, skippedIds) });
      }
    }
```

Find:

```js
      publishedOwner: owner,
      snapshotUpdatedAt: build.updatedAt,
    })) || build;
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, savedBuild.id, "build", "put"), { type: "build", id: savedBuild.id });
```

replace with:

```js
      publishedOwner: owner,
      snapshotUpdatedAt: build.updatedAt,
      // Fingerprint of the snapshot that was serialized, so a save made during
      // the upload leaves the build reading out of date.
      ...buildReceipt(build),
    })) || build;
    if (teamRoot) await safeEnqueue(() => teamSync.enqueue(teamRoot.teamId, savedBuild.id, "build", "put"), { type: "build", id: savedBuild.id });

    // The comps re-uploaded above now carry this build, so their receipts move
    // with it — except a comp whose upload left a member out (it stays out of
    // date until it is published in full).
    for (const { comp, receipt } of compRestamps) {
      if (!receipt) continue;
      const restamped = await compStore.markPublished(comp.id, { ...receipt, snapshotUpdatedAt: comp.updatedAt });
      const compRoot = restamped ? await findTeamRoot(restamped.folderId) : null;
      if (compRoot) await safeEnqueue(() => teamSync.enqueue(compRoot.teamId, restamped.id, "comp", "put"), { type: "comp", id: restamped.id });
    }
```

- [ ] **Step 6: Comp publish stamps the comp and every member it re-uploaded**

In `publishCompImpl`, find:

```js
      if (needsRecord) {
        updatedBuildRecords.push({ id: build.id, publishedFileId: fileId, publishedKey: encKey, publishedSlug: slug, publishedOwner: owner, snapshotUpdatedAt: build.updatedAt });
      }
```

replace with:

```js
      // This build's own page was just re-encrypted from `build`, so its receipt
      // moves too. Only a changed record is written (and synced to the team).
      const receipt = buildReceipt(build);
      if (needsRecord || build.publishedHash !== receipt.publishedHash) {
        updatedBuildRecords.push({ id: build.id, publishedFileId: fileId, publishedKey: encKey, publishedSlug: slug, publishedOwner: owner, snapshotUpdatedAt: build.updatedAt, ...receipt });
      }
```

Find:

```js
      boonCoverageHtml: boonCoverageHtml || comp.boonCoverageHtml || "",
      snapshotUpdatedAt: comp.updatedAt,
    })) || comp;
```

replace with:

```js
      boonCoverageHtml: boonCoverageHtml || comp.boonCoverageHtml || "",
      snapshotUpdatedAt: comp.updatedAt,
      // Every member is in buildsMap (enrichment failure throws above). Linked
      // teammate copies are fingerprinted from the local, synced record.
      ...compReceipt(comp, compBuilds),
    })) || comp;
```

- [ ] **Step 7: Reread and run the suite**

Run: `grep -n "annotateBuild\|annotateComp\|annotateSyncEvent\|buildReceipt\|compReceipt\|withoutPublishReceipt" src/main/index.js`
Expected: one hit per edit above: the require block, `teamSyncEmit`, the two list handlers, the two save returns, both reverts (two hits each), both share handlers, build publish (`buildReceipt` and `compReceiptAfterRepublish`) and comp publish (`buildReceipt` and `compReceipt`).

Run: `node -e "require('./src/main/publishFingerprint'); require('./src/shared/publishState'); require('./src/main/shareGate')"`
Expected: no output (the modules load).

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/index.js
git commit -m "feat(publish): main annotates records, stamps receipts on publish, keeps them on revert"
```

---

### Task 5: Badges in the library views and editors

**Files:**
- Modify: `src/renderer/modules/library/content.js` (imports; `itemSyncIndicatorHtml` :262; its 10 call sites)
- Modify: `src/renderer/index.html:86` (after `#publishSiteBtn`)
- Modify: `src/renderer/renderer.js:314` (the `el` map)
- Modify: `src/renderer/modules/render-pages.js` (imports :10; `renderEditorMeta` :529)
- Modify: `src/renderer/modules/comps/comp-detail.js` (imports; the Publish button :485; `saveAndSync` :417; the publish handler :1394-1430)
- Modify: `src/renderer/styles/library.css` (after the `.lib-content-sync-indicator` block, ~:1925)
- Modify: `src/web/web.css:13`
- Test: `tests/unit/renderer/library-publish-badge.test.js` (create)

**Interfaces:**
- Consumes: `itemPublishBadgeHtml`, `publishBadgeHtml`, `publishStatus`, `compPublishStatus`, `buildLookup`, `PUBLISH_RECEIPT_FIELDS` from `src/renderer/modules/publish-status.js` (Task 2).
- Produces: `itemIndicatorsHtml(type, item)` in `content.js` (module-private). DOM `#editorPublishBadge` (build editor) and `#compPublishBadge` (comp detail).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/library-publish-badge.test.js`:

```js
/** @jest-environment jsdom */
"use strict";

// Every library view must carry the publish mark. The views build their rows by
// string concatenation, so the guard is structural: every call site that draws
// the sync indicator must draw the combined indicators instead.
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(
  path.join(__dirname, "../../../src/renderer/modules/library/content.js"), "utf8",
);

test("no view draws the sync indicator without the publish mark", () => {
  const bare = src.match(/\$\{itemSyncIndicatorHtml\(/g) || [];
  expect(bare).toHaveLength(0);
});

test("all ten build/comp rows across the five views draw both indicators", () => {
  const combined = src.match(/\$\{itemIndicatorsHtml\("(build|comp)", [bc]\)\}/g) || [];
  expect(combined).toHaveLength(10);
});

test("the combined helper appends the publish mark to the sync indicator", () => {
  expect(src).toMatch(/function itemIndicatorsHtml\(type, item\) \{\s*return itemSyncIndicatorHtml\(type, item\) \+ itemPublishBadgeHtml\(type, item, state\.builds\);\s*\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/renderer/library-publish-badge.test.js`
Expected: FAIL. `bare` has length 10 and `combined` has length 0.

- [ ] **Step 3: Library views**

In `src/renderer/modules/library/content.js`, find:

```js
import { badgeHtml } from "../sync-status.js";
```

replace with:

```js
import { badgeHtml } from "../sync-status.js";
import { itemPublishBadgeHtml } from "../publish-status.js";
```

After the closing `}` of `itemSyncIndicatorHtml` (the function starting at :262), add:

```js

// Sync indicator plus publish mark, as every view draws them side by side. A
// comp's mark reads state.builds, so a member edit shows without reloading comps.
function itemIndicatorsHtml(type, item) {
  return itemSyncIndicatorHtml(type, item) + itemPublishBadgeHtml(type, item, state.builds);
}
```

Replace every `${itemSyncIndicatorHtml("build", b)}` with `${itemIndicatorsHtml("build", b)}` and every `${itemSyncIndicatorHtml("comp", c)}` with `${itemIndicatorsHtml("comp", c)}`:

```bash
sed -i 's/\${itemSyncIndicatorHtml("build", b)}/${itemIndicatorsHtml("build", b)}/g; s/\${itemSyncIndicatorHtml("comp", c)}/${itemIndicatorsHtml("comp", c)}/g' src/renderer/modules/library/content.js
grep -c 'itemIndicatorsHtml("' src/renderer/modules/library/content.js
```

Expected: `10`. The definition line does not match the pattern.

- [ ] **Step 4: Styles**

In `src/renderer/styles/library.css`, after the `.lib-nav-item__sync-indicator--error { ... }` rule (~:1924-1926), add:

```css

/* ── Publish status mark (publish-status.js) ─────────────────────────────── */

.publish-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  height: 14px;
  vertical-align: middle;
  margin-left: 4px;
}

.publish-badge--current,
.publish-badge--never {
  color: var(--axi-text-faint);
}

.publish-badge--stale {
  color: var(--axi-warn);
}

/* Editor variant, beside the Publish button: icon + label. */
.publish-badge--editor {
  margin-left: 0;
  font-size: 12px;
  white-space: nowrap;
}
```

In `src/web/web.css`, find:

```css
.is-web #publishSiteBtn,                        /* publishing is desktop-only */
```

replace with:

```css
.is-web #publishSiteBtn,                        /* publishing is desktop-only */
.is-web #editorPublishBadge,
```

- [ ] **Step 5: Build editor badge**

In `src/renderer/index.html`, find:

```html
            <button id="publishSiteBtn" class="axi-btn axi-btn--ghost" type="button">Publish</button>
```

replace with:

```html
            <button id="publishSiteBtn" class="axi-btn axi-btn--ghost" type="button">Publish</button>
            <span id="editorPublishBadge" class="editor-publish-badge"></span>
```

In `src/renderer/renderer.js`, find:

```js
  publishSiteBtn:    q("#publishSiteBtn"),
```

replace with:

```js
  publishSiteBtn:    q("#publishSiteBtn"),
  editorPublishBadge: q("#editorPublishBadge"),
```

In `src/renderer/modules/render-pages.js`, find:

```js
import { shareDisabledTooltip } from "./share-gate.js";
```

replace with:

```js
import { shareDisabledTooltip } from "./share-gate.js";
import { publishStatus, publishBadgeHtml } from "./publish-status.js";
```

In `renderEditorMeta`, find:

```js
  // Discord share buttons — disabled until build is published and has no unsaved/unpublished changes
  const _shareBuild = state.builds.find((b) => b.id === state.editor?.id);
```

replace with:

```js
  // Publish mark beside the Publish button. Unsaved edits are unpublished too.
  if (_el.editorPublishBadge) {
    const pubBuild = state.editor?.id ? state.builds.find((b) => b.id === state.editor.id) : null;
    let pubStatus = pubBuild ? publishStatus(pubBuild) : null;
    if (pubStatus === "current" && state.editorDirty) pubStatus = "stale";
    _el.editorPublishBadge.innerHTML = pubStatus ? publishBadgeHtml(pubStatus, { editor: true }) : "";
  }

  // Discord share buttons — disabled until build is published and has no unsaved/unpublished changes
  const _shareBuild = state.builds.find((b) => b.id === state.editor?.id);
```

- [ ] **Step 6: Comp editor badge**

In `src/renderer/modules/comps/comp-detail.js`, find:

```js
import { compShareDisabledTooltip } from "../share-gate.js";
```

replace with:

```js
import { compShareDisabledTooltip } from "../share-gate.js";
import { compPublishStatus, buildLookup, publishBadgeHtml, PUBLISH_RECEIPT_FIELDS } from "../publish-status.js";
```

Add this function directly above `async function saveAndSync(comp) {`:

```js
// Publish mark beside the comp's Publish button. Reads state.builds, so a member
// edit made elsewhere shows the next time the detail view draws.
function renderCompPublishBadge() {
  const el = document.getElementById("compPublishBadge");
  if (!el || !state.activeComp) return;
  const { status, reason } = compPublishStatus(state.activeComp, buildLookup(state.builds));
  el.innerHTML = publishBadgeHtml(status, { reason, editor: true });
}
```

In `saveAndSync`, find:

```js
  _lastSavedAt = new Date();
  updateSaveStatusText();
  return saved;
```

replace with:

```js
  _lastSavedAt = new Date();
  updateSaveStatusText();
  renderCompPublishBadge();
  return saved;
```

In the detail template, find:

```js
        <button type="button" class="axi-btn axi-btn--ghost" data-action="publish">Publish</button>
        <div class="publish-status" id="compPublishStatus"></div>
```

replace with:

```js
        <button type="button" class="axi-btn axi-btn--ghost" data-action="publish">Publish</button>
        <span id="compPublishBadge" class="comp-publish-badge"></span>
        <div class="publish-status" id="compPublishStatus"></div>
```

In `renderCompDetail` (:432), find the line (~:513):

```js
  bindDetailEvents(container, comp);
```

replace with:

```js
  bindDetailEvents(container, comp);
  renderCompPublishBadge();
```

Then confirm: `grep -n "renderCompPublishBadge()" src/renderer/modules/comps/comp-detail.js` shows the definition, the `saveAndSync` call, this call and (after the next edit) the publish-handler call.

In the publish click handler, find:

```js
      state.comps = await window.desktopApi.listComps();
      const pubLinkEl = container.querySelector("[data-action='copy-published-link']");
```

replace with:

```js
      // The publish stamped the comp's receipt and its members' receipts.
      state.comps = await window.desktopApi.listComps();
      state.builds = await window.desktopApi.listBuilds();
      const fresh = state.comps.find((c) => c.id === comp.id);
      if (fresh && state.activeComp?.id === comp.id) {
        const receipt = Object.fromEntries(PUBLISH_RECEIPT_FIELDS.map((k) => [k, fresh[k]]));
        state.activeComp = { ...state.activeComp, ...receipt, contentHash: fresh.contentHash };
      }
      renderCompPublishBadge();
      const pubLinkEl = container.querySelector("[data-action='copy-published-link']");
```

- [ ] **Step 7: Run tests**

Run: `npx jest tests/unit/renderer`
Expected: PASS, including `library-publish-badge.test.js`.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/modules/library/content.js src/renderer/index.html src/renderer/renderer.js src/renderer/modules/render-pages.js src/renderer/modules/comps/comp-detail.js src/renderer/styles/library.css src/web/web.css tests/unit/renderer/library-publish-badge.test.js
git commit -m "feat(publish): publish marks in the library views and both editors"
```

---

### Task 6: Library filter, comps-list chip and filter

**Files:**
- Modify: `src/renderer/modules/library/folder-store.js` (imports; `getVisibleBuilds` filter block ~:195-215; `getVisibleComps` ~:316-318)
- Modify: `src/renderer/modules/library/toolbar.js` (imports :6; facets ~:202-223; dropdowns before "Clear all button" ~:292; `_hasAnyFilter` :325; label map ~:756-757)
- Modify: `src/renderer/modules/comps/comp-list.js` (imports; filter ~:115-121; Status select ~:203-206; chips ~:271-274 and ~:334-336)
- Test: `tests/unit/renderer/library-publish-filter.test.js` (create)

**Interfaces:**
- Consumes: `matchesPublishFilter`, `compMatchesStatusFilter`, `compPublishStatus`, `buildLookup`, `compPublishChipHtml` (Task 2).
- Produces: `libraryPrefs.activeFilters.publishStatus: ("current"|"stale"|"never")[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/library-publish-filter.test.js`:

```js
/** @jest-environment jsdom */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [],
    folders: [],
    comps: [],
    currentFolder: null,
    buildSearch: "",
    libraryPrefs: { viewMode: "list", sortField: "sortOrder", sortDirection: "asc", activeFilters: {} },
  },
}));

const { state } = require("../../../src/renderer/modules/state");
const { getVisibleBuilds, getVisibleComps } = require("../../../src/renderer/modules/library/folder-store");

const build = (id, over = {}) => ({
  id, title: id, profession: "Guardian", gameMode: "pve", folderId: null, tags: [],
  specializations: [], pinned: false, sortOrder: 0, ...over,
});

beforeEach(() => {
  state.builds = [
    build("never"),
    build("current", { publishedFileId: "f", publishedHash: "a", contentHash: "a" }),
    build("stale", { publishedFileId: "f", publishedHash: "a", contentHash: "b" }),
  ];
  state.comps = [
    { id: "cNever", name: "N", folderId: null, sortOrder: 0 },
    { id: "cMember", name: "M", folderId: null, sortOrder: 1, publishedFileId: "c", publishedHash: "s",
      contentHash: "s", publishedMemberHashes: { current: "old" } },
  ];
  state.libraryPrefs.activeFilters = {};
});

test("no publish filter shows everything", () => {
  expect(getVisibleBuilds().map((b) => b.id).sort()).toEqual(["current", "never", "stale"]);
  expect(getVisibleComps().map((c) => c.id)).toEqual(["cNever", "cMember"]);
});

test("filters builds by status", () => {
  state.libraryPrefs.activeFilters = { publishStatus: ["stale", "never"] };
  expect(getVisibleBuilds().map((b) => b.id).sort()).toEqual(["never", "stale"]);
});

test("filters comps by status, including member staleness", () => {
  state.libraryPrefs.activeFilters = { publishStatus: ["stale"] };
  expect(getVisibleComps().map((c) => c.id)).toEqual(["cMember"]);
  state.libraryPrefs.activeFilters = { publishStatus: ["current"] };
  expect(getVisibleComps()).toEqual([]);
});

test("the smart-folder rule leaves the derived filter out", () => {
  const { filtersToRule } = require("../../../src/renderer/modules/library/toolbar");
  expect(filtersToRule({ publishStatus: ["stale"], tags: ["x"] }).children)
    .toEqual([{ type: "condition", field: "tags", op: "hasAnyOf", value: ["x"] }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/renderer/library-publish-filter.test.js`
Expected: FAIL. "filters builds by status" gets all three builds, and the comps test gets both comps. If requiring `toolbar.js` fails in jsdom because of its imports, add `jest.mock` stubs for the failing module (copy the mock style from `tests/unit/renderer/smart-folder-from-filters.test.js`, which already imports `filtersToRule`).

- [ ] **Step 3: folder-store filtering**

In `src/renderer/modules/library/folder-store.js`, find:

```js
import { matchesSmartFolder, ruleContext } from "./smart-folders.js";
```

replace with:

```js
import { matchesSmartFolder, ruleContext } from "./smart-folders.js";
import { matchesPublishFilter } from "../publish-status.js";
```

In `getVisibleBuilds`, find:

```js
  if (filters.tags?.length > 0) {
    builds = builds.filter((b) =>
      filters.tags.some((t) => (b.tags || []).includes(t)),
    );
  }
```

replace with:

```js
  if (filters.tags?.length > 0) {
    builds = builds.filter((b) =>
      filters.tags.some((t) => (b.tags || []).includes(t)),
    );
  }
  if (filters.publishStatus?.length > 0) {
    builds = builds.filter((b) => matchesPublishFilter("build", b, state.builds, filters.publishStatus));
  }
```

In `getVisibleComps`, find:

```js
  // Apply search
  if (query) comps = comps.filter((c) => compMatchesQuery(c, query));

  // Sort by sortOrder (or name as fallback)
```

replace with:

```js
  // Apply search
  if (query) comps = comps.filter((c) => compMatchesQuery(c, query));

  // The publish filter is the one toolbar filter that means something for comps.
  const publishFilter = state.libraryPrefs.activeFilters?.publishStatus;
  if (publishFilter?.length > 0) {
    comps = comps.filter((c) => matchesPublishFilter("comp", c, state.builds, publishFilter));
  }

  // Sort by sortOrder (or name as fallback)
```

- [ ] **Step 4: Toolbar dropdown**

In `src/renderer/modules/library/toolbar.js`, find:

```js
import { libraryBuilds } from "./folder-store.js";
```

replace with:

```js
import { libraryBuilds, libraryComps } from "./folder-store.js";
```

Find:

```js
  if (professions.length === 0 && gameModes.length === 0 && tags.length === 0) {
    container.innerHTML = "";
    return;
  }
```

replace with:

```js
  // The publish filter applies to comps too, so a library of comps alone still
  // gets a filter row.
  if (builds.length === 0 && libraryComps().length === 0) {
    container.innerHTML = "";
    return;
  }
```

Find:

```js
  // Clear all button
  const hasActiveFilter = _hasAnyFilter(activeFilters);
```

replace with:

```js
  // Publish status dropdown — derived from the content fingerprint, so it is not
  // a smart-folder condition (filtersToRule leaves it out).
  {
    const selected = activeFilters.publishStatus || [];
    const count = selected.length;
    const label = count > 0 ? `Publish (${count})` : "Publish";
    const options = [["current", "Published"], ["stale", "Out of date"], ["never", "Never published"]];
    let items = "";
    for (const [value, text] of options) {
      items += `<button type="button" class="axi-picker__opt" role="option" aria-selected="${selected.includes(value)}" data-filter-type="publishStatus" data-filter-value="${value}">
        <span class="lib-fd__label">${text}</span>
      </button>`;
    }
    dropdowns.push(_renderDropdown("publish-filter", label, items, count > 0));
  }

  // Clear all button
  const hasActiveFilter = _hasAnyFilter(activeFilters);
```

Replace `_hasAnyFilter`:

```js
function _hasAnyFilter(filters) {
  return (filters.professions?.length > 0) ||
    (filters.eliteSpecs?.length > 0) ||
    (filters.gameModes?.length > 0) ||
    (filters.tags?.length > 0);
}
```

with:

```js
function _hasAnyFilter(filters) {
  return (filters.professions?.length > 0) ||
    (filters.eliteSpecs?.length > 0) ||
    (filters.gameModes?.length > 0) ||
    (filters.tags?.length > 0) ||
    (filters.publishStatus?.length > 0);
}
```

Find:

```js
        const baseLabel = dropdown.dataset.dropdown === "class-filter" ? "Class"
          : dropdown.dataset.dropdown === "mode-filter" ? "Mode" : "Tags";
```

replace with:

```js
        const baseLabel = dropdown.dataset.dropdown === "class-filter" ? "Class"
          : dropdown.dataset.dropdown === "mode-filter" ? "Mode"
          : dropdown.dataset.dropdown === "publish-filter" ? "Publish" : "Tags";
```

- [ ] **Step 5: Comps list chip and filter**

In `src/renderer/modules/comps/comp-list.js`, after the import of `professionSeriesStyle` (:16), add:

```js
import { compPublishStatus, buildLookup, compMatchesStatusFilter, compPublishChipHtml } from "../publish-status.js";
```

Find:

```js
  const ps = state.compPrefs.activeFilters?.publishStatus;
  if (ps === "published") {
    comps = comps.filter((c) => !!c.publishedFileId);
  } else if (ps === "draft") {
    comps = comps.filter((c) => !c.publishedFileId);
  }
```

replace with:

```js
  const ps = state.compPrefs.activeFilters?.publishStatus;
  if (ps) comps = comps.filter((c) => compMatchesStatusFilter(c, ps, state.builds));
```

Find:

```js
            <option value="published" ${ps === "published" ? "selected" : ""}>Published</option>
            <option value="draft" ${ps === "draft" ? "selected" : ""}>Draft</option>
```

replace with:

```js
            <option value="published" ${ps === "published" ? "selected" : ""}>Published</option>
            <option value="stale" ${ps === "stale" ? "selected" : ""}>Out of date</option>
            <option value="draft" ${ps === "draft" ? "selected" : ""}>Draft</option>
```

Find (the expanded card, ~:271):

```js
  // Publish status badge
  const pubBadge = comp.publishedFileId
    ? `<span class="axi-chip axi-chip--ok comp-badge comp-badge--published">Published</span>`
    : `<span class="axi-chip comp-badge comp-badge--draft">Draft</span>`;
```

replace with:

```js
  // Publish status badge — member builds count, so it reads state.builds.
  const pubBadge = compPublishChipHtml(compPublishStatus(comp, buildLookup(state.builds)).status);
```

Find (the compact card, ~:334):

```js
  const pubBadge = comp.publishedFileId
    ? `<span class="axi-chip axi-chip--ok comp-badge comp-badge--published comp-badge--sm">Published</span>`
    : `<span class="axi-chip comp-badge comp-badge--draft comp-badge--sm">Draft</span>`;
```

replace with:

```js
  const pubBadge = compPublishChipHtml(compPublishStatus(comp, buildLookup(state.builds)).status, { small: true });
```

- [ ] **Step 6: Run tests**

Run: `npx jest tests/unit/renderer`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/library/folder-store.js src/renderer/modules/library/toolbar.js src/renderer/modules/comps/comp-list.js tests/unit/renderer/library-publish-filter.test.js
git commit -m "feat(publish): library publish filter and three-state comps-list chip"
```

---

### Task 7: Freshness and duplicates

**Files:**
- Modify: `src/renderer/renderer.js` (sync splice :801-810; build publish handler ~:1711)
- Modify: `src/renderer/modules/library/library.js` (`handleDuplicate` :541; `handleDuplicateComp` :1367)
- Test: `tests/unit/renderer/library-duplicate-receipt.test.js` (create)

**Interfaces:**
- Consumes: `withoutPublishReceipt` (Task 2 ESM).
- Produces: `state.builds`/`state.comps` are replaced on sync splices rather than mutated in place. Task 2's `buildLookup` relies on this.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/library-duplicate-receipt.test.js`:

```js
/** @jest-environment jsdom */
"use strict";

// A duplicate is a new, unpublished record: carrying the original's
// publishedFileId/Key would make the copy claim the original's published page.
const fs = require("node:fs");
const path = require("node:path");

const lib = fs.readFileSync(path.join(__dirname, "../../../src/renderer/modules/library/library.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "../../../src/renderer/renderer.js"), "utf8");

test("both library duplicates strip the publish receipt", () => {
  expect(lib).toMatch(/async function handleDuplicate\(buildId\) \{[\s\S]*?const copy = withoutPublishReceipt\(build\);/);
  expect(lib).toMatch(/async function handleDuplicateComp\(compId\) \{[\s\S]*?const copy = withoutPublishReceipt\(comp\);/);
});

test("sync splices replace the arrays instead of mutating them", () => {
  expect(renderer).not.toMatch(/state\.builds\[idx\] = data\.item/);
  expect(renderer).not.toMatch(/state\.comps\[idx\] = data\.item/);
  expect(renderer).not.toMatch(/state\.builds\.push\(data\.item\)/);
  expect(renderer).not.toMatch(/state\.comps\.push\(data\.item\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/renderer/library-duplicate-receipt.test.js`
Expected: FAIL on both tests.

- [ ] **Step 3: Immutable sync splices**

In `src/renderer/renderer.js`, find:

```js
          if (type === "build") {
            const idx = state.builds.findIndex((b) => b.id === id);
            if (idx >= 0) state.builds[idx] = data.item;
            else state.builds.push(data.item);
          } else {
            const idx = state.comps.findIndex((c) => c.id === id);
            if (idx >= 0) state.comps[idx] = data.item;
            else state.comps.push(data.item);
          }
```

replace with:

```js
          // New arrays, never in-place: the publish-status build lookup caches
          // per state.builds array (publish-status.js buildLookup).
          const splice = (list) => (list.some((x) => x.id === id)
            ? list.map((x) => (x.id === id ? data.item : x))
            : [...list, data.item]);
          if (type === "build") state.builds = splice(state.builds);
          else state.comps = splice(state.comps);
```

- [ ] **Step 4: Reload comps after a build publish**

In the `publishSiteBtn` click handler, find:

```js
      state.builds = await window.desktopApi.listBuilds();
      renderBuildList();
      renderEditorMeta();
```

replace with:

```js
      // The publish also re-stamped every published comp containing this build.
      state.builds = await window.desktopApi.listBuilds();
      state.comps = await window.desktopApi.listComps();
      renderBuildList();
      renderEditorMeta();
```

- [ ] **Step 5: Duplicates drop the receipt**

In `src/renderer/modules/library/library.js`, add to the imports at the top of the file:

```js
import { withoutPublishReceipt } from "../publish-status.js";
```

In `handleDuplicate`, find:

```js
  const copy = { ...build };
  delete copy.id;
  copy.title = `${build.title || "Untitled"} (Copy)`;
```

replace with:

```js
  // A copy is unpublished: the original's receipt would claim its page.
  const copy = withoutPublishReceipt(build);
  delete copy.id;
  copy.title = `${build.title || "Untitled"} (Copy)`;
```

In `handleDuplicateComp`, find:

```js
  const copy = { ...comp };
  delete copy.id;
  copy.name = `Copy of ${comp.name || "Untitled"}`;
```

replace with:

```js
  const copy = withoutPublishReceipt(comp);
  delete copy.id;
  copy.name = `Copy of ${comp.name || "Untitled"}`;
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/renderer.js src/renderer/modules/library/library.js tests/unit/renderer/library-duplicate-receipt.test.js
git commit -m "fix(publish): fresh comp status after publish, duplicates start unpublished"
```

---

## Manual check (after Task 7, desktop app, no Playwright)

Run `npm start` (or the repo's usual dev command) and confirm:

1. Publish a build. Its library row shows the grey globe and the editor shows "Published".
2. Edit the build's title and save. The row turns amber, the editor shows "Out of date", and every published comp containing it shows "Out of date" with the member tooltip.
3. Move the build to another folder and pin it. It stays "Published".
4. In the library toolbar, pick Publish → Out of date. Only stale builds and comps remain.
5. In a team folder, have a teammate publish a build. After the pull, your row reads "Published" (previously "out of date").
