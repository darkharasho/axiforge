"use strict";

// The editor's dirty check (computeEditorSignature) is the gate in front of
// every save: if it does not see a field change, no save fires and the edit is
// silently lost — it never reaches the store, so history never records it.
// history/diffBuild.js is the authority on which fields are versioned changes.
// Any field it diffs but the signature omits is exactly that silent-loss bug,
// which is how `selectedLegends`, `selectedPets`, `morphSkillIds` and `images`
// went unsaved while `selectedUnderwaterLegends` worked.

const fs = require("fs");
const path = require("path");

function readSrc(rel) {
  return fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
}

// Pull the keys of the `const payload = { ... }` literal inside
// computeEditorSignature, split by nesting level so the equipment sub-object
// can be checked separately.
function signatureKeys() {
  const src = readSrc("src/renderer/modules/editor.js");
  const fn = src.slice(src.indexOf("export function computeEditorSignature("));
  const start = fn.indexOf("const payload = {");
  const body = fn.slice(start + "const payload = {".length);

  let depth = 0;
  const top = new Set();
  const equipment = new Set();
  let inEquipment = false;
  let equipmentDepth = -1;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (depth === 0 && line.startsWith("};")) break;

    const keyMatch = /^([A-Za-z_$][\w$]*)\s*:/.exec(line);
    if (keyMatch) {
      if (depth === 0) {
        top.add(keyMatch[1]);
        if (keyMatch[1] === "equipment") { inEquipment = true; equipmentDepth = depth; }
      } else if (inEquipment && depth === equipmentDepth + 1) {
        equipment.add(keyMatch[1]);
      }
    }

    for (const ch of rawLine) {
      if (ch === "{" || ch === "[" || ch === "(") depth += 1;
      else if (ch === "}" || ch === "]" || ch === ")") {
        depth -= 1;
        if (inEquipment && depth === equipmentDepth) inEquipment = false;
      }
    }
  }
  return { top, equipment };
}

function differPaths(constName) {
  const src = readSrc("src/main/history/diffBuild.js");
  const m = new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\];`).exec(src);
  if (!m) throw new Error(`${constName} not found in diffBuild.js`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("editor dirty-check covers every field history versions", () => {
  const { top, equipment } = signatureKeys();

  test("the signature payload parsed at all", () => {
    // Guards the parser above: if editor.js is restructured so the literal no
    // longer parses, the coverage assertions below would vacuously pass.
    expect(top.size).toBeGreaterThan(5);
    expect(equipment.size).toBeGreaterThan(5);
    expect(top.has("equipment")).toBe(true);
  });

  test.each(differPaths("FIELD_PATHS"))(
    "top-level field %s is in computeEditorSignature",
    (field) => {
      expect(top.has(field)).toBe(true);
    }
  );

  test.each(differPaths("CONSUMABLE_PATHS"))(
    "equipment consumable %s is in computeEditorSignature",
    (field) => {
      expect(equipment.has(field)).toBe(true);
    }
  );
});
