"use strict";

const { resolvePublishTarget } = require("../../src/main/publishTarget");

const VIEWER = "octocat";

describe("resolvePublishTarget", () => {
  test("falls back to the signed-in user when nothing is configured", () => {
    expect(resolvePublishTarget(null, VIEWER)).toEqual({ owner: VIEWER, ownerType: "user" });
    expect(resolvePublishTarget({}, VIEWER)).toEqual({ owner: VIEWER, ownerType: "user" });
    expect(resolvePublishTarget({ onboarding: {} }, VIEWER)).toEqual({
      owner: VIEWER,
      ownerType: "user",
    });
  });

  test("returns the configured org with ownerType org", () => {
    const auth = { onboarding: { targetOwner: "gw2eww", targetOwnerType: "org" } };
    expect(resolvePublishTarget(auth, VIEWER)).toEqual({ owner: "gw2eww", ownerType: "org" });
  });

  // Records written before targetOwnerType existed only have targetOwner. An org
  // there must not silently be treated as an org without evidence, but it also
  // must keep resolving to that owner so existing publishes stay put.
  test("legacy record without targetOwnerType keeps the owner and defaults to user", () => {
    const auth = { onboarding: { targetOwner: "gw2eww" } };
    expect(resolvePublishTarget(auth, VIEWER)).toEqual({ owner: "gw2eww", ownerType: "user" });
  });

  // A stale "org" type left over from a previous selection must not make us POST
  // to /orgs/<viewer>/repos for the user's own account.
  test("target equal to the viewer is always ownerType user", () => {
    const auth = { onboarding: { targetOwner: VIEWER, targetOwnerType: "org" } };
    expect(resolvePublishTarget(auth, VIEWER)).toEqual({ owner: VIEWER, ownerType: "user" });
  });

  test("an unrecognised targetOwnerType degrades to user", () => {
    const auth = { onboarding: { targetOwner: "gw2eww", targetOwnerType: "team" } };
    expect(resolvePublishTarget(auth, VIEWER)).toEqual({ owner: "gw2eww", ownerType: "user" });
  });
});
