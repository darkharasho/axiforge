"use strict";

const crypto = require("node:crypto");
const {
  TARGET_REPO,
  VIEWER_GUARD_PATH,
  viewerGuardWorkflow,
  getViewer,
  listTargets,
  ensureAxiForgeRepo,
  ensurePages,
  getPagesBuildStatus,
  ensurePagesWorkflow,
  publishSiteBundle,
  deleteFile,
} = require("../../src/main/githubApi");

const { createGithubMockFetch } = require("../helpers/mockFetch");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_TOKEN = "ghs_faketoken123";
const FAKE_OWNER = "octocat";
const FAKE_REPO = TARGET_REPO; // "axibuilds"

function makeHeaders(overrides = {}) {
  return {
    get: (name) => {
      const lower = name.toLowerCase();
      return overrides[lower] ?? null;
    },
  };
}

function okRes(data, headers = {}) {
  const body = JSON.stringify(data);
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(body),
    headers: makeHeaders(headers),
  });
}

function failRes(status, message = "Error", headers = {}) {
  const data = { message };
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: makeHeaders(headers),
  });
}

// Build a fake git blob SHA for known content (mirrors computeGitBlobSha in githubApi)
function computeGitBlobSha(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// TARGET_REPO constant
// ---------------------------------------------------------------------------

describe("TARGET_REPO", () => {
  test("is 'axibuilds'", () => {
    expect(TARGET_REPO).toBe("axibuilds");
  });
});

// ---------------------------------------------------------------------------
// getViewer
// ---------------------------------------------------------------------------

describe("getViewer", () => {
  afterEach(() => { delete global.fetch; });

  test("returns viewer shape from API response", async () => {
    global.fetch = jest.fn(() => okRes({
      login: "octocat",
      id: 1,
      avatar_url: "https://avatars.githubusercontent.com/u/1",
      html_url: "https://github.com/octocat",
    }));
    const viewer = await getViewer(FAKE_TOKEN);
    expect(viewer.login).toBe("octocat");
    expect(viewer.id).toBe(1);
    expect(viewer.avatarUrl).toBe("https://avatars.githubusercontent.com/u/1");
    expect(viewer.htmlUrl).toBe("https://github.com/octocat");
  });

  test("sends correct Authorization header", async () => {
    global.fetch = jest.fn(() => okRes({ login: "x", id: 1, avatar_url: "", html_url: "" }));
    await getViewer(FAKE_TOKEN);
    const init = global.fetch.mock.calls[0][1];
    expect(init.headers["Authorization"]).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  test("sends correct Accept header", async () => {
    global.fetch = jest.fn(() => okRes({ login: "x", id: 1, avatar_url: "", html_url: "" }));
    await getViewer(FAKE_TOKEN);
    const init = global.fetch.mock.calls[0][1];
    expect(init.headers["Accept"]).toBe("application/vnd.github+json");
  });

  test("sends X-GitHub-Api-Version header", async () => {
    global.fetch = jest.fn(() => okRes({ login: "x", id: 1, avatar_url: "", html_url: "" }));
    await getViewer(FAKE_TOKEN);
    const init = global.fetch.mock.calls[0][1];
    expect(init.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  test("throws error with status code on non-OK response", async () => {
    global.fetch = jest.fn(() => failRes(401, "Bad credentials"));
    await expect(getViewer(FAKE_TOKEN)).rejects.toThrow("Bad credentials");
  });

  test("thrown error has status property", async () => {
    global.fetch = jest.fn(() => failRes(403, "Forbidden"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.status).toBe(403);
  });

  test("thrown error has path property", async () => {
    global.fetch = jest.fn(() => failRes(401, "Unauthorized"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.path).toBe("/user");
  });
});

// ---------------------------------------------------------------------------
// listTargets
// ---------------------------------------------------------------------------

describe("listTargets", () => {
  afterEach(() => { delete global.fetch; });

  test("includes viewer login as user target", async () => {
    global.fetch = jest.fn(() => okRes([])); // no orgs
    const targets = await listTargets(FAKE_TOKEN, "mylogin");
    const user = targets.find((t) => t.type === "user");
    expect(user).toBeTruthy();
    expect(user.login).toBe("mylogin");
  });

  test("includes orgs from API response", async () => {
    global.fetch = jest.fn(() => okRes([
      { login: "my-org-1" },
      { login: "my-org-2" },
    ]));
    const targets = await listTargets(FAKE_TOKEN, "viewer");
    const orgs = targets.filter((t) => t.type === "org");
    expect(orgs).toHaveLength(2);
    expect(orgs[0].login).toBe("my-org-1");
    expect(orgs[1].login).toBe("my-org-2");
  });

  test("user target is first in the list", async () => {
    global.fetch = jest.fn(() => okRes([{ login: "some-org" }]));
    const targets = await listTargets(FAKE_TOKEN, "viewer");
    expect(targets[0].type).toBe("user");
    expect(targets[0].login).toBe("viewer");
  });

  test("handles org API failure gracefully (falls back to user only)", async () => {
    global.fetch = jest.fn(() => failRes(403, "Forbidden"));
    // listTargets catches org errors and returns just the user
    const targets = await listTargets(FAKE_TOKEN, "viewer");
    expect(targets).toHaveLength(1);
    expect(targets[0].type).toBe("user");
  });

  test("ignores orgs with missing login field", async () => {
    global.fetch = jest.fn(() => okRes([{ login: "valid-org" }, { id: 99 }])); // second has no login
    const targets = await listTargets(FAKE_TOKEN, "viewer");
    const orgs = targets.filter((t) => t.type === "org");
    expect(orgs).toHaveLength(1);
    expect(orgs[0].login).toBe("valid-org");
  });
});

// ---------------------------------------------------------------------------
// ensureAxiForgeRepo
// ---------------------------------------------------------------------------

describe("ensureAxiForgeRepo", () => {
  afterEach(() => { delete global.fetch; });

  test("returns TARGET_REPO when repo already exists", async () => {
    let callCount = 0;
    global.fetch = jest.fn((url) => {
      callCount++;
      // First call: GET repo — returns repo object (exists)
      // Subsequent calls: waitForRepo polling — also returns repo
      return okRes({ name: FAKE_REPO, full_name: `${FAKE_OWNER}/${FAKE_REPO}` });
    });
    const result = await ensureAxiForgeRepo(FAKE_TOKEN, FAKE_OWNER);
    expect(result).toBe(TARGET_REPO);
  });

  test("creates repo when it returns 404, then polls until ready", async () => {
    let callIndex = 0;
    global.fetch = jest.fn((url, options) => {
      const method = (options?.method || "GET").toUpperCase();
      callIndex++;

      // First call: GET repo — 404
      if (callIndex === 1) return failRes(404, "Not Found");

      // Second call: POST to create repo — success
      if (callIndex === 2) return okRes({ name: FAKE_REPO });

      // Third call onward: waitForRepo polling — return success
      return okRes({ name: FAKE_REPO });
    });

    // waitForRepo has 1500ms delay — mock setTimeout to skip delays
    jest.useFakeTimers();
    const promise = ensureAxiForgeRepo(FAKE_TOKEN, FAKE_OWNER, "user");
    // Advance through all potential waitForRepo delays
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    }
    jest.useRealTimers();

    const result = await promise;
    expect(result).toBe(TARGET_REPO);
  });

  test("throws if non-404 error when checking repo existence", async () => {
    global.fetch = jest.fn(() => failRes(500, "Internal Server Error"));
    await expect(ensureAxiForgeRepo(FAKE_TOKEN, FAKE_OWNER)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ensurePages
// ---------------------------------------------------------------------------

describe("ensurePages", () => {
  afterEach(() => { delete global.fetch; jest.useRealTimers(); });

  test("returns htmlUrl and branch when Pages already configured as workflow", async () => {
    global.fetch = jest.fn(() => okRes({
      html_url: "https://octocat.github.io/axiforge/",
      build_type: "workflow",
    }));
    const result = await ensurePages(FAKE_TOKEN, FAKE_OWNER);
    expect(result.htmlUrl).toBe("https://octocat.github.io/axiforge/");
    expect(result.branch).toBe("main");
  });

  test("updates build_type to workflow if Pages exists but uses legacy build type", async () => {
    let putCalled = false;
    let callIndex = 0;
    global.fetch = jest.fn((url, options) => {
      callIndex++;
      const method = (options?.method || "GET").toUpperCase();

      if (method === "GET" && callIndex === 1) {
        return okRes({ html_url: "https://octocat.github.io/axiforge/", build_type: "legacy" });
      }
      if (method === "PUT") {
        putCalled = true;
        return okRes({});
      }
      // Second GET after PUT
      return okRes({ html_url: "https://octocat.github.io/axiforge/", build_type: "workflow" });
    });

    jest.useFakeTimers();
    const promise = ensurePages(FAKE_TOKEN, FAKE_OWNER);
    await Promise.resolve();
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    jest.useRealTimers();

    const result = await promise;
    expect(putCalled).toBe(true);
    expect(result.htmlUrl).toBe("https://octocat.github.io/axiforge/");
  });

  test("creates Pages when not found (404)", async () => {
    let postCalled = false;
    let callIndex = 0;
    global.fetch = jest.fn((url, options) => {
      callIndex++;
      const method = (options?.method || "GET").toUpperCase();

      if (callIndex === 1) return failRes(404, "Not Found"); // Pages doesn't exist
      if (method === "POST") {
        postCalled = true;
        return okRes({});
      }
      return okRes({ html_url: "https://octocat.github.io/axiforge/" });
    });

    jest.useFakeTimers();
    const promise = ensurePages(FAKE_TOKEN, FAKE_OWNER);
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    }
    jest.useRealTimers();

    const result = await promise;
    expect(postCalled).toBe(true);
    expect(result.htmlUrl).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getPagesBuildStatus
// ---------------------------------------------------------------------------

describe("getPagesBuildStatus", () => {
  afterEach(() => { delete global.fetch; });

  test("returns ready: true when status is 'built' and URL is reachable", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("pages/builds/latest")) {
        return okRes({ status: "built", updated_at: "2024-06-01T12:00:00Z", error: null });
      }
      if (url.includes("/pages")) {
        return okRes({ html_url: "https://octocat.github.io/axiforge/" });
      }
      // isUrlReachable check — return 200
      return okRes({}, {});
    });
    const result = await getPagesBuildStatus(FAKE_TOKEN, FAKE_OWNER);
    expect(result.ready).toBe(true);
    expect(result.status).toBe("built");
  });

  test("returns ready: false and status 'deploying' when built but URL not reachable", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("pages/builds/latest")) {
        return okRes({ status: "built", updated_at: "2024-06-01T12:00:00Z", error: null });
      }
      if (url.includes("/pages")) {
        return okRes({ html_url: "https://octocat.github.io/axiforge/" });
      }
      // isUrlReachable — simulate network error / unreachable
      return Promise.reject(new Error("ECONNREFUSED"));
    });
    const result = await getPagesBuildStatus(FAKE_TOKEN, FAKE_OWNER);
    expect(result.ready).toBe(false);
    expect(result.status).toBe("deploying");
  });

  test("returns error details when latest build has error", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("pages/builds/latest")) {
        return okRes({ status: "errored", updated_at: null, error: { message: "Build failed" } });
      }
      if (url.includes("/pages")) {
        return okRes({ html_url: "https://octocat.github.io/axiforge/" });
      }
      return okRes({});
    });
    const result = await getPagesBuildStatus(FAKE_TOKEN, FAKE_OWNER);
    expect(result.error).toBe("Build failed");
  });

  test("falls back to workflow runs when latest build returns 404", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("pages/builds/latest")) return failRes(404);
      if (url.includes("/pages")) return okRes({ html_url: "https://octocat.github.io/axiforge/" });
      if (url.includes("/workflows/")) {
        return okRes({ workflow_runs: [{ status: "completed", conclusion: "success", updated_at: "2024-06-01" }] });
      }
      // isUrlReachable check
      return Promise.reject(new Error("unreachable"));
    });
    const result = await getPagesBuildStatus(FAKE_TOKEN, FAKE_OWNER);
    // With success run but unreachable URL: "deploying"
    expect(["built", "deploying"]).toContain(result.status);
  });

  test("returns queued when workflow run is not completed", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("pages/builds/latest")) return failRes(404);
      if (url.includes("/pages")) return okRes({ html_url: "https://octocat.github.io/axiforge/" });
      if (url.includes("/workflows/")) {
        return okRes({ workflow_runs: [{ status: "queued", conclusion: null, updated_at: "2024-06-01" }] });
      }
      return okRes({});
    });
    const result = await getPagesBuildStatus(FAKE_TOKEN, FAKE_OWNER);
    expect(result.status).toBe("queued");
    expect(result.ready).toBe(false);
  });

  test("returns building status for in_progress workflow run", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("pages/builds/latest")) return failRes(404);
      if (url.includes("/pages")) return okRes({ html_url: "https://octocat.github.io/axiforge/" });
      if (url.includes("/workflows/")) {
        return okRes({ workflow_runs: [{ status: "in_progress", conclusion: null, updated_at: "2024-06-01" }] });
      }
      return okRes({});
    });
    const result = await getPagesBuildStatus(FAKE_TOKEN, FAKE_OWNER);
    expect(result.status).toBe("building");
  });

  test("returns error status when workflow run conclusion is failure", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("pages/builds/latest")) return failRes(404);
      if (url.includes("/pages")) return okRes({ html_url: "https://octocat.github.io/axiforge/" });
      if (url.includes("/workflows/")) {
        return okRes({ workflow_runs: [{ status: "completed", conclusion: "failure", updated_at: "2024-06-01" }] });
      }
      return okRes({});
    });
    const result = await getPagesBuildStatus(FAKE_TOKEN, FAKE_OWNER);
    expect(result.status).toBe("error");
    expect(result.ready).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// publishSiteBundle — git blob SHA deduplication
