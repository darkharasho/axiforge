import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: ["sortablejs"],
    force: true,
  },
  publicDir: path.resolve(__dirname, "public"),
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
});
