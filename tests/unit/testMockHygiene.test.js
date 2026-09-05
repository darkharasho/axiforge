"use strict";
// A repo-hygiene guard for one specific, very expensive mistake.
//
// `jest.mock(name, factory, { virtual: true })` gives the mock a module id
// derived from the *requiring file's directory* rather than the real resolved
// path. Jest caches module ids on a Resolver that is shared by every test file
// in a worker process, so once a virtual electron mock has been registered, the
// cached id for some `(module, "electron")` pair points at the virtual path. The
// NEXT test file in that worker registers its own, ordinary `jest.mock("electron")`
// against the real id -- and `require("electron")` from inside `src/` misses it
// and gets the real module back.
//
// That is what made tests/unit/buildStoreAuth.test.js fail roughly one full-suite
// run in six: `usableSafeStorage()` saw the real electron (a path string), returned
// null, and every credential was written in plaintext. Nothing in the failure
// pointed at the file that actually caused it.
//
// `virtual: true` is only for modules that genuinely are not installed. Everything
// this repo mocks is a real dependency, so nothing here needs it.

const fs = require("node:fs");
const path = require("node:path");

const TESTS_DIR = path.join(__dirname, "..");

function testFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    return entry.isFile() && entry.name.endsWith(".test.js") ? [full] : [];
  });
}

test("no test mocks an installed module with { virtual: true }", () => {
  const offenders = [];
  for (const file of testFiles(TESTS_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/jest\.mock\(\s*["']([^"']+)["'][\s\S]{0,400}?virtual:\s*true/g)) {
      const moduleName = match[1];
      // Only a module that really is absent justifies it.
      let installed = true;
      try { require.resolve(moduleName); } catch { installed = false; }
      if (installed) offenders.push(`${path.relative(TESTS_DIR, file)} -> ${moduleName}`);
    }
  }
  expect(offenders).toEqual([]);
});
