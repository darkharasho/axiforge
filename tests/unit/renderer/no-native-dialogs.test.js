/**
 * Repo hygiene: no window.prompt() in the renderer.
 *
 * Chromium in Electron does not implement prompt(). It returns null and logs
 * "prompt() is and will not be supported" — so the calling feature silently does
 * nothing, with no error and no clue. That is exactly how right-click → Rename
 * on the Comps page shipped broken: one call site never got the memo that the
 * rest of the app had already moved to prompt-modal.js.
 *
 * A grep is enough to stop it coming back, and it costs nothing to run.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RENDERER = path.join(__dirname, "../../../src/renderer");

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// `showPrompt(`, `_prompt(`, `.prompt(` and the like are fine — only a bare
// call to the global is the problem.
const BARE_PROMPT = /(?<![\w.$])prompt\s*\(/;

test("no renderer file calls window.prompt()", () => {
  const offenders = [];
  for (const file of jsFiles(RENDERER)) {
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (BARE_PROMPT.test(code) || /window\.prompt\s*\(/.test(code)) {
        offenders.push(`${path.relative(RENDERER, file)}:${i + 1}  ${line.trim()}`);
      }
    });
  }

  expect(offenders).toEqual([]);
});
