import { computeCompPartyCoverage, buildPartyCoverageHTML } from "../renderer/modules/comps/comp-boon-coverage.js";
import { catalogFromPublishedBuild, upgradeCatalogFromPublishedBuild } from "./published-catalog.js";

const NO_BONUS = { concentration: 0, expertise: 0 };

/**
 * Party coverage for a v2 comp, computed in the browser from the member builds
 * with the same code the desktop uses. Each member brings its own catalogs and
 * its baked duration bonus. A member without one (a teammate's build still in
 * v1 format) gets no bonus rather than a wrong one.
 */
export async function computeViewerCoverageHtml(comp, buildsById) {
  const builds = Object.values(buildsById).filter((b) => b && !b.unavailable);
  const catalogs = new Map(builds.map((b) => [b.id, catalogFromPublishedBuild(b)]));
  const upgrades = new Map(builds.map((b) => [b.id, upgradeCatalogFromPublishedBuild(b)]));
  const data = await computeCompPartyCoverage(comp, builds, new Map(), async () => null, null, {
    catalogFor: (b) => catalogs.get(b.id),
    upgradeCatalogFor: (b) => upgrades.get(b.id),
    durationBonusFor: (b) => b.boonDurationBonus || NO_BONUS,
  });
  return buildPartyCoverageHTML(data);
}
