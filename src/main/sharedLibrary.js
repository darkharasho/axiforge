"use strict";

// Load at call time (not destructured at module load) so tests can mock the module.
function api() {
  return require("./githubApi");
}

class SharedLibrary {
  constructor({ buildStore, compStore, folderStore, syncStore, historyStore, emit }) {
    this.buildStore = buildStore;
    this.compStore = compStore;
    this.folderStore = folderStore;
    this.syncStore = syncStore;
    this.historyStore = historyStore || null;
    this._emit = typeof emit === "function" ? emit : () => {};
    this._pushTimers = new Map(); // debounce timers per build/comp ID
    this._pollTimer = null;
    this._pushQueue = Promise.resolve(); // serializes GitHub API writes
    this._lastHeadSha = null; // cached HEAD SHA for cheap change detection
    this._pullInProgress = false; // prevents concurrent pullAll() calls
    this._rateLimitedUntil = null; // timestamp (ms) until which pulls are paused
  }

  // Serializes push operations to avoid concurrent commit conflicts on GitHub.
  // Errors are caught so the queue itself never rejects (which would break the chain),
  // but they are re-thrown to the caller so the caller can handle them.
  _enqueuePush(fn) {
    const next = this._pushQueue.then(() => fn());
    // Attach a no-op catch to _pushQueue so a failure doesn't prevent later items from running
    this._pushQueue = next.catch(() => {});
    return next;
  }

