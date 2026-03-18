# Comp System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a comp (composition) system that lets users group builds into squads with party line management.

**Architecture:** Comps are a new entity stored in `comps.json`, with a `CompStore` class in the main process mirroring the existing `BuildStore`/`FolderStore` pattern. The renderer gets a new `comps/` module directory for the dedicated comp page (list + detail modes), and the existing library module is extended to display comps alongside builds in folder views.

**Tech Stack:** Electron IPC, SortableJS (drag & drop), vanilla JS renderer modules, Jest for testing.

**Spec:** `docs/superpowers/specs/2026-03-17-comp-system-design.md`

---

### Task 1: CompStore — Data Layer

**Files:**
- Create: `src/main/compStore.js`
- Create: `tests/unit/compStore.test.js`
- Modify: `src/main/index.js:1-5` (imports), `src/main/index.js:333` (IPC handlers)
- Modify: `src/preload/index.js:34` (expose IPC methods)

- [ ] **Step 1: Write CompStore tests**

Create `tests/unit/compStore.test.js` following the `folderStore.test.js` pattern:

```js
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { CompStore } = require("../../src/main/compStore");

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-comp-"));
  const store = new CompStore(dir);
  await store.init();
  return { store, dir };
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

function makeComp(overrides = {}) {
  return {
    name: "Test Comp",
    tags: [],
    notes: "",
    ...overrides,
  };
}

describe("CompStore — init", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates comps.json if missing", async () => {
    const content = await fs.readFile(path.join(dir, "comps.json"), "utf-8");
    expect(JSON.parse(content)).toEqual([]);
  });
});

describe("CompStore — listComps", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("returns empty array initially", async () => {
    expect(await store.listComps()).toEqual([]);
  });
});

describe("CompStore — upsertComp", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates a new comp with defaults", async () => {
    const comp = await store.upsertComp(makeComp());
    expect(comp.id).toBeTruthy();
    expect(comp.name).toBe("Test Comp");
    expect(comp.buildIds).toEqual([]);
    expect(comp.partyLines).toHaveLength(1);
    expect(comp.partyLines[0].capacity).toBe(5);
    expect(comp.partyLines[0].slots).toEqual([]);
    expect(comp.folderId).toBeNull();
    expect(comp.createdAt).toBeTruthy();
    expect(comp.updatedAt).toBeTruthy();
  });

  test("updates existing comp by id", async () => {
    const created = await store.upsertComp(makeComp());
    const updated = await store.upsertComp({ ...created, name: "Updated" });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Updated");
    expect(updated.createdAt).toBe(created.createdAt);
    const all = await store.listComps();
    expect(all).toHaveLength(1);
  });

  test("truncates name to 140 chars", async () => {
    const comp = await store.upsertComp(makeComp({ name: "x".repeat(200) }));
    expect(comp.name.length).toBe(140);
  });

  test("truncates notes to 12000 chars", async () => {
    const comp = await store.upsertComp(makeComp({ notes: "x".repeat(15000) }));
    expect(comp.notes.length).toBe(12000);
  });
});

describe("CompStore — deleteComp", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("removes a comp by id", async () => {
    const comp = await store.upsertComp(makeComp());
    await store.deleteComp(comp.id);
    expect(await store.listComps()).toEqual([]);
  });
});

describe("CompStore — reorderComps", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("updates sortOrder for given ids", async () => {
    const a = await store.upsertComp(makeComp({ name: "A" }));
    const b = await store.upsertComp(makeComp({ name: "B" }));
    await store.reorderComps([
      { id: a.id, sortOrder: 2 },
      { id: b.id, sortOrder: 1 },
    ]);
    const comps = await store.listComps();
    expect(comps.find((c) => c.id === a.id).sortOrder).toBe(2);
    expect(comps.find((c) => c.id === b.id).sortOrder).toBe(1);
  });
});

describe("CompStore — removeBuildFromComps", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("removes a build id from buildIds and all party line slots", async () => {
    const comp = await store.upsertComp(makeComp({
      buildIds: ["b1", "b2"],
      partyLines: [{ id: "pl1", capacity: 5, slots: ["b1", "b2"] }],
    }));
    await store.removeBuildFromComps("b1");
    const comps = await store.listComps();
    expect(comps[0].buildIds).toEqual(["b2"]);
    expect(comps[0].partyLines[0].slots).toEqual(["b2"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/compStore.test.js --no-coverage`
Expected: FAIL — `Cannot find module '../../src/main/compStore'`

- [ ] **Step 3: Implement CompStore**

Create `src/main/compStore.js`:

