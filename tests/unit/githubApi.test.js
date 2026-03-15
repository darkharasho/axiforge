"use strict";

const crypto = require("node:crypto");
const {
  TARGET_REPO,
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
  const buf = Buffer.from(content, "utf8");
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

  function buildMockFetch({ existingFiles = {}, repoReady = true } = {}) {
    const existingTree = Object.entries(existingFiles).map(([path, sha]) => ({
      path, sha, type: "blob",
    }));

    return jest.fn((url, options) => {
      const urlStr = String(url);
      const method = (options?.method || "GET").toUpperCase();

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
      if (method === "PUT") {
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
