import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: "client",
  publicDir: false,
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3010"
    }
  },
  build: {
    outDir: path.resolve(process.cwd(), "dist/public"),
    emptyOutDir: true
  }
});