```js
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

class CompStore {
  constructor(baseDir) {
    this.compsPath = path.join(baseDir, "comps.json");
  }

  async init() {
    await this.#ensureFile(this.compsPath, "[]");
  }

  async listComps() {
    return this.#readJson(this.compsPath);
  }

  async upsertComp(input) {
    const comps = await this.listComps();
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const name = String(input.name || "Untitled Comp").slice(0, 140);
    const notes = String(input.notes || "").slice(0, 12000);
    const tags = Array.isArray(input.tags) ? input.tags : [];
    const folderId = typeof input.folderId === "string" ? input.folderId : null;
    const sortOrder = typeof input.sortOrder === "number" ? input.sortOrder : 0;
    const buildIds = Array.isArray(input.buildIds) ? input.buildIds : [];
    const partyLines = Array.isArray(input.partyLines)
      ? input.partyLines.map((pl) => ({
          id: pl.id || crypto.randomUUID(),
          capacity: typeof pl.capacity === "number" ? pl.capacity : 5,
          slots: Array.isArray(pl.slots) ? pl.slots : [],
        }))
      : [{ id: crypto.randomUUID(), capacity: 5, slots: [] }];

    const existing = comps.find((c) => c.id === id);
    if (existing) {
      Object.assign(existing, {
        name, notes, tags, folderId, sortOrder, buildIds, partyLines,
        updatedAt: now,
      });
      existing.createdAt = existing.createdAt || now;
      await this.#writeJson(this.compsPath, comps);
      return existing;
    }

    const comp = {
      id, name, notes, tags, folderId, sortOrder, buildIds, partyLines,
      createdAt: now, updatedAt: now,
    };
    comps.push(comp);
    await this.#writeJson(this.compsPath, comps);
    return comp;
  }

  async deleteComp(id) {
    const comps = await this.listComps();
    const filtered = comps.filter((c) => c.id !== id);
    await this.#writeJson(this.compsPath, filtered);
  }

  async reorderComps(updates) {
    const comps = await this.listComps();
    for (const { id, sortOrder } of updates) {
      const comp = comps.find((c) => c.id === id);
      if (comp) comp.sortOrder = sortOrder;
    }
    await this.#writeJson(this.compsPath, comps);
  }

  async removeBuildFromComps(buildId) {
    const comps = await this.listComps();
    let changed = false;
    for (const comp of comps) {
      if (comp.buildIds.includes(buildId)) {
        comp.buildIds = comp.buildIds.filter((id) => id !== buildId);
        for (const line of comp.partyLines) {
          line.slots = line.slots.filter((id) => id !== buildId);
        }
        changed = true;
      }
    }
    if (changed) await this.#writeJson(this.compsPath, comps);
  }

  async #readJson(filePath) {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  }

  async #writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async #ensureFile(filePath, defaultContent) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, defaultContent);
    }
  }
}

module.exports = { CompStore };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/compStore.test.js --no-coverage`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/compStore.js tests/unit/compStore.test.js
git commit -m "feat(comps): add CompStore data layer with tests"
```

---

### Task 2: IPC Handlers & Preload Bridge

**Files:**
- Modify: `src/main/index.js:4-5` (add import), `src/main/index.js:283-293` (build delete cleanup), `src/main/index.js:333` (add handlers)
- Modify: `src/preload/index.js:34` (add comp methods)

- [ ] **Step 1: Add CompStore import and init to main process**

In `src/main/index.js`, add import at line 5 (after FolderStore import):

```js
const { CompStore } = require("./compStore");
```

Find where `folderStore` is instantiated (search for `new FolderStore`) and add `compStore` alongside it:

```js
const compStore = new CompStore(dataDir);
```

Find the `await folderStore.init()` call and add after it:

```js
await compStore.init();
```

- [ ] **Step 2: Add comp IPC handlers after line 333**

After the `builds:reorder` handler, add:

```js
// Comp CRUD
ipcMain.handle("comps:list", () => compStore.listComps());
ipcMain.handle("comps:save", (_e, comp) => compStore.upsertComp(comp));
ipcMain.handle("comps:delete", (_e, id) => compStore.deleteComp(id));
ipcMain.handle("comps:reorder", (_e, updates) => compStore.reorderComps(updates));
```

- [ ] **Step 3: Add build-delete cleanup for comps**

In the `builds:delete` handler (line 283-293), add comp cleanup after `store.deleteBuild(id)`:

```js
await compStore.removeBuildFromComps(id);
```

- [ ] **Step 4: Expose comp IPC methods in preload**

In `src/preload/index.js`, after line 34 (folder operations), add:

```js
// Comp operations
listComps: () => ipcRenderer.invoke("comps:list"),
saveComp: (comp) => ipcRenderer.invoke("comps:save", comp),
deleteComp: (id) => ipcRenderer.invoke("comps:delete", id),
reorderComps: (updates) => ipcRenderer.invoke("comps:reorder", updates),
```

- [ ] **Step 5: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat(comps): wire IPC handlers and preload bridge"
```

---

### Task 3: State & Page Scaffolding

**Files:**
- Modify: `src/renderer/modules/state.js:33` (add comp state fields)
- Modify: `src/renderer/index.html:385` (update comp page stub)
- Create: `src/renderer/modules/comps/comps.js`
- Create: `src/renderer/styles/comps.css`
- Modify: `src/renderer/renderer.js` (import and init comps, load comps on startup)
- Modify: `src/renderer/modules/render-pages.js` (wire comp page rendering)

