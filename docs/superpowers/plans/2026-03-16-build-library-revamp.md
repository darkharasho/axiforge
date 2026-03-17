# Build Library Revamp — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat build list with a file-system-like library featuring folders, four view modes, context menus, drag-and-drop, multi-select, and sortable/filterable columns.

**Architecture:** Flat data model with metadata (builds get `folderId`/`pinned`/`sortOrder` fields, folders stored separately in `folders.json`). Smart folders computed at render time. New `library/` module directory with focused vanilla JS modules for sidebar, content views, toolbar, selection, context menus, and drag-drop. All UI icons use inline Heroicon SVGs; build icons use existing `gw2-class-icons` package.

**Tech Stack:** Electron 37, vanilla JS (no framework), Vite, Jest for testing, CSS with `lib-` prefix namespace.

**Spec:** `docs/superpowers/specs/2026-03-16-build-library-revamp-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/main/folderStore.js` | Persistence layer for `folders.json` — CRUD, reorder, depth validation |
| `tests/unit/folderStore.test.js` | Unit tests for FolderStore |
| `src/renderer/modules/library/library.js` | Orchestrator — initializes all library sub-modules, wires events |
| `src/renderer/modules/library/sidebar.js` | Sidebar tree rendering, folder navigation, expand/collapse |
| `src/renderer/modules/library/content.js` | Renders active view mode (list/table/grid/icon) |
| `src/renderer/modules/library/toolbar.js` | Search, sort, view toggle, filter chips, breadcrumb |
| `src/renderer/modules/library/context-menu.js` | Right-click context menus for builds, folders, multi-select, empty area |
| `src/renderer/modules/library/selection.js` | Selection state, Ctrl/Shift+click, keyboard navigation |
| `src/renderer/modules/library/drag-drop.js` | Drag-and-drop for builds and folders |
| `src/renderer/modules/library/folder-store.js` | Client-side folder operations via IPC |
| `src/renderer/modules/library/heroicons.js` | Inline SVG strings for all Heroicons used in library |
| `src/renderer/styles/library.css` | All library styles with `lib-` prefix |

### Modified Files

| File | Changes |
|------|---------|
| `src/main/buildStore.js` | Add `folderId`, `pinned`, `sortOrder` to `normalizeBuild()` |
| `src/main/index.js` | Add IPC handlers for folders and new build operations |
| `src/preload/index.js` | Add new desktopApi methods for folders, move, pin, reorder |
| `src/renderer/modules/state.js` | Add `folders`, `libraryPrefs`, `currentFolder` to state |
| `src/renderer/modules/render-pages.js` | Replace `renderBuildList()` with library module delegation |
| `src/renderer/renderer.js` | Wire library init, update keyboard shortcuts, update event bindings |
| `src/renderer/index.html` | Replace library page markup with new DOM skeleton |
| `src/renderer/styles/cards.css` | Remove `.build-list`, `.build-card*` selectors |

---

## Chunk 1: Data Layer — FolderStore, BuildStore Changes, IPC & Preload

### Task 1: Add new fields to BuildStore normalization

**Files:**
- Modify: `src/main/buildStore.js:95-119` (normalizeBuild function)
- Test: `tests/unit/buildStore.test.js`

- [ ] **Step 1: Write tests for new build fields**

Add a new describe block to `tests/unit/buildStore.test.js`:

```javascript
// ---------------------------------------------------------------------------
// New library fields
// ---------------------------------------------------------------------------

describe("BuildStore — library fields", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("normalizeBuild adds folderId, pinned, sortOrder defaults", async () => {
    const saved = await store.upsertBuild(makeBuild());
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.folderId).toBe(null);
    expect(build.pinned).toBe(false);
    expect(build.sortOrder).toBe(0);
  });

  test("preserves folderId when set", async () => {
    const saved = await store.upsertBuild(
      makeBuild({ folderId: "folder-123" }),
    );
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.folderId).toBe("folder-123");
  });

  test("preserves pinned when true", async () => {
    const saved = await store.upsertBuild(makeBuild({ pinned: true }));
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.pinned).toBe(true);
  });

  test("preserves sortOrder when set", async () => {
    const saved = await store.upsertBuild(makeBuild({ sortOrder: 5 }));
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.sortOrder).toBe(5);
  });

  test("coerces non-boolean pinned to boolean", async () => {
    const saved = await store.upsertBuild(makeBuild({ pinned: "yes" }));
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.pinned).toBe(true);
  });

  test("coerces non-number sortOrder to 0", async () => {
    const saved = await store.upsertBuild(makeBuild({ sortOrder: "abc" }));
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.sortOrder).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/buildStore.test.js --verbose`
Expected: 6 new tests FAIL (folderId/pinned/sortOrder not present on normalized builds)

- [ ] **Step 3: Add new fields to normalizeBuild()**

In `src/main/buildStore.js`, find the `normalizeBuild` function (line ~95). Add three new fields to the returned object, after the `publishedKey` line:

```javascript
    // Library organization fields
    folderId:
      typeof input.folderId === "string" ? input.folderId : null,
    pinned: Boolean(input.pinned),
    sortOrder:
      typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
        ? input.sortOrder
        : 0,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/buildStore.test.js --verbose`
Expected: All tests PASS including 6 new ones

- [ ] **Step 5: Commit**

```bash
git add src/main/buildStore.js tests/unit/buildStore.test.js
git commit -m "feat(library): add folderId, pinned, sortOrder to build normalization"
```

---

### Task 2: Create FolderStore

**Files:**
- Create: `src/main/folderStore.js`
- Create: `tests/unit/folderStore.test.js`

- [ ] **Step 1: Write FolderStore tests**

Create `tests/unit/folderStore.test.js`:

```javascript
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { FolderStore } = require("../../src/main/folderStore");

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-folder-"));
  const store = new FolderStore(dir);
  await store.init();
  return { store, dir };
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// FolderStore CRUD
// ---------------------------------------------------------------------------

describe("FolderStore — init", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates folders.json if missing", async () => {
    const content = await fs.readFile(
      path.join(dir, "folders.json"),
      "utf-8",
    );
    expect(JSON.parse(content)).toEqual([]);
  });

  test("preserves existing folders.json", async () => {
    const existing = [{ id: "x", name: "Test" }];
    await fs.writeFile(
      path.join(dir, "folders.json"),
      JSON.stringify(existing),
    );
    const store2 = new FolderStore(dir);
    await store2.init();
    const folders = await store2.listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0].id).toBe("x");
  });
});

describe("FolderStore — listFolders", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("returns empty array initially", async () => {
    expect(await store.listFolders()).toEqual([]);
  });
});

describe("FolderStore — upsertFolder", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates folder with generated id", async () => {
    const folder = await store.upsertFolder({ name: "Raid Builds" });
    expect(folder.id).toBeTruthy();
    expect(folder.name).toBe("Raid Builds");
    expect(folder.parentId).toBe(null);
    expect(folder.sortOrder).toBe(0);
    expect(folder.createdAt).toBeTruthy();
    expect(folder.updatedAt).toBeTruthy();
  });

  test("updates existing folder by id", async () => {
    const created = await store.upsertFolder({ name: "Old Name" });
    const updated = await store.upsertFolder({
      id: created.id,
      name: "New Name",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("New Name");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    const folders = await store.listFolders();
    expect(folders).toHaveLength(1);
  });

  test("sets parentId when provided", async () => {
    const parent = await store.upsertFolder({ name: "Parent" });
    const child = await store.upsertFolder({
      name: "Child",
      parentId: parent.id,
    });
    expect(child.parentId).toBe(parent.id);
  });

  test("rejects nesting deeper than 3 levels", async () => {
    const lvl1 = await store.upsertFolder({ name: "Level 1" });
    const lvl2 = await store.upsertFolder({
      name: "Level 2",
      parentId: lvl1.id,
    });
    const lvl3 = await store.upsertFolder({
      name: "Level 3",
      parentId: lvl2.id,
    });
    await expect(
      store.upsertFolder({ name: "Level 4", parentId: lvl3.id }),
    ).rejects.toThrow("Maximum folder nesting depth");
  });

  test("truncates name to 100 characters", async () => {
    const longName = "A".repeat(150);
    const folder = await store.upsertFolder({ name: longName });
    expect(folder.name).toBe("A".repeat(100));
  });
});

describe("FolderStore — deleteFolder", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("removes folder by id", async () => {
    const folder = await store.upsertFolder({ name: "Doomed" });
    await store.deleteFolder(folder.id);
    expect(await store.listFolders()).toEqual([]);
  });

  test("removes sub-folders when parent deleted", async () => {
    const parent = await store.upsertFolder({ name: "Parent" });
    await store.upsertFolder({ name: "Child", parentId: parent.id });
    await store.deleteFolder(parent.id);
    expect(await store.listFolders()).toEqual([]);
  });

  test("returns ids of all deleted folders", async () => {
    const parent = await store.upsertFolder({ name: "Parent" });
    const child = await store.upsertFolder({
      name: "Child",
      parentId: parent.id,
    });
    const deleted = await store.deleteFolder(parent.id);
    expect(deleted.sort()).toEqual([parent.id, child.id].sort());
  });

  test("no-op for unknown id", async () => {
    const deleted = await store.deleteFolder("nonexistent");
    expect(deleted).toEqual([]);
  });
});

describe("FolderStore — reorderFolders", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("updates sortOrder for batch of folders", async () => {
    const a = await store.upsertFolder({ name: "A" });
    const b = await store.upsertFolder({ name: "B" });
    await store.reorderFolders([
      { id: a.id, sortOrder: 2 },
      { id: b.id, sortOrder: 1 },
    ]);
    const folders = await store.listFolders();
    expect(folders.find((f) => f.id === a.id).sortOrder).toBe(2);
    expect(folders.find((f) => f.id === b.id).sortOrder).toBe(1);
  });
});

describe("FolderStore — folderExists", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("returns true for existing folder", async () => {
    const folder = await store.upsertFolder({ name: "Exists" });
    expect(await store.folderExists(folder.id)).toBe(true);
  });

  test("returns false for nonexistent folder", async () => {
    expect(await store.folderExists("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/folderStore.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FolderStore**

Create `src/main/folderStore.js`:

```javascript
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

class FolderStore {
  constructor(baseDir) {
    this.foldersPath = path.join(baseDir, "folders.json");
  }

  async init() {
    await this.#ensureFile(this.foldersPath, "[]");
  }

  async listFolders() {
    return this.#readJson(this.foldersPath);
  }

  async upsertFolder(input) {
    const folders = await this.listFolders();
    const now = new Date().toISOString();
    const name = String(input.name || "Untitled Folder").slice(0, 100);
    const parentId =
      typeof input.parentId === "string" ? input.parentId : null;

    // Depth check
    if (parentId) {
      const depth = this.#getDepth(folders, parentId);
      if (depth >= 3) {
        throw new Error(
          "Maximum folder nesting depth (3) exceeded",
        );
      }
    }

    const existing = input.id
      ? folders.find((f) => f.id === input.id)
      : null;

    if (existing) {
      existing.name = name;
      existing.parentId = parentId;
      if (input.sortOrder !== undefined) {
        existing.sortOrder = Number(input.sortOrder) || 0;
      }
      existing.updatedAt = now;
      await this.#writeJson(this.foldersPath, folders);
      return { ...existing };
    }

    const folder = {
      id: crypto.randomUUID(),
      name,
      parentId,
      sortOrder:
        typeof input.sortOrder === "number" ? input.sortOrder : 0,
      createdAt: now,
      updatedAt: now,
    };
    folders.push(folder);
    await this.#writeJson(this.foldersPath, folders);
    return { ...folder };
  }

  async deleteFolder(id) {
    const folders = await this.listFolders();
    const toDelete = this.#collectDescendants(folders, id);
    if (!toDelete.length) return [];
    const remaining = folders.filter((f) => !toDelete.includes(f.id));
    await this.#writeJson(this.foldersPath, remaining);
    return toDelete;
  }

  async reorderFolders(updates) {
    const folders = await this.listFolders();
    for (const { id, sortOrder } of updates) {
      const folder = folders.find((f) => f.id === id);
      if (folder) folder.sortOrder = sortOrder;
    }
    await this.#writeJson(this.foldersPath, folders);
  }

