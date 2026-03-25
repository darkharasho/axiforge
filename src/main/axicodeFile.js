const { ipcMain, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { encodeAxicodeFile, decodeAxicodeFile } = require("@mks.haro/axicode");

function registerAxicodeFileHandlers(mainWindow) {
  ipcMain.handle("axicode-file:export", async (_e, { builds, folders, comps }) => {
    const defaultName = `axiforge-export-${new Date().toISOString().slice(0, 10)}.axicode`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Export .axicode File",
      defaultPath: defaultName,
      filters: [{ name: "AxiCode Files", extensions: ["axicode"] }],
    });
    if (canceled || !filePath) return { cancelled: true };

    const buffer = encodeAxicodeFile({ builds, folders, comps });
    await fs.writeFile(filePath, buffer);
    return { success: true, filePath };
  });

  ipcMain.handle("axicode-file:import", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Import .axicode File",
      filters: [{ name: "AxiCode Files", extensions: ["axicode"] }],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0) return { cancelled: true };

    const buffer = await fs.readFile(filePaths[0]);
    try {
      const data = decodeAxicodeFile(buffer);
      return { success: true, data };
    } catch (err) {
      return { error: err.message };
    }
  });
}

module.exports = { registerAxicodeFileHandlers };
