const fs = require("node:fs");
const path = require("node:path");

const catalogsDir = path.resolve(__dirname, "../../src/web/public/catalogs");
const EXPECTED_PROFESSIONS = 9;

const describeIfBaked = fs.existsSync(catalogsDir) ? describe : describe.skip;

describeIfBaked("baked catalogs", () => {
  test("professions.json lists all professions", () => {
    const profs = JSON.parse(fs.readFileSync(path.join(catalogsDir, "professions.json"), "utf8"));
    expect(Array.isArray(profs)).toBe(true);
    expect(profs.length).toBe(EXPECTED_PROFESSIONS);
    for (const p of profs) expect(typeof p.id).toBe("string");
  });

  test("every profession has a pve catalog that parses", () => {
    const profs = JSON.parse(fs.readFileSync(path.join(catalogsDir, "professions.json"), "utf8"));
    for (const p of profs) {
      const file = path.join(catalogsDir, `${p.id}-pve.json`);
      expect(fs.existsSync(file)).toBe(true);
      expect(() => JSON.parse(fs.readFileSync(file, "utf8"))).not.toThrow();
    }
  });
});
