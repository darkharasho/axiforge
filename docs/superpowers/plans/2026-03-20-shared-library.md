# Shared Build Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable collaborative build/comp sharing across Axiforge installs via a private GitHub org repo with optimistic locking.

**Architecture:** A new `SyncStore` module manages sync state (`syncState.json`) and orchestrates pull/push via the GitHub REST API. The existing `FolderStore` schema is extended with `shared`, `orgName`, `lastSyncedAt` fields. Shared builds/comps live in the same `builds.json`/`comps.json` as personal data, distinguished by `folderId`. A background poll timer and event-driven triggers keep data in sync.

**Tech Stack:** Electron IPC, GitHub REST API (existing `apiFetch` from `githubApi.js`), Node.js `fs/promises`, `crypto`

**Spec:** `docs/superpowers/specs/2026-03-19-shared-library-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/main/syncStore.js` | Sync state persistence (`syncState.json`): read/write SHA maps, track last-synced timestamps |
| Create | `src/main/sharedLibrary.js` | Sync engine: pull/push algorithms, background poll timer, conflict detection, debounced push |
| Modify | `src/main/githubApi.js` | Add shared repo API functions: `ensureSharedRepo`, `getRepoTree`, `getFileContents`, `putSharedFile`, `deleteSharedFile` |
| Modify | `src/main/folderStore.js` | Extend `upsertFolder` to persist `shared`, `orgName`, `lastSyncedAt` fields |
| Modify | `src/main/index.js` | Register shared library IPC handlers, wire sync triggers into existing save/delete/move handlers |
| Modify | `src/preload/index.js` | Expose shared library IPC methods to renderer |
| Modify | `src/renderer/modules/settings-modal.js` | Add "Shared Library" section: org picker, connect/disconnect |
| Modify | `src/renderer/modules/library/sidebar.js` | Visual indicator for shared folders, "Shared Folders" section label |
| Modify | `src/renderer/modules/library/folder-store.js` | Add `shareFolder`, `unshareFolder` helpers |
| Modify | `src/renderer/modules/library/context-menu.js` | Add share/unshare/sync context menu items |
| Create | `tests/unit/syncStore.test.js` | Unit tests for SyncStore |
| Create | `tests/unit/sharedLibrary.test.js` | Unit tests for sync engine |
| Modify | `tests/unit/folderStore.test.js` | Tests for extended folder schema |
| Modify | `tests/unit/githubApi.test.js` | Tests for new GitHub API functions |

---

## Task 1: SyncStore — sync state persistence

**Files:**
- Create: `src/main/syncStore.js`
- Create: `tests/unit/syncStore.test.js`

- [ ] **Step 1: Write failing tests for SyncStore**

```js
// tests/unit/syncStore.test.js
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { SyncStore } = require("../../src/main/syncStore");

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-sync-"));
  const store = new SyncStore(dir);
  await store.init();
  return { store, dir };
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

describe("SyncStore — init", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates syncState.json with empty object if missing", async () => {
    const content = await fs.readFile(path.join(dir, "syncState.json"), "utf-8");
    expect(JSON.parse(content)).toEqual({});
  });

  test("preserves existing syncState.json", async () => {
    const existing = { "folder-1": { remoteShas: { "meta": "abc" } } };
    await fs.writeFile(path.join(dir, "syncState.json"), JSON.stringify(existing));
    const store2 = new SyncStore(dir);
    await store2.init();
    const state = await store2.getState();
    expect(state).toEqual(existing);
  });
});

describe("SyncStore — getShas / setShas", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("getShas returns empty object for unknown folder", async () => {
    expect(await store.getShas("unknown")).toEqual({});
  });

  test("setShas persists and retrieves SHA map", async () => {
    const shas = { "builds/b1": "sha-111", "comps/c1": "sha-222" };
    await store.setShas("folder-1", shas);
    expect(await store.getShas("folder-1")).toEqual(shas);
  });

  test("setSha updates a single entry", async () => {
    await store.setShas("folder-1", { "builds/b1": "sha-111" });
    await store.setSha("folder-1", "builds/b2", "sha-222");
    const shas = await store.getShas("folder-1");
    expect(shas).toEqual({ "builds/b1": "sha-111", "builds/b2": "sha-222" });
  });

  test("removeSha deletes a single entry", async () => {
    await store.setShas("folder-1", { "builds/b1": "sha-111", "builds/b2": "sha-222" });
    await store.removeSha("folder-1", "builds/b1");
    expect(await store.getShas("folder-1")).toEqual({ "builds/b2": "sha-222" });
  });

  test("removeFolder removes entire folder entry", async () => {
    await store.setShas("folder-1", { "builds/b1": "sha-111" });
    await store.removeFolder("folder-1");
    expect(await store.getShas("folder-1")).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/syncStore.test.js --no-coverage`
Expected: FAIL — `Cannot find module '../../src/main/syncStore'`

- [ ] **Step 3: Implement SyncStore**

```js
// src/main/syncStore.js
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");

class SyncStore {
  constructor(baseDir) {
    this.syncPath = path.join(baseDir, "syncState.json");
  }

  async init() {
    try {
      await fs.access(this.syncPath);
    } catch {
      await fs.writeFile(this.syncPath, "{}", "utf-8");
    }
  }

  async getState() {
    const raw = await fs.readFile(this.syncPath, "utf-8");
    return JSON.parse(raw);
  }

  async #write(state) {
    await fs.writeFile(this.syncPath, JSON.stringify(state, null, 2), "utf-8");
  }

  async getShas(folderId) {
    const state = await this.getState();
    return state[folderId]?.remoteShas || {};
  }

  async setShas(folderId, shas) {
    const state = await this.getState();
    if (!state[folderId]) state[folderId] = {};
    state[folderId].remoteShas = { ...shas };
    await this.#write(state);
  }

  async setSha(folderId, filePath, sha) {
    const state = await this.getState();
    if (!state[folderId]) state[folderId] = {};
    if (!state[folderId].remoteShas) state[folderId].remoteShas = {};
    state[folderId].remoteShas[filePath] = sha;
    await this.#write(state);
  }

  async removeSha(folderId, filePath) {
    const state = await this.getState();
    if (state[folderId]?.remoteShas) {
      delete state[folderId].remoteShas[filePath];
      await this.#write(state);
    }
  }

  async removeFolder(folderId) {
    const state = await this.getState();
    delete state[folderId];
    await this.#write(state);
  }

  async reset() {
    await fs.writeFile(this.syncPath, "{}", "utf-8");
  }
}

module.exports = { SyncStore };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/syncStore.test.js --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/syncStore.js tests/unit/syncStore.test.js
git commit -m "feat(shared-library): add SyncStore for sync state persistence"
```

---

## Task 2: Extend FolderStore schema

**Files:**
- Modify: `src/main/folderStore.js:20-68`
- Modify: `tests/unit/folderStore.test.js`

- [ ] **Step 1: Write failing tests for shared folder fields**

Add to `tests/unit/folderStore.test.js`:

