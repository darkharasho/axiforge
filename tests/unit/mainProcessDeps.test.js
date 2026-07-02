/**
 * Guards against a class of packaging bug (issue #288):
 *
 * The renderer is bundled by Vite, so any `@axiapps/*` workspace package it
 * imports gets inlined at build time. The Electron MAIN process, however,
 * resolves `require()` at runtime against the packaged asar's node_modules.
 * electron-builder only copies workspace packages that are declared as
 * production `dependencies` in package.json — anything required by main but
 * left undeclared is silently dropped from the build and throws
 * "Cannot find module '@axiapps/...'" only in the packaged app.
 *
 * This test scans src/main for runtime `require("@axiapps/...")` calls and
 * asserts every referenced package is declared in dependencies, so the next
 * main-process require of a workspace package can't ship broken.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MAIN_DIR = path.join(REPO_ROOT, "src", "main");

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// Match require("@axiapps/<pkg>") and require("@axiapps/<pkg>/<subpath>"),
// capturing just the bare package name "@axiapps/<pkg>".
const REQUIRE_RE = /require\(\s*["'](@axiapps\/[^"'/]+)(?:\/[^"']*)?["']\s*\)/g;

describe("main-process @axiapps requires are declared dependencies", () => {
  const pkg = require(path.join(REPO_ROOT, "package.json"));
  const declared = new Set(Object.keys(pkg.dependencies || {}));

  const required = new Set();
  for (const file of collectJsFiles(MAIN_DIR)) {
    const src = fs.readFileSync(file, "utf8");
    let m;
    while ((m = REQUIRE_RE.exec(src)) !== null) required.add(m[1]);
  }

  it("finds at least one @axiapps require in src/main (sanity)", () => {
    expect(required.size).toBeGreaterThan(0);
  });

  it.each([...required])(
    "%s is listed in package.json dependencies",
    (name) => {
      expect(declared.has(name)).toBe(true);
    }
  );
});