// ---------------------------------------------------------------------------

describe("publishSiteBundle — SHA deduplication", () => {
  afterEach(() => { delete global.fetch; jest.useRealTimers(); });

  const HEAD_SHA = "abc123headsha";
  const TREE_SHA = "def456treesha";
  const CONTENT = "Hello World";
  const CONTENT_SHA = computeGitBlobSha(CONTENT);

  // `contents` maps a repo path to the text the contents API returns for it.
  function buildMockFetch({ existingFiles = {}, repoReady = true, contents = {} } = {}) {
    const existingTree = Object.entries(existingFiles).map(([path, sha]) => ({
      path, sha, type: "blob",
    }));

    return jest.fn((url, options) => {
      const urlStr = String(url);
      const method = (options?.method || "GET").toUpperCase();

      const contentsPath = urlStr.match(/\/contents\/([^?]+)/)?.[1];
      if (contentsPath && method === "GET") {
        return contentsPath in contents
          ? okRes({ content: Buffer.from(contents[contentsPath]).toString("base64") })
          : failRes(404);
      }

      // Repo check
      if (urlStr.includes(`/repos/${FAKE_OWNER}/${FAKE_REPO}`) && method === "GET" && !urlStr.includes("/git/")) {
        return repoReady ? okRes({ name: FAKE_REPO }) : failRes(404);
      }
      // Create repo
      if (urlStr.includes("/user/repos") && method === "POST") {
        return okRes({ name: FAKE_REPO });
      }
      // Get HEAD ref
      if (urlStr.includes(`/git/ref/heads/`) && method === "GET") {
        return okRes({ object: { sha: HEAD_SHA } });
      }
      // Get commit
      if (urlStr.includes(`/git/commits/${HEAD_SHA}`) && method === "GET") {
        return okRes({ tree: { sha: TREE_SHA } });
      }
      // Get tree (recursive)
      if (urlStr.includes(`/git/trees/${TREE_SHA}`) && method === "GET") {
        return okRes({ tree: existingTree });
      }
      // Create blob
      if (urlStr.includes("/git/blobs") && method === "POST") {
        return okRes({ sha: "newblobsha" + Math.random() });
      }
      // Create tree
      if (urlStr.includes("/git/trees") && method === "POST") {
        return okRes({ sha: "newtreesha" });
      }
      // Create commit
      if (urlStr.includes("/git/commits") && method === "POST") {
        return okRes({ sha: "newcommitsha" });
      }
      // Update ref (PATCH)
      if (urlStr.includes("/git/refs/heads/") && method === "PATCH") {
        return okRes({ object: { sha: "newcommitsha" } });
      }

      return okRes({});
    });
  }

  test("returns changed: false when all files have same SHA as existing", async () => {
    // The existing tree has our file with the exact same SHA
    global.fetch = buildMockFetch({
      existingFiles: { "site/index.html": computeGitBlobSha("<!doctype html>") },
    });

    const bundle = { "site/index.html": "<!doctype html>" };
    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);
    expect(result.changed).toBe(false);
    expect(result.commitSha).toBe(HEAD_SHA);
  });

  test("returns changed: true and commitSha when content differs", async () => {
    global.fetch = buildMockFetch({
      existingFiles: { "site/index.html": "oldshavalue" }, // different SHA
    });

    const bundle = { "site/index.html": "new content" };
    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);
    expect(result.changed).toBe(true);
    expect(result.commitSha).toBe("newcommitsha");
  });

  test("includes correct pagesUrl in result", async () => {
    global.fetch = buildMockFetch({ existingFiles: {} });
    const bundle = { "site/index.html": "content" };
    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);
    expect(result.pagesUrl).toBe(`https://${FAKE_OWNER}.github.io/${FAKE_REPO}/`);
  });

  test("throws when bundle is empty", async () => {
    global.fetch = buildMockFetch({ repoReady: true });
    await expect(publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, {})).rejects.toThrow("Nothing to publish");
  });

  test("filters out non-string bundle values", async () => {
    global.fetch = buildMockFetch({ existingFiles: {} });
    const bundle = { "site/valid.html": "content", "site/invalid": 12345 };
    // Only "site/valid.html" passes the string filter
    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);
    expect(result.files).toContain("site/valid.html");
    expect(result.files).not.toContain("site/invalid");
  });

  test("commits binary (image) entries as their real bytes, not base64-as-text", async () => {
    // buildSpaBundle() hands binary assets to publishSiteBundle already base64-encoded.
    // Regression: they must be decoded before committing, or the image deploys as
    // undecodable base64 text (naturalWidth=0 in the browser).
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const pngBase64 = pngBytes.toString("base64");

    let blobBody = null;
    global.fetch = jest.fn((url, options) => {
      const urlStr = String(url);
      const method = (options?.method || "GET").toUpperCase();
      if (urlStr.includes(`/repos/${FAKE_OWNER}/${FAKE_REPO}`) && method === "GET" && !urlStr.includes("/git/")) return okRes({ name: FAKE_REPO });
      if (urlStr.includes("/git/ref/heads/") && method === "GET") return okRes({ object: { sha: HEAD_SHA } });
      if (urlStr.includes(`/git/commits/${HEAD_SHA}`) && method === "GET") return okRes({ tree: { sha: TREE_SHA } });
      if (urlStr.includes(`/git/trees/${TREE_SHA}`) && method === "GET") return okRes({ tree: [] });
      if (urlStr.includes("/git/blobs") && method === "POST") { blobBody = JSON.parse(options.body); return okRes({ sha: "blobsha" }); }
      if (urlStr.includes("/git/trees") && method === "POST") return okRes({ sha: "newtreesha" });
      if (urlStr.includes("/git/commits") && method === "POST") return okRes({ sha: "newcommitsha" });
      if (urlStr.includes("/git/refs/heads/") && method === "PATCH") return okRes({ object: { sha: "newcommitsha" } });
      return okRes({});
    });

    await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, { "site/img/tags/might.png": pngBase64 });

    expect(blobBody).not.toBeNull();
    expect(blobBody.encoding).toBe("base64");
    // The committed base64 must round-trip to the ORIGINAL bytes — i.e. equal the input
    // base64 — not the base64 of the base64 string (the old double-encoding bug).
    expect(blobBody.content).toBe(pngBase64);
    expect(Buffer.from(blobBody.content, "base64").equals(pngBytes)).toBe(true);
  });

  test("commits Buffer entries byte-for-byte (v2 .enc files)", async () => {
    const bytes = Buffer.from([0x00, 0x41, 0x58, 0x02, 9, 8, 7, 6, 5]);
    let blobBody = null;
    global.fetch = jest.fn((url, options) => {
      const urlStr = String(url);
      const method = (options?.method || "GET").toUpperCase();
      if (urlStr.includes(`/repos/${FAKE_OWNER}/${FAKE_REPO}`) && method === "GET" && !urlStr.includes("/git/")) return okRes({ name: FAKE_REPO });
      if (urlStr.includes("/git/ref/heads/") && method === "GET") return okRes({ object: { sha: HEAD_SHA } });
      if (urlStr.includes(`/git/commits/${HEAD_SHA}`) && method === "GET") return okRes({ tree: { sha: TREE_SHA } });
      if (urlStr.includes(`/git/trees/${TREE_SHA}`) && method === "GET") return okRes({ tree: [] });
      if (urlStr.includes("/git/blobs") && method === "POST") { blobBody = JSON.parse(options.body); return okRes({ sha: "blobsha" }); }
      if (urlStr.includes("/git/trees") && method === "POST") return okRes({ sha: "newtreesha" });
      if (urlStr.includes("/git/commits") && method === "POST") return okRes({ sha: "newcommitsha" });
      if (urlStr.includes("/git/refs/heads/") && method === "PATCH") return okRes({ object: { sha: "newcommitsha" } });
      return okRes({});
    });

    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, { "site/builds/abcd1234.enc": bytes });

    expect(result.files).toContain("site/builds/abcd1234.enc");
    expect(blobBody.encoding).toBe("base64");
    expect(Buffer.from(blobBody.content, "base64").equals(bytes)).toBe(true);
  });

  test("skips an unchanged Buffer entry by git blob SHA", async () => {
    const bytes = Buffer.from([0x00, 0x41, 0x58, 0x02, 1, 2, 3]);
    global.fetch = buildMockFetch({ existingFiles: { "site/builds/abcd1234.enc": computeGitBlobSha(bytes) } });
    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, { "site/builds/abcd1234.enc": bytes });
    expect(result.changed).toBe(false);
  });

  test("files property lists all published file paths", async () => {
    global.fetch = buildMockFetch({ existingFiles: {} });
    const bundle = {
      "site/index.html": "html",
      "site/styles.css": "css",
      "site/app.js": "js",
    };
    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);
    expect(result.files).toHaveLength(3);
    expect(result.files).toContain("site/index.html");
    expect(result.files).toContain("site/styles.css");
    expect(result.files).toContain("site/app.js");
  });

  test("preserves site/builds/*.enc files during stale-file sweep", async () => {
    global.fetch = buildMockFetch({
      existingFiles: {
        "site/index.html": computeGitBlobSha("old"),
        "site/builds/abc.enc": "encsha1",
      },
    });

    const bundle = { "site/index.html": "new" };
    await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);

    // Find the create-tree call and inspect its body
    const treeCall = global.fetch.mock.calls.find(
      ([url, opts]) => String(url).includes("/git/trees") && opts?.method === "POST"
    );
    expect(treeCall).toBeDefined();
    const treeBody = JSON.parse(treeCall[1].body);
    const deletedPaths = treeBody.tree
      .filter((e) => e.sha === null)
      .map((e) => e.path);
    expect(deletedPaths).not.toContain("site/builds/abc.enc");
  });

  // An item that moved to another account: its payload goes, a pointer stays.
  test("a null entry deletes that file; moved pointers survive a shell sweep", async () => {
    global.fetch = buildMockFetch({
      existingFiles: {
        "site/index.html": computeGitBlobSha("old"),
        "site/builds/gone.enc": "encsha1",
        "site/moved/older.json": "movedsha",
      },
    });
    await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, {
      "site/index.html": "new",
      "site/builds/gone.enc": null,
      "site/builds/never-here.enc": null,
      "site/moved/gone.json": '{"owner":"guild"}',
    });
    const treeCall = global.fetch.mock.calls.find(([url, opts]) => String(url).includes("/git/trees") && opts?.method === "POST");
    const tree = JSON.parse(treeCall[1].body).tree;
    const deleted = tree.filter((e) => e.sha === null).map((e) => e.path);
    expect(deleted).toContain("site/builds/gone.enc");
    expect(deleted).not.toContain("site/builds/never-here.enc");
    expect(deleted).not.toContain("site/moved/older.json");
    expect(tree.map((e) => e.path)).toContain("site/moved/gone.json");
  });

  test("preserves site/comps/*.enc files during stale-file sweep", async () => {
    global.fetch = buildMockFetch({
      existingFiles: {
        "site/index.html": computeGitBlobSha("old"),
        "site/comps/xyz.enc": "encsha2",
      },
    });

    const bundle = { "site/index.html": "new" };
    await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);

    // Find the create-tree call and inspect its body
    const treeCall = global.fetch.mock.calls.find(
      ([url, opts]) => String(url).includes("/git/trees") && opts?.method === "POST"
    );
    expect(treeCall).toBeDefined();
    const treeBody = JSON.parse(treeCall[1].body);
    const deletedPaths = treeBody.tree
      .filter((e) => e.sha === null)
      .map((e) => e.path);
    expect(deletedPaths).not.toContain("site/comps/xyz.enc");
  });

  test("preserves site/r/* redirect files during stale-file sweep", async () => {
    global.fetch = buildMockFetch({
      existingFiles: {
        "site/index.html": computeGitBlobSha("old"),
        "site/r/abc12345/index.html": "redirsha1",
      },
    });

    const bundle = { "site/index.html": "new" };
    await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);

    const treeCall = global.fetch.mock.calls.find(
      ([url, opts]) => String(url).includes("/git/trees") && opts?.method === "POST"
    );
    expect(treeCall).toBeDefined();
    const treeBody = JSON.parse(treeCall[1].body);
    const deletedPaths = treeBody.tree
      .filter((e) => e.sha === null)
      .map((e) => e.path);
    expect(deletedPaths).not.toContain("site/r/abc12345/index.html");
  });

  function postedTree() {
    const treeCall = global.fetch.mock.calls.find(
      ([url, opts]) => String(url).includes("/git/trees") && opts?.method === "POST"
    );
    return treeCall ? JSON.parse(treeCall[1].body).tree : [];
  }

  test("uploads identical bytes once and reuses the blob for other paths", async () => {
    global.fetch = buildMockFetch({
      existingFiles: { "site/old-logo.txt": computeGitBlobSha("logo") },
    });

    const bundle = {
      "site/index.html": "<html>shell</html>",
      "viewer/index.html": "<html>shell</html>",
      "viewer/logo.txt": "logo",
    };
    await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);

    const blobPosts = global.fetch.mock.calls.filter(
      ([url, opts]) => String(url).includes("/git/blobs") && opts?.method === "POST"
    );
    expect(blobPosts).toHaveLength(1);
    const sha = (p) => postedTree().find((e) => e.path === p)?.sha;
    expect(sha("viewer/index.html")).toBe(computeGitBlobSha("<html>shell</html>"));
    expect(sha("viewer/logo.txt")).toBe(computeGitBlobSha("logo"));
  });

  test("a shell change sweeps viewer/ files the new viewer no longer has", async () => {
    global.fetch = buildMockFetch({
      existingFiles: {
        "viewer/assets/old-abc.js": "oldsha",
        "viewer/index.html": computeGitBlobSha("old"),
      },
    });

    const bundle = { "site/index.html": "new", "viewer/index.html": "new" };
    await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);

    const deleted = postedTree().filter((e) => e.sha === null).map((e) => e.path);
    expect(deleted).toContain("viewer/assets/old-abc.js");
    expect(deleted).not.toContain("viewer/index.html");
  });

  test("leaves the repo's viewer alone when it reads a newer format than ours", async () => {
    global.fetch = buildMockFetch({
      existingFiles: {
        "site/site-version": "remotesha",
        "viewer/viewer-format": "fmtsha",
        "viewer/assets/newer.js": "newersha",
      },
      contents: { "site/site-version": "newerviewer", "viewer/viewer-format": "3" },
    });

    const bundle = {
      "site/site-version": "ourviewer",
      "site/index.html": "<html>ours</html>",
      "viewer/index.html": "<html>ours</html>",
      "viewer/viewer-format": "2",
      "site/builds/abc.enc": Buffer.from([0, 0x41, 0x58, 2]),
    };
    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);

    expect(result.shellChanged).toBe(false);
    expect(result.files).toEqual(["site/builds/abc.enc"]);
    expect(postedTree().map((e) => e.path)).toEqual(["site/builds/abc.enc"]);
  });

  test("replaces an older-format viewer", async () => {
    global.fetch = buildMockFetch({
      existingFiles: { "site/site-version": "remotesha", "viewer/viewer-format": "fmtsha" },
      contents: { "site/site-version": "olderviewer", "viewer/viewer-format": "1" },
    });

    const bundle = {
      "site/site-version": "ourviewer",
      "site/index.html": "<html>ours</html>",
      "viewer/viewer-format": "2",
    };
    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, bundle);

    expect(result.shellChanged).toBe(true);
    expect(postedTree().map((e) => e.path)).toEqual(
      expect.arrayContaining(["site/index.html", "viewer/viewer-format", "site/site-version"])
    );
  });
});

