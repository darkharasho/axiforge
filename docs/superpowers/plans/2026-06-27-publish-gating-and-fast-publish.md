# Publish Gating, Fast Publish, and First-Publish Explainer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "I published, I shared, it worked" true: gate Discord share behind a published-and-fresh build, publish in a few seconds with the link confirmed live, and explain publishing the first time.

**Architecture:** Add a `publishedAt` timestamp to build records so "saved but not published" (stale) is detectable. Hard-disable Discord share UI unless the build is published and fresh, with a defensive main-process check. Speed up publishing by (a) a content-hash version marker that skips re-uploading the SPA shell and skips the Pages workflow when the shell is unchanged, (b) having the SPA fetch build data from `raw.githubusercontent.com` (live within seconds of a commit, no workflow), and (c) polling the raw URL until live before stamping `publishedAt`. Add a first-publish explainer modal reusing `showConfirmModal`.

**Tech Stack:** Electron (CommonJS main process), vanilla JS renderer + SPA (ES modules), Jest unit tests, Playwright e2e/spa tests.

## Global Constraints

- Test runner is **Jest** (`npm test`), not vitest. Unit tests live under `tests/unit/`.
- `publishedAt` is an ISO-8601 string or `null`. Legacy builds (`publishedAt === null`) are **never** treated as stale — do not retroactively block already-published builds.
- Keep `build_type: "workflow"` for GitHub Pages. Do **not** migrate to deploy-from-branch (the deferred "3b").
- Keep `triggerPagesWorkflow` and the workflow file in place — they are still used on shell changes and first publish.
- Published encrypted files live at repo path `site/builds/<fileId>.enc` and `site/comps/<fileId>.enc`. The Pages site serves the contents of `site/` at the site root; `raw.githubusercontent.com` serves them at the full `site/...` path.
- Stale predicate: `Boolean(build.publishedAt) && build.updatedAt !== build.publishedAt`.
- Tooltip copy (exact): never-published → `"Publish this build first"`; stale/dirty → `"Publish your latest changes first"`.

---

### Task 1: Add `publishedAt` to the build store

**Files:**
- Modify: `src/main/buildStore.js` (`normalizeBuild` ~205-252; `upsertBuild` ~35-60)
- Test: `tests/unit/buildStore.test.js`

