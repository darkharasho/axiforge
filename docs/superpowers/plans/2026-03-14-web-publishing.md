# Web Publishing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish individual GW2 builds from the desktop app to encrypted GitHub Pages URLs with read-only, desktop-identical viewers.

**Architecture:** New `buildEncryption.js` module handles AES-GCM encrypt/decrypt and slug generation. `githubApi.js` is updated to target `axibuilds` repo and support file deletion. `siteBundle.js` is replaced with SPA generation (HTML/CSS/JS as embedded strings) plus per-build encryption. A new `builds:publish-build` IPC handler orchestrates the publish flow. The published SPA decrypts builds client-side using Web Crypto API and renders them with read-only renderers matching the desktop UI.

**Tech Stack:** Node.js crypto (AES-GCM), Web Crypto API (browser decryption), vanilla JS SPA, GitHub REST API, existing Electron IPC pattern.

---

## Chunk 1: Backend — Encryption, Build Store, GitHub API

### Task 1: Build Encryption Module

**Files:**
- Create: `src/main/buildEncryption.js`
- Create: `tests/unit/buildEncryption.test.js`

This module provides pure functions for encrypting/decrypting build data and generating slugs and file IDs. No side effects, no I/O.

- [ ] **Step 1: Write failing tests for `slugifyBuildName`**

```js
// tests/unit/buildEncryption.test.js
"use strict";

const { slugifyBuildName } = require("../../src/main/buildEncryption");

describe("slugifyBuildName", () => {
  test("lowercases and replaces spaces with hyphens", () => {
    expect(slugifyBuildName("Power Reaper")).toBe("power-reaper");
  });

  test("strips special characters", () => {
    expect(slugifyBuildName("My Build! @#$%")).toBe("my-build");
  });

  test("collapses multiple hyphens", () => {
    expect(slugifyBuildName("Power --- Reaper")).toBe("power-reaper");
  });

  test("trims leading/trailing hyphens", () => {
    expect(slugifyBuildName(" --Power Reaper-- ")).toBe("power-reaper");
  });

  test("handles unicode by stripping non-ascii", () => {
    expect(slugifyBuildName("Über Build")).toBe("ber-build");
  });

  test("returns 'build' for empty input after slugification", () => {
    expect(slugifyBuildName("")).toBe("build");
    expect(slugifyBuildName("!!!")).toBe("build");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/buildEncryption.test.js --verbose`
Expected: FAIL — `slugifyBuildName` not found

- [ ] **Step 3: Implement `slugifyBuildName`**

```js
// src/main/buildEncryption.js
"use strict";

function slugifyBuildName(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "build";
}

module.exports = { slugifyBuildName };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/buildEncryption.test.js --verbose`
Expected: All 6 tests PASS

- [ ] **Step 5: Write failing tests for `generateFileId`**

Add to `tests/unit/buildEncryption.test.js`:

```js
const { generateFileId } = require("../../src/main/buildEncryption");

describe("generateFileId", () => {
  test("returns an 8-character hex string", () => {
    const id = generateFileId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  test("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateFileId()));
    expect(ids.size).toBe(100);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx jest tests/unit/buildEncryption.test.js --verbose`
Expected: FAIL — `generateFileId` not found

- [ ] **Step 7: Implement `generateFileId`**

Add to `src/main/buildEncryption.js`:

```js
const crypto = require("node:crypto");

function generateFileId() {
  return crypto.randomBytes(4).toString("hex");
}
```

Update `module.exports` to include `generateFileId`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest tests/unit/buildEncryption.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 9: Write failing tests for `encryptBuild` and `decryptBuild`**

Add to `tests/unit/buildEncryption.test.js`:

```js
const { encryptBuild, decryptBuild, generateEncryptionKey } = require("../../src/main/buildEncryption");

describe("encryptBuild / decryptBuild", () => {
  const buildData = { title: "Power Reaper", profession: "Necromancer", skills: { healId: 123 } };

  test("generateEncryptionKey returns a base64url string of ~43 chars", () => {
    const key = generateEncryptionKey();
    expect(typeof key).toBe("string");
    expect(key.length).toBe(43); // 32 bytes base64url = 43 chars
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("round-trip: decrypt(encrypt(data)) === data", () => {
    const key = generateEncryptionKey();
    const encrypted = encryptBuild(buildData, key);
    expect(typeof encrypted).toBe("string"); // base64 string
    const decrypted = decryptBuild(encrypted, key);
    expect(decrypted).toEqual(buildData);
  });

  test("encrypted output differs from plaintext JSON", () => {
    const key = generateEncryptionKey();
    const encrypted = encryptBuild(buildData, key);
    expect(encrypted).not.toContain("Power Reaper");
  });

  test("different keys produce different ciphertext", () => {
    const key1 = generateEncryptionKey();
    const key2 = generateEncryptionKey();
    const enc1 = encryptBuild(buildData, key1);
    const enc2 = encryptBuild(buildData, key2);
    expect(enc1).not.toBe(enc2);
  });

  test("decrypting with wrong key throws", () => {
    const key1 = generateEncryptionKey();
    const key2 = generateEncryptionKey();
    const encrypted = encryptBuild(buildData, key1);
    expect(() => decryptBuild(encrypted, key2)).toThrow();
  });

  test("handles large build objects", () => {
    const largeBuild = { ...buildData, notes: "x".repeat(50000) };
    const key = generateEncryptionKey();
    const encrypted = encryptBuild(largeBuild, key);
    const decrypted = decryptBuild(encrypted, key);
    expect(decrypted).toEqual(largeBuild);
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npx jest tests/unit/buildEncryption.test.js --verbose`
Expected: FAIL — functions not found

- [ ] **Step 11: Implement `generateEncryptionKey`, `encryptBuild`, `decryptBuild`**

Add to `src/main/buildEncryption.js`:

```js
function generateEncryptionKey() {
  return crypto.randomBytes(32).toString("base64url");
}

function encryptBuild(buildData, base64urlKey) {
  const key = Buffer.from(base64urlKey, "base64url");
  const iv = crypto.randomBytes(12);
  const plaintext = JSON.stringify(buildData);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: base64(iv + ciphertext + authTag)
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString("base64");
}

function decryptBuild(base64Payload, base64urlKey) {
  const key = Buffer.from(base64urlKey, "base64url");
  const combined = Buffer.from(base64Payload, "base64");
  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}
```

Update `module.exports` to include all functions.

- [ ] **Step 12: Run tests to verify they pass**

Run: `npx jest tests/unit/buildEncryption.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 13: Write failing test for `getDefaultBuildName`**

Add to `tests/unit/buildEncryption.test.js`:

```js
const { getDefaultBuildName } = require("../../src/main/buildEncryption");

describe("getDefaultBuildName", () => {
  test("returns elite spec name when 3rd spec is elite", () => {
    const specs = [
      { id: 1, name: "Spite", elite: false },
      { id: 2, name: "Soul Reaping", elite: false },
      { id: 3, name: "Reaper", elite: true },
    ];
    expect(getDefaultBuildName(specs, "Necromancer")).toBe("Reaper");
  });

  test("returns 'Core {profession}' when all specs are core", () => {
    const specs = [
      { id: 1, name: "Spite", elite: false },
      { id: 2, name: "Soul Reaping", elite: false },
      { id: 3, name: "Curses", elite: false },
    ];
    expect(getDefaultBuildName(specs, "Necromancer")).toBe("Core Necromancer");
  });

  test("returns elite spec name even if elite is not in 3rd slot", () => {
    const specs = [
      { id: 1, name: "Reaper", elite: true },
      { id: 2, name: "Spite", elite: false },
      { id: 3, name: "Soul Reaping", elite: false },
    ];
    expect(getDefaultBuildName(specs, "Necromancer")).toBe("Reaper");
  });

  test("returns 'Core {profession}' when no specs", () => {
    expect(getDefaultBuildName([], "Warrior")).toBe("Core Warrior");
  });

  test("returns 'Build' when no specs and no profession", () => {
    expect(getDefaultBuildName([], "")).toBe("Build");
  });
});
```

- [ ] **Step 14: Run tests to verify they fail**

Run: `npx jest tests/unit/buildEncryption.test.js --verbose`
Expected: FAIL — `getDefaultBuildName` not found

- [ ] **Step 15: Implement `getDefaultBuildName`**

Add to `src/main/buildEncryption.js`:

```js
function getDefaultBuildName(specializations, profession) {
  const eliteSpec = (specializations || []).find((s) => s?.elite);
  if (eliteSpec?.name) return eliteSpec.name;
  if (profession) return `Core ${profession}`;
  return "Build";
}
```

Update `module.exports`.

- [ ] **Step 16: Run tests to verify they pass**

Run: `npx jest tests/unit/buildEncryption.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 17: Commit**

