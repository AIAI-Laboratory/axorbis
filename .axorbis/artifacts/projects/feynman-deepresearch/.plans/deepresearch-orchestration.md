# Deep Research orchestration redesign

Slug: `deepresearch-orchestration`

## Task ledger

- Step 0 — completed: inspected current prompts, policy, Pi child-session API, tool registration, and artifact contracts. Existing complexity policy, compact evidence handoff, and researcher tool allowlist changed the original baseline assumptions.
- Step 1 — implemented on `codex/deepresearch-orchestration`: tool-free question router, three route levels, policy escalation, explicit pipelines, and plan decision log. Runtime provider smoke is blocked because the selected model has no API key. Offline route fixture and targeted tests passed; full test suite has unrelated existing failures under review.
- Step 2 — pending: domain-to-tool subset design and measurement. The public `subagent` schema has no per-call tool override; choose a supported implementation before editing runtime.
- Step 3 — pending: structured handoff and claim-level verification changes, based on actual Step 2 results.

## Route thresholds fixed for this implementation

- Simple: one focused question, one entity, no requested comparison or cross-domain synthesis.
- Standard: two to four questions, comparison of at least two entities, or two material specialist domains.
- Deep: five or more questions, three or more material specialist domains, or explicit exhaustive coverage.

The policy escalates an under-classified router result. Each route records the router JSON, applied mode, domain tags, reason, and escalation in the run plan.

## Verification log

- `npm run typecheck`: passed after Step 1 code change; repeated after documentation/test changes.
- Targeted `deepresearch-policy.test.ts`: 3/3 passed.
- Targeted content contract tests: 2/2 passed.
- Runtime router frontmatter parsed to `tools: []`, replacement system prompt, and no inherited context.
- Sample question `What is BM25?`: offline router fixture maps to `simple`, one researcher, one writer, no separate verifier or reviewer. Live CLI attempt stopped before routing because the selected model had no API key; no provider token delta is available.

## Next step

Finish Step 1 test audit and report the exact passing and blocked checks to the user. Stop before Step 2.
