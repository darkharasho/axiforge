# Team Sync — Plan 3 of 3: Renderer UI, Migration, E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Teams a UI (Settings → Teams, library sharing actions, pending/conflict badges, conflict modal, publish-ownership warning), migrate existing GitHub-org libraries with one click, and cover the flow with an e2e test.

**Architecture:** The renderer keeps its existing `sync-status` event pipeline and adds two statuses (`pending`, `conflict`) plus a `sync-conflict` modal. A small `teams.js` renderer module owns team state (`state.teamSession`, `state.teams`) and replaces every `sharedLibraryConfig` read. Settings gets a "Teams" pane replacing "Shared Library". Migration is a main-process `TeamSync.migrateOrgLibrary` that re-uploads local shared folders (ids preserved) and clears the legacy `auth.sharedLibrary`.

**Tech Stack:** Vanilla DOM renderer modules (ESM, Vite), jsdom unit tests via babel-jest, Playwright Electron e2e with a tiny mock sync HTTP server.

**Spec:** `docs/superpowers/specs/2026-08-21-team-sync-design.md` (sections 2.5, 2.8, 3, 4, 5, 6, 7)

## Global Constraints

- Requires Plans 1 and 2 merged (preload exposes `teams:*`; compat shims `getSharedLibraryConfig`, `pullAllShared`, `pullFolder`, `shareFolder`, `unshareFolder`, `listOrgs`, `setupSharedLibrary`, `connectSharedLibrary`, `disconnectSharedLibrary`, `forcePush` exist and are removed by Task 1 here).
- Copy (verbatim from spec): disabled-share tooltips unchanged; conflict modal title `"<title>" was changed by <login> <relative time> while you were editing.` with buttons **Keep mine** / **Take theirs**; orphan banner `This library moved to Teams — join with the owner's invite code.`; publish-by-other warning `This was published by <login>. Publishing from your account creates a new link; the old one keeps working but won't update.`; stop-sharing toast for teammates `<login> stopped sharing "<Folder>"`.
- Badge statuses: `syncing`, `synced`, `pending` ("Waiting to sync"), `conflict` ("Sync conflict — click to resolve"), `error`.
- `sync-status` with `error: "pull"` toasts **once** (main already throttles to the third strike); `error: "auth"` shows a persistent banner.
- Never release/push without approval. Run tests with `npx jest <file> --maxWorkers=2`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/renderer/modules/teams.js` | Team state loading + helpers (`loadTeamState`, `teamRootFor`, `isTeamOwner`, `rootForTeam`) |
| `src/renderer/modules/choice-modal.js` | N-button modal returning the chosen id (conflict modal, team picker) |
| `src/renderer/modules/sync-status.js` | Pure badge descriptors for all five statuses |
| `src/renderer/renderer.js` | Event wiring: statuses, conflict modal, auth banner, detached teams, `online` |
| `src/renderer/modules/settings-modal.js` + `styles/settings-modal.css` | Teams pane |
| `src/renderer/modules/library/{context-menu,sidebar,content,folder-store,library}.js` | Share/stop-sharing/pull actions, team badges |
| `src/renderer/modules/render-pages.js`, `comps/comp-detail.js`, `src/preload/index.js` | Publish-by-other confirm |
| `src/main/teamSync.js`, `src/main/index.js` | `migrateOrgLibrary`, `teams:migrate-org-library`, `teams:legacy-status` |
| `tests/e2e/mock-sync-server.js`, `tests/e2e/specs/teams.spec.js`, `tests/e2e/helpers/app.js` | E2E |

---

### Task 1: Renderer team state (`teams.js`), choice modal, sync-status descriptors; drop `sharedLibraryConfig` and the compat shims

**Files:**
- Create: `src/renderer/modules/teams.js`, `src/renderer/modules/choice-modal.js`, `src/renderer/modules/sync-status.js`
- Modify: `src/renderer/modules/state.js:52-55`, `src/renderer/renderer.js` (init ≈314, settings callbacks ≈306-315, navigate ≈1002-1016, `_findRootSharedFolderInState` ≈70), `src/renderer/modules/library/library.js:64`, `:1227-1240`, `src/renderer/modules/library/folder-store.js:47-66`, `src/renderer/modules/library/context-menu.js:136-139`, `src/preload/index.js` (remove compat shims)
- Test: `tests/unit/renderer/teams-state.test.js`, `tests/unit/renderer/choice-modal.test.js`, `tests/unit/renderer/sync-status.test.js`, `tests/unit/teamsIpc.test.js` (extend)

**Interfaces:**
- `teams.js`: `loadTeamState() → Promise<void>` (sets `state.teamSession`, `state.teams`, `state.outbox`), `teamRootFor(folderId, folders = state.folders) → folder|null`, `rootForTeam(teamId, folders) → folder|null`, `isTeamOwner(folderId) → boolean`, `teamLabel(folder) → "Team: <name> · owner|member"`.
- `choice-modal.js`: `initChoiceModal()`, `showChoiceModal({ title, body, choices: [{ id, label, danger? }] }) → Promise<string|null>` (null on dismiss/Escape).
- `sync-status.js`: `describeSyncStatus(status) → { className, svg, title } | null`, `SYNC_STATUSES`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/renderer/teams-state.test.js
/** @jest-environment jsdom */
"use strict";
jest.mock("../../../src/renderer/modules/state.js", () => ({ state: { folders: [], teams: [], teamSession: null, outbox: {} } }));
const { state } = require("../../../src/renderer/modules/state.js");
const teams = require("../../../src/renderer/modules/teams.js");

beforeEach(() => {
  state.folders = [
    { id: "t", name: "EWW", parentId: null, shared: true, teamId: "t", role: "owner" },
    { id: "a", name: "A", parentId: "t" },
    { id: "m", name: "Guild", parentId: null, shared: true, teamId: "m", role: "member" },
    { id: "p", name: "P", parentId: null },
  ];
  window.desktopApi = {
    getTeamSession: jest.fn(async () => ({ sessionToken: "s", userId: "u", login: "me" })),
    listTeams: jest.fn(async () => [{ team: { id: "t", name: "EWW" }, role: "owner" }]),
    listOutbox: jest.fn(async () => ({ t: [{ itemId: "b1", type: "build", op: "put", conflict: null }] })),
    listFolders: jest.fn(async () => state.folders),
  };
});

test("teamRootFor walks parents; isTeamOwner; teamLabel", () => {
  expect(teams.teamRootFor("a").id).toBe("t");
  expect(teams.teamRootFor("p")).toBeNull();
  expect(teams.isTeamOwner("a")).toBe(true);
  expect(teams.isTeamOwner("m")).toBe(false);
  expect(teams.isTeamOwner("p")).toBe(false);
  expect(teams.rootForTeam("m").name).toBe("Guild");
  expect(teams.teamLabel(state.folders[0])).toBe("Team: EWW · owner");
});

test("loadTeamState populates session, teams, outbox and refreshes folders; tolerates no session", async () => {
  await teams.loadTeamState();
  expect(state.teamSession.login).toBe("me");
  expect(state.teams).toEqual([{ team: { id: "t", name: "EWW" }, role: "owner" }]);
  expect(state.outbox.t[0].itemId).toBe("b1");
  expect(window.desktopApi.listFolders).toHaveBeenCalled();
  window.desktopApi.getTeamSession.mockResolvedValue(null);
  await teams.loadTeamState();
  expect(state.teamSession).toBeNull();
  expect(state.teams).toEqual([]);
  expect(window.desktopApi.listTeams).toHaveBeenCalledTimes(1);
});
```

```js
// tests/unit/renderer/choice-modal.test.js
/** @jest-environment jsdom */
"use strict";
const { initChoiceModal, showChoiceModal } = require("../../../src/renderer/modules/choice-modal.js");

beforeEach(() => { document.body.innerHTML = ""; initChoiceModal(); });

test("resolves with the clicked choice id and renders labels/danger", async () => {
  const p = showChoiceModal({ title: "T", body: "<b>B</b>", choices: [{ id: "mine", label: "Keep mine" }, { id: "theirs", label: "Take theirs", danger: true }] });
  const btns = [...document.querySelectorAll(".choice-modal__btn")];
  expect(btns.map((b) => b.textContent)).toEqual(["Keep mine", "Take theirs"]);
  expect(btns[1].classList.contains("choice-modal__btn--danger")).toBe(true);
  expect(document.getElementById("chm-body").innerHTML).toBe("<b>B</b>");
  btns[0].click();
  expect(await p).toBe("mine");
  expect(document.querySelector(".choice-modal-overlay--hidden")).not.toBeNull();
});

test("Escape / close resolve null", async () => {
  const p = showChoiceModal({ title: "T", body: "", choices: [{ id: "x", label: "X" }] });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(await p).toBeNull();
  const p2 = showChoiceModal({ title: "T", body: "", choices: [{ id: "x", label: "X" }] });
  document.getElementById("chm-close").click();
  expect(await p2).toBeNull();
});
```

```js
// tests/unit/renderer/sync-status.test.js
"use strict";
const { describeSyncStatus, SYNC_STATUSES } = require("../../../src/renderer/modules/sync-status.js");

test("all five statuses have a class, svg and title; unknown → null", () => {
  expect(SYNC_STATUSES).toEqual(["syncing", "synced", "pending", "conflict", "error"]);
  for (const s of SYNC_STATUSES) {
    const d = describeSyncStatus(s);
    expect(d.className).toBe(`--${s}`);
    expect(d.svg).toMatch(/^<svg/);
    expect(d.title.length).toBeGreaterThan(3);
  }
  expect(describeSyncStatus("pending").title).toBe("Waiting to sync");
  expect(describeSyncStatus("conflict").title).toBe("Sync conflict — click to resolve");
  expect(describeSyncStatus("nope")).toBeNull();
});
```

Append to `tests/unit/teamsIpc.test.js`:

```js
test("renderer no longer uses the shared-library compat shims and preload no longer defines them", () => {
  const rendererDir = path.join(__dirname, "../../src/renderer");
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } })(rendererDir);
  const src = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  for (const name of ["getSharedLibraryConfig", "pullAllShared", "desktopApi.pullFolder", "desktopApi.shareFolder", "desktopApi.unshareFolder", "listOrgs", "setupSharedLibrary", "connectSharedLibrary", "disconnectSharedLibrary", "forcePush", "sharedLibraryConfig"]) {
    expect(src).not.toContain(name);
  }
  for (const name of ["getSharedLibraryConfig", "pullAllShared", "listOrgs", "setupSharedLibrary", "connectSharedLibrary", "disconnectSharedLibrary", "forcePush"]) {
    expect(PRELOAD).not.toContain(name);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/renderer/teams-state.test.js tests/unit/renderer/choice-modal.test.js tests/unit/renderer/sync-status.test.js tests/unit/teamsIpc.test.js --maxWorkers=2`
