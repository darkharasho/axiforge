const path = require("path");
const fs = require("fs");
const { DATA_DIR } = require("./app");

function seedBuildFile(build) {
  const filePath = path.join(DATA_DIR, "builds.json");
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : [];
  existing.push(build);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

function seedCompFile(comp) {
  const filePath = path.join(DATA_DIR, "comps.json");
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : [];
  existing.push(comp);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

function seedFolderFile(folder) {
  const filePath = path.join(DATA_DIR, "folders.json");
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : [];
  existing.push(folder);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

function seedSettingsFile(settings) {
  const filePath = path.join(DATA_DIR, "settings.json");
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
}

function clearData() {
  for (const file of ["builds.json", "comps.json", "folders.json", "settings.json"]) {
    const filePath = path.join(DATA_DIR, file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

async function seedBuildIPC(window, build) {
  return window.evaluate((b) => desktopApi.saveBuild(b), build);
}

async function seedCompIPC(window, comp) {
  return window.evaluate((c) => desktopApi.saveComp(c), comp);
}

async function seedFolderIPC(window, folder) {
  return window.evaluate((f) => desktopApi.saveFolder(f), folder);
}

module.exports = { seedBuildFile, seedCompFile, seedFolderFile, seedSettingsFile, clearData, seedBuildIPC, seedCompIPC, seedFolderIPC };
