"use strict";

// One publish round: every queued item, grouped by the owner it publishes to,
// one commit per owner. Ported from the per-item publishBuildImpl /
// publishCompImpl in index.js, which now go through the queue.

const { buildEncryptedBuildFile, buildEncryptedCompFile, buildRedirectFile } = require("./siteBundle");
const { serializeCompForPublish, getCompPublishBuildIds, planCompMembers } = require("./compPublish");
const { slugifyBuildName, generateFileId, generateEncryptionKey, getDefaultBuildName } = require("./buildEncryption");
const { buildReceipt, compReceipt } = require("./publishFingerprint");
const { formatStamp } = require("./formatMigration");
const { memberStampTargets } = require("./teamGuards");
const { PROFESSION_ACCENTS: PROFESSION_THEME_IDS } = require("./accents");

const REPO = "axibuilds";
const PAGES_TIMEOUT_MS = 180000;

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function publishedPageUrl({ kind, owner, slug, fileId, key, theme, repo = REPO }) {
  const param = kind === "comp" ? "c" : "b";
  return `https://${owner}.github.io/${repo}/?n=${encodeURIComponent(slug)}&${param}=${fileId}.${key}${theme ? `&t=${theme}` : ""}`;
}

// The page of an untitled build carries its default name. The record keeps its
// own title: renaming it from a background publish would fight the editor.
function displayTitle(build) {
  const title = String(build?.title || "").trim();
  return title && title !== "Untitled Build" ? title : getDefaultBuildName(build?.specializations, build?.profession);
}

function prepareError(build, err) {
  const wrapped = new Error(`Couldn't prepare "${build.title || build.profession || "Build"}": ${err?.message || err}`);
  wrapped.cause = err;
  if (err?.code) wrapped.code = err.code;
  if (err?.status) wrapped.status = err.status;
  return wrapped;
}

