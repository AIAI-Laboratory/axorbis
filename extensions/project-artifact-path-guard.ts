import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerProjectArtifactPathGuard } from "./research-tools/project-artifact-paths.js";

/** Load only the project artifact routing guard in Pi child sessions. */
export default function projectArtifactPathGuard(pi: ExtensionAPI): void {
	registerProjectArtifactPathGuard(pi);
}
