import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

type WorkbenchWebOptions = {
	appRoot?: string;
};

const WORKBENCH_WEB_PREFIX = "/app-shell";

function isWorkbenchWebIndexPath(pathname: string): boolean {
	return pathname === "/"
		|| pathname === "/index.html"
		|| pathname === "/projects"
		|| pathname.startsWith("/projects/")
		|| pathname === WORKBENCH_WEB_PREFIX
		|| pathname === `${WORKBENCH_WEB_PREFIX}/`
		|| (pathname.startsWith(`${WORKBENCH_WEB_PREFIX}/`) && !pathname.startsWith(`${WORKBENCH_WEB_PREFIX}/assets/`));
}

function send(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
	response.writeHead(status, {
		"cache-control": "no-store",
		...headers,
	});
	response.end(body);
}

function sendBytes(response: ServerResponse, status: number, body: Buffer, headers: Record<string, string> = {}): void {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.length),
		...headers,
	});
	response.end(body);
}

function workbenchWebDistDir(options: WorkbenchWebOptions): string {
	return resolve(options.appRoot ?? process.cwd(), "dist", "workbench-web");
}

function webAssetContentType(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
		case ".mjs":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".woff":
			return "font/woff";
		case ".woff2":
			return "font/woff2";
		case ".wasm":
			return "application/wasm";
		default:
			return "application/octet-stream";
	}
}

function redirectToDevelopmentWorkbench(response: ServerResponse, request: IncomingMessage, url: URL, headers: Record<string, string>): boolean {
	const developmentUrl = process.env.AXORBIS_WORKBENCH_DEV_URL;
	const host = request.headers.host;
	if (!developmentUrl || !host) return false;
	try {
		const target = new URL(developmentUrl);
		if (target.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(target.hostname)) return false;
		const backend = new URL(`${url.pathname}${url.search}`, `http://${host}`);
		target.searchParams.set("backend", backend.toString());
		response.writeHead(302, { ...headers, location: target.toString() });
		response.end();
		return true;
	} catch {
		return false;
	}
}

export function sendWorkbenchWeb(response: ServerResponse, options: WorkbenchWebOptions, url: URL, headers: Record<string, string>, request?: IncomingMessage): boolean {
	if (!url.pathname.startsWith(WORKBENCH_WEB_PREFIX) && !isWorkbenchWebIndexPath(url.pathname)) return false;
	if (request && isWorkbenchWebIndexPath(url.pathname) && redirectToDevelopmentWorkbench(response, request, url, headers)) return true;
	const distDir = workbenchWebDistDir(options);
	const indexPath = join(distDir, "index.html");
	if (!existsSync(indexPath)) {
		send(response, 404, "Axorbis interface has not been built. Run `npm run build:workbench-web`.", headers);
		return true;
	}

	if (isWorkbenchWebIndexPath(url.pathname)) {
		sendBytes(response, 200, readFileSync(indexPath), {
			"content-type": "text/html; charset=utf-8",
			...headers,
		});
		return true;
	}

	let assetName: string;
	try {
		assetName = decodeURIComponent(url.pathname.slice(`${WORKBENCH_WEB_PREFIX}/`.length));
	} catch {
		send(response, 400, "Invalid asset path.", headers);
		return true;
	}

	const distRoot = resolve(distDir);
	const assetPath = resolve(distDir, assetName);
	if (assetPath !== distRoot && !assetPath.startsWith(`${distRoot}${sep}`)) {
		send(response, 400, "Invalid asset path.", headers);
		return true;
	}
	if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
		send(response, 404, "Not found.", headers);
		return true;
	}
	sendBytes(response, 200, readFileSync(assetPath), {
		"content-type": webAssetContentType(assetPath),
		...headers,
	});
	return true;
}