```js
describe("FolderStore — shared folder fields", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("upsertFolder preserves shared field on create", async () => {
    const folder = await store.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });
    expect(folder.shared).toBe(true);
    expect(folder.orgName).toBe("test-org");
  });

  test("upsertFolder preserves shared fields on update", async () => {
    const folder = await store.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });
    const updated = await store.upsertFolder({ id: folder.id, name: "Renamed", shared: true, orgName: "test-org", lastSyncedAt: "2026-01-01T00:00:00Z" });
    expect(updated.shared).toBe(true);
    expect(updated.orgName).toBe("test-org");
    expect(updated.lastSyncedAt).toBe("2026-01-01T00:00:00Z");
  });

  test("shared defaults to false when not provided", async () => {
    const folder = await store.upsertFolder({ name: "Personal" });
    expect(folder.shared).toBeUndefined();
  });

  test("shared folders cannot have a parentId", async () => {
    const parent = await store.upsertFolder({ name: "Parent" });
    await expect(
      store.upsertFolder({ name: "Shared", shared: true, orgName: "org", parentId: parent.id })
    ).rejects.toThrow("Shared folders must be top-level");
  });

  test("non-shared folders cannot nest under shared folders", async () => {
    const shared = await store.upsertFolder({ name: "Shared", shared: true, orgName: "org" });
    await expect(
      store.upsertFolder({ name: "Child", parentId: shared.id })
    ).rejects.toThrow("Cannot nest folders under a shared folder");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/folderStore.test.js --no-coverage`
Expected: FAIL — shared fields not preserved, nesting constraints not enforced

- [ ] **Step 3: Extend upsertFolder in folderStore.js**

In `src/main/folderStore.js`, modify `upsertFolder` (lines 20-68):

1. After the `parentId` assignment (line 25), add shared folder nesting validation:
```js
    const shared = input.shared === true;
    const orgName = typeof input.orgName === "string" ? input.orgName : undefined;
    const lastSyncedAt = typeof input.lastSyncedAt === "string" ? input.lastSyncedAt : undefined;

    // Shared folders must be top-level
    if (shared && parentId) {
      throw new Error("Shared folders must be top-level");
    }

    // Non-shared folders cannot nest under shared folders
    if (parentId) {
      const parentFolder = folders.find((f) => f.id === parentId);
      if (parentFolder?.shared) {
        throw new Error("Cannot nest folders under a shared folder");
      }
    }
```

2. In the existing folder update block (after line 46), add:
```js
      if (input.shared !== undefined) existing.shared = Boolean(input.shared);
      if (input.orgName !== undefined) existing.orgName = input.orgName;
      if (input.lastSyncedAt !== undefined) existing.lastSyncedAt = input.lastSyncedAt;
```

3. In the new folder creation object (lines 57-65), use caller-specified `id` when provided (critical for sync — remote and local folder IDs must match):
```js
    const folder = {
      id: input.id || crypto.randomUUID(),
      name,
      parentId,
      sortOrder: typeof input.sortOrder === "number" ? input.sortOrder : 0,
      createdAt: now,
      updatedAt: now,
    };
    if (shared) folder.shared = true;
    if (orgName) folder.orgName = orgName;
    if (lastSyncedAt) folder.lastSyncedAt = lastSyncedAt;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/folderStore.test.js --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/folderStore.js tests/unit/folderStore.test.js
git commit -m "feat(shared-library): extend FolderStore schema with shared folder fields"
```

---

## Task 3: GitHub API — shared repo functions

**Files:**
- Modify: `src/main/githubApi.js`
- Modify: `tests/unit/githubApi.test.js`

- [ ] **Step 1: Write failing tests for new GitHub API functions**

Add to `tests/unit/githubApi.test.js`. Import the new functions at the top of the file alongside the existing imports (matching the established pattern — do NOT use inline `require()` inside tests):

```js
// Add to the existing top-level require block:
const {
  TARGET_REPO,
  SHARED_REPO,
  getViewer,
  listTargets,
  ensureAxiForgeRepo,
  ensureSharedRepo,
  ensurePages,
  getPagesBuildStatus,
  ensurePagesWorkflow,
  publishSiteBundle,
  deleteFile,
  getRepoTree,
  getFileContents,
  putSharedFile,
  deleteSharedFile,
} = require("../../src/main/githubApi");

// Then add these test suites:

describe("ensureSharedRepo", () => {
  test("returns repo name if repo already exists", async () => {
    global.fetch = jest.fn()
      .mockReturnValueOnce(okRes({ name: "axibuilds-shared" }))  // GET repo
      .mockReturnValueOnce(okRes({ name: "axibuilds-shared" })); // waitForRepo poll
    const name = await ensureSharedRepo(FAKE_TOKEN, "test-org");
    expect(name).toBe("axibuilds-shared");
  });

  test("creates private repo if 404", async () => {
    global.fetch = jest.fn()
      .mockReturnValueOnce(failRes(404))                         // GET repo → 404
      .mockReturnValueOnce(okRes({ name: "axibuilds-shared" }))  // POST create
      .mockReturnValueOnce(okRes({ name: "axibuilds-shared" })); // waitForRepo
    const name = await ensureSharedRepo(FAKE_TOKEN, "test-org");
    expect(name).toBe("axibuilds-shared");
    // Verify POST was to org endpoint with private: true
    const postCall = global.fetch.mock.calls[1];
    expect(postCall[0]).toContain("/orgs/test-org/repos");
    const body = JSON.parse(postCall[1].body);
    expect(body.private).toBe(true);
  });
});

describe("getRepoTree", () => {
  test("returns flat file list with SHAs", async () => {
    const tree = [
      { path: "folders/f1/meta.json", sha: "aaa", type: "blob" },
      { path: "folders/f1/builds/b1.json", sha: "bbb", type: "blob" },
      { path: "folders/f1", sha: "ccc", type: "tree" },
    ];
    global.fetch = jest.fn()
      .mockReturnValueOnce(okRes({ object: { sha: "head-sha" } }))  // ref
      .mockReturnValueOnce(okRes({ tree: { sha: "tree-sha" } }))    // commit
      .mockReturnValueOnce(okRes({ tree, truncated: false }));       // tree
    const result = await getRepoTree(FAKE_TOKEN, "test-org", "axibuilds-shared");
    // Should only include blobs, not tree entries
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: "folders/f1/meta.json", sha: "aaa" });
  });
});

describe("putSharedFile", () => {
  test("creates file when no SHA provided", async () => {
    global.fetch = jest.fn()
      .mockReturnValueOnce(okRes({ content: { sha: "new-sha" } }));  // PUT
    const result = await putSharedFile(FAKE_TOKEN, "test-org", "axibuilds-shared", "folders/f1/builds/b1.json", '{"id":"b1"}', null);
    expect(result.sha).toBe("new-sha");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.sha).toBeUndefined();
  });

  test("updates file with SHA for optimistic locking", async () => {
    global.fetch = jest.fn()
      .mockReturnValueOnce(okRes({ content: { sha: "new-sha" } }));
    await putSharedFile(FAKE_TOKEN, "test-org", "axibuilds-shared", "path.json", "{}", "old-sha");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.sha).toBe("old-sha");
  });

  test("throws with status 409 on conflict", async () => {
    global.fetch = jest.fn()
      .mockReturnValueOnce(failRes(409, "Conflict"));
    await expect(
      putSharedFile(FAKE_TOKEN, "test-org", "axibuilds-shared", "path.json", "{}", "stale-sha")
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("deleteSharedFile", () => {
  test("deletes file with SHA", async () => {
    global.fetch = jest.fn()
      .mockReturnValueOnce(okRes({}));
    await deleteSharedFile(FAKE_TOKEN, "test-org", "axibuilds-shared", "path.json", "sha-123");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.sha).toBe("sha-123");
  });
});

describe("getFileContents", () => {
  test("returns decoded file content", async () => {
    const content = Buffer.from('{"id":"b1","title":"Test"}').toString("base64");
    global.fetch = jest.fn()
      .mockReturnValueOnce(okRes({ content, encoding: "base64", sha: "sha-abc" }));
    const result = await getFileContents(FAKE_TOKEN, "test-org", "axibuilds-shared", "path.json");
    expect(result.content).toBe('{"id":"b1","title":"Test"}');
    expect(result.sha).toBe("sha-abc");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/githubApi.test.js --no-coverage -t "ensureSharedRepo|getRepoTree|putSharedFile|deleteSharedFile|getFileContents"`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement the new GitHub API functions**

