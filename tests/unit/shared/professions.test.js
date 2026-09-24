import fs from "node:fs";
import path from "node:path";
import {
  PROFESSIONS,
  professionColour,
  professionSeriesStyle,
  professionStripStyle,
  slotSeriesStyle,
} from "../../../src/shared/professions.js";

const ROOT = path.resolve(__dirname, "../../..");

describe("professionColour", () => {
  it("returns the full-strength colour for each of the nine", () => {
    expect(PROFESSIONS).toHaveLength(9);
    for (const p of PROFESSIONS) {
      expect(professionColour(p)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    // Builds imported from gw2skills have arrived as "Elementalist " and as
    // "elementalist". Six divergent copies each normalised differently; this
    // is the one place that decides.
    const want = professionColour("Elementalist");
    for (const v of ["elementalist", "ELEMENTALIST", "  Elementalist  ", "eleMentalist"]) {
      expect(professionColour(v)).toBe(want);
    }
  });

  it("never returns undefined for a missing or unknown profession", () => {
    for (const v of [null, undefined, "", "   ", "Bard", 0, {}]) {
      expect(typeof professionColour(v)).toBe("string");
      expect(professionColour(v)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("the style-attribute helpers", () => {
  it("emit a declaration for a known profession", () => {
    expect(professionSeriesStyle("Ranger")).toBe(`--axi-series: ${professionColour("Ranger")}`);
    expect(professionStripStyle("Ranger")).toBe(`--axi-card-strip: ${professionColour("Ranger")}`);
  });

  it("emit nothing for an unknown profession, so it inherits the accent", () => {
    // The failure this pins: `--axi-card-strip: undefined` in a style
    // attribute, which some engines render as the initial value and others
    // drop, so an unknown build's strip was inconsistent across builds.
    for (const v of [null, undefined, "", "Bard"]) {
      expect(professionSeriesStyle(v)).toBe("");
      expect(professionStripStyle(v)).toBe("");
    }
  });

  it("never emits the string 'undefined'", () => {
    for (const v of [null, undefined, "Bard"]) {
      expect(professionSeriesStyle(v)).not.toContain("undefined");
      expect(professionStripStyle(v)).not.toContain("undefined");
    }
  });
});

describe("slotSeriesStyle", () => {
  it("lets a role marker win over the profession", () => {
    expect(slotSeriesStyle("red", "Ranger")).toBe("--axi-series: #d63a3a");
    expect(slotSeriesStyle("blue", "Ranger")).toBe("--axi-series: #3a8fd6");
  });

  it("falls through to the profession for an unknown role", () => {
    for (const role of ["normal", null, undefined, "", "green"]) {
      expect(slotSeriesStyle(role, "Ranger")).toBe(professionSeriesStyle("Ranger"));
    }
  });
});

describe("the palette has one home", () => {
  it("appears in no renderer file but professions.js", () => {
    // Global Constraint 6. Six copies is how the palette drifted; this is the
    // test that keeps it from happening again.
    const colours = PROFESSIONS.map((p) => professionColour(p));
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!/\.(js|css)$/.test(e.name)) continue;
        const rel = path.relative(ROOT, full);
        if (rel === path.join("src", "shared", "professions.js")) continue;
        // src/site and packages/forge-render convert in batch 5.
        if (rel.startsWith(path.join("src", "site"))) continue;
        if (rel.startsWith("packages")) continue;
        const text = fs.readFileSync(full, "utf8").toLowerCase();
        for (const c of colours) if (text.includes(c)) offenders.push(`${rel}: ${c}`);
      }
    };
    walk(path.join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});