```bash
git add src/main/buildEncryption.js tests/unit/buildEncryption.test.js
git commit -m "feat: add build encryption module with AES-GCM encrypt/decrypt, slug generation, and default build name"
```

---

### Task 2: Build Store — Publish Metadata

**Files:**
- Modify: `src/main/buildStore.js` (the `normalizeBuild` function, ~lines 95-115)
- Modify: `tests/unit/buildStore.test.js`

Add `publishedSlug`, `publishedFileId`, and `publishedKey` fields to the build normalization. These are optional — empty string by default.

- [ ] **Step 1: Write failing test for publish metadata fields**

Add to `tests/unit/buildStore.test.js`:

```js
describe("BuildStore — publish metadata", () => {
  let store, dir;

  beforeEach(async () => {
    ({ store, dir } = await makeTempStore());
  });
  afterEach(async () => { if (dir) await cleanupDir(dir); });

  test("stores publishedSlug, publishedFileId, publishedKey on a build", async () => {
    const saved = await store.upsertBuild(makeBuild({
      publishedSlug: "power-reaper",
      publishedFileId: "a7f3b2c1",
      publishedKey: "xK9mP2qR4sT6uV8wAb3cDe",
    }));
    expect(saved.publishedSlug).toBe("power-reaper");
    expect(saved.publishedFileId).toBe("a7f3b2c1");
    expect(saved.publishedKey).toBe("xK9mP2qR4sT6uV8wAb3cDe");
  });

  test("publish metadata defaults to empty strings", async () => {
    const saved = await store.upsertBuild(makeBuild());
    expect(saved.publishedSlug).toBe("");
    expect(saved.publishedFileId).toBe("");
    expect(saved.publishedKey).toBe("");
  });

  test("publish metadata persists across list/read cycles", async () => {
    await store.upsertBuild(makeBuild({
      id: "pub-test",
      publishedSlug: "reaper",
      publishedFileId: "abc12345",
      publishedKey: "somekey",
    }));
    const builds = await store.listBuilds();
    const found = builds.find((b) => b.id === "pub-test");
    expect(found.publishedSlug).toBe("reaper");
    expect(found.publishedFileId).toBe("abc12345");
    expect(found.publishedKey).toBe("somekey");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/buildStore.test.js --verbose`
Expected: FAIL — `publishedSlug` is undefined on saved build

- [ ] **Step 3: Add publish metadata to `normalizeBuild`**

In `src/main/buildStore.js`, in the `normalizeBuild` function (around line 98-114), add after the `gameMode` field:

```js
    publishedSlug: asString(input.publishedSlug, 200),
    publishedFileId: asString(input.publishedFileId, 20),
    publishedKey: asString(input.publishedKey, 100),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/buildStore.test.js --verbose`
Expected: All tests PASS (including existing tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/buildStore.js tests/unit/buildStore.test.js
git commit -m "feat: add publish metadata fields to build store"
```

---

### Task 3: GitHub API — Target Repo and File Deletion

**Files:**
- Modify: `src/main/githubApi.js` (lines 2-3, add `deleteFile` function)
- Modify: `tests/unit/githubApi.test.js`

Change `TARGET_REPO` from `"axiforge"` to `"axibuilds"` and add a `deleteFile` function for slug-change cleanup.

- [ ] **Step 1: Update `TARGET_REPO` constant**

In `src/main/githubApi.js`, line 2, change:
```js
const TARGET_REPO = "axiforge";
```
to:
```js
const TARGET_REPO = "axibuilds";
```

- [ ] **Step 2: Update the `TARGET_REPO` test and stale comment**

In `tests/unit/githubApi.test.js`, update the test (around line 67-69):

```js
describe("TARGET_REPO", () => {
  test("is 'axibuilds'", () => {
    expect(TARGET_REPO).toBe("axibuilds");
  });
});
```

Also update the comment on line 23 from `// "axiforge"` to `// "axibuilds"`.

- [ ] **Step 3: Run existing tests to confirm no other failures**

Run: `npx jest tests/unit/githubApi.test.js --verbose`
Expected: All existing tests PASS with the updated constant

- [ ] **Step 4: Write failing tests for `deleteFile`**

Add to `tests/unit/githubApi.test.js`:

```js
const { deleteFile } = require("../../src/main/githubApi");

describe("deleteFile", () => {
  afterEach(() => { delete global.fetch; });

  test("calls DELETE on contents API with correct path", async () => {
    // First GET to get the file SHA
    global.fetch = jest.fn()
      .mockImplementationOnce(() => okRes({ sha: "abc123" }))
      .mockImplementationOnce(() => okRes({ commit: { sha: "def456" } }));

    await deleteFile(FAKE_TOKEN, FAKE_OWNER, "site/builds/test.enc", "main", "Remove published build");

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [deleteUrl, deleteOpts] = global.fetch.mock.calls[1];
    expect(deleteUrl).toContain("site/builds/test.enc");
    expect(deleteOpts.method).toBe("DELETE");
    const body = JSON.parse(deleteOpts.body);
    expect(body.sha).toBe("abc123");
    expect(body.message).toBe("Remove published build");
    expect(body.branch).toBe("main");
  });

  test("returns silently if file does not exist (404)", async () => {
    global.fetch = jest.fn(() => failRes(404));
    await deleteFile(FAKE_TOKEN, FAKE_OWNER, "site/builds/missing.enc", "main", "Remove");
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx jest tests/unit/githubApi.test.js --verbose`
Expected: FAIL — `deleteFile` not found

- [ ] **Step 6: Implement `deleteFile`**

Add to `src/main/githubApi.js` before `module.exports`:

```js
async function deleteFile(token, owner, filePath, branch = "main", message = "Remove file", repo = TARGET_REPO) {
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  let existingSha;
  try {
    const current = await apiFetch(
      `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
      token
    );
    existingSha = current?.sha;
  } catch (err) {
    if (err.status === 404) return; // File doesn't exist — nothing to delete
    throw err;
  }

  if (!existingSha) return;

  await apiFetch(`/repos/${owner}/${repo}/contents/${encodedPath}`, token, {
    method: "DELETE",
    body: JSON.stringify({
      message,
      sha: existingSha,
      branch,
    }),
  });
}
```

Add `deleteFile` to `module.exports`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest tests/unit/githubApi.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 8: Update repo description in `ensureAxiForgeRepo`**

In `src/main/githubApi.js`, in the `ensureAxiForgeRepo` function (around line 66-69), change the `description` field:
```js
      description: "AxiForge Builds — published GW2 builds",
```

- [ ] **Step 9: Run all githubApi tests to verify description change doesn't break anything**

Run: `npx jest tests/unit/githubApi.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/main/githubApi.js tests/unit/githubApi.test.js
git commit -m "feat: change target repo to axibuilds, add deleteFile for slug cleanup"
```

---

## Chunk 2: Publish Flow — IPC, Site Bundle, Preload, Renderer

### Task 4: Site Bundle — SPA Generation

**Files:**
- Modify: `src/main/siteBundle.js` (full rewrite)
- Modify: `tests/unit/siteBundle.test.js` (full rewrite)

Replace the current "build library" site bundle with SPA files for the per-build publishing approach. The SPA handles client-side routing, decryption via Web Crypto API, and rendering of read-only build views.

Note: The SPA HTML/CSS/JS content is large. This task focuses on the bundle generation functions and structure. The actual SPA rendering code (build viewer, equipment panel, etc.) is covered in Chunk 3 Task 7. For now, the SPA includes the routing, decryption, and a minimal build renderer placeholder that will be expanded in Chunk 3.

- [ ] **Step 1: Write failing tests for new `buildSpaBundle`**

Replace `tests/unit/siteBundle.test.js` contents with:

```js
"use strict";

const { buildSpaBundle, buildEncryptedBuildFile } = require("../../src/main/siteBundle");

describe("buildSpaBundle — file keys", () => {
  test("returns exactly 5 files", () => {
    const bundle = buildSpaBundle();
    const keys = Object.keys(bundle);
    expect(keys).toHaveLength(5);
  });

  test("contains site/index.html", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/index.html"]).toBeTruthy();
  });

  test("contains site/styles.css", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/styles.css"]).toBeTruthy();
  });

  test("contains site/app.js", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/app.js"]).toBeTruthy();
  });

  test("contains site/404.html", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/404.html"]).toBeTruthy();
  });

  test("contains site/.nojekyll", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/.nojekyll"]).toBe("\n");
  });

  test("all values are strings", () => {
    const bundle = buildSpaBundle();
    for (const value of Object.values(bundle)) {
      expect(typeof value).toBe("string");
    }
  });
});

