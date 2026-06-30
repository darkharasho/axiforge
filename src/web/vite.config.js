import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const webSrcDir = path.resolve(repoRoot, "src/web");

// Root is the renderer dir so relative asset paths (./styles.css, ./svg, ./modules)
// resolve exactly as in the desktop build. The HTML input is the generated web entry.
export default defineConfig({
  root: path.resolve(repoRoot, "src/renderer"),
  base: "./",
  publicDir: path.resolve(repoRoot, "src/web/public"),
  optimizeDeps: {
    // Pre-bundle node_module CJS deps that ESM playground files import, so Vite
    // synthesizes their named exports (avoids "does not provide named export").
    // First-party CJS (src/main/buildChatLink.js) is handled by the transform
    // plugin below instead — optimizeDeps does not reliably pre-bundle a
    // first-party file referenced by relative path.
    include: ["sortablejs", "@axiapps/gw2-data/engine", "@axiapps/code"],
    exclude: ["@axiapps/gw2-data"],
  },
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(path.resolve(repoRoot, "package.json"), "utf8")).version
    ),
  },
  server: {
    port: 5180,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  plugins: [
    {
      // src/main/buildChatLink.js is first-party CommonJS (its only CJS construct
      // is the final `module.exports = {...}` line — everything else is plain JS
      // and a dynamic import of gw2buildlink). Vite serves first-party CJS
      // untransformed, so a named ESM import of it errors in the browser. Rewrite
      // just that export line to an ESM named export, for both dev and build. The
      // on-disk file stays CJS for the Electron main process and Jest.
      name: "buildchatlink-cjs-to-esm",
      enforce: "pre",
      transform(code, id) {
        const file = id.split("?")[0].replace(/\\/g, "/");
        if (file.endsWith("/src/main/buildChatLink.js")) {
          return {
            code: code.replace(
              /module\.exports\s*=\s*\{([\s\S]*?)\}\s*;?/,
              "export {$1};"
            ),
            map: null,
          };
        }
      },
    },
    {
      // Dev-only: resolve /web/* module specifiers to src/web/* on disk.
      // index.generated.html has `src="../web/main-web.js"` which Vite rewrites
      // to the URL /web/main-web.js, outside the renderer root. This plugin
      // intercepts that URL-form path and returns the real fs path.
      name: "web-src-resolver",
      apply: "serve",
      resolveId(id) {
        // Vite passes the URL-path form of the script src during HTML transform.
        if (id === "/web/main-web.js" || id.startsWith("/web/")) {
          const rel = id.slice("/web/".length);
          return path.join(webSrcDir, rel);
        }
      },
    },
  ],
  build: {
    outDir: path.resolve(repoRoot, "dist/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(repoRoot, "src/renderer/index.generated.html"),
    },
    commonjsOptions: { include: [/packages\/gw2-data/, /node_modules/] },
  },
});