// ---------------------------------------------------------------------------
// computeGitBlobSha — internal implementation test (via publishSiteBundle behavior)
// ---------------------------------------------------------------------------

describe("computeGitBlobSha (verified via skip logic)", () => {
  afterEach(() => { delete global.fetch; });

  test("blob SHA matches git object format: 'blob <len>\\0<content>'", () => {
    // Verify our test helper matches what the module computes
    const content = "test content";
    const buf = Buffer.from(content, "utf8");
    const expected = crypto.createHash("sha1")
      .update(`blob ${buf.length}\0`)
      .update(buf)
      .digest("hex");
    expect(computeGitBlobSha(content)).toBe(expected);
  });

  test("same content always produces same SHA", () => {
    expect(computeGitBlobSha("abc")).toBe(computeGitBlobSha("abc"));
  });

  test("different content produces different SHA", () => {
    expect(computeGitBlobSha("abc")).not.toBe(computeGitBlobSha("xyz"));
  });

  test("empty content produces valid SHA", () => {
    const sha = computeGitBlobSha("");
    expect(sha).toHaveLength(40); // SHA1 hex length
    expect(sha).toMatch(/^[0-9a-f]+$/);
  });
});

// ---------------------------------------------------------------------------
// ensurePagesWorkflow
// ---------------------------------------------------------------------------

