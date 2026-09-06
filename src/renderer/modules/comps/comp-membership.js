// Which comps a build actually belongs to.
//
// There are two records of that fact and only one of them survives team sync:
//
//   comp.buildIds  travels with the comp (not in COMP_LOCAL_FIELDS)
//   build.compIds  does NOT -- it is in BUILD_LOCAL_FIELDS, so it is stripped
//                  off every build pushed to or pulled from a team
//
// (both lists: src/main/teamSync.js)
//
// So on any machine that PULLED a shared comp rather than authoring it, the
// comp knows its builds and the builds have no idea they are in a comp.
// Anything that counted build.compIds reported "in 0 comps" for builds that are
// plainly sitting in one -- which is exactly the shape of the bug: shared
// builds, genuinely in a comp, not counted as in a comp.
//
// build.compIds is still written and still useful (undo snapshots, .axicode
// export, duplicating a build into a comp) -- it just cannot be trusted as the
// answer to "is this build in a comp". Read membership from the comps.

import { state } from "../state.js";

/** The comp records that list this build, in state order. */
export function compsContainingBuild(buildId) {
  if (!buildId) return [];
  return (state.comps || []).filter((c) => (c.buildIds || []).includes(buildId));
}

/** How many comps this build is in. */
export function compCountForBuild(buildId) {
  return compsContainingBuild(buildId).length;
}

/** True when the build belongs to at least one comp. */
export function isBuildInAnyComp(buildId) {
  return compsContainingBuild(buildId).length > 0;
}

/**
 * A Set of every build id claimed by any comp -- for callers that test many
 * builds at once and would otherwise rescan every comp per build.
 */
export function buildIdsInAnyComp() {
  const ids = new Set();
  for (const c of state.comps || []) {
    for (const id of c.buildIds || []) ids.add(id);
  }
  return ids;
}