Expected: FAIL (modules missing; shims still referenced)

- [ ] **Step 3: Implement the three modules**

```js
// src/renderer/modules/teams.js
import { state } from "./state.js";

/** Nearest ancestor (or self) that is a team root folder. */
export function teamRootFor(folderId, folders = state.folders) {
  let current = folderId ? folders.find((f) => f.id === folderId) : null;
  while (current) {
    if (current.teamId) return current;
    if (!current.parentId) return null;
    current = folders.find((f) => f.id === current.parentId);
  }
  return null;
}

export function rootForTeam(teamId, folders = state.folders) {
  return folders.find((f) => f.teamId === teamId) || null;
}

export function isTeamOwner(folderId) {
  return teamRootFor(folderId)?.role === "owner";
}

export function teamLabel(folder) {
  return `Team: ${folder.name} · ${folder.role || "member"}`;
}

/** Refresh session, teams, outbox and folders from main. Safe when sync is off. */
export async function loadTeamState() {
  state.teamSession = await window.desktopApi.getTeamSession().catch(() => null);
  if (!state.teamSession) {
    state.teams = [];
    state.outbox = {};
    return;
  }
  state.teams = await window.desktopApi.listTeams().catch(() => state.teams || []);
  state.outbox = await window.desktopApi.listOutbox().catch(() => ({}));
  state.folders = await window.desktopApi.listFolders(); // listTeams may have created/detached roots
}
```

```js
// src/renderer/modules/choice-modal.js
// Like confirm-modal, but N labelled buttons and a distinct "dismissed" outcome.
let _overlay = null, _el = null, _resolve = null, _escHandler = null;

export function initChoiceModal() {
  if (typeof document === "undefined" || _overlay) return;
  _overlay = document.createElement("div");
  _overlay.className = "confirm-modal-overlay choice-modal-overlay choice-modal-overlay--hidden";
  _overlay.innerHTML = `
    <div class="confirm-modal choice-modal">
      <div class="confirm-modal__header">
        <h3 class="confirm-modal__title" id="chm-title"></h3>
        <button class="confirm-modal__close" id="chm-close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg></button>
      </div>
      <div class="confirm-modal__body" id="chm-body"></div>
      <div class="confirm-modal__actions" id="chm-actions"></div>
    </div>`;
  document.body.appendChild(_overlay);
  _el = { title: document.getElementById("chm-title"), body: document.getElementById("chm-body"), actions: document.getElementById("chm-actions"), close: document.getElementById("chm-close") };
  _el.close.addEventListener("click", () => _dismiss(null));
}

export function showChoiceModal({ title, body, choices }) {
  if (!_overlay) initChoiceModal();
  if (_resolve) _resolve(null);
  _el.title.textContent = title;
  _el.body.innerHTML = body || "";
  _el.actions.innerHTML = "";
  for (const c of choices) {
    const btn = document.createElement("button");
    btn.className = "confirm-modal__btn choice-modal__btn" + (c.danger ? " choice-modal__btn--danger" : " confirm-modal__btn--confirm");
    btn.textContent = c.label;
    btn.dataset.choice = c.id;
    btn.addEventListener("click", () => _dismiss(c.id));
    _el.actions.appendChild(btn);
  }
  _overlay.classList.remove("choice-modal-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _dismiss(null); };
  document.addEventListener("keydown", _escHandler);
  return new Promise((resolve) => { _resolve = resolve; });
}

function _dismiss(result) {
  _overlay.classList.add("choice-modal-overlay--hidden");
  if (_escHandler) { document.removeEventListener("keydown", _escHandler); _escHandler = null; }
  if (_resolve) { const r = _resolve; _resolve = null; r(result); }
}
```

```js
// src/renderer/modules/sync-status.js
// Pure descriptors for the library/editor sync badges. Kept free of DOM so the
// status → visual mapping is unit-testable and used by every badge site.
const SPIN = `<svg class="sync-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
const CHECK = `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd"/></svg>`;
const CLOCK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const WARN = `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.346 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>`;
const BOLT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;

const DESCRIPTORS = {
  syncing:  { svg: SPIN,  title: "Syncing…" },
  synced:   { svg: CHECK, title: "Synced" },
  pending:  { svg: CLOCK, title: "Waiting to sync" },
  conflict: { svg: BOLT,  title: "Sync conflict — click to resolve" },
  error:    { svg: WARN,  title: "Sync failed" },
};

export const SYNC_STATUSES = Object.keys(DESCRIPTORS);

export function describeSyncStatus(status) {
  const d = DESCRIPTORS[status];
  return d ? { className: `--${status}`, svg: d.svg, title: d.title } : null;
}
```

- [ ] **Step 4: Replace `sharedLibraryConfig` usages**

`state.js` lines 52-55 → 
```js
  teamSession: null,      // { sessionToken, userId, login } or null
  teams: [],              // [{ team: { id, name, inviteCode?, seq }, role }]
  outbox: {},             // teamId → [{ itemId, type, op, conflict }]
  folderSyncStatus: {},   // folderId → "syncing"|"synced"|"pending"|"conflict"|"error"
  buildSyncStatus: {},
  compSyncStatus: {},
```

`renderer.js`:
- import `{ loadTeamState, teamRootFor } from "./modules/teams.js"` and `{ initChoiceModal } from "./modules/choice-modal.js"`; call `initChoiceModal()` next to `initConfirmModal()`.
- Replace `_findRootSharedFolderInState` body with `return teamRootFor(folderId);`.
- Line ≈314 `state.sharedLibraryConfig = …` → `await loadTeamState();`.
- Settings callback `refreshLibraryState`: replace the `sharedLibraryConfig` line with `await loadTeamState();`.
- Navigate-to-library block: `if (state.teamSession) { window.desktopApi.pullAllTeams().then(async () => { …same reloads…; await loadTeamState(); renderLibrary(); }) }`.

`library.js:64` → `await loadTeamState();` (import from `../teams.js`). `library.js:1227-1240`: `if (folderObj) { const root = teamRootFor(folderId); if (root) window.desktopApi.pullTeam(root.teamId).then(…same reloads…) }`.

`folder-store.js` — replace `shareFolder/unshareFolder/pullFolder` with:
```js
/** Share a personal folder (and its subtree) to a team. */
export async function shareFolderToTeam(folderId, teamId) {
  const result = await window.desktopApi.shareFolderToTeam(folderId, teamId);
  await loadFolders();
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
  return result; // { uploaded, failed }
}
/** Owner only: remove a sub-folder tree from its team; local copies stay. */
export async function stopSharingFolder(folderId) {
  await window.desktopApi.stopSharingFolder(folderId);
  await loadFolders();
}
/** Pull the latest for the team that contains folderId. */
export async function pullTeamFor(folderId) {
  const root = teamRootFor(folderId);
  if (root) await window.desktopApi.pullTeam(root.teamId);
  await loadFolders();
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
}
```
(import `teamRootFor` from `../teams.js`).

`context-menu.js:136-139` → delete `_isOrgOwner`; import `isTeamOwner, teamRootFor` from `../teams.js` (the menu itself is rebuilt in Task 4; for now replace `_isOrgOwner()` with `isTeamOwner(folderId)` and `hasSharedLibrary` with `!!state.teamSession`).

`preload/index.js` — delete the "Compat shims" block.

- [ ] **Step 5: Run tests, then the full unit suite**

Run: `npx jest tests/unit/renderer/teams-state.test.js tests/unit/renderer/choice-modal.test.js tests/unit/renderer/sync-status.test.js tests/unit/teamsIpc.test.js tests/unit --maxWorkers=2`
Expected: PASS. (`tests/unit/renderer/subfolder-in-shared-folder.test.js` may reference `shared` folders — it concerns folder nesting, not the config; fix only if it imports a removed symbol.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/teams.js src/renderer/modules/choice-modal.js src/renderer/modules/sync-status.js src/renderer/modules/state.js src/renderer/renderer.js src/renderer/modules/library/library.js src/renderer/modules/library/folder-store.js src/renderer/modules/library/context-menu.js src/preload/index.js tests/unit/renderer/teams-state.test.js tests/unit/renderer/choice-modal.test.js tests/unit/renderer/sync-status.test.js tests/unit/teamsIpc.test.js
git commit -m "feat(teams-ui): renderer team state, choice modal, sync-status descriptors; drop shared-library shims"
```

---

### Task 2: Badges for `pending`/`conflict`, conflict modal, auth banner, detached teams, `online` flush

**Files:**
- Modify: `src/renderer/renderer.js` (`_updateItemSyncIndicators` ≈93-114, `_updateFolderSyncIndicators` ≈116-160, `onSyncStatus` handler ≈587-692, `onSyncConflict` ≈694-696), `src/renderer/styles/library.css` (≈1820-1860), `src/renderer/index.html` (banner slot), `src/renderer/styles.css` (banner)
- Test: `tests/unit/renderer/sync-badges.test.js` (for the extracted `applyBadge` helper placed in `sync-status.js`)

**Interfaces:**
- `sync-status.js` gains `applyBadge(el, status, { className, onClick })` — sets class, innerHTML, title; removes the badge when `status` is null; attaches `onClick` when status is `conflict`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/renderer/sync-badges.test.js
/** @jest-environment jsdom */
"use strict";
const { applyBadge } = require("../../../src/renderer/modules/sync-status.js");

