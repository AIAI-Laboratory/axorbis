import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: webRoot,
  plugins: [react()],
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: { outDir: resolve(webRoot, "../dist/review-web"), emptyOutDir: true },
});
