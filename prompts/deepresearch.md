---
description: Run a bounded, source-grounded investigation and produce an auditable research brief.
args: <topic>
section: Research Workflows
topLevelCli: true
---

## Tool Discipline (Read First)

Tool names are literal. Use only tools visible in the current session. If a tool returns `Tool not found` or `Invalid URL`, do not retry the same invalid call.

- Call `web_search` for search; do not call `search_web` or other aliases.
- Fetch URLs with `fetch_content`; do not call bare `fetch`. Use `urls` for multiple URLs when supported.
- Use visible Feynman alpha tools such as `alpha_search`; for shell access call `feynman alpha ...`; do not call the user's bare global `alpha` binary.
- Do not use `Task` as an agent dispatcher. Use only the visible `subagent` tool.
- Ask questions in plain chat and wait for the next user message.

Run deep research for: $@

This is not a request to explain or implement the workflow instructions. Execute the workflow. Do not answer by describing the protocol. Keep the user-facing `/deepresearch` command and artifact contract unchanged, but use the bounded workflow below.

## Contract

Let `RUN_ROOT` be the active project artifact directory supplied by the workbench, otherwise `.axorbis/artifacts`. Derive a lowercase hyphenated slug of at most five useful words.

Before approval, create only:

- `RUN_ROOT/.plans/<slug>.md`

After approval, leave these artifacts, including partial/blocked ones when a capability fails:

- `RUN_ROOT/.plans/<slug>.md`
- `RUN_ROOT/.drafts/<slug>-evidence.jsonl`
- `RUN_ROOT/.drafts/<slug>-claims.json`
- `RUN_ROOT/.drafts/<slug>-draft.md`
- `RUN_ROOT/.drafts/<slug>-cited.md`
- `RUN_ROOT/.drafts/<slug>-verification.md`
- `RUN_ROOT/.drafts/<slug>-metrics.json` when metrics are available
- `RUN_ROOT/<slug>.md` or `RUN_ROOT/.papers/<slug>.md`
- adjacent `<slug>.provenance.md`

After plan approval, continue in degraded mode if a capability fails. Still write partial/blocked artifacts and use `Verification: BLOCKED`; never end with only an explanation in chat after plan approval. Mark missing checks as `blocked`, `unverified`, or `inferred`; do not invent sources, results, figures, or token savings.

## 1. Route and plan

First call `feynman_deepresearch_policy` before searching or delegating. Estimate:

- `breadth`: `direct`, `comparison`, `broad`, or `complex`;
- `questionCount`: distinct questions to answer;
- `entityCount`: papers, products, methods, or systems being compared;
- `domainCount`: materially different domains;
- `exhaustive`: true only when the user explicitly asks for exhaustive coverage.

The returned policy is authoritative. Do not exceed its researcher, query, fetch, source, or verification budgets. The runtime also blocks over-budget search, fetch, and researcher calls.

Make the scale decision before assigning owners. Write the plan with key questions, stable claim IDs, evidence needed, scale decision, task ledger, verification log, decision log, and estimated tool-call budget. Save it with `memory_remember` as `deepresearch.<slug>.plan` only when that tool is visible.

Then stop and ask for explicit confirmation before gathering evidence. Ask exactly:

`Proceed with this deep research plan? Reply "yes" to continue, or tell me what to change.`

Do not search, fetch, spawn subagents, draft, cite, review, or create placeholders before approval. If the user changes the plan, update `RUN_ROOT/.plans/<slug>.md` first and ask again.

## 2. Gather compact evidence

Use this lifecycle:

`search metadata/snippets → select sources → fetch targeted passages → persist claim cards`

Do not use `includeContent: true` during broad discovery. The runtime forces it off for this workflow. The same source should normally be fetched once per run; reuse stored content with `get_search_content` where available. The verifier must not re-fetch every URL. Avoid PDF extraction unless explicitly requested.

Every evidence JSONL line must be compact and auditable:

```json
{"claim_id":"C1","source_id":"T1-S1","url":"https://example.org/source","title":"Source title","claim":"Supported or contradicted claim","support_excerpt":"Shortest sufficient passage","location":"section or paragraph","source_type":"primary","confidence":"high","fetched_at":"2026-01-01T00:00:00Z","verification_status":"fetched"}
```

Metadata-only discoveries cannot support content claims. Preserve numbers, limitations, conflicts, assumptions, and uncertainty. Write evidence immediately; do not keep raw page bodies in the lead transcript.

### Direct mode

For `maxResearchers: 0`, search and extract evidence yourself. Narrow question, single fact, or simple explainer: no researchers; this should fit approximately 15 tool calls or fewer. Use distinct query angles, stop when the policy budget or two no-gain searches is reached, and write `RUN_ROOT/.drafts/<slug>-evidence-direct.jsonl` before merging it into `RUN_ROOT/.drafts/<slug>-evidence.jsonl`. In prose, this is the direct evidence path: writes `RUN_ROOT/.drafts/<slug>-evidence-direct.jsonl` before synthesis.

### Delegated mode

Use only the number of researchers allowed by the policy. Compatibility scale guide: Direct comparison: at most 2 researchers. Broad survey: 2–3 researchers. Complex multi-domain research: 3–4 researchers. More than 4 researchers: only when the user explicitly requests exhaustive coverage. The runtime policy may cap those numbers lower. Assign disjoint claim IDs and source seams. Write a short brief per researcher at `RUN_ROOT/.plans/<slug>-T1.md`, etc. Each child must use fresh context, the supplied source registry, the hard researcher budget, and `outputMode: "file-only"`.

