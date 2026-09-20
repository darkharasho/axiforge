"use strict";

/**
 * Resolves which GitHub owner a publish should target.
 *
 * Both the owner *and* its type matter: ensureAxiForgeRepo creates the repo via
 * POST /user/repos for a user and POST /orgs/<owner>/repos for an org. Publish
 * used to hardcode the type to "user", so publishing to an org that had no
 * axibuilds repo yet created it on the personal account instead and then timed
 * out waiting for it to appear under the org.
 *
 * There are two targets, and the item decides which applies:
 *
 *   * A team's target, set once by an owner and mirrored onto the team's root
 *     folder. Anything inside that team publishes there. This is the fix for a
 *     member publishing the team's comp to their own account — the personal
 *     target is a fact about the MACHINE, so it could never be right for work
 *     that belongs to the team, and a publish to the wrong owner succeeds
 *     silently.
 *   * The personal target from Settings, for everything else (and for a team
 *     that has not configured one — which is every team that existed before
 *     this, so nothing changes for them).
 *
 * The stored type is only trusted for a third-party owner. When the target is
 * the signed-in user (explicitly or by falling back), the type is always "user"
 * — that guards against a stale "org" left behind by an earlier selection.
 *
 * @param {object|null} auth - the auth record (reads auth.onboarding)
 * @param {string} viewerLogin - login of the signed-in user, used as fallback
 * @param {object|null} [teamRoot] - the team root folder the item lives under,
 *   as returned by teamSync.teamRootFor; null for personal items
 * @returns {{owner: string, ownerType: "user"|"org", scope: "team"|"personal"}}
 */
function resolvePublishTarget(auth, viewerLogin, teamRoot = null) {
  if (teamRoot?.publishOwner) {
    return {
      ...normalize(teamRoot.publishOwner, teamRoot.publishOwnerType, viewerLogin),
      scope: "team",
    };
  }
  const onboarding = auth?.onboarding || {};
  return {
    ...normalize(onboarding.targetOwner || viewerLogin || "", onboarding.targetOwnerType, viewerLogin),
    scope: "personal",
  };
}

function normalize(owner, ownerType, viewerLogin) {
  if (!owner || owner === viewerLogin) return { owner, ownerType: "user" };
  return { owner, ownerType: ownerType === "org" ? "org" : "user" };
}

module.exports = { resolvePublishTarget };
