"use strict";

const { resolvePublishTarget } = require("../../src/main/publishTarget");

const VIEWER = "octocat";

describe("resolvePublishTarget", () => {
  test("falls back to the signed-in user when nothing is configured", () => {
    expect(resolvePublishTarget(null, VIEWER)).toEqual({ owner: VIEWER, ownerType: "user", scope: "personal" });
    expect(resolvePublishTarget({}, VIEWER)).toEqual({ owner: VIEWER, ownerType: "user", scope: "personal" });
    expect(resolvePublishTarget({ onboarding: {} }, VIEWER)).toEqual({
      owner: VIEWER,
      ownerType: "user",
      scope: "personal",
    });
  });

  test("returns the configured org with ownerType org", () => {
    const auth = { onboarding: { targetOwner: "gw2eww", targetOwnerType: "org" } };
    expect(resolvePublishTarget(auth, VIEWER)).toEqual({ owner: "gw2eww", ownerType: "org", scope: "personal" });
  });

  // Records written before targetOwnerType existed only have targetOwner. An org
  // there must not silently be treated as an org without evidence, but it also
  // must keep resolving to that owner so existing publishes stay put.
  test("legacy record without targetOwnerType keeps the owner and defaults to user", () => {
    const auth = { onboarding: { targetOwner: "gw2eww" } };
    expect(resolvePublishTarget(auth, VIEWER)).toEqual({ owner: "gw2eww", ownerType: "user", scope: "personal" });
  });

  // A stale "org" type left over from a previous selection must not make us POST
  // to /orgs/<viewer>/repos for the user's own account.
  test("target equal to the viewer is always ownerType user", () => {
    const auth = { onboarding: { targetOwner: VIEWER, targetOwnerType: "org" } };
    expect(resolvePublishTarget(auth, VIEWER)).toEqual({ owner: VIEWER, ownerType: "user", scope: "personal" });
  });

  test("an unrecognised targetOwnerType degrades to user", () => {
    const auth = { onboarding: { targetOwner: "gw2eww", targetOwnerType: "team" } };
    expect(resolvePublishTarget(auth, VIEWER)).toEqual({ owner: "gw2eww", ownerType: "user", scope: "personal" });
  });

  // ── The team target ────────────────────────────────────────────────────────
  //
  // The bug this exists for: a member publishing the team's comp put it on their
  // own account, because the only target there was belonged to the machine.

  describe("inside a team", () => {
    const PERSONAL = { onboarding: { targetOwner: "my-account", targetOwnerType: "user" } };

    test("the team's owner wins over the personal one", () => {
      const teamRoot = { teamId: "t1", publishOwner: "gw2eww", publishOwnerType: "org" };
      expect(resolvePublishTarget(PERSONAL, VIEWER, teamRoot)).toEqual({
        owner: "gw2eww", ownerType: "org", scope: "team",
      });
    });

    // Every team that existed before this feature. Nothing about their
    // publishing may change.
    test("a team with no target falls back to the personal one", () => {
      const teamRoot = { teamId: "t1" };
      expect(resolvePublishTarget(PERSONAL, VIEWER, teamRoot)).toEqual({
        owner: "my-account", ownerType: "user", scope: "personal",
      });
    });

    test("a team target without a type defaults to user, like the personal one", () => {
      const teamRoot = { teamId: "t1", publishOwner: "gw2eww" };
      expect(resolvePublishTarget(PERSONAL, VIEWER, teamRoot)).toEqual({
        owner: "gw2eww", ownerType: "user", scope: "team",
      });
    });

    // A team may legitimately point at a person's account — and if that person
    // is you, the repo has to be created via /user/repos.
    test("a team target equal to the viewer is ownerType user", () => {
      const teamRoot = { teamId: "t1", publishOwner: VIEWER, publishOwnerType: "org" };
      expect(resolvePublishTarget(PERSONAL, VIEWER, teamRoot)).toEqual({
        owner: VIEWER, ownerType: "user", scope: "team",
      });
    });

    // scope drives whether the publish writes back to the machine's own
    // onboarding record, so an empty string must not read as "team".
    test("an empty team target is not a team target", () => {
      const teamRoot = { teamId: "t1", publishOwner: "", publishOwnerType: "org" };
      expect(resolvePublishTarget(PERSONAL, VIEWER, teamRoot).scope).toBe("personal");
    });
  });
});
