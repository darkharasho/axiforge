/**
 * Capture marketing screenshots from the running AxiForge Electron app.
 *
 * Strategy:
 *   - Uses APP_PROFILE=e2e-test so it lives in an isolated config dir
 *   - Pre-seeds builds.json / folders.json / comps.json / settings.json so the
 *     library is populated and the What's New modal does not auto-open
 *   - Drives navigation via the existing e2e helpers
 *   - Loads built renderer from dist/renderer (no Vite needed)
 *
 * Prereqs:  npm run build:renderer
 * Run:      node scripts/take-marketing-screenshots.js
 */

const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const mockServer = require("../tests/e2e/mock-server/server");
const { selectProfession, addSpecialization, selectTrait } = require("../tests/e2e/helpers/editor");
const { goToEditor, goToLibrary, goToComps } = require("../tests/e2e/helpers/nav");
const mock = require("./marketing-mock-data");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "marketing", "assets", "screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const APP_NAME = "axiforge-desktop";
const DATA_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  `${APP_NAME}-e2e-test`,
  "data"
);
const VIEWPORT = { width: 1440, height: 900 };

function seedDataDir() {
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const writeJson = (name, data) =>
    fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2));
  writeJson("settings.json", mock.SETTINGS);
  writeJson("builds.json", mock.BUILDS);
  writeJson("folders.json", mock.FOLDERS);
  writeJson("comps.json", mock.COMPS);
  writeJson("auth.json", {});
  console.log(`Seeded ${DATA_DIR}`);
}

async function launchApp() {
  seedDataDir();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({
    args: ["."],
    env: {
      ...env,
      APP_PROFILE: "e2e-test",
      GW2_API_ROOT: `http://localhost:${mockServer.PORT}/v2`,
    },
  });
  const window = await app.firstWindow();
  window.on("pageerror", (err) => console.log("[renderer error]", err.message));
  await window.waitForLoadState("domcontentloaded");
  await window.waitForTimeout(2500);
  // Hide the What's New overlay immediately so it never tints screenshots.
  await window.evaluate(() => {
    document.querySelectorAll(".whats-new-modal-overlay").forEach((el) => {
      el.classList.add("whats-new-modal-overlay--hidden");
      el.style.display = "none";
    });
  });
  return { app, window };
}

async function setTheme(window, themeId) {
  await window.evaluate((id) => {
    if (id) document.documentElement.setAttribute("data-theme", id);
    else document.documentElement.removeAttribute("data-theme");
  }, themeId);
  await window.waitForTimeout(300);
}

async function closeAnyModal(window) {
  await window.evaluate(() => {
    // What's New modal lives at .whats-new-modal-overlay and is shown by removing
    // .whats-new-modal-overlay--hidden. Re-add the hide class.
    document.querySelectorAll(".whats-new-modal-overlay").forEach((el) => {
      el.classList.add("whats-new-modal-overlay--hidden");
      el.style.display = "none";
    });
    // Hide any generic modal/backdrop too.
    document.querySelectorAll(".modal, .modal-backdrop, .overlay, [data-modal]")
      .forEach((el) => { el.style.display = "none"; });
  });
}

async function shot(window, name) {
  await closeAnyModal(window);
  const file = path.join(OUT_DIR, `${name}.png`);
  await window.screenshot({ path: file });
  console.log(`  → ${path.relative(ROOT, file)}`);
}

async function run() {
  console.log("Starting mock GW2 API server…");
  await mockServer.start();

  console.log("Launching AxiForge…");
  const { app, window } = await launchApp();
  await window.setViewportSize(VIEWPORT);
  await window.waitForTimeout(500);

  // Drive the editor on each iteration. Pattern: switch theme → go to editor →
  // pick profession (waiting for spec cards to render) → screenshot.
  async function editorShot(name, theme, profession) {
    await setTheme(window, theme);
    await goToEditor(window);
    await window.waitForTimeout(300);
    await selectProfession(window, profession);
    await window.waitForTimeout(800);
    await shot(window, name);
  }

  try {
    await editorShot("editor-guardian-molten", "molten-core", "Guardian");
    await editorShot("editor-necromancer-cinderfall", "cinderfall", "Necromancer");
    await editorShot("editor-elementalist-verdant", "verdant-crucible", "Elementalist");
    await editorShot("editor-engineer-frostforge", "frostforge", "Engineer");

    console.log("Editor — Warrior with traits picked…");
    await setTheme(window, "molten-core");
    await goToEditor(window);
    await selectProfession(window, "Warrior");
    await window.waitForTimeout(500);
    try {
      await addSpecialization(window, "Strength");
      await selectTrait(window, 0, 1, 0).catch(() => {});
      await selectTrait(window, 0, 2, 1).catch(() => {});
      await selectTrait(window, 0, 3, 2).catch(() => {});
      await window.waitForTimeout(400);
    } catch (e) {
      console.warn("  (skipped trait pick:", e.message, ")");
    }
    await shot(window, "editor-warrior-traits");

    console.log("Library (Molten Core)…");
    await setTheme(window, "molten-core");
    await goToLibrary(window);
    // Click a folder in the sidebar so build cards render.
    await window.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".sidebar-folder, .folder-item, [data-folder-id]"));
      const target = items.find((el) => /raid/i.test(el.textContent || ""));
      if (target) target.click();
    });
    await window.waitForTimeout(800);
    await shot(window, "library-molten");

    console.log("Comps page…");
    await goToComps(window);
    await window.waitForTimeout(700);
    await shot(window, "comps");
  } catch (err) {
    console.error("Screenshot capture failed:", err);
    process.exitCode = 1;
  } finally {
    await app.close();
    await mockServer.stop();
  }
  console.log("Done.");
}

run();