  async folderExists(id) {
    const folders = await this.listFolders();
    return folders.some((f) => f.id === id);
  }

  // --- Private helpers ---

  #getDepth(folders, parentId) {
    let depth = 1; // The parent itself is depth 1
    let current = parentId;
    while (current) {
      const parent = folders.find((f) => f.id === current);
      if (!parent || !parent.parentId) break;
      current = parent.parentId;
      depth++;
    }
    return depth;
  }

  #collectDescendants(folders, id) {
    const result = [];
    const exists = folders.some((f) => f.id === id);
    if (!exists) return result;
    result.push(id);
    const children = folders.filter((f) => f.parentId === id);
    for (const child of children) {
      result.push(...this.#collectDescendants(folders, child.id));
    }
    return result;
  }

  async #ensureFile(filePath, fallback) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, fallback, "utf-8");
    }
  }

  async #readJson(filePath) {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  }

  async #writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}

module.exports = { FolderStore };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/folderStore.test.js --verbose`
Expected: All 13 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/folderStore.js tests/unit/folderStore.test.js
git commit -m "feat(library): add FolderStore with CRUD, depth validation, cascade delete"
```

---

### Task 3: Add new build operations to BuildStore

**Files:**
- Modify: `src/main/buildStore.js`
- Test: `tests/unit/buildStore.test.js`

- [ ] **Step 1: Write tests for move, pin, reorder**

Add to `tests/unit/buildStore.test.js`:

```javascript
describe("BuildStore — move builds", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("moveBuilds updates folderId for given build ids", async () => {
    const b1 = await store.upsertBuild(makeBuild({ title: "B1" }));
    const b2 = await store.upsertBuild(makeBuild({ title: "B2" }));
    await store.moveBuilds([b1.id, b2.id], "folder-abc");
    const builds = await store.listBuilds();
    expect(builds.find((b) => b.id === b1.id).folderId).toBe("folder-abc");
    expect(builds.find((b) => b.id === b2.id).folderId).toBe("folder-abc");
  });

  test("moveBuilds with null moves to root", async () => {
    const b1 = await store.upsertBuild(
      makeBuild({ title: "B1", folderId: "folder-abc" }),
    );
    await store.moveBuilds([b1.id], null);
    const builds = await store.listBuilds();
    expect(builds.find((b) => b.id === b1.id).folderId).toBe(null);
  });

  test("clearFolderFromBuilds sets folderId to null for matching builds", async () => {
    const b1 = await store.upsertBuild(
      makeBuild({ title: "B1", folderId: "folder-abc" }),
    );
    const b2 = await store.upsertBuild(
      makeBuild({ title: "B2", folderId: "folder-xyz" }),
    );
    await store.clearFolderFromBuilds(["folder-abc"]);
    const builds = await store.listBuilds();
    expect(builds.find((b) => b.id === b1.id).folderId).toBe(null);
    expect(builds.find((b) => b.id === b2.id).folderId).toBe("folder-xyz");
  });
});

describe("BuildStore — pin builds", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("pinBuilds sets pinned to true", async () => {
    const b1 = await store.upsertBuild(makeBuild());
    await store.pinBuilds([b1.id], true);
    const builds = await store.listBuilds();
    expect(builds.find((b) => b.id === b1.id).pinned).toBe(true);
  });

  test("pinBuilds sets pinned to false (unpin)", async () => {
    const b1 = await store.upsertBuild(makeBuild({ pinned: true }));
    await store.pinBuilds([b1.id], false);
    const builds = await store.listBuilds();
    expect(builds.find((b) => b.id === b1.id).pinned).toBe(false);
  });
});

describe("BuildStore — reorder builds", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("reorderBuilds updates sortOrder for batch", async () => {
    const b1 = await store.upsertBuild(makeBuild({ title: "B1" }));
    const b2 = await store.upsertBuild(makeBuild({ title: "B2" }));
    await store.reorderBuilds([
      { id: b1.id, sortOrder: 2 },
      { id: b2.id, sortOrder: 1 },
    ]);
    const builds = await store.listBuilds();
    expect(builds.find((b) => b.id === b1.id).sortOrder).toBe(2);
    expect(builds.find((b) => b.id === b2.id).sortOrder).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/buildStore.test.js --verbose`
Expected: FAIL — moveBuilds, pinBuilds, reorderBuilds, clearFolderFromBuilds not defined

- [ ] **Step 3: Add new methods to BuildStore class**

In `src/main/buildStore.js`, add these methods to the `BuildStore` class after the `deleteBuild` method (around line 48):

```javascript
  async moveBuilds(ids, folderId) {
    const builds = await this.#readJson(this.buildsPath, []);
    for (const build of builds) {
      if (ids.includes(build.id)) {
        build.folderId = folderId;
      }
    }
    await this.#writeJson(this.buildsPath, builds);
  }

  async pinBuilds(ids, pinned) {
    const builds = await this.#readJson(this.buildsPath, []);
    for (const build of builds) {
      if (ids.includes(build.id)) {
        build.pinned = Boolean(pinned);
      }
    }
    await this.#writeJson(this.buildsPath, builds);
  }

  async reorderBuilds(updates) {
    const builds = await this.#readJson(this.buildsPath, []);
    for (const { id, sortOrder } of updates) {
      const build = builds.find((b) => b.id === id);
      if (build) build.sortOrder = sortOrder;
    }
    await this.#writeJson(this.buildsPath, builds);
  }

  async clearFolderFromBuilds(folderIds) {
    const builds = await this.#readJson(this.buildsPath, []);
    for (const build of builds) {
      if (folderIds.includes(build.folderId)) {
        build.folderId = null;
      }
    }
    await this.#writeJson(this.buildsPath, builds);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/buildStore.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/buildStore.js tests/unit/buildStore.test.js
git commit -m "feat(library): add moveBuilds, pinBuilds, reorderBuilds, clearFolderFromBuilds to BuildStore"
```

---

### Task 4: Add IPC handlers for folders and new build operations

**Files:**
- Modify: `src/main/index.js`

- [ ] **Step 1: Import and initialize FolderStore**

In `src/main/index.js`, find where `BuildStore` is imported and instantiated. Add FolderStore alongside it. The import is near the top of the file:

```javascript
const { FolderStore } = require("./folderStore");
```

Find where `store` (BuildStore) is constructed and `await store.init()` is called. Add the folder store right after:

```javascript
const folderStore = new FolderStore(dataDir);
await folderStore.init();
```

(`dataDir` is the same directory used for `BuildStore` — look for `app.getPath("userData")` or the variable used for the BuildStore constructor)

- [ ] **Step 2: Add folder IPC handlers**

Find the existing build IPC handlers (around line 262: `ipcMain.handle("builds:list", ...)`). Add folder handlers right after the build handlers:

```javascript
  // Folder CRUD
  ipcMain.handle("folders:list", () => folderStore.listFolders());
  ipcMain.handle("folders:save", (_e, folder) =>
    folderStore.upsertFolder(folder),
  );
  ipcMain.handle("folders:delete", async (_e, id) => {
    const deletedIds = await folderStore.deleteFolder(id);
    if (deletedIds.length) {
      await store.clearFolderFromBuilds(deletedIds);
    }
    return deletedIds;
  });
  ipcMain.handle("folders:reorder", (_e, updates) =>
    folderStore.reorderFolders(updates),
  );

  // Build library operations
  ipcMain.handle("builds:move", async (_e, ids, folderId) => {
    if (folderId !== null) {
      const exists = await folderStore.folderExists(folderId);
      if (!exists) throw new Error(`Folder not found: ${folderId}`);
    }
    await store.moveBuilds(ids, folderId);
  });
  ipcMain.handle("builds:pin", (_e, ids, pinned) =>
    store.pinBuilds(ids, pinned),
  );
  ipcMain.handle("builds:reorder", (_e, updates) =>
    store.reorderBuilds(updates),
  );
```

- [ ] **Step 3: Verify the app starts without errors**

Run: `npm run dev`
Expected: App starts, no IPC registration errors in console. Close the app.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js
git commit -m "feat(library): add IPC handlers for folders and build library operations"
```

---

### Task 5: Add desktopApi methods in preload

**Files:**
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add folder and library API methods**

In `src/preload/index.js`, find the `desktopApi` object passed to `contextBridge.exposeInMainWorld`. Add these methods alongside the existing build methods:

```javascript
    // Folder operations
    listFolders: () => ipcRenderer.invoke("folders:list"),
    saveFolder: (folder) => ipcRenderer.invoke("folders:save", folder),
    deleteFolder: (id) => ipcRenderer.invoke("folders:delete", id),
    reorderFolders: (updates) =>
      ipcRenderer.invoke("folders:reorder", updates),

    // Build library operations
    moveBuilds: (ids, folderId) =>
      ipcRenderer.invoke("builds:move", ids, folderId),
    pinBuilds: (ids, pinned) =>
      ipcRenderer.invoke("builds:pin", ids, pinned),
    reorderBuilds: (updates) =>
      ipcRenderer.invoke("builds:reorder", updates),
```

- [ ] **Step 2: Verify app starts and API is accessible**

Run: `npm run dev`
Open DevTools in the Electron window. In console, run:
```javascript
await window.desktopApi.listFolders()
```
Expected: Returns `[]` (empty array, no errors)

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.js
git commit -m "feat(library): expose folder and library API methods in preload"
```

---

## Chunk 2: HTML Skeleton, State, Heroicons, Toolbar & Sidebar

### Task 6: Update state module

**Files:**
- Modify: `src/renderer/modules/state.js`

- [ ] **Step 1: Add library state fields**

In `src/renderer/modules/state.js`, add these fields to the `state` object (after `buildSearch`):

```javascript
  // Library state
  folders: [],
  currentFolder: null,      // { type: "smart"|"custom", id: string } or null (root)
  libraryPrefs: {
    viewMode: "list",
    sortField: "updatedAt",
    sortDirection: "desc",
    sidebarOpen: true,
    sidebarExpandedFolders: [],
    activeFilters: {},
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/state.js
git commit -m "feat(library): add folders, currentFolder, libraryPrefs to state"
```

---

### Task 7: Create Heroicons module

**Files:**
- Create: `src/renderer/modules/library/heroicons.js`

- [ ] **Step 1: Create the heroicons SVG string module**

Create `src/renderer/modules/library/heroicons.js`. This exports raw SVG strings for each Heroicon used in the library, following the same pattern as `profession-icons.js`:

```javascript
// Heroicon SVG strings for the build library UI.
// All icons are Heroicons v2 20px solid variants.
// Each export is a raw SVG string that can be inserted via innerHTML.

export const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75Z"/><path d="M3.75 9A1.75 1.75 0 0 0 2 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-4.5A1.75 1.75 0 0 0 16.25 9H3.75Z"/></svg>`;

export const folderOpenIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M4.75 3A1.75 1.75 0 0 0 3 4.75v.763c.541-.14 1.107-.215 1.688-.215h10.624c.58 0 1.147.075 1.688.215V4.75A1.75 1.75 0 0 0 15.25 3H4.75Z"/><path fill-rule="evenodd" d="M1.398 8.098A3.25 3.25 0 0 1 4.688 5.5h10.624a3.25 3.25 0 0 1 3.29 2.598l.91 5.598a3.25 3.25 0 0 1-3.29 3.804H3.778a3.25 3.25 0 0 1-3.29-3.804l.91-5.598Z" clip-rule="evenodd"/></svg>`;

export const folderPlusIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M4.75 3A1.75 1.75 0 0 0 3 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H4.75Z"/><path d="M3.75 9A1.75 1.75 0 0 0 2 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-4.5A1.75 1.75 0 0 0 16.25 9H3.75Zm5.5 4.75a.75.75 0 0 1 .75-.75h1.25V11.75a.75.75 0 0 1 1.5 0V13h1.25a.75.75 0 0 1 0 1.5H12.75v1.25a.75.75 0 0 1-1.5 0V14.5H10a.75.75 0 0 1-.75-.75Z"/></svg>`;