- [ ] **Step 1: Add comp state fields**

In `src/renderer/modules/state.js`, after `libraryPrefs` (line 33), add:

```js
// Comp state
comps: [],
activeComp: null,
compPage: "list",   // "list" | "detail"
compSearch: "",
compPoolSearch: "",  // search within build pool in detail view
compPrefs: {
  sortField: "updatedAt",
  sortDirection: "desc",
  activeFilters: {},
},
```

- [ ] **Step 2: Update HTML page stub**

In `src/renderer/index.html`, replace the `#page-comps` div (currently the stub) with:

```html
<div id="page-comps" class="page hidden">
  <div class="comps-page" id="comps-container"></div>
</div>
```

- [ ] **Step 3: Create comps.css**

Create `src/renderer/styles/comps.css` with the page layout shell:

```css
/* AxiForge — Comps page styles */

.comps-page {
  height: calc(100vh - 40px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

Import it in the main CSS entry point (find where `library.css` is imported and add `comps.css` alongside it).

- [ ] **Step 4: Create comps module orchestrator**

Create `src/renderer/modules/comps/comps.js`:

```js
import { state } from "../state.js";

let _app = {};

export function initComps(appCallbacks) {
  _app = appCallbacks;
}

export async function loadComps() {
  state.comps = await window.desktopApi.listComps();
}

export function renderComps() {
  const container = document.getElementById("comps-container");
  if (!container) return;

  if (state.compPage === "detail" && state.activeComp) {
    container.innerHTML = `<p style="padding:20px;color:#888;">Detail view — coming in Task 5</p>`;
  } else {
    container.innerHTML = `<p style="padding:20px;color:#888;">Comp list — coming in Task 4</p>`;
  }
}
```

- [ ] **Step 5: Wire comps into renderer.js**

In `src/renderer/renderer.js`:

1. Add import near the library imports:
```js
import { initComps, loadComps, renderComps } from "./modules/comps/comps.js";
```

2. In the `init()` function, after `initLibrary(...)`, add:
```js
initComps({ /* callbacks wired in later tasks */ });
```

3. After the `loadBuilds` / `loadFolders` calls, add:
```js
await loadComps();
```

4. In the `navigateToPage` function, add a case for "comps" that calls `renderComps()`.

- [ ] **Step 6: Verify app boots and comps page shows placeholder**

Run: `npm start`
Expected: App opens. Clicking "Comps" in left nav shows placeholder text. No console errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/state.js src/renderer/index.html \
  src/renderer/modules/comps/comps.js src/renderer/styles/comps.css \
  src/renderer/renderer.js src/renderer/modules/render-pages.js
git commit -m "feat(comps): scaffold state, page, and module structure"
```

---

### Task 4: Comp List Mode

**Files:**
- Create: `src/renderer/modules/comps/comp-list.js`
- Modify: `src/renderer/modules/comps/comps.js` (wire list rendering)
- Modify: `src/renderer/styles/comps.css` (list styles)

- [ ] **Step 1: Create comp-list.js**

Create `src/renderer/modules/comps/comp-list.js` with:
- `renderCompList()` — renders toolbar (search, sort, tag filter) + comp rows
- Each comp row shows: squad icon (use `☰` or SVG), comp name, build count badge, tags
- Toolbar follows library's toolbar pattern: search input, sort dropdown (name, created, updated), filter chips for tags
- Clicking a row calls `openComp(comp)` callback
- "New Comp" button at top

Key functions:
```js
import { state } from "../state.js";

let _callbacks = {};

export function initCompList(callbacks) {
  _callbacks = callbacks;
}

export function renderCompList() {
  const container = document.getElementById("comps-container");
  // Render toolbar + filtered/sorted comp list
  // Wire click events to open comp detail
}

function getVisibleComps() {
  let comps = [...state.comps];
  // Apply search filter
  if (state.compSearch) {
    const q = state.compSearch.toLowerCase();
    comps = comps.filter((c) => c.name.toLowerCase().includes(q));
  }
  // Apply tag filters
  const activeTags = state.compPrefs.activeFilters.tags || [];
  if (activeTags.length) {
    comps = comps.filter((c) => activeTags.some((t) => c.tags.includes(t)));
  }
  // Sort
  const { sortField, sortDirection } = state.compPrefs;
  comps.sort((a, b) => {
    const aVal = a[sortField] || "";
    const bVal = b[sortField] || "";
    const cmp = typeof aVal === "string" ? aVal.localeCompare(bVal) : aVal - bVal;
    return sortDirection === "asc" ? cmp : -cmp;
  });
  return comps;
}
```

- [ ] **Step 2: Wire comp-list into comps.js**

Update `comps.js` to import and call `renderCompList()` in list mode:

```js
import { initCompList, renderCompList } from "./comp-list.js";
```

In `renderComps()`, call `renderCompList()` when `state.compPage === "list"`.