describe("buildSpaBundle — site/index.html", () => {
  let html;
  beforeEach(() => { html = buildSpaBundle()["site/index.html"]; });

  test("is valid HTML5 with doctype", () => {
    expect(html.trimStart()).toMatch(/^<!doctype html>/i);
  });

  test("links to styles.css", () => {
    expect(html).toContain("styles.css");
  });

  test("includes app.js script tag", () => {
    expect(html).toContain("app.js");
  });

  test("has AxiForge Builds title", () => {
    expect(html).toContain("AxiForge Builds");
  });

  test("has lang=en", () => {
    expect(html).toContain('lang="en"');
  });

  test("has viewport meta tag", () => {
    expect(html).toContain("viewport");
  });

  test("loads Cinzel and Exo 2 fonts", () => {
    expect(html).toContain("Cinzel");
    expect(html).toContain("Exo+2");
  });
});

describe("buildSpaBundle — site/404.html", () => {
  let html;
  beforeEach(() => { html = buildSpaBundle()["site/404.html"]; });

  test("is valid HTML5", () => {
    expect(html.trimStart()).toMatch(/^<!doctype html>/i);
  });

  test("stores path in sessionStorage", () => {
    expect(html).toContain("sessionStorage");
  });

  test("redirects to site root", () => {
    expect(html).toContain("location.replace");
  });
});

describe("buildSpaBundle — site/app.js", () => {
  let js;
  beforeEach(() => { js = buildSpaBundle()["site/app.js"]; });

  test("contains decryption logic using crypto.subtle", () => {
    expect(js).toContain("crypto.subtle");
  });

  test("contains AES-GCM algorithm reference", () => {
    expect(js).toContain("AES-GCM");
  });

  test("parses URL fragment for fileId and key", () => {
    expect(js).toContain("location.hash");
  });

  test("fetches encrypted build file", () => {
    expect(js).toContain("builds/");
    expect(js).toContain(".enc");
  });

  test("checks sessionStorage for SPA redirect", () => {
    expect(js).toContain("sessionStorage");
  });

  test("defines escapeHtml function", () => {
    expect(js).toContain("escapeHtml");
  });
});

describe("buildSpaBundle — site/styles.css", () => {
  let css;
  beforeEach(() => { css = buildSpaBundle()["site/styles.css"]; });

  test("defines dark color scheme", () => {
    expect(css).toContain("color-scheme: dark");
  });

  test("uses AxiForge color variables", () => {
    expect(css).toContain("#04070f"); // --bg
    expect(css).toContain("#4fd897"); // --accent (green)
    expect(css).toContain("#48a8ff"); // --accent-2 (blue)
  });

  test("includes navbar styles", () => {
    expect(css).toContain(".navbar");
  });

  test("includes tab styles", () => {
    expect(css).toContain(".tab");
  });
});

