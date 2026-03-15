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
  build: {
    outDir: "../../dist/site",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        "404": path.resolve(__dirname, "404.html"),
      },
    },
  },
});