export const folderArrowDownIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M2 4.75C2 3.784 2.784 3 3.75 3h4.836c.464 0 .909.184 1.237.513l1.414 1.414a.25.25 0 0 0 .177.073h4.836c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 16.25 17H3.75A1.75 1.75 0 0 1 2 15.25V4.75Zm10.25 7.19V8.75a.75.75 0 0 0-1.5 0v3.19l-.72-.72a.75.75 0 1 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l2-2a.75.75 0 1 0-1.06-1.06l-.72.72Z"/></svg>`;

export const chevronRightIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clip-rule="evenodd"/></svg>`;

export const chevronDownIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/></svg>`;

export const chevronUpDownIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a.75.75 0 0 1 .55.24l3.25 3.5a.75.75 0 1 1-1.1 1.02L10 4.852 7.3 7.76a.75.75 0 0 1-1.1-1.02l3.25-3.5A.75.75 0 0 1 10 3Zm-3.76 9.2a.75.75 0 0 1 1.06.04l2.7 2.908 2.7-2.908a.75.75 0 1 1 1.1 1.02l-3.25 3.5a.75.75 0 0 1-1.1 0l-3.25-3.5a.75.75 0 0 1 .04-1.06Z" clip-rule="evenodd"/></svg>`;

export const magnifyingGlassIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clip-rule="evenodd"/></svg>`;

export const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z"/></svg>`;

export const starIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clip-rule="evenodd"/></svg>`;

export const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z"/></svg>`;

export const pencilIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z"/><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z"/></svg>`;

export const documentDuplicateIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z"/><path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z"/></svg>`;

export const tagIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.5 3A2.5 2.5 0 0 0 3 5.5v2.879a2.5 2.5 0 0 0 .732 1.767l6.5 6.5a2.5 2.5 0 0 0 3.536 0l2.878-2.878a2.5 2.5 0 0 0 0-3.536l-6.5-6.5A2.5 2.5 0 0 0 8.38 3H5.5ZM6 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>`;

export const clipboardDocumentIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5V7A2.5 2.5 0 0 0 11 4.5H8.128a2.252 2.252 0 0 1 1.884-1.488A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-.25Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M2 7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7Zm2 3.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd"/></svg>`;

export const globeAltIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M16.555 5.412a8.028 8.028 0 0 0-3.503-2.81 14.899 14.899 0 0 1 1.663 4.472 8.547 8.547 0 0 0 1.84-1.662ZM13.326 7.825a13.43 13.43 0 0 0-2.413-5.773 8.087 8.087 0 0 0-1.826 0 13.43 13.43 0 0 0-2.413 5.773A8.473 8.473 0 0 0 10 8.5c1.18 0 2.304-.24 3.326-.675ZM14.006 9.095a7.005 7.005 0 0 1-3.16 1.19 13.353 13.353 0 0 1-1.096 7.97 8.015 8.015 0 0 0 4.256-9.16Zm-6.853 1.19a7.005 7.005 0 0 1-3.16-1.19 8.015 8.015 0 0 0 4.256 9.16 13.353 13.353 0 0 1-1.096-7.97ZM3.445 5.412a8.547 8.547 0 0 0 1.84 1.662 14.898 14.898 0 0 1 1.663-4.472 8.028 8.028 0 0 0-3.503 2.81Z"/></svg>`;

export const informationCircleIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clip-rule="evenodd"/></svg>`;

export const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd"/></svg>`;

export const homeIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clip-rule="evenodd"/></svg>`;

export const documentPlusIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm4.75 6.75a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5H10v1.5a.75.75 0 0 1-1.5 0v-1.5H7a.75.75 0 0 1 0-1.5h1.5v-1.5a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd"/></svg>`;

export const arrowUpTrayIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z"/><path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"/></svg>`;

export const clipboardIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M13.887 3.182c.396.037.79.08 1.183.128C16.194 3.45 17 4.414 17 5.517V16.75A2.25 2.25 0 0 1 14.75 19h-9.5A2.25 2.25 0 0 1 3 16.75V5.517c0-1.103.806-2.068 1.93-2.207.393-.048.787-.09 1.183-.128A3.001 3.001 0 0 1 9 1h2c1.373 0 2.531.923 2.887 2.182ZM7.5 4A1.5 1.5 0 0 1 9 2.5h2A1.5 1.5 0 0 1 12.5 4v.5h-5V4Z" clip-rule="evenodd"/></svg>`;

// View mode icons
export const squaresIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3A1.5 1.5 0 0 1 8 3.5v3A1.5 1.5 0 0 1 6.5 8h-3A1.5 1.5 0 0 1 2 6.5v-3Zm6 0A1.5 1.5 0 0 1 9.5 2h3A1.5 1.5 0 0 1 14 3.5v3A1.5 1.5 0 0 1 12.5 8h-3A1.5 1.5 0 0 1 8 6.5v-3Zm-6 6A1.5 1.5 0 0 1 3.5 8h3A1.5 1.5 0 0 1 8 9.5v3A1.5 1.5 0 0 1 6.5 14h-3A1.5 1.5 0 0 1 2 12.5v-3Zm6 0A1.5 1.5 0 0 1 9.5 8h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 8 12.5v-3Z" clip-rule="evenodd"/></svg>`;

export const bars3Icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5A.75.75 0 0 1 2.75 9h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 9.75Zm0 5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd"/></svg>`;

export const tableIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M.99 5.24A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5.75v2.5h3v-2.5h-3Zm0 4v2.5h3v-2.5h-3Zm0 4v.76c0 .414.336.75.75.75H5.5v-1.5h-3Zm4.5 0v1.5h4v-1.5h-4Zm5.5 0v1.5h3.25a.75.75 0 0 0 .75-.75v-.75h-4Zm4-1.5v-2.5h-4v2.5h4Zm0-4v-2.5h-4v2.5h4Zm-5.5-2.5v2.5h-4v-2.5h4Z" clip-rule="evenodd"/></svg>`;

export const squaresMiniIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.5 2A1.5 1.5 0 0 0 2 3.5v3A1.5 1.5 0 0 0 3.5 8h3A1.5 1.5 0 0 0 8 6.5v-3A1.5 1.5 0 0 0 6.5 2h-3Zm10 0A1.5 1.5 0 0 0 12 3.5v3A1.5 1.5 0 0 0 13.5 8h3A1.5 1.5 0 0 0 18 6.5v-3A1.5 1.5 0 0 0 16.5 2h-3ZM2 13.5A1.5 1.5 0 0 1 3.5 12h3A1.5 1.5 0 0 1 8 13.5v3A1.5 1.5 0 0 1 6.5 18h-3A1.5 1.5 0 0 1 2 16.5v-3Zm10 0a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3Z" clip-rule="evenodd"/></svg>`;

// Sidebar collapse
export const chevronDoubleLeftIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M15.79 14.77a.75.75 0 0 1-1.06.02l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.04 1.08L11.832 10l3.938 3.71a.75.75 0 0 1 .02 1.06Zm-6 0a.75.75 0 0 1-1.06.02l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.04 1.08L5.832 10l3.938 3.71a.75.75 0 0 1 .02 1.06Z" clip-rule="evenodd"/></svg>`;

export const chevronDoubleRightIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.21 14.77a.75.75 0 0 1 .02-1.06L14.168 10 10.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Zm-6 0a.75.75 0 0 1 .02-1.06L8.168 10 4.23 6.29a.75.75 0 0 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clip-rule="evenodd"/></svg>`;
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/library/heroicons.js
git commit -m "feat(library): add heroicons SVG module for library UI"
```

---

### Task 8: Replace HTML library page markup

**Files:**
- Modify: `src/renderer/index.html:364-376`

- [ ] **Step 1: Replace the library page section**

In `src/renderer/index.html`, find the library page block (lines 364-376, the `<div id="page-library">` section). Replace the entire block with:

```html
    <!-- Build Library page -->
    <div id="page-library" class="page hidden">
      <div class="lib-page">
        <div id="lib-sidebar" class="lib-sidebar"></div>
        <div id="lib-main" class="lib-main">
          <div id="lib-toolbar" class="lib-toolbar"></div>
          <div id="lib-filters" class="lib-filters"></div>
          <div id="lib-content" class="lib-content"></div>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Verify the app starts without errors**

Run: `npm run dev`
Expected: App starts. Library page shows empty containers (no errors in console). The editor page still works normally.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat(library): replace library page markup with new DOM skeleton"
```

---

### Task 9: Create client-side folder store

**Files:**
- Create: `src/renderer/modules/library/folder-store.js`

- [ ] **Step 1: Create the folder-store module**

```javascript
import { state } from "../state.js";

/** Load all folders from main process into state.folders. */
export async function loadFolders() {
  state.folders = await window.desktopApi.listFolders();
}

/** Create or update a folder. Returns the saved folder. */
export async function saveFolder(folder) {
  const saved = await window.desktopApi.saveFolder(folder);
  await loadFolders();
  return saved;
}

/** Delete a folder by ID. Builds in it move to root. */
export async function deleteFolder(id) {
  await window.desktopApi.deleteFolder(id);
  await loadFolders();
  // Reload builds too since their folderId may have changed
  state.builds = await window.desktopApi.listBuilds();
}

/** Reorder folders. updates: Array<{id, sortOrder}> */
export async function reorderFolders(updates) {
  await window.desktopApi.reorderFolders(updates);
  await loadFolders();
}

/** Move builds to a folder. ids: string[], folderId: string|null */
export async function moveBuilds(ids, folderId) {
  await window.desktopApi.moveBuilds(ids, folderId);
  state.builds = await window.desktopApi.listBuilds();
}

/** Pin or unpin builds. ids: string[], pinned: boolean */
export async function pinBuilds(ids, pinned) {
  await window.desktopApi.pinBuilds(ids, pinned);
  state.builds = await window.desktopApi.listBuilds();
}

/** Reorder builds. updates: Array<{id, sortOrder}> */
export async function reorderBuilds(updates) {
  await window.desktopApi.reorderBuilds(updates);
  state.builds = await window.desktopApi.listBuilds();
}

/**
 * Get builds for the current folder/filter context.
 * Applies smart folder filtering, custom folder filtering, search, and sort.
 */
export function getVisibleBuilds() {
  let builds = [...state.builds];

  // Filter by current folder
  const folder = state.currentFolder;
  if (folder) {
    if (folder.type === "custom") {
      builds = builds.filter((b) => b.folderId === folder.id);
    } else if (folder.type === "smart-profession") {
      builds = builds.filter((b) => b.profession === folder.id);
    } else if (folder.type === "smart-gamemode") {
      builds = builds.filter(
        (b) => (b.gameMode || "pve") === folder.id,
      );
    }
    // "all" type = no filtering
  }

  // Apply filter chips
  const filters = state.libraryPrefs.activeFilters;
  if (filters.profession) {
    builds = builds.filter((b) => b.profession === filters.profession);
  }
  if (filters.gameMode) {
    builds = builds.filter(
      (b) => (b.gameMode || "pve") === filters.gameMode,
    );
  }
  if (filters.eliteSpec) {
    builds = builds.filter((b) =>
      (b.specializations || []).some(
        (s) => s.elite && s.name === filters.eliteSpec,
      ),
    );
  }
  if (filters.tag) {
    builds = builds.filter((b) =>
      (b.tags || []).includes(filters.tag),
    );
  }

  // Apply search
  const query = (state.buildSearch || "").trim().toLowerCase();
  if (query) {
    builds = builds.filter((b) => {
      const haystack = [
        b.title || "",
        b.profession || "",
        b.notes || "",
        ...(b.tags || []),
        ...((b.specializations || []).map((s) => s.name || "")),
        b.gameMode || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  // Sort — pinned items always first
  const { sortField, sortDirection } = state.libraryPrefs;
  const dir = sortDirection === "asc" ? 1 : -1;

  builds.sort((a, b) => {
    // Pinned first
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;

    let av = a[sortField] ?? "";
    let bv = b[sortField] ?? "";
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  return builds;
}

/**
 * Get sub-folders for the current navigation context.
 */
export function getVisibleFolders() {
  const folder = state.currentFolder;
  // At root or "all builds" smart folder: show top-level custom folders
  if (!folder || folder.type === "all") {
    return state.folders
      .filter((f) => f.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  // Inside a custom folder: show its children
  if (folder.type === "custom") {
    return state.folders
      .filter((f) => f.parentId === folder.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  // Smart folders don't contain sub-folders
  return [];
}

/**
 * Count builds in a folder (including sub-folders recursively).
 */
export function countBuildsInFolder(folderId) {
  const allFolderIds = collectFolderIds(folderId);
  return state.builds.filter((b) => allFolderIds.includes(b.folderId)).length;
}

function collectFolderIds(folderId) {
  const ids = [folderId];
  const children = state.folders.filter((f) => f.parentId === folderId);
  for (const child of children) {
    ids.push(...collectFolderIds(child.id));
  }
  return ids;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/library/folder-store.js
git commit -m "feat(library): add client-side folder store with filtering and sorting"
```

