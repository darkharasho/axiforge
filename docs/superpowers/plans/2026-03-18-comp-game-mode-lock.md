# Comp Game Mode Lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent PvE and WvW builds from being mixed in the same comp — the first build locks the comp's game mode; removing all builds unlocks it.

**Architecture:** Add `gameMode: null | "pve" | "wvw"` to the comp schema, persisted in `compStore.js`. A startup migration derives the value for existing comps. All three entry points where a build joins a comp (drag-drop, Add modal, paste) check compatibility against the comp's `gameMode` before proceeding. The drag-drop entry also adds an `is-invalid` CSS class as a visual signal during hover.

**Tech Stack:** Node.js (main process), vanilla JS ES modules (renderer), Jest (tests)

**Spec:** `docs/superpowers/specs/2026-03-18-comp-game-mode-lock-design.md`

---

## File Map

| File | Change |
|---|---|
| `src/main/compStore.js` | Add `gameMode` to `upsertComp` allowlist; clear it in `removeBuildFromComps` when `buildIds` empties |
| `src/main/index.js` | Add one-time startup migration that derives `gameMode` for all existing comps |
| `src/renderer/modules/library/library.js` | Export `isGameModeCompatible` helper; enforce in `handleDropBuildOnComp`, `handleRemoveBuildFromComp`, and both paths in `handlePasteJson` |
| `src/renderer/modules/comps/comp-detail.js` | Filter incompatible builds in `openAddBuildModal` |
| `src/renderer/modules/library/drag-drop.js` | Add/remove `is-invalid` class on comp elements during drag hover |
| `src/renderer/styles/library.css` | Add styles for `.lib-list-row--comp.is-invalid` drag target |
| `tests/unit/compStore.test.js` | Tests for `gameMode` in `upsertComp` and `removeBuildFromComps` |
| `tests/unit/renderer/library-paste.test.js` | Tests for `isGameModeCompatible` |

---

## Task 1: `upsertComp` — persist `gameMode` field

**Files:**
- Modify: `src/main/compStore.js:20-56`
- Test: `tests/unit/compStore.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/compStore.test.js` inside the `"CompStore — upsertComp"` describe block:

```js
test("defaults gameMode to null", async () => {
  const comp = await store.upsertComp(makeComp());
  expect(comp.gameMode).toBeNull();
});

test("persists gameMode: pve", async () => {
  const comp = await store.upsertComp(makeComp({ gameMode: "pve" }));
  expect(comp.gameMode).toBe("pve");
});

test("persists gameMode: wvw", async () => {
  const comp = await store.upsertComp(makeComp({ gameMode: "wvw" }));
  expect(comp.gameMode).toBe("wvw");
});

test("persists gameMode null (unlocked)", async () => {
  const comp = await store.upsertComp(makeComp({ gameMode: null }));
  expect(comp.gameMode).toBeNull();
});

test("gameMode survives an update round-trip", async () => {
  const created = await store.upsertComp(makeComp({ gameMode: "wvw" }));
  const updated = await store.upsertComp({ ...created, name: "New Name" });
  expect(updated.gameMode).toBe("wvw");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/unit/compStore.test.js --no-coverage
```

Expected: tests fail with something like `Expected: "pve", Received: undefined`

- [ ] **Step 3: Add `gameMode` to `upsertComp` in `compStore.js`**

In `src/main/compStore.js`, add `gameMode` normalization after line 29 (`const buildIds = ...`):

```js
const gameMode = input.gameMode === "pve" || input.gameMode === "wvw" ? input.gameMode : null;
```

Then include `gameMode` in both the `Object.assign` block (line 41) and the new comp literal (line 50):

```js
// Object.assign block (existing comp update, ~line 41):
Object.assign(existing, {
  name, notes, tags, folderId, sortOrder, buildIds, partyLines, gameMode,
  updatedAt: now,
});

// New comp literal (~line 50):
const comp = {
  id, name, notes, tags, folderId, sortOrder, buildIds, partyLines, gameMode,
  createdAt: now, updatedAt: now,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/unit/compStore.test.js --no-coverage
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/main/compStore.js tests/unit/compStore.test.js
git commit -m "feat: add gameMode field to comp schema"
```

---

