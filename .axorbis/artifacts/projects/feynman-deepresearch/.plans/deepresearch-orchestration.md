# Deep Research orchestration redesign

Slug: `deepresearch-orchestration`

## Task ledger

- Step 0 — completed: inspected current prompts, policy, Pi child-session API, tool registration, and artifact contracts. Existing complexity policy, compact evidence handoff, and researcher tool allowlist changed the original baseline assumptions.
- Step 1 — implemented in commit `d39fd15` on `codex/deepresearch-orchestration`: tool-free question router, three route levels, policy escalation, explicit pipelines, and plan decision log. Runtime provider smoke is blocked because the selected model has no API key. Offline route fixture and targeted tests passed; the full suite has 24 failures outside the Step 1 files.
- Step 2 — implemented and audited: router domain tags select Deep Research-only researcher profiles for web, paper, bio, chem, or genomics. Short source-restricted scientific tools use the existing database backend. The public `subagent` schema has no per-call tool override, so the selected profile name carries the Pi-supported allowlist; no native launcher patch was added. Unknown routes to web + paper search.
- Step 3 — implemented and audited: each Deep Research researcher profile writes full JSONL evidence plus schema-version-1 claim summary. The handoff tool validates exact line and source references while returning only counts. Standard/deep routes verify each lane summary claim by claim as that lane finishes; writer reads validated summaries, and deep reviewer writes a full audit plus summary. Shared `researcher`, `reviewer`, `writer`, and `verifier` prompts for other workflows were not changed.

## Route thresholds fixed for this implementation

- Simple: one focused question, one entity, no requested comparison or cross-domain synthesis.
- Standard: two to four questions, comparison of at least two entities, or two material specialist domains.
- Deep: five or more questions, three or more material specialist domains, or explicit exhaustive coverage.

The policy escalates an under-classified router result. Each route records the router JSON, applied mode, domain tags, reason, and escalation in the run plan.

## Verification log

- `npm run typecheck`: passed after Step 1 code change; repeated after documentation/test changes.
- Targeted `deepresearch-policy.test.ts`: 3/3 passed.
- Targeted content contract tests: 2/2 passed.
- Targeted native workflow example test: 1/1 passed.
- Runtime router frontmatter parsed to `tools: []`, replacement system prompt, and no inherited context.
- Sample question `What is BM25?`: offline router fixture maps to `simple`, one researcher, one writer, no separate verifier or reviewer. Live CLI attempt stopped before routing because the selected model had no API key; no provider token delta is available.
- Full `npm test` rerun with localhost access: 1,155 passing results and 24 failures. Failures include architecture limits, older prompt/doc expectations, CLI rank/paper outputs, Pi patch contracts, and unrelated workbench state tests. None is in the Step 1 `deepresearch` tests; full-suite pass remains blocked by these repo-wide issues.
- Step 2 samples (offline policy): `What protein domains does TP53 contain?` selects one bio profile; a TP53 interactions, affinity, and cancer-variant question selects bio, chem, and genomics profiles.
- Step 2 tool-definition measurement: Pi SDK active `{name,description,parameters}` definitions, estimated at 4 characters/token. Narrow bio: 3,959 before → 4,308 after (+349); three interdisciplinary lanes: 11,877 before → 12,357 after (+480). Prompt snippets/guidelines are reported separately. The increases are expected because the old researcher lacked scientific database access; no token saving is claimed. Raw measurement: `../deepresearch-orchestration-tool-definitions.json`; script: `scripts/measure-deepresearch-tool-definitions.mjs`.
- Step 2 targeted tests (domain tools, routing, settings, metrics, native child workflow) passed 59/59; targeted content-policy tests passed 2/2; typecheck passed. Full `npm test` rerun again had 24 failures with the same failure names as the Step 1 baseline and no failures in the changed Deep Research tests. Full-suite pass remains blocked by pre-existing repo-wide failures.
- Step 3 sample `What is BM25 and how do its parameters affect ranking?`: 3-claim/6-source offline fixture validated researcher and verified summaries; a false evidence line, altered excerpt, omitted claim, or changed provenance is rejected. The full JSONL handoff text measured 3,062 characters (~766 tokens at 4 chars/token), while the structured summary measured 2,311 characters (~578 tokens), a 188-token reduction in this fixture. These are content-size estimates, not actual provider usage.
- Step 3 handoff tool test confirmed it returns only counts, without source URLs, excerpts, or paths. Final targeted Deep Research suite passed 63/63; `npm run typecheck` and `npm run build` passed. Full `npm test` had 1,160 passes and the same 24 failure names as the Step 1/2 baseline, none in changed Deep Research tests. The handoff tool adds about 202 estimated definition tokens to the lead while the sample summary saves about 188 estimated content tokens per handoff; net provider usage is unknown. Live provider test remains blocked: `~/.axorbis/agent/models.json` references key environment variables absent in this CLI environment and `auth.json` has no credentials.

## Next step

Commit Step 3 separately and report the final verification status. A credential-bearing runtime environment is needed for live model/token measurement; the 24 existing repo-wide failures remain outside this workflow's scope.