Add to `src/main/githubApi.js` before the `module.exports`:

```js
const SHARED_REPO = "axibuilds-shared";

async function ensureSharedRepo(token, org) {
  try {
    await apiFetch(`/repos/${org}/${SHARED_REPO}`, token);
    await waitForRepo(token, org, SHARED_REPO);
    return SHARED_REPO;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  await apiFetch(`/orgs/${org}/repos`, token, {
    method: "POST",
    body: JSON.stringify({
      name: SHARED_REPO,
      private: true,
      auto_init: true,
      description: "AxiForge Shared Library — collaborative GW2 builds",
    }),
  }).catch(async (err) => {
    if (err.status === 422) {
      await apiFetch(`/repos/${org}/${SHARED_REPO}`, token);
      return;
    }
    throw err;
  });

  await waitForRepo(token, org, SHARED_REPO);
  return SHARED_REPO;
}

async function getRepoTree(token, owner, repo, branch = "main") {
  const headRef = await apiFetch(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    token
  );
  const headSha = headRef?.object?.sha;
  if (!headSha) throw new Error(`Could not resolve ${owner}/${repo}@${branch}.`);

  const headCommit = await apiFetch(`/repos/${owner}/${repo}/git/commits/${headSha}`, token);
  const baseTreeSha = headCommit?.tree?.sha;
  if (!baseTreeSha) throw new Error("Could not resolve repository tree.");

  const treeData = await apiFetch(
    `/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`,
    token
  );
  const tree = Array.isArray(treeData?.tree) ? treeData.tree : [];
  return tree
    .filter((entry) => entry?.type === "blob" && entry?.path && entry?.sha)
    .map((entry) => ({ path: entry.path, sha: entry.sha }));
}

async function getFileContents(token, owner, repo, filePath, branch = "main") {
  const encodedPath = filePath.split("/").map((s) => encodeURIComponent(s)).join("/");
  const data = await apiFetch(
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    token
  );
  const content = data?.encoding === "base64" && typeof data?.content === "string"
    ? Buffer.from(data.content, "base64").toString("utf8")
    : null;
  return { content, sha: data?.sha || null };
}

async function putSharedFile(token, owner, repo, filePath, content, sha, branch = "main", message = "Update shared build") {
  const encodedPath = filePath.split("/").map((s) => encodeURIComponent(s)).join("/");
  const body = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
  };
  if (sha) body.sha = sha;
  const result = await apiFetch(`/repos/${owner}/${repo}/contents/${encodedPath}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return { sha: result?.content?.sha || null };
}

async function deleteSharedFile(token, owner, repo, filePath, sha, branch = "main", message = "Remove shared build") {
  const encodedPath = filePath.split("/").map((s) => encodeURIComponent(s)).join("/");
  await apiFetch(`/repos/${owner}/${repo}/contents/${encodedPath}`, token, {
    method: "DELETE",
    body: JSON.stringify({ message, sha, branch }),
  });
}
```

Update `module.exports` to include the new functions:

```js
module.exports = {
  TARGET_REPO,
  SHARED_REPO,
  getViewer,
  listTargets,
  ensureAxiForgeRepo,
  ensureSharedRepo,
  ensurePages,
  getPagesBuildStatus,
  getRepo,
  ensureNoJekyll,
  ensurePagesWorkflow,
  triggerPagesWorkflow,
  publishSiteBundle,
  deleteFile,
  getRepoTree,
  getFileContents,
  putSharedFile,
  deleteSharedFile,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/githubApi.test.js --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/githubApi.js tests/unit/githubApi.test.js
git commit -m "feat(shared-library): add GitHub API functions for shared repo sync"
```

---

## Task 4: Shared Library sync engine

**Files:**
- Create: `src/main/sharedLibrary.js`
- Create: `tests/unit/sharedLibrary.test.js`

- [ ] **Step 1: Write failing tests for the sync engine**

```js
// tests/unit/sharedLibrary.test.js
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { FolderStore } = require("../../src/main/folderStore");
const { SyncStore } = require("../../src/main/syncStore");
const { SharedLibrary } = require("../../src/main/sharedLibrary");

// Mock githubApi module
jest.mock("../../src/main/githubApi");
const githubApi = require("../../src/main/githubApi");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "axiforge-sync-engine-"));
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// Helper: create a BuildStore-like object
function mockBuildStore(builds = []) {
  return {
    listBuilds: jest.fn(async () => [...builds]),
    upsertBuild: jest.fn(async (b) => ({ ...b, updatedAt: new Date().toISOString() })),
    deleteBuild: jest.fn(async () => {}),
    getAuth: jest.fn(async () => ({
      token: "fake-token",
      sharedLibrary: { orgName: "test-org", repoName: "axibuilds-shared" },
    })),
  };
}

function mockCompStore(comps = []) {
  return {
    listComps: jest.fn(async () => [...comps]),
    upsertComp: jest.fn(async (c) => ({ ...c, updatedAt: new Date().toISOString() })),
    deleteComp: jest.fn(async () => {}),
    removeBuildFromComps: jest.fn(async () => {}),
  };
}

describe("SharedLibrary — pullFolder", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(async () => cleanupDir(dir));

  test("pulls new builds from remote into local store", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    const folder = await folderStore.upsertFolder({
      name: "Shared", shared: true, orgName: "test-org",
    });

    // Remote has one build
    githubApi.getRepoTree.mockResolvedValue([
      { path: `folders/${folder.id}/meta.json`, sha: "meta-sha" },
      { path: `folders/${folder.id}/builds/b1.json`, sha: "build-sha" },
    ]);
    githubApi.getFileContents.mockResolvedValue({
      content: JSON.stringify({ id: "b1", title: "Remote Build", profession: "Warrior" }),
      sha: "build-sha",
    });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullFolder(folder.id);

    expect(buildStore.upsertBuild).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b1", title: "Remote Build", folderId: folder.id })
    );
    // SHA should be tracked
    const shas = await syncStore.getShas(folder.id);
    expect(shas[`builds/b1`]).toBe("build-sha");
  });

  test("skips unchanged files (matching SHA)", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    const folder = await folderStore.upsertFolder({
      name: "Shared", shared: true, orgName: "test-org",
    });
    await syncStore.setShas(folder.id, { "builds/b1": "same-sha" });

    githubApi.getRepoTree.mockResolvedValue([
      { path: `folders/${folder.id}/meta.json`, sha: "meta-sha" },
      { path: `folders/${folder.id}/builds/b1.json`, sha: "same-sha" },
    ]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullFolder(folder.id);

    expect(githubApi.getFileContents).not.toHaveBeenCalled();
    expect(buildStore.upsertBuild).not.toHaveBeenCalled();
  });

  test("removes locally tracked builds deleted on remote", async () => {
    const buildStore = mockBuildStore([
      { id: "b1", title: "Old", folderId: "f1" },
    ]);
    const compStore = mockCompStore([]);
    const folder = await folderStore.upsertFolder({
      id: "f1", name: "Shared", shared: true, orgName: "test-org",
    });
    await syncStore.setShas("f1", { "builds/b1": "old-sha" });

    // Remote tree has no builds
    githubApi.getRepoTree.mockResolvedValue([
      { path: "folders/f1/meta.json", sha: "meta-sha" },
    ]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullFolder("f1");

    expect(buildStore.deleteBuild).toHaveBeenCalledWith("b1");
  });
});

