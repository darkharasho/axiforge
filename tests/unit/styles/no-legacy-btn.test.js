"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

/** Every renderer file that could carry a class attribute, assignment or
    classList call. */
function sources(dir, acc = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sources(rel, acc);
    else if (/\.(js|html)$/.test(entry.name)) acc.push(rel);
  }
  return acc;
}

// A class attribute containing btn / btn-primary / btn-secondary / btn-danger
// / btn-dev as a whole word. .axi-btn and af-btn-ish names must not match.
const LEGACY_TOKEN = /^btn(-primary|-secondary|-danger|-dev)?$/;

function offendingTokens(classString) {
  return classString.split(/\s+/).filter((c) => LEGACY_TOKEN.test(c));
}

describe("legacy button classes", () => {
  const files = sources("src/renderer").filter((f) => !f.endsWith("index.generated.html"));

  it("are gone from every renderer source", () => {
    const offenders = [];
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");

      // class="..." attributes (HTML and template-literal markup).
      for (const m of src.matchAll(/class\s*=\s*["'`]([^"'`]*)["'`]/g)) {
        if (offendingTokens(m[1]).length) offenders.push(`${file}: class="${m[1]}"`);
      }

      // btn.className = "..." assignments (built-in-JS buttons, not caught
      // by a class= scan — e.g. render-pages.js's dev preview buttons).
      for (const m of src.matchAll(/className\s*=\s*["'`]([^"'`]*)["'`]/g)) {
        if (offendingTokens(m[1]).length) offenders.push(`${file}: className = "${m[1]}"`);
      }

      // classList.add(...) / classList.toggle(...) arguments.
      for (const m of src.matchAll(/classList\.(?:add|toggle)\(([^)]*)\)/g)) {
        for (const am of m[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
          if (offendingTokens(am[1]).length) {
            offenders.push(`${file}: classList.add/toggle(${m[1].trim()})`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // A computed class-name template (`btn btn-${variant}`) is invisible to
  // every scan above, since none of them evaluate template literals. This
  // pins the specific shape that once hid utils.js's makeButton() from the
  // worklist, so it cannot come back even if a future refactor reintroduces
  // string interpolation instead of the explicit variant lookup.
  it("makeButton never reassembles a legacy class name from a template", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/renderer/modules/utils.js"), "utf8");
    expect(src).not.toMatch(/`btn btn-\$\{/);
    expect(src).not.toMatch(/className\s*=\s*`btn/);
  });

  it("are gone from the stylesheets", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/renderer/styles/cards.css"), "utf8");
    expect(css).not.toMatch(/^\.btn(-[a-z]+)?\s*[,{:]/m);
    const buttons = fs.readFileSync(path.join(ROOT, "src/renderer/styles/buttons.css"), "utf8");
    expect(buttons).not.toMatch(/^\.btn(-[a-z]+)?\s*[,{:]/m);
  });
});