test("applyBadge creates, updates, wires conflict click, and removes", () => {
  const host = document.createElement("span");
  const onClick = jest.fn();
  applyBadge(host, "pending", { className: "lib-content-sync-indicator", onClick });
  let badge = host.querySelector(".lib-content-sync-indicator");
  expect(badge.className).toBe("lib-content-sync-indicator lib-content-sync-indicator--pending");
  expect(badge.title).toBe("Waiting to sync");
  applyBadge(host, "conflict", { className: "lib-content-sync-indicator", onClick });
  badge = host.querySelector(".lib-content-sync-indicator");
  expect(badge.className).toContain("--conflict");
  badge.click();
  expect(onClick).toHaveBeenCalledTimes(1);
  applyBadge(host, "synced", { className: "lib-content-sync-indicator", onClick });
  host.querySelector(".lib-content-sync-indicator").click();
  expect(onClick).toHaveBeenCalledTimes(1); // click only active while conflicted
  applyBadge(host, null, { className: "lib-content-sync-indicator" });
  expect(host.querySelector(".lib-content-sync-indicator")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/renderer/sync-badges.test.js --maxWorkers=2` → FAIL (`applyBadge` undefined).

- [ ] **Step 3: Implement `applyBadge` and rewire the renderer**

Append to `sync-status.js`:

```js
export function applyBadge(host, status, { className, onClick } = {}) {
  let badge = host.querySelector(`.${className}`);
  const d = describeSyncStatus(status);
  if (!d) { badge?.remove(); return; }
  if (!badge) {
    badge = document.createElement("span");
    host.appendChild(badge);
  }
  badge.className = `${className} ${className}${d.className}`;
  badge.innerHTML = d.svg;
  badge.title = d.title;
  badge.onclick = status === "conflict" && onClick ? (e) => { e.stopPropagation(); onClick(); } : null;
  badge.style.cursor = status === "conflict" ? "pointer" : "";
}
```

In `renderer.js`:
- Replace the bodies of `_updateItemSyncIndicators` and `_updateFolderSyncIndicators` so each call site does `applyBadge(nameEl, status, { className: "lib-content-sync-indicator", onClick: () => _openConflict(type, id) })` / `applyBadge(navEl, status, { className: "lib-nav-item__sync-indicator" })` (keep the existing anchor-element lookup and the `insertBefore(countEl)` placement for the sidebar). Delete the inline `_syncSpinnerSvg/_syncCheckSvg/_syncErrorSvg` constants.
- Maintain `state.conflicts = {}` (`"${type}:${id}" → { teamId, itemId, type, title, current }`) — add to `state.js`.
- `onSyncStatus`: in the per-item branch, treat `pending` and `conflict` like other non-synced statuses (`state[statusMap][id] = status`), and do **not** start the 60 s "stuck spinner" timer for them (only for `syncing`). On `synced`, also `delete state.conflicts[\`${type}:${id}\`]`. Handle the new top-level payloads:
  ```js
    if (data.error === "auth") { _showSyncBanner("Team sync signed out — open Settings → Teams to sign in again."); return; }
    if (data.error === "pull") { showToast("Couldn't reach the team sync server — changes will sync when it's back.", "warning"); return; }
    if (status === "detached") {
      showToast("A team you were in is no longer available. Its folder is now personal.", "info");
      loadTeamState().then(renderLibrary);
      return;
    }
  ```
  and for per-item `error` events with a `message` (forbidden / too_large): `showToast(data.message, "error")`.
- `onSyncConflict`:
  ```js
  window.desktopApi.onSyncConflict?.((data) => {
    if (!data?.itemId) return;
    state.conflicts[`${data.type}:${data.itemId}`] = data;
    _openConflict(data.type, data.itemId);
  });
  async function _openConflict(type, id) {
    const c = state.conflicts[`${type}:${id}`];
    if (!c) return;
    const by = c.current?.updatedBy?.login || "a teammate";
    const when = c.current?.updatedAt ? relativeTime(c.current.updatedAt) : "just now";
    const choice = await showChoiceModal({
      title: "Sync conflict",
      body: `<strong>${escapeHtml(c.title || "This item")}</strong> was changed by <strong>${escapeHtml(by)}</strong> ${when} while you were editing.` +
            (c.current?.deleted ? "<br><br>It was <em>deleted</em> on the team." : ""),
      choices: [{ id: "mine", label: "Keep mine" }, { id: "theirs", label: "Take theirs", danger: true }],
    });
    if (!choice) return; // stays conflicted; badge reopens this
    await window.desktopApi.resolveConflict(c.teamId, c.itemId, choice);
    delete state.conflicts[`${type}:${id}`];
  }
  ```
  `relativeTime(iso)` is a 6-line helper added to `utils.js` (`"just now"`, `"N minutes ago"`, `"N hours ago"`, `"N days ago"`).
- `_showSyncBanner(text)`: a dismissible bar at the top of `#app` (`<div id="sync-banner" class="sync-banner" hidden>`), hidden again when `teams:enable` succeeds (Task 3 calls `_hideSyncBanner()` via a settings callback).
- Startup: after `loadTeamState()`, seed `state.buildSyncStatus/compSyncStatus` from `state.outbox` (`conflict` if `entry.conflict`, else `pending`) so badges survive a restart.
- `window.addEventListener("online", () => window.desktopApi.pullAllTeams?.().catch(() => {}))`.

CSS (`library.css`, next to the existing `--syncing/--synced/--error` rules):
```css
.lib-content-sync-indicator--pending, .lib-nav-item__sync-indicator--pending { color: var(--muted); }
.lib-content-sync-indicator--conflict, .lib-nav-item__sync-indicator--conflict { color: #f0b232; }
```
`styles.css`:
```css
.sync-banner { display: flex; gap: 12px; align-items: center; padding: 6px 14px; background: #3a2a0a; color: #f5d78e; font-size: 0.8rem; }
.sync-banner[hidden] { display: none; }
.sync-banner__close { margin-left: auto; background: none; border: 0; color: inherit; cursor: pointer; }
```

- [ ] **Step 4: Run the test and the renderer suites**

Run: `npx jest tests/unit/renderer/sync-badges.test.js tests/unit/renderer --maxWorkers=2` → PASS.

- [ ] **Step 5: Manual check**

`AXIFORGE_SYNC_BASE=http://localhost:8787/api/sync npm run dev` with `wrangler dev` stopped: save a build in a team folder → clock badge "Waiting to sync"; start `wrangler dev` → within 30 s the badge turns into a check. Two app profiles (`APP_PROFILE=dev` / `APP_PROFILE=dev2`) editing the same build → conflict bolt + modal; **Take theirs** replaces the content; **Keep mine** pushes.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/renderer.js src/renderer/modules/sync-status.js src/renderer/modules/state.js src/renderer/modules/utils.js src/renderer/index.html src/renderer/styles.css src/renderer/styles/library.css tests/unit/renderer/sync-badges.test.js
git commit -m "feat(teams-ui): pending/conflict badges, conflict modal, auth banner, detached-team handling"
```

---

### Task 3: Settings → Teams pane

**Files:**
- Modify: `src/renderer/modules/settings-modal.js` (CATEGORIES ≈59, pane HTML ≈115-131, `_el` ≈165-171, listeners ≈185-186, `_open` ≈245-248, section ≈680-760), `src/renderer/styles/settings-modal.css` (≈600-640)
- Test: `tests/unit/settingsModalNav.test.js` (update ids), `tests/unit/settingsModalTeams.test.js`

**Interfaces:**
- Pane id `teams`; element ids: `sm-teams-status`, `sm-teams-off` (enable view), `sm-teams-enable`, `sm-teams-on`, `sm-teams-user`, `sm-team-create-name`, `sm-team-create`, `sm-team-join-code`, `sm-team-join`, `sm-teams-list`, `sm-teams-signout`, `sm-teams-migrate` (filled in Task 6). Settings callbacks used: `refreshLibraryState`, `navigateToPage`, new `onTeamSyncEnabled` (hides the auth banner).

- [ ] **Step 1: Update/write the failing tests**

In `tests/unit/settingsModalNav.test.js` replace `"shared-library"` with `"teams"` in both arrays, and in the "preserves every wired element ID" list replace the `sm-shared-*`/`sm-org-select` ids with `"sm-teams-status", "sm-teams-enable", "sm-team-create", "sm-team-join", "sm-teams-list", "sm-teams-signout"`.

```js
// tests/unit/settingsModalTeams.test.js
/** @jest-environment jsdom */
"use strict";
jest.mock("../../src/renderer/modules/state.js", () => ({ state: { folders: [], teams: [], teamSession: null, outbox: {} } }));
jest.mock("../../src/renderer/modules/custom-select.js", () => ({ renderCustomSelect: jest.fn() }));
jest.mock("../../src/renderer/modules/utils.js", () => ({ escapeHtml: (s) => String(s), delay: () => Promise.resolve(), relativeTime: () => "just now" }));
jest.mock("../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn(async () => true) }));
jest.mock("../../src/renderer/modules/choice-modal.js", () => ({ showChoiceModal: jest.fn() }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("settings-modal — Teams pane", () => {
  let mod, api;
  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = "";
    api = {
      getSession: jest.fn(async () => ({ viewer: { login: "me" } })),
      getTeamSession: jest.fn(async () => null),
      enableTeamSync: jest.fn(async () => ({ login: "me" })),
      disableTeamSync: jest.fn(async () => {}),
      listTeams: jest.fn(async () => []),
      listOutbox: jest.fn(async () => ({})),
      listFolders: jest.fn(async () => []),
      createTeam: jest.fn(async (name) => ({ team: { id: "t1", name, inviteCode: "ABCDEFGHJK" }, role: "owner" })),
      joinTeam: jest.fn(async () => ({ team: { id: "t2", name: "Guild" }, role: "member" })),
      listTeamMembers: jest.fn(async () => [{ userId: "u1", login: "me", role: "owner" }, { userId: "u2", login: "vette", role: "member" }]),
      removeTeamMember: jest.fn(async () => {}),
      rotateInvite: jest.fn(async () => ({ inviteCode: "ZZZZZZZZZZ" })),
      renameTeam: jest.fn(async () => ({})),
      deleteTeam: jest.fn(async () => {}),
      leaveTeam: jest.fn(async () => {}),
      writeClipboardText: jest.fn(async () => {}),
      legacyLibraryStatus: jest.fn(async () => ({ hasLegacy: false })),
      getSetting: jest.fn(async () => null),
      listDiscordWebhooks: jest.fn(async () => []),
      getOnboardingStatus: jest.fn(async () => ({})),
    };
    window.desktopApi = api;
    mod = require("../../src/renderer/modules/settings-modal.js");
    mod.initSettingsModal();
    mod.initSettingsCallbacks({ refreshLibraryState: jest.fn(), navigateToPage: jest.fn(), onTeamSyncEnabled: jest.fn(), refreshOnboardingStatus: jest.fn(), render: jest.fn() });
  });

  test("sync off: shows the enable view; enabling calls enableTeamSync and switches to the on view", async () => {
    mod.openSettingsModal("teams");
    await flush();
    expect(document.getElementById("sm-teams-off").hidden).toBe(false);
    expect(document.getElementById("sm-teams-on").hidden).toBe(true);
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    document.getElementById("sm-teams-enable").click();
    await flush(); await flush();
    expect(api.enableTeamSync).toHaveBeenCalled();
    expect(document.getElementById("sm-teams-on").hidden).toBe(false);
    expect(document.getElementById("sm-teams-user").textContent).toContain("me");
  });

  test("create team shows the invite code and copies it; join calls joinTeam with the trimmed code", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    mod.openSettingsModal("teams");
    await flush();
    document.getElementById("sm-team-create-name").value = "EWW";
    document.getElementById("sm-team-create").click();
    await flush(); await flush();
    expect(api.createTeam).toHaveBeenCalledWith("EWW");
    expect(document.getElementById("sm-teams-status").textContent).toContain("ABCDEFGHJK");
    expect(api.writeClipboardText).toHaveBeenCalledWith("ABCDEFGHJK");
    document.getElementById("sm-team-join-code").value = "  zzzzzzzzzz ";
    document.getElementById("sm-team-join").click();
    await flush(); await flush();
    expect(api.joinTeam).toHaveBeenCalledWith("ZZZZZZZZZZ");
  });

  test("team list: owner sees rotate/rename/delete and member rows with Remove; member sees Leave only", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.listTeams.mockResolvedValue([
      { team: { id: "t1", name: "EWW", inviteCode: "ABCDEFGHJK" }, role: "owner" },
      { team: { id: "t2", name: "Guild" }, role: "member" },
    ]);
    mod.openSettingsModal("teams");
    await flush(); await flush();
    const rows = [...document.querySelectorAll(".sm-team")];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("[data-act='rotate']")).not.toBeNull();
    expect(rows[0].querySelector("[data-act='delete']")).not.toBeNull();
    expect(rows[0].textContent).toContain("ABCDEFGHJK");
    expect(rows[1].querySelector("[data-act='rotate']")).toBeNull();
    expect(rows[1].querySelector("[data-act='leave']")).not.toBeNull();
    rows[0].querySelector("[data-act='members']").click();
    await flush(); await flush();
    expect(api.listTeamMembers).toHaveBeenCalledWith("t1");
    const memberRows = [...rows[0].querySelectorAll(".sm-team__member")];
    expect(memberRows.map((m) => m.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("vette")]));
    memberRows.find((m) => m.textContent.includes("vette")).querySelector("[data-act='remove']").click();
    await flush(); await flush();
    expect(api.removeTeamMember).toHaveBeenCalledWith("t1", "u2");
    rows[0].querySelector("[data-act='rotate']").click();
    await flush(); await flush();
    expect(api.rotateInvite).toHaveBeenCalledWith("t1");
  });

  test("sign out asks for confirmation then calls disableTeamSync", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    mod.openSettingsModal("teams");
    await flush();
    document.getElementById("sm-teams-signout").click();
    await flush(); await flush();
    expect(api.disableTeamSync).toHaveBeenCalled();
  });
});
```

(`openSettingsModal(pane)` — if the existing open function has a different name or no pane argument, add an optional `initialPane` parameter to it and export it; the nav test already calls `initSettingsModal`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/settingsModalNav.test.js tests/unit/settingsModalTeams.test.js --maxWorkers=2` → FAIL.