describe("SharedLibrary — pushBuild", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(async () => cleanupDir(dir));

  test("creates new file when no SHA tracked", async () => {
    const build = { id: "b1", title: "New Build", folderId: "f1" };
    const buildStore = mockBuildStore([build]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ id: "f1", name: "Shared", shared: true, orgName: "test-org" });

    githubApi.putSharedFile.mockResolvedValue({ sha: "new-sha" });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pushBuild(build);

    expect(githubApi.putSharedFile).toHaveBeenCalledWith(
      "fake-token", "test-org", "axibuilds-shared",
      "folders/f1/builds/b1.json",
      expect.any(String),  // JSON content
      null,                // no SHA = create
      "main",
      expect.any(String),  // commit message
    );
    const shas = await syncStore.getShas("f1");
    expect(shas["builds/b1"]).toBe("new-sha");
  });

  test("updates with SHA when tracked (optimistic locking)", async () => {
    const build = { id: "b1", title: "Updated", folderId: "f1" };
    const buildStore = mockBuildStore([build]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ id: "f1", name: "Shared", shared: true, orgName: "test-org" });
    await syncStore.setShas("f1", { "builds/b1": "existing-sha" });

    githubApi.putSharedFile.mockResolvedValue({ sha: "updated-sha" });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pushBuild(build);

    expect(githubApi.putSharedFile).toHaveBeenCalledWith(
      "fake-token", "test-org", "axibuilds-shared",
      "folders/f1/builds/b1.json",
      expect.any(String),
      "existing-sha",     // existing SHA for optimistic lock
      "main",
      expect.any(String),
    );
    const shas = await syncStore.getShas("f1");
    expect(shas["builds/b1"]).toBe("updated-sha");
  });

  test("returns conflict info on 409", async () => {
    const build = { id: "b1", title: "Mine", folderId: "f1" };
    const buildStore = mockBuildStore([build]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ id: "f1", name: "Shared", shared: true, orgName: "test-org" });
    await syncStore.setShas("f1", { "builds/b1": "stale-sha" });

    const err = new Error("Conflict");
    err.status = 409;
    githubApi.putSharedFile.mockRejectedValue(err);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    const result = await lib.pushBuild(build);

    expect(result.conflict).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/sharedLibrary.test.js --no-coverage`
Expected: FAIL — `Cannot find module '../../src/main/sharedLibrary'`

- [ ] **Step 3: Implement SharedLibrary sync engine**

```js
// src/main/sharedLibrary.js
"use strict";

const {
  getRepoTree,
  getFileContents,
  putSharedFile,
  deleteSharedFile,
  ensureSharedRepo,
} = require("./githubApi");

class SharedLibrary {
  constructor({ buildStore, compStore, folderStore, syncStore }) {
    this.buildStore = buildStore;
    this.compStore = compStore;
    this.folderStore = folderStore;
    this.syncStore = syncStore;
    this._pushTimers = new Map(); // debounce timers per build/comp ID
    this._pollTimer = null;
  }

  async #getAuth() {
    const auth = await this.buildStore.getAuth();
    if (!auth?.token || !auth?.sharedLibrary?.orgName) return null;
    return {
      token: auth.token,
      org: auth.sharedLibrary.orgName,
      repo: auth.sharedLibrary.repoName || "axibuilds-shared",
    };
  }

  // ─── Pull ───────────────────────────────────────────────────────────────────

  async pullFolder(folderId) {
    const auth = await this.#getAuth();
    if (!auth) return;
    // Fetch tree and delegate to shared implementation
    const tree = await getRepoTree(auth.token, auth.org, auth.repo);
    await this.#pullFolderWithTree(folderId, tree, auth);
  }

  async pullAll() {
    const auth = await this.#getAuth();
    if (!auth) return;

    const folders = await this.folderStore.listFolders();
    const sharedFolders = folders.filter((f) => f.shared);
    if (!sharedFolders.length) return;

    // Fetch tree once for the entire repo (per spec: 1 API call per poll)
    let tree;
    try {
      tree = await getRepoTree(auth.token, auth.org, auth.repo);
    } catch (err) {
      // Transient error: retry once after 5 seconds
      if (err.status >= 500 && err.status < 600) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          tree = await getRepoTree(auth.token, auth.org, auth.repo);
        } catch {
          console.error("Shared library poll failed after retry:", err.message);
          return;
        }
      } else {
        console.error("Shared library poll error:", err.message);
        return;
      }
    }

    for (const folder of sharedFolders) {
      try {
        await this.#pullFolderWithTree(folder.id, tree, auth);
      } catch (err) {
        console.error(`Shared library pull failed for folder ${folder.id}:`, err.message);
      }
    }
  }

  // Internal: pull using a pre-fetched tree (avoids duplicate API calls in pullAll)
  async #pullFolderWithTree(folderId, tree, auth) {
    const folders = await this.folderStore.listFolders();
    const folder = folders.find((f) => f.id === folderId && f.shared);
    if (!folder) return;

    const prefix = `folders/${folderId}/`;
    const remoteFiles = tree.filter((f) => f.path.startsWith(prefix));
    const localShas = await this.syncStore.getShas(folderId);

    const changed = [];
    const remotePaths = new Set();
    for (const file of remoteFiles) {
      const relPath = file.path.slice(prefix.length);
      if (relPath === "meta.json") {
        const metaSha = localShas["meta"];
        if (metaSha !== file.sha) {
          const { content: metaContent } = await getFileContents(auth.token, auth.org, auth.repo, file.path);
          if (metaContent) {
            const meta = JSON.parse(metaContent);
            await this.folderStore.upsertFolder({
              id: folderId, name: meta.name, sortOrder: meta.sortOrder,
              shared: true, orgName: folder.orgName,
            });
            await this.syncStore.setSha(folderId, "meta", file.sha);
          }
        }
        continue;
      }
      remotePaths.add(relPath);
      const key = relPath.replace(/\.json$/, "");
      const localSha = localShas[key];
      if (localSha !== file.sha) {
        changed.push({ relPath, sha: file.sha });
      }
    }

    for (const { relPath, sha } of changed) {
      const fullPath = `${prefix}${relPath}`;
      const { content } = await getFileContents(auth.token, auth.org, auth.repo, fullPath);
      if (!content) continue;
      const data = JSON.parse(content);
      const key = relPath.replace(/\.json$/, "");
      if (relPath.startsWith("builds/")) {
        data.folderId = folderId;
        await this.buildStore.upsertBuild(data);
        await this.syncStore.setSha(folderId, key, sha);
      } else if (relPath.startsWith("comps/")) {
        data.folderId = folderId;
        await this.compStore.upsertComp(data);
        await this.syncStore.setSha(folderId, key, sha);
      }
    }

    for (const [key, _sha] of Object.entries(localShas)) {
      const relPathWithExt = `${key}.json`;
      if (!remotePaths.has(relPathWithExt) && key !== "meta") {
        if (key.startsWith("builds/")) {
          const buildId = key.replace("builds/", "");
          await this.buildStore.deleteBuild(buildId);
          await this.compStore.removeBuildFromComps(buildId);
        } else if (key.startsWith("comps/")) {
          const compId = key.replace("comps/", "");
          await this.compStore.deleteComp(compId);
        }
        await this.syncStore.removeSha(folderId, key);
      }
    }

    await this.folderStore.upsertFolder({
      id: folderId, name: folder.name, shared: true,
      orgName: folder.orgName, lastSyncedAt: new Date().toISOString(),
    });
  }

  // ─── Push ───────────────────────────────────────────────────────────────────

  async pushBuild(build) {
    const auth = await this.#getAuth();
    if (!auth) return { conflict: false };

    const folders = await this.folderStore.listFolders();
    const folder = folders.find((f) => f.id === build.folderId && f.shared);
    if (!folder) return { conflict: false };

    const key = `builds/${build.id}`;
    const filePath = `folders/${build.folderId}/${key}.json`;
    const shas = await this.syncStore.getShas(build.folderId);
    const currentSha = shas[key] || null;

    // Strip folderId from the stored JSON (it's implied by folder path)
    const { folderId, compId, pinned, sortOrder, ...buildData } = build;
    const content = JSON.stringify(buildData, null, 2);

    try {
      const result = await putSharedFile(
        auth.token, auth.org, auth.repo,
        filePath, content, currentSha, "main",
        `Update build: ${build.title || build.id}`
      );
      await this.syncStore.setSha(build.folderId, key, result.sha);
      return { conflict: false };
    } catch (err) {
      if (err.status === 409) {
        return { conflict: true };
      }
      throw err;
    }
  }

  async pushComp(comp) {
    const auth = await this.#getAuth();
    if (!auth) return { conflict: false };

    const folders = await this.folderStore.listFolders();
    const folder = folders.find((f) => f.id === comp.folderId && f.shared);
    if (!folder) return { conflict: false };

    const key = `comps/${comp.id}`;
    const filePath = `folders/${comp.folderId}/${key}.json`;
    const shas = await this.syncStore.getShas(comp.folderId);
    const currentSha = shas[key] || null;

    const { folderId, ...compData } = comp;
    const content = JSON.stringify(compData, null, 2);

    try {
      const result = await putSharedFile(
        auth.token, auth.org, auth.repo,
        filePath, content, currentSha, "main",
        `Update comp: ${comp.name || comp.id}`
      );
      await this.syncStore.setSha(comp.folderId, key, result.sha);
      return { conflict: false };
    } catch (err) {
      if (err.status === 409) {
        return { conflict: true };
      }
      throw err;
    }
  }

  async deleteBuildRemote(folderId, buildId) {
    const auth = await this.#getAuth();
    if (!auth) return;

    const key = `builds/${buildId}`;
    const filePath = `folders/${folderId}/${key}.json`;
    const shas = await this.syncStore.getShas(folderId);
    const sha = shas[key];
    if (!sha) return;

    try {
      await deleteSharedFile(auth.token, auth.org, auth.repo, filePath, sha, "main",
        `Delete build: ${buildId}`);
      await this.syncStore.removeSha(folderId, key);
    } catch (err) {
      if (err.status === 409) {
        return { conflict: true };
      }
      throw err;
    }
  }

  async deleteCompRemote(folderId, compId) {
    const auth = await this.#getAuth();
    if (!auth) return;

    const key = `comps/${compId}`;
    const filePath = `folders/${folderId}/${key}.json`;
    const shas = await this.syncStore.getShas(folderId);
    const sha = shas[key];
    if (!sha) return;

    try {
      await deleteSharedFile(auth.token, auth.org, auth.repo, filePath, sha, "main",
        `Delete comp: ${compId}`);
      await this.syncStore.removeSha(folderId, key);
    } catch (err) {
      if (err.status === 409) {
        return { conflict: true };
      }
      throw err;
    }
  }

  // ─── Share / unshare folder ─────────────────────────────────────────────────

  async shareFolder(folderId) {
    const auth = await this.#getAuth();
    if (!auth) throw new Error("Not authenticated or no shared library configured");

    await ensureSharedRepo(auth.token, auth.org);

    const folder = (await this.folderStore.listFolders()).find((f) => f.id === folderId);
    if (!folder) throw new Error("Folder not found");

    // Create meta.json
    const metaContent = JSON.stringify({
      id: folder.id,
      name: folder.name,
      sortOrder: folder.sortOrder || 0,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    }, null, 2);

    const metaResult = await putSharedFile(
      auth.token, auth.org, auth.repo,
      `folders/${folderId}/meta.json`, metaContent, null, "main",
      `Share folder: ${folder.name}`
    );
    await this.syncStore.setSha(folderId, "meta", metaResult.sha);

    // Push all builds in this folder
    const builds = await this.buildStore.listBuilds();
    for (const build of builds.filter((b) => b.folderId === folderId)) {
      await this.pushBuild(build);
    }

    // Push all comps in this folder
    const comps = await this.compStore.listComps();
    for (const comp of comps.filter((c) => c.folderId === folderId)) {
      await this.pushComp(comp);
    }

    // Mark folder as shared locally
    await this.folderStore.upsertFolder({
      id: folderId,
      name: folder.name,
      shared: true,
      orgName: auth.org,
      lastSyncedAt: new Date().toISOString(),
    });
  }

  async unshareFolder(folderId) {
    const folders = await this.folderStore.listFolders();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;

    await this.folderStore.upsertFolder({
      id: folderId,
      name: folder.name,
      shared: false,
      orgName: undefined,
      lastSyncedAt: undefined,
    });
    await this.syncStore.removeFolder(folderId);
  }

  // ─── Background poll ───────────────────────────────────────────────────────

  startPolling(intervalMs = 5 * 60 * 1000) {
    this.stopPolling();
    this._pollTimer = setInterval(() => {
      this.pullAll().catch((err) => {
        console.error("Shared library poll error:", err.message);
      });
    }, intervalMs);
  }

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ─── Debounced push ────────────────────────────────────────────────────────

  schedulePush(type, item, delayMs = 2000) {
    const key = `${type}:${item.id}`;
    if (this._pushTimers.has(key)) {
      clearTimeout(this._pushTimers.get(key));
    }
    this._pushTimers.set(key, setTimeout(async () => {
      this._pushTimers.delete(key);
      try {
        if (type === "build") {
          await this.pushBuild(item);
        } else if (type === "comp") {
          await this.pushComp(item);
        }
      } catch (err) {
        console.error(`Shared library push failed for ${key}:`, err.message);
      }
    }, delayMs));
  }
}