**Interfaces:**
- Produces: build records carry `publishedAt: string | null`. `upsertBuild(input)` stamps `next.publishedAt = updatedAt` (the same `now`) **only** when `input.__stampPublishedAt === true`; the flag is never persisted. Otherwise `publishedAt` is preserved from the existing record across saves.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/buildStore.test.js`:

```js
describe("BuildStore — publishedAt", () => {
  let dir, store;
  afterEach(async () => { if (dir) await cleanupDir(dir); });

  test("publishedAt defaults to null on a normal save", async () => {
    ({ store, dir } = await makeTempStore());
    const saved = await store.upsertBuild(makeBuild());
    expect(saved.publishedAt).toBeNull();
  });

  test("__stampPublishedAt stamps publishedAt equal to updatedAt", async () => {
    ({ store, dir } = await makeTempStore());
    const saved = await store.upsertBuild({ ...makeBuild(), __stampPublishedAt: true });
    expect(saved.publishedAt).toBe(saved.updatedAt);
    expect(saved.publishedAt).not.toBeNull();
  });

  test("the __stampPublishedAt flag is not persisted on the record", async () => {
    ({ store, dir } = await makeTempStore());
    const saved = await store.upsertBuild({ ...makeBuild(), __stampPublishedAt: true });
    expect("__stampPublishedAt" in saved).toBe(false);
  });

  test("publishedAt is preserved across a later normal save (becomes stale)", async () => {
    ({ store, dir } = await makeTempStore());
    const published = await store.upsertBuild({ ...makeBuild(), __stampPublishedAt: true });
    // A later edit + save: same id, no stamp flag.
    await new Promise((r) => setTimeout(r, 5));
    const edited = await store.upsertBuild({ ...makeBuild(), id: published.id, title: "Edited" });
    expect(edited.publishedAt).toBe(published.publishedAt); // unchanged
    expect(edited.updatedAt).not.toBe(edited.publishedAt);  // stale
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/unit/buildStore.test.js -t publishedAt`
Expected: FAIL — `publishedAt` is `undefined`.

- [ ] **Step 3: Implement in `normalizeBuild`**

In `src/main/buildStore.js`, inside the object returned by `normalizeBuild`, after the `publishedKey` line (~224) add:

```js
    publishedKey: asString(input.publishedKey, 100),
    publishedAt: asIso(input.publishedAt) || null,
```

- [ ] **Step 4: Implement stamping + preservation in `upsertBuild`**

In `src/main/buildStore.js` `upsertBuild` (~36-58), replace the body from `const now` through the `builds[idx] = next;` / push block with:

```js
      const builds = await this.listBuilds();
      const now = new Date().toISOString();
      const id = input.id || crypto.randomUUID();
      const stampPublishedAt = input.__stampPublishedAt === true;
      const cleaned = { ...input };
      delete cleaned.__stampPublishedAt;
      const next = normalizeBuild({ ...cleaned, id, updatedAt: now }, input.createdAt || now);
      if (stampPublishedAt) next.publishedAt = now;

      const idx = builds.findIndex((b) => b.id === id);
      if (idx >= 0) {
        const existing = builds[idx];
        next.createdAt = existing.createdAt || next.createdAt;
        if (next.folderId === null && existing.folderId) next.folderId = existing.folderId;
        if (!next.publishedFileId && existing.publishedFileId) next.publishedFileId = existing.publishedFileId;
        if (!next.publishedKey && existing.publishedKey) next.publishedKey = existing.publishedKey;
        if (!next.publishedSlug && existing.publishedSlug) next.publishedSlug = existing.publishedSlug;
        if (!next.publishedAt && existing.publishedAt) next.publishedAt = existing.publishedAt;
        builds[idx] = next;
      } else {
        builds.push(next);
      }
```

(`asIso` already exists in this file; reuse it. Keep the surrounding `#enqueue`, `#writeJson`, and `return next;`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/unit/buildStore.test.js`
Expected: PASS (all buildStore tests, including the new block).

- [ ] **Step 6: Commit**

```bash
git add src/main/buildStore.js tests/unit/buildStore.test.js
git commit -m "feat(buildStore): track publishedAt to detect stale (saved-but-not-published) builds"
```

---

### Task 2: Shared publish-state helper

**Files:**
- Create: `src/shared/publishState.js`
- Test: `tests/unit/publishState.test.js`

**Interfaces:**
- Produces: `buildPublishState(record)` → `{ neverPublished: boolean, stale: boolean, shareable: boolean }`. Pure, no Electron deps, usable from both main (CommonJS `require`) and renderer (it will be imported via a small re-export — see Task 4). Works for builds **and** comps (both have `publishedFileId`, `publishedAt`, `updatedAt`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/publishState.test.js`:

```js
"use strict";
const { buildPublishState } = require("../../src/shared/publishState");

describe("buildPublishState", () => {
  test("never published", () => {
    expect(buildPublishState({ publishedFileId: "", updatedAt: "t1", publishedAt: null }))
      .toEqual({ neverPublished: true, stale: false, shareable: false });
  });

  test("published and fresh", () => {
    expect(buildPublishState({ publishedFileId: "abc", updatedAt: "t1", publishedAt: "t1" }))
      .toEqual({ neverPublished: false, stale: false, shareable: true });
  });

  test("published then edited (stale)", () => {
    expect(buildPublishState({ publishedFileId: "abc", updatedAt: "t2", publishedAt: "t1" }))
      .toEqual({ neverPublished: false, stale: true, shareable: false });
  });

  test("legacy published with null publishedAt is shareable, not stale", () => {
    expect(buildPublishState({ publishedFileId: "abc", updatedAt: "t9", publishedAt: null }))
      .toEqual({ neverPublished: false, stale: false, shareable: true });
  });

  test("tolerates missing/undefined record", () => {
    expect(buildPublishState(null)).toEqual({ neverPublished: true, stale: false, shareable: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/publishState.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/shared/publishState.js`:

```js
"use strict";

/**
 * Derive publish gating state for a build or comp record.
 * Legacy records (publishedAt == null) are treated as fresh, never stale.
 * @param {{publishedFileId?: string, updatedAt?: string, publishedAt?: string|null}} record
 * @returns {{neverPublished: boolean, stale: boolean, shareable: boolean}}
 */
function buildPublishState(record) {
  const r = record || {};
  const neverPublished = !r.publishedFileId;
  const stale = Boolean(r.publishedAt) && r.updatedAt !== r.publishedAt;
  const shareable = !neverPublished && !stale;
  return { neverPublished, stale, shareable };
}

module.exports = { buildPublishState };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- tests/unit/publishState.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/publishState.js tests/unit/publishState.test.js
git commit -m "feat(shared): add buildPublishState helper (neverPublished/stale/shareable)"
```

---

### Task 3: Stamp `publishedAt` on publish + gate the main-process share handlers

**Files:**
- Modify: `src/main/index.js` (`builds:publish-build` final upsert ~1151-1156; `discord:share-build` ~1528-1530; `discord:share-comp` near ~1458)
- Modify: `src/main/compStore.js` (mirror Task 1 for comps — see note)
- Test: `tests/unit/shareGate.test.js`

**Interfaces:**
- Consumes: `buildPublishState` from `src/shared/publishState.js`.
- Produces: publish stamps `publishedAt`; `discord:share-build` / `discord:share-comp` reject stale records with `"Build has unpublished changes — publish again before sharing."` (build) / `"Comp has unpublished changes — publish again before sharing."` (comp).

**Note on comps:** Apply the same two edits from Task 1 to `src/main/compStore.js` (`normalizeComp`: add `publishedAt: asIso(input.publishedAt) || null;` next to its `publishedKey`; `upsertComp`: add the `__stampPublishedAt` stamp + `if (!next.publishedAt && existing.publishedAt) next.publishedAt = existing.publishedAt;` preserve line). The comp publish handler must pass `__stampPublishedAt: true` on its final metadata upsert.

- [ ] **Step 1: Write the failing test (gate predicate wired to handler logic)**

Create `tests/unit/shareGate.test.js`. This tests the small gate function we will extract so the IPC handler stays a thin wrapper:

```js
"use strict";
const { shareRejectionReason } = require("../../src/main/shareGate");

describe("shareRejectionReason", () => {
  test("rejects when never published", () => {
    expect(shareRejectionReason({ publishedFileId: "", publishedKey: "", updatedAt: "t1", publishedAt: null }, "Build"))
      .toBe("Build must be published before sharing");
  });
  test("rejects when published but missing key", () => {
    expect(shareRejectionReason({ publishedFileId: "x", publishedKey: "", updatedAt: "t1", publishedAt: "t1" }, "Build"))
      .toBe("Build must be published before sharing");
  });
  test("rejects stale", () => {
    expect(shareRejectionReason({ publishedFileId: "x", publishedKey: "k", updatedAt: "t2", publishedAt: "t1" }, "Build"))
      .toBe("Build has unpublished changes — publish again before sharing.");
  });
  test("allows fresh", () => {
    expect(shareRejectionReason({ publishedFileId: "x", publishedKey: "k", updatedAt: "t1", publishedAt: "t1" }, "Build"))
      .toBeNull();
  });
  test("allows legacy null publishedAt", () => {
    expect(shareRejectionReason({ publishedFileId: "x", publishedKey: "k", updatedAt: "t9", publishedAt: null }, "Build"))
      .toBeNull();
  });
  test("uses the noun in the stale message", () => {
    expect(shareRejectionReason({ publishedFileId: "x", publishedKey: "k", updatedAt: "t2", publishedAt: "t1" }, "Comp"))
      .toBe("Comp has unpublished changes — publish again before sharing.");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/shareGate.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gate module**

Create `src/main/shareGate.js`:

```js
"use strict";
const { buildPublishState } = require("../shared/publishState");

/**
 * @param {object} record build or comp
 * @param {"Build"|"Comp"} noun
 * @returns {string|null} rejection message, or null if shareable
 */
function shareRejectionReason(record, noun) {
  const r = record || {};
  if (!r.publishedFileId || !r.publishedKey) {
    return `${noun} must be published before sharing`;
  }
  const { stale } = buildPublishState(r);
  if (stale) {
    return `${noun} has unpublished changes — publish again before sharing.`;
  }
  return null;
}

module.exports = { shareRejectionReason };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- tests/unit/shareGate.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the stamp into the publish handler**

In `src/main/index.js` `builds:publish-build`, change the final metadata upsert (~1151-1156) to stamp:

```js
    const savedBuild = await store.upsertBuild({
      ...build,
      publishedSlug: newSlug,
      publishedFileId: fileId,
      publishedKey: encKey,
      __stampPublishedAt: true,
    });
```

(Do **not** add the flag to the earlier auto-name upsert at ~1034 — that one is a pre-publish save.)

- [ ] **Step 6: Wire the gate into both share handlers**

At the top of `src/main/index.js` (with the other requires), add:

```js
const { shareRejectionReason } = require("./shareGate");
```

In `discord:share-build` (~1527-1530), replace:

```js
    if (!build.publishedFileId || !build.publishedKey) {
      return { success: false, error: "Build must be published before sharing" };
    }
```

with:

```js
    const buildReject = shareRejectionReason(build, "Build");
    if (buildReject) return { success: false, error: buildReject };
```

In `discord:share-comp` (~1458+), find the equivalent published-check on the loaded comp and replace it with:

```js
    const compReject = shareRejectionReason(comp, "Comp");
    if (compReject) return { success: false, error: compReject };
```

- [ ] **Step 7: Run the full unit suite**

Run: `npm test -- tests/unit`
Expected: PASS (no regressions).

- [ ] **Step 8: Commit**

```bash
git add src/main/index.js src/main/compStore.js src/main/shareGate.js tests/unit/shareGate.test.js
git commit -m "feat(share): stamp publishedAt on publish and reject stale builds/comps in share handlers"
```

---

### Task 4: Disable the editor Discord share buttons + remove auto-publish

**Files:**
- Modify: `src/renderer/renderer.js` (Discord Embed handler ~1322-1388 — remove auto-publish block ~1341-1371)
- Modify: `src/renderer/modules/render-pages.js` (editor share button state, near the published-link logic ~755-766)
- Create: `src/renderer/modules/share-gate.js` (thin renderer wrapper around the shared helper)
- Test: `tests/unit/renderer/share-gate.test.js`

**Interfaces:**
- Consumes: `buildPublishState` from `src/shared/publishState.js`.
- Produces: `shareDisabledTooltip(build, editorDirty)` → `string | null` (null = enabled). Used to set `disabled` + `title` on share buttons.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/share-gate.test.js`:

```js
"use strict";
const { shareDisabledTooltip } = require("../../../src/renderer/modules/share-gate");

describe("shareDisabledTooltip", () => {
  test("never published", () => {
    expect(shareDisabledTooltip({ publishedFileId: "", updatedAt: "t", publishedAt: null }, false))
      .toBe("Publish this build first");
  });
  test("stale", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }, false))
      .toBe("Publish your latest changes first");
  });
  test("editor dirty even if published+fresh", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }, true))
      .toBe("Publish your latest changes first");
  });
  test("shareable and clean → enabled (null)", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }, false))
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/renderer/share-gate.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderer wrapper**

Create `src/renderer/modules/share-gate.js`:

```js
import { buildPublishState } from "../../shared/publishState.js";

/**
 * @param {object} build
 * @param {boolean} editorDirty in-memory unsaved-edits flag (pass false for non-editor contexts)
 * @returns {string|null} tooltip text when share is disabled, or null when enabled
 */
export function shareDisabledTooltip(build, editorDirty) {
  const { neverPublished, stale, shareable } = buildPublishState(build);
  if (neverPublished) return "Publish this build first";
  if (stale || editorDirty || !shareable) return "Publish your latest changes first";
  return null;
}
```

Note: `src/shared/publishState.js` is CommonJS (`module.exports`). Jest resolves it fine. For the ESM renderer import to work in the browser, add a dual export at the bottom of `src/shared/publishState.js`:

```js
if (typeof module !== "undefined") module.exports = { buildPublishState };
export { buildPublishState };
```

Replace the existing `module.exports = { buildPublishState };` line with the block above so both `require` (Jest/main) and `import` (renderer) work. Verify Task 2's test still passes after this change.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- tests/unit/renderer/share-gate.test.js tests/unit/publishState.test.js`
Expected: PASS (both).

- [ ] **Step 5: Remove the editor auto-publish block**

In `src/renderer/renderer.js` Discord Embed handler, delete the entire block labelled `// Auto-save + publish if not yet published` (the `if (!build?.publishedFileId) { ... }` at ~1341-1371). The handler keeps: webhook resolution, `discordEmbedItem.innerHTML = "Sharing..."`, the `shareBuildToDiscord` call, and the flash/fail handling. The button being disabled (Step 6) prevents reaching this in the not-shareable case; the main-process gate (Task 3) is the backstop.

- [ ] **Step 6: Set disabled state on the editor share buttons**

In `src/renderer/modules/render-pages.js`, near the published-link button logic (~755-766), import the helper at the top of the file:

```js
import { shareDisabledTooltip } from "./share-gate.js";
```

Then, where the share dropdown is (re)rendered (`renderEditorMeta`), add — using the current editor build and dirty flag:

```js
  const _shareBuild = state.builds.find((b) => b.id === state.editor?.id);
  const _shareTip = shareDisabledTooltip(_shareBuild, Boolean(state.editorDirty));
  for (const action of ["discord-copy", "discord-embed"]) {
    const btn = _el.editorShareMenu?.querySelector(`[data-action='${action}']`);
    if (!btn) continue;
    if (_shareTip) { btn.disabled = true; btn.title = _shareTip; }
    else { btn.disabled = false; btn.removeAttribute("title"); }
  }
```

(If `_el.editorShareMenu` is not already cached, query via the existing dropdown reference used by the published-link logic in the same function. Match the surrounding code's element-access style.)

- [ ] **Step 7: Verify the renderer wiring renders disabled buttons**

Run the existing renderer test suite (jsdom) to confirm no regressions:
Run: `npm test -- tests/unit/renderer`
Expected: PASS.

- [ ] **Step 8: Manual smoke (documented, run during execution)**

Launch the app (`npm run dev`), open an unpublished build → editor share dropdown shows greyed-out "Discord Copy"/"Discord Embed" with tooltip "Publish this build first". Edit a published build → tooltip "Publish your latest changes first". Publish → buttons enable.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/renderer.js src/renderer/modules/render-pages.js src/renderer/modules/share-gate.js src/shared/publishState.js tests/unit/renderer/share-gate.test.js
git commit -m "feat(editor): hard-disable Discord share until published+fresh; drop silent auto-publish"
```

---

### Task 5: Disable Discord share in the library context menu and comp detail

**Files:**
- Modify: `src/renderer/modules/library/context-menu.js` (~158-161)
- Modify: `src/renderer/modules/library/library.js` (`handleDiscordEmbed` — remove auto-publish branch)
- Modify: `src/renderer/modules/comps/comp-detail.js` (~459-461 share dropdown)

**Interfaces:**
- Consumes: `shareDisabledTooltip` (build) and `buildPublishState` (comp) from Tasks 2/4.

- [ ] **Step 1: Library context menu — disable items**

In `src/renderer/modules/library/context-menu.js`, import:

```js
import { shareDisabledTooltip } from "../share-gate.js";
```

Where the "Copy Link" / "Discord Embed" submenu items are built (~158-161), compute `const tip = shareDisabledTooltip(build, false);` for the right-clicked build and, when `tip` is truthy, render the items as disabled (add the menu's existing disabled class/attribute used elsewhere in this file) with `title = tip`, and skip wiring their click callbacks.

- [ ] **Step 2: Remove the library auto-publish branch**

In `src/renderer/modules/library/library.js` `handleDiscordEmbed`, delete the `if (!build?.publishedFileId) { ... auto-publish ... }` branch so the function only resolves webhooks and calls `shareBuildToDiscord`. The disabled menu item (Step 1) plus the main-process gate (Task 3) prevent the not-shareable path.

- [ ] **Step 3: Comp detail — disable share items**

In `src/renderer/modules/comps/comp-detail.js`, import `buildPublishState` from `../../../shared/publishState.js`. Where the "Discord Embed" / share items are rendered (~459-461), compute `const { shareable } = buildPublishState(comp);` and, when `!shareable`, add `disabled title="${comp.publishedFileId ? "Publish your latest changes first" : "Publish this comp first"}"` to those buttons (mirroring the existing `copy-published-link` disabled pattern at ~466).

- [ ] **Step 4: Manual smoke (documented)**

Right-click an unpublished build in the library → "Share to Discord" submenu items greyed with tooltip. Open an unpublished comp → comp share items greyed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/library/context-menu.js src/renderer/modules/library/library.js src/renderer/modules/comps/comp-detail.js
git commit -m "feat(library,comps): disable Discord share entries until published+fresh"
```

---

### Task 6: SPA version marker (content hash of the site bundle)

**Files:**
- Modify: `src/main/siteBundle.js`
- Test: `tests/unit/siteBundle.test.js`

**Interfaces:**
- Produces: `computeSpaVersion(bundle)` → 12-char hex string, deterministic over the SPA shell files only (excludes `site/builds/*`, `site/comps/*`, `site/r/*`, and the marker file itself). `SITE_VERSION_PATH` constant = `"site/site-version"`. `buildSpaBundle()` includes `files[SITE_VERSION_PATH] = computeSpaVersion(files)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/siteBundle.test.js`:

```js
"use strict";
const { computeSpaVersion, SITE_VERSION_PATH } = require("../../src/main/siteBundle");

const shell = {
  "site/index.html": "<html>a</html>",
  "site/assets/app.js": "console.log(1)",
};

describe("computeSpaVersion", () => {
  test("is deterministic for identical shell files", () => {
    expect(computeSpaVersion({ ...shell })).toBe(computeSpaVersion({ ...shell }));
  });
  test("changes when a shell file changes", () => {
    expect(computeSpaVersion(shell)).not.toBe(
      computeSpaVersion({ ...shell, "site/index.html": "<html>b</html>" })
    );
  });
  test("ignores per-build data, redirects, and the marker itself", () => {
    const withData = {
      ...shell,
      "site/builds/abc.enc": "ENCRYPTED",
      "site/comps/def.enc": "ENCRYPTED",
      "site/r/abc/index.html": "<meta>",
      [SITE_VERSION_PATH]: "deadbeef",
    };
    expect(computeSpaVersion(withData)).toBe(computeSpaVersion(shell));
  });
  test("returns a 12-char hex string", () => {
    expect(computeSpaVersion(shell)).toMatch(/^[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/siteBundle.test.js`
Expected: FAIL — `computeSpaVersion` is not exported.

- [ ] **Step 3: Implement**

In `src/main/siteBundle.js`, add `const crypto = require("node:crypto");` near the other requires, then add:

```js
const SITE_VERSION_PATH = "site/site-version";

function isShellPath(p) {
  if (p === SITE_VERSION_PATH) return false;
  if (p.startsWith("site/builds/") || p.startsWith("site/comps/") || p.startsWith("site/r/")) return false;
  return true;
}

function computeSpaVersion(bundle) {
  const hash = crypto.createHash("sha256");
  for (const rel of Object.keys(bundle).filter(isShellPath).sort()) {
    hash.update(rel);
    hash.update("\0");
    hash.update(String(bundle[rel]));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}
```

In `buildSpaBundle()`, before `return files;`, add:

```js
  files[SITE_VERSION_PATH] = computeSpaVersion(files);
```

Add to the `module.exports`: `computeSpaVersion, SITE_VERSION_PATH`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- tests/unit/siteBundle.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/siteBundle.js tests/unit/siteBundle.test.js
git commit -m "feat(siteBundle): content-hash version marker for the SPA shell"
```

---

### Task 7: Skip SPA shell upload + workflow when the marker is unchanged

**Files:**
- Modify: `src/main/githubApi.js` (`publishSiteBundle` — read remote marker, drop shell files when unchanged; expose whether the shell changed)
- Modify: `src/main/index.js` (`builds:publish-build` — only trigger the workflow when the shell changed)
- Test: `tests/unit/siteBundle.test.js` (add a pure helper test) + manual

**Interfaces:**
- Produces: a pure helper `partitionBundleForPublish(bundle, remoteVersion)` in `src/main/siteBundle.js` → `{ shellChanged: boolean, filesToPublish: object }`. When `remoteVersion === bundle[SITE_VERSION_PATH]`, shell files are dropped (only `site/builds/*`, `site/comps/*`, `site/r/*` remain) and `shellChanged === false`. `publishSiteBundle` returns `{ ...existing, shellChanged }`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/siteBundle.test.js`:

```js
const { partitionBundleForPublish } = require("../../src/main/siteBundle");

describe("partitionBundleForPublish", () => {
  const bundle = {
    "site/index.html": "<html>a</html>",
    "site/builds/abc.enc": "ENC",
    "site/r/abc/index.html": "<meta>",
  };
  const ver = require("../../src/main/siteBundle").computeSpaVersion(bundle);
  const full = { ...bundle, "site/site-version": ver };

  test("drops shell files when remote version matches", () => {
    const { shellChanged, filesToPublish } = partitionBundleForPublish(full, ver);
    expect(shellChanged).toBe(false);
    expect(filesToPublish["site/index.html"]).toBeUndefined();
    expect(filesToPublish["site/site-version"]).toBeUndefined();
    expect(filesToPublish["site/builds/abc.enc"]).toBe("ENC");
    expect(filesToPublish["site/r/abc/index.html"]).toBe("<meta>");
  });

  test("keeps everything when remote version differs", () => {
    const { shellChanged, filesToPublish } = partitionBundleForPublish(full, "000000000000");
    expect(shellChanged).toBe(true);
    expect(filesToPublish["site/index.html"]).toBe("<html>a</html>");
    expect(filesToPublish["site/site-version"]).toBe(ver);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/siteBundle.test.js -t partitionBundleForPublish`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement the helper**

In `src/main/siteBundle.js` add (and export `partitionBundleForPublish`):

```js
function partitionBundleForPublish(bundle, remoteVersion) {
  const localVersion = bundle[SITE_VERSION_PATH];
  const shellChanged = !remoteVersion || remoteVersion !== localVersion;
  if (shellChanged) return { shellChanged: true, filesToPublish: { ...bundle } };
  const filesToPublish = {};
  for (const [p, content] of Object.entries(bundle)) {
    if (!isShellPath(p)) filesToPublish[p] = content; // builds/comps/redirects only
  }
  return { shellChanged: false, filesToPublish };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- tests/unit/siteBundle.test.js`
Expected: PASS.

- [ ] **Step 5: Wire into `publishSiteBundle`**

In `src/main/githubApi.js`, at the top of `publishSiteBundle`, after resolving `entries`/before building blobs, read the remote marker and partition. Add a require at the top of the file: `const { partitionBundleForPublish, SITE_VERSION_PATH } = require("./siteBundle");`. Then near the start of the function:

```js
  let remoteVersion = null;
  try {
    const verFile = await apiFetch(`/repos/${owner}/${repo}/contents/${SITE_VERSION_PATH}?ref=${encodeURIComponent(branch)}`, token);
    if (verFile?.content) remoteVersion = Buffer.from(verFile.content, "base64").toString("utf8").trim();
  } catch { /* no marker yet → treat as shell changed */ }

  const { shellChanged, filesToPublish } = partitionBundleForPublish(bundle, remoteVersion);
```

Replace the function's use of `bundle` (the `Object.entries(bundle)...` at ~313) with `Object.entries(filesToPublish)`. Add `shellChanged` to **both** return objects (the early `changed:false` return ~381 and the final return ~419).

- [ ] **Step 6: Only trigger the workflow when the shell changed**

In `src/main/index.js` `builds:publish-build`, capture the publish result and gate the workflow dispatch. Change the upload + deploy region (~1142-1147):

```js
    progress("upload");
    const publishResult = await publishSiteBundle(session.token, owner, combinedBundle, branch, TARGET_REPO);

    // Only the SPA shell needs the Pages Actions rebuild. Build data is served
    // from raw.githubusercontent.com (see SPA), which reflects the commit in seconds.
    if (publishResult.shellChanged) {
      progress("deploy");
      await triggerPagesWorkflow(session.token, owner, branch, TARGET_REPO).catch(() => null);
    }
```

- [ ] **Step 7: Run the unit suite**

Run: `npm test -- tests/unit`
Expected: PASS.

- [ ] **Step 8: Manual verification (documented)**

With a real GitHub target: first publish triggers the workflow (shell changes, marker created). A second publish of a different build does **not** trigger the workflow (check the repo's Actions tab — no new run) and the new `site/builds/<id>.enc` commit lands within seconds.

- [ ] **Step 9: Commit**

```bash
git add src/main/siteBundle.js src/main/githubApi.js src/main/index.js tests/unit/siteBundle.test.js
git commit -m "feat(publish): skip SPA shell upload and Pages workflow when the shell is unchanged"
```

---

### Task 8: SPA fetches build/comp data from raw.githubusercontent.com

**Files:**
- Modify: `src/site/main.js` (`loadBuild` ~77-93, `loadComp` ~95-110)
- Create: `src/site/rawBase.js`
- Test: `tests/unit/site/rawBase.test.js`

**Interfaces:**
- Produces: `resolveDataBase(location, searchParams)` → base URL string ending in `/` from which `builds/<id>.enc` resolves. Priority: explicit `?remoteBase=` (dev) → else if host is `<owner>.github.io`, return `https://raw.githubusercontent.com/<owner>/<repo>/main/site/` → else relative `""`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/site/rawBase.test.js`:

```js
"use strict";
const { resolveDataBase } = require("../../../src/site/rawBase");

const sp = (s) => new URLSearchParams(s);

describe("resolveDataBase", () => {
  test("honors explicit remoteBase (dev)", () => {
    expect(resolveDataBase({ hostname: "localhost", pathname: "/" }, sp("remoteBase=http://x/site/")))
      .toBe("http://x/site/");
  });
  test("derives raw URL from github.io host + repo path", () => {
    expect(resolveDataBase({ hostname: "revan-malice.github.io", pathname: "/axibuilds/" }, sp("")))
      .toBe("https://raw.githubusercontent.com/revan-malice/axibuilds/main/site/");
  });
  test("handles deep pathname (build link)", () => {
    expect(resolveDataBase({ hostname: "gw2eww.github.io", pathname: "/axibuilds/index.html" }, sp("")))
      .toBe("https://raw.githubusercontent.com/gw2eww/axibuilds/main/site/");
  });
  test("falls back to relative base off github.io", () => {
    expect(resolveDataBase({ hostname: "example.com", pathname: "/" }, sp(""))).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/site/rawBase.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/site/rawBase.js`:

```js
// Resolve where the SPA fetches encrypted build/comp data.
// Pages serves the SPA shell; data is read from raw.githubusercontent.com so a
// fresh publish is live within seconds of the commit (no Pages workflow wait).
export function resolveDataBase(location, searchParams) {
  const explicit = searchParams.get("remoteBase");
  if (explicit) return explicit;
  const host = location.hostname || "";
  const m = host.match(/^([^.]+)\.github\.io$/);
  if (m) {
    const owner = m[1];
    const repo = (location.pathname || "/").split("/").filter(Boolean)[0] || "";
    if (repo) return `https://raw.githubusercontent.com/${owner}/${repo}/main/site/`;
  }
  return "";
}
```

For Jest (CommonJS) compatibility, append:

```js
if (typeof module !== "undefined") module.exports = { resolveDataBase };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- tests/unit/site/rawBase.test.js`
Expected: PASS.

- [ ] **Step 5: Use it in the SPA fetch**

In `src/site/main.js`, add at the top: `import { resolveDataBase } from "./rawBase.js";`. In `loadBuild`, replace the `remoteBase`/`buildUrl` lines (~80-84) with:

```js
    const params = new URLSearchParams(location.search);
    const base = resolveDataBase(location, params);
    const buildUrl = `${base}builds/${encodeURIComponent(fileId)}.enc`;
```

In `loadComp`, replace the equivalent lines (~98-101) with:

```js
    const params = new URLSearchParams(location.search);
    const base = resolveDataBase(location, params);
    const compUrl = `${base}comps/${encodeURIComponent(fileId)}.enc`;
```

(Keep the `cache: "no-store"` fetches and error handling.)

- [ ] **Step 6: Rebuild the SPA and run the SPA test suite**

Run: `npm run build:site && npm test -- tests/unit/site`
Expected: build succeeds; tests PASS.

- [ ] **Step 7: Manual verification (documented)**

Publish a build, open the shared `https://<owner>.github.io/<repo>/?n=...&b=<id>.<key>` link in a browser within a few seconds — it loads (no 404), with the `.enc` request going to `raw.githubusercontent.com`. Confirm a build published **before** this change still loads (its `.enc` file already exists at `site/builds/<id>.enc`, so raw resolves it).

- [ ] **Step 8: Commit**

```bash
git add src/site/main.js src/site/rawBase.js tests/unit/site/rawBase.test.js
git commit -m "feat(spa): fetch encrypted build/comp data from raw.githubusercontent for instant publishes"
```

---

### Task 9: Wait until the link is live before marking the build published

**Files:**
- Modify: `src/main/index.js` (`builds:publish-build` — poll the raw data URL before the final stamp upsert)
- Modify: `src/main/githubApi.js` (add `pollUrlLive`)
- Test: `tests/unit/pollUrlLive.test.js`

**Interfaces:**
- Produces: `pollUrlLive(url, { fetchImpl, timeoutMs = 90000, intervalMs = 3000, delayImpl })` → `Promise<boolean>`. Cache-busts with `?t=<n>`; resolves `true` on first 2xx, `false` at deadline. Dependency-injected `fetchImpl`/`delayImpl` for testability.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pollUrlLive.test.js`:

```js
"use strict";
const { pollUrlLive } = require("../../src/main/githubApi");

describe("pollUrlLive", () => {
  test("resolves true once the URL returns 200", async () => {
    let calls = 0;
    const fetchImpl = async () => ({ ok: ++calls >= 2 });
    const delayImpl = async () => {};
    await expect(pollUrlLive("http://x", { fetchImpl, delayImpl, intervalMs: 1, timeoutMs: 1000 }))
      .resolves.toBe(true);
    expect(calls).toBe(2);
  });

  test("resolves false at the deadline", async () => {
    const fetchImpl = async () => ({ ok: false });
    let t = 0;
    const delayImpl = async () => { t += 50; };
    const nowImpl = () => t;
    await expect(pollUrlLive("http://x", { fetchImpl, delayImpl, nowImpl, intervalMs: 50, timeoutMs: 100 }))
      .resolves.toBe(false);
  });

  test("tolerates fetch throwing mid-deploy", async () => {
    let calls = 0;
    const fetchImpl = async () => { if (++calls < 2) throw new Error("net"); return { ok: true }; };
    const delayImpl = async () => {};
    await expect(pollUrlLive("http://x", { fetchImpl, delayImpl, intervalMs: 1, timeoutMs: 1000 }))
      .resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/pollUrlLive.test.js`
Expected: FAIL — `pollUrlLive` not exported.

- [ ] **Step 3: Implement**

In `src/main/githubApi.js` add (and include in `module.exports`):

```js
async function pollUrlLive(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const delayImpl = opts.delayImpl || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const nowImpl = opts.nowImpl || Date.now;
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 90000;
  const deadline = nowImpl() + timeoutMs;
  for (;;) {
    try {
      const res = await fetchImpl(`${url}${url.includes("?") ? "&" : "?"}t=${nowImpl()}`, { cache: "no-store" });
      if (res && res.ok) return true;
    } catch { /* network hiccup mid-deploy — keep polling */ }
    if (nowImpl() >= deadline) return false;
    await delayImpl(intervalMs);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- tests/unit/pollUrlLive.test.js`
Expected: PASS.

- [ ] **Step 5: Poll before stamping in the publish handler**

In `src/main/index.js` `builds:publish-build`, after the upload/deploy region (Task 7) and **before** the final `store.upsertBuild({... __stampPublishedAt: true})`, add a live check against the raw build-data URL, then stamp. Add `pollUrlLive` to the `githubApi` require/destructure at the top of the file. Insert:

```js
    progress("pages");
    const rawBuildUrl = `https://raw.githubusercontent.com/${owner}/${TARGET_REPO}/${branch}/site/builds/${fileId}.enc`;
    const live = await pollUrlLive(rawBuildUrl);
    if (!live) {
      throw new Error("Published, but the link did not go live in time. Try again in a minute.");
    }
```

The existing final upsert (now with `__stampPublishedAt: true` from Task 3) runs only after `live` is confirmed. Because the `catch` in the handler reports via `failPublishStep`, a timeout surfaces on the "Waiting for Pages to go live" step and `publishedAt` is **not** stamped (the build keeps its prior state).

- [ ] **Step 6: Run the unit suite**

Run: `npm test -- tests/unit`
Expected: PASS.

- [ ] **Step 7: Manual verification (documented)**

Publish a build and immediately share — the link resolves with no 404 (the handler only returned after raw confirmed live). Disconnect mid-publish to confirm the timeout path shows a clear error and the build is not marked freshly published.

- [ ] **Step 8: Commit**

```bash
git add src/main/githubApi.js src/main/index.js tests/unit/pollUrlLive.test.js
git commit -m "feat(publish): confirm the build link is live before marking it published"
```

---

### Task 10: First-publish explainer modal

**Files:**
- Modify: `src/renderer/renderer.js` (`publishSiteBtn` click handler ~1445-1493)
- Test: manual (jsdom modal helper is already covered by its own module)

**Interfaces:**
- Consumes: `showConfirmModal` from `src/renderer/modules/confirm-modal.js` (returns `Promise<boolean>`).

- [ ] **Step 1: Import the modal helper**

In `src/renderer/renderer.js`, ensure `import { showConfirmModal } from "./modules/confirm-modal.js";` is present (add if missing).

- [ ] **Step 2: Gate the publish handler on first-publish confirmation**

At the very start of the `el.publishSiteBtn` click handler (after resolving `buildId`, before `el.publishSiteBtn.disabled = true`), add:

```js
    const isFirstPublishEver = !state.builds.some((b) => b.publishedFileId);
    if (isFirstPublishEver) {
      const proceed = await showConfirmModal({
        title: "Publishing puts your build online",
        body:
          "<p>Publishing uploads this build to your own GitHub Pages site so the shareable link " +
          "(including Discord) actually works for other people.</p>" +
          "<p>It uses the one-time GitHub sign-in you already set up, and takes a few seconds. " +
          "Your build link stays private unless you share it.</p>",
        confirmLabel: "Publish now",
        cancelLabel: "Cancel",
      });
      if (!proceed) return;
    }
```

- [ ] **Step 3: Manual verification (documented)**

Fresh profile with no published builds: clicking Publish shows the explainer once; Cancel aborts (no publish), Publish now proceeds. After the first successful publish, clicking Publish on any build no longer shows the modal.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat(publish): explain publishing the first time via a confirm modal"
```

---

### Task 11: Full regression pass

- [ ] **Step 1: Run the entire unit suite**

Run: `npm test -- tests/unit`
Expected: PASS.

- [ ] **Step 2: Run e2e (if the environment supports it)**

Run: `npm run test:e2e`
Expected: PASS or no new failures vs. baseline. Note any pre-existing failures.

- [ ] **Step 3: Build the app to catch import/bundling issues**

Run: `npm run build:site && npm run build:renderer`
Expected: both builds succeed (validates the new ESM/CJS dual exports in `src/shared/publishState.js` and `src/site/rawBase.js`).

- [ ] **Step 4: Commit any fixes, then finish the branch**

Use `superpowers:finishing-a-development-branch` to decide merge/PR.

---

## Self-Review

**Spec coverage:**
- §1 publish state tracking → Task 1 (build) + Task 3 note (comp) + Task 2 helper. ✓
- §2 hard-disable share (editor/library/comp) + remove auto-publish + main-process backstop → Tasks 3, 4, 5. ✓
- §3.1 version marker → Task 6; skip shell+workflow → Task 7. ✓
- §3.2 raw data fetch → Task 8. ✓
- §3.3 wait-until-live before stamping → Task 9. ✓
- §4 first-publish explainer → Task 10. ✓
- Testing section → per-task TDD + Task 11. ✓

**Placeholder scan:** No TBD/TODO; every code step shows code. Manual-verification steps are explicitly labelled where a unit test is impractical (IPC handlers, real GitHub calls), each with concrete observable expectations.

**Type consistency:** `buildPublishState` shape `{neverPublished, stale, shareable}` used identically in Tasks 2/3/4/5. `__stampPublishedAt` flag set in Task 3, consumed in Task 1. `shellChanged` produced in Task 7's `publishSiteBundle` and consumed in the same task's `index.js` edit. `SITE_VERSION_PATH = "site/site-version"` consistent across Tasks 6/7. `resolveDataBase` / `pollUrlLive` signatures match their call sites. `__stampPublishedAt` dual-purpose for builds and comps via mirrored store edits.
