import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const projectRoot = path.join(__dirname, "../..");

export default defineConfig({
  root: __dirname,
  base: "./",
  publicDir: path.join(__dirname, "../../public"),
  resolve: {
    alias: {
      "@renderer": path.join(__dirname, "../renderer"),
    },
  },
  server: {
    fs: { allow: [projectRoot] },
  },
  optimizeDeps: {
    include: ["@axiapps/gw2-data", "@axiapps/gw2-data/engine"],
  },
  build: {
    outDir: "../../dist/site",
    emptyOutDir: true,
    commonjsOptions: {
      include: [/packages\/gw2-data/, /node_modules/],
    },
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        "404": path.resolve(__dirname, "404.html"),
      },
    },
  },
});
