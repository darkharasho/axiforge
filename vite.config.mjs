import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
  server: {
    port: 5174,
    strictPort: true,
  },
  optimizeDeps: {
    include: ["sortablejs", "@axiapps/gw2-data/engine"],
    exclude: ["@axiapps/gw2-data"],
    force: true,
  },
  publicDir: path.resolve(__dirname, "public"),
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    commonjsOptions: {
      include: [/packages\/gw2-data/, /node_modules/],
    },
  },
});
