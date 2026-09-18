import { existsSync, readlinkSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function staysWithin(root, path) {
	const difference = relative(root, path);
	return difference !== ".." && !difference.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(difference);
}

export function assertPortableSymlinks(root) {
	const absoluteRoot = resolve(root);
	const canonicalRoot = realpathSync(absoluteRoot);
	const directories = [absoluteRoot];
	while (directories.length) {
		const directory = directories.pop();
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				directories.push(path);
				continue;
			}
			if (!entry.isSymbolicLink()) continue;
			const link = readlinkSync(path);
			const target = resolve(dirname(path), link);
			if (isAbsolute(link) || !staysWithin(absoluteRoot, target) || !existsSync(target)) {
				throw new Error(`Non-portable or broken runtime symlink: ${path} -> ${link}`);
			}
			const actualTarget = realpathSync(target);
			if (!staysWithin(canonicalRoot, actualTarget)) {
				throw new Error(`Runtime symlink escapes its bundle: ${path} -> ${link}`);
			}
		}
	}
}
