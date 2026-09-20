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
 * The stored type is only trusted for a third-party owner. When the target is
 * the signed-in user (explicitly or by falling back), the type is always "user"
 * — that guards against a stale "org" left behind by an earlier selection.
 *
 * @param {object|null} auth - the auth record (reads auth.onboarding)
 * @param {string} viewerLogin - login of the signed-in user, used as fallback
 * @returns {{owner: string, ownerType: "user"|"org"}}
 */
function resolvePublishTarget(auth, viewerLogin) {
  const onboarding = auth?.onboarding || {};
  const owner = onboarding.targetOwner || viewerLogin || "";
  if (!owner || owner === viewerLogin) return { owner, ownerType: "user" };
  return {
    owner,
    ownerType: onboarding.targetOwnerType === "org" ? "org" : "user",
  };
}

module.exports = { resolvePublishTarget };
