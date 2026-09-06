// Where a build comes from, and who uses it.
//
// A comp lives in one folder; the builds it holds can live in any other. Until
// this module there was no way to see that mismatch -- you opened a comp, saw
// "Firebrand", and had to go hunting through the library to learn it actually
// lives three folders away in someone else's team space.
//
// Two questions, one resolver, because they are the same join seen from either
// end:
//
//   compSources(comp)   the comp side  -- "which of my builds come from elsewhere"
//   buildUsage(build)   the library side -- "which comps use this build, and are
//                                           any of them somewhere else"
//
// Membership comes from comp.buildIds (see comp-membership.js for why that and
// not build.compIds). Location is the folder ancestor chain. "External" always
// means the same thing on both sides: the comp's folder is not the build's
// folder. Two items both at the library root count as the same place.
//
// Everything here is a pure read over `state`. No stores, no IPC.

import { state } from "./state.js";
import { compsContainingBuild } from "./comps/comp-membership.js";

/**
 * The folder ancestor chain for an id, root first.
 *
 * A folderId can outlive the folder it names -- the folder is trashed, or a
 * partial team sync lands a build before its folder. That yields a short chain
 * or an empty one, never a throw. The `visited` guard is not paranoia either:
 * a hand-edited folders.json or a bad sync merge can point two folders at each
 * other, and walking that unguarded hangs the renderer.
 *
 * @returns {Array<object>} folder records, root first; [] when unresolvable
 */
export function folderChain(folderId) {
  const chain = [];
  const visited = new Set();
  let id = folderId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const folder = (state.folders || []).find((f) => f.id === id);
    if (!folder) break;
    chain.unshift(folder);
    id = folder.parentId;
  }
  return chain;
}

/** The same chain as display text: "WvW / Zerg / Support", or "" at the root. */
export function folderPathText(folderId, separator = " / ") {
  return folderChain(folderId).map((f) => f.name).join(separator);
}

/**
 * Do these two items sit in the same place? Normalised because a folderId is
 * variously null, undefined or "" for "the library root", and a build at the
 * root inside a comp at the root is not sourced from somewhere else.
 */
function sameFolder(a, b) {
  return (a || null) === (b || null);
}

/** One comp that uses a build, with where that comp lives. */
function usageEntry(comp, buildFolderId) {
  return {
    comp,
    folderPath: folderPathText(comp.folderId),
    isExternal: !sameFolder(comp.folderId, buildFolderId),
  };
}

/**
 * The library side. Every comp that uses this build, each tagged with whether
 * it lives outside the build's own folder.
 *
 * `hasExternal` is what drives the loud chip: a build used only by comps in its
 * own folder is unremarkable, one pulled into a comp across the library is the
 * thing worth surfacing.
 *
 * @param {object|null} build
 * @returns {{count: number, hasExternal: boolean, entries: Array<object>}}
 */
export function buildUsage(build) {
  if (!build?.id) return { count: 0, hasExternal: false, entries: [] };
  const entries = compsContainingBuild(build.id).map((c) => usageEntry(c, build.folderId));
  return {
    count: entries.length,
    hasExternal: entries.some((e) => e.isExternal),
    entries,
  };
}

/**
 * The comp side. One row per build the comp actually holds, in the comp's own
 * order, each with its home folder and the other comps it appears in.
 *
 * A comp can list a build that no longer exists -- a shared comp still names a
 * build the author deleted. Those ids are skipped rather than rendered as
 * phantom rows; the comp detail view already draws its own hole for them.
 *
 * @param {object|null} comp
 * @returns {{rows: Array<object>, total: number, externalCount: number}}
 */
export function compSources(comp) {
  const ids = comp?.buildIds || [];
  const byId = new Map((state.builds || []).map((b) => [b.id, b]));

  const rows = [];
  for (const id of ids) {
    const build = byId.get(id);
    if (!build) continue;
    const chain = folderChain(build.folderId);
    rows.push({
      build,
      chain,
      folderPath: chain.map((f) => f.name).join(" / "),
      leafName: chain.length ? chain[chain.length - 1].name : "",
      isExternal: !sameFolder(build.folderId, comp.folderId),
      otherComps: compsContainingBuild(id)
        .filter((c) => c.id !== comp.id)
        .map((c) => usageEntry(c, build.folderId)),
    });
  }

  return {
    rows,
    total: rows.length,
    externalCount: rows.filter((r) => r.isExternal).length,
  };
}