  // Walk up the parentId chain to find the closest folder with shared:true
  _findRootShared(folderId, folders) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return null;
    if (folder.shared) return folder;
    if (folder.parentId) return this._findRootShared(folder.parentId, folders);
    return null;
  }

  async #getAuth() {
    const auth = await this.buildStore.getAuth();
    if (!auth?.token || !auth?.sharedLibrary?.orgName) return null;
    return {
      token: auth.token,
      org: auth.sharedLibrary.orgName,
      repo: auth.sharedLibrary.repoName || "axibuilds-shared",
      viewerLogin: auth.viewer?.login || null,
    };
  }

  // ─── Pull ───────────────────────────────────────────────────────────────────

  async pullFolder(folderId) {
    const auth = await this.#getAuth();
    if (!auth) return;
    // Always pull from the root shared folder — subfolders don't have their own GitHub path
    const folders = await this.folderStore.listFolders();
    const rootShared = this._findRootShared(folderId, folders);
    const targetId = rootShared?.id || folderId;
    const tree = await api().getRepoTree(auth.token, auth.org, auth.repo);
    await this.#pullFolderWithTree(targetId, tree, auth);
  }

  async pullAll() {
    // Coalesce concurrent calls: if a pull is already running, skip rather
    // than stacking up duplicate fetches that could race on upsertBuild.
    if (this._pullInProgress) return;
    this._pullInProgress = true;
    try {
      await this._pullAllInner();
    } finally {
      this._pullInProgress = false;
    }
  }

  async _pullAllInner() {
    const auth = await this.#getAuth();
    if (!auth) return;

    const folders = await this.folderStore.listFolders();
    const sharedFolders = folders.filter((f) => f.shared);
    if (!sharedFolders.length) return;

    // Skip if we're in a rate-limit back-off window
    if (this._rateLimitedUntil && Date.now() < this._rateLimitedUntil) return;

    // Cheap HEAD-SHA check: one API call to see if anything changed at all.
    // If the repo HEAD hasn't moved since the last pull we can bail immediately,
    // which makes frequent polling and focus-triggered pulls essentially free.
    try {
      const headSha = await api().getHeadSha(auth.token, auth.org, auth.repo);
      if (headSha && headSha === this._lastHeadSha) return;
      this._lastHeadSha = headSha;
    } catch (err) {
      if (err.code === "GITHUB_UNAUTHORIZED") {
        console.error("[shared-library] token expired — stopping poll");
        this.stopPolling();
        this._emit("sync-status", { status: "error", error: "auth" });
        return;
      }
      if (err.code === "GITHUB_RATE_LIMITED") {
        this._rateLimitedUntil = Date.now() + (err.retryAfterMs || 60_000);
        console.warn(`[shared-library] rate limited — pausing pulls for ${Math.round((err.retryAfterMs || 60_000) / 1000)}s`);
        return;
      }
      // Any other error on the lightweight check: continue to full pull anyway.
    }

    // Fetch tree once for the entire repo (1 API call per poll)
    let tree;
    try {
      tree = await api().getRepoTree(auth.token, auth.org, auth.repo);
    } catch (err) {
      if (err.code === "GITHUB_UNAUTHORIZED") {
        console.error("[shared-library] token expired — stopping poll");
        this.stopPolling();
        this._emit("sync-status", { status: "error", error: "auth" });
        return;
      }
      if (err.code === "GITHUB_RATE_LIMITED") {
        this._rateLimitedUntil = Date.now() + (err.retryAfterMs || 60_000);
        console.warn(`[shared-library] rate limited — pausing pulls for ${Math.round((err.retryAfterMs || 60_000) / 1000)}s`);
        return;
      }
      // Transient server error: retry once after 5 seconds
      if (err.status >= 500 && err.status < 600) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          tree = await api().getRepoTree(auth.token, auth.org, auth.repo);
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
          const { content: metaContent } = await api().getFileContents(auth.token, auth.org, auth.repo, file.path);
          if (metaContent) {
            let meta;
            try { meta = JSON.parse(metaContent); } catch (e) {
              console.warn(`[shared-library] malformed meta.json for folder ${folderId} — skipping`);
              continue;
            }
            await this.folderStore.upsertFolder({
              id: folderId, name: meta.name, sortOrder: meta.sortOrder,
              shared: true, orgName: folder.orgName,
            });
            // Restore any subfolders listed in meta, creating or re-linking as needed
            if (Array.isArray(meta.subfolders)) {
              const allFolders = await this.folderStore.listFolders();
              for (const sf of meta.subfolders) {
                const correctParentId = sf.parentId || folderId;
                const existing = allFolders.find((f) => f.id === sf.id);
                if (!existing) {
                  await this.folderStore.upsertFolder({
                    id: sf.id,
                    name: sf.name,
                    parentId: correctParentId,
                  });
                } else if (existing.parentId !== correctParentId) {
                  // Re-link under correct parent (handles disconnect-reconnect where a
                  // former root shared folder is now a subfolder of a different shared root)
                  await this.folderStore.upsertFolder({
                    id: sf.id,
                    name: sf.name,
                    parentId: correctParentId,
                    shared: false,
                  });
                }
              }
            }
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

    // Emit syncing for all changed items up-front so spinners appear immediately
    for (const { relPath } of changed) {
      if (relPath.startsWith("builds/")) {
        const itemId = relPath.replace("builds/", "").replace(/\.json$/, "");
        this._emit("sync-status", { status: "syncing", type: "build", id: itemId, folderId });
      } else if (relPath.startsWith("comps/")) {
        const itemId = relPath.replace("comps/", "").replace(/\.json$/, "");
        this._emit("sync-status", { status: "syncing", type: "comp", id: itemId, folderId });
      }
    }

    // Phase 1 — fetch all file contents in parallel (network I/O, safe to parallelise).
    // Phase 2 — apply to the local store sequentially (the store does read-modify-write
    // on a shared JSON file, so concurrent upserts would race and drop each other's writes).
    const FETCH_CONCURRENCY = 4;
    const fetched = [];
    for (let i = 0; i < changed.length; i += FETCH_CONCURRENCY) {
      const batch = await Promise.all(
        changed.slice(i, i + FETCH_CONCURRENCY).map(async ({ relPath, sha }) => {
          const fullPath = `${prefix}${relPath}`;
          try {
            const { content } = await api().getFileContents(auth.token, auth.org, auth.repo, fullPath);
            if (!content) return null;
            let data;
            try { data = JSON.parse(content); } catch {
              console.warn(`[shared-library] malformed JSON at ${fullPath} — skipping`);
              return null;
            }
            return { relPath, sha, data };
          } catch (err) {
            console.error(`[shared-library] failed to fetch ${relPath}:`, err.message);
            return null;
          }
        })
      );
      fetched.push(...batch);
    }

    // Phase 2 — apply writes sequentially to avoid store races
    for (const item of fetched) {
      if (!item) continue;
      const { relPath, sha, data } = item;
      const key = relPath.replace(/\.json$/, "");
      if (relPath.startsWith("builds/")) {
        const restoreFolderId = data.folderId || folderId;
        if (restoreFolderId !== folderId) {
          const allFolders = await this.folderStore.listFolders();
          const existingSubFolder = allFolders.find((f) => f.id === restoreFolderId);
          if (!existingSubFolder) {
            await this.folderStore.upsertFolder({
              id: restoreFolderId,
              name: data._syncSubFolderName || "Subfolder",
              parentId: folderId,
            });
          } else if (existingSubFolder.parentId !== folderId) {
            // Re-link under correct shared root (handles disconnect-reconnect where this
            // folder previously existed as a root-level or differently-parented folder)
            await this.folderStore.upsertFolder({
              id: restoreFolderId,
              name: data._syncSubFolderName || existingSubFolder.name,
              parentId: folderId,
              shared: false,
            });
          }
        }
        const syncAuthor = data._syncAuthor || auth.org || "unknown";
        delete data._syncSubFolderName;
        delete data._syncAuthor;
        data.folderId = restoreFolderId;
        if (this.historyStore) {
          const { summarizeBuildChange } = require("./buildHistoryStore");
          const existingBuilds = await this.buildStore.listBuilds();
          const existingBuild = existingBuilds.find((b) => b.id === data.id);
          if (existingBuild) {
            this.historyStore.addEntry({
              buildId: data.id,
              authorLogin: syncAuthor,
              source: "shared-sync",
              summary: summarizeBuildChange(existingBuild, data),
              snapshot: existingBuild,
            }).catch((err) => console.warn("[history] shared addEntry failed:", err.message));
          }
        }
        const savedBuild = await this.buildStore.upsertBuild(data);
        await this.syncStore.setSha(folderId, key, sha);
        this._emit("sync-status", { status: "synced", type: "build", id: data.id, folderId, item: savedBuild });
      } else if (relPath.startsWith("comps/")) {
        const restoreFolderId = data.folderId || folderId;
        if (restoreFolderId !== folderId) {
          const allFolders = await this.folderStore.listFolders();
          const existingSubFolder = allFolders.find((f) => f.id === restoreFolderId);
          if (!existingSubFolder) {
            await this.folderStore.upsertFolder({
              id: restoreFolderId,
              name: data._syncSubFolderName || "Subfolder",
              parentId: folderId,
            });
          } else if (existingSubFolder.parentId !== folderId) {
            // Re-link under correct shared root (handles disconnect-reconnect where this
            // folder previously existed as a root-level or differently-parented folder)
            await this.folderStore.upsertFolder({
              id: restoreFolderId,
              name: data._syncSubFolderName || existingSubFolder.name,
              parentId: folderId,
              shared: false,
            });
          }
        }
        delete data._syncSubFolderName;
        data.folderId = restoreFolderId;
        const savedComp = await this.compStore.upsertComp(data);
        await this.syncStore.setSha(folderId, key, sha);
        this._emit("sync-status", { status: "synced", type: "comp", id: data.id, folderId, item: savedComp });
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
    const rootShared = this._findRootShared(build.folderId, folders);
    if (!rootShared) return { conflict: false };

    const key = `builds/${build.id}`;
    const filePath = `folders/${rootShared.id}/${key}.json`;
    const shas = await this.syncStore.getShas(rootShared.id);
    const currentSha = shas[key] || null;

    // Strip local-only fields; preserve folderId if in a subfolder so pull can restore it
    const { compId, pinned, sortOrder, ...buildData } = build;
    if (build.folderId === rootShared.id) {
      delete buildData.folderId; // implied by folder path
    } else {
      // Include subfolder name so the other side can auto-create it
      const subFolder = folders.find((f) => f.id === build.folderId);
      if (subFolder) buildData._syncSubFolderName = subFolder.name;
    }
    // Embed author so pull-side history entries show who made the change
    if (auth.viewerLogin) buildData._syncAuthor = auth.viewerLogin;
    const content = JSON.stringify(buildData, null, 2);

    const attemptPush = async (sha) => {
      const result = await api().putSharedFile(
        auth.token, auth.org, auth.repo,
        filePath, content, sha, "main",
        `Update build: ${build.title || build.id}`
      );
      await this.syncStore.setSha(rootShared.id, key, result.sha);
      return { conflict: false };
    };

    try {
      return await attemptPush(currentSha);
    } catch (err) {
      if (err.status !== 409) throw err;
      // SHA mismatch — fetch the current remote SHA and retry once
      try {
        const { sha: remoteSha } = await api().getFileContents(
          auth.token, auth.org, auth.repo, filePath
        );
        await this.syncStore.setSha(rootShared.id, key, remoteSha);
        return await attemptPush(remoteSha);
      } catch (retryErr) {
        if (retryErr.status === 404) {
          // File was deleted remotely; push as new
          return await attemptPush(null);
        }
        throw retryErr;
      }
    }
  }

  async pushComp(comp) {
    const auth = await this.#getAuth();
    if (!auth) return { conflict: false };

    const folders = await this.folderStore.listFolders();
    const rootShared = this._findRootShared(comp.folderId, folders);
    if (!rootShared) return { conflict: false };

    const key = `comps/${comp.id}`;
    const filePath = `folders/${rootShared.id}/${key}.json`;
    const shas = await this.syncStore.getShas(rootShared.id);
    const currentSha = shas[key] || null;

    const { ...compData } = comp;
    if (comp.folderId === rootShared.id) {
      delete compData.folderId;
    } else {
      const subFolder = folders.find((f) => f.id === comp.folderId);
      if (subFolder) compData._syncSubFolderName = subFolder.name;
    }
    if (auth.viewerLogin) compData._syncAuthor = auth.viewerLogin;
    const content = JSON.stringify(compData, null, 2);

    const attemptPush = async (sha) => {
      const result = await api().putSharedFile(
        auth.token, auth.org, auth.repo,
        filePath, content, sha, "main",
        `Update comp: ${comp.name || comp.id}`
      );
      await this.syncStore.setSha(rootShared.id, key, result.sha);
      return { conflict: false };
    };

    try {
      return await attemptPush(currentSha);
    } catch (err) {
      if (err.status !== 409) throw err;
      try {
        const { sha: remoteSha } = await api().getFileContents(
          auth.token, auth.org, auth.repo, filePath
        );
        await this.syncStore.setSha(rootShared.id, key, remoteSha);
        return await attemptPush(remoteSha);
      } catch (retryErr) {
        if (retryErr.status === 404) {
          return await attemptPush(null);
        }
        throw retryErr;
      }
    }
  }

  async deleteBuildRemote(folderId, buildId) {
    const auth = await this.#getAuth();
    if (!auth) return;

    const folders = await this.folderStore.listFolders();
    const rootShared = this._findRootShared(folderId, folders);
    const rootId = rootShared?.id || folderId;

    const key = `builds/${buildId}`;
    const filePath = `folders/${rootId}/${key}.json`;
    const shas = await this.syncStore.getShas(rootId);
    const sha = shas[key];
    if (!sha) return;

    try {
      await api().deleteSharedFile(auth.token, auth.org, auth.repo, filePath, sha, "main",
        `Delete build: ${buildId}`);
      await this.syncStore.removeSha(rootId, key);
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
    const folders = await this.folderStore.listFolders();
    const rootShared = this._findRootShared(folderId, folders);
    const rootId = rootShared?.id || folderId;

    const filePath = `folders/${rootId}/${key}.json`;
    const shas = await this.syncStore.getShas(rootId);
    const sha = shas[key];
    if (!sha) return;

    try {
      await api().deleteSharedFile(auth.token, auth.org, auth.repo, filePath, sha, "main",
        `Delete comp: ${compId}`);
      await this.syncStore.removeSha(rootId, key);
    } catch (err) {
      if (err.status === 409) {
        return { conflict: true };
      }
      throw err;
    }
  }

  // ─── Folder meta push ──────────────────────────────────────────────────────

  // Collect all direct and indirect children of rootId from allFolders array.
  _collectDescendantFolders(rootId, allFolders) {
    const result = [];
    const queue = allFolders.filter((f) => f.parentId === rootId);
    while (queue.length) {
      const f = queue.shift();
      result.push(f);
      queue.push(...allFolders.filter((x) => x.parentId === f.id));
    }
    return result;
  }

  // Build the meta.json payload for a root shared folder (includes subfolders list).
  async #buildMetaPayload(folderId, folder, allFolders) {
    const subfolders = this._collectDescendantFolders(folderId, allFolders);
    return JSON.stringify({
      id: folder.id,
      name: folder.name,
      sortOrder: folder.sortOrder || 0,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
      subfolders: subfolders.map((sf) => ({
        id: sf.id, name: sf.name, parentId: sf.parentId,
      })),
    }, null, 2);
  }

  // Push updated meta.json (folder name + subfolder list) for a root shared folder.
  async pushFolderMeta(rootFolderId) {
    const auth = await this.#getAuth();
    if (!auth) return { conflict: false };

    const allFolders = await this.folderStore.listFolders();
    const folder = allFolders.find((f) => f.id === rootFolderId && f.shared);
    if (!folder) return { conflict: false };

    const metaContent = await this.#buildMetaPayload(rootFolderId, folder, allFolders);
    const shas = await this.syncStore.getShas(rootFolderId);
    const currentSha = shas["meta"] || null;

    try {
      const result = await api().putSharedFile(
        auth.token, auth.org, auth.repo,
        `folders/${rootFolderId}/meta.json`, metaContent, currentSha, "main",
        `Update folder structure: ${folder.name}`
      );
      await this.syncStore.setSha(rootFolderId, "meta", result.sha);
      return { conflict: false };
    } catch (err) {
      if (err.status === 409) return { conflict: true };
      throw err;
    }
  }

  // Debounced version — use from index.js when a subfolder is created/renamed/deleted.
  schedulePushFolderMeta(rootFolderId, delayMs = 2000) {
    const key = `meta:${rootFolderId}`;
    const existing = this._pushTimers.get(key);
    if (existing) clearTimeout(existing?.id ?? existing);
    const timerId = setTimeout(async () => {
      this._pushTimers.delete(key);
      try {
        const result = await this.pushFolderMeta(rootFolderId);
        if (result?.conflict) {
          this._emit("sync-conflict", { type: "folder", id: rootFolderId, folderId: rootFolderId });
        } else {
          this._emit("sync-status", { status: "synced", folderId: rootFolderId });
        }
      } catch (err) {
        console.error(`Shared library folder meta push failed for ${rootFolderId}:`, err.message);
        this._emit("sync-status", { status: "error", folderId: rootFolderId });
      }
    }, delayMs);
    this._pushTimers.set(key, { id: timerId, scheduledAt: Date.now() });
  }

  // ─── Share / unshare folder ─────────────────────────────────────────────────

  async shareFolder(folderId) {
    return this._enqueuePush(async () => {
    const auth = await this.#getAuth();
    if (!auth) throw new Error("Not authenticated or no shared library configured");

    await api().ensureSharedRepo(auth.token, auth.org);

    const allFolders = await this.folderStore.listFolders();
    const folder = allFolders.find((f) => f.id === folderId);
    if (!folder) throw new Error("Folder not found");

    // Create meta.json (includes subfolder list)
    const metaContent = await this.#buildMetaPayload(folderId, folder, allFolders);

    const metaResult = await api().putSharedFile(
      auth.token, auth.org, auth.repo,
      `folders/${folderId}/meta.json`, metaContent, null, "main",
      `Share folder: ${folder.name}`
    );
    await this.syncStore.setSha(folderId, "meta", metaResult.sha);

    // Push all builds in this folder and any subfolders
    const folderTree = new Set([folderId]);
    // collect all descendant folder IDs (reuse allFolders already loaded above)
    const addChildren = (id) => {
      for (const f of allFolders.filter((f) => f.parentId === id)) {
        folderTree.add(f.id);
        addChildren(f.id);
      }
    };
    addChildren(folderId);

    // Mark folder as shared locally before pushing builds so that
    // pushBuild/_findRootShared can find this folder as the shared root.
    await this.folderStore.upsertFolder({
      id: folderId,
      name: folder.name,
      shared: true,
      orgName: auth.org,
      lastSyncedAt: new Date().toISOString(),
    });

    const builds = await this.buildStore.listBuilds();
    for (const build of builds.filter((b) => folderTree.has(b.folderId))) {
      await this.pushBuild(build);
    }

    // Push all comps in this folder and subfolders
    const comps = await this.compStore.listComps();
    for (const comp of comps.filter((c) => folderTree.has(c.folderId))) {
      await this.pushComp(comp);
    }
    }); // end _enqueuePush
  }

  async unshareFolder(folderId) {
    // Cancel any pending debounced pushes for items in this folder to prevent them
    // from re-uploading content to a folder we're about to remove from GitHub.
    for (const [key, timer] of this._pushTimers) {
      clearTimeout(timer?.id ?? timer);
      this._pushTimers.delete(key);
    }

    const folders = await this.folderStore.listFolders();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;

    // Delete all files under folders/{folderId}/ from GitHub.
    // Throw on non-404 errors so we don't mark the folder unshared if cleanup fails.
    const auth = await this.#getAuth();
    if (auth) {
      const tree = await api().getRepoTree(auth.token, auth.org, auth.repo);
      const prefix = `folders/${folderId}/`;
      const filesToDelete = tree.filter((e) => e.path.startsWith(prefix));
      for (const file of filesToDelete) {
        try {
          await api().deleteSharedFile(
            auth.token, auth.org, auth.repo, file.path, file.sha, "main",
            `Remove shared folder: ${folderId}`
          );
        } catch (err) {
          if (err?.status !== 404) throw err; // 404 = already gone, anything else = real failure
        }
      }
    }

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

  // Invalidate the cached HEAD SHA so the next pullAll() always does a full
  // fetch even if the HEAD hasn't moved (used after a local push so other
  // clients get their own changes reflected immediately on the next poll).
  invalidateHeadShaCache() {
    this._lastHeadSha = null;
  }

  startPolling(intervalMs = 60 * 1000) {
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

  schedulePush(type, item, delayMs = 2000, maxDelayMs = 10_000) {
    const key = `${type}:${item.id}`;
    // If a timer is already running, reset the debounce but respect the max delay:
    // don't push out the deadline if it's already been extended past maxDelayMs.
    if (this._pushTimers.has(key)) {
      const existing = this._pushTimers.get(key);
      const elapsed = Date.now() - existing.scheduledAt;
      if (elapsed >= maxDelayMs - delayMs) {
        // Already close to or past the max delay — let the existing timer fire.
        return;
      }
      clearTimeout(existing.id);
    }
    const timerId = setTimeout(() => {
      this._pushTimers.delete(key);
      this._enqueuePush(async () => {
        try {
          let result;
          if (type === "build") {
            result = await this.pushBuild(item);
          } else if (type === "comp") {
            result = await this.pushComp(item);
          }
          // Invalidate HEAD SHA cache after any successful push so the next
          // poll by this client doesn't skip its own freshly-landed commit.
          this.invalidateHeadShaCache();
          if (result?.conflict) {
            this._emit("sync-conflict", { type, id: item.id, title: item.title || item.name, folderId: item.folderId });
            // Clear per-item syncing state even on conflict (conflict handled by separate toast)
            this._emit("sync-status", { status: "synced", type, id: item.id, folderId: item.folderId });
          } else {
            this._emit("sync-status", { status: "synced", type, id: item.id, folderId: item.folderId });
            this._emit("sync-status", { status: "synced", folderId: item.folderId });
          }
        } catch (err) {
          console.error(`Shared library push failed for ${key}:`, err.message);
          this._emit("sync-status", { status: "error", type, id: item.id, folderId: item.folderId });
          this._emit("sync-status", { status: "error", folderId: item.folderId });
        }
      });
    }, delayMs);
    this._pushTimers.set(key, { id: timerId, scheduledAt: Date.now() });
  }
}

module.exports = { SharedLibrary };