- [ ] **Step 3: Implement the pane**

`CATEGORIES` entry:
```js
  { id: "teams", label: "Teams", desc: "Share build libraries with your team.", icon: ICON.shared },
```

Pane HTML (replaces the `shared-library` section):
```html
          <section class="settings-modal__pane" data-pane="teams" id="sm-teams-section">
            <span class="settings-modal__error" id="sm-teams-status" aria-live="polite"></span>
            <div id="sm-teams-migrate" hidden></div>
            <div id="sm-teams-off">
              <p class="settings-modal__hint">Teams let a group share build folders. Changes sync in seconds; everyone in the team can edit. Uses your GitHub sign-in.</p>
              <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-teams-enable" type="button">Enable team sync</button>
            </div>
            <div id="sm-teams-on" hidden>
              <div class="settings-modal__shared-info"><span>Signed in as</span> <span class="settings-modal__shared-org" id="sm-teams-user"></span></div>
              <div class="sm-teams-forms">
                <div class="sm-teams-form">
                  <label class="settings-modal__label" for="sm-team-create-name">Create a team</label>
                  <div class="sm-teams-row">
                    <input class="settings-modal__input" id="sm-team-create-name" maxlength="80" placeholder="Team name">
                    <button class="settings-modal__btn" id="sm-team-create" type="button">Create</button>
                  </div>
                </div>
                <div class="sm-teams-form">
                  <label class="settings-modal__label" for="sm-team-join-code">Join with an invite code</label>
                  <div class="sm-teams-row">
                    <input class="settings-modal__input" id="sm-team-join-code" maxlength="10" placeholder="ABCDEFGHJK" autocapitalize="characters">
                    <button class="settings-modal__btn" id="sm-team-join" type="button">Join</button>
                  </div>
                </div>
              </div>
              <div id="sm-teams-list" class="sm-teams-list"></div>
              <button class="settings-modal__btn settings-modal__btn--danger" id="sm-teams-signout" type="button">Sign out of team sync</button>
            </div>
          </section>
```

`_el` additions: `teamsStatus, teamsOff, teamsEnable, teamsOn, teamsUser, teamCreateName, teamCreate, teamJoinCode, teamJoin, teamsList, teamsSignout, teamsMigrate` (by the ids above). Listeners in `init`: `teamsEnable → _enableTeams`, `teamCreate → _createTeam`, `teamJoin → _joinTeam`, `teamsSignout → _signOutTeams`, `teamsList → click delegation on [data-act]`. In `_open`: `_loadTeamsState()`.

Section code (replaces the Shared Library section):

```js
// ─── Teams section ───────────────────────────────────────────────────────────

function _setTeamsStatus(text, isError = false) {
  _el.teamsStatus.textContent = text || "";
  _el.teamsStatus.classList.toggle("settings-modal__error--ok", !isError && !!text);
}

async function _loadTeamsState() {
  if (!_el.teamsOff) return;
  _setTeamsStatus("");
  const session = await window.desktopApi.getTeamSession().catch(() => null);
  _el.teamsOff.hidden = !!session;
  _el.teamsOn.hidden = !session;
  if (!session) {
    const gh = await window.desktopApi.getSession().catch(() => null);
    _el.teamsEnable.disabled = !gh;
    if (!gh) _setTeamsStatus("Log in to GitHub (Publishing) first — team sync uses that sign-in.", true);
    return;
  }
  _el.teamsUser.textContent = session.login;
  await _renderTeamsList();
  _renderLegacyMigration?.(); // Task 6
}

async function _renderTeamsList() {
  const teams = await window.desktopApi.listTeams().catch((err) => { _setTeamsStatus(`Error: ${err.message}`, true); return []; });
  _el.teamsList.innerHTML = teams.length ? teams.map(({ team, role }) => `
    <div class="sm-team" data-team-id="${escapeHtml(team.id)}" data-role="${role}">
      <div class="sm-team__head">
        <span class="sm-team__name">${escapeHtml(team.name)}</span>
        <span class="sm-team__role">${role}</span>
        ${role === "owner" ? `<code class="sm-team__invite" title="Invite code">${escapeHtml(team.inviteCode || "")}</code>
          <button class="settings-modal__btn settings-modal__btn--small" data-act="copy-invite" type="button">Copy</button>
          <button class="settings-modal__btn settings-modal__btn--small" data-act="rotate" type="button" title="Invalidate the old code">Rotate</button>` : ""}
        <button class="settings-modal__btn settings-modal__btn--small" data-act="members" type="button">Members</button>
        ${role === "owner" ? `<button class="settings-modal__btn settings-modal__btn--small" data-act="rename" type="button">Rename</button>
          <button class="settings-modal__btn settings-modal__btn--small settings-modal__btn--danger" data-act="delete" type="button">Delete team</button>`
        : `<button class="settings-modal__btn settings-modal__btn--small settings-modal__btn--danger" data-act="leave" type="button">Leave</button>`}
      </div>
      <div class="sm-team__members" hidden></div>
    </div>`).join("") : `<p class="settings-modal__hint">You're not in any team yet. Create one and share the invite code, or paste a code to join.</p>`;
}

async function _onTeamsListClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const row = btn.closest(".sm-team");
  const teamId = row?.dataset.teamId;
  const memberRow = btn.closest(".sm-team__member");
  const act = btn.dataset.act;
  try {
    if (act === "copy-invite") {
      await window.desktopApi.writeClipboardText(row.querySelector(".sm-team__invite").textContent);
      _setTeamsStatus("Invite code copied.");
    } else if (act === "rotate") {
      if (!(await showConfirmModal({ title: "Rotate invite code?", body: "The old code stops working immediately. Anyone already in the team stays.", confirmLabel: "Rotate", cancelLabel: "Cancel" }))) return;
      const { inviteCode } = await window.desktopApi.rotateInvite(teamId);
      row.querySelector(".sm-team__invite").textContent = inviteCode;
      _setTeamsStatus("New invite code generated.");
    } else if (act === "members") {
      const box = row.querySelector(".sm-team__members");
      if (!box.hidden) { box.hidden = true; return; }
      const members = await window.desktopApi.listTeamMembers(teamId);
      const isOwner = row.dataset.role === "owner";
      box.innerHTML = members.map((m) => `
        <div class="sm-team__member" data-user-id="${escapeHtml(m.userId)}">
          <span>${escapeHtml(m.login)}</span><span class="sm-team__role">${m.role}</span>
          ${isOwner && m.role !== "owner" ? `<button class="settings-modal__btn settings-modal__btn--small settings-modal__btn--danger" data-act="remove" type="button">Remove</button>` : ""}
        </div>`).join("");
      box.hidden = false;
    } else if (act === "remove") {
      const userId = memberRow.dataset.userId;
      const login = memberRow.querySelector("span").textContent;
      if (!(await showConfirmModal({ title: `Remove ${login}?`, body: "They keep their local copies but stop receiving updates.", confirmLabel: "Remove", cancelLabel: "Cancel" }))) return;
      await window.desktopApi.removeTeamMember(teamId, userId);
      memberRow.remove();
    } else if (act === "rename") {
      const name = window.prompt("New team name", row.querySelector(".sm-team__name").textContent);
      if (!name?.trim()) return;
      await window.desktopApi.renameTeam(teamId, name.trim());
      await _renderTeamsList();
      await _callbacks.refreshLibraryState?.();
    } else if (act === "delete") {
      if (!(await showConfirmModal({ title: "Delete this team?", body: "Every member loses the shared folder. Everyone's local copies are kept as personal folders.", confirmLabel: "Delete team", cancelLabel: "Cancel" }))) return;
      await window.desktopApi.deleteTeam(teamId);
      await _renderTeamsList();
      await _callbacks.refreshLibraryState?.();
    } else if (act === "leave") {
      if (!(await showConfirmModal({ title: "Leave this team?", body: "Your local copy of the folder is kept as a personal folder.", confirmLabel: "Leave", cancelLabel: "Cancel" }))) return;
      await window.desktopApi.leaveTeam(teamId);
      await _renderTeamsList();
      await _callbacks.refreshLibraryState?.();
    }
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  }
}