describe("ensurePagesWorkflow", () => {
  afterEach(() => { delete global.fetch; });

  test("creates the workflow file via PUT", async () => {
    let putCalled = false;
    global.fetch = jest.fn((url, options) => {
      const method = (options?.method || "GET").toUpperCase();
      if (method === "GET") {
        // File doesn't exist yet
        return failRes(404);
      }
      if (method === "PUT") {
        putCalled = true;
        return okRes({ content: { sha: "newsha" } });
      }
      return okRes({});
    });

    await ensurePagesWorkflow(FAKE_TOKEN, FAKE_OWNER);
    expect(putCalled).toBe(true);
  });

  test("workflow content references the correct branch", async () => {
    let capturedBody = null;
    global.fetch = jest.fn((url, options) => {
      const method = (options?.method || "GET").toUpperCase();
      if (method === "GET") return failRes(404);
      if (method === "PUT" && String(url).includes("deploy-pages.yml")) {
        capturedBody = JSON.parse(options.body);
        return okRes({ content: { sha: "newsha" } });
      }
      return okRes({});
    });

    await ensurePagesWorkflow(FAKE_TOKEN, FAKE_OWNER, "main");
    // The content is base64-encoded workflow YAML
    const decodedContent = Buffer.from(capturedBody.content, "base64").toString("utf8");
    expect(decodedContent).toContain('"main"');
    expect(decodedContent).toContain("deploy-pages");
    expect(decodedContent).toContain("actions/upload-pages-artifact");
  });

  test("throws helpful error with scope hint when 404 on workflow PUT", async () => {
    global.fetch = jest.fn((url, options) => {
      const method = (options?.method || "GET").toUpperCase();
      if (method === "GET") return failRes(404);
      if (method === "PUT") {
        return Promise.resolve({
          ok: false, status: 404,
          text: () => Promise.resolve(JSON.stringify({ message: "Not Found" })),
          headers: makeHeaders({ "x-oauth-scopes": "repo", "x-accepted-oauth-scopes": "workflow" }),
        });
      }
      return okRes({});
    });

    const err = await ensurePagesWorkflow(FAKE_TOKEN, FAKE_OWNER).catch((e) => e);
    expect(err.message).toContain("workflow");
    expect(err.message).toContain("Re-authenticate");
  });

  test("also writes the viewer guard workflow", async () => {
    const written = {};
    global.fetch = jest.fn((url, options) => {
      const method = (options?.method || "GET").toUpperCase();
      if (method === "GET") return failRes(404);
      if (method === "PUT") {
        const path = decodeURIComponent(String(url).match(/\/contents\/([^?]+)/)[1]);
        written[path] = Buffer.from(JSON.parse(options.body).content, "base64").toString("utf8");
        return okRes({ content: { sha: "newsha" } });
      }
      return okRes({});
    });

    await ensurePagesWorkflow(FAKE_TOKEN, FAKE_OWNER);
    expect(written[VIEWER_GUARD_PATH]).toBe(viewerGuardWorkflow());
  });
});