Launch one bounded async workflow when parallelism helps:

```json
{"workflowScript":"return await runs.all([{key:'T1',agent:'researcher',context:'fresh',task:'This is a Deep Research worker. Read RUN_ROOT/.plans/<slug>-T1.md. Write only compact JSONL claim evidence to the configured output.',output:'RUN_ROOT/.drafts/<slug>-evidence-T1.jsonl',outputMode:'file-only',toolBudget:{soft:8,hard:12,block:['web_search','fetch_content','get_search_content']}}]);","async":true,"globalConcurrencyLimit":4}
```

Keep tool-call JSON small. Do not embed briefs, page bodies, or child output in it. Wait for completion results, verify expected files, validate each JSONL line, deduplicate by normalized URL/source ID, and merge into `RUN_ROOT/.drafts/<slug>-evidence.jsonl`. Continue with partial coverage if one lane fails.

Retrieval guard: maximum 2 search rounds; maximum 4 queries per round; triage no more than 10 candidate results; at most 4 selected full-source fetches per worker by default; approximately 6–8 accepted sources maximum per worker. Stop after two consecutive search attempts add no materially new claim, contradiction, or independent evidence. Avoid PDF parsing unless explicitly requested.

## 3. Claim map and synthesis

Before drafting, write `<slug>-claims.json` as a compact array mapping every important claim to supporting and contradicting source IDs, confidence, limitations, and status (`supported`, `conflicted`, `unsupported`, `inferred`, or `blocked`).

Choose the smallest synthesis path allowed by the policy:

- For `direct` runs, write `<slug>-draft.md` yourself from the claim map and evidence ledger. Do not reread raw pages.
- For `comparison`, `broad`, or `complex` runs, call the `writer` subagent exactly once after the claim map and evidence ledger exist. Give it only those compact file paths plus the plan, use `context: "fresh"`, `outputMode: "file-only"`, and a hard child `toolBudget` of 2. The writer must not search, fetch, reread raw pages, create auxiliary files, or write anything except `<slug>-draft.md`. Do not embed claims or evidence in the tool-call JSON.

Example writer call:

```json
{"agent":"writer","context":"fresh","task":"Read only RUN_ROOT/.plans/<slug>.md, RUN_ROOT/.drafts/<slug>-claims.json, and RUN_ROOT/.drafts/<slug>-evidence.jsonl. Write the draft to RUN_ROOT/.drafts/<slug>-draft.md. Do not search, fetch, reread raw pages, create extra files, or add citations.","output":"RUN_ROOT/.drafts/<slug>-draft.md","outputMode":"file-only","toolBudget":{"soft":1,"hard":2,"block":["web_search","fetch_content","get_search_content","alpha_search","alpha_fetch"]}}
```

This is the only writer launch in a Deep Research run. The child model request is routed through the configured subagent key pool, so its usage should show `Subagent key N`; an individual lead `write` tool event cannot switch keys because it is part of the lead model request. If the writer fails or the file is missing, write the draft once from the compact files as a degraded fallback. Include an executive summary, findings by question/theme, caveats/disagreements, and open questions. Every important factual, quantitative, or code-backed statement must have an evidence home.

## 4. Selective citation and verification

For direct runs, add citations yourself and write `<slug>-cited.md`, then write `<slug>-verification.md` yourself.

For delegated runs, call `verifier` only after the draft, merged evidence ledger, and claim map exist. The verifier must complete before review. Give it only those compact paths. It must reuse stored evidence and must not re-fetch every URL; refetch only central, quantitative, disputed, insufficient, metadata-only, or provenance-uncertain claims. It must write `RUN_ROOT/.drafts/<slug>-cited.md` and report stored checks, targeted refetches, and unresolved claims.

Call `reviewer` only when the policy allows it and only after the cited draft exists; run the reviewer only after the cited draft exists. Give it the cited draft and claim map, not raw source bodies. The routine pass is compact and medium-thinking; launch a deeper pass only for a specific MAJOR/FATAL issue. Fix FATAL issues before delivery and record unresolved MAJOR issues as open questions.

For 1–3 simple corrections use small edits. For larger rewrites write `RUN_ROOT/.drafts/<slug>-revised.md`. After any fix, verify on disk that unsupported wording is gone and corrected wording exists. Never claim a failed edit landed. The final candidate is the revised file if it exists, otherwise the cited file.

## 5. Metrics and delivery

After all children finish, call `feynman_deepresearch_metrics` once with the merged evidence path and a workspace-relative metrics output path. Distinguish provider-reported uncached input tokens, output tokens, cache reads/writes, prompt totals, cumulative tokens, peak per-turn context, searches, fetches, stored-content reuse, researcher count, verifier refetches, and accepted sources. Never call cache reads an HTTP cache hit or peak context cumulative usage.

Use the revised/cited candidate as the final artifact, copy it to `RUN_ROOT/<slug>.md` or `RUN_ROOT/.papers/<slug>.md`, and write adjacent provenance containing date, accepted/rejected sources, verification status, plan/evidence/claims/review/metrics paths, failures, and unresolved checks. Before replying, verify every required artifact and verify that any claimed fix is present on disk. Reply briefly with the final and provenance paths.