module.exports = { SharedLibrary };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/sharedLibrary.test.js --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/sharedLibrary.js tests/unit/sharedLibrary.test.js
git commit -m "feat(shared-library): implement sync engine with pull/push/conflict detection"
```

---

## Task 5: Wire IPC handlers in main process

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Import and initialize SharedLibrary in index.js**

At the top of `src/main/index.js`, alongside existing store imports:

```js
const { SyncStore } = require("./syncStore");
const { SharedLibrary } = require("./sharedLibrary");
```

After the existing store initialization (around line 38):

```js
const syncStore = new SyncStore(dataDir);
```

In the `app.whenReady()` block, after `await store.init()`:

```js
await syncStore.init();
const sharedLibrary = new SharedLibrary({ buildStore: store, compStore, folderStore, syncStore });
sharedLibrary.startPolling();
```

- [ ] **Step 2: Add shared library IPC handlers**

Add after the existing onboarding handlers (around line 650):

```js
  // ─── Shared Library ─────────────────────────────────────────────────────────
  ipcMain.handle("shared-library:list-orgs", async () => {
    const session = await getSession();
    if (!session) return [];
    const { listTargets } = require("./githubApi");
    const targets = await listTargets(session.token, session.viewer.login);
    return targets.filter((t) => t.type === "org");
  });

  ipcMain.handle("shared-library:setup", async (_e, orgName) => {
    const session = await getSession();
    if (!session) throw new Error("Not logged in");
    const { ensureSharedRepo } = require("./githubApi");
    await ensureSharedRepo(session.token, orgName);
    const auth = await store.getAuth();
    await store.saveAuth({
      ...auth,
      sharedLibrary: { orgName, repoName: "axibuilds-shared" },
    });
    return { orgName, repoName: "axibuilds-shared" };
  });

  ipcMain.handle("shared-library:share-folder", async (_e, folderId) => {
    await sharedLibrary.shareFolder(folderId);
    return true;
  });

  ipcMain.handle("shared-library:unshare-folder", async (_e, folderId) => {
    await sharedLibrary.unshareFolder(folderId);
    return true;
  });

  ipcMain.handle("shared-library:pull-folder", async (_e, folderId) => {
    await sharedLibrary.pullFolder(folderId);
    return true;
  });

  ipcMain.handle("shared-library:pull-all", async () => {
    await sharedLibrary.pullAll();
    return true;
  });

  ipcMain.handle("shared-library:connect", async () => {
    await sharedLibrary.pullAll();
    return true;
  });

  ipcMain.handle("shared-library:disconnect", async () => {
    sharedLibrary.stopPolling();
    const auth = await store.getAuth();
    delete auth.sharedLibrary;
    await store.saveAuth(auth);
    // Unmark all shared folders
    const folders = await folderStore.listFolders();
    for (const f of folders.filter((f) => f.shared)) {
      await folderStore.upsertFolder({ id: f.id, name: f.name, shared: false });
    }
    await syncStore.reset(); // Clear all tracked SHAs
    return true;
  });

  ipcMain.handle("shared-library:get-config", async () => {
    const auth = await store.getAuth();
    return auth?.sharedLibrary || null;
  });

  ipcMain.handle("shared-library:force-push", async (_e, type, item) => {
    if (type === "build") return sharedLibrary.pushBuild(item);
    if (type === "comp") return sharedLibrary.pushComp(item);
  });