## Task 2: `removeBuildFromComps` — clear `gameMode` when last build removed

**Files:**
- Modify: `src/main/compStore.js:73-89`
- Test: `tests/unit/compStore.test.js`

This handles the build-deletion path: when a build is deleted via the main process, `removeBuildFromComps` is called. If that empties a comp's `buildIds`, the comp's `gameMode` must be reset to `null`.

- [ ] **Step 1: Write the failing tests**

Add a new describe block to `tests/unit/compStore.test.js`:

```js
describe("CompStore — removeBuildFromComps — gameMode unlock", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("clears gameMode when last build is removed", async () => {
    await store.upsertComp(makeComp({
      gameMode: "pve",
      buildIds: ["b1"],
      partyLines: [{ id: "pl1", capacity: 5, slots: ["b1"] }],
    }));
    await store.removeBuildFromComps("b1");
    const comps = await store.listComps();
    expect(comps[0].buildIds).toEqual([]);
    expect(comps[0].gameMode).toBeNull();
  });

  test("does not clear gameMode when builds remain", async () => {
    await store.upsertComp(makeComp({
      gameMode: "pve",
      buildIds: ["b1", "b2"],
      partyLines: [{ id: "pl1", capacity: 5, slots: ["b1", "b2"] }],
    }));
    await store.removeBuildFromComps("b1");
    const comps = await store.listComps();
    expect(comps[0].buildIds).toEqual(["b2"]);
    expect(comps[0].gameMode).toBe("pve");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/unit/compStore.test.js --no-coverage
```

Expected: the two new tests fail (`Expected: null, Received: "pve"`)

- [ ] **Step 3: Update `removeBuildFromComps` in `compStore.js`**

The full `for (const comp of comps)` loop currently looks like this (lines 76-87):

```js
for (const comp of comps) {
  if (comp.buildIds.includes(buildId)) {
    comp.buildIds = comp.buildIds.filter((id) => id !== buildId);
    changed = true;
  }
  for (const line of comp.partyLines) {
    if (line.slots.includes(buildId)) {
      line.slots = line.slots.filter((id) => id !== buildId);
      changed = true;
    }
  }
}
```

Add the `gameMode = null` unlock inside the `if` block, but do NOT change the `partyLines` loop below it — it must remain as a sibling block:

```js
for (const comp of comps) {
  if (comp.buildIds.includes(buildId)) {
    comp.buildIds = comp.buildIds.filter((id) => id !== buildId);
    if (comp.buildIds.length === 0) {
      comp.gameMode = null;
    }
    changed = true;
  }
  for (const line of comp.partyLines) {
    if (line.slots.includes(buildId)) {
      line.slots = line.slots.filter((id) => id !== buildId);
      changed = true;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/unit/compStore.test.js --no-coverage
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/main/compStore.js tests/unit/compStore.test.js
git commit -m "feat: clear comp gameMode when last build is removed via store"
```

---

## Task 3: Startup migration

**Files:**
- Modify: `src/main/index.js:160-163`

This runs once at startup, before any IPC handler is registered. It reads both build and comp data (both stores are initialized by this point) and sets `gameMode` on any comp that doesn't have it yet.

No unit test — this is a startup side-effect that would require full store mocking. Verify manually by running the app.

- [ ] **Step 1: Add migration function and call it in `index.js`**

Insert the migration call after `await compStore.init();` and **before** `const win = createWindow();` (line 164). Ordering matters: `createWindow()` loads the renderer, which could fire IPC before migration completes.

```js
await migrateCompGameModes(store, compStore);
```

Then define the function above `app.whenReady()`:

```js
async function migrateCompGameModes(buildStore, compStore) {
  const comps = await compStore.listComps();
  // Skip if all comps already have the gameMode field
  if (comps.every((c) => "gameMode" in c)) return;
  const builds = await buildStore.listBuilds();
  const buildMap = new Map(builds.map((b) => [b.id, b]));
  for (const comp of comps) {
    if ("gameMode" in comp) continue;
    let gameMode = null;
    if (comp.buildIds && comp.buildIds.length > 0) {
      const firstBuild = buildMap.get(comp.buildIds[0]);
      gameMode = firstBuild?.gameMode ?? null;
    }
    await compStore.upsertComp({ ...comp, gameMode });
  }
}
```