async function _enableTeams() {
  _el.teamsEnable.disabled = true;
  _el.teamsEnable.textContent = "Enabling…";
  try {
    await window.desktopApi.enableTeamSync();
    _callbacks.onTeamSyncEnabled?.();
    await _callbacks.refreshLibraryState?.();
    await _loadTeamsState();
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  } finally {
    _el.teamsEnable.disabled = false;
    _el.teamsEnable.textContent = "Enable team sync";
  }
}

async function _createTeam() {
  const name = _el.teamCreateName.value.trim();
  if (!name) { _setTeamsStatus("Enter a team name.", true); return; }
  _el.teamCreate.disabled = true;
  try {
    const { team } = await window.desktopApi.createTeam(name);
    await window.desktopApi.writeClipboardText(team.inviteCode);
    _setTeamsStatus(`Team "${team.name}" created. Invite code ${team.inviteCode} copied — share it with your team.`);
    _el.teamCreateName.value = "";
    await _renderTeamsList();
    await _callbacks.refreshLibraryState?.();
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  } finally {
    _el.teamCreate.disabled = false;
  }
}

async function _joinTeam() {
  const code = _el.teamJoinCode.value.trim().toUpperCase();
  if (code.length !== 10) { _setTeamsStatus("Invite codes are 10 characters.", true); return; }
  _el.teamJoin.disabled = true;
  try {
    const { team } = await window.desktopApi.joinTeam(code);
    _setTeamsStatus(`Joined "${team.name}". Its folder is in your library.`);
    _el.teamJoinCode.value = "";
    await _renderTeamsList();
    await _callbacks.refreshLibraryState?.();
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  } finally {
    _el.teamJoin.disabled = false;
  }
}

async function _signOutTeams() {
  if (!(await showConfirmModal({ title: "Sign out of team sync?", body: "Team folders stay on this computer but stop syncing until you sign in again.", confirmLabel: "Sign out", cancelLabel: "Cancel" }))) return;
  try {
    await window.desktopApi.disableTeamSync();
    await _callbacks.refreshLibraryState?.();
    await _loadTeamsState();
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  }
}
```

CSS (replace the Shared Library block):
```css
/* ── Teams section ────────────────────────────────────────────────────── */
.sm-teams-forms { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
.sm-teams-row { display: flex; gap: 8px; }
.sm-teams-row .settings-modal__input { flex: 1; }
.sm-teams-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.sm-team { padding: 10px 12px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: var(--radius-sm); font-size: 0.8rem; }
.sm-team__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sm-team__name { font-weight: 700; color: var(--text); }
.sm-team__role { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: .04em; }
.sm-team__invite { font-family: var(--mono, monospace); letter-spacing: .08em; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,.06); }
.sm-team__members { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.sm-team__member { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,.06); }
.settings-modal__btn--small { padding: 3px 8px; font-size: 0.72rem; }
.settings-modal__error--ok { color: var(--text); }
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/settingsModalNav.test.js tests/unit/settingsModalTeams.test.js tests/unit/settingsModalLayout.test.js tests/unit/settingsModalSave.test.js tests/unit/settingsModalDropdown.test.js --maxWorkers=2` → PASS (fix any other settings test that enumerated `shared-library`).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/settings-modal.js src/renderer/styles/settings-modal.css tests/unit/settingsModalNav.test.js tests/unit/settingsModalTeams.test.js
git commit -m "feat(teams-ui): Settings → Teams pane (enable, create/join, members, invite rotation, leave/delete)"
```

---

### Task 4: Library — team badges, "Share to team…", "Stop sharing", "Pull now", guards

**Files:**
- Modify: `src/renderer/modules/library/context-menu.js` (`showFolderMenu` ≈237-295), `sidebar.js:176-188, 237`, `content.js` (the five `lib-shared-badge` sites ≈256, 355, 481, 546, 634), `library.js` (`handleMoveComps` copy ≈1129-1130, `handleDeleteFolder` ≈1297)
- Test: `tests/unit/teamsIpc.test.js` (extend with renderer wiring assertions)

- [ ] **Step 1: Extend the static test**

```js
test("library UI is wired to teams", () => {
  const cm = fs.readFileSync(path.join(__dirname, "../../src/renderer/modules/library/context-menu.js"), "utf8");
  expect(cm).toContain("Share to team…");
  expect(cm).toContain("Stop sharing");
  expect(cm).toContain("Pull now");
  expect(cm).toContain("shareFolderToTeam(");
  expect(cm).toContain("stopSharingFolder(");
  const sb = fs.readFileSync(path.join(__dirname, "../../src/renderer/modules/library/sidebar.js"), "utf8");
  expect(sb).toContain("Team Folders");
  expect(sb).toContain("teamLabel(");
  const ct = fs.readFileSync(path.join(__dirname, "../../src/renderer/modules/library/content.js"), "utf8");
  expect(ct).not.toContain("orgName");
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

`context-menu.js` — imports: `import { shareFolderToTeam, stopSharingFolder, pullTeamFor } from "./folder-store.js"; import { isTeamOwner, teamRootFor } from "../teams.js"; import { showChoiceModal } from "../choice-modal.js"; import { showToast } from "./library.js";` (if `showToast` import would be circular, pass it through `_callbacks.onToast` — follow whatever `library.js` already does for other menus).

Replace the `...(isShared ? […] : hasSharedLibrary ? […] : [])` block in `showFolderMenu` with:

```js
    ...(function teamItems() {
      const root = teamRootFor(folderId);
      const isRoot = root && root.id === folderId;
      if (root) {
        return [
          _item(shareIcon, "Pull now", null, async () => { await pullTeamFor(folderId); _callbacks.onRefresh?.(); }),
          ...(!isRoot && isTeamOwner(folderId) ? [
            _item(trashIcon, "Stop sharing", null, async () => {
              const ok = await showConfirmModal({
                title: "Stop sharing this folder?",
                body: `<strong>${escapeHtml(folder?.name || folderId)}</strong> and everything in it will be removed from the team. Your copy becomes a personal folder; teammates lose it.`,
                confirmLabel: "Stop sharing", cancelLabel: "Cancel",
              });
              if (!ok) return;
              try { await stopSharingFolder(folderId); } catch (err) { showToast(err.message, "error"); }
              _callbacks.onRefresh?.();
            }, true),
          ] : []),
        ];
      }
      if (!state.teamSession || !state.teams?.length) return [];
      return [
        _item(shareIcon, "Share to team…", null, async () => {
          let teamId = state.teams[0].team.id;
          if (state.teams.length > 1) {
            teamId = await showChoiceModal({
              title: "Share to which team?",
              body: `Share <strong>${escapeHtml(folder?.name || folderId)}</strong> and everything in it.`,
              choices: state.teams.map(({ team }) => ({ id: team.id, label: team.name })),
            });
            if (!teamId) return;
          } else {
            const ok = await showConfirmModal({
              title: `Share to ${escapeHtml(state.teams[0].team.name)}?`,
              body: `<strong>${escapeHtml(folder?.name || folderId)}</strong> and all builds and comps inside it will be visible and editable by everyone in the team.`,
              confirmLabel: "Share", cancelLabel: "Cancel",
            });
            if (!ok) return;
          }
          try {
            const { uploaded, failed } = await shareFolderToTeam(folderId, teamId);
            showToast(failed.length ? `Shared ${uploaded} items; ${failed.length} failed: ${failed.map((f) => f.message).join("; ")}` : `Shared ${uploaded} items to the team.`, failed.length ? "warning" : "success");
          } catch (err) {
            showToast(err.message, "error");
          }
          _callbacks.onRefresh?.();
        }),
      ];
    })(),
```

Also guard the existing **Delete Folder** item: when `teamRootFor(folderId)?.id === folderId`, replace it with a disabled item `_item(trashIcon, "Delete Folder", null, null, true, "Leave or delete the team in Settings → Teams")`.

`sidebar.js:176-188`: rename the section label to `Team Folders`; `:237` badge → `${folder.teamId ? `<span class="lib-nav-item__shared-badge" title="${escapeHtml(teamLabel(folder))}">${shareIcon}</span>` : ""}` (import `teamLabel` from `../teams.js`).

`content.js` — each of the five badge sites: `f.shared ? … "Shared with ${f.orgName}"` → `f.teamId ? `<span class="lib-shared-badge …" title="${escapeHtml(teamLabel(f))}">${shareIcon}</span>` : ""`.

`library.js`: `handleMoveComps` copy → title `"Move builds into the team folder?"`, body `"…will also be moved into the team folder so they stay in sync for everyone."`; `handleDeleteFolder`: if `teamRootFor(folderId)?.id === folderId` → `showToast("Leave or delete the team in Settings → Teams.", "info")` and return.

- [ ] **Step 4: Run the static test + renderer unit suites** → PASS.

- [ ] **Step 5: Manual check** — right-click a personal folder → "Share to team…" uploads (progress toast); right-click a team sub-folder as owner → "Stop sharing"; as member → no "Stop sharing"; team root → "Delete Folder" disabled with tooltip.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/library tests/unit/teamsIpc.test.js
git commit -m "feat(teams-ui): library share-to-team / stop-sharing / pull-now and team badges"
```

---

### Task 5: Publish-by-other confirmation

**Files:**
- Modify: `src/preload/index.js:31, 48`, `src/renderer/modules/render-pages.js:285`, `src/renderer/modules/comps/comp-detail.js:1229`
- Test: `tests/unit/renderer/publish-by-other.test.js`

