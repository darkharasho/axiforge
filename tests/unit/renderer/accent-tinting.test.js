"use strict";

// renderer.js is a large module with Electron-dependent side effects at
// import time, so the stash/restore logic lives in its own module
// (accent-tinting.js) and is tested here directly, with fakes injected for
// applyAccent/getProfession/isEnabled. This test's job is to pin the state
// machine described in the plan: the stash - not a string prefix on the DOM
// attribute - is what records that a profession tint is showing.
const { createAccentTinting } = require("../../../src/renderer/modules/accent-tinting.js");
const { DEFAULT_ACCENT_ID } = require("../../../src/renderer/modules/accents.js");

function makeTinting({ themedBuildsEnabled }) {
  let shown = DEFAULT_ACCENT_ID; // what data-axi-accent currently holds
  let profession;

  const tinting = createAccentTinting({
    applyAccent: (id) => { shown = id; return id; },
    getProfession: () => profession,
    isEnabled: () => themedBuildsEnabled,
  });

  return {
    get shown() { return shown; },
    get tinting() { return tinting.isTinting; },
    setUserAccent(id) { tinting.setUserAccent(id); },
    openBuild(prof) {
      profession = prof;
      tinting.applyProfessionAccentIfEnabled();
    },
    leaveBuild() {
      tinting.restoreUserAccentIfNeeded();
    },
  };
}

describe("profession tinting", () => {
  it("tints to the build's profession and restores the user's accent", () => {
    const t = makeTinting({ themedBuildsEnabled: true });
    t.setUserAccent("violet-purple");
    expect(t.shown).toBe("violet-purple");

    t.openBuild("Guardian");
    expect(t.shown).toBe("electric-blue");
    expect(t.tinting).toBe(true);

    t.leaveBuild();
    expect(t.shown).toBe("violet-purple");
    expect(t.tinting).toBe(false);
  });

  // Review Focus 4: the prof- prefix used to mark "a tint is showing". A
  // profession accent is now an ordinary id, so a user who picks the same
  // colour as the build's profession must still get it back.
  it("restores the user's accent even when it equals the profession's", () => {
    const t = makeTinting({ themedBuildsEnabled: true });
    t.setUserAccent("electric-blue");
    t.openBuild("Guardian");
    expect(t.shown).toBe("electric-blue");
    t.leaveBuild();
    expect(t.shown).toBe("electric-blue");
    expect(t.tinting).toBe(false);
  });

  it("changing the accent behind a tint changes what is restored, not what shows", () => {
    const t = makeTinting({ themedBuildsEnabled: true });
    // Mesmer's own accent is violet-purple (see PROFESSION_ACCENTS), so the
    // user's own pick here is deliberately a different colour - otherwise
    // the idempotency guard below would treat the tint as a no-op, since
    // the "tint" would already be identical to what's showing.
    t.setUserAccent("rose-pink");
    t.openBuild("Mesmer");
    t.setUserAccent("teal-ocean");
    expect(t.shown).toBe("violet-purple"); // the Mesmer tint, still showing
    t.leaveBuild();
    expect(t.shown).toBe("teal-ocean");
  });

  it("does nothing when themed builds are off", () => {
    const t = makeTinting({ themedBuildsEnabled: false });
    t.setUserAccent("rose-pink");
    t.openBuild("Guardian");
    expect(t.shown).toBe("rose-pink");
    expect(t.tinting).toBe(false);
  });

  it("leaves a build with no profession alone", () => {
    const t = makeTinting({ themedBuildsEnabled: true });
    t.setUserAccent("rose-pink");
    t.openBuild(undefined);
    expect(t.shown).toBe("rose-pink");
    expect(t.tinting).toBe(false);
  });
});

// Fix round 1: applyProfessionAccentIfEnabled used to re-apply an
// already-showing tint on every call (setProfession / navigateToPage can
// call it repeatedly for the same profession), re-arming applyAccent's
// crossfade timer each time. Tracked in the module against what applyAccent
// last set, not read from the DOM.
describe("applyProfessionAccentIfEnabled idempotency", () => {
  it("does not re-apply an already-showing profession tint, but does apply on a profession change", () => {
    const applyAccent = jest.fn((id) => id);
    let profession = "Guardian";
    const tinting = createAccentTinting({
      applyAccent,
      getProfession: () => profession,
      isEnabled: () => true,
    });

    tinting.applyProfessionAccentIfEnabled();
    tinting.applyProfessionAccentIfEnabled();
    tinting.applyProfessionAccentIfEnabled();
    expect(applyAccent).toHaveBeenCalledTimes(1);

    profession = "Warrior";
    tinting.applyProfessionAccentIfEnabled();
    expect(applyAccent).toHaveBeenCalledTimes(2);
  });
});

// Fix round 2: the round-1 idempotency guard short-circuited ahead of the
// stash, so when the user's own accent already equals the profession's, no
// tint got recorded at all - a later accent change while that build was
// open applied immediately instead of stashing, and leaving never restored
// it. The stash now happens before the idempotency check.
describe("applyProfessionAccentIfEnabled stashes even when the tint is a no-op", () => {
  it("records the tint (and restores through it) when the user's accent equals the profession's, even after a mid-tint change", () => {
    const applyAccent = jest.fn((id) => id);
    let profession;
    const tinting = createAccentTinting({
      applyAccent,
      getProfession: () => profession,
      isEnabled: () => true,
    });

    tinting.setUserAccent("electric-blue");
    expect(tinting.isTinting).toBe(false);

    profession = "Guardian"; // PROFESSION_ACCENTS.Guardian === "electric-blue"
    tinting.applyProfessionAccentIfEnabled();
    expect(tinting.isTinting).toBe(true);

    // Changing the accent while this no-op tint is "showing" must stash,
    // not apply immediately - the screen should still be electric-blue.
    tinting.setUserAccent("teal-ocean");
    expect(applyAccent).not.toHaveBeenCalledWith("teal-ocean");
    expect(tinting.isTinting).toBe(true);

    tinting.restoreUserAccentIfNeeded();
    expect(applyAccent).toHaveBeenCalledWith("teal-ocean");
    expect(tinting.isTinting).toBe(false);
  });

  it("isTinting is true immediately after applying a profession accent that matches the current user accent", () => {
    const applyAccent = jest.fn((id) => id);
    const tinting = createAccentTinting({
      applyAccent,
      getProfession: () => "Guardian",
      isEnabled: () => true,
    });

    tinting.setUserAccent("electric-blue");
    tinting.applyProfessionAccentIfEnabled();
    expect(tinting.isTinting).toBe(true);
  });
});

// Fix round 1: startup passes { transition: false } so the saved accent
// doesn't crossfade against an unthemed first paint. Every other call site
// keeps the default (transition: true).
describe("setUserAccent transition option", () => {
  it("forwards transition: false to applyAccent", () => {
    const applyAccent = jest.fn((id) => id);
    const tinting = createAccentTinting({
      applyAccent,
      getProfession: () => undefined,
      isEnabled: () => false,
    });

    tinting.setUserAccent("rose-pink", { transition: false });
    expect(applyAccent).toHaveBeenCalledWith("rose-pink", { transition: false });
  });

  it("forwards the default transition when omitted", () => {
    const applyAccent = jest.fn((id) => id);
    const tinting = createAccentTinting({
      applyAccent,
      getProfession: () => undefined,
      isEnabled: () => false,
    });

    tinting.setUserAccent("rose-pink");
    expect(applyAccent).toHaveBeenCalledWith("rose-pink", { transition: true });
  });
});
