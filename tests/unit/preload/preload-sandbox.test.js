/**
 * The preload runs sandboxed, and a sandboxed preload is not a Node module.
 *
 * Electron has sandboxed renderers by default since v20. In that mode the
 * preload gets a stub `require` that resolves `electron` and a short list of
 * builtins and nothing else — a relative path throws "module not found" before
 * a single line of the bridge runs. The failure is near-silent: the preload
 * dies, `window.desktopApi` is never defined, `init()` throws on its first call
 * through it, and the app sits on the static first-paint skeleton from
 * index.html forever. It looks like a hang, not a crash, which is why
 * `require("../shared/windowChrome")` survived code review, a green unit suite
 * and CI — nothing in the dev loop boots Electron.
 *
 * So assert the one property that actually matters and that no other test
 * covers: the preload reaches for nothing it cannot have at runtime. Anything
 * main and preload must agree on travels as data (see additionalArguments in
 * createWindow), not as a shared require.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PRELOAD = path.join(__dirname, "../../../src/preload/index.js");

// Electron's sandboxed preload loader resolves these and nothing else.
// @see https://www.electronjs.org/docs/latest/tutorial/sandbox
const SANDBOX_SAFE = new Set(["electron", "events", "timers", "url"]);

function requiredModules(source) {
  return [...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
}

describe("the sandboxed preload", () => {
  const source = fs.readFileSync(PRELOAD, "utf8");

  it("requires only modules a sandboxed preload can resolve", () => {
    const unsafe = requiredModules(source).filter((id) => !SANDBOX_SAFE.has(id));
    expect(unsafe).toEqual([]);
  });

  it("in particular reaches for no file of our own", () => {
    const relative = requiredModules(source).filter((id) => id.startsWith("."));
    expect(relative).toEqual([]);
  });
});