Wire callbacks for:
- `onOpenComp(comp)` — sets `state.activeComp = comp`, `state.compPage = "detail"`, re-renders
- `onNewComp()` — calls `desktopApi.saveComp({ name: "Untitled Comp" })`, reloads, opens detail
- `onDeleteComp(id)` — calls `desktopApi.deleteComp(id)`, reloads
- `onRenameComp(id, name)` — upserts with new name, reloads

- [ ] **Step 3: Add list styles to comps.css**

Style the comp list rows, toolbar, search bar, sort controls, and tag filter chips. Follow the same visual patterns as library.css (colors, spacing, font sizes).

Key classes:
- `.comp-list-toolbar` — toolbar row
- `.comp-list-row` — individual comp row (hover highlight, cursor pointer)
- `.comp-list-row__icon` — squad icon
- `.comp-list-row__name` — comp name
- `.comp-list-row__count` — build count badge
- `.comp-list-row__tags` — tag pills

- [ ] **Step 4: Verify comp list renders and interactions work**

Run: `npm start`
Expected: Comps page shows empty list with "New Comp" button. Creating a comp shows it in the list. Clicking opens detail placeholder. Search filters by name. Sort changes order.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/comps/comp-list.js src/renderer/modules/comps/comps.js \
  src/renderer/styles/comps.css