describe("viewerGuardWorkflow", () => {
  const { execFileSync } = require("node:child_process");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const yaml = viewerGuardWorkflow();

  test("runs after the Deploy Pages workflow (old apps rewrite that one, never this)", () => {
    expect(VIEWER_GUARD_PATH).not.toBe(".github/workflows/deploy-pages.yml");
    expect(yaml).toMatch(/on:\n  workflow_run:\n    workflows: \[ "Deploy Pages" \]\n    types: \[ completed \]/);
    expect(yaml).toContain("if: github.event.workflow_run.conclusion == 'success'");
  });

  test("only the deploy job joins the pages concurrency group", () => {
    const [checkJob, deployJob] = yaml.split("\n  deploy:\n");
    expect(checkJob).not.toContain("concurrency");
    expect(deployJob).toContain('concurrency:\n      group: "pages"\n      cancel-in-progress: false');
    expect(deployJob).toContain("if: needs.check.outputs.stale == 'true'");
  });

  test("leaves GitHub expressions for Actions, not JS, to expand", () => {
    expect(yaml).toContain("${{ steps.compare.outputs.stale }}");
    expect(yaml).toContain("${{ steps.deployment.outputs.page_url }}");
  });

  // Pull a step's `run: |` block out of the YAML and run it the way Actions does.
  function runBlock(after) {
    const start = yaml.indexOf(after);
    const lines = yaml.slice(yaml.indexOf("run:", start)).split("\n");
    const first = lines[0].replace(/^run:\s*/, "");
    if (first !== "|") return first;
    const body = [];
    for (const line of lines.slice(1)) {
      if (!line.startsWith("          ")) break;
      body.push(line.slice(10));
    }
    return body.join("\n");
  }

  function inRepo(files, script) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-guard-"));
    try {
      for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), text);
      }
      const out = path.join(dir, "gh-output");
      fs.writeFileSync(out, "");
      execFileSync("bash", ["-e", "-c", script], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out } });
      return { dir, output: fs.readFileSync(out, "utf8"), read: (rel) => fs.readFileSync(path.join(dir, rel), "utf8") };
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
  }

  const compare = runBlock("id: compare");

  test.each([
    ["an older app replaced the served viewer", { "site/site-version": "old", "viewer/site-version": "new" }, "stale=true"],
    ["the served viewer is the newest", { "site/site-version": "new", "viewer/site-version": "new" }, "stale=false"],
    ["no newer app has published here yet", { "site/site-version": "old" }, "stale=false"],
    ["site/ has no viewer at all", { "viewer/site-version": "new" }, "stale=true"],
  ])("compare step: %s", (_name, files, expected) => {
    const { dir, output } = inRepo(files, compare);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(output.trim()).toBe(expected);
  });

  test("restore step lays viewer/ over site/, keeping published data", () => {
    const { dir, read } = inRepo({
      "site/index.html": "old shell",
      "site/builds/a.enc": "data",
      "viewer/index.html": "new shell",
      "viewer/assets/app.js": "js",
    }, runBlock("Lay the newest viewer"));
    try {
      expect(read("site/index.html")).toBe("new shell");
      expect(read("site/assets/app.js")).toBe("js");
      expect(read("site/builds/a.enc")).toBe("data");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// deleteFile
// ---------------------------------------------------------------------------

describe("deleteFile", () => {
  afterEach(() => { delete global.fetch; });

  test("calls DELETE on contents API with correct path", async () => {
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

// ---------------------------------------------------------------------------
// apiFetch error codes (401, 403, 429)
// ---------------------------------------------------------------------------

describe("apiFetch error codes — 401 GITHUB_UNAUTHORIZED", () => {
  afterEach(() => { delete global.fetch; });

  test("error has code GITHUB_UNAUTHORIZED on 401", async () => {
    global.fetch = jest.fn(() => failRes(401, "Bad credentials"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.code).toBe("GITHUB_UNAUTHORIZED");
  });

  test("error has status 401", async () => {
    global.fetch = jest.fn(() => failRes(401, "Bad credentials"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.status).toBe(401);
  });

  test("401 error does NOT have retryAfterMs", async () => {
    global.fetch = jest.fn(() => failRes(401, "Bad credentials"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.retryAfterMs).toBeUndefined();
  });
});

describe("apiFetch error codes — 403 GITHUB_RATE_LIMITED", () => {
  afterEach(() => { delete global.fetch; });

  test("error has code GITHUB_RATE_LIMITED on 403", async () => {
    global.fetch = jest.fn(() => failRes(403, "Forbidden"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.code).toBe("GITHUB_RATE_LIMITED");
  });

  test("error has status 403", async () => {
    global.fetch = jest.fn(() => failRes(403, "rate limit exceeded"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.status).toBe(403);
  });

  test("defaults retryAfterMs to 60000 when Retry-After header absent", async () => {
    global.fetch = jest.fn(() => failRes(403, "rate limit exceeded"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.retryAfterMs).toBe(60_000);
  });

  test("uses Retry-After header value (in seconds) when present", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ message: "rate limited" }),
        text: () => Promise.resolve(JSON.stringify({ message: "rate limited" })),
        headers: makeHeaders({ "retry-after": "120" }),
      })
    );
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.retryAfterMs).toBe(120_000);
  });
});

describe("apiFetch error codes — 429 GITHUB_RATE_LIMITED", () => {
  afterEach(() => { delete global.fetch; });

  test("error has code GITHUB_RATE_LIMITED on 429", async () => {
    global.fetch = jest.fn(() => failRes(429, "Too Many Requests"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.code).toBe("GITHUB_RATE_LIMITED");
  });

  test("uses Retry-After header on 429", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ message: "too many requests" }),
        text: () => Promise.resolve(JSON.stringify({ message: "too many requests" })),
        headers: makeHeaders({ "retry-after": "30" }),
      })
    );
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.retryAfterMs).toBe(30_000);
    expect(err.code).toBe("GITHUB_RATE_LIMITED");
  });
});

