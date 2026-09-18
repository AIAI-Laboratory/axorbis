export type {
	WorkbenchArtifact,
	WorkbenchGeneratedPlan,
	WorkbenchProject,
	WorkbenchResearchClaim,
	WorkbenchRun,
	WorkbenchState,
} from "../../../engine/workbench/types.js";

export type {
	WorkbenchChatMessage,
	WorkbenchChatSession,
	WorkbenchToolEvent,
} from "../../../engine/workbench/chat.js";

export type FilePreview = {
	path: string;
	name: string;
	category: string;
	sizeBytes: number;
	updatedAt: string;
	content: string;
	truncated: boolean;
};