git commit -m "feat(comps): implement comp list mode with toolbar"
```

---

### Task 5: Comp Detail View — Party Lines Panel

**Files:**
- Create: `src/renderer/modules/comps/comp-detail.js`
- Modify: `src/renderer/modules/comps/comps.js` (wire detail rendering)
- Modify: `src/renderer/styles/comps.css` (detail styles)

- [ ] **Step 1: Create comp-detail.js with party lines rendering**

Create `src/renderer/modules/comps/comp-detail.js`:

Main render function builds the side-by-side layout:
- Top bar: back button, editable comp name, notes toggle, slot counter
- Tags row: pill UI (reuse same tag pill pattern from library)
- Left panel (40%): party lines
- Right panel (60%): build pool (placeholder for Task 6)

Party line rendering:
```js
function renderPartyLines(comp) {
  const totalSlots = comp.partyLines.reduce((sum, pl) => sum + pl.capacity, 0);
  let html = `<div class="comp-lines-header">PARTY LINES</div>`;

  comp.partyLines.forEach((line, idx) => {
    const isWrapping = line.capacity > 5;
    html += `<div class="comp-line${isWrapping ? " comp-line--wrap" : ""}" data-line-id="${line.id}">`;
    html += `<div class="comp-line__label">P${idx + 1}</div>`;
    html += `<div class="comp-line__slots">`;

    // Filled slots
    for (const buildId of line.slots) {
      const build = state.builds.find((b) => b.id === buildId);
      if (!build) continue;
      const profClass = build.profession ? build.profession.toLowerCase() : "unknown";
      const specIcon = getSpecIcon(build);
      html += `<div class="comp-slot comp-slot--filled lib-prof--${profClass}"
                    data-build-id="${buildId}" data-line-id="${line.id}"
                    title="${build.title || build.profession}">
                 <div class="comp-slot__icon">${specIcon}</div>
               </div>`;
    }
    // Empty slots
    const emptyCount = line.capacity - line.slots.length;
    for (let i = 0; i < emptyCount; i++) {
      html += `<div class="comp-slot comp-slot--empty" data-line-id="${line.id}">
                 <span class="comp-slot__plus">+</span>
               </div>`;
    }

    html += `</div>`; // .comp-line__slots
    html += `<div class="comp-line__actions">`;
    html += `<button class="comp-line__btn" data-action="duplicate" data-line-id="${line.id}" title="Duplicate">⧉</button>`;
    html += `<button class="comp-line__btn" data-action="remove" data-line-id="${line.id}" title="Remove">✕</button>`;
    html += `</div>`;
    html += `</div>`; // .comp-line
  });

  // Add Line
  html += `<div class="comp-add-line" data-action="add-line">+ Add Line</div>`;

  return html;
}
```

Wire event handlers:
- **Add Line:** Creates a new party line `{ id: uuid, capacity: 5, slots: [] }`, saves comp, re-renders
- **Remove Line:** Removes the party line by id, saves, re-renders
- **Duplicate Line:** Clones capacity + slots to a new party line, appends after source, saves, re-renders
- **Back button:** Sets `state.compPage = "list"`, `state.activeComp = null`, re-renders
- **Click empty slot:** Clicking an empty `+` slot increments that line's `capacity` by 1 (if total capacity across all lines < 50), saves comp, re-renders. This lets users grow a party line beyond its default 5 slots.

Enforce 50-slot cap: before adding a line or incrementing capacity, check `totalSlots < 50`.

- [ ] **Step 2: Wire detail into comps.js**

Import and call `renderCompDetail()` when `state.compPage === "detail"`.

- [ ] **Step 3: Add detail styles**

Key CSS in `comps.css`:

```css
.comp-detail { display: flex; flex-direction: column; height: 100%; }
.comp-detail__topbar { /* back button, name, notes, slot counter */ }
.comp-detail__tags { /* tag pills row */ }
.comp-detail__body { display: flex; flex: 1; min-height: 0; }
.comp-detail__lines { flex: 0 0 40%; overflow-y: auto; padding: 16px; border-right: 1px solid #1a1a3a; }
.comp-detail__pool { flex: 0 0 60%; overflow-y: auto; padding: 16px; background: #0a0a1e; }

.comp-line { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #111128; }
.comp-line--wrap { align-items: flex-start; }
.comp-line__label { font-size: 11px; color: #666; font-weight: 600; width: 22px; flex-shrink: 0; }
.comp-line--wrap .comp-line__label { padding-top: 10px; }
.comp-line__slots { display: flex; flex-wrap: wrap; gap: 5px; flex: 1; max-width: calc(5 * 42px + 4 * 5px); }
.comp-line__actions { display: flex; gap: 3px; flex-shrink: 0; }
.comp-line--wrap .comp-line__actions { padding-top: 10px; }
.comp-line__btn { font-size: 9px; color: #444; cursor: pointer; padding: 2px 4px; border-radius: 2px; background: none; border: none; }
.comp-line__btn:hover { color: #888; }

.comp-slot { width: 42px; height: 42px; border-radius: 5px; display: flex; align-items: center; justify-content: center; }
.comp-slot--filled { background: #12122a; border: 2px solid currentColor; cursor: pointer; }
.comp-slot--empty { background: #0e0e24; border: 2px dashed #2a2a4a; }
.comp-slot__icon { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.comp-slot__icon svg { width: 20px; height: 20px; }
.comp-slot__plus { font-size: 13px; color: #333; }

.comp-add-line { display: flex; align-items: center; justify-content: center; padding: 10px 0; margin-top: 4px; border: 1px dashed #2a2a4a; border-radius: 5px; cursor: pointer; font-size: 11px; color: #444; }
.comp-add-line:hover { color: #888; border-color: #3a3a5a; }
```

- [ ] **Step 4: Verify party lines render and controls work**

Run: `npm start`
Expected: Creating a comp and clicking it shows detail view with one empty party line (P1, 5 empty slots). Add Line appends P2. Duplicate copies the line. Remove deletes it. Back returns to list.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js src/renderer/modules/comps/comps.js \
  src/renderer/styles/comps.css
git commit -m "feat(comps): implement party lines panel in detail view"
```

---

### Task 6: Comp Detail View — Build Pool Panel

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js` (add build pool rendering)
- Modify: `src/renderer/styles/comps.css` (build pool styles)

- [ ] **Step 1: Add build pool rendering to comp-detail.js**

Implement `renderBuildPool(comp)` function:

```js
function renderBuildPool(comp) {
  const builds = comp.buildIds
    .map((id) => state.builds.find((b) => b.id === id))
    .filter(Boolean);

  // Apply pool search filter
  let filtered = builds;
  if (state.compPoolSearch) {
    const q = state.compPoolSearch.toLowerCase();
    filtered = builds.filter((b) =>
      (b.title || "").toLowerCase().includes(q) ||
      (b.profession || "").toLowerCase().includes(q)
    );
  }

  let html = `<div class="comp-pool-header">`;
  html += `<span class="comp-pool-title">BUILDS <span class="comp-pool-count">(${builds.length})</span></span>`;
  html += `<div class="comp-pool-controls">`;
  html += `<input type="text" class="comp-pool-search" placeholder="Search..." value="${state.compPoolSearch || ""}">`;
  html += `<button class="comp-pool-add">+ Add</button>`;
  html += `</div></div>`;

  html += `<div class="comp-pool-list">`;
  for (const build of filtered) {
    const profClass = build.profession ? build.profession.toLowerCase() : "unknown";
    const specIcon = getSpecIcon(build);
    const statPkg = build.equipment?.statPackage || "";
    const rune = getRuneName(build);
    const relic = getRelicName(build);
    const tags = (build.tags || []).map((t) =>
      `<span class="comp-pool-tag lib-prof--${profClass}">${t}</span>`
    ).join("");

    html += `<div class="comp-pool-card lib-prof--${profClass}" data-build-id="${build.id}" draggable="true">`;
    html += `  <div class="comp-pool-card__icon">${specIcon}</div>`;
    html += `  <div class="comp-pool-card__info">`;
    html += `    <div class="comp-pool-card__top">`;
    html += `      <span class="comp-pool-card__name">${build.title || build.profession}</span>`;
    html += `      ${tags}`;
    html += `    </div>`;
    html += `    <div class="comp-pool-card__bottom">`;
    if (statPkg) html += `<span class="comp-pool-card__stat">${statPkg}</span>`;
    if (rune) html += `<span class="comp-pool-card__sep">·</span><span class="comp-pool-card__equip">${rune}</span>`;
    if (relic) html += `<span class="comp-pool-card__sep">·</span><span class="comp-pool-card__equip">${relic}</span>`;
    html += `    </div>`;
    html += `  </div>`;
    html += `  <span class="comp-pool-card__mode">${build.gameMode || "pve"}</span>`;
    html += `</div>`;
  }
  html += `</div>`;

  return html;
}
```

Helper functions to extract rune/relic names from the build's equipment data (look up in `state.upgradeCatalog`).

- [ ] **Step 2: Implement "Add Build" picker modal**

Create a modal overlay that:
- Lists all builds NOT already in the comp's `buildIds`
- Has a search input to filter
- Shows class icon + build name for each
- Clicking a build adds it to `comp.buildIds`, saves, closes modal
- Multi-select with checkboxes for adding several at once
- "Done" button closes modal

- [ ] **Step 3: Wire pool events**

- Search input: updates `state.compPoolSearch`, re-renders pool only
- "+ Add" button: opens picker modal
- Right-click on pool card: context menu with "Remove from Comp" and "Open Build"
- "Remove from Comp": removes from `buildIds` and all `partyLines[].slots`, saves, re-renders

- [ ] **Step 4: Add build pool styles**

```css
.comp-pool-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.comp-pool-title { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; }
.comp-pool-count { color: #555; }
.comp-pool-search { background: #12122a; border: 1px solid #1a1a3a; border-radius: 3px; padding: 3px 8px; font-size: 10px; color: #aaa; width: 100px; outline: none; }
.comp-pool-add { background: #1a1a3a; border: 1px solid #2a2a4a; border-radius: 4px; padding: 3px 8px; font-size: 11px; color: #aaa; cursor: pointer; }

.comp-pool-card { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #12122a; border-radius: 5px; cursor: grab; border-left: 3px solid currentColor; margin-bottom: 4px; }
.comp-pool-card__icon { width: 32px; height: 32px; background: rgba(255,255,255,0.05); border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.comp-pool-card__icon svg { width: 20px; height: 20px; }
.comp-pool-card__info { flex: 1; min-width: 0; }
.comp-pool-card__top { display: flex; align-items: center; gap: 6px; }
.comp-pool-card__name { font-size: 13px; color: #ddd; font-weight: 500; }
.comp-pool-card__bottom { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
.comp-pool-card__stat { font-size: 10px; color: #c8a96e; }
.comp-pool-card__sep { font-size: 10px; color: #444; }
.comp-pool-card__equip { font-size: 10px; color: #777; }
.comp-pool-card__mode { font-size: 9px; color: #555; background: #0d0d22; border-radius: 8px; padding: 1px 6px; flex-shrink: 0; }
.comp-pool-tag { font-size: 9px; border-radius: 8px; padding: 0 5px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); }
```

- [ ] **Step 5: Verify build pool renders with correct info**

Run: `npm start`
Expected: Adding builds to comp via picker shows them as mini cards with name, stats, rune, relic, tags. Search filters the pool. Removing a build clears it from pool and any party line slots.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js src/renderer/styles/comps.css
git commit -m "feat(comps): implement build pool panel with picker modal"
```

---

### Task 7: Drag & Drop — Pool to Party Lines

**Files:**
- Create: `src/renderer/modules/comps/comp-drag-drop.js`
- Modify: `src/renderer/modules/comps/comp-detail.js` (wire drag-drop)
- Modify: `src/renderer/styles/comps.css` (drag states)

- [ ] **Step 1: Create comp-drag-drop.js**

Implement drag & drop using SortableJS (already a project dependency):

```js
import Sortable from "sortablejs";
import { state } from "../state.js";

let poolSortable = null;
let lineSortables = [];

export function wireCompDragDrop(callbacks) {
  destroyCompDragDrop();

  // Build pool — draggable source (clone mode)
  const poolEl = document.querySelector(".comp-pool-list");
  if (poolEl) {
    poolSortable = new Sortable(poolEl, {
      group: { name: "comp-builds", pull: "clone", put: false },
      sort: false,
      animation: 150,
      ghostClass: "comp-drag-ghost",
      dragClass: "comp-drag-active",
      // On drag start, use a custom drag image that shows just the icon
      onStart(evt) {
        // The forceFallback approach lets us control the ghost
      },
      forceFallback: true,
      fallbackClass: "comp-drag-icon-ghost",
      // Scale down the ghost to icon size
      onEnd() { /* no-op for pool — handled by line onAdd */ },
    });
  }

  // Each party line — drop targets
  const lineEls = document.querySelectorAll(".comp-line__slots");
  lineEls.forEach((el) => {
    const sortable = new Sortable(el, {
      group: { name: "comp-builds", pull: false, put: true },
      animation: 150,
      ghostClass: "comp-slot-ghost",
      onAdd(evt) {
        const buildId = evt.item.dataset.buildId;
        const lineId = el.closest(".comp-line")?.dataset.lineId;
        if (buildId && lineId) {
          callbacks.onDropBuildToLine(buildId, lineId);
        }
        evt.item.remove(); // Remove clone from DOM — re-render handles it
      },
    });
    lineSortables.push(sortable);
  });

  // Party line reordering
  const linesContainer = document.querySelector(".comp-lines-list");
  if (linesContainer) {
    new Sortable(linesContainer, {
      animation: 150,
      handle: ".comp-line__label",
      ghostClass: "comp-line-ghost",
      onEnd(evt) {
        callbacks.onReorderLines(evt.oldIndex, evt.newIndex);
      },
    });
  }
}

export function destroyCompDragDrop() {
  poolSortable?.destroy();
  poolSortable = null;
  lineSortables.forEach((s) => s.destroy());
  lineSortables = [];
}
```

- [ ] **Step 2: Wire into comp-detail.js**

After rendering, call `wireCompDragDrop()` with callbacks:
- `onDropBuildToLine(buildId, lineId)`: find the line, add buildId to slots (if capacity allows and total < 50), save comp, re-render
- `onReorderLines(oldIdx, newIdx)`: splice partyLines array, save comp, re-render
- `onSwapSlots(fromLineId, fromIdx, toLineId, toIdx)`: swap slot values between lines

- [ ] **Step 3: Add drag ghost styles**

```css
/* Shrink pool card to icon during drag */
.comp-drag-icon-ghost {
  width: 42px !important;
  height: 42px !important;
  overflow: hidden;
  border-radius: 5px;
  opacity: 0.9;
}
.comp-drag-icon-ghost .comp-pool-card__info,
.comp-drag-icon-ghost .comp-pool-card__mode {
  display: none !important;
}
.comp-drag-icon-ghost .comp-pool-card__icon {
  width: 42px; height: 42px;
}

.comp-slot-ghost { opacity: 0.4; }
.comp-line-ghost { opacity: 0.5; background: #1a1a3a; }
.comp-slot--empty.comp-drop-target {
  border-color: rgba(110, 168, 255, 0.4);
  background: rgba(110, 168, 255, 0.06);
  box-shadow: 0 0 8px rgba(110, 168, 255, 0.1);
}
```

- [ ] **Step 4: Verify drag & drop works**

Run: `npm start`
Expected: Dragging a mini card from pool shrinks to icon. Dropping on empty slot fills it. Party lines are reorderable by dragging P# label. Slot swaps work within and across lines. 50-slot cap is enforced.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/comps/comp-drag-drop.js \
  src/renderer/modules/comps/comp-detail.js src/renderer/styles/comps.css
git commit -m "feat(comps): implement drag & drop for pool-to-line and line reordering"
```

---

### Task 8: Library Integration — Sidebar & Content Views

**Files:**
- Modify: `src/renderer/modules/library/sidebar.js:154` (add "All Comps" smart folder)
- Modify: `src/renderer/modules/library/content.js` (render comps in views)
- Modify: `src/renderer/modules/library/folder-store.js` (getVisibleComps)
- Modify: `src/renderer/modules/library/library.js` (wire comp actions)
- Modify: `src/renderer/modules/library/selection.js` (include comps in multi-select)
- Modify: `src/renderer/modules/library/toolbar.js` ("New Comp" in dropdown)
- Modify: `src/renderer/styles/library.css` (comp row styles)

- [ ] **Step 1: Add "All Comps" smart folder to sidebar**

In `sidebar.js`, after the "By Game Mode" toggle group (around line 151), add an "All Comps" smart folder item:

```js
html += `<li class="lib-tv__item lib-tv__item--smart ${isActive("smart", "__all-comps") ? "lib-tv__item--active" : ""}"
             data-folder-type="smart" data-folder-id="__all-comps">
           <span class="lib-tv__icon">☰</span>
           <span class="lib-tv__label">All Comps</span>
         </li>`;
```

- [ ] **Step 2: Add getVisibleComps to folder-store.js**

```js
export function getVisibleComps() {
  const folder = state.currentFolder;
  let comps = [...state.comps];

  if (folder) {
    if (folder.type === "custom") {
      comps = comps.filter((c) => c.folderId === folder.id);
    } else if (folder.id === "__all-comps") {
      // Show all comps — no filter
    } else {
      // Smart folders other than __all-comps don't show comps
      return [];
    }
  } else {
    // Root: show comps with no folder
    comps = comps.filter((c) => !c.folderId);
  }

  return comps;
}
```

- [ ] **Step 3: Render comps in content views**

In `content.js`, after rendering folder rows and build rows, also render comp rows from `getVisibleComps()`.

For list view, each comp row:
```html
<div class="lib-list-row lib-list-row--comp" data-comp-id="${comp.id}">
  <span class="lib-list-row__spec-icon">☰</span>
  <span class="lib-list-row__title">${comp.name}</span>
  <span class="lib-list-row__badge">${comp.buildIds.length} builds</span>
</div>
```

Similar patterns for table, grid, columns, icon views.

- [ ] **Step 4: Add "New Comp" to toolbar new button dropdown**

In `toolbar.js`, find the new button dropdown and add a "New Comp" option that calls the comp creation callback.

- [ ] **Step 5: Wire click handler for comp rows**

In `library.js`, handle clicks on `[data-comp-id]` elements:
- Single click: select
- Double click / Enter: navigate to comp detail (`state.compPage = "detail"`, `state.activeComp = comp`, navigate to "comps" page)

- [ ] **Step 6: Integrate comps into multi-select**

In `selection.js`, extend the selection system to handle `[data-comp-id]` elements alongside `[data-build-id]`. Track selected comp IDs separately (or in a unified selection with a type tag). Comps participate in:
- Ctrl+click: toggle selection
- Shift+click: range select (within comp rows)
- Bulk move to folder (via context menu or keyboard shortcut)
- Bulk delete

Comps do NOT participate in build-specific bulk actions (copy JSON, pin, etc.).

- [ ] **Step 7: Verify comps appear in library views**

Run: `npm start`
Expected: Comps show up in folder views alongside builds. "All Comps" smart folder shows all comps. "New Comp" creates one. Double-clicking opens the comp detail page. Multi-select works for bulk move/delete.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/modules/library/sidebar.js src/renderer/modules/library/content.js \
  src/renderer/modules/library/folder-store.js src/renderer/modules/library/library.js \
  src/renderer/modules/library/selection.js src/renderer/modules/library/toolbar.js \
  src/renderer/styles/library.css
git commit -m "feat(comps): integrate comps into library sidebar and content views"
```

---

### Task 9: Library Integration — Context Menu & Drag-Drop-onto-Comp

**Files:**
- Modify: `src/renderer/modules/library/context-menu.js` (comp context menu)
- Modify: `src/renderer/modules/library/drag-drop.js` (drop build onto comp)

- [ ] **Step 1: Add comp context menu**

In `context-menu.js`, detect right-click on `[data-comp-id]` elements and show:
- Open
- Rename
- Duplicate
- Move to Folder (submenu)
- Delete

Wire each action through callbacks to the comp store operations.

- [ ] **Step 2: Add drop-build-onto-comp in library drag-drop**

In `drag-drop.js`, during the `onEnd` handler, detect when a build (`[data-build-id]`) is dropped onto a comp element (`[data-comp-id]`):

```js
// In onEnd or pointer detection:
const compTarget = document.elementFromPoint(x, y)?.closest("[data-comp-id]");
if (compTarget && draggedBuildId) {
  const compId = compTarget.dataset.compId;
  callbacks.onDropBuildOnComp(draggedBuildId, compId);
}
```

The callback adds the build to the comp's `buildIds` (if not already present), saves, and shows visual feedback.

- [ ] **Step 3: Add visual feedback for comp drop targets**

In `library.css`, add a hover/drop-target class for comp rows:

```css
.lib-list-row--comp.lib-drop-target {
  outline: 2px dashed rgba(110, 168, 255, 0.4);
  background: rgba(110, 168, 255, 0.06);
}
```

- [ ] **Step 4: Verify context menu and drag-drop**

Run: `npm start`
Expected: Right-clicking a comp shows context menu with all options. Dragging a build onto a comp row highlights it and adds the build to the comp. Rename, duplicate, delete all work.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/library/context-menu.js \
  src/renderer/modules/library/drag-drop.js src/renderer/styles/library.css
git commit -m "feat(comps): add comp context menu and drag-build-onto-comp"
```

---

### Task 10: Polish & Edge Cases

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js` (inline rename, notes, tooltips)
- Modify: `src/renderer/modules/comps/comps.js` (keyboard shortcuts)
- Modify: `src/renderer/styles/comps.css` (final polish)

- [ ] **Step 1: Implement inline comp name editing**

In the detail view top bar, clicking the comp name switches to an input field. On blur or Enter, save the new name.

- [ ] **Step 2: Implement notes panel**

Toggling the "Notes" button shows/hides a textarea below the tags row. Debounce-save on input (300ms).

- [ ] **Step 3: Implement slot right-click context menu**

Right-clicking a filled slot shows:
- Remove from Line
- Open Build (navigates to editor with this build loaded)

- [ ] **Step 4: Implement slot click to open build**

Clicking a filled slot in a party line loads that build into the editor and navigates to the editor page.

- [ ] **Step 5: Implement tooltips on filled slots**

Hovering a filled slot shows a tooltip with the build name. Use the existing tooltip pattern from the library if available, or a simple `title` attribute.

- [ ] **Step 6: Handle deleted/missing builds gracefully**

When rendering, if a buildId in `buildIds` or `partyLines[].slots` doesn't match any build in `state.builds`, show a "missing build" placeholder (greyed-out slot with `?` icon) or silently skip. This handles the case where a build was deleted but cleanup hasn't run yet.

- [ ] **Step 7: Final visual polish pass**

Verify all styles match the mockup:
- Profession colors on slot borders
- 42×42px slots with 30px inner icons
- Dashed borders on empty slots
- Gold stat package text
- Correct spacing and font sizes
- Smooth transitions on hover/drag states

- [ ] **Step 8: Run all existing tests to ensure no regressions**

Run: `npx jest --no-coverage`
Expected: All existing tests pass. No regressions from library modifications.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js src/renderer/modules/comps/comps.js \
  src/renderer/styles/comps.css
git commit -m "feat(comps): polish detail view — inline rename, notes, tooltips, edge cases"
```