**Interfaces:**
- `preload`: `publishBuild: (buildId, opts) => invoke("builds:publish-build", buildId, opts || {})`, `publishComp: (compId, html, opts) => invoke("comps:publish-comp", compId, html, opts || {})`.
- New helper in `src/renderer/modules/publish-guard.js`: `publishWithOwnerCheck(invoke, confirm) → Promise<result|null>` — calls `invoke({})`; on an error whose message starts with `PUBLISHED_BY_OTHER:`, asks `confirm(login)`; if confirmed calls `invoke({ force: true })`, else returns `null`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/renderer/publish-by-other.test.js
"use strict";
const { publishWithOwnerCheck } = require("../../../src/renderer/modules/publish-guard.js");

test("passes through on success", async () => {
  const invoke = jest.fn(async () => ({ pagesUrl: "u" }));
  expect(await publishWithOwnerCheck(invoke, jest.fn())).toEqual({ pagesUrl: "u" });
  expect(invoke).toHaveBeenCalledWith({});
});

test("asks, then forces when confirmed; returns null when declined", async () => {
  const invoke = jest.fn(async (opts) => { if (!opts.force) throw new Error("PUBLISHED_BY_OTHER:vette"); return { pagesUrl: "new" }; });
  const confirm = jest.fn(async () => true);
  expect(await publishWithOwnerCheck(invoke, confirm)).toEqual({ pagesUrl: "new" });
  expect(confirm).toHaveBeenCalledWith("vette");
  expect(invoke).toHaveBeenLastCalledWith({ force: true });
  confirm.mockResolvedValue(false);
  invoke.mockClear();
  expect(await publishWithOwnerCheck(invoke, confirm)).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("other errors propagate", async () => {
  await expect(publishWithOwnerCheck(async () => { throw new Error("boom"); }, jest.fn())).rejects.toThrow("boom");
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```js
// src/renderer/modules/publish-guard.js
const PREFIX = "PUBLISHED_BY_OTHER:";

/**
 * Team items publish under whoever clicks Publish. If someone else published
 * this item before, warn that a new link will be created (the old one stays
 * but stops updating) and only proceed with explicit consent.
 */
export async function publishWithOwnerCheck(invoke, confirm) {
  try {
    return await invoke({});
  } catch (err) {
    const msg = String(err?.message || "");
    if (!msg.startsWith(PREFIX)) throw err;
    const login = msg.slice(PREFIX.length);
    if (!(await confirm(login))) return null;
    return invoke({ force: true });
  }
}

export function publishedByOtherBody(login) {
  return `This was published by <strong>${login}</strong>. Publishing from your account creates a new link; the old one keeps working but won't update.`;
}
```

`render-pages.js:285`:
```js
        const result = await publishWithOwnerCheck(
          (opts) => window.desktopApi.publishBuild(build.id, opts),
          (login) => showConfirmModal({ title: "Publish under your account?", body: publishedByOtherBody(escapeHtml(login)), confirmLabel: "Publish anyway", cancelLabel: "Cancel" }),
        );
        if (!result) { delete state.publishProgress[build.id]; hidePublishProgress?.(build.id); return; }
```
(If there is no `hidePublishProgress`, reset the button state the same way the `finally` block does and `renderBuildList()`.) Same pattern in `comp-detail.js:1229` with `publishComp(comp.id, boonCoverageHtml, opts)`.

Preload: update the two bindings to forward `opts`.

- [ ] **Step 4: Run** `npx jest tests/unit/renderer/publish-by-other.test.js tests/unit/renderer/publish-progress.test.js --maxWorkers=2` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/publish-guard.js src/renderer/modules/render-pages.js src/renderer/modules/comps/comp-detail.js src/preload/index.js tests/unit/renderer/publish-by-other.test.js
git commit -m "feat(teams-ui): confirm before re-publishing an item a teammate published"
```

---

### Task 6: Migration — `migrateOrgLibrary`, legacy status, Settings action, orphan banner, cleanup

**Files:**
- Modify: `src/main/teamSync.js` (add `migrateOrgLibrary`, `legacyStatus`), `src/main/index.js` (IPC `teams:migrate-org-library`, `teams:legacy-status`; startup cleanup), `src/preload/index.js`, `src/renderer/modules/settings-modal.js` (`_renderLegacyMigration`), `src/renderer/modules/library/content.js` (orphan banner in folder view), `src/renderer/styles/library.css`
- Test: `tests/unit/teamSync.migration.test.js`, `tests/unit/teamsIpc.test.js` (extend)

**Interfaces:**
- `TeamSync.legacyStatus() → { hasLegacy: boolean, orgName: string|null, folders: [{ id, name, builds, comps }] }` — `hasLegacy` when `auth.sharedLibrary?.orgName` exists **or** any folder has `orgName` and no `teamId`.
- `TeamSync.migrateOrgLibrary({ teamId?: string, teamName?: string }, onProgress?) → { teamId, uploaded, failed, foldersMigrated }`.
- Preload: `legacyLibraryStatus()`, `migrateOrgLibrary(opts)`; event `team-share-progress` reused.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/teamSync.migration.test.js
"use strict";
const { makeHarness } = require("../helpers/teamSyncHarness");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

async function seedLegacy(h, { roots = 1 } = {}) {
  const auth = await h.buildStore.getAuth();
  await h.buildStore.saveAuth({ ...auth, sharedLibrary: { orgName: "gw2eww", repoName: "axibuilds-shared", isOwner: true } });
  for (let r = 0; r < roots; r++) {
    await h.folderStore.upsertFolder({ id: `root${r}`, name: `Root ${r}`, shared: true, orgName: "gw2eww" });
    await h.folderStore.upsertFolder({ id: `root${r}-sub`, name: "Sub", parentId: `root${r}` });
    await h.buildStore.upsertBuild({ id: `b${r}`, title: `B${r}`, folderId: `root${r}-sub` });
    await h.compStore.upsertComp({ id: `c${r}`, name: `C${r}`, folderId: `root${r}` });
  }
  await h.syncStore.setShas?.(`root0`, {}); // legacy state may or may not exist
}

describe("TeamSync — migration", () => {
  test("legacyStatus reports org folders with counts; false when nothing legacy", async () => {
    h = await makeHarness();
    expect((await h.sync.legacyStatus()).hasLegacy).toBe(false);
    await seedLegacy(h);
    const s = await h.sync.legacyStatus();
    expect(s).toEqual({ hasLegacy: true, orgName: "gw2eww", folders: [{ id: "root0", name: "Root 0", builds: 1, comps: 1 }] });
  });

  test("single root: team id = root folder id; items keep ids; folder flipped; auth.sharedLibrary cleared", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockImplementation(async (name) => ({ team: { id: "server-generated", name, inviteCode: "ABCDEFGHJK", seq: 0 }, role: "owner" }));
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) }));
    const out = await h.sync.migrateOrgLibrary({ teamName: "gw2eww" });
    // createTeam is asked to reuse the root folder id so members re-link in place
    expect(h.api.createTeam).toHaveBeenCalledWith("gw2eww", { id: "root0" });
    expect(out.foldersMigrated).toBe(1);
    expect(out.failed).toEqual([]);
    const ids = h.api.bulk.mock.calls.flatMap(([, items]) => items.map((i) => [i.itemId, i.type, i.parentId]));
    expect(ids).toEqual(expect.arrayContaining([["root0-sub", "folder", null], ["b0", "build", "root0-sub"], ["c0", "comp", null]]));
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root).toMatchObject({ shared: true, teamId: out.teamId, role: "owner" });
    expect(root.orgName).toBeUndefined();
    expect((await h.buildStore.getAuth()).sharedLibrary).toBeUndefined();
  });

  test("multiple roots into an existing team: each root becomes a folder item under the team root", async () => {
    h = await makeHarness();
    await seedLegacy(h, { roots: 2 });
    await h.folderStore.upsertFolder({ id: "team-x", name: "X", shared: true, teamId: "team-x", role: "owner" });
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) }));
    const out = await h.sync.migrateOrgLibrary({ teamId: "team-x" });
    expect(h.api.createTeam).not.toHaveBeenCalled();
    expect(out.foldersMigrated).toBe(2);
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === "root0")).toMatchObject({ parentId: "team-x" });
    expect(folders.find((f) => f.id === "root1")).toMatchObject({ parentId: "team-x" });
    expect(folders.find((f) => f.id === "root0").teamId).toBeUndefined();
    const rootItems = h.api.bulk.mock.calls.flatMap(([, items]) => items).filter((i) => i.itemId === "root0" || i.itemId === "root1");
    expect(rootItems.map((i) => i.parentId)).toEqual([null, null]);
  });

  test("partial failure: folder not flipped, auth kept, failures reported", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" });
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => it.itemId === "b0" ? { itemId: "b0", status: 413, message: "too large" } : { itemId: it.itemId, status: 201, version: 1, seq: 1 }) }));
    const out = await h.sync.migrateOrgLibrary({ teamName: "gw2eww" });
    expect(out.failed).toEqual([{ itemId: "b0", status: 413, message: "too large" }]);
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root.teamId).toBeUndefined();
    expect((await h.buildStore.getAuth()).sharedLibrary).toBeDefined();
  });
});
```

This requires `SyncApi.createTeam(name, { id })` to pass an optional client-chosen id, and the Worker to accept it. **Plan 1 addendum (apply with this task):** in `workers/sync/src/teams.js` `createTeam`, accept `body.id` when it is a UUID-shaped string (`/^[0-9a-f-]{36}$/i`) not already used by another team (409 `conflict` if taken); add a Worker test `"create with a client-supplied id uses it; duplicate → 409"`. In `src/main/syncApi.js`: `createTeam(name, opts = {}) { return this.#request("POST", "/teams", { body: { name, ...(opts.id ? { id: opts.id } : {}) } }); }` and a `syncApi.test.js` case asserting the body.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement — `teamSync.js`**

```js
  // ─── Migration from the GitHub-org shared library ───────────────────────────

  async legacyStatus() {
    const auth = await this.buildStore.getAuth();
    const folders = await this.folderStore.listFolders();
    const legacyRoots = folders.filter((f) => f.orgName && !f.teamId && !f.parentId);
    const orgName = (auth.sharedLibrary && auth.sharedLibrary.orgName) || (legacyRoots[0] && legacyRoots[0].orgName) || null;
    if (!legacyRoots.length && !(auth.sharedLibrary && auth.sharedLibrary.orgName)) return { hasLegacy: false, orgName: null, folders: [] };
    const builds = await this.buildStore.listBuilds();
    const comps = await this.compStore.listComps();
    return {
      hasLegacy: true,
      orgName,
      folders: legacyRoots.map((r) => {
        const tree = new Set(this.collectFolderTree(r.id, folders));
        return { id: r.id, name: r.name, builds: builds.filter((b) => tree.has(b.folderId)).length, comps: comps.filter((c) => tree.has(c.folderId)).length };
      }),
    };
  }

  async migrateOrgLibrary({ teamId = null, teamName = null } = {}, onProgress) {
    const session = await this.getSession();
    if (!session) throw new Error("Enable team sync first.");
    const status = await this.legacyStatus();
    if (!status.hasLegacy) throw new Error("Nothing to migrate.");
    const roots = status.folders;
    let folders = await this.folderStore.listFolders();

    // Single root + new team → reuse the root folder id as the team id so
    // teammates' existing local folders re-link in place when they join.
    let targetTeamId = teamId;
    let rootIsTeam = false;
    if (!targetTeamId) {
      const reuseId = roots.length === 1 ? roots[0].id : undefined;
      const out = await this.api.createTeam(teamName || status.orgName || "My team", reuseId ? { id: reuseId } : {});
      targetTeamId = out.team.id;
      rootIsTeam = reuseId === targetTeamId;
      if (rootIsTeam) {
        const r = roots[0];
        const old = folders.find((f) => f.id === r.id);
        await this.folderStore.upsertFolder({ id: r.id, name: old.name, parentId: null, sortOrder: old.sortOrder, shared: true, teamId: targetTeamId, role: "owner", orgName: undefined, lastSyncedAt: undefined });
      } else {
        await this._ensureRootFolder(out.team, out.role);
      }
      folders = await this.folderStore.listFolders();
    }
    const teamRoot = this.rootFolderForTeam(targetTeamId, folders);
    if (!teamRoot) throw new Error("Team root folder not found.");

    const failed = [];
    let uploaded = 0;
    let done = 0;
    for (const r of roots) {
      // Temporarily make the legacy root "look" personal so shareFolderToTeam's
      // guards pass; for the rootIsTeam case upload its *children* instead.
      if (rootIsTeam && r.id === teamRoot.id) {
        const children = folders.filter((f) => f.parentId === r.id);
        const builds = (await this.buildStore.listBuilds()).filter((b) => b.folderId === r.id);
        const comps = (await this.compStore.listComps()).filter((c) => c.folderId === r.id);
        const items = [
          ...builds.map((b) => ({ itemId: b.id, type: "build", parentId: null, body: TeamSync.buildBody(b), baseVersion: null })),
          ...comps.map((c) => ({ itemId: c.id, type: "comp", parentId: null, body: TeamSync.compBody(c), baseVersion: null })),
        ];
        const res = await this._bulkUpload(targetTeamId, items, session);
        uploaded += res.uploaded; failed.push(...res.failed);
        for (const child of children) {
          const res2 = await this.shareFolderToTeam(child.id, targetTeamId, onProgress);
          uploaded += res2.uploaded; failed.push(...res2.failed);
        }
      } else {
        await this.folderStore.upsertFolder({ id: r.id, name: r.name, parentId: null, shared: false, orgName: undefined, lastSyncedAt: undefined });
        const res = await this.shareFolderToTeam(r.id, targetTeamId, onProgress);
        uploaded += res.uploaded; failed.push(...res.failed);
      }
      done += 1;
      if (onProgress) onProgress({ foldersDone: done, foldersTotal: roots.length });
    }

    if (!failed.length) {
      const auth = await this.buildStore.getAuth();
      const next = { ...auth };
      delete next.sharedLibrary;
      await this.buildStore.saveAuth(next);
      for (const f of await this.folderStore.listFolders()) {
        if (f.orgName) await this.folderStore.upsertFolder({ id: f.id, name: f.name, parentId: f.parentId, sortOrder: f.sortOrder, orgName: undefined, lastSyncedAt: undefined });
      }
    }
    return { teamId: targetTeamId, uploaded, failed, foldersMigrated: roots.length };
  }

  async _bulkUpload(teamId, items, session) {
    const failed = [];
    for (let i = 0; i < items.length; i += 50) {
      const { results } = await this.api.bulk(teamId, items.slice(i, i + 50));
      for (const r of results) {
        if (r.status === 200 || r.status === 201) await this.syncStore.setVersion(teamId, r.itemId, { version: r.version, createdBy: session.userId });
        else failed.push({ itemId: r.itemId, status: r.status, message: r.message || "Rejected." });
      }
    }
    return { uploaded: items.length - failed.length, failed };
  }
```

`FolderStore.upsertFolder` must accept `orgName: undefined` to mean "leave as is" and clear via a dedicated `clearLegacyFields(id)`; if clearing via `undefined` is awkward, add `clearLegacyFields(id)` to `FolderStore` (deletes `orgName`, `lastSyncedAt`) and call it from the two places above (test it in `folderStore.test.js`: `"clearLegacyFields removes orgName/lastSyncedAt"`). Use `shareFolderToTeam` from Plan 2 Task 7 unchanged (it rejects team roots, hence the `shared:false` reset first). In the partial-failure test the single root was created with `rootIsTeam` and flipped before upload — to satisfy "folder not flipped on failure", perform the flip **after** a successful upload: move the `upsertFolder({ … teamId … })` for the `rootIsTeam` case to after the loop, guarded by `!failed.length`, and on failure call `this.api.deleteTeam(targetTeamId).catch(() => {})` only when this call created the team.

Refactor `shareFolderToTeam`'s bulk loop to call `_bulkUpload` so both paths share it.

- [ ] **Step 4: Implement — IPC, preload, startup cleanup**

`index.js`:
```js
  handle("teams:legacy-status", () => teamSync.legacyStatus());
  handle("teams:migrate-org-library", (_e, opts) =>
    teamSync.migrateOrgLibrary(opts || {}, (p) => _e.sender.send("team-share-progress", { migration: true, ...p })));
```
Preload: `legacyLibraryStatus: () => ipcRenderer.invoke("teams:legacy-status")`, `migrateOrgLibrary: (opts) => ipcRenderer.invoke("teams:migrate-org-library", opts)`.

Startup (after `teamSync.startPolling()`): nothing destructive — legacy folders stay until migrated or until a member joins the team (Plan 2's `_ensureRootFolder` re-links by id and clears `orgName` when it calls `upsertFolder` with `orgName: undefined` — make sure it passes `orgName: undefined` explicitly, or call `clearLegacyFields`).

- [ ] **Step 5: Implement — Settings action and orphan banner**

`settings-modal.js`:
```js
async function _renderLegacyMigration() {
  const box = _el.teamsMigrate;
  const status = await window.desktopApi.legacyLibraryStatus().catch(() => ({ hasLegacy: false }));
  box.hidden = !status.hasLegacy;
  if (!status.hasLegacy) return;
  const counts = status.folders.map((f) => `${escapeHtml(f.name)} (${f.builds} builds, ${f.comps} comps)`).join(", ");
  box.innerHTML = `
    <div class="sm-migrate">
      <strong>Move your GitHub org library to a team.</strong>
      <p class="settings-modal__hint">Shared folders from <strong>${escapeHtml(status.orgName || "your org")}</strong> — ${counts} — will be uploaded to a team you own. Teammates join with the invite code. The GitHub repo is left untouched.</p>
      <div class="sm-teams-row">
        <button class="settings-modal__btn" id="sm-migrate-new" type="button">Create team "${escapeHtml(status.orgName || "My team")}" and migrate</button>
        <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-migrate-existing" type="button">Migrate into existing team…</button>
      </div>
    </div>`;
  box.querySelector("#sm-migrate-new").addEventListener("click", () => _runMigration({ teamName: status.orgName }));
  box.querySelector("#sm-migrate-existing").addEventListener("click", async () => {
    const teams = await window.desktopApi.listTeams();
    const teamId = await showChoiceModal({ title: "Migrate into which team?", body: "", choices: teams.map(({ team }) => ({ id: team.id, label: team.name })) });
    if (teamId) _runMigration({ teamId });
  });
}

async function _runMigration(opts) {
  _setTeamsStatus("Migrating…");
  try {
    const out = await window.desktopApi.migrateOrgLibrary(opts);
    _setTeamsStatus(out.failed.length
      ? `Migrated with ${out.failed.length} failures: ${out.failed.map((f) => f.message).join("; ")}`
      : `Migrated ${out.foldersMigrated} folder(s), ${out.uploaded} items. Share the invite code from the team list below.`, out.failed.length > 0);
    await _renderTeamsList();
    await _renderLegacyMigration();
    await _callbacks.refreshLibraryState?.();
  } catch (err) {
    _setTeamsStatus(`Error: ${err.message}`, true);
  }
}
```
Wire `onTeamShareProgress` once in `init` to update `_setTeamsStatus(\`Uploading ${p.done}/${p.total}…\`)` when `p.migration`.

Orphan banner (`content.js`, top of the folder view when `folder.orgName && !folder.teamId && !teamRootFor(folder.id)`):
```html
<div class="lib-banner lib-banner--info">This library moved to Teams — join with the owner's invite code. <button class="lib-banner__btn" data-open-settings="teams">Open Teams</button></div>
```
with a click handler that calls `_callbacks.openSettings?.("teams")` (library already has a settings callback for the Discord gate; reuse it). CSS: `.lib-banner { padding: 8px 12px; border-radius: var(--radius-sm); background: rgba(240,178,50,.12); color: #f5d78e; font-size: .8rem; margin-bottom: 8px; }`.

- [ ] **Step 6: Run** `npx jest tests/unit/teamSync.migration.test.js tests/unit/teamSync*.test.js tests/unit/worker-sync-teams.test.js tests/unit/syncApi.test.js tests/unit/settingsModalTeams.test.js --maxWorkers=2` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/teamSync.js src/main/index.js src/main/syncApi.js src/main/folderStore.js src/preload/index.js workers/sync/src/teams.js src/renderer/modules/settings-modal.js src/renderer/modules/library/content.js src/renderer/styles/library.css tests/unit/teamSync.migration.test.js tests/unit/worker-sync-teams.test.js tests/unit/syncApi.test.js tests/unit/folderStore.test.js
git commit -m "feat(teams): one-click migration of GitHub-org libraries, orphan banner, legacy cleanup"
```

---

### Task 7: E2E — Settings → Teams against a mock sync server

**Files:**
- Create: `tests/e2e/mock-sync-server.js`, `tests/e2e/specs/teams.spec.js`
- Modify: `tests/e2e/helpers/app.js` (pass `AXIFORGE_SYNC_BASE`), `tests/e2e/global-setup.js`, `tests/e2e/global-teardown.js`

- [ ] **Step 1: Mock server**

```js
// tests/e2e/mock-sync-server.js
// Minimal in-memory stand-in for /api/sync: login, teams, items, changes.
const http = require("http");
const PORT = 9878;
let server;
const db = { teams: new Map(), items: new Map(), seq: new Map() };

function json(res, status, body) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s ? JSON.parse(s) : {})); }); }

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname.replace(/^\/api\/sync/, "");
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
  if (req.method === "POST" && p === "/auth/github") return json(res, 200, { sessionToken: "e2e-session", user: { id: "u1", login: "e2e", displayName: "E2E", avatarUrl: null } });
  if (!/^Bearer e2e-session$/.test(req.headers.authorization || "")) return json(res, 401, { error: { code: "unauthorized", message: "no" } });
  if (req.method === "POST" && p === "/teams") {
    const team = { id: body.id || `team-${db.teams.size + 1}`, name: body.name, inviteCode: "ABCDEFGHJK", seq: 0, createdAt: new Date().toISOString() };
    db.teams.set(team.id, team); db.items.set(team.id, new Map()); db.seq.set(team.id, 0);
    return json(res, 201, { team, role: "owner" });
  }
  if (req.method === "GET" && p === "/teams") return json(res, 200, [...db.teams.values()].map((team) => ({ team, role: "owner" })));
  let m;
  if ((m = p.match(/^\/teams\/([^/]+)\/members$/)) && req.method === "GET") return json(res, 200, [{ userId: "u1", login: "e2e", displayName: "E2E", avatarUrl: null, role: "owner", joinedAt: "" }]);
  if ((m = p.match(/^\/teams\/([^/]+)\/changes$/))) {
    const since = Number(url.searchParams.get("since") || 0);
    const items = [...(db.items.get(m[1]) || new Map()).values()].filter((i) => i.seq > since).sort((a, b) => a.seq - b.seq);
    return json(res, 200, { items, nextSeq: items.length ? items[items.length - 1].seq : since, hasMore: false });
  }
  if ((m = p.match(/^\/teams\/([^/]+)\/items\/([^/]+)$/)) && req.method === "PUT") {
    const [, teamId, id] = m;
    const seq = (db.seq.get(teamId) || 0) + 1; db.seq.set(teamId, seq);
    const existing = db.items.get(teamId).get(id);
    const version = existing ? existing.version + 1 : 1;
    db.items.get(teamId).set(id, { id, type: body.type, parentId: body.parentId, body: body.body, version, seq, deleted: false, createdBy: { userId: "u1", login: "e2e" }, updatedBy: { userId: "u1", login: "e2e" }, updatedAt: new Date().toISOString() });
    return json(res, existing ? 200 : 201, { version, seq });
  }
  return json(res, 404, { error: { code: "not_found", message: p } });
}