---

## Chunk 3: Toolbar, Sidebar & Content Views

### Task 10: Create toolbar module

**Files:**
- Create: `src/renderer/modules/library/toolbar.js`

- [ ] **Step 1: Create the toolbar module**

The toolbar renders into `#lib-toolbar` and `#lib-filters`. It manages:
- Breadcrumb (clickable path showing current folder)
- Search input
- Sort dropdown (Last Modified, Created, A-Z, Profession, Elite Spec)
- View mode toggle (4 buttons: list, table, grid, icon)
- "New Build" button
- Filter chips row (profession, game mode, tags — toggleable)

```javascript
import { state } from "../state.js";
import {
  magnifyingGlassIcon,
  plusIcon,
  bars3Icon,
  tableIcon,
  squaresIcon,
  squaresMiniIcon,
  chevronUpDownIcon,
} from "./heroicons.js";

let _callbacks = {};

export function initToolbar(callbacks) {
  _callbacks = callbacks;
  renderToolbar();
  renderFilters();
}

export function renderToolbar() {
  const el = document.getElementById("lib-toolbar");
  if (!el) return;

  const prefs = state.libraryPrefs;
  const folder = state.currentFolder;

  // Build breadcrumb
  let breadcrumbHtml = `<span class="lib-breadcrumb__item lib-breadcrumb__item--link" data-nav="root">All Builds</span>`;
  if (folder?.type === "custom") {
    const chain = getFolderChain(folder.id);
    for (const f of chain) {
      breadcrumbHtml += ` <span class="lib-breadcrumb__sep">&rsaquo;</span> `;
      breadcrumbHtml += `<span class="lib-breadcrumb__item lib-breadcrumb__item--link" data-nav="custom:${f.id}">${escapeHtml(f.name)}</span>`;
    }
  } else if (folder?.type === "smart-profession") {
    breadcrumbHtml += ` <span class="lib-breadcrumb__sep">&rsaquo;</span> <span class="lib-breadcrumb__item">${escapeHtml(folder.id)}</span>`;
  } else if (folder?.type === "smart-gamemode") {
    breadcrumbHtml += ` <span class="lib-breadcrumb__sep">&rsaquo;</span> <span class="lib-breadcrumb__item">${escapeHtml(folder.id.toUpperCase())}</span>`;
  }

  const viewModes = [
    { id: "list", icon: bars3Icon, title: "List" },
    { id: "table", icon: tableIcon, title: "Table" },
    { id: "grid", icon: squaresIcon, title: "Grid" },
    { id: "icon", icon: squaresMiniIcon, title: "Icons" },
  ];

  const viewToggleHtml = viewModes
    .map(
      (v) =>
        `<button class="lib-view-btn${prefs.viewMode === v.id ? " lib-view-btn--active" : ""}" data-view="${v.id}" title="${v.title}">${v.icon}</button>`,
    )
    .join("");

  el.innerHTML = `
    <div class="lib-breadcrumb">${breadcrumbHtml}</div>
    <div class="lib-search-wrap">
      <span class="lib-search-icon">${magnifyingGlassIcon}</span>
      <input id="lib-search-input" class="lib-search" type="search" placeholder="Search..." value="${escapeHtml(state.buildSearch || "")}">
    </div>
    <select id="lib-sort-select" class="lib-sort">
      <option value="updatedAt"${prefs.sortField === "updatedAt" ? " selected" : ""}>Last Modified</option>
      <option value="createdAt"${prefs.sortField === "createdAt" ? " selected" : ""}>Created</option>
      <option value="title"${prefs.sortField === "title" ? " selected" : ""}>A-Z</option>
      <option value="profession"${prefs.sortField === "profession" ? " selected" : ""}>Profession</option>
    </select>
    <div class="lib-view-toggle">${viewToggleHtml}</div>
    <button id="lib-new-btn" class="lib-new-btn">${plusIcon} New</button>
  `;

  // Wire events
  el.querySelector("#lib-search-input").addEventListener("input", (e) => {
    state.buildSearch = e.target.value.trim().toLowerCase();
    _callbacks.onFilterChange?.();
  });

  el.querySelector("#lib-sort-select").addEventListener("change", (e) => {
    state.libraryPrefs.sortField = e.target.value;
    _callbacks.onSortChange?.();
  });

  el.querySelectorAll(".lib-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.libraryPrefs.viewMode = btn.dataset.view;
      _callbacks.onViewChange?.();
    });
  });

  el.querySelector("#lib-new-btn").addEventListener("click", () => {
    _callbacks.onNewBuild?.();
  });

  el.querySelector(".lib-breadcrumb").addEventListener("click", (e) => {
    const item = e.target.closest("[data-nav]");
    if (!item) return;
    const nav = item.dataset.nav;
    if (nav === "root") {
      state.currentFolder = null;
    } else if (nav.startsWith("custom:")) {
      state.currentFolder = { type: "custom", id: nav.slice(7) };
    }
    _callbacks.onNavigate?.();
  });
}

export function renderFilters() {
  const el = document.getElementById("lib-filters");
  if (!el) return;

  const filters = state.libraryPrefs.activeFilters;

  // Collect unique values from builds
  const professions = [...new Set(state.builds.map((b) => b.profession).filter(Boolean))].sort();
  const gameModes = [...new Set(state.builds.map((b) => b.gameMode || "pve"))].sort();
  const allTags = [...new Set(state.builds.flatMap((b) => b.tags || []))].sort();

  let html = "";
  for (const prof of professions) {
    const active = filters.profession === prof;
    html += `<button class="lib-chip${active ? " lib-chip--active" : ""}" data-filter="profession" data-value="${escapeHtml(prof)}">${escapeHtml(prof)}</button>`;
  }
  for (const mode of gameModes) {
    const active = filters.gameMode === mode;
    html += `<button class="lib-chip${active ? " lib-chip--active" : ""}" data-filter="gameMode" data-value="${escapeHtml(mode)}">${escapeHtml(mode.toUpperCase())}</button>`;
  }
  for (const tag of allTags.slice(0, 10)) {
    const active = filters.tag === tag;
    html += `<button class="lib-chip${active ? " lib-chip--active" : ""}" data-filter="tag" data-value="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
  }

  el.innerHTML = html;

  el.addEventListener("click", (e) => {
    const chip = e.target.closest(".lib-chip");
    if (!chip) return;
    const key = chip.dataset.filter;
    const val = chip.dataset.value;
    // Toggle: if already active, clear; otherwise set
    if (state.libraryPrefs.activeFilters[key] === val) {
      delete state.libraryPrefs.activeFilters[key];
    } else {
      state.libraryPrefs.activeFilters[key] = val;
    }
    _callbacks.onFilterChange?.();
  });
}

