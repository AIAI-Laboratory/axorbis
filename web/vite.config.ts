import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(webRoot, "..");

export default defineConfig({
	base: "/app-shell/",
	root: webRoot,
	plugins: [react()],
	build: {
		emptyOutDir: true,
		outDir: resolve(appRoot, "dist", "workbench-web"),
		rolldownOptions: {
			input: resolve(webRoot, "index.html"),
		},
	},
	server: {
		host: "127.0.0.1",
	},
});
