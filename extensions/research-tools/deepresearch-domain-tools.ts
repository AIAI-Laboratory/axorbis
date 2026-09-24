import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { scienceDatabaseSearch, type ScienceDatabaseSource } from "./science-databases.js";

// These are small, Deep Research-only views over the existing read-only backend.
// The shared science tool remains available to the lead and other workflows.
export const DEEPRESEARCH_SOURCES = {
	paper: ["arxiv", "biorxiv", "medrxiv", "pubmed", "europepmc", "openalex", "crossref", "datacite"],
	bio: ["uniprot", "pdb", "alphafold", "string", "intact", "interpro", "reactome", "quickgo", "clinicaltrials", "cellguide", "proteinatlas", "mygene", "ols"],
	chem: ["chembl", "pubchem", "chebi", "bindingdb", "zinc", "rhea", "kegg", "openfda"],
	genomics: ["ensembl", "gnomad", "clinvar", "dbsnp", "variation", "cadd", "gwascatalog", "gtex", "eqtlcatalogue", "encode", "jaspar", "ucsc", "unibind", "geo", "arrayexpress"],
} as const satisfies Record<string, readonly ScienceDatabaseSource[]>;

export type DeepResearchSourceDomain = keyof typeof DEEPRESEARCH_SOURCES;

export function deepResearchDomainToolName(domain: DeepResearchSourceDomain): string {
	return `feynman_deepresearch_${domain}_search`;
}

export function registerDeepResearchDomainTools(pi: ExtensionAPI): void {
	for (const domain of Object.keys(DEEPRESEARCH_SOURCES) as DeepResearchSourceDomain[]) {
		const sources: readonly ScienceDatabaseSource[] = DEEPRESEARCH_SOURCES[domain];
		const allowed = new Set<string>(sources);
		pi.registerTool({
			name: deepResearchDomainToolName(domain),
			label: `Deep Research ${domain} search`,
			description: `Search only these ${domain} sources: ${sources.join(", ")}. Returns source URLs and database identifiers for claim evidence.`,
			promptSnippet: `For ${domain} evidence, search only ${sources.join(", ")}; inspect decisive claims against primary source details.`,
			parameters: Type.Object({
				source: Type.Unsafe<ScienceDatabaseSource>({ type: "string", enum: [...sources], description: `One ${domain} source.` }),
				query: Type.String({ description: "Search terms, source command, or exact identifier." }),
				limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum records; default 5." })),
			}),
			async execute(_toolCallId, params) {
				if (!allowed.has(params.source)) throw new Error(`Source ${params.source} is outside the ${domain} Deep Research tool scope.`);
				const result = await scienceDatabaseSearch({
					source: params.source,
					query: params.query,
					limit: params.limit,
				});
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			},
		});
	}
}