```

- [ ] **Step 3: Wire sync triggers into existing save/delete handlers**

Modify the existing `builds:save` handler (line 297) to schedule a push after save:

```js
  ipcMain.handle("builds:save", async (_e, build) => {
    const saved = await store.upsertBuild(build);
    if (saved.folderId) {
      await folderStore.touchFolders([saved.folderId]);
    }
    // Trigger shared library push if in a shared folder
    const folder = (await folderStore.listFolders()).find((f) => f.id === saved.folderId);
    if (folder?.shared) {
      sharedLibrary.schedulePush("build", saved);
    }
    return saved;
  });
```

Modify the existing `builds:delete` handler (line 305) to delete remotely:

```js
  ipcMain.handle("builds:delete", async (_e, id) => {
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === id);
    const folderId = build?.folderId;
    await store.deleteBuild(id);
    await compStore.removeBuildFromComps(id);
    if (folderId) {
      await folderStore.touchFolders([folderId]);
      const folder = (await folderStore.listFolders()).find((f) => f.id === folderId);
      if (folder?.shared) {
        sharedLibrary.deleteBuildRemote(folderId, id).catch((err) => {
          console.error("Shared library remote delete failed:", err.message);
        });
      }
    }
    return true;
  });
```

Apply the same pattern to `comps:save` and `comps:delete` handlers:

```js
  ipcMain.handle("comps:save", async (_e, comp) => {
    const saved = await compStore.upsertComp(comp);
    // Trigger shared library push if in a shared folder
    if (saved.folderId) {
      const folder = (await folderStore.listFolders()).find((f) => f.id === saved.folderId);
      if (folder?.shared) {
        sharedLibrary.schedulePush("comp", saved);
      }
    }
    return saved;
  });

  ipcMain.handle("comps:delete", async (_e, id) => {
    const comps = await compStore.listComps();
    const comp = comps.find((c) => c.id === id);
    const folderId = comp?.folderId;
    await compStore.deleteComp(id);
    if (folderId) {
      const folder = (await folderStore.listFolders()).find((f) => f.id === folderId);
      if (folder?.shared) {
        sharedLibrary.deleteCompRemote(folderId, id).catch((err) => {
          console.error("Shared library remote comp delete failed:", err.message);
        });
      }
    }
    return true;
  });
```

- [ ] **Step 4: Add preload API methods**

Add to `src/preload/index.js`:

```js
  // Shared Library
  listOrgs: () => ipcRenderer.invoke("shared-library:list-orgs"),
  setupSharedLibrary: (orgName) => ipcRenderer.invoke("shared-library:setup", orgName),
  shareFolder: (folderId) => ipcRenderer.invoke("shared-library:share-folder", folderId),
  unshareFolder: (folderId) => ipcRenderer.invoke("shared-library:unshare-folder", folderId),
  pullFolder: (folderId) => ipcRenderer.invoke("shared-library:pull-folder", folderId),
  pullAllShared: () => ipcRenderer.invoke("shared-library:pull-all"),
  connectSharedLibrary: () => ipcRenderer.invoke("shared-library:connect"),
  disconnectSharedLibrary: () => ipcRenderer.invoke("shared-library:disconnect"),
  getSharedLibraryConfig: () => ipcRenderer.invoke("shared-library:get-config"),
  forcePush: (type, item) => ipcRenderer.invoke("shared-library:force-push", type, item),
  onSyncConflict: (cb) => {
    ipcRenderer.removeAllListeners("sync-conflict");
    ipcRenderer.on("sync-conflict", (_e, data) => cb(data));
  },
  onSyncStatus: (cb) => {
    ipcRenderer.removeAllListeners("sync-status");
    ipcRenderer.on("sync-status", (_e, status) => cb(status));
  },
```

- [ ] **Step 5: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat(shared-library): wire IPC handlers and sync triggers"
```

---

## Task 6: Settings UI — shared library section

**Files:**
- Modify: `src/renderer/modules/settings-modal.js`

- [ ] **Step 1: Add shared library section HTML to settings modal**

In `src/renderer/modules/settings-modal.js`, add a new section inside `_overlay.innerHTML` after the Forum Channel section (after line 62):

```html
        <div class="settings-modal__section" id="sm-shared-library-section">
          <h4 class="settings-modal__section-title">Shared Library</h4>
          <div id="sm-shared-status"></div>
          <div id="sm-shared-setup" class="settings-modal__shared-setup settings-modal__shared-setup--hidden">
            <label class="settings-modal__label" for="sm-org-select">Organization</label>
            <select class="settings-modal__select" id="sm-org-select">
              <option value="">Select an organization...</option>
            </select>
            <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-shared-connect">Connect</button>
          </div>
          <div id="sm-shared-connected" class="settings-modal__shared-connected settings-modal__shared-connected--hidden">
            <div class="settings-modal__shared-info">
              <span class="settings-modal__shared-org" id="sm-shared-org-name"></span>
              <span class="settings-modal__shared-repo">axibuilds-shared</span>
            </div>
            <button class="settings-modal__btn settings-modal__btn--danger" id="sm-shared-disconnect">Disconnect</button>
          </div>
        </div>
```

- [ ] **Step 2: Add element references and event handlers**

Add to the `_el` object:

```js
    sharedStatus:    document.getElementById("sm-shared-status"),
    sharedSetup:     document.getElementById("sm-shared-setup"),
    sharedConnected: document.getElementById("sm-shared-connected"),
    orgSelect:       document.getElementById("sm-org-select"),
    sharedConnect:   document.getElementById("sm-shared-connect"),
    sharedDisconnect: document.getElementById("sm-shared-disconnect"),
    sharedOrgName:   document.getElementById("sm-shared-org-name"),
```

Add event listeners:

```js
  _el.sharedConnect.addEventListener("click", _connectSharedLibrary);
  _el.sharedDisconnect.addEventListener("click", _disconnectSharedLibrary);
```

- [ ] **Step 3: Implement load/connect/disconnect functions**

