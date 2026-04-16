"use strict";

// Load at call time (not destructured at module load) so tests can mock the module.
function api() {
  return require("./githubApi");
}

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
    const tree = await api().getRepoTree(auth.token, auth.org, auth.repo);
    await this.#pullFolderWithTree(folderId, tree, auth);
  }

  async pullAll() {
    const auth = await this.#getAuth();
    if (!auth) return;

    const folders = await this.folderStore.listFolders();
    const sharedFolders = folders.filter((f) => f.shared);
    if (!sharedFolders.length) return;

    // Fetch tree once for the entire repo (1 API call per poll)
    let tree;
    try {
      tree = await api().getRepoTree(auth.token, auth.org, auth.repo);
    } catch (err) {
      // Transient error: retry once after 5 seconds
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
      const { content } = await api().getFileContents(auth.token, auth.org, auth.repo, fullPath);
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
      const result = await api().putSharedFile(
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
      const result = await api().putSharedFile(
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
      await api().deleteSharedFile(auth.token, auth.org, auth.repo, filePath, sha, "main",
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
      await api().deleteSharedFile(auth.token, auth.org, auth.repo, filePath, sha, "main",
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

    await api().ensureSharedRepo(auth.token, auth.org);

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

    const metaResult = await api().putSharedFile(
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