function getFolderChain(folderId) {
  const chain = [];
  let current = folderId;
  while (current) {
    const folder = state.folders.find((f) => f.id === current);
    if (!folder) break;
    chain.unshift(folder);
    current = folder.parentId;
  }
  return chain;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/library/toolbar.js
git commit -m "feat(library): add toolbar module with search, sort, view toggle, filter chips"
```

---

### Task 11: Create sidebar module

**Files:**
- Create: `src/renderer/modules/library/sidebar.js`

- [ ] **Step 1: Create the sidebar module**

The sidebar renders into `#lib-sidebar`. It shows smart folders (All Builds, By Profession, By Game Mode) and custom folders with expand/collapse.

```javascript
import { state } from "../state.js";
import { countBuildsInFolder } from "./folder-store.js";
import {
  folderIcon,
  folderOpenIcon,
  folderPlusIcon,
  chevronRightIcon,
  chevronDownIcon,
  chevronDoubleLeftIcon,
  chevronDoubleRightIcon,
} from "./heroicons.js";

let _callbacks = {};

export function initSidebar(callbacks) {
  _callbacks = callbacks;
}

export function renderSidebar() {
  const el = document.getElementById("lib-sidebar");
  if (!el) return;

  const prefs = state.libraryPrefs;

  if (!prefs.sidebarOpen) {
    el.innerHTML = `<button class="lib-sidebar-expand" title="Show sidebar">${chevronDoubleRightIcon}</button>`;
    el.classList.add("lib-sidebar--collapsed");
    el.querySelector(".lib-sidebar-expand").addEventListener("click", () => {
      prefs.sidebarOpen = true;
      _callbacks.onPrefsChange?.();
      renderSidebar();
    });
    return;
  }

  el.classList.remove("lib-sidebar--collapsed");
  const current = state.currentFolder;
  const expanded = prefs.sidebarExpandedFolders;

  // Smart folders
  const totalBuilds = state.builds.length;
  const professions = [...new Set(state.builds.map((b) => b.profession).filter(Boolean))].sort();
  const gameModes = [...new Set(state.builds.map((b) => b.gameMode || "pve"))].sort();
  const byProfExpanded = expanded.includes("smart-professions");
  const byModeExpanded = expanded.includes("smart-gamemodes");

  let smartHtml = `
    <div class="lib-nav-item${!current ? " lib-nav-item--active" : ""}" data-nav="root">
      ${folderIcon} All Builds <span class="lib-nav-count">${totalBuilds}</span>
    </div>
    <div class="lib-nav-item lib-nav-item--group" data-toggle="smart-professions">
      <span class="lib-nav-chevron">${byProfExpanded ? chevronDownIcon : chevronRightIcon}</span>
      ${folderIcon} By Profession
    </div>
  `;
  if (byProfExpanded) {
    for (const prof of professions) {
      const count = state.builds.filter((b) => b.profession === prof).length;
      const active = current?.type === "smart-profession" && current?.id === prof;
      smartHtml += `<div class="lib-nav-item lib-nav-item--nested${active ? " lib-nav-item--active" : ""}" data-nav="smart-profession:${escapeHtml(prof)}">
        ${folderIcon} ${escapeHtml(prof)} <span class="lib-nav-count">${count}</span>
      </div>`;
    }
  }

  smartHtml += `
    <div class="lib-nav-item lib-nav-item--group" data-toggle="smart-gamemodes">
      <span class="lib-nav-chevron">${byModeExpanded ? chevronDownIcon : chevronRightIcon}</span>
      ${folderIcon} By Game Mode
    </div>
  `;
  if (byModeExpanded) {
    for (const mode of gameModes) {
      const count = state.builds.filter((b) => (b.gameMode || "pve") === mode).length;
      const active = current?.type === "smart-gamemode" && current?.id === mode;
      smartHtml += `<div class="lib-nav-item lib-nav-item--nested${active ? " lib-nav-item--active" : ""}" data-nav="smart-gamemode:${escapeHtml(mode)}">
        ${folderIcon} ${escapeHtml(mode.toUpperCase())} <span class="lib-nav-count">${count}</span>
      </div>`;
    }
  }

  // Custom folders
  const topFolders = state.folders
    .filter((f) => f.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  let customHtml = "";
  for (const folder of topFolders) {
    customHtml += renderFolderItem(folder, current, expanded, 0);
  }

  el.innerHTML = `
    <div class="lib-sidebar-header">
      <button class="lib-sidebar-collapse" title="Hide sidebar">${chevronDoubleLeftIcon}</button>
    </div>
    <div class="lib-sidebar-section">
      <div class="lib-sidebar-label">Smart Folders</div>
      ${smartHtml}
    </div>
    <div class="lib-sidebar-section">
      <div class="lib-sidebar-label">My Folders <button class="lib-sidebar-add" title="New Folder">${plusIcon}</button></div>
      ${customHtml || '<div class="lib-nav-empty">No folders yet</div>'}
    </div>
  `;

  // Wire events
  el.querySelector(".lib-sidebar-collapse")?.addEventListener("click", () => {
    prefs.sidebarOpen = false;
    _callbacks.onPrefsChange?.();
    renderSidebar();
  });

  el.querySelector(".lib-sidebar-add")?.addEventListener("click", () => {
    _callbacks.onNewFolder?.();
  });

  el.querySelectorAll("[data-nav]").forEach((item) => {
    item.addEventListener("click", () => {
      const nav = item.dataset.nav;
      if (nav === "root") {
        state.currentFolder = null;
      } else if (nav.startsWith("smart-profession:")) {
        state.currentFolder = { type: "smart-profession", id: nav.slice(17) };
      } else if (nav.startsWith("smart-gamemode:")) {
        state.currentFolder = { type: "smart-gamemode", id: nav.slice(15) };
      } else if (nav.startsWith("custom:")) {
        state.currentFolder = { type: "custom", id: nav.slice(7) };
      }
      _callbacks.onNavigate?.();
    });
  });

  el.querySelectorAll("[data-toggle]").forEach((item) => {
    item.addEventListener("click", () => {
      const key = item.dataset.toggle;
      const idx = expanded.indexOf(key);
      if (idx >= 0) expanded.splice(idx, 1);
      else expanded.push(key);
      _callbacks.onPrefsChange?.();
      renderSidebar();
    });
  });
}

function renderFolderItem(folder, current, expanded, depth) {
  const children = state.folders
    .filter((f) => f.parentId === folder.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const hasChildren = children.length > 0;
  const isExpanded = expanded.includes(folder.id);
  const isActive = current?.type === "custom" && current?.id === folder.id;
  const count = countBuildsInFolder(folder.id);
  const indent = depth > 0 ? " lib-nav-item--nested" : "";

  let html = `<div class="lib-nav-item${indent}${isActive ? " lib-nav-item--active" : ""}" data-nav="custom:${folder.id}" data-folder-id="${folder.id}">`;

  if (hasChildren) {
    html += `<span class="lib-nav-chevron" data-toggle="${folder.id}">${isExpanded ? chevronDownIcon : chevronRightIcon}</span>`;
    html += isExpanded ? folderOpenIcon : folderIcon;
  } else {
    html += folderIcon;
  }
  html += ` ${escapeHtml(folder.name)} <span class="lib-nav-count">${count}</span></div>`;

  if (hasChildren && isExpanded) {
    for (const child of children) {
      html += renderFolderItem(child, current, expanded, depth + 1);
    }
  }
  return html;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/library/sidebar.js
git commit -m "feat(library): add sidebar module with smart folders, custom folders, expand/collapse"
```

---

### Task 12: Create content view module

**Files:**
- Create: `src/renderer/modules/library/content.js`

- [ ] **Step 1: Create the content module**

This renders into `#lib-content`. It delegates to the appropriate view renderer based on `state.libraryPrefs.viewMode`. Each view function returns an HTML string.

```javascript
import { state } from "../state.js";
import { getVisibleBuilds, getVisibleFolders } from "./folder-store.js";
import { getProfessionSvg } from "../profession-icons.js";
import {
  folderIcon,
  starIcon,
  chevronUpDownIcon,
} from "./heroicons.js";
import { escapeHtml, formatShortDate } from "../utils.js";

let _callbacks = {};

export function initContent(callbacks) {
  _callbacks = callbacks;
}

export function renderContent() {
  const el = document.getElementById("lib-content");
  if (!el) return;

  const builds = getVisibleBuilds();
  const folders = getVisibleFolders();
  const viewMode = state.libraryPrefs.viewMode;

  if (!builds.length && !folders.length) {
    el.innerHTML = `<div class="lib-empty">No builds found.</div>`;
    return;
  }

  switch (viewMode) {
    case "list":
      el.innerHTML = renderListView(builds, folders);
      break;
    case "table":
      el.innerHTML = renderTableView(builds, folders);
      break;
    case "grid":
      el.innerHTML = renderGridView(builds, folders);
      break;
    case "icon":
      el.innerHTML = renderIconView(builds, folders);
      break;
    default:
      el.innerHTML = renderListView(builds, folders);
  }

  wireContentEvents(el);
}

// ---------- List View ----------

function renderListView(builds, folders) {
  let html = "";

  // Folders first
  for (const folder of folders) {
    html += `<div class="lib-lv-folder" data-folder-id="${folder.id}">
      <span class="lib-lv-folder-icon">${folderIcon}</span>
      <span class="lib-lv-folder-name">${escapeHtml(folder.name)}</span>
      <span class="lib-lv-folder-count">(${countDirectBuilds(folder.id)})</span>
    </div>`;
  }

  // Builds
  for (const build of builds) {
    const active = build.id === state.editor.id;
    const specIcon = getSpecIcon(build);
    const eliteSpec = (build.specializations || []).find((s) => s.elite);

    html += `<div class="lib-lv-row${active ? " lib-lv-row--active" : ""}" data-build-id="${build.id}">
      <div class="lib-lv-icon ${profClass(build.profession)}">${specIcon}</div>
      <span class="lib-lv-title">${escapeHtml(build.title || "Untitled Build")}</span>
      ${build.pinned ? `<span class="lib-lv-pin">${starIcon}</span>` : ""}
      <div class="lib-lv-pills">
        <span class="lib-pill lib-pill--prof">${escapeHtml(build.profession || "Unknown")}</span>
        <span class="lib-pill lib-pill--mode">${escapeHtml((build.gameMode || "pve").toUpperCase())}</span>
        ${eliteSpec ? `<span class="lib-pill lib-pill--spec">${escapeHtml(eliteSpec.name)}</span>` : ""}
      </div>
      <span class="lib-lv-date">${escapeHtml(formatShortDate(build.updatedAt))}</span>
    </div>`;
  }

  return html;
}

// ---------- Table View ----------

function renderTableView(builds, folders) {
  const prefs = state.libraryPrefs;
  const sortArrow = chevronUpDownIcon;

  let html = `<table class="lib-tv-table">
    <thead><tr>
      <th class="lib-tv-th--pin"></th>
      <th class="lib-tv-th--icon"></th>
      <th class="lib-tv-th--sortable${prefs.sortField === "title" ? " lib-tv-th--sorted" : ""}" data-sort="title">Name ${sortArrow}</th>
      <th class="lib-tv-th--sortable${prefs.sortField === "profession" ? " lib-tv-th--sorted" : ""}" data-sort="profession">Profession ${sortArrow}</th>
      <th>Elite Spec</th>
      <th>Mode</th>
      <th>Tags</th>
      <th class="lib-tv-th--sortable${prefs.sortField === "createdAt" ? " lib-tv-th--sorted" : ""}" data-sort="createdAt">Created ${sortArrow}</th>
      <th class="lib-tv-th--sortable${prefs.sortField === "updatedAt" ? " lib-tv-th--sorted" : ""}" data-sort="updatedAt">Modified ${sortArrow}</th>
    </tr></thead>
    <tbody>`;

  // Folder rows
  for (const folder of folders) {
    html += `<tr class="lib-tv-folder" data-folder-id="${folder.id}">
      <td></td>
      <td><span class="lib-tv-folder-icon">${folderIcon}</span></td>
      <td class="lib-tv-title">${escapeHtml(folder.name)}</td>
      <td colspan="6"></td>
    </tr>`;
  }

  // Build rows
  for (const build of builds) {
    const active = build.id === state.editor.id;
    const specIcon = getSpecIcon(build);
    const eliteSpec = (build.specializations || []).find((s) => s.elite);
    const tagsHtml = (build.tags || [])
      .map((t) => `<span class="lib-tv-tag">${escapeHtml(t)}</span>`)
      .join("");

    html += `<tr class="${active ? "lib-tv-row--active" : ""}" data-build-id="${build.id}">
      <td>${build.pinned ? `<span class="lib-tv-pin">${starIcon}</span>` : ""}</td>
      <td><span class="lib-tv-icon ${profClass(build.profession)}">${specIcon}</span></td>
      <td class="lib-tv-title">${escapeHtml(build.title || "Untitled Build")}</td>
      <td>${escapeHtml(build.profession || "")}</td>
      <td>${escapeHtml(eliteSpec?.name || "")}</td>
      <td>${escapeHtml((build.gameMode || "pve").toUpperCase())}</td>
      <td>${tagsHtml}</td>
      <td>${escapeHtml(formatShortDate(build.createdAt))}</td>
      <td>${escapeHtml(formatShortDate(build.updatedAt))}</td>
    </tr>`;
  }

  html += `</tbody></table>`;
  return html;
}

// ---------- Grid View ----------

function renderGridView(builds, folders) {
  let html = `<div class="lib-gv-grid">`;

  for (const folder of folders) {
    html += `<div class="lib-gv-folder" data-folder-id="${folder.id}">
      <span class="lib-gv-folder-icon">${folderIcon}</span>
      <span class="lib-gv-folder-name">${escapeHtml(folder.name)}</span>
      <span class="lib-gv-folder-count">${countDirectBuilds(folder.id)}</span>
    </div>`;
  }

  for (const build of builds) {
    const active = build.id === state.editor.id;
    const specIcon = getSpecIcon(build);
    const eliteSpec = (build.specializations || []).find((s) => s.elite);

    html += `<div class="lib-gv-card${active ? " lib-gv-card--active" : ""}" data-build-id="${build.id}">
      ${build.pinned ? `<span class="lib-gv-pin">${starIcon}</span>` : ""}
      <div class="lib-gv-head">
        <span class="lib-gv-icon ${profClass(build.profession)}">${specIcon}</span>
        <div>
          <div class="lib-gv-title">${escapeHtml(build.title || "Untitled Build")}</div>
          <div class="lib-gv-date">${escapeHtml(formatShortDate(build.updatedAt))}</div>
        </div>
      </div>
      <div class="lib-gv-pills">
        <span class="lib-pill lib-pill--prof">${escapeHtml(build.profession || "Unknown")}</span>
        <span class="lib-pill lib-pill--mode">${escapeHtml((build.gameMode || "pve").toUpperCase())}</span>
        ${eliteSpec ? `<span class="lib-pill lib-pill--spec">${escapeHtml(eliteSpec.name)}</span>` : ""}
      </div>
    </div>`;
  }

  html += `</div>`;
  return html;
}

// ---------- Icon View ----------

function renderIconView(builds, folders) {
  let html = `<div class="lib-iv-grid">`;

  for (const folder of folders) {
    html += `<div class="lib-iv-folder" data-folder-id="${folder.id}">
      <span class="lib-iv-folder-icon">${folderIcon}</span>
      <span class="lib-iv-label">${escapeHtml(folder.name)}</span>
    </div>`;
  }

  for (const build of builds) {
    const active = build.id === state.editor.id;
    const specIcon = getSpecIcon(build);

    html += `<div class="lib-iv-item${active ? " lib-iv-item--active" : ""}" data-build-id="${build.id}">
      <span class="lib-iv-icon ${profClass(build.profession)}">${specIcon}</span>
      <span class="lib-iv-label">${escapeHtml(build.title || "Untitled Build")}</span>
    </div>`;
  }

  html += `</div>`;
  return html;
}

// ---------- Shared Helpers ----------

function getSpecIcon(build) {
  const eliteSpec = (build.specializations || []).find((s) => s.elite);
  const iconName = eliteSpec?.name || build.profession;
  return getProfessionSvg(iconName) || getProfessionSvg(build.profession) || "";
}

function profClass(profession) {
  return `lib-prof--${(profession || "unknown").toLowerCase()}`;
}

function countDirectBuilds(folderId) {
  return state.builds.filter((b) => b.folderId === folderId).length;
}

function wireContentEvents(el) {
  // Double-click on build = load in editor
  el.querySelectorAll("[data-build-id]").forEach((row) => {
    row.addEventListener("dblclick", () => {
      _callbacks.onLoadBuild?.(row.dataset.buildId);
    });
  });

  // Double-click on folder = navigate into it
  el.querySelectorAll("[data-folder-id]").forEach((row) => {
    row.addEventListener("dblclick", () => {
      state.currentFolder = { type: "custom", id: row.dataset.folderId };
      _callbacks.onNavigate?.();
    });
  });

  // Table sort headers
  el.querySelectorAll("[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      if (state.libraryPrefs.sortField === field) {
        state.libraryPrefs.sortDirection =
          state.libraryPrefs.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.libraryPrefs.sortField = field;
        state.libraryPrefs.sortDirection = "asc";
      }
      _callbacks.onSortChange?.();
    });
  });

  // Single click on build = select (handled by selection module, wired in library.js)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/library/content.js
git commit -m "feat(library): add content module with list, table, grid, icon views"
```

---

## Chunk 4: Selection, Context Menus & Keyboard Shortcuts

### Task 13: Create selection module

**Files:**
- Create: `src/renderer/modules/library/selection.js`

- [ ] **Step 1: Create the selection module**

Manages multi-select state with Ctrl+click and Shift+click. Tracks selected build IDs and provides selection API.

```javascript
import { state } from "../state.js";
import { getVisibleBuilds } from "./folder-store.js";

const selection = {
  ids: new Set(),
  lastClickedId: null,
};

export function getSelection() {
  return [...selection.ids];
}

export function clearSelection() {
  selection.ids.clear();
  selection.lastClickedId = null;
  updateSelectionVisuals();
}

export function selectAll() {
  const builds = getVisibleBuilds();
  selection.ids = new Set(builds.map((b) => b.id));
  updateSelectionVisuals();
}

export function isSelected(buildId) {
  return selection.ids.has(buildId);
}

/**
 * Handle a click on a build item. Implements:
 * - Plain click: select only this build
 * - Ctrl+click: toggle this build in selection
 * - Shift+click: range select from last clicked
 */
export function handleBuildClick(buildId, event) {
  const builds = getVisibleBuilds();

  if (event.ctrlKey || event.metaKey) {
    // Toggle
    if (selection.ids.has(buildId)) {
      selection.ids.delete(buildId);
    } else {
      selection.ids.add(buildId);
    }
    selection.lastClickedId = buildId;
  } else if (event.shiftKey && selection.lastClickedId) {
    // Range select
    const ids = builds.map((b) => b.id);
    const startIdx = ids.indexOf(selection.lastClickedId);
    const endIdx = ids.indexOf(buildId);
    if (startIdx >= 0 && endIdx >= 0) {
      const min = Math.min(startIdx, endIdx);
      const max = Math.max(startIdx, endIdx);
      for (let i = min; i <= max; i++) {
        selection.ids.add(ids[i]);
      }
    }
  } else {
    // Single select
    selection.ids.clear();
    selection.ids.add(buildId);
    selection.lastClickedId = buildId;
  }

  updateSelectionVisuals();
}

/**
 * Navigate selection with arrow keys.
 * @param {"up"|"down"} direction
 */
export function navigateSelection(direction) {
  const builds = getVisibleBuilds();
  if (!builds.length) return;

  const ids = builds.map((b) => b.id);
  const currentIdx = selection.lastClickedId
    ? ids.indexOf(selection.lastClickedId)
    : -1;

  let nextIdx;
  if (direction === "down") {
    nextIdx = currentIdx < ids.length - 1 ? currentIdx + 1 : currentIdx;
  } else {
    nextIdx = currentIdx > 0 ? currentIdx - 1 : 0;
  }

  selection.ids.clear();
  selection.ids.add(ids[nextIdx]);
  selection.lastClickedId = ids[nextIdx];
  updateSelectionVisuals();

  // Scroll selected item into view
  const el = document.querySelector(`[data-build-id="${ids[nextIdx]}"]`);
  el?.scrollIntoView({ block: "nearest" });
}

function updateSelectionVisuals() {
  document.querySelectorAll("[data-build-id]").forEach((el) => {
    const id = el.dataset.buildId;
    el.classList.toggle("lib-selected", selection.ids.has(id));
  });
}

/**
 * Wire click handlers onto all build items in the content area.
 * Call after each renderContent().
 */
export function wireSelectionEvents() {
  document.querySelectorAll("[data-build-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      // Don't handle if double-click will fire
      handleBuildClick(el.dataset.buildId, e);
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/library/selection.js
git commit -m "feat(library): add selection module with single, ctrl, shift+click and arrow nav"
```

---

### Task 14: Create context menu module

**Files:**
- Create: `src/renderer/modules/library/context-menu.js`

- [ ] **Step 1: Create the context menu module**

Renders a floating context menu on right-click. Detects what was clicked (build, folder, multi-select, empty area) and shows the appropriate menu.

```javascript
import { state } from "../state.js";
import { getSelection, isSelected } from "./selection.js";
import {
  playIcon, pencilIcon, documentDuplicateIcon, starIcon,
  folderArrowDownIcon, tagIcon, clipboardDocumentIcon, globeAltIcon,
  informationCircleIcon, trashIcon, folderOpenIcon, folderPlusIcon,
  documentPlusIcon, plusIcon, clipboardIcon, homeIcon,
  folderIcon,
} from "./heroicons.js";

let _callbacks = {};
let _activeMenu = null;

export function initContextMenu(callbacks) {
  _callbacks = callbacks;

  // Close menu on click outside or Escape
  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}

export function closeMenu() {
  if (_activeMenu) {
    _activeMenu.remove();
    _activeMenu = null;
  }
}

/**
 * Wire contextmenu (right-click) handler on the library content area.
 * Call after each renderContent().
 */
export function wireContextMenuEvents() {
  const content = document.getElementById("lib-content");
  if (!content) return;

  content.addEventListener("contextmenu", (e) => {
    e.preventDefault();

    const buildEl = e.target.closest("[data-build-id]");
    const folderEl = e.target.closest("[data-folder-id]");

    if (buildEl) {
      const buildId = buildEl.dataset.buildId;
      const selected = getSelection();
      if (selected.length > 1 && isSelected(buildId)) {
        showMultiSelectMenu(e.clientX, e.clientY, selected);
      } else {
        showBuildMenu(e.clientX, e.clientY, buildId);
      }
    } else if (folderEl) {
      showFolderMenu(e.clientX, e.clientY, folderEl.dataset.folderId);
    } else {
      showEmptyMenu(e.clientX, e.clientY);
    }
  });
}

function showBuildMenu(x, y, buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const pinLabel = build.pinned ? "Unpin" : "Pin to Top";

  const items = [
    { icon: playIcon, label: "Load in Editor", shortcut: "Enter", action: () => _callbacks.onLoadBuild?.(buildId) },
    { icon: pencilIcon, label: "Rename", shortcut: "F2", action: () => _callbacks.onRename?.(buildId) },
    { icon: documentDuplicateIcon, label: "Duplicate", shortcut: "Ctrl+D", action: () => _callbacks.onDuplicate?.(buildId) },
    "separator",
    { icon: starIcon, label: pinLabel, action: () => _callbacks.onTogglePin?.(buildId) },
    { icon: folderArrowDownIcon, label: "Move to Folder", submenu: buildMoveSubmenu(buildId) },
    { icon: tagIcon, label: "Edit Tags...", action: () => _callbacks.onEditTags?.(buildId) },
    "separator",
    { icon: clipboardDocumentIcon, label: "Copy as JSON", shortcut: "Ctrl+C", action: () => _callbacks.onCopyJson?.(buildId) },
    { icon: globeAltIcon, label: "Publish to Web", action: () => _callbacks.onPublish?.(buildId) },
    "separator",
    { icon: informationCircleIcon, label: "Build Info", action: () => _callbacks.onBuildInfo?.(buildId) },
    { icon: trashIcon, label: "Delete", shortcut: "Del", danger: true, action: () => _callbacks.onDelete?.([buildId]) },
  ];

  showMenu(x, y, items);
}

function showMultiSelectMenu(x, y, selectedIds) {
  const count = selectedIds.length;
  const items = [
    { label: `${count} builds selected`, disabled: true, header: true },
    "separator",
    { icon: folderArrowDownIcon, label: "Move to Folder", submenu: buildMoveSubmenu(selectedIds) },
    { icon: tagIcon, label: "Add Tags...", action: () => _callbacks.onEditTags?.(selectedIds) },
    { icon: starIcon, label: "Pin All", action: () => _callbacks.onPinAll?.(selectedIds) },
    "separator",
    { icon: clipboardDocumentIcon, label: "Export as JSON", action: () => _callbacks.onExportJson?.(selectedIds) },
    "separator",
    { icon: trashIcon, label: `Delete ${count} Builds`, danger: true, action: () => _callbacks.onDelete?.(selectedIds) },
  ];

  showMenu(x, y, items);
}

function showFolderMenu(x, y, folderId) {
  const items = [
    { icon: folderOpenIcon, label: "Open Folder", shortcut: "Enter", action: () => _callbacks.onOpenFolder?.(folderId) },
    { icon: pencilIcon, label: "Rename Folder", shortcut: "F2", action: () => _callbacks.onRenameFolder?.(folderId) },
    "separator",
    { icon: folderPlusIcon, label: "New Sub-folder", action: () => _callbacks.onNewSubfolder?.(folderId) },
    { icon: documentPlusIcon, label: "New Build in Folder", action: () => _callbacks.onNewBuildInFolder?.(folderId) },
    "separator",
    { icon: trashIcon, label: "Delete Folder", danger: true, action: () => _callbacks.onDeleteFolder?.(folderId) },
  ];

  showMenu(x, y, items);
}

function showEmptyMenu(x, y) {
  const items = [
    { icon: plusIcon, label: "New Build", shortcut: "Ctrl+N", action: () => _callbacks.onNewBuild?.() },
    { icon: folderPlusIcon, label: "New Folder", action: () => _callbacks.onNewFolder?.() },
    "separator",
    { icon: clipboardIcon, label: "Paste Build from JSON", shortcut: "Ctrl+V", action: () => _callbacks.onPasteJson?.() },
    "separator",
    { label: "Select All", shortcut: "Ctrl+A", action: () => _callbacks.onSelectAll?.() },
  ];

  showMenu(x, y, items);
}

function buildMoveSubmenu(buildIds) {
  const ids = Array.isArray(buildIds) ? buildIds : [buildIds];
  return [
    { icon: folderPlusIcon, label: "New Folder...", action: () => _callbacks.onNewFolderAndMove?.(ids) },
    "separator",
    { icon: homeIcon, label: "Root (no folder)", action: () => _callbacks.onMoveTo?.(ids, null) },
    ...state.folders
      .filter((f) => f.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((f) => ({
        icon: folderIcon,
        label: f.name,
        action: () => _callbacks.onMoveTo?.(ids, f.id),
      })),
  ];
}

function showMenu(x, y, items) {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "lib-ctx-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  for (const item of items) {
    if (item === "separator") {
      const sep = document.createElement("div");
      sep.className = "lib-ctx-sep";
      menu.appendChild(sep);
      continue;
    }

    const row = document.createElement("div");
    row.className = `lib-ctx-item${item.danger ? " lib-ctx-item--danger" : ""}${item.disabled ? " lib-ctx-item--disabled" : ""}${item.header ? " lib-ctx-item--header" : ""}`;

    let html = "";
    if (item.icon) html += `<span class="lib-ctx-icon">${item.icon}</span>`;
    html += `<span class="lib-ctx-label">${escapeHtml(item.label)}</span>`;
    if (item.shortcut) html += `<span class="lib-ctx-shortcut">${item.shortcut}</span>`;

    row.innerHTML = html;

    if (item.submenu) {
      row.innerHTML += `<span class="lib-ctx-arrow">&#9656;</span>`;
      row.addEventListener("mouseenter", () => {
        showSubmenu(row, item.submenu);
      });
    } else if (item.action) {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenu();
        item.action();
      });
    }

    menu.appendChild(row);
  }

  document.body.appendChild(menu);
  _activeMenu = menu;

  // Ensure menu stays within viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${x - rect.width}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${y - rect.height}px`;
  }
}

