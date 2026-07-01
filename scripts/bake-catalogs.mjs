// Generates static GW2 catalog JSON for the web playground by running the existing
// Node catalog builder (src/main/gw2Data), where the wiki client + disk cache work.
// Run at web build time; output is git-ignored and served as static assets.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Bake from the repo's committed snapshots, not the remote copies on `main`, so
// the web bundle is deterministic and reflects the branch being built. (Desktop
// gets runtime freshness via remote-first loading; the web bundle refreshes on
// its normal redeploy.)
process.env.AXIFORGE_DISABLE_REMOTE_DATA = "1";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const outDir = resolve(repoRoot, "src/web/public/catalogs");
const GAME_MODES = ["pve", "wvw", "pvp"];

const {
  getProfessionList,
  getProfessionCatalog,
  getUpgradeCatalog,
  initDiskCache,
  initWikiClient,
} = require(resolve(repoRoot, "src/main/gw2Data"));

async function main() {
  mkdirSync(outDir, { recursive: true });
  const cacheDir = mkdtempSync(join(tmpdir(), "axiforge-bake-"));
  await initDiskCache(cacheDir);
  initWikiClient(cacheDir);

  const professions = await getProfessionList("en");
  writeFileSync(join(outDir, "professions.json"), JSON.stringify(professions));
  console.log(`baked professions.json (${professions.length})`);

  const upgrades = await getUpgradeCatalog("en");
  writeFileSync(join(outDir, "upgrades.json"), JSON.stringify(upgrades));
  console.log("baked upgrades.json");

  for (const prof of professions) {
    for (const mode of GAME_MODES) {
      const cat = await getProfessionCatalog(prof.id, "en", mode);
      writeFileSync(join(outDir, `${prof.id}-${mode}.json`), JSON.stringify(cat));
      console.log(`baked ${prof.id}-${mode}.json`);
    }
  }
  console.log("bake-catalogs: done");
}

main().catch((err) => {
  console.error("bake-catalogs failed:", err);
  process.exit(1);
});
