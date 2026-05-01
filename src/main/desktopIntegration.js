const fs = require("fs");
const path = require("path");
const os = require("os");

// Refresh ~/.local/share/applications/axiforge.desktop so Exec/TryExec point at
// the currently running AppImage. Without this, the entry created by the
// AppImage's first-run integration prompt keeps the original versioned filename
// baked in, and breaks after electron-updater swaps to a new versioned file.
function refreshLinuxDesktopEntry() {
  if (process.platform !== "linux") return;
  const appImage = process.env.APPIMAGE;
  if (!appImage || !fs.existsSync(appImage)) return;

  const home = os.homedir();
  const appsDir = path.join(home, ".local", "share", "applications");
  const desktopPath = path.join(appsDir, "axiforge.desktop");

  let iconLine = "Icon=axiforge";
  const legacyIcon = path.join(home, "AppImages", ".icons", "axiforge");
  if (fs.existsSync(legacyIcon)) iconLine = `Icon=${legacyIcon}`;
  if (fs.existsSync(desktopPath)) {
    const existing = fs.readFileSync(desktopPath, "utf8");
    const m = existing.match(/^Icon=(.+)$/m);
    if (m && fs.existsSync(m[1])) iconLine = `Icon=${m[1]}`;
  }

  const contents =
    `[Desktop Entry]
Type=Application
Name=AxiForge
Comment=GW2 build editor desktop app with GitHub Pages publishing
${iconLine}
TryExec=${appImage}
Exec=env DESKTOPINTEGRATION=1 ${appImage} --no-sandbox %U
Terminal=false
Categories=Utility;
StartupWMClass=AxiForge
X-AppImage-Name=AxiForge
`;

  try {
    fs.mkdirSync(appsDir, { recursive: true });
    if (fs.existsSync(desktopPath)) {
      const current = fs.readFileSync(desktopPath, "utf8");
      if (current === contents) return;
    }
    fs.writeFileSync(desktopPath, contents, "utf8");
  } catch (err) {
    console.error("[desktop-integration] failed to refresh:", err.message);
  }
}

module.exports = { refreshLinuxDesktopEntry };