function createPublishBatch(deps) {
  const {
    getSession, getAuthRecord, patchAuthRecord, findTeamRoot, resolvePublishTarget,
    listBuilds, listComps, markBuildPublished, markCompPublished, getSetting,
    enrichBuildForPublish, buildSpaBundle, addFormatMigrations, stampFormatMigrations,
    ensurePublishInfra, invalidatePublishInfra, publishSiteBundle, triggerPagesWorkflow, pollUrlLive,
    teamPut, choiceOf,
    newFileId = generateFileId, newKey = generateEncryptionKey, repo = REPO,
  } = deps;

  async function themes() {
    const appTheme = (await getSetting("appearance.theme")) || "";
    const themedBuilds = await getSetting("appearance.themedBuildPages");
    return {
      comp: appTheme,
      build: (build) => (themedBuilds && build.profession && PROFESSION_THEME_IDS[build.profession]) || appTheme,
    };
  }

  return async function publishBatch(items) {
    const session = await getSession();
    if (!session) throw coded("Sign in with GitHub to publish.", "PUBLISH_DISCONNECTED");
    const auth = await getAuthRecord();
    const branch = auth?.onboarding?.branch || "main";
    const personalReady = Boolean(auth?.onboarding?.repoReady || auth?.onboarding?.forkReady);
    const [builds, comps] = await Promise.all([listBuilds(), listComps()]);
    const buildsById = new Map(builds.map((x) => [x.id, x]));
    const compsById = new Map(comps.map((x) => [x.id, x]));
    const theme = await themes();
    const results = [];

    const groups = new Map();
    for (const { kind, id } of items) {
      const record = kind === "comp" ? compsById.get(id) : buildsById.get(id);
      if (!record || record.deletedAt) {
        results.push({ kind, id, ok: true, skipped: "gone" });
        continue;
      }
      try {
        const teamRoot = await findTeamRoot(record.folderId);
        const target = resolvePublishTarget(auth, session.viewer.login, teamRoot);
        if (target.scope === "personal" && !personalReady) {
          throw coded("Set up publishing to publish.", "PUBLISH_DISCONNECTED");
        }
        if (record.publishedOwner && record.publishedOwner !== target.owner && choiceOf(kind, id) !== "mine") {
          throw new Error(`PUBLISHED_BY_OTHER:${record.publishedOwner}`);
        }
        const group = groups.get(target.owner) || { owner: target.owner, ownerType: target.ownerType, personal: false, entries: [] };
        if (target.scope === "personal") group.personal = true;
        group.entries.push({ kind, id, record, teamRoot });
        groups.set(target.owner, group);
      } catch (err) {
        results.push({ kind, id, ok: false, error: err });
      }
    }

    for (const group of orderGroups([...groups.values()])) {
      results.push(...await publishGroup(group, { session, branch, buildsById, theme }));
    }
    return { results };
  };

  // A group that publishes a queued build runs before any group whose queued
  // comps contain it, so the later group links the build's page instead of
  // minting a second copy under its own owner. Stable otherwise; a cycle falls
  // back to the stable order.
  function orderGroups(list) {
    const ownerOfBuild = new Map();
    for (const g of list) for (const e of g.entries) if (e.kind === "build") ownerOfBuild.set(e.id, g.owner);
    const deps = new Map(list.map((g) => [g.owner, new Set()]));
    for (const g of list) {
      for (const e of g.entries) {
        if (e.kind !== "comp") continue;
        for (const id of getCompPublishBuildIds(e.record)) {
          const from = ownerOfBuild.get(id);
          if (from && from !== g.owner) deps.get(g.owner).add(from);
        }
      }
    }
    const remaining = [...list];
    const ordered = [];
    while (remaining.length) {
      const i = remaining.findIndex((g) => [...deps.get(g.owner)].every((o) => !remaining.some((r) => r.owner === o)));
      ordered.push(...remaining.splice(i === -1 ? 0 : i, 1));
    }
    return ordered;
  }

  async function publishGroup({ owner, ownerType, personal, entries }, { session, branch, buildsById, theme }) {
    const results = [];
    const bundle = {};
    const prepared = [];
    // Builds uploaded in this commit, so a build queued itself AND linked from
    // one or more comps is uploaded once and every link names the same file.
    const uploaded = new Map();      // buildId → { fileId, key, slug, filePath, isNew }
    const memberPatches = new Map(); // buildId → receipt for a member uploaded only through a comp

    const uploadBuild = async (build, ids) => {
      if (uploaded.has(build.id)) return uploaded.get(build.id);
      const title = displayTitle(build);
      let enriched;
      try {
        enriched = await enrichBuildForPublish({ ...build, title });
      } catch (err) {
        throw prepareError(build, err);
      }
      const file = buildEncryptedBuildFile(enriched, ids.fileId, ids.key);
      const redirect = buildRedirectFile(ids.fileId, ids.key, "b");
      bundle[file.filePath] = file.content;
      bundle[redirect.filePath] = redirect.content;
      const upload = { fileId: ids.fileId, key: ids.key, slug: ids.slug, filePath: file.filePath, isNew: !build.publishedFileId };
      uploaded.set(build.id, upload);
      return upload;
    };

    const buildPatch = (build, upload) => {
      const receipt = buildReceipt(build);
      return {
        publishedSlug: upload.slug,
        publishedFileId: upload.fileId,
        publishedKey: upload.key,
        publishedOwner: owner,
        // The snapshot that was serialized: a save made during the upload
        // leaves the build reading out of date, and it is already queued.
        snapshotUpdatedAt: build.updatedAt,
        ...receipt,
        publishedFormat: formatStamp("build", receipt.publishedHash),
      };
    };

    const prepareBuild = async (build) => {
      if (!build.profession) throw new Error("Build must have a profession selected.");
      const upload = await uploadBuild(build, {
        fileId: build.publishedFileId || newFileId(),
        key: build.publishedKey || newKey(),
        slug: slugifyBuildName(displayTitle(build)),
      });
      return { ...upload, patch: buildPatch(build, upload) };
    };

    const prepareComp = async (comp) => {
      const name = String(comp.name || "").trim();
      if (!name || name === "Untitled Comp") throw new Error("Comp name is required for publishing.");
      const memberIds = getCompPublishBuildIds(comp);
      // A member already uploaded in this commit is planned under the ids it
      // was uploaded with, so planCompMembers links it instead of minting new ones.
      const compBuilds = memberIds.map((id) => buildsById.get(id)).filter(Boolean).map((build) => {
        const up = uploaded.get(build.id);
        return up ? { ...build, publishedFileId: up.fileId, publishedKey: up.key, publishedSlug: up.slug, publishedOwner: owner } : build;
      });
      const plan = planCompMembers({
        compBuilds, owner, force: choiceOf("comp", comp.id) === "mine",
        slugOf: (build) => uploaded.get(build.id)?.slug || slugifyBuildName(displayTitle(build)),
        themeOf: theme.build,
        newFileId, newKey,
      });
      for (const u of plan.uploads) {
        const original = buildsById.get(u.build.id);
        const upload = await uploadBuild(original, u);
        if (memberPatches.has(original.id)) continue;
        const patch = buildPatch(original, upload);
        if (u.needsRecord || upload.isNew || original.publishedHash !== patch.publishedHash || original.publishedFormat !== patch.publishedFormat) {
          memberPatches.set(original.id, patch);
        }
      }
      const fileId = comp.publishedFileId || newFileId();
      const key = comp.publishedKey || newKey();
      const slug = slugifyBuildName(comp.name);
      const file = buildEncryptedCompFile(serializeCompForPublish(comp, plan.members), fileId, key);
      const redirect = buildRedirectFile(fileId, key, "c");
      bundle[file.filePath] = file.content;
      bundle[redirect.filePath] = redirect.content;
      // v2 links members, so the comp page can't go stale through them: no
      // member hashes. A member's own staleness shows on the member.
      const receipt = compReceipt(comp, []);
      return {
        fileId, key, slug, filePath: file.filePath, isNew: !comp.publishedFileId,
        skippedForeignBuilds: plan.foreign,
        patch: {
          publishedFileId: fileId,
          publishedKey: key,
          publishedSlug: slug,
          publishedOwner: owner,
          boonCoverageHtml: "",
          snapshotUpdatedAt: comp.updatedAt,
          ...receipt,
          publishedFormat: formatStamp("comp", receipt.publishedHash),
        },
      };
    };

    // Builds first, so a comp in the same commit links the files they wrote.
    const ordered = [...entries.filter((e) => e.kind === "build"), ...entries.filter((e) => e.kind === "comp")];
    for (const entry of ordered) {
      try {
        const prep = entry.kind === "build" ? await prepareBuild(entry.record) : await prepareComp(entry.record);
        prepared.push({ ...entry, ...prep });
      } catch (err) {
        results.push({ kind: entry.kind, id: entry.id, ok: false, error: err });
      }
    }
    if (!prepared.length) return results;
    const failAll = (err) => [...results, ...prepared.map(({ kind, id }) => ({ kind, id, ok: false, error: err }))];

    let migrated;
    let upload;
    try {
      const fullBundle = { ...buildSpaBundle(), ...bundle };
      const excludeIds = [...new Set([...prepared.map((p) => p.id), ...uploaded.keys()])];
      migrated = await addFormatMigrations(fullBundle, owner, excludeIds);
      const attempt = async () => {
        await ensurePublishInfra(session.token, owner, ownerType, branch);
        return publishSiteBundle(session.token, owner, fullBundle, branch, repo);
      };
      try {
        upload = await attempt();
      } catch (err) {
        if (err?.status !== 404) throw err;
        // Repo or Pages went missing: re-verify the infrastructure once.
        invalidatePublishInfra(owner, branch);
        upload = await attempt();
      }
    } catch (err) {
      return failAll(err);
    }

    if (upload.shellChanged) {
      await triggerPagesWorkflow(session.token, owner, branch, repo).catch(() => null);
    }
    // Pinned to the new commit: an older copy of the file can't answer, so a
    // republish no longer passes before its own upload is readable.
    const dataUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${upload.commitSha}/${prepared[0].filePath}`;
    if (!(await pollUrlLive(dataUrl))) {
      return failAll(coded("Uploaded, but the link did not go live in time.", "PUBLISH_NOT_LIVE"));
    }
    // Only a new /r/ page or a new viewer waits for the Pages deploy; a
    // republish is served from raw as soon as the commit lands.
    const fresh = prepared.find((p) => p.isNew);
    if (fresh || upload.shellChanged) {
      const pageUrl = fresh ? `https://${owner}.github.io/${repo}/r/${fresh.fileId}/` : `https://${owner}.github.io/${repo}/`;
      if (!(await pollUrlLive(pageUrl, { timeoutMs: PAGES_TIMEOUT_MS }))) {
        return failAll(coded("Uploaded, but the site did not go live in time.", "PUBLISH_NOT_LIVE"));
      }
    }

    // Receipts patch publish fields only. Re-upserting the snapshot would
    // clobber a save made while the upload was in flight.
    const stampedMembers = [];
    const itemBuildIds = new Set(prepared.filter((p) => p.kind === "build").map((p) => p.id));
    for (const [id, patch] of memberPatches) {
      if (itemBuildIds.has(id)) continue;
      try {
        const saved = await markBuildPublished(id, patch);
        if (saved) stampedMembers.push(saved);
        buildsById.set(id, { ...buildsById.get(id), ...patch });
      } catch (err) {
        console.warn("[publish] member stamp failed", id, err?.message || err);
      }
    }
    for (const p of prepared) {
      let saved;
      try {
        saved = p.kind === "build" ? await markBuildPublished(p.id, p.patch) : await markCompPublished(p.id, p.patch);
      } catch (err) {
        results.push({ kind: p.kind, id: p.id, ok: false, error: err });
        continue;
      }
      // Later owner groups in this round read the receipt, so a build already
      // published here is linked, not uploaded again.
      if (p.kind === "build") buildsById.set(p.id, { ...buildsById.get(p.id), ...p.patch });
      // The commit landed and the receipt is stamped: nothing below may fail the item.
      if (saved && p.teamRoot) {
        try {
          await teamPut(p.teamRoot.teamId, p.id, p.kind);
        } catch (err) {
          console.warn("[publish] team sync failed", p.kind, p.id, err?.message || err);
        }
      }
      results.push({
        kind: p.kind,
        id: p.id,
        ok: true,
        pagesUrl: publishedPageUrl({
          kind: p.kind, owner, slug: p.slug, fileId: p.fileId, key: p.key, repo,
          theme: p.kind === "comp" ? theme.comp : theme.build(p.record),
        }),
        slug: p.slug,
        fileId: p.fileId,
        changed: true,
        ...(p.kind === "comp" ? { skippedForeignBuilds: p.skippedForeignBuilds } : {}),
      });
    }
    // Each member goes to ITS OWN team, or nowhere if personal.
    try {
      for (const { teamId, buildId } of await memberStampTargets(stampedMembers, findTeamRoot)) {
        try {
          await teamPut(teamId, buildId, "build");
        } catch (err) {
          console.warn("[publish] member team sync failed", buildId, err?.message || err);
        }
      }
    } catch (err) {
      console.warn("[publish] member team lookup failed", err?.message || err);
    }
    try {
      await stampFormatMigrations(migrated);
    } catch (err) {
      console.warn("[publish] format migration stamp failed", err?.message || err);
    }

    // Only a personal publish updates this machine's own publishing setup; a
    // team publish stamped here would repoint the personal target at the team.
    if (personal) {
      try {
        await patchAuthRecord({
          onboarding: {
            repoReady: true,
            forkReady: true,
            repoName: repo,
            pagesReady: false,
            pagesBuildStatus: "queued",
            pagesBuildUpdatedAt: new Date().toISOString(),
            pagesBuildError: null,
            pagesUrl: `https://${owner}.github.io/${repo}/`,
            branch,
            targetOwner: owner,
            targetOwnerType: ownerType,
          },
        });
      } catch (err) {
        console.warn("[publish] onboarding update failed", err?.message || err);
      }
    }
    return results;
  }
}

module.exports = { createPublishBatch, publishedPageUrl, displayTitle, PAGES_TIMEOUT_MS };
