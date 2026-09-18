export function desktopReleaseVersions(root?: string): string;
export function verifyDesktopRelease(options?: {
	root?: string;
	tag?: string;
	requireSigning?: boolean;
	requireRuntime?: boolean;
}): string;
