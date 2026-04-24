#!/usr/bin/env node
// Recover deleted builds/comps from a shared-library GitHub repo by walking
// its commit history and restoring the last pre-deletion version of each file.
//
// Usage:
//   GITHUB_TOKEN=ghp_xxx node scripts/recover-shared-library.mjs \
//     --org <org> --repo <repo> [--out ./recovered] [--since <ISO>]
//
// Outputs restored files to --out (default ./recovered), preserving the repo
// path structure (folders/<id>/builds/*.json, folders/<id>/comps/*.json,
// folders/<id>/meta.json). Review the output, then either:
//   a) copy each restored file into <userData>/data/{builds.json, comps.json,
//      folders.json} manually (not recommended), or
//   b) push the files back to the shared repo at the same paths using your
//      admin GitHub account, then run a fresh sync on the desktop app.
//
// This is a read-only operation against GitHub. It never writes to GitHub.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const GITHUB_API = "https://api.github.com";

function parseArgs() {
  const out = { out: "./recovered", since: null, org: null, repo: "axibuilds-shared" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--org") out.org = argv[++i];
    else if (a === "--repo") out.repo = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--since") out.since = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: GITHUB_TOKEN=... node scripts/recover-shared-library.mjs --org <org> [--repo <repo>] [--out <dir>] [--since <ISO>]`);
      process.exit(0);
    }
  }
  if (!out.org) {
    console.error("Missing --org <org>. Run with --help for usage.");
    process.exit(1);
  }
  return out;
}

async function gh(path, token) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "axiforge-recover",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function listAllCommits(token, org, repo, since) {
  const commits = [];
  let page = 1;
  while (true) {
    const qs = new URLSearchParams({ per_page: "100", page: String(page) });
    if (since) qs.set("since", since);
    const batch = await gh(`/repos/${org}/${repo}/commits?${qs}`, token);
    commits.push(...batch);
    if (batch.length < 100) break;
    page += 1;
    if (page > 50) break; // hard cap: 5000 commits
  }
  return commits; // newest first
}

async function listCurrentTree(token, org, repo) {
  const head = await gh(`/repos/${org}/${repo}/git/ref/heads/main`, token);
  const commit = await gh(`/repos/${org}/${repo}/git/commits/${head.object.sha}`, token);
  const tree = await gh(`/repos/${org}/${repo}/git/trees/${commit.tree.sha}?recursive=1`, token);
  return new Set((tree.tree || []).filter((e) => e.type === "blob").map((e) => e.path));
}

async function getCommitDetail(token, org, repo, sha) {
  return gh(`/repos/${org}/${repo}/commits/${sha}`, token);
}

async function getFileAtSha(token, org, repo, path, ref) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const data = await gh(`/repos/${org}/${repo}/contents/${encoded}?ref=${ref}`, token);
  if (data?.encoding !== "base64" || typeof data?.content !== "string") return null;
  return Buffer.from(data.content, "base64").toString("utf8");
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Set GITHUB_TOKEN env var (a classic or fine-grained PAT with repo read access).");
    process.exit(1);
  }
  const { org, repo, out, since } = parseArgs();

  console.log(`Scanning ${org}/${repo} commit history…`);
  const commits = await listAllCommits(token, org, repo, since);
  console.log(`  ${commits.length} commits fetched.`);

  const currentPaths = await listCurrentTree(token, org, repo);
  console.log(`  ${currentPaths.size} files currently present.`);

  // Walk commits newest → oldest. For each deletion commit, grab the file
  // contents from the parent commit. First-seen (newest) deletion wins, so
  // subsequent older deletes of the same path are skipped.
  const recovered = new Map(); // path → { content, deletedInCommit, recoveredFromSha }
  for (const c of commits) {
    const detail = await getCommitDetail(token, org, repo, c.sha);
    const files = detail.files || [];
    const parentSha = detail.parents?.[0]?.sha;
    if (!parentSha) continue;
    for (const f of files) {
      if (f.status !== "removed") continue;
      if (currentPaths.has(f.filename)) continue; // file came back later
      if (recovered.has(f.filename)) continue;
      try {
        const content = await getFileAtSha(token, org, repo, f.filename, parentSha);
        if (content) {
          recovered.set(f.filename, {
            content,
            deletedInCommit: c.sha,
            recoveredFromSha: parentSha,
            deletedAt: c.commit?.author?.date,
            deletedBy: c.commit?.author?.name,
          });
          console.log(`  + ${f.filename}  (deleted ${c.commit?.author?.date} by ${c.commit?.author?.name})`);
        }
      } catch (err) {
        console.warn(`  ! skip ${f.filename}: ${err.message}`);
      }
    }
  }

  if (recovered.size === 0) {
    console.log("No recoverable deletions found.");
    return;
  }

  console.log(`\nWriting ${recovered.size} recovered files to ${out}/`);
  await mkdir(out, { recursive: true });
  const manifest = [];
  for (const [path, info] of recovered) {
    const target = join(out, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, info.content, "utf8");
    manifest.push({ path, ...info, content: undefined });
  }
  await writeFile(join(out, "_manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Done. See ${out}/_manifest.json for per-file recovery metadata.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
