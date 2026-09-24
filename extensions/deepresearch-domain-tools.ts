import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerDeepResearchDomainTools } from "./research-tools/deepresearch-domain-tools.js";

// Loaded only by Deep Research researcher profiles, not by the lead or other workflows.
export default function deepResearchDomainTools(pi: ExtensionAPI): void {
	registerDeepResearchDomainTools(pi);
}
