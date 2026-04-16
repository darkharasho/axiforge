const GH_REST = "https://api.github.com";
const TARGET_REPO = "axibuilds";
const USER_AGENT = "axiforge-desktop";
const crypto = require("node:crypto");

async function apiFetch(path, token, init = {}) {
  const res = await fetch(`${GH_REST}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  const data = text ? tryParseJson(text) : null;
  const oauthScopes = res.headers.get("x-oauth-scopes") || "";
  const acceptedOauthScopes = res.headers.get("x-accepted-oauth-scopes") || "";

  if (!res.ok) {
    const err = new Error(data?.message || `GitHub API error ${res.status}`);
    err.status = res.status;
    err.data = data;
    err.path = path;
    err.oauthScopes = oauthScopes;
    err.acceptedOauthScopes = acceptedOauthScopes;
    throw err;
  }

  return data;
}

async function getViewer(token) {
  const me = await apiFetch("/user", token);
  return {
    login: me.login,
    id: me.id,
    avatarUrl: me.avatar_url,
    htmlUrl: me.html_url,
  };
}

async function listTargets(token, viewerLogin) {
  const orgs = await apiFetch("/user/orgs?per_page=100", token).catch(() => []);
  const targets = [{ login: viewerLogin, type: "user" }];
  for (const org of orgs || []) {
    if (org?.login) targets.push({ login: org.login, type: "org" });
  }
  return targets;
}

async function ensureAxiForgeRepo(token, owner, ownerType = "user") {
  try {
    await apiFetch(`/repos/${owner}/${TARGET_REPO}`, token);
    await waitForRepo(token, owner, TARGET_REPO);
    return TARGET_REPO;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const path = ownerType === "org" ? `/orgs/${owner}/repos` : "/user/repos";
  await apiFetch(path, token, {
    method: "POST",
    body: JSON.stringify({
      name: TARGET_REPO,
      private: false,
      auto_init: true,
      description: "AxiForge Builds — published GW2 builds",
    }),
  }).catch(async (err) => {
    if (err.status === 422) {
      await apiFetch(`/repos/${owner}/${TARGET_REPO}`, token);
      return;
    }
    throw err;
  });

  await waitForRepo(token, owner, TARGET_REPO);
  return TARGET_REPO;
}

async function waitForRepo(token, owner, repo) {
  for (let i = 0; i < 25; i += 1) {
    await delay(1500);
    try {
      await apiFetch(`/repos/${owner}/${repo}`, token);
      return;
    } catch {
      if (i === 24) throw new Error("Repository creation did not finish in time.");
    }
  }
}

async function ensurePages(token, owner, branch = "main", repo = TARGET_REPO) {
  try {
    const page = await apiFetch(`/repos/${owner}/${repo}/pages`, token);
    if ((page?.build_type || "").toLowerCase() !== "workflow") {
      await apiFetch(`/repos/${owner}/${repo}/pages`, token, {
        method: "PUT",
        body: JSON.stringify({
          build_type: "workflow",
        }),
      });
      await delay(2000);
      const updated = await apiFetch(`/repos/${owner}/${repo}/pages`, token);
      return { htmlUrl: updated.html_url, branch };
    }
    return { htmlUrl: page.html_url, branch };
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }

  await apiFetch(`/repos/${owner}/${repo}/pages`, token, {
    method: "POST",
    body: JSON.stringify({
      build_type: "workflow",
    }),
  });

  for (let i = 0; i < 15; i += 1) {
    await delay(2000);
    try {
      const page = await apiFetch(`/repos/${owner}/${repo}/pages`, token);
      return { htmlUrl: page.html_url, branch };
    } catch {
      if (i === 14) {
        throw new Error("GitHub Pages setup did not finish in time.");
      }
    }
  }
}

async function ensureNoJekyll(token, owner, branch = "main", repo = TARGET_REPO) {
  await putFile(token, owner, repo, ".nojekyll", "\n", branch, "Add .nojekyll");
}

async function ensurePagesWorkflow(token, owner, branch = "main", repo = TARGET_REPO) {
  const workflowPath = ".github/workflows/deploy-pages.yml";
  const workflow = `name: Deploy Pages

on:
  push:
    branches: [ "${branch}" ]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Ensure site bundle
        run: |
          mkdir -p site data
          if [ ! -f site/index.html ]; then
            printf '<!doctype html><html><body><h1>AxiForge</h1><p>Publish from desktop to update this site.</p></body></html>' > site/index.html
          fi
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./site

  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`;

  try {
    await putFile(token, owner, repo, workflowPath, workflow, branch, "Add/Update Pages deploy workflow");
  } catch (err) {
    if (err?.status === 404) {
      const scopeHint = err?.oauthScopes ? ` Current token scopes: ${err.oauthScopes}.` : "";
      const requiredHint = err?.acceptedOauthScopes ? ` Endpoint expects: ${err.acceptedOauthScopes}.` : "";
      const e = new Error(
        `Could not write ${workflowPath} in ${owner}/${repo}. Re-authenticate so the token includes 'workflow' scope.${scopeHint}${requiredHint}`
      );
      e.status = err.status;
      e.data = err.data;
      e.path = err.path;
      throw e;
    }
    throw err;
  }
}

async function triggerPagesWorkflow(token, owner, branch = "main", repo = TARGET_REPO) {
  await apiFetch(
    `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent("deploy-pages.yml")}/dispatches`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ ref: branch }),
    }
  );
}

async function getPagesBuildStatus(token, owner, repo = TARGET_REPO) {
  let htmlUrl = null;
  try {
    const page = await apiFetch(`/repos/${owner}/${repo}/pages`, token);
    htmlUrl = page?.html_url || null;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  try {
    const latest = await apiFetch(`/repos/${owner}/${repo}/pages/builds/latest`, token);
    const status = String(latest?.status || "unknown").toLowerCase();
    const reachable = status === "built" && htmlUrl ? await isUrlReachable(htmlUrl) : false;
    return {
      status: status === "built" && !reachable ? "deploying" : status,
      ready: status === "built" && reachable,
      htmlUrl,
      updatedAt: latest?.updated_at || null,
      error: latest?.error?.message || null,
    };
  } catch (err) {
    if (err.status === 404) {
      const fromRuns = await getPagesStatusFromWorkflowRuns(token, owner, repo, htmlUrl);
      if (fromRuns) return fromRuns;
      const reachable = htmlUrl ? await isUrlReachable(htmlUrl) : false;
      return {
        status: reachable ? "built" : "queued",
        ready: reachable,
        htmlUrl,
        updatedAt: null,
        error: null,
      };
    }
    throw err;
  }
}

async function getPagesStatusFromWorkflowRuns(token, owner, repo, htmlUrl) {
  try {
    const runs = await apiFetch(
      `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent("deploy-pages.yml")}/runs?per_page=10`,
      token
    );
    const latestRun = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs[0] : null;
    if (!latestRun) return null;

    const runStatus = String(latestRun.status || "").toLowerCase();
    const runConclusion = String(latestRun.conclusion || "").toLowerCase();
    const updatedAt = latestRun.updated_at || latestRun.created_at || null;

    if (runStatus !== "completed") {
      return {
        status: runStatus === "in_progress" ? "building" : "queued",
        ready: false,
        htmlUrl,
        updatedAt,
        error: null,
      };
    }

    const reachable = htmlUrl ? await isUrlReachable(htmlUrl) : false;
    if (runConclusion === "success") {
      return {
        status: reachable ? "built" : "deploying",
        ready: reachable,
        htmlUrl,
        updatedAt,
        error: null,
      };
    }

    return {
      status: "error",
      ready: false,
      htmlUrl,
      updatedAt,
      error: runConclusion ? `Latest deploy run ended with ${runConclusion}.` : "GitHub Pages deploy failed.",
    };
  } catch {
    return null;
  }
}

async function getRepo(token, owner, repo = TARGET_REPO) {
  return apiFetch(`/repos/${owner}/${repo}`, token);
}

async function publishSiteBundle(token, owner, bundle, branch = "main", repo = TARGET_REPO) {
  await ensureAxiForgeRepo(token, owner);
  const entries = Object.entries(bundle || {}).filter(
    ([filePath, content]) => filePath && typeof content === "string"
  );
  if (!entries.length) {
    throw new Error("Nothing to publish.");
  }

  const headRef = await apiFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
  const headSha = headRef?.object?.sha;
  if (!headSha) {
    throw new Error(`Could not resolve ${owner}/${repo}@${branch}.`);
  }
  const headCommit = await apiFetch(`/repos/${owner}/${repo}/git/commits/${headSha}`, token);
  const baseTreeSha = headCommit?.tree?.sha;
  if (!baseTreeSha) {
    throw new Error("Could not resolve repository tree.");
  }

  const treeData = await apiFetch(
    `/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`,
    token
  );
  const existingTree = Array.isArray(treeData?.tree) ? treeData.tree : [];
  const existingByPath = new Map();
  for (const entry of existingTree) {
    if (entry?.path && entry?.sha && entry?.type === "blob") {
      existingByPath.set(entry.path, entry.sha);
    }
  }

  const nextPathSet = new Set(entries.map(([filePath]) => filePath));
  const treeEntries = [];

  for (const [filePath, content] of entries) {
    const contentBuffer = Buffer.from(content, "utf8");
    const blobSha = computeGitBlobSha(contentBuffer);
    const existingSha = existingByPath.get(filePath);
    if (existingSha === blobSha) continue;

    const blob = await apiFetch(`/repos/${owner}/${repo}/git/blobs`, token, {
      method: "POST",
      body: JSON.stringify({
        content: contentBuffer.toString("base64"),
        encoding: "base64",
      }),
    });
    treeEntries.push({ path: filePath, sha: blob.sha });
  }

  for (const entry of existingTree) {
    if (!entry?.path || entry?.type !== "blob") continue;
    const isLegacyRootNoJekyll = entry.path === ".nojekyll";
    const isEncBuild = (entry.path.startsWith("site/builds/") || entry.path.startsWith("site/comps/")) && entry.path.endsWith(".enc");
    const isRedirect = entry.path.startsWith("site/r/");
    const isStaleSiteFile = entry.path.startsWith("site/") && !nextPathSet.has(entry.path) && !isEncBuild && !isRedirect;
    if (!isLegacyRootNoJekyll && !isStaleSiteFile) continue;
    treeEntries.push({ path: entry.path, sha: null });
  }

  if (!treeEntries.length) {
    return {
      commitSha: headSha,
      files: entries.map(([filePath]) => filePath),
      pagesUrl: `https://${owner}.github.io/${repo}/`,
      changed: false,
    };
  }

  const newTree = await apiFetch(`/repos/${owner}/${repo}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries.map((entry) => ({
        path: entry.path,
        mode: "100644",
        type: "blob",
        sha: entry.sha,
      })),
    }),
  });

  const commit = await apiFetch(`/repos/${owner}/${repo}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify({
      message: "Publish AxiForge static site",
      tree: newTree.sha,
      parents: [headSha],
    }),
  });

  await apiFetch(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      sha: commit.sha,
      force: true,
    }),
  });

  return {
    commitSha: commit.sha,
    files: entries.map(([filePath]) => filePath),
    pagesUrl: `https://${owner}.github.io/${repo}/`,
    changed: true,
  };
}

