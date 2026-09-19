import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { request as httpRequest } from "node:http";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(webRoot, "..");
const BACKEND_PROXY_PREFIX = "/app-shell/__feynman_proxy__";

function localBackend(value: string | null): URL | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) ? url : undefined;
	} catch {
		return undefined;
	}
}

export default defineConfig({
	base: "/app-shell/",
	root: webRoot,
	plugins: [
		react(),
		{
			name: "axorbis-local-backend-proxy",
			configureServer(server) {
				server.middlewares.use(BACKEND_PROXY_PREFIX, (request, response, next) => {
					const incoming = new URL(request.url ?? "/", "http://vite.local");
					const backend = localBackend(incoming.searchParams.get("backend"));
					if (!backend) return next();
					// Connect strips the mount prefix before this handler receives `url`.
					const apiPath = incoming.pathname || "/";
					const target = new URL(apiPath, backend);
					for (const [key, value] of incoming.searchParams) if (key !== "backend") target.searchParams.append(key, value);
					const token = backend.searchParams.get("token");
					if (token) target.searchParams.set("token", token);
					const upstream = httpRequest(target, { method: request.method, headers: request.headers }, (upstreamResponse) => {
						response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
						upstreamResponse.pipe(response);
					});
					upstream.on("error", (error) => {
						if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
						response.end(JSON.stringify({ error: `Local backend proxy failed: ${error.message}` }));
					});
					request.pipe(upstream);
				});
			},
		},
	],
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