- [ ] **Step 2: Start the app and verify no errors in the console**

```bash
npm start
```

Open the app, check DevTools console — no errors. Open a comp to confirm it still loads correctly.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.js
git commit -m "feat: migrate existing comps to have gameMode field on startup"
```

---

## Task 4: `isGameModeCompatible` helper + enforce in `handleDropBuildOnComp`

**Files:**
- Modify: `src/renderer/modules/library/library.js:681-712`
- Test: `tests/unit/renderer/library-paste.test.js`

- [ ] **Step 1: Write the failing test**

The existing `tests/unit/renderer/library-paste.test.js` already has this at line 1-5:

```js
const {
  nextCopyTitle,
} = require("../../../src/renderer/modules/library/library.js");
```

Update that destructuring to also import `isGameModeCompatible`:

```js
const {
  nextCopyTitle,
  isGameModeCompatible,
} = require("../../../src/renderer/modules/library/library.js");
```

Then add the new describe block at the bottom of the file:

```js
describe("isGameModeCompatible", () => {
  test("open comp (null) is compatible with any build", () => {
    expect(isGameModeCompatible({ gameMode: null }, { gameMode: "pve" })).toBe(true);
    expect(isGameModeCompatible({ gameMode: null }, { gameMode: "wvw" })).toBe(true);
  });

  test("pve comp is compatible with pve build", () => {
    expect(isGameModeCompatible({ gameMode: "pve" }, { gameMode: "pve" })).toBe(true);
  });

  test("pve comp is incompatible with wvw build", () => {
    expect(isGameModeCompatible({ gameMode: "pve" }, { gameMode: "wvw" })).toBe(false);
  });

  test("wvw comp is compatible with wvw build", () => {
    expect(isGameModeCompatible({ gameMode: "wvw" }, { gameMode: "wvw" })).toBe(true);
  });

  test("wvw comp is incompatible with pve build", () => {
    expect(isGameModeCompatible({ gameMode: "wvw" }, { gameMode: "pve" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/renderer/library-paste.test.js --no-coverage
```

Expected: fail — `isGameModeCompatible` is not exported

- [ ] **Step 3: Export `isGameModeCompatible` from `library.js`**

Add this function near the top of `library.js`, alongside other exported helpers like `nextCopyTitle`:

```js
export function isGameModeCompatible(comp, build) {
  if (!comp.gameMode) return true;
  return comp.gameMode === build.gameMode;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/renderer/library-paste.test.js --no-coverage
```

Expected: all `isGameModeCompatible` tests pass

- [ ] **Step 5: Enforce compatibility in `handleDropBuildOnComp`**

In `library.js`, modify `handleDropBuildOnComp` (~line 681). Add the check after the early returns, before the `saveBuild` call. Also set `gameMode` on the comp when saving it:

```js
async function handleDropBuildOnComp(buildId, compId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  if (build.compId === compId) return;

  // Game mode lock check
  const comp = state.comps?.find((c) => c.id === compId);
  if (comp && !isGameModeCompatible(comp, build)) {
    const modeName = comp.gameMode === "wvw" ? "WvW" : "PvE";
    showToast(`This comp is locked to ${modeName} builds.`, "error");
    return;
  }

  const oldFolderId = build.folderId || null;
  const oldCompId = build.compId || null;
  await window.desktopApi.saveBuild({ ...build, compId, folderId: null });
  if (comp) {
    const buildIds = Array.isArray(comp.buildIds) ? comp.buildIds : [];
    if (!buildIds.includes(buildId)) {
      const newGameMode = comp.gameMode || build.gameMode;
      await window.desktopApi.saveComp({ ...comp, gameMode: newGameMode, buildIds: [...buildIds, buildId] });
    }
  }
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
  pushUndo({ type: "move-to-comp", undo: async () => {
    const current = state.builds.find((b) => b.id === buildId);
    if (current) await window.desktopApi.saveBuild({ ...current, compId: oldCompId, folderId: oldFolderId });
    const c = state.comps?.find((c) => c.id === compId);
    if (c) {
      const ids = (c.buildIds || []).filter((id) => id !== buildId);
      const gameMode = ids.length === 0 ? null : c.gameMode;
      await window.desktopApi.saveComp({ ...c, buildIds: ids, gameMode });
    }
    state.builds = await window.desktopApi.listBuilds();
    state.comps = await window.desktopApi.listComps();
  }});
  renderLibrary();
}
```

- [ ] **Step 6: Manually test drag-drop enforcement**

Start the app (`npm start`). Create one PvE build and one WvW build. Create a comp. Drag the PvE build into the comp — it should succeed. Then drag the WvW build into the same comp — a toast should appear saying "This comp is locked to PvE builds." and the WvW build should not be added.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/library/library.js tests/unit/renderer/library-paste.test.js
git commit -m "feat: enforce game mode lock on drag-drop build into comp"
```

---

## Task 5: Clear `gameMode` when last build removed via renderer

**Files:**
- Modify: `src/renderer/modules/library/library.js:714-744`

The renderer-side removal path (`handleRemoveBuildFromComp`) also needs to clear `comp.gameMode` when it empties `buildIds`.

No new test — this is a renderer function that uses `window.desktopApi` (requires DOM/IPC mocking to test). Verify manually.

- [ ] **Step 1: Update `handleRemoveBuildFromComp` to clear `gameMode` and restore it on undo**

The current function captures `oldCompBuildIds` and `oldCompPartyLines` before the forward path (lines 717-718). Add `oldGameMode` alongside them:

```js
const oldCompBuildIds = comp ? [...(comp.buildIds || [])] : [];
const oldCompPartyLines = comp ? JSON.parse(JSON.stringify(comp.partyLines || [])) : [];
const oldGameMode = comp?.gameMode ?? null;  // ADD THIS LINE
```

Then, after computing `buildIds` (~line 726-731), pass `gameMode` to `saveComp`:

```js
const buildIds = (comp.buildIds || []).filter((id) => id !== buildId);
const partyLines = (comp.partyLines || []).map((line) => ({
  ...line,
  slots: (line.slots || []).filter((id) => id !== buildId),
}));
const gameMode = buildIds.length === 0 ? null : comp.gameMode;
await window.desktopApi.saveComp({ ...comp, buildIds, partyLines, gameMode });
```

Finally, in the undo closure (~line 740), include `gameMode: oldGameMode` in the `saveComp` call so undo fully restores the comp to its prior state:

```js
if (c) await window.desktopApi.saveComp({ ...c, buildIds: oldCompBuildIds, partyLines: oldCompPartyLines, gameMode: oldGameMode });
```

- [ ] **Step 2: Manually test unlock behavior**

In the app: add a single PvE build to a comp (comp locks to PvE). Remove that build from the comp pool. Add a WvW build — it should now succeed (comp is open again).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/library/library.js
git commit -m "feat: unlock comp gameMode when last build is removed from pool"
```

---

## Task 6: Enforce in `handlePasteJson` — both code paths

**Files:**
- Modify: `src/renderer/modules/library/library.js:480-578`

`handlePasteJson` has two internal paths that can add builds to a comp: the cut-move path and the clipboard-paste path. Both need compatibility checks.

No new test — the function depends on `window.desktopApi` and `state`. Verify manually.

- [ ] **Step 1: Enforce in the cut-move path (~lines 513-525)**

In the `if (compId)` branch of the cut-move path, add a compatibility pre-check before moving any builds. **Important:** `idsToMove` is declared `const` at line 502 — do NOT redeclare it. Use a new variable `filteredToMove` for the compatible subset:

```js
if (compId) {
  // Game mode lock check — filter builds to only those compatible with the comp
  const targetComp = state.comps?.find((c) => c.id === compId);
  let effectiveLock = targetComp?.gameMode || null;
  const incompatibleIds = [];
  const filteredToMove = [];

  for (const id of idsToMove) {
    const build = state.builds.find((b) => b.id === id);
    if (!build) continue;
    if (effectiveLock === null) {
      effectiveLock = build.gameMode;
      filteredToMove.push(id);
    } else if (isGameModeCompatible({ gameMode: effectiveLock }, build)) {
      filteredToMove.push(id);
    } else {
      incompatibleIds.push(id);
    }
  }

  if (incompatibleIds.length > 0) {
    const modeName = effectiveLock === "wvw" ? "WvW" : "PvE";
    showToast(`${incompatibleIds.length} build(s) skipped — comp is locked to ${modeName}.`, "error");
    if (filteredToMove.length === 0) { _cutIds = []; return; }
  }

  // Move only the compatible builds; replace the loop variable with filteredToMove
  for (const id of filteredToMove) {
    // ... (rest of the existing cut-move loop body, replacing idsToMove with filteredToMove)
  }
```

When saving the comp in that loop, include `gameMode`. To avoid N IPC round-trips, update the relevant comp in `state.comps` in-memory (rather than fetching the full list each iteration):

```js
const comp = state.comps?.find((c) => c.id === compId);
if (comp && !(comp.buildIds || []).includes(id)) {
  const newGameMode = comp.gameMode || state.builds.find((b) => b.id === id)?.gameMode || null;
  const updatedComp = { ...comp, gameMode: newGameMode, buildIds: [...(comp.buildIds || []), id] };
  await window.desktopApi.saveComp(updatedComp);
  // Update in-memory so subsequent iterations see the set gameMode
  const idx = state.comps.findIndex((c) => c.id === compId);
  if (idx !== -1) state.comps[idx] = updatedComp;
}
```

- [ ] **Step 2: Enforce in the clipboard-paste path (~lines 561-578)**

After determining `compId` is set and before the `for (const item of items)` loop, add:

```js
if (compId) {
  const targetComp = state.comps?.find((c) => c.id === compId);
  // Filter items to only those compatible with the comp's game mode (or would-be mode)
  let effectiveLock = targetComp?.gameMode || null;
  items = items.filter((item) => {
    if (!item || typeof item !== "object") return true;
    const source = item.build && typeof item.build === "object" ? item.build : item;
    const buildGameMode = source.gameMode || "pve";
    if (effectiveLock === null) { effectiveLock = buildGameMode; return true; }
    return buildGameMode === effectiveLock;
  });
  if (items.length === 0) {
    // Use effectiveLock (not targetComp?.gameMode) — it may have been set by the first item
    const modeName = effectiveLock === "wvw" ? "WvW" : "PvE";
    showToast(`This comp is locked to ${modeName} builds.`, "error");
    return;
  }
}
```

Also: when saving the comp in the clipboard-paste loop (~line 572-576), include `gameMode`. Use the same in-memory pattern to avoid N IPC round-trips:

```js
if (compId && saved) {
  const comp = state.comps?.find((c) => c.id === compId);
  if (comp && !(comp.buildIds || []).includes(saved.id)) {
    const newGameMode = comp.gameMode || saved.gameMode || null;
    const updatedComp = { ...comp, gameMode: newGameMode, buildIds: [...(comp.buildIds || []), saved.id] };
    await window.desktopApi.saveComp(updatedComp);
    const idx = state.comps.findIndex((c) => c.id === compId);
    if (idx !== -1) state.comps[idx] = updatedComp;
  }
}
```

- [ ] **Step 3: Manually test paste enforcement**

In the app:
1. Create a WvW build. Create a comp. Cut the WvW build and paste it into the comp — should succeed and lock the comp to WvW.
2. Create a PvE build. Copy it. Navigate to the WvW-locked comp. Press Ctrl+V — toast should say "This comp is locked to WvW builds." and no build should be added.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/library/library.js
git commit -m "feat: enforce game mode lock in paste handlers"
```

---

## Task 7: Filter incompatible builds in the Add modal

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js:647-771`

When the comp has a `gameMode` lock, the Add Build modal should only show compatible builds.

- [ ] **Step 1: Update the `available` filter in `openAddBuildModal`**

In `comp-detail.js`, the `available` array is defined at ~line 655:

```js
const available = state.builds.filter((b) => !b.compId);
```

Change it to also filter by game mode when the comp is locked:

```js
const available = state.builds.filter((b) => {
  if (b.compId) return false;
  if (comp.gameMode && b.gameMode !== comp.gameMode) return false;
  return true;
});
```

- [ ] **Step 2: Set `comp.gameMode` in the "Add Selected" handler**

The "Add Selected" button handler (~line 744) calls `saveAndSync(comp)` after updating `comp.buildIds`. But if the comp was open (`comp.gameMode === null`), it never gets locked. Fix by deriving and setting `gameMode` before saving:

```js
overlay.querySelector("[data-action='picker-add']")?.addEventListener("click", async () => {
  if (selected.size === 0) return;
  // Move each selected build into this comp
  for (const buildId of selected) {
    const build = state.builds.find((b) => b.id === buildId);
    if (build) {
      await window.desktopApi.saveBuild({ ...build, compId: comp.id, folderId: null });
    }
  }
  // Add to comp's buildIds and lock gameMode if not already set
  comp.buildIds = [...new Set([...(comp.buildIds || []), ...selected])];
  if (!comp.gameMode) {
    const firstSelectedBuild = state.builds.find((b) => selected.has(b.id));
    comp.gameMode = firstSelectedBuild?.gameMode || null;
  }
  await saveAndSync(comp);
  state.builds = await window.desktopApi.listBuilds();
  overlay.remove();
  _callbacks.onRerender?.();
});
```

- [ ] **Step 3: Manually test the modal filter and lock**

In the app:
1. Open an empty comp. Click Add — all builds should appear.
2. Add a PvE build via the modal — comp should now be locked to PvE.
3. Click Add again — only PvE builds should appear; WvW builds should be absent.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js
git commit -m "feat: filter incompatible builds from comp Add modal when locked"
```

---

## Task 8: Drag visual indicator

**Files:**
- Modify: `src/renderer/modules/library/drag-drop.js:165-212`
- Modify: `src/renderer/styles/library.css` (near line 909)

When hovering a locked comp with an incompatible build, show a red/invalid drag target instead of the normal blue one.

- [ ] **Step 1: Add `is-invalid` CSS styles**

In `src/renderer/styles/library.css`, after the `.lib-list-row--comp.lib-drop-target` rule (~line 912), add:

```css
.lib-list-row--comp.lib-drop-target.is-invalid {
  outline: 2px dashed rgba(255, 90, 90, 0.5);
  background: rgba(255, 90, 90, 0.06);
  cursor: not-allowed;
}
```

- [ ] **Step 2: Add `is-invalid` class in `_onPointerMove`**

In `drag-drop.js`, the comp hover block (~lines 196-201):

```js
const compEl = el.closest("[data-comp-id]");
if (compEl && _draggedBuildId) {
  _hoverTarget = compEl;
  compEl.classList.add("lib-drop-target");
  return;
}
```

Change to:

```js
const compEl = el.closest("[data-comp-id]");
if (compEl && _draggedBuildId) {
  _hoverTarget = compEl;
  compEl.classList.add("lib-drop-target");
  // Show invalid indicator if comp is locked to a different game mode
  const hoveredComp = state.comps?.find((c) => c.id === compEl.dataset.compId);
  const draggedBuild = state.builds?.find((b) => b.id === _draggedBuildId);
  if (hoveredComp?.gameMode && draggedBuild && hoveredComp.gameMode !== draggedBuild.gameMode) {
    compEl.classList.add("is-invalid");
  }
  return;
}
```

- [ ] **Step 3: Clear `is-invalid` when hover target changes**

In `_onPointerMove`, the clear block at lines 169-172:

```js
if (_hoverTarget) {
  _hoverTarget.classList.remove("lib-drop-target");
  _hoverTarget = null;
}
```

Change to:

```js
if (_hoverTarget) {
  _hoverTarget.classList.remove("lib-drop-target", "is-invalid");
  _hoverTarget = null;
}
```

- [ ] **Step 4: Clear `is-invalid` in `onEnd`**

In `onEnd` (~line 54-57):

```js
if (_hoverTarget) {
  _hoverTarget.classList.remove("lib-drop-target");
  _hoverTarget = null;
}
```

Change to:

```js
if (_hoverTarget) {
  _hoverTarget.classList.remove("lib-drop-target", "is-invalid");
  _hoverTarget = null;
}
```

- [ ] **Step 5: Manually test the visual indicator**

In the app: add a PvE build to a comp (comp locks to PvE). Then start dragging a WvW build. Hover over the locked comp — the drop target should show red/dashed instead of blue/dashed. Releasing over it should show the toast and not add the build.

- [ ] **Step 6: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/library/drag-drop.js src/renderer/styles/library.css
git commit -m "feat: show invalid drag indicator when hovering incompatible locked comp"
```