async function putFile(token, owner, repo, filePath, content, branch, message) {
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  let existingSha = null;
  let existingContent = null;
  try {
    const current = await apiFetch(
      `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
      token
    );
    existingSha = current?.sha || null;
    if (current?.encoding === "base64" && typeof current?.content === "string") {
      existingContent = Buffer.from(current.content, "base64").toString("utf8");
    }
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  if (existingSha && existingContent === content) {
    return { skipped: true, path: filePath, commit: null };
  }

  const body = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
  };
  if (existingSha) body.sha = existingSha;
  return apiFetch(`/repos/${owner}/${repo}/contents/${encodedPath}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

async function isUrlReachable(url) {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeGitBlobSha(contentBuffer) {
  return crypto.createHash("sha1").update(`blob ${contentBuffer.length}\0`).update(contentBuffer).digest("hex");
}

async function deleteFile(token, owner, filePath, branch = "main", message = "Remove file", repo = TARGET_REPO) {
  const encodedPath = filePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  let existingSha;
  try {
    const current = await apiFetch(`/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, token);
    existingSha = current?.sha;
  } catch (err) {
    if (err.status === 404) return;
    throw err;
  }
  if (!existingSha) return;
  await apiFetch(`/repos/${owner}/${repo}/contents/${encodedPath}`, token, {
    method: "DELETE",
    body: JSON.stringify({ message, sha: existingSha, branch }),
  });
}

// ---------------------------------------------------------------------------
// Shared Library API
// ---------------------------------------------------------------------------

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

async function getOrgRole(token, org, username) {
  try {
    const data = await apiFetch(
      `/orgs/${encodeURIComponent(org)}/memberships/${encodeURIComponent(username)}`,
      token
    );
    return data?.role || null; // "admin" | "member"
  } catch {
    return null;
  }
}

async function deleteSharedFile(token, owner, repo, filePath, sha, branch = "main", message = "Remove shared build") {
  const encodedPath = filePath.split("/").map((s) => encodeURIComponent(s)).join("/");
  await apiFetch(`/repos/${owner}/${repo}/contents/${encodedPath}`, token, {
    method: "DELETE",
    body: JSON.stringify({ message, sha, branch }),
  });
}

module.exports = {
  TARGET_REPO,
  SHARED_REPO,
  getViewer,
  listTargets,
  ensureAxiForgeRepo,
  ensurePages,
  getPagesBuildStatus,
  getRepo,
  ensureNoJekyll,
  ensurePagesWorkflow,
  triggerPagesWorkflow,
  publishSiteBundle,
  deleteFile,
  ensureSharedRepo,
  getRepoTree,
  getFileContents,
  putSharedFile,
  deleteSharedFile,
  getOrgRole,
};