function showSubmenu(parentRow, items) {
  // Remove existing submenus
  document.querySelectorAll(".lib-ctx-submenu").forEach((el) => el.remove());

  const sub = document.createElement("div");
  sub.className = "lib-ctx-menu lib-ctx-submenu";

  const parentRect = parentRow.getBoundingClientRect();
  sub.style.left = `${parentRect.right - 4}px`;
  sub.style.top = `${parentRect.top}px`;

  for (const item of items) {
    if (item === "separator") {
      const sep = document.createElement("div");
      sep.className = "lib-ctx-sep";
      sub.appendChild(sep);
      continue;
    }

    const row = document.createElement("div");
    row.className = "lib-ctx-item";
    let html = "";
    if (item.icon) html += `<span class="lib-ctx-icon">${item.icon}</span>`;
    html += `<span class="lib-ctx-label">${escapeHtml(item.label)}</span>`;
    row.innerHTML = html;

    if (item.action) {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenu();
        item.action();
      });
    }

    sub.appendChild(row);
  }

  document.body.appendChild(sub);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/library/context-menu.js
git commit -m "feat(library): add context menu module with build, folder, multi-select, empty menus"
```

---

## Chunk 5: Drag-and-Drop, Library Orchestrator, Integration, CSS & Cleanup

### Task 15: Create drag-and-drop module

**Files:**
- Create: `src/renderer/modules/library/drag-drop.js`

- [ ] **Step 1: Create the drag-drop module**

Implements HTML5 drag-and-drop for builds (move to folder, reorder) and sidebar folders (reorder).

```javascript
import { state } from "../state.js";
import { moveBuilds, reorderBuilds, reorderFolders } from "./folder-store.js";
import { getSelection } from "./selection.js";

