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
    t.setUserAccent("violet-purple");
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