describe("apiFetch error codes — other status codes", () => {
  afterEach(() => { delete global.fetch; });

  test("500 error has no GITHUB_UNAUTHORIZED or GITHUB_RATE_LIMITED code", async () => {
    global.fetch = jest.fn(() => failRes(500, "Internal Server Error"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.code).toBeUndefined();
    expect(err.status).toBe(500);
  });

  test("404 error has no special code", async () => {
    global.fetch = jest.fn(() => failRes(404, "Not Found"));
    const err = await getViewer(FAKE_TOKEN).catch((e) => e);
    expect(err.code).toBeUndefined();
    expect(err.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// publishSiteBundle — concurrent-writer safety (fast-forward only + retry)
// ---------------------------------------------------------------------------

describe("publishSiteBundle — fast-forward ref update", () => {
  afterEach(() => { delete global.fetch; });

  function makeFetch({ failPatchTimes = 0 } = {}) {
    let head = "head-1";
    let patchCalls = 0;
    const patches = [];
    const fetchMock = jest.fn((url, options) => {
      const urlStr = String(url);
      const method = (options?.method || "GET").toUpperCase();
      if (urlStr.includes("/git/ref/heads/") && method === "GET") return okRes({ object: { sha: head } });
      if (urlStr.includes("/git/commits/") && method === "GET") return okRes({ tree: { sha: `tree-${head}` } });
      if (urlStr.includes("/git/trees/") && method === "GET") return okRes({ tree: [] });
      if (urlStr.includes("/git/blobs") && method === "POST") return okRes({ sha: "blob" });
      if (urlStr.includes("/git/trees") && method === "POST") return okRes({ sha: "newtree" });
      if (urlStr.includes("/git/commits") && method === "POST") return okRes({ sha: `commit-on-${head}` });
      if (urlStr.includes("/git/refs/heads/") && method === "PATCH") {
        patches.push(JSON.parse(options.body));
        patchCalls += 1;
        if (patchCalls <= failPatchTimes) {
          head = `head-${patchCalls + 1}`; // someone else moved the branch
          return failRes(422, "Update is not a fast forward");
        }
        return okRes({ object: { sha: JSON.parse(options.body).sha } });
      }
      if (urlStr.includes("/contents/")) return failRes(404);
      return okRes({ name: FAKE_REPO });
    });
    return { fetchMock, patches };
  }

  test("never force-pushes the branch", async () => {
    const { fetchMock, patches } = makeFetch();
    global.fetch = fetchMock;
    await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, { "site/builds/x.enc": "data" });
    expect(patches).toHaveLength(1);
    expect(patches[0].force).toBe(false);
  });

  test("retries from the new HEAD when the branch moved underneath us", async () => {
    const { fetchMock, patches } = makeFetch({ failPatchTimes: 2 });
    global.fetch = fetchMock;
    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, { "site/builds/x.enc": "data" });
    expect(patches.map((p) => p.sha)).toEqual(["commit-on-head-1", "commit-on-head-2", "commit-on-head-3"]);
    expect(result.commitSha).toBe("commit-on-head-3");
    expect(result.changed).toBe(true);
  });

  test("gives up after the retry budget and surfaces the error", async () => {
    const { fetchMock } = makeFetch({ failPatchTimes: 99 });
    global.fetch = fetchMock;
    await expect(publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, { "site/builds/x.enc": "data" }))
      .rejects.toThrow(/fast forward/i);
  });

  test("does not retry unrelated errors", async () => {
    global.fetch = jest.fn((url, options) => {
      const urlStr = String(url);
      const method = (options?.method || "GET").toUpperCase();
      if (urlStr.includes("/git/ref/heads/") && method === "GET") return failRes(500, "kaboom");
      return okRes({ name: FAKE_REPO });
    });
    await expect(publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, { "site/builds/x.enc": "data" }))
      .rejects.toThrow("kaboom");
    const refGets = global.fetch.mock.calls.filter(([u, o]) => String(u).includes("/git/ref/heads/") && !(o?.method));
    expect(refGets).toHaveLength(1);
  });
});

describe("ensureAxiForgeRepo — fast path", () => {
  afterEach(() => { delete global.fetch; });

  test("makes exactly one request and no delay when the repo already exists", async () => {
    global.fetch = jest.fn(() => okRes({ name: FAKE_REPO }));
    const started = Date.now();
    await ensureAxiForgeRepo(FAKE_TOKEN, FAKE_OWNER);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("listRepoCollaborators", () => {
  afterEach(() => { delete global.fetch; });

  test("direct lists everyone added to the repo; all keeps only those who can push", async () => {
    const people = [
      { login: "writer", permissions: { push: true } },
      { login: "reader", permissions: { push: false } },
    ];
    global.fetch = jest.fn(() => okRes(people));
    expect(await require("../../src/main/githubApi").listRepoCollaborators("t", "guild")).toEqual(["writer", "reader"]);
    expect(global.fetch.mock.calls[0][0]).toMatch(/affiliation=direct/);
    expect(await require("../../src/main/githubApi").listRepoCollaborators("t", "guild", { affiliation: "all" })).toEqual(["writer"]);
    expect(global.fetch.mock.calls[1][0]).toMatch(/affiliation=all/);
  });
});