```js
async function _loadSharedLibraryState() {
  const config = await window.desktopApi.getSharedLibraryConfig();
  if (config?.orgName) {
    _el.sharedSetup.classList.add("settings-modal__shared-setup--hidden");
    _el.sharedConnected.classList.remove("settings-modal__shared-connected--hidden");
    _el.sharedOrgName.textContent = config.orgName;
  } else {
    _el.sharedConnected.classList.add("settings-modal__shared-connected--hidden");
    _el.sharedSetup.classList.remove("settings-modal__shared-setup--hidden");
    // Load org list
    const session = await window.desktopApi.getSession();
    if (session) {
      const orgs = await window.desktopApi.listOrgs();
      _el.orgSelect.innerHTML = '<option value="">Select an organization...</option>';
      for (const org of orgs) {
        const opt = document.createElement("option");
        opt.value = org.login;
        opt.textContent = org.login;
        _el.orgSelect.appendChild(opt);
      }
    } else {
      _el.sharedStatus.textContent = "Log in to GitHub first to set up sharing.";
    }
  }
}

async function _connectSharedLibrary() {
  const org = _el.orgSelect.value;
  if (!org) return;
  _el.sharedConnect.disabled = true;
  _el.sharedConnect.textContent = "Connecting...";
  try {
    await window.desktopApi.setupSharedLibrary(org);
    await window.desktopApi.connectSharedLibrary();
    await _loadSharedLibraryState();
  } catch (err) {
    _el.sharedStatus.textContent = `Error: ${err.message}`;
  } finally {
    _el.sharedConnect.disabled = false;
    _el.sharedConnect.textContent = "Connect";
  }
}

async function _disconnectSharedLibrary() {
  if (!confirm("Disconnect from shared library? Your local copies will be kept.")) return;
  await window.desktopApi.disconnectSharedLibrary();
  await _loadSharedLibraryState();
}
```