let _callbacks = {};

export function initDragDrop(callbacks) {
  _callbacks = callbacks;
}

/**
 * Wire drag-and-drop handlers onto content and sidebar elements.
 * Call after each render.
 */
export function wireDragDropEvents() {
  // Make build rows draggable
  document.querySelectorAll("[data-build-id]").forEach((el) => {
    el.draggable = true;
    el.addEventListener("dragstart", onBuildDragStart);
    el.addEventListener("dragend", onDragEnd);
  });

  // Make inline folders drop targets
  document.querySelectorAll("[data-folder-id]").forEach((el) => {
    el.addEventListener("dragover", onFolderDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onFolderDrop);
  });

  // Make sidebar folders drop targets
  document.querySelectorAll("#lib-sidebar [data-folder-id]").forEach((el) => {
    el.addEventListener("dragover", onFolderDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onFolderDrop);
  });

  // Make sidebar nav items that represent custom folders drop targets
  document.querySelectorAll('#lib-sidebar [data-nav^="custom:"]').forEach((el) => {
    el.addEventListener("dragover", onFolderDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("lib-drop-target");
      const folderId = el.dataset.nav.slice(7);
      handleBuildDrop(folderId);
    });
  });

  // Root area drop target (move to root)
  const content = document.getElementById("lib-content");
  if (content) {
    content.addEventListener("dragover", (e) => {
      if (e.target === content || e.target.closest("[data-folder-id]") === null && e.target.closest("[data-build-id]") === null) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    });
    content.addEventListener("drop", (e) => {
      if (e.target === content || (e.target.closest("[data-folder-id]") === null && e.target.closest("[data-build-id]") === null)) {
        e.preventDefault();
        // If currently inside a folder, dropping on empty area moves to current folder's parent
        // If at root, this is a no-op
        const current = state.currentFolder;
        const targetFolderId = current?.type === "custom" ? current.id : null;
        handleBuildDrop(targetFolderId);
      }
    });
  }
}

let _draggedBuildIds = [];

function onBuildDragStart(e) {
  const buildId = e.currentTarget.dataset.buildId;
  const selected = getSelection();

  // If dragging a selected item, drag all selected. Otherwise just this one.
  if (selected.includes(buildId) && selected.length > 1) {
    _draggedBuildIds = selected;
  } else {
    _draggedBuildIds = [buildId];
  }

  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", JSON.stringify(_draggedBuildIds));
  e.currentTarget.classList.add("lib-dragging");
}

function onDragEnd(e) {
  e.currentTarget.classList.remove("lib-dragging");
  document.querySelectorAll(".lib-drop-target").forEach((el) => {
    el.classList.remove("lib-drop-target");
  });
  _draggedBuildIds = [];
}

function onFolderDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  e.currentTarget.classList.add("lib-drop-target");
}

function onDragLeave(e) {
  e.currentTarget.classList.remove("lib-drop-target");
}

function onFolderDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove("lib-drop-target");
  const folderId = e.currentTarget.dataset.folderId;
  if (folderId) {
    handleBuildDrop(folderId);
  }
}

async function handleBuildDrop(folderId) {
  if (!_draggedBuildIds.length) return;
  await moveBuilds(_draggedBuildIds, folderId);
  _draggedBuildIds = [];
  _callbacks.onRefresh?.();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/library/drag-drop.js
git commit -m "feat(library): add drag-and-drop module for builds to folders"
```

---

### Task 16: Create library orchestrator module

**Files:**
- Create: `src/renderer/modules/library/library.js`

- [ ] **Step 1: Create the library orchestrator**

This is the main entry point that initializes all library sub-modules, wires their callbacks together, and exposes a `renderLibrary()` function.

```javascript
import { state } from "../state.js";
import { loadFolders, saveFolder, deleteFolder, moveBuilds, pinBuilds } from "./folder-store.js";
import { initToolbar, renderToolbar, renderFilters } from "./toolbar.js";
import { initSidebar, renderSidebar } from "./sidebar.js";
import { initContent, renderContent } from "./content.js";
import { initContextMenu, wireContextMenuEvents, closeMenu } from "./context-menu.js";
import { initDragDrop, wireDragDropEvents } from "./drag-drop.js";
import { clearSelection, selectAll, wireSelectionEvents, navigateSelection, getSelection } from "./selection.js";

let _appCallbacks = {};

/**
 * Initialize the library system. Call once at app startup.
 * @param {Object} callbacks - App-level callbacks:
 *   - navigateToPage(page)
 *   - loadBuildIntoEditor(build)
 *   - startNewBuild()
 *   - confirmDiscardDirty(action)
 *   - saveCurrentBuild()
 *   - duplicateCurrentBuild()
 *   - copyBuildJsonToClipboard()
 *   - importBuildJsonFromClipboard()
 *   - render()
 */
export async function initLibrary(callbacks) {
  _appCallbacks = callbacks;

  await loadFolders();
  await loadPrefs();

  const sharedCallbacks = {
    onNavigate: refreshAll,
    onFilterChange: refreshContent,
    onSortChange: refreshContent,
    onViewChange: refreshAll,
    onPrefsChange: savePrefs,
    onNewBuild: handleNewBuild,
    onNewFolder: handleNewFolder,
    onLoadBuild: handleLoadBuild,
    onRefresh: refreshAll,
    onRename: handleRename,
    onDuplicate: handleDuplicate,
    onTogglePin: handleTogglePin,
    onPinAll: handlePinAll,
    onMoveTo: handleMoveTo,
    onDelete: handleDelete,
    onCopyJson: handleCopyJson,
    onExportJson: handleCopyJson,
    onPasteJson: handlePasteJson,
    onPublish: handlePublish,
    onBuildInfo: handleBuildInfo,
    onEditTags: handleEditTags,
    onSelectAll: selectAll,
    onOpenFolder: handleOpenFolder,
    onRenameFolder: handleRenameFolder,
    onNewSubfolder: handleNewSubfolder,
    onNewBuildInFolder: handleNewBuildInFolder,
    onDeleteFolder: handleDeleteFolder,
    onNewFolderAndMove: handleNewFolderAndMove,
  };

  initToolbar(sharedCallbacks);
  initSidebar(sharedCallbacks);
  initContent(sharedCallbacks);
  initContextMenu(sharedCallbacks);
  initDragDrop(sharedCallbacks);
}

/**
 * Render the entire library. Call when switching to the library page
 * or when builds/folders change.
 */
export function renderLibrary() {
  renderSidebar();
  renderToolbar();
  renderFilters();
  renderContent();
  wireSelectionEvents();
  wireContextMenuEvents();
  wireDragDropEvents();
}

// --- Refresh helpers ---

function refreshAll() {
  savePrefs();
  renderLibrary();
}

function refreshContent() {
  renderToolbar();
  renderFilters();
  renderContent();
  wireSelectionEvents();
  wireContextMenuEvents();
  wireDragDropEvents();
}

// --- Action handlers ---

function handleNewBuild() {
  if (!_appCallbacks.confirmDiscardDirty("Start a new build")) return;
  _appCallbacks.startNewBuild();
  _appCallbacks.navigateToPage("editor");
}

async function handleNewFolder() {
  const name = prompt("Folder name:");
  if (!name?.trim()) return;
  const parentId = state.currentFolder?.type === "custom" ? state.currentFolder.id : null;
  await saveFolder({ name: name.trim(), parentId });
  refreshAll();
}

async function handleLoadBuild(buildId) {
  if (!_appCallbacks.confirmDiscardDirty("Load a different build")) return;
  const build = state.builds.find((b) => b.id === buildId);
  if (build) {
    await _appCallbacks.loadBuildIntoEditor(build);
    _appCallbacks.navigateToPage("editor");
    _appCallbacks.render();
  }
}

async function handleRename(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const newTitle = prompt("Rename build:", build.title);
  if (newTitle === null || !newTitle.trim()) return;
  build.title = newTitle.trim();
  await window.desktopApi.saveBuild(build);
  state.builds = await window.desktopApi.listBuilds();
  refreshContent();
}

async function handleDuplicate(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const copy = { ...build, id: undefined, title: `${build.title || "Untitled"} (Copy)` };
  await window.desktopApi.saveBuild(copy);
  state.builds = await window.desktopApi.listBuilds();
  refreshContent();
}

async function handleTogglePin(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  await pinBuilds([buildId], !build.pinned);
  refreshContent();
}

async function handlePinAll(ids) {
  await pinBuilds(ids, true);
  refreshContent();
}

async function handleMoveTo(ids, folderId) {
  await moveBuilds(ids, folderId);
  refreshAll();
}

async function handleDelete(ids) {
  const count = ids.length;
  const msg = count === 1
    ? "Delete this build?"
    : `Delete ${count} builds?`;
  if (!confirm(msg)) return;
  for (const id of ids) {
    await window.desktopApi.deleteBuild(id);
  }
  state.builds = await window.desktopApi.listBuilds();
  clearSelection();
  refreshContent();
}

function handleCopyJson(buildIdOrIds) {
  const ids = Array.isArray(buildIdOrIds) ? buildIdOrIds : [buildIdOrIds];
  const builds = state.builds.filter((b) => ids.includes(b.id));
  const json = JSON.stringify(builds.length === 1 ? builds[0] : builds, null, 2);
  window.desktopApi.writeClipboardText(json);
}

function handlePasteJson() {
  _appCallbacks.importBuildJsonFromClipboard();
}

function handlePublish(buildId) {
  // Load and navigate to editor, then trigger publish
  handleLoadBuild(buildId);
}

function handleBuildInfo(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  alert(`Title: ${build.title}\nProfession: ${build.profession}\nCreated: ${build.createdAt}\nModified: ${build.updatedAt}\nTags: ${(build.tags || []).join(", ")}`);
}

function handleEditTags(buildIdOrIds) {
  const ids = Array.isArray(buildIdOrIds) ? buildIdOrIds : [buildIdOrIds];
  const build = state.builds.find((b) => b.id === ids[0]);
  const currentTags = ids.length === 1 ? (build?.tags || []).join(", ") : "";
  const input = prompt("Tags (comma-separated):", currentTags);
  if (input === null) return;
  const tags = input.split(",").map((t) => t.trim()).filter(Boolean);
  // Save tags to each build
  Promise.all(
    ids.map(async (id) => {
      const b = state.builds.find((x) => x.id === id);
      if (b) {
        b.tags = tags;
        await window.desktopApi.saveBuild(b);
      }
    }),
  ).then(async () => {
    state.builds = await window.desktopApi.listBuilds();
    refreshContent();
  });
}

function handleOpenFolder(folderId) {
  state.currentFolder = { type: "custom", id: folderId };
  refreshAll();
}

async function handleRenameFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const newName = prompt("Rename folder:", folder.name);
  if (newName === null || !newName.trim()) return;
  await saveFolder({ id: folderId, name: newName.trim(), parentId: folder.parentId });
  refreshAll();
}