function start() { return new Promise((r) => { server = http.createServer((req, res) => handle(req, res).catch((e) => json(res, 500, { error: { code: "internal", message: e.message } }))); server.listen(PORT, r); }); }
function stop() { return new Promise((r) => (server ? server.close(r) : r())); }
function reset() { db.teams.clear(); db.items.clear(); db.seq.clear(); }
function putCount(teamId) { return (db.items.get(teamId) || new Map()).size; }
module.exports = { start, stop, reset, putCount, PORT };
```

`global-setup.js` / `global-teardown.js`: also start/stop `mock-sync-server`. `helpers/app.js` `launchApp`: add `AXIFORGE_SYNC_BASE: \`http://localhost:${SYNC_PORT}/api/sync\`` to `env` (import `PORT` as `SYNC_PORT`), and accept an optional `env` override param so a test can point at an unreachable port.

- [ ] **Step 2: Spec**

```js
// tests/e2e/specs/teams.spec.js
const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { seedSettingsFile } = require("../helpers/data");
const path = require("path");
const fs = require("fs");
const { DATA_DIR } = require("../helpers/app");

function seedGithubAuth() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "auth.json"), JSON.stringify({ token: "gh-e2e", viewer: { login: "e2e" } }));
}

test.describe("Teams", () => {
  test("enable → create team → root folder appears; saving into it syncs", async () => {
    const { app, window } = await launchApp();
    seedGithubAuth();
    await window.evaluate(() => desktopApi.enableTeamSync());
    await window.evaluate(() => desktopApi.createTeam("E2E Team"));
    await window.click("[data-page='library']");
    await expect(window.locator(".lib-sidebar__section-label", { hasText: "Team Folders" })).toBeVisible();
    await expect(window.locator("[data-navigate-folder]", { hasText: "E2E Team" })).toBeVisible();
    const folderId = await window.evaluate(async () => (await desktopApi.listFolders()).find((f) => f.teamId).id);
    await window.evaluate((fid) => desktopApi.saveBuild({ title: "Synced build", profession: "Warrior", folderId: fid }), folderId);
    // outbox flush (1s debounce) → PUT lands on the mock server; badge settles to synced
    await expect.poll(async () => window.evaluate(async () => Object.values(await desktopApi.listOutbox()).flat().length), { timeout: 10_000 }).toBe(0);
    await closeApp(app);
  });

  test("unreachable server → pending badge, outbox retained across restart", async () => {
    let { app, window } = await launchApp({ env: { AXIFORGE_SYNC_BASE: "http://localhost:1/api/sync" } });
    seedGithubAuth();
    // Pre-seed a team root + session directly (server is down, so do it via files)
    await closeApp(app);
    const auth = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "auth.json")));
    auth.sync = { sessionToken: "e2e-session", userId: "u1", login: "e2e" };
    fs.writeFileSync(path.join(DATA_DIR, "auth.json"), JSON.stringify(auth));
    fs.writeFileSync(path.join(DATA_DIR, "folders.json"), JSON.stringify([{ id: "t1", name: "Offline Team", parentId: null, sortOrder: 0, shared: true, teamId: "t1", role: "owner", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]));
    ({ app, window } = await launchApp({ clean: false, env: { AXIFORGE_SYNC_BASE: "http://localhost:1/api/sync" } }));
    await window.evaluate(() => desktopApi.saveBuild({ title: "Offline build", profession: "Warrior", folderId: "t1" }));
    await window.click("[data-page='library']");
    await window.click("[data-navigate-folder='t1']");
    await expect(window.locator(".lib-content-sync-indicator--pending")).toBeVisible({ timeout: 10_000 });
    await closeApp(app);
    ({ app, window } = await launchApp({ clean: false, env: { AXIFORGE_SYNC_BASE: "http://localhost:1/api/sync" } }));
    const outbox = await window.evaluate(() => desktopApi.listOutbox());
    expect(Object.values(outbox).flat().length).toBe(1);
    await closeApp(app);
  });
});
```

