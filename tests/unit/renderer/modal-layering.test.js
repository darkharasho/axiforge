/**
 * A confirmation has to sit above whatever asked for it.
 *
 * Every second-tier dialog in the app — team, share, smart folder, import
 * conflict, what's new — was given `--z-modal-confirm`, the same layer as the
 * confirmation dialog itself. At equal z-index the winner is DOM order, and
 * `initConfirmModal()` runs at renderer startup while the others mount lazily
 * on first open. So the confirmation reliably lost to any dialog that raised
 * it: it opened BEHIND that dialog's own backdrop.
 *
 * That is how issue #317 happened. "Remove this person?" rendered behind the
 * Manage Team overlay; the click aimed at its Remove button hit the backdrop,
 * which closed Manage Team and dropped the team id, and the removal then went
 * out as `DELETE /teams/null/members/<id>` — a 403, nothing deleted, the
 * permission still there on reopen.
 *
 * `form-modal.js` dialogs were only ever safe by accident: they build and
 * append their overlay per call, so they land last in the document. Layering
 * this important should not depend on who mounted first, so confirmations get
 * a layer of their own.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STYLES = path.join(__dirname, "../../../src/renderer/styles");

/** The z-index tokens, resolved to numbers, from the one place they are set. */
function tokens() {
  const css = fs.readFileSync(path.join(STYLES, "app.css"), "utf8");
  const out = {};
  for (const [, name, value] of css.matchAll(/(--z-[\w-]+)\s*:\s*(\d+)\s*;/g)) {
    out[name] = Number(value);
  }
  return out;
}

/** Which z-index token each stylesheet's overlay rule uses. */
function layerOf(file) {
  const css = fs.readFileSync(path.join(STYLES, file), "utf8");
  const m = css.match(/z-index:\s*var\((--z-[\w-]+)\)/);
  return m && m[1];
}

const OTHER_MODALS = [
  "team-modal.css",
  "share-modal.css",
  "smart-folder-modal.css",
  "import-conflict-modal.css",
  "whats-new-modal.css",
  "settings-modal.css",
  "detail-modal.css",
  "wiki-modal.css",
];

test("the confirmation layer is above every dialog that can raise one", () => {
  const z = tokens();
  const confirm = z[layerOf("confirm-modal.css")];
  expect(typeof confirm).toBe("number");

  for (const file of OTHER_MODALS) {
    const layer = layerOf(file);
    expect({ file, layer: z[layer] }).toEqual({ file, layer: expect.any(Number) });
    // Strictly above: equal means DOM order decides, which is the bug.
    expect(z[layer]).toBeLessThan(confirm);
  }
});

// The resize grips are part of the window, not the page, and have to stay
// grabbable while any dialog is open. @see --z-resize-grip in app.css
test("the confirmation layer stays below the window's resize grips", () => {
  const z = tokens();
  expect(z[layerOf("confirm-modal.css")]).toBeLessThan(z["--z-resize-grip"]);
});