describe("buildEncryptedBuildFile", () => {
  test("returns object with filePath and content", () => {
    const result = buildEncryptedBuildFile(
      { title: "Test", profession: "Warrior" },
      "abc12345",
      "someBase64urlKey_that_is_43_chars_longAAAAA"
    );
    expect(result.filePath).toBe("site/builds/abc12345.enc");
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
  });

  test("content is base64 encoded", () => {
    const result = buildEncryptedBuildFile(
      { title: "Test" },
      "abc12345",
      "someBase64urlKey_that_is_43_chars_longAAAAA"
    );
    // Should not throw when decoded as base64
    expect(() => Buffer.from(result.content, "base64")).not.toThrow();
  });

  test("content does not contain plaintext build data", () => {
    const result = buildEncryptedBuildFile(
      { title: "My Secret Build Name" },
      "abc12345",
      "someBase64urlKey_that_is_43_chars_longAAAAA"
    );
    expect(result.content).not.toContain("My Secret Build Name");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/siteBundle.test.js --verbose`
Expected: FAIL — `buildSpaBundle` not found

- [ ] **Step 3: Implement `buildSpaBundle` and `buildEncryptedBuildFile`**

Rewrite `src/main/siteBundle.js`. The SPA HTML/CSS/JS are embedded as template strings. This is the same pattern the existing code uses, but significantly expanded.

```js
// src/main/siteBundle.js
"use strict";

const { encryptBuild } = require("./buildEncryption");

function buildSpaBundle() {
  return {
    "site/index.html": SPA_INDEX_HTML,
    "site/styles.css": SPA_STYLES_CSS,
    "site/app.js": SPA_APP_JS,
    "site/404.html": SPA_404_HTML,
    "site/.nojekyll": "\n",
  };
}

function buildEncryptedBuildFile(buildData, fileId, base64urlKey) {
  const encrypted = encryptBuild(buildData, base64urlKey);
  return {
    filePath: `site/builds/${fileId}.enc`,
    content: encrypted,
  };
}

// ── 404.html — SPA routing fallback ──────────────────────────────────────────
const SPA_404_HTML = `<!doctype html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<script>
  // GitHub Pages SPA routing: save path+hash, redirect to root
  var seg = location.pathname.split('/').filter(Boolean);
  // Remove the repo name (first segment) from the path
  var repoName = seg.length > 0 ? seg[0] : '';
  var buildPath = seg.slice(1).join('/');
  if (buildPath || location.hash) {
    sessionStorage.setItem('spa-redirect', JSON.stringify({
      path: buildPath,
      hash: location.hash
    }));
    location.replace('/' + repoName + '/');
  }
</script>
</body>
</html>
`;

// ── index.html — SPA shell ───────────────────────────────────────────────────
const SPA_INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AxiForge Builds</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Exo+2:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <nav class="navbar">
    <div class="navbar__left">
      <div class="navbar__logo" aria-label="AxiForge logo"></div>
      <span class="navbar__title">AxiForge Builds</span>
    </div>
    <div class="navbar__right">
      <a href="https://github.com/darkharasho/axiforge" target="_blank" rel="noreferrer" class="navbar__link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
        GitHub
      </a>
      <a href="https://discord.gg/UjzMXMGXEg" target="_blank" rel="noreferrer" class="navbar__link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.618-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.009c.12.099.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.076.076 0 00-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.031-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.029z"/></svg>
        Discord
      </a>
    </div>
  </nav>
  <main id="app"></main>
  <script src="app.js" defer></script>
</body>
</html>
`;

// ── styles.css — desktop-matching dark theme ─────────────────────────────────
// Placeholder — will be expanded in Chunk 3 Task 7 with full build viewer styles.
// For now includes navbar, tabs, layout, and base theme.
const SPA_STYLES_CSS = \`:root{
  color-scheme: dark;
  --bg:#04070f;
  --bg2:#070d1b;
  --panel:#101930;
  --panel2:#0c1325;
  --line:#223458;
  --soft-line:#1a2a49;
  --text:#e8f0ff;
  --muted:#a6bbde;
  --accent:#4fd897;
  --accent-2:#48a8ff;
  --danger:#c5485f;
  --radius:14px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  min-height:100vh;
  font-family:"Exo 2",system-ui,sans-serif;
  background:var(--bg);
  color:var(--text);
}
.navbar{
  display:flex;align-items:center;justify-content:space-between;
  padding:10px 24px;background:var(--bg2);border-bottom:1px solid var(--line);
}
.navbar__left{display:flex;align-items:center;gap:12px}
.navbar__logo{
  width:28px;height:28px;background:var(--soft-line);border-radius:6px;
}
.navbar__title{
  font-family:"Cinzel",serif;font-weight:700;font-size:1.1rem;letter-spacing:0.04em;
}
.navbar__right{display:flex;align-items:center;gap:16px}
.navbar__link{
  color:var(--muted);text-decoration:none;font-size:0.85rem;
  display:flex;align-items:center;gap:6px;transition:color 0.15s;
}
.navbar__link:hover{color:var(--text)}
#app{width:min(1100px,94vw);margin:0 auto;padding:24px 0 48px}
.landing{text-align:center;padding:80px 20px}
.landing h1{font-family:"Cinzel",serif;font-size:2rem;margin-bottom:12px}
.landing p{color:var(--muted);font-size:1rem}
.build-header{padding:20px 0 0}
.build-header h1{font-family:"Cinzel",serif;font-size:1.5rem;font-weight:700}
.build-header .meta{color:var(--muted);font-size:0.85rem;margin-top:4px}
.build-header .tags{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.tag{
  background:var(--panel2);border:1px solid var(--line);border-radius:999px;
  padding:3px 10px;font-size:0.75rem;color:var(--muted);
}
.tabs{
  display:flex;gap:0;margin-top:16px;border-bottom:1px solid var(--line);
}
.tab{
  padding:10px 20px;background:none;border:none;
  border-bottom:2px solid transparent;color:var(--muted);
  font-size:0.85rem;cursor:pointer;letter-spacing:0.04em;
  font-family:"Exo 2",system-ui,sans-serif;transition:color 0.15s;
}
.tab:hover{color:var(--text)}
.tab--active{border-bottom-color:var(--accent-2);color:var(--text);font-weight:600}
.tab-content{padding:20px 0}
.error-box{
  padding:20px;background:var(--panel);border:1px solid var(--danger);
  border-radius:var(--radius);color:var(--danger);text-align:center;margin-top:40px;
}
.loading{text-align:center;padding:60px 20px;color:var(--muted)}
\`;

// ── app.js — client-side routing, decryption, rendering ──────────────────────
// Placeholder rendering — will be expanded in Chunk 3 Task 7 with full
// spec/skill/equipment renderers. For now shows build data as JSON.
const SPA_APP_JS = \`(function() {
  "use strict";

  var app = document.getElementById("app");

  // ── SPA redirect recovery ──────────────────────────────────────────────────
  var redirectData = null;
  try {
    var stored = sessionStorage.getItem("spa-redirect");
    if (stored) {
      redirectData = JSON.parse(stored);
      sessionStorage.removeItem("spa-redirect");
    }
  } catch(e) {}

  // ── Route parsing ──────────────────────────────────────────────────────────
  var buildPath = "";
  var fragment = location.hash.slice(1);

  if (redirectData && redirectData.path) {
    buildPath = redirectData.path;
    fragment = (redirectData.hash || "").replace(/^#/, "");
  } else {
    // Parse from current URL: /<repo>/<slug>#<fileId>.<key>
    var segments = location.pathname.split("/").filter(Boolean);
    // segments[0] is repo name, segments[1] is build slug
    buildPath = segments.length > 1 ? segments.slice(1).join("/") : "";
  }

  if (!buildPath || !fragment) {
    renderLanding();
    return;
  }

  // Parse fragment: <fileId>.<base64urlKey>
  var dotIndex = fragment.indexOf(".");
  if (dotIndex < 1) {
    renderError("Invalid build URL — missing encryption key.");
    return;
  }
  var fileId = fragment.substring(0, dotIndex);
  var base64urlKey = fragment.substring(dotIndex + 1);

  loadAndRenderBuild(fileId, base64urlKey);

  // ── Landing page ───────────────────────────────────────────────────────────
  function renderLanding() {
    app.innerHTML = '<div class="landing">' +
      '<h1>AxiForge Builds</h1>' +
      '<p>Publish builds from the <a href="https://github.com/darkharasho/axiforge" style="color:var(--accent-2)">AxiForge desktop app</a> to share them here.</p>' +
      '</div>';
  }

  // ── Error display ──────────────────────────────────────────────────────────
  function renderError(message) {
    app.innerHTML = '<div class="error-box">' + escapeHtml(message) + '</div>';
  }

  // ── Load, decrypt, render ──────────────────────────────────────────────────
  async function loadAndRenderBuild(fileId, b64Key) {
    app.innerHTML = '<div class="loading">Decrypting build...</div>';

    try {
      var res = await fetch("builds/" + encodeURIComponent(fileId) + ".enc", { cache: "no-store" });
      if (!res.ok) throw new Error("Build not found (HTTP " + res.status + ").");
      var base64Payload = await res.text();

      // Decode base64 payload
      var raw = atob(base64Payload);
      var combined = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) combined[i] = raw.charCodeAt(i);

      // Extract IV (12 bytes), ciphertext, auth tag (16 bytes)
      var iv = combined.slice(0, 12);
      var ciphertext = combined.slice(12);

      // Import key from base64url
      var keyBytes = base64urlDecode(b64Key);
      var cryptoKey = await crypto.subtle.importKey(
        "raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]
      );

      // Decrypt (AES-GCM auth tag is appended to ciphertext by Web Crypto)
      var decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        cryptoKey,
        ciphertext
      );

      var json = new TextDecoder().decode(decrypted);
      var build = JSON.parse(json);

      renderBuild(build);
    } catch (err) {
      renderError("Failed to load build: " + (err.message || String(err)));
    }
  }

  // ── Build renderer (placeholder — expanded in Chunk 3) ─────────────────────
  function renderBuild(build) {
    var header = '<div class="build-header">' +
      '<h1>' + escapeHtml(build.title || "Untitled Build") + '</h1>' +
      '<p class="meta">' + escapeHtml(build.profession || "") +
        (build.gameMode ? " \\u2022 " + escapeHtml(build.gameMode.toUpperCase()) : "") +
      '</p>';

    var tags = (build.tags || []);
    if (tags.length) {
      header += '<div class="tags">';
      for (var t = 0; t < tags.length; t++) {
        header += '<span class="tag">' + escapeHtml(tags[t]) + '</span>';
      }
      header += '</div>';
    }
    header += '</div>';

    // Tabs
    var tabsHtml = '<div class="tabs">' +
      '<button class="tab tab--active" data-tab="build">BUILD</button>' +
      '<button class="tab" data-tab="equipment">EQUIPMENT</button>' +
      '</div>';

    // Tab content (placeholder — Chunk 3 adds full renderers)
    var buildTab = '<div class="tab-content" id="tab-build">' +
      renderSpecializations(build) +
      renderSkillBar(build) +
      renderNotes(build) +
      '</div>';

    var equipTab = '<div class="tab-content" id="tab-equipment" style="display:none">' +
      renderEquipment(build) +
      '</div>';

    app.innerHTML = header + tabsHtml + buildTab + equipTab;

    // Tab switching
    var tabBtns = app.querySelectorAll(".tab");
    tabBtns.forEach(function(btn) {
      btn.addEventListener("click", function() {
        tabBtns.forEach(function(b) { b.classList.remove("tab--active"); });
        btn.classList.add("tab--active");
        var target = btn.getAttribute("data-tab");
        document.getElementById("tab-build").style.display = target === "build" ? "" : "none";
        document.getElementById("tab-equipment").style.display = target === "equipment" ? "" : "none";
      });
    });
  }

  // ── Minimal renderers (placeholders — replaced in Chunk 3 Task 7) ──────────
  function renderSpecializations(build) {
    var specs = build.specializations || [];
    if (!specs.length) return '<p style="color:var(--muted)">No specializations.</p>';
    var html = '<h3 class="section-title">Specializations</h3>';
    for (var i = 0; i < specs.length; i++) {
      var s = specs[i];
      html += '<div class="spec-row">' + escapeHtml(s.name || "Unknown") +
        (s.elite ? ' <span style="color:var(--accent);font-size:0.7rem">ELITE</span>' : '') +
        '</div>';
    }
    return html;
  }

  function renderSkillBar(build) {
    var skills = build.skills || {};
    var list = [];
    if (skills.heal) list.push(skills.heal);
    (skills.utility || []).forEach(function(s) { if (s) list.push(s); });
    if (skills.elite) list.push(skills.elite);
    if (!list.length) return '';
    var html = '<h3 class="section-title">Skills</h3><div class="skill-bar">';
    for (var i = 0; i < list.length; i++) {
      html += '<div class="skill-slot">' +
        (list[i].icon ? '<img src="' + escapeAttr(list[i].icon) + '" alt="" loading="lazy" class="skill-icon">' : '') +
        '</div>';
    }
    return html + '</div>';
  }

  function renderNotes(build) {
    if (!build.notes) return '';
    return '<h3 class="section-title">Notes</h3>' +
      '<div class="notes-box">' + escapeHtml(build.notes) + '</div>';
  }

  function renderEquipment(build) {
    var eq = build.equipment || {};
    var html = '<h3 class="section-title">Equipment</h3>';
    if (eq.statPackage) html += '<div class="eq-field"><span class="eq-label">Stats</span> ' + escapeHtml(eq.statPackage) + '</div>';
    if (eq.relic) html += '<div class="eq-field"><span class="eq-label">Relic</span> ' + escapeHtml(eq.relic) + '</div>';
    if (eq.food) html += '<div class="eq-field"><span class="eq-label">Food</span> ' + escapeHtml(eq.food) + '</div>';
    if (eq.utility) html += '<div class="eq-field"><span class="eq-label">Utility</span> ' + escapeHtml(eq.utility) + '</div>';
    return html;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(s) { return escapeHtml(s); }

  function base64urlDecode(str) {
    // base64url -> base64
    var b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var raw = atob(b64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  }
})();
\`;

module.exports = { buildSpaBundle, buildEncryptedBuildFile };
```

**Important:** The backticks in the template strings above need proper escaping. In the actual implementation, the `SPA_STYLES_CSS` and `SPA_APP_JS` constants should use backtick template literals with the content. The plan shows the content — the implementer should write these as proper JS template strings.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/siteBundle.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/siteBundle.js tests/unit/siteBundle.test.js
git commit -m "feat: replace site bundle with SPA for per-build publishing"
```

---

### Task 5: Publish IPC Handler

**Files:**
- Modify: `src/main/index.js` (~lines 1-20 imports, ~lines 252-290 publish handler)
- Modify: `src/preload/index.js` (~line 25)

Wire up the new `builds:publish-build` IPC handler that orchestrates the full publish flow. Also update imports to use new modules.

- [ ] **Step 1: Update imports in `src/main/index.js`**

At the top of `src/main/index.js`, add the new imports:

```js
const { slugifyBuildName, generateFileId, generateEncryptionKey, getDefaultBuildName } = require("./buildEncryption");
const { buildSpaBundle, buildEncryptedBuildFile } = require("./siteBundle");
```

Update the existing siteBundle import — remove `buildSiteBundle`:

```js
// Remove this line:
// const { buildSiteBundle } = require("./siteBundle");
```

Also add `deleteFile` to the githubApi import:

```js
const {
  TARGET_REPO,
  getViewer,
  listTargets,
  ensureAxiForgeRepo,
  ensurePages,
  getPagesBuildStatus,
  getRepo,
  ensurePagesWorkflow,
  triggerPagesWorkflow,
  publishSiteBundle,
  deleteFile,
} = require("./githubApi");
```

- [ ] **Step 2: Replace `builds:publish-site` IPC handler with `builds:publish-build`**

Replace the existing `builds:publish-site` handler (around lines 252-290) with:

```js
  ipcMain.handle("builds:publish-build", async (_e, buildId) => {
    const session = await getSession();
    if (!session) {
      throw new Error("You must log in with GitHub before publishing.");
    }

    const auth = await getAuthRecord();
    const branch = auth?.onboarding?.branch || "main";
    const owner = auth?.onboarding?.targetOwner || session.viewer.login;

    // Load the build
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === buildId);
    if (!build) throw new Error("Build not found.");

    // Auto-populate build name if empty or default
    if (!build.title?.trim() || build.title === "Untitled Build") {
      const defaultName = getDefaultBuildName(build.specializations, build.profession);
      build.title = defaultName;
      await store.upsertBuild(build);
    }

    // Validate
    if (!build.title) throw new Error("Build name is required for publishing.");
    if (!build.profession) throw new Error("Build must have a profession selected.");

    // Generate or reuse publish metadata
    const fileId = build.publishedFileId || generateFileId();
    const encKey = build.publishedKey || generateEncryptionKey();
    const newSlug = slugifyBuildName(build.title);
    const oldSlug = build.publishedSlug || "";

    // Ensure repo and site infrastructure exist
    await ensureAxiForgeRepo(session.token, owner, "user");
    await ensurePagesWorkflow(session.token, owner, branch, TARGET_REPO);
    await ensurePages(session.token, owner, branch, TARGET_REPO);

    // Deploy SPA files if not already deployed.
    // publishSiteBundle compares SHA hashes and skips unchanged files,
    // so this is effectively a no-op after the first publish.
    const spaBundle = buildSpaBundle();
    await publishSiteBundle(session.token, owner, spaBundle, branch, TARGET_REPO);

    // Note: slug changes don't affect the file path (which is based on fileId),
    // so no deletion is needed. The file at site/builds/<fileId>.enc is overwritten in place.

    // Encrypt and commit the build
    const encFile = buildEncryptedBuildFile(build, fileId, encKey);
    const encBundle = { [encFile.filePath]: encFile.content };
    await publishSiteBundle(session.token, owner, encBundle, branch, TARGET_REPO);

    // Trigger Pages rebuild
    await triggerPagesWorkflow(session.token, owner, branch, TARGET_REPO).catch(() => null);

    // Update build with publish metadata
    await store.upsertBuild({
      ...build,
      publishedSlug: newSlug,
      publishedFileId: fileId,
      publishedKey: encKey,
    });

    const pagesUrl = `https://${owner}.github.io/${TARGET_REPO}/${newSlug}#${fileId}.${encKey}`;

    await patchAuthRecord({
      onboarding: {
        repoReady: true,
        forkReady: true,
        repoName: TARGET_REPO,
        pagesReady: false,
        pagesBuildStatus: "queued",
        pagesBuildUpdatedAt: new Date().toISOString(),
        pagesBuildError: null,
        pagesUrl: `https://${owner}.github.io/${TARGET_REPO}/`,
        branch,
        targetOwner: owner,
      },
    });

    return {
      pagesUrl,
      slug: newSlug,
      fileId,
      changed: true,
    };
  });
```

- [ ] **Step 3: Update `setupRepoPages` to use `buildSpaBundle`**

In the `setupRepoPages` function (around lines 309-369), replace:
```js
      const emptySite = buildSiteBundle([]);
```
with:
```js
      const emptySite = buildSpaBundle();
```

- [ ] **Step 4: Add `publishBuild` to preload**

In `src/preload/index.js`, add after the `publishSite` line (around line 25):

```js
  publishBuild: (buildId) => ipcRenderer.invoke("builds:publish-build", buildId),
```

- [ ] **Step 5: Run all existing tests to confirm nothing is broken**

Run: `npx jest --verbose`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: add builds:publish-build IPC handler with encryption and slug management"
```

---

### Task 6: Renderer — Publish Button and Auto-Name

**Files:**
- Modify: `src/renderer/modules/render-pages.js` (~lines 250-290 build card, ~lines 307-343 editor form)

Add a "Publish" button to each build card and to the editor toolbar. When clicked, it publishes the current/selected build and shows the URL.

- [ ] **Step 1: Add "Publish" button to build cards**

In `src/renderer/modules/render-pages.js`, in the `renderBuildList` function, inside the `for (const build of visible)` loop, after the `deleteBtn` line and before `actions.append(loadBtn, deleteBtn)`, add:

```js
    const publishBtn = makeButton("Publish", "secondary", async () => {
      const status = state.onboarding;
      if (!status?.isAuthenticated || !status?.repoReady) {
        showError(new Error("Set up publishing in the user menu first."));
        return;
      }
      try {
        publishBtn.disabled = true;
        publishBtn.textContent = "Publishing...";
        // If this build is the active editor build and has unsaved changes, save first
        if (build.id === state.editor.id && state.editorDirty) {
          const serialized = _callbacks.serializeEditorToBuild();
          await window.desktopApi.saveBuild({ ...serialized, id: build.id });
          await _callbacks.reloadBuilds();
        }
        const result = await window.desktopApi.publishBuild(build.id);
        if (result?.pagesUrl) {
          await window.desktopApi.writeClipboardText(result.pagesUrl);
          setPublishStatus(`Published! URL copied: ${result.pagesUrl}`);
        }
        await _callbacks.reloadBuilds();
        render();
      } catch (err) {
        showError(err);
      } finally {
        publishBtn.disabled = false;
        publishBtn.textContent = "Publish";
      }
    });
    const canPublish = Boolean(state.onboarding?.isAuthenticated && state.onboarding?.repoReady);
    publishBtn.disabled = !canPublish;
    actions.append(loadBtn, publishBtn, deleteBtn);
```

Also update the existing `actions.append(loadBtn, deleteBtn)` line — replace it with the new line above.

- [ ] **Step 2: Add `serializeEditorToBuild` to the callbacks interface**

`serializeEditorToBuild` is already passed to `initRenderPagesCallbacks` in `renderer.js` (around line 149). Confirm it's available as `_callbacks.serializeEditorToBuild` in render-pages.js. No changes needed if already there.

- [ ] **Step 3: Update the publishSiteBtn click handler in `renderer.js`**

In `renderer.js`, find the `publishSiteBtn` click handler (search for `publishSiteBtn` or `publish-site`). Replace the existing handler that calls `desktopApi.publishSite()` with the new per-build publish flow:

```js
el.publishSiteBtn.addEventListener("click", async () => {
  if (!state.editor.id) {
    showError(new Error("Save the build first before publishing."));
    return;
  }
  try {
    el.publishSiteBtn.disabled = true;
    setPublishStatus("Publishing...");
    // Save current editor state first if dirty
    if (state.editorDirty) {
      const serialized = serializeEditorToBuild();
      await window.desktopApi.saveBuild({ ...serialized, id: state.editor.id });
      state.builds = await window.desktopApi.listBuilds();
      captureEditorBaseline();
    }
    const result = await window.desktopApi.publishBuild(state.editor.id);
    if (result?.pagesUrl) {
      await window.desktopApi.writeClipboardText(result.pagesUrl);
      setPublishStatus(`Published! URL copied: ${result.pagesUrl}`);
    }
    state.builds = await window.desktopApi.listBuilds();
    render();
  } catch (err) {
    showError(err);
  } finally {
    el.publishSiteBtn.disabled = false;
  }
});
```

Remove the old `publishSite`-based handler entirely. Also remove the `runPagesBuildPoll()` call — the per-build publish doesn't need to poll since the user gets the URL immediately.

- [ ] **Step 4: Run the app manually to verify the Publish button appears and works**

Run: `npm run dev`
Expected: Build cards show "Publish" button. Clicking it with GitHub auth set up publishes the build and copies the URL.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/render-pages.js src/renderer/renderer.js
git commit -m "feat: add Publish button to build cards and editor toolbar"
```

---

## Chunk 3: SPA Build Viewer — Full Renderers

### Task 7: Full SPA Build and Equipment Renderers

**Files:**
- Modify: `src/main/siteBundle.js` (expand `SPA_STYLES_CSS` and `SPA_APP_JS` strings)
- Modify: `tests/unit/siteBundle.test.js`

Replace the placeholder renderers in the SPA with full, desktop-matching build and equipment viewers. This is the largest task — it expands the embedded CSS and JS to render specialization grids, skill bars with icons, trait hover tooltips, equipment panels with icons, and all profession-specific sections.

The SPA JS grows significantly but remains a single embedded string in `siteBundle.js`. This matches the existing pattern where the entire site is inline. The implementer should study these desktop renderer files for reference:
- `src/renderer/modules/specializations.js` — spec row rendering, trait grid, spec connector
- `src/renderer/modules/skills.js` — skill bar, mechanic slots, bundle expansion
- `src/renderer/modules/equipment.js` — equipment panel, stat cards, upgrade slots
- `src/renderer/modules/detail-panel.js` — hover tooltip rendering
- `src/renderer/styles/` — all CSS files for the component styles

**Note:** Since the SPA code is embedded strings, it cannot import from the desktop modules directly. The implementer must write read-only equivalents that accept a build object and render HTML. Study the desktop modules for the data shapes and DOM structure to replicate.

- [ ] **Step 1: Add tests for full specialization rendering**

Add to `tests/unit/siteBundle.test.js`:

```js
describe("buildSpaBundle — app.js specialization rendering", () => {
  let js;
  beforeEach(() => { js = buildSpaBundle()["site/app.js"]; });

  test("renders specialization icon images", () => {
    expect(js).toContain("spec-icon");
  });

  test("renders trait grid with 3 tiers", () => {
    expect(js).toContain("trait-grid");
  });

  test("highlights selected traits based on majorChoices", () => {
    expect(js).toContain("majorChoices");
  });

  test("shows minor traits", () => {
    expect(js).toContain("minorTrait");
  });

  test("marks elite specs visually", () => {
    expect(js).toContain("elite");
  });
});

describe("buildSpaBundle — app.js skill rendering", () => {
  let js;
  beforeEach(() => { js = buildSpaBundle()["site/app.js"]; });

  test("renders skill icons with img tags", () => {
    expect(js).toContain("skill-icon");
  });

  test("separates heal, utility, elite skill groups", () => {
    expect(js).toContain("heal");
    expect(js).toContain("elite");
  });

  test("renders underwater skills section", () => {
    expect(js).toContain("underwater");
  });
});

describe("buildSpaBundle — app.js equipment rendering", () => {
  let js;
  beforeEach(() => { js = buildSpaBundle()["site/app.js"]; });

  test("renders armor slots", () => {
    expect(js).toContain("head");
    expect(js).toContain("shoulders");
    expect(js).toContain("chest");
  });

  test("renders weapon sets", () => {
    expect(js).toContain("mainhand");
    expect(js).toContain("offhand");
  });

  test("renders runes section", () => {
    expect(js).toContain("rune");
  });

  test("renders sigils section", () => {
    expect(js).toContain("sigil");
  });

  test("renders infusions section", () => {
    expect(js).toContain("infusion");
  });

  test("renders relic, food, utility cards", () => {
    expect(js).toContain("relic");
    expect(js).toContain("food");
  });
});

describe("buildSpaBundle — app.js bundle expansion", () => {
  let js;
  beforeEach(() => { js = buildSpaBundle()["site/app.js"]; });

  test("contains click event handling for bundles", () => {
    expect(js).toContain("data-bundle");
  });

  test("contains bundle-expand class", () => {
    expect(js).toContain("bundle-expand");
  });
});

describe("buildSpaBundle — app.js hover tooltips", () => {
  let js;
  beforeEach(() => { js = buildSpaBundle()["site/app.js"]; });

  test("contains mouseover/mouseout event handling", () => {
    expect(js).toContain("mouseover");
    expect(js).toContain("mouseout");
  });

  test("renders tooltip with description", () => {
    expect(js).toContain("tooltip");
    expect(js).toContain("description");
  });
});

describe("buildSpaBundle — styles.css full styles", () => {
  let css;
  beforeEach(() => { css = buildSpaBundle()["site/styles.css"]; });

  test("includes specialization row styles", () => {
    expect(css).toContain(".spec-row");
  });

  test("includes trait grid styles", () => {
    expect(css).toContain(".trait-grid");
  });

  test("includes skill bar styles", () => {
    expect(css).toContain(".skill-bar");
  });

  test("includes equipment panel styles", () => {
    expect(css).toContain(".eq-panel");
  });

  test("includes tooltip styles", () => {
    expect(css).toContain(".tooltip");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/siteBundle.test.js --verbose`
Expected: FAIL — placeholder renderers don't have the required classes/elements

- [ ] **Step 3: Expand `SPA_STYLES_CSS` with full component styles**

In `src/main/siteBundle.js`, expand the `SPA_STYLES_CSS` string to include styles for:
- `.spec-row` — specialization row with icon, name, trait grid
- `.trait-grid` — 3×3 trait grid with tier separators
- `.trait-icon` — individual trait with selected/unselected states
- `.minorTrait` — minor trait (always selected, diamond shape)
- `.skill-bar` — horizontal skill icon row with heal/utility/elite sections
- `.skill-slot`, `.skill-icon` — individual skill slots
- `.eq-panel` — two-column equipment layout
- `.eq-card` — equipment info card (stat package, relic, food, etc.)
- `.eq-slot` — individual equipment slot with icon
- `.tooltip` — floating tooltip for trait/skill hover
- `.section-title` — section headings (SPECIALIZATIONS, SKILLS, etc.)
- `.notes-box` — notes display container
- `.uw-section` — underwater skills section
- Responsive styles for smaller viewports

Reference the desktop styles in `src/renderer/styles/` for the exact colors, spacing, and visual language. The web version should match.

- [ ] **Step 4: Expand `SPA_APP_JS` specialization renderer**

Replace the placeholder `renderSpecializations` function with a full implementation that:
- Renders each spec as a row with spec icon image, spec name, and elite badge
- Renders a 3-tier trait grid for each spec: 3 minor traits (always selected) and 3×3 major traits
- Highlights the selected major trait per tier based on `majorChoices`
- Adds `data-trait-id` attributes for tooltip hover
- Adds mouseover/mouseout event handlers for trait tooltips

```js
function renderSpecializations(build) {
  var specs = build.specializations || [];
  if (!specs.length) return '';
  var html = '<h3 class="section-title">Specializations</h3>';
  for (var i = 0; i < specs.length; i++) {
    var s = specs[i];
    var isElite = s.elite;
    html += '<div class="spec-row' + (isElite ? ' spec-row--elite' : '') + '">';
    // Spec icon
    if (s.icon) {
      html += '<img src="' + escapeAttr(s.icon) + '" class="spec-icon" alt="" loading="lazy">';
    }
    html += '<div class="spec-info">';
    html += '<div class="spec-name">' + escapeHtml(s.name || '') + (isElite ? ' <span class="elite-badge">ELITE</span>' : '') + '</div>';
    // Trait grid: 3 tiers
    html += '<div class="trait-grid">';
    for (var tier = 1; tier <= 3; tier++) {
      var minors = s.minorTraits || [];
      var minorForTier = minors[tier - 1];
      var majors = (s.majorTraitsByTier && s.majorTraitsByTier[tier]) || [];
      var selectedId = (s.majorChoices && s.majorChoices[tier]) || 0;

      // Minor trait
      if (minorForTier) {
        html += '<div class="minorTrait" data-trait-id="' + minorForTier.id + '" data-name="' + escapeAttr(minorForTier.name) + '" data-desc="' + escapeAttr(minorForTier.description || '') + '">';
        if (minorForTier.icon) html += '<img src="' + escapeAttr(minorForTier.icon) + '" alt="" class="trait-img">';
        html += '</div>';
      }

      // Major traits (3 per tier)
      html += '<div class="tier-group">';
      for (var m = 0; m < majors.length; m++) {
        var trait = majors[m];
        var sel = trait.id === selectedId ? ' trait-icon--selected' : '';
        html += '<div class="trait-icon' + sel + '" data-trait-id="' + trait.id + '" data-name="' + escapeAttr(trait.name) + '" data-desc="' + escapeAttr(trait.description || '') + '">';
        if (trait.icon) html += '<img src="' + escapeAttr(trait.icon) + '" alt="" class="trait-img">';
        html += '</div>';
      }
      html += '</div>';
      if (tier < 3) html += '<div class="tier-sep"></div>';
    }
    html += '</div></div></div>';
  }
  return html;
}
```

- [ ] **Step 5: Expand `SPA_APP_JS` skill bar renderer**

Replace the placeholder `renderSkillBar` function with a full implementation. Reference `src/renderer/modules/skills.js` for data shapes.

```js
function renderSkillBar(build) {
  var skills = build.skills || {};
  var html = '<h3 class="section-title">Skills</h3>';

  // Main skill bar: heal | utility x3 | elite
  html += '<div class="skill-bar">';
  html += renderSkillSlot(skills.heal, 'heal');
  html += '<div class="skill-sep"></div>';
  var utils = skills.utility || [];
  for (var i = 0; i < 3; i++) {
    html += renderSkillSlot(utils[i], 'utility');
  }
  html += '<div class="skill-sep"></div>';
  html += renderSkillSlot(skills.elite, 'elite');
  html += '</div>';

  // Underwater skills (if any non-zero)
  var uw = build.underwaterSkills || {};
  var hasUW = uw.heal || (uw.utility || []).some(function(s) { return s; }) || uw.elite;
  if (hasUW) {
    html += '<h3 class="section-title">Underwater Skills</h3>';
    html += '<div class="skill-bar uw-section">';
    html += renderSkillSlot(uw.heal, 'heal');
    html += '<div class="skill-sep"></div>';
    var uwUtils = uw.utility || [];
    for (var j = 0; j < 3; j++) {
      html += renderSkillSlot(uwUtils[j], 'utility');
    }
    html += '<div class="skill-sep"></div>';
    html += renderSkillSlot(uw.elite, 'elite');
    html += '</div>';
  }

  // Profession-specific sections
  html += renderProfessionMechanics(build);

  return html;
}

function renderSkillSlot(skill, type) {
  if (!skill) return '<div class="skill-slot skill-slot--empty"></div>';
  return '<div class="skill-slot skill-slot--' + type + '" data-name="' + escapeAttr(skill.name) + '" data-desc="' + escapeAttr(skill.description || '') + '">' +
    (skill.icon ? '<img src="' + escapeAttr(skill.icon) + '" alt="" class="skill-icon" loading="lazy">' : '') +
    '</div>';
}

function renderProfessionMechanics(build) {
  var html = '';

  // Revenant: selected legends
  var legends = build.selectedLegends || [];
  if (legends.some(function(l) { return l; })) {
    html += '<div class="mechanic-section"><span class="eq-label">Legends</span> ' +
      legends.filter(Boolean).map(escapeHtml).join(' / ') + '</div>';
  }

  // Ranger: selected pets
  var pets = build.selectedPets || {};
  var hasPets = pets.terrestrial1 || pets.terrestrial2 || pets.aquatic1 || pets.aquatic2;
  if (hasPets) {
    html += '<div class="mechanic-section"><span class="eq-label">Pets</span>';
    if (pets.terrestrial1) html += ' T1: ' + pets.terrestrial1;
    if (pets.terrestrial2) html += ' T2: ' + pets.terrestrial2;
    if (pets.aquatic1) html += ' A1: ' + pets.aquatic1;
    if (pets.aquatic2) html += ' A2: ' + pets.aquatic2;
    html += '</div>';
  }

  // Elementalist/Weaver: attunement display
  if (build.activeAttunement) {
    html += '<div class="mechanic-section"><span class="eq-label">Attunement</span> ' +
      escapeHtml(build.activeAttunement);
    if (build.activeAttunement2 && build.activeAttunement2 !== build.activeAttunement) {
      html += ' / ' + escapeHtml(build.activeAttunement2);
    }
    html += '</div>';
  }

  // Vindicator: alliance tactics form
  if (build.allianceTacticsForm !== undefined && build.allianceTacticsForm !== 0) {
    html += '<div class="mechanic-section"><span class="eq-label">Alliance Form</span> ' +
      (build.allianceTacticsForm === 1 ? 'Saint Viktor' : 'Archemorus') + '</div>';
  }

  return html;
}
```

- [ ] **Step 6: Expand `SPA_APP_JS` equipment renderer**

Replace the placeholder `renderEquipment` function with a full implementation. Reference `src/renderer/modules/equipment.js` for the desktop layout.

```js
function renderEquipment(build) {
  var eq = build.equipment || {};
  var html = '<div class="eq-panel">';

  // Left column: stats, armor, trinkets
  html += '<div class="eq-col">';

  // Stat package
  html += '<div class="eq-card"><div class="eq-label">STAT PACKAGE</div>' +
    '<div class="eq-value">' + escapeHtml(eq.statPackage || '—') + '</div></div>';

  // Armor slots
  var armorSlots = ['head', 'shoulders', 'chest', 'hands', 'legs', 'feet'];
  html += '<div class="eq-card"><div class="eq-label">ARMOR</div>';
  for (var a = 0; a < armorSlots.length; a++) {
    var slot = armorSlots[a];
    var statName = (eq.slots && eq.slots[slot]) || '';
    var runeName = (eq.runes && eq.runes[slot]) || '';
    html += '<div class="eq-slot">' +
      '<span class="eq-slot-name">' + escapeHtml(slot) + '</span>' +
      (statName ? ' <span class="eq-slot-stat">' + escapeHtml(statName) + '</span>' : '') +
      (runeName ? ' <span class="eq-slot-rune">' + escapeHtml(runeName) + '</span>' : '') +
      '</div>';
  }
  html += '</div>';

  // Trinkets
  var trinketSlots = ['back', 'amulet', 'ring1', 'ring2', 'accessory1', 'accessory2'];
  html += '<div class="eq-card"><div class="eq-label">TRINKETS</div>';
  for (var t = 0; t < trinketSlots.length; t++) {
    var tSlot = trinketSlots[t];
    var tStat = (eq.slots && eq.slots[tSlot]) || '';
    html += '<div class="eq-slot">' +
      '<span class="eq-slot-name">' + escapeHtml(tSlot) + '</span>' +
      (tStat ? ' <span class="eq-slot-stat">' + escapeHtml(tStat) + '</span>' : '') +
      '</div>';
  }
  html += '</div>';

  html += '</div>'; // end left col

  // Right column: weapons, sigils, consumables
  html += '<div class="eq-col">';

  // Weapons
  html += '<div class="eq-card"><div class="eq-label">WEAPONS</div>';
  var weaponSets = [
    { label: 'Set 1', mh: 'mainhand1', oh: 'offhand1' },
    { label: 'Set 2', mh: 'mainhand2', oh: 'offhand2' },
    { label: 'Aquatic 1', mh: 'aquatic1', oh: null },
    { label: 'Aquatic 2', mh: 'aquatic2', oh: null },
  ];
  for (var w = 0; w < weaponSets.length; w++) {
    var ws = weaponSets[w];
    var mh = (eq.weapons && eq.weapons[ws.mh]) || '';
    var oh = ws.oh ? ((eq.weapons && eq.weapons[ws.oh]) || '') : '';
    if (!mh && !oh) continue;
    html += '<div class="eq-weapon-row"><span class="eq-label-sm">' + ws.label + '</span> ';
    if (mh) html += escapeHtml(mh);
    if (oh) html += ' / ' + escapeHtml(oh);
    html += '</div>';

    // Sigils for this weapon set
    var mhSigils = (eq.sigils && eq.sigils[ws.mh]) || [];
    var ohSigils = ws.oh ? ((eq.sigils && eq.sigils[ws.oh]) || []) : [];
    var allSigils = mhSigils.concat(ohSigils).filter(Boolean);
    if (allSigils.length) {
      html += '<div class="eq-sigils">';
      for (var si = 0; si < allSigils.length; si++) {
        html += '<span class="eq-sigil">' + escapeHtml(allSigils[si]) + '</span>';
      }
      html += '</div>';
    }
  }
  html += '</div>';

  // Rune summary (all armor shares same rune typically)
  var runeValues = Object.values(eq.runes || {}).filter(Boolean);
  var uniqueRunes = runeValues.filter(function(v, i, a) { return a.indexOf(v) === i; });
  if (uniqueRunes.length) {
    html += '<div class="eq-card"><div class="eq-label">RUNE</div>' +
      '<div class="eq-value">' + uniqueRunes.map(escapeHtml).join(', ') + '</div></div>';
  }

  // Relic, food, utility, enrichment
  var consumables = [
    { label: 'RELIC', value: eq.relic },
    { label: 'FOOD', value: eq.food },
    { label: 'UTILITY', value: eq.utility },
    { label: 'ENRICHMENT', value: eq.enrichment },
  ];
  for (var c = 0; c < consumables.length; c++) {
    if (consumables[c].value) {
      html += '<div class="eq-card"><div class="eq-label">' + consumables[c].label + '</div>' +
        '<div class="eq-value">' + escapeHtml(consumables[c].value) + '</div></div>';
    }
  }

  // Infusions summary
  var infusionValues = [];
  var infObj = eq.infusions || {};
  for (var ik in infObj) {
    var iv = infObj[ik];
    if (Array.isArray(iv)) {
      iv.forEach(function(v) { if (v) infusionValues.push(v); });
    } else if (iv) {
      infusionValues.push(iv);
    }
  }
  if (infusionValues.length) {
    // Count duplicates for summary display
    var infCounts = {};
    infusionValues.forEach(function(v) { infCounts[v] = (infCounts[v] || 0) + 1; });
    html += '<div class="eq-card"><div class="eq-label">INFUSIONS</div>';
    for (var inf in infCounts) {
      html += '<div class="eq-value">' + infCounts[inf] + '× ' + escapeHtml(inf) + '</div>';
    }
    html += '</div>';
  }

  html += '</div>'; // end right col
  html += '</div>'; // end eq-panel

  return html;
}
```

- [ ] **Step 7: Expand `SPA_APP_JS` tooltip system**

Add tooltip infrastructure:
- On mouseover of any element with `data-trait-id` or `data-skill-id`, show a floating tooltip
- Tooltip displays: name, description, and any embedded facts
- Position tooltip relative to the hovered element
- On mouseout, hide the tooltip
- Add a `.tooltip` container element to the page

```js
// Tooltip system
var tooltipEl = document.createElement('div');
tooltipEl.className = 'tooltip';
tooltipEl.style.display = 'none';
document.body.appendChild(tooltipEl);

document.addEventListener('mouseover', function(e) {
  var target = e.target.closest('[data-name]');
  if (!target) return;
  var name = target.getAttribute('data-name');
  var desc = target.getAttribute('data-desc') || '';
  if (!name) return;
  tooltipEl.innerHTML = '<div class="tooltip__name">' + escapeHtml(name) + '</div>' +
    (desc ? '<div class="tooltip__desc">' + escapeHtml(desc) + '</div>' : '');
  tooltipEl.style.display = '';
  var rect = target.getBoundingClientRect();
  tooltipEl.style.left = rect.left + 'px';
  tooltipEl.style.top = (rect.bottom + 8) + 'px';
});

document.addEventListener('mouseout', function(e) {
  var target = e.target.closest('[data-name]');
  if (target) tooltipEl.style.display = 'none';
});
```

- [ ] **Step 8: Add bundle expansion interactivity**

Add click-to-expand for kit/toolbelt skills. When a skill has sub-skills (bundle data encoded as a `data-bundle` JSON attribute), clicking it toggles an expanded skill list below.

```js
// Bundle expansion: click a skill with bundle data to show sub-skills
document.addEventListener('click', function(e) {
  var slot = e.target.closest('.skill-slot[data-bundle]');
  if (!slot) return;
  var existing = slot.querySelector('.bundle-expand');
  if (existing) {
    existing.remove();
    return;
  }
  var bundleData;
  try { bundleData = JSON.parse(slot.getAttribute('data-bundle')); } catch(ex) { return; }
  if (!Array.isArray(bundleData) || !bundleData.length) return;
  var expand = document.createElement('div');
  expand.className = 'bundle-expand';
  for (var i = 0; i < bundleData.length; i++) {
    var sk = bundleData[i];
    expand.innerHTML += '<div class="bundle-skill" data-name="' + escapeAttr(sk.name) + '" data-desc="' + escapeAttr(sk.description || '') + '">' +
      (sk.icon ? '<img src="' + escapeAttr(sk.icon) + '" class="skill-icon" alt="">' : '') +
      '<span>' + escapeHtml(sk.name) + '</span></div>';
  }
  slot.appendChild(expand);
});
```

Add corresponding `.bundle-expand` and `.bundle-skill` styles to `SPA_STYLES_CSS`:
```css
.bundle-expand{position:absolute;top:100%;left:0;z-index:10;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px;display:flex;gap:4px;flex-wrap:wrap}
.bundle-skill{display:flex;align-items:center;gap:4px;font-size:0.75rem;padding:3px 6px;border-radius:4px;background:var(--panel2)}
.bundle-skill .skill-icon{width:24px;height:24px;border-radius:4px}
.skill-slot{position:relative}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx jest tests/unit/siteBundle.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 10: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests PASS across all test files

- [ ] **Step 11: Commit**

```bash
git add src/main/siteBundle.js tests/unit/siteBundle.test.js
git commit -m "feat: add full SPA build and equipment renderers with bundle expansion and tooltips"
```

---

### Task 8: End-to-End Manual Testing

**Files:** None (manual verification)

Verify the full publish flow works end-to-end by publishing a build from the desktop app and viewing it in a browser.

- [ ] **Step 1: Start the dev app**

Run: `npm run dev`

- [ ] **Step 2: Create a test build**

In the app:
1. Select a profession (e.g., Necromancer)
2. Pick specializations (including Reaper as elite)
3. Select skills
4. Set equipment (stat package, weapons, runes, sigils)
5. Add tags and notes
6. Save the build

- [ ] **Step 3: Publish the build**

Click "Publish" on the build card. Verify:
- Build name auto-populates to "Reaper" if not set
- Progress shows "Publishing..."
- URL is copied to clipboard on success
- Status message shows the published URL

- [ ] **Step 4: Open the published URL in a browser**

Open the copied URL. Verify:
- Navbar shows logo + "AxiForge Builds" + GitHub/Discord links
- Build header shows name, profession, game mode, tags
- BUILD tab shows specializations with trait grids, skills with icons
- EQUIPMENT tab shows weapons, runes, sigils, stat package, etc.
- Hover tooltips work on traits and skills
- Tab switching works

- [ ] **Step 5: Re-publish with a name change**

1. Change the build name in the desktop app
2. Save and re-publish
3. Verify the old URL returns a 404 / error
4. Verify the new URL works with the updated name

- [ ] **Step 6: Verify repo contents**

Check the `axibuilds` repo on GitHub:
- `site/index.html`, `site/styles.css`, `site/app.js`, `site/404.html` exist
- `site/builds/<fileId>.enc` exists
- The `.enc` file is not human-readable (encrypted)
- `.github/workflows/deploy-pages.yml` exists

- [ ] **Step 7: Commit any fixes discovered during testing**

```bash
git add src/main/siteBundle.js src/main/buildEncryption.js src/main/githubApi.js src/main/index.js src/renderer/modules/render-pages.js
git commit -m "fix: address issues found during end-to-end testing"
```

(Skip this step if no fixes were needed.)

---