async function handleNewSubfolder(parentId) {
  const name = prompt("Sub-folder name:");
  if (!name?.trim()) return;
  await saveFolder({ name: name.trim(), parentId });
  refreshAll();
}

function handleNewBuildInFolder(folderId) {
  // Start new build, set its folderId, navigate to editor
  if (!_appCallbacks.confirmDiscardDirty("Start a new build")) return;
  _appCallbacks.startNewBuild();
  state.editor.folderId = folderId;
  _appCallbacks.navigateToPage("editor");
}

async function handleDeleteFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  if (!confirm(`Delete folder "${folder.name}"? Builds will be moved to root.`)) return;
  await deleteFolder(folderId);
  // If we were viewing this folder, go to root
  if (state.currentFolder?.id === folderId) {
    state.currentFolder = null;
  }
  refreshAll();
}

async function handleNewFolderAndMove(buildIds) {
  const name = prompt("New folder name:");
  if (!name?.trim()) return;
  const parentId = state.currentFolder?.type === "custom" ? state.currentFolder.id : null;
  const folder = await saveFolder({ name: name.trim(), parentId });
  await moveBuilds(buildIds, folder.id);
  refreshAll();
}

// --- Preferences ---

async function loadPrefs() {
  const keys = [
    "library.viewMode",
    "library.sortField",
    "library.sortDirection",
    "library.sidebarOpen",
    "library.sidebarExpandedFolders",
    "library.activeFilters",
  ];

  for (const key of keys) {
    const val = await window.desktopApi.getSetting(key);
    if (val !== undefined && val !== null) {
      const shortKey = key.split(".")[1];
      state.libraryPrefs[shortKey] = val;
    }
  }
}

async function savePrefs() {
  const prefs = state.libraryPrefs;
  await window.desktopApi.setSetting("library.viewMode", prefs.viewMode);
  await window.desktopApi.setSetting("library.sortField", prefs.sortField);
  await window.desktopApi.setSetting("library.sortDirection", prefs.sortDirection);
  await window.desktopApi.setSetting("library.sidebarOpen", prefs.sidebarOpen);
  await window.desktopApi.setSetting("library.sidebarExpandedFolders", prefs.sidebarExpandedFolders);
  await window.desktopApi.setSetting("library.activeFilters", prefs.activeFilters);
}

/**
 * Handle keyboard shortcuts for the library page.
 * Call from the app-level keydown handler when the library page is active.
 */
export function handleLibraryKeydown(e) {
  // Don't handle if focus is in a text input
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  const isMod = e.ctrlKey || e.metaKey;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    navigateSelection("down");
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    navigateSelection("up");
  } else if (e.key === "Enter") {
    const selected = getSelection();
    if (selected.length === 1) handleLoadBuild(selected[0]);
  } else if (e.key === "F2") {
    const selected = getSelection();
    if (selected.length === 1) handleRename(selected[0]);
  } else if (e.key === "Delete") {
    const selected = getSelection();
    if (selected.length) handleDelete(selected);
  } else if (e.key === "Escape") {
    clearSelection();
    closeMenu();
  } else if (isMod && e.key === "a") {
    e.preventDefault();
    selectAll();
  } else if (isMod && e.key === "d") {
    e.preventDefault();
    const selected = getSelection();
    if (selected.length === 1) handleDuplicate(selected[0]);
  } else if (isMod && e.key === "n") {
    e.preventDefault();
    handleNewBuild();
  } else if (isMod && e.key === "c") {
    e.preventDefault();
    const selected = getSelection();
    if (selected.length) handleCopyJson(selected);
  } else if (isMod && e.key === "v") {
    e.preventDefault();
    handlePasteJson();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/library/library.js
git commit -m "feat(library): add library orchestrator with all action handlers and keyboard shortcuts"
```

---

### Task 17: Integrate library into renderer.js

**Files:**
- Modify: `src/renderer/renderer.js`
- Modify: `src/renderer/modules/render-pages.js`

- [ ] **Step 1: Import and initialize library in renderer.js**

At the top of `src/renderer/renderer.js`, add the import:

```javascript
import { initLibrary, renderLibrary, handleLibraryKeydown } from "./modules/library/library.js";
```

In the `init()` function (or wherever the app initializes after DOM ready), after the existing `reloadBuilds()` call, add:

```javascript
  await initLibrary({
    navigateToPage,
    loadBuildIntoEditor,
    startNewBuild,
    confirmDiscardDirty,
    saveCurrentBuild,
    duplicateCurrentBuild,
    copyBuildJsonToClipboard,
    importBuildJsonFromClipboard,
    render,
  });
```

- [ ] **Step 2: Call renderLibrary() when navigating to library page**

In the `navigateToPage()` function, find where it handles showing the library page. Add a `renderLibrary()` call when the library page becomes active:

```javascript
  if (page === "library") {
    renderLibrary();
  }
```

- [ ] **Step 3: Wire keyboard shortcuts for library page**

In the global keydown handler (around line 638), add library-specific keyboard handling when the library page is active:

```javascript
  if (state.activePage === "library") {
    handleLibraryKeydown(e);
    return; // Library handles its own shortcuts
  }
```

- [ ] **Step 4: Remove old buildSearch event listener**

Remove or guard the old search input event listener (around line 633-636) since the new toolbar module handles search:

```javascript
// Only bind if old element exists (backwards compatibility during transition)
if (el.buildSearch) {
  el.buildSearch.addEventListener("input", () => {
    state.buildSearch = String(el.buildSearch.value || "").trim().toLowerCase();
    renderBuildList();
  });
}
```

- [ ] **Step 5: Update render-pages.js to delegate to library**

In `src/renderer/modules/render-pages.js`, update the `renderBuildList()` function to delegate to the new library module when it's available. Replace the function body:

```javascript
export function renderBuildList() {
  // Library module handles rendering via library.js
  // This function is kept for backwards compatibility but is now a no-op
  // when the new library page markup is present.
  if (document.getElementById("lib-content")) return;

  // --- Legacy rendering below (fallback) ---
  // [keep existing code as fallback]
}
```

- [ ] **Step 6: Verify the app starts and the library page renders**

Run: `npm run dev`
Expected: App starts. Navigate to the Build Library page. The new sidebar, toolbar, and content area render. Existing builds appear. Editor page still works.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/renderer.js src/renderer/modules/render-pages.js
git commit -m "feat(library): integrate library orchestrator into renderer.js"
```

---

### Task 18: Create library CSS

**Files:**
- Create: `src/renderer/styles/library.css`
- Modify: `src/renderer/styles/cards.css`
- Modify: `src/renderer/index.html` (add stylesheet link)

- [ ] **Step 1: Create library.css**

Create `src/renderer/styles/library.css` with all library styles. The CSS uses `lib-` prefixed classes throughout. This file covers: page layout, sidebar, toolbar, filter chips, list view, table view, grid view, icon view, context menu, selection states, drag-drop feedback, and profession color classes.

Key structure (implement fully — these are the class names referenced by all the JS modules above):

```css
/* Page layout */
.lib-page { display: flex; height: 100%; }
.lib-sidebar { width: 200px; background: var(--bg-deeper, #12122a); border-right: 1px solid var(--border, #2a2a4a); padding: 8px 0; flex-shrink: 0; overflow-y: auto; transition: width 0.15s; }
.lib-sidebar--collapsed { width: 40px; padding: 4px; }
.lib-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.lib-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border-subtle, #1a1a3a); flex-wrap: wrap; }
.lib-filters { display: flex; gap: 4px; padding: 6px 12px; flex-wrap: wrap; }
.lib-content { flex: 1; overflow-y: auto; padding: 4px 0; }

/* Sidebar navigation items, breadcrumb, search, sort, view toggle, chips */
/* List view rows, table view, grid cards, icon grid */
/* Context menu, selection highlights, drag feedback */
/* Profession color classes: .lib-prof--guardian, .lib-prof--warrior, etc. */
```

The full CSS should match the mockup designs from brainstorming (compact rows, dark theme, profession colors, Heroicon sizing). Implement all classes referenced in toolbar.js, sidebar.js, content.js, context-menu.js, selection.js, and drag-drop.js.

Profession color map:
- guardian: `#6ea8ff`
- warrior: `#ff9944`
- necromancer: `#4dca7a`
- engineer: `#cc8844`
- ranger: `#77cc55`
- thief: `#cc6677`
- mesmer: `#b07acc`
- elementalist: `#dd5555`
- revenant: `#aa6655`

- [ ] **Step 2: Add library.css to index.html**

In `src/renderer/index.html`, find the existing `<link>` tags for stylesheets. Add:

```html
<link rel="stylesheet" href="./styles/library.css" />
```

- [ ] **Step 3: Remove old build-list/build-card selectors from cards.css**

In `src/renderer/styles/cards.css`, remove all `.build-list`, `.build-card`, `.build-card__*` selectors (approximately lines 117-234). Keep any non-library selectors (publish ticker, etc.) that remain.

- [ ] **Step 4: Verify visual appearance**

Run: `npm run dev`
Expected: Library page renders with proper styling matching the mockups: compact rows, dark theme, profession-colored icons, proper spacing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/library.css src/renderer/styles/cards.css src/renderer/index.html
git commit -m "feat(library): add library.css and remove old build card styles from cards.css"
```

---

### Task 19: Add escapeHtml and formatShortDate to utils.js

**Files:**
- Modify: `src/renderer/modules/utils.js`

- [ ] **Step 1: Check if escapeHtml and formatShortDate exist in utils.js**

Read `src/renderer/modules/utils.js` and check if `escapeHtml` and `formatShortDate` are already exported. If `escapeHtml` doesn't exist, add it:

```javascript
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
```

If `formatShortDate` already exists (it's used in render-pages.js), ensure it's exported. If not, add it:

```javascript
export function formatShortDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now - d;
  const diffHrs = diffMs / (1000 * 60 * 60);
  if (diffHrs < 1) return "Just now";
  if (diffHrs < 24) return `${Math.floor(diffHrs)} hrs ago`;
  const diffDays = diffHrs / 24;
  if (diffDays < 2) return "Yesterday";
  if (diffDays < 7) return `${Math.floor(diffDays)} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
```

- [ ] **Step 2: Update library modules to import from utils.js instead of inline**

In `toolbar.js`, `sidebar.js`, and `context-menu.js`, remove the inline `escapeHtml` functions and import from utils instead:

```javascript
import { escapeHtml } from "../utils.js";
```

In `content.js`, import both:

```javascript
import { escapeHtml, formatShortDate } from "../utils.js";
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/utils.js src/renderer/modules/library/toolbar.js src/renderer/modules/library/sidebar.js src/renderer/modules/library/content.js src/renderer/modules/library/context-menu.js
git commit -m "refactor(library): extract escapeHtml and formatShortDate to utils.js"
```

---

### Task 20: End-to-end verification

- [ ] **Step 1: Run all tests**

Run: `npx jest --verbose`
Expected: All tests pass (existing + new FolderStore and BuildStore tests)

- [ ] **Step 2: Run the app and verify all features**

Run: `npm run dev`

Verify each feature works:
1. Library page shows sidebar with smart folders and custom folders
2. All 4 view modes work (list, table, grid, icon)
3. Search filters builds in real time
4. Sort dropdown changes build order
5. Filter chips toggle and filter builds
6. Right-click shows appropriate context menu (build, multi-select, folder, empty area)
7. Create, rename, delete folders via context menu
8. Move builds to folders via context menu
9. Pin/unpin builds
10. Ctrl+click and Shift+click for multi-select
11. Drag builds onto folders
12. Keyboard shortcuts (Enter, F2, Del, Ctrl+D, Ctrl+N, arrows)
13. Sidebar collapse/expand
14. Breadcrumb navigation
15. Double-click build loads in editor
16. Double-click folder navigates into it

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(library): complete build library revamp with all views, folders, and interactions"
```
