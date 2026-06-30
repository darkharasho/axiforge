// Derives the web entry HTML from the desktop renderer HTML so body markup stays
// single-source. Swaps the renderer.js module script for the web entry, retitles,
// and drops the Electron-only no-op. Output is git-ignored and regenerated each build.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const srcHtml = readFileSync(resolve(root, "src/renderer/index.html"), "utf8");

let out = srcHtml
  .replace("<title>AxiForge Desktop</title>", "<title>AxiForge Playground</title>")
  .replace(
    '<script type="module" src="./renderer.js"></script>',
    '<script type="module" src="../web/main-web.js"></script>'
  )
  .replace("<body>", '<body class="is-web">');

// Sanity guard: fail loudly if the renderer script tag moves/renames.
if (!out.includes('src="../web/main-web.js"')) {
  throw new Error("gen-web-html: renderer.js script tag not found — update the replace target.");
}

writeFileSync(resolve(root, "src/renderer/index.generated.html"), out);
console.log("gen-web-html: wrote src/renderer/index.generated.html");
