import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

// Root is the renderer dir so relative asset paths (./styles.css, ./svg, ./modules)
// resolve exactly as in the desktop build. The HTML input is the generated web entry.
export default defineConfig({
  root: path.resolve(repoRoot, "src/renderer"),
  base: "./",
  publicDir: path.resolve(repoRoot, "src/web/public"),
  optimizeDeps: {
    include: ["sortablejs", "@axiapps/gw2-data/engine"],
    exclude: ["@axiapps/gw2-data"],
  },
  server: { port: 5180, strictPort: true },
  build: {
    outDir: path.resolve(repoRoot, "dist/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(repoRoot, "src/renderer/index.generated.html"),
    },
    commonjsOptions: { include: [/packages\/gw2-data/, /node_modules/] },
  },
});