Call `_loadSharedLibraryState()` from `openSettingsModal()`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/settings-modal.js
git commit -m "feat(shared-library): add shared library section to settings modal"
```

---

## Task 7: Sidebar — shared folder visual indicators

**Files:**
- Modify: `src/renderer/modules/library/sidebar.js:170-224`

- [ ] **Step 1: Add shared folder section and icons**

In `src/renderer/modules/library/sidebar.js`, import a share icon:

```js
import { shareIcon } from "./heroicons.js";
```

If `shareIcon` doesn't exist in heroicons.js, add it there:

```js
export const shareIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M13 4.5a2.5 2.5 0 11.702 1.737L6.97 9.604a2.518 2.518 0 010 .792l6.733 3.367a2.5 2.5 0 11-.671 1.341l-6.733-3.367a2.5 2.5 0 110-3.474l6.733-3.367A2.52 2.52 0 0113 4.5z"/></svg>`;
```

- [ ] **Step 2: Modify renderMyFolders to separate shared from personal**

Replace `renderMyFolders` function to split folders:

```js
function renderMyFolders(expanded) {
  const topLevel = state.folders
    .filter((f) => f.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const sharedFolders = topLevel.filter((f) => f.shared);
  const personalFolders = topLevel.filter((f) => !f.shared);

  const sharedItems = sharedFolders.map((f) => renderFolderItem(f, expanded, 0)).join("");
  const personalItems = personalFolders.map((f) => renderFolderItem(f, expanded, 0)).join("");

  let html = "";

  if (sharedFolders.length > 0) {
    html += `
      <div class="lib-sidebar__section">
        <div class="lib-sidebar__section-label">Shared Folders</div>
        ${sharedItems}
      </div>
    `;
  }

  html += `
    <div class="lib-sidebar__section">
      <div class="lib-sidebar__section-header">
        <div class="lib-sidebar__section-label">My Folders</div>
        <button type="button" class="lib-sidebar__new-folder-btn" id="lib-new-folder-btn" title="New folder" aria-label="New folder">
          ${folderPlusIcon}
        </button>
      </div>
      ${personalItems || `<div class="lib-sidebar__empty">No folders yet</div>`}
    </div>
  `;

  return html;
}
```

- [ ] **Step 3: Add shared icon to renderFolderItem for shared folders**

In `renderFolderItem` (line 190), add a shared indicator:

```js
  const sharedBadge = folder.shared
    ? `<span class="lib-nav-item__shared-badge" title="Shared with ${escapeHtml(folder.orgName || 'org')}">${shareIcon}</span>`
    : "";
```

Insert `${sharedBadge}` after the label span in the button markup.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/library/sidebar.js src/renderer/modules/library/heroicons.js
git commit -m "feat(shared-library): add shared folder visual indicators in sidebar"
```

---

## Task 8: Folder context menu — share/unshare actions

**Files:**
- Modify: `src/renderer/modules/library/context-menu.js` (folder context menu)
- Modify: `src/renderer/modules/library/folder-store.js`

- [ ] **Step 1: Add shareFolder/unshareFolder helpers to folder-store.js**

Add to `src/renderer/modules/library/folder-store.js`:

```js
export async function shareFolder(folderId) {
  await window.desktopApi.shareFolder(folderId);
  await loadFolders();
  state.builds = await window.desktopApi.listBuilds();
}

export async function unshareFolder(folderId) {
  await window.desktopApi.unshareFolder(folderId);
  await loadFolders();
}

export async function pullFolder(folderId) {
  await window.desktopApi.pullFolder(folderId);
  await loadFolders();
  state.builds = await window.desktopApi.listBuilds();
  state.comps = await window.desktopApi.listComps();
}
```

- [ ] **Step 2: Add context menu items for share/unshare**

In `src/renderer/modules/library/context-menu.js`, locate the folder context menu. Add menu items:

For non-shared folders (when shared library is configured):
```js
{ label: "Share to org", action: () => shareFolder(folderId) }
```

For shared folders:
```js
{ label: "Sync now", action: () => pullFolder(folderId) },
{ label: "Unshare", action: () => unshareFolder(folderId) },
```

- [ ] **Step 3: Add confirmation dialogs for share/unshare**

Wrap `shareFolder` and `unshareFolder` calls with confirmation:

```js
if (confirm(`Share "${folder.name}" to your org? All builds in this folder will be visible to org members.`)) {
  await shareFolder(folderId);
  renderLibrary();
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/library/folder-store.js src/renderer/modules/library/context-menu.js
git commit -m "feat(shared-library): add share/unshare/sync context menu actions"
```

---

## Task 9: Folder navigation sync trigger

**Files:**
- Modify: `src/renderer/modules/library/library.js`

- [ ] **Step 1: Trigger pull on navigating to a shared folder**

In the navigation handler (wherever `onNavigate` is handled), add a pull trigger:

```js
// When navigating to a shared folder, pull latest
if (folder?.type === "custom") {
  const folderObj = state.folders.find((f) => f.id === folder.id);
  if (folderObj?.shared) {
    // Pull in background, re-render when done
    window.desktopApi.pullFolder(folder.id).then(async () => {
      state.builds = await window.desktopApi.listBuilds();
      state.comps = await window.desktopApi.listComps();
      await loadFolders();
      renderLibrary();
    }).catch(() => {
      // Silently fail — will sync on next poll
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/library/library.js
git commit -m "feat(shared-library): trigger pull on shared folder navigation"
```

---

## Task 10: Move build boundary enforcement

**Files:**
- Modify: `src/main/index.js` (builds:move handler)

- [ ] **Step 1: Add confirmation for cross-boundary moves**

Modify the `builds:move` handler to handle shared folder boundaries. When moving a build into a shared folder, push it. When moving out, delete remotely:

```js
  ipcMain.handle("builds:move", async (_e, ids, folderId) => {
    if (folderId !== null) {
      const exists = await folderStore.folderExists(folderId);
      if (!exists) throw new Error(`Folder not found: ${folderId}`);
    }

    // Track source folders for sync
    const builds = await store.listBuilds();
    const sourceFolderIds = new Set();
    for (const build of builds) {
      if (ids.includes(build.id) && build.folderId) {
        sourceFolderIds.add(build.folderId);
      }
    }

    await store.moveBuilds(ids, folderId);

    // Handle shared folder sync
    const folders = await folderStore.listFolders();
    const destFolder = folders.find((f) => f.id === folderId);
    const movedBuilds = (await store.listBuilds()).filter((b) => ids.includes(b.id));

    // If moving INTO a shared folder, push each build
    if (destFolder?.shared) {
      for (const build of movedBuilds) {
        sharedLibrary.schedulePush("build", build);
      }
    }

    // If moving OUT OF a shared folder, delete remotely
    for (const srcId of sourceFolderIds) {
      const srcFolder = folders.find((f) => f.id === srcId);
      if (srcFolder?.shared && srcId !== folderId) {
        for (const id of ids) {
          sharedLibrary.deleteBuildRemote(srcId, id).catch((err) => {
            console.error("Failed to delete remote build after move:", err.message);
          });
        }
      }
    }

    // Touch affected folders
    const toTouch = [...sourceFolderIds];
    if (folderId) toTouch.push(folderId);
    if (toTouch.length) await folderStore.touchFolders(toTouch);

    return true;
  });
```

- [ ] **Step 2: Commit**

```bash
git add src/main/index.js
git commit -m "feat(shared-library): enforce shared folder boundaries on build move"
```

---

## Task 11: Joining an existing shared library (second user)

**Files:**
- Modify: `src/renderer/modules/settings-modal.js`
- Modify: `src/main/index.js`

- [ ] **Step 1: Implement connect flow that discovers existing shared folders**

Add IPC handler in `index.js`:

```js
  ipcMain.handle("shared-library:discover-folders", async () => {
    const auth = await store.getAuth();
    if (!auth?.sharedLibrary?.orgName) return [];

    const { getRepoTree } = require("./githubApi");
    const tree = await getRepoTree(
      auth.token,
      auth.sharedLibrary.orgName,
      auth.sharedLibrary.repoName || "axibuilds-shared"
    );

    // Extract folder IDs from tree paths: folders/{folderId}/meta.json
    const folderIds = new Set();
    for (const entry of tree) {
      const match = entry.path.match(/^folders\/([^/]+)\/meta\.json$/);
      if (match) folderIds.add(match[1]);
    }

    // Fetch meta.json for each discovered folder
    const { getFileContents } = require("./githubApi");
    const discovered = [];
    for (const folderId of folderIds) {
      try {
        const { content } = await getFileContents(
          auth.token,
          auth.sharedLibrary.orgName,
          auth.sharedLibrary.repoName || "axibuilds-shared",
          `folders/${folderId}/meta.json`
        );
        if (content) discovered.push(JSON.parse(content));
      } catch {
        // Skip unreadable folders
      }
    }
    return discovered;
  });
```

- [ ] **Step 2: Update connect flow to create local folders and pull**

In the `shared-library:connect` handler, replace the simple `pullAll` with folder discovery + creation:

```js
  ipcMain.handle("shared-library:connect", async () => {
    const auth = await store.getAuth();
    if (!auth?.sharedLibrary?.orgName) throw new Error("No shared library configured");

    // Discover remote folders
    const { getRepoTree, getFileContents } = require("./githubApi");
    const tree = await getRepoTree(
      auth.token, auth.sharedLibrary.orgName,
      auth.sharedLibrary.repoName || "axibuilds-shared"
    );

    const folderMetas = [];
    for (const entry of tree) {
      const match = entry.path.match(/^folders\/([^/]+)\/meta\.json$/);
      if (match) {
        const { content } = await getFileContents(
          auth.token, auth.sharedLibrary.orgName,
          auth.sharedLibrary.repoName || "axibuilds-shared",
          entry.path
        );
        if (content) folderMetas.push(JSON.parse(content));
      }
    }

    // Create local folders for each remote folder (if they don't exist)
    const localFolders = await folderStore.listFolders();
    for (const meta of folderMetas) {
      const existing = localFolders.find((f) => f.id === meta.id);
      if (!existing) {
        await folderStore.upsertFolder({
          id: meta.id,
          name: meta.name,
          sortOrder: meta.sortOrder || 0,
          shared: true,
          orgName: auth.sharedLibrary.orgName,
        });
      } else if (!existing.shared) {
        await folderStore.upsertFolder({
          id: existing.id,
          name: meta.name,
          shared: true,
          orgName: auth.sharedLibrary.orgName,
        });
      }
    }

    // Pull all shared folder content
    await sharedLibrary.pullAll();
    return true;
  });
```

- [ ] **Step 3: Commit**

```bash
git add src/main/index.js src/renderer/modules/settings-modal.js
git commit -m "feat(shared-library): implement second-user connect flow with folder discovery"
```

---

## Task 12: Comp cross-boundary enforcement

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js`

- [ ] **Step 1: Filter build pool to same folder for shared comps**

In the comp detail view where the build pool is rendered, add filtering:

```js
// When the comp is in a shared folder, only show builds from that folder
const comp = state.currentComp;
let poolBuilds = state.builds.filter((b) => !b.compId);
if (comp?.folderId) {
  const folder = state.folders.find((f) => f.id === comp.folderId);
  if (folder?.shared) {
    poolBuilds = poolBuilds.filter((b) => b.folderId === comp.folderId);
  }
}
```

- [ ] **Step 2: Add prompt when dragging cross-boundary builds**

In the drag-drop handler, check if the dropped build is from outside the shared folder and prompt:

```js
// In the drop handler
const targetComp = state.currentComp;
const targetFolder = state.folders.find((f) => f.id === targetComp?.folderId);
if (targetFolder?.shared && droppedBuild.folderId !== targetFolder.id) {
  const move = confirm(`"${droppedBuild.title}" is not in this shared folder. Move it to "${targetFolder.name}" first?`);
  if (move) {
    await window.desktopApi.moveBuilds([droppedBuild.id], targetFolder.id);
    state.builds = await window.desktopApi.listBuilds();
  } else {
    return; // Cancel the drop
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js src/renderer/modules/comps/comp-drag-drop.js
git commit -m "feat(shared-library): enforce comp-build same-folder constraint for shared folders"
```

---

## Task 13: Integration test and polish

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 2: Fix any failing tests**

Address any test failures caused by schema changes or new IPC handler expectations.

- [ ] **Step 3: Manual smoke test checklist**

Verify in the running app:
1. Settings modal shows "Shared Library" section
2. Can select an org and connect
3. Can share a folder (right-click → Share to org)
4. Shared folders show visual indicator in sidebar
5. Saving a build in a shared folder pushes to GitHub
6. Navigating to a shared folder pulls latest
7. Can unshare a folder
8. Can disconnect from shared library

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(shared-library): integration fixes and polish"
```

---

## Deferred to Future Iteration

The following spec requirements are intentionally deferred from this initial implementation:

- **Offline push queue:** The spec describes queuing failed pushes and retrying on next sync with an "unsynced changes" indicator. For now, failed pushes are logged and the change will be pushed on the next user save. A proper queue (persisted in `syncState.json`) and UI indicator can be added once the core sync flow is validated.
- **"Unsynced changes" folder badge:** Depends on the push queue above.

**Transient error retry** (5xx errors) is implemented in `pullAll` with a single retry after 5 seconds. Push operations do not retry — they fail and rely on the next user save or poll cycle.