Adjust the selectors to the real ones (`[data-page='library']` is used elsewhere in the e2e suite; confirm with `grep -rn "data-page" tests/e2e/specs | head`).

- [ ] **Step 3: Run** `npm run test:e2e -- tests/e2e/specs/teams.spec.js` → PASS (note: the build-enrich paths need the GW2 mock server, which global-setup already starts).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/mock-sync-server.js tests/e2e/specs/teams.spec.js tests/e2e/helpers/app.js tests/e2e/global-setup.js tests/e2e/global-teardown.js
git commit -m "test(e2e): Teams — create/sync and offline pending outbox"
```

---

### Task 8: Release notes draft and docs

**Files:**
- Modify: `RELEASE_NOTES.md` (new top section, version placeholder filled by the release skill), `workers/sync/README.md` (link from root `README.md`)

- [ ] **Step 1: Add the notes (unreleased)**

```markdown
## Unreleased

### Teams replace GitHub-org shared libraries

- **Share folders with a team, no GitHub org needed.** Settings → Teams: enable with your GitHub sign-in, create a team, share the 10-character invite code. Every member can edit; changes sync in seconds.
- **Nothing is lost offline.** Edits made while offline show a clock badge and sync automatically when you're back — across restarts too.
- **Conflicts are yours to settle.** If two people edit the same build, you choose *Keep mine* or *Take theirs* instead of one silently overwriting the other.
- **Moving from an org library:** owners open Settings → Teams → *Move your GitHub org library to a team*; members join with the invite code and their existing folder re-links in place. The old GitHub repo is left untouched.
- Team builds publish under the account of whoever clicks Publish; re-publishing someone else's build asks first.

### Reliability

- Publishing no longer overwrites edits you make while it's running, and two people publishing at once can no longer knock each other's links offline.
- Library files are written atomically with a rolling backup and a daily snapshot (`data/backups/`), so a crash or corrupt file can't wipe your builds.
```

- [ ] **Step 2: Commit**

```bash
git add RELEASE_NOTES.md README.md
git commit -m "docs: release notes for Teams and reliability work"
```

Do **not** run the release skill or push — per `feedback_no_release_without_approval`.

---

## Self-review

**Spec coverage:** §2.5 conflict modal wording/buttons/dismiss → T2 (modal) + T1 (choice modal); §2.8 warning copy → T5; §3 Settings (enable, create/join, members, remove, leave, rotate, rename, delete, sign out) → T3; library badges/tooltips/context actions/`pending`/`conflict` statuses, 60-s stuck timer kept, editor badge unchanged → T2/T4; preload names → Plan 2 T8 + T6 here; local API untouched (none proxied shared-library); §4 migration incl. id reuse, multi-root, orphan banner, cleanup, partial failure → T6; §5 offline/auth/detached/pull-failure UX → T2; §6 unit + e2e → T1–T7; §7 release notes → T8. The `online` trigger from Plan 2's self-review → T2.

**Placeholder scan:** the e2e spec notes that two selectors must be confirmed against the suite (`data-page`, the library nav) — that's a verification step, not a TBD. `hidePublishProgress?.()` in T5 is explicitly conditional with the fallback described.

**Type consistency:** `state.teams` shape `[{ team, role }]` is what `listTeams` returns (Plan 2 T4) and what T3/T4 render; `state.outbox` is `teamId → entries[]` from `teams:outbox` (Plan 2 T8) and seeds badges in T2; `resolveConflict(teamId, itemId, choice)` matches Plan 2 T7; `shareFolderToTeam → { uploaded, failed }` matches Plan 2 T7 and is reused by `migrateOrgLibrary` (T6); `createTeam(name, { id })` addendum is applied to Worker, `SyncApi`, and `TeamSync.migrateOrgLibrary` together in T6.
