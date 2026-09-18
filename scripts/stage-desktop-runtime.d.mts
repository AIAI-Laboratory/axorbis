export type DesktopRuntimeTarget = { id: string; extension: "tar.gz" | "zip" };

export function desktopRuntimeTarget(platform?: string, architecture?: string): DesktopRuntimeTarget;

export function verifyDesktopRuntime(runtimeDir: string, version?: string, platform?: string): {
	launcher: string;
	node: string;
	webEntry: string;
};

export function stageDesktopRuntime(options?: {
	version?: string;
	target?: DesktopRuntimeTarget;
	archivePath?: string;
	runtimeDir?: string;
}): string;
