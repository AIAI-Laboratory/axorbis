---
description: Route a research question to a bounded, source-grounded investigation and cited brief.
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
- `RUN_ROOT/.drafts/<slug>-evidence-Tn.jsonl` for each researcher lane (full audit artifact)
- `RUN_ROOT/.drafts/<slug>-summary-Tn.json` and `<slug>-verified-Tn.json` for each researcher lane
- `RUN_ROOT/.drafts/<slug>-claims.json`
- `RUN_ROOT/.drafts/<slug>-draft.md`
- `RUN_ROOT/.drafts/<slug>-cited.md`
- `RUN_ROOT/.drafts/<slug>-verification.md`
- `RUN_ROOT/.drafts/<slug>-review.md` and `<slug>-review-summary.json` for deep runs
- `RUN_ROOT/.drafts/<slug>-metrics.json` when metrics are available
- `RUN_ROOT/<slug>.md` or `RUN_ROOT/.papers/<slug>.md`
- adjacent `<slug>.provenance.md`

After plan approval, continue in degraded mode if a capability fails. Still write partial/blocked artifacts and use `Verification: BLOCKED`; never end with only an explanation in chat after plan approval. Mark missing checks as `blocked`, `unverified`, or `inferred`; do not invent sources, results, figures, or token savings.

## 1. Route and plan

First call `subagent` once with `agent: "deepresearch-router"`, `context: "fresh"`, and a task containing only the research question. This router has no tools or inherited context. Parse its JSON result; do not pass the full conversation, a plan, or source text. If routing fails, conservatively classify as `standard`, with `unknown` domain and a recorded failure reason. Then call `feynman_deepresearch_policy` with the router's `complexity`, `questionCount`, `entityCount`, `domainTags`, and `reason`; set `exhaustive` only when explicitly requested. Do this before searching or delegating research.

The route is based on observable wording: `simple` means one focused question and no comparison; `standard` means two to four questions, at least two compared entities, or two material domains; `deep` means five or more questions, three or more material domains, or explicit exhaustive coverage. The policy may escalate an under-classified route. Do not change these thresholds during a run.

The returned policy is authoritative. Do not exceed its researcher, query, fetch, source, or verification budgets. The runtime also blocks over-budget search, fetch, and researcher calls.

Make the scale decision before assigning owners. Write the plan with the original question, router JSON, applied policy mode, domain tags, route reason, any escalation, the policy's `researcherProfiles` and their scoped tool subsets, key questions, stable claim IDs, evidence needed, task ledger, verification log, decision log, and estimated tool-call budget. Save it with `memory_remember` as `deepresearch.<slug>.plan` only when that tool is visible.

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

### Researcher count by route

- `simple`: exactly one researcher, then writer. The lead checks each claim against its summary excerpt and source location and records those inline checks; there is no reviewer or separate verifier child.
- `standard`: use the policy's one or two `researcherProfiles`; verify each lane's claims immediately after that lane finishes, then writer; no reviewer.
- `deep`: three researchers in parallel; verify each lane's claims immediately after that lane finishes, then writer and reviewer.

Use the returned `researcherProfiles` exactly, with one child per profile entry; write each selected agent name as a literal in `workflowScript` so the runtime can count researcher calls. Do not call the shared `researcher` agent for Deep Research. Profile selection follows domain tags: `web-only` → web, `paper-search` or `unknown` → paper, and `bio` / `chem` / `genomics` → the matching specialist profile, each with a paper-search tool. For mixed specialist domains, assign separate lanes and disjoint claims; never grant the full science database tool to a child. These profiles are the supported Pi mechanism for a domain tool subset because this version of `subagent` has no per-call `tools` field. Assign disjoint claim IDs and source seams. Write a short brief per researcher at `RUN_ROOT/.plans/<slug>-T1.md`, etc. Each child must use fresh context, the supplied source registry, the hard researcher budget, and `outputMode: "file-only"`.

Each researcher writes two files: a full JSONL evidence artifact and a schema-version-1 summary JSON at `RUN_ROOT/.drafts/<slug>-summary-Tn.json`. Its brief names both exact paths. Each summary claim has `claim_id`, `claim`, `confidence` (`high|medium|low`), and `sources` containing `source_id`, `url`, optional `doi`, `location`, `support_excerpt`, `verification_status`, and one-based `evidence_line`. The source fields must exactly match that line in the full artifact. The next child sees only the summary, not the full JSONL.

Launch one bounded async workflow when parallelism helps:

```json
{"workflowScript":"return await runs.all([{key:'T1',agent:'deepresearch-researcher-paper',context:'fresh',task:'This is a Deep Research worker. Read RUN_ROOT/.plans/<slug>-T1.md. Write full JSONL to the configured output and a structured summary to RUN_ROOT/.drafts/<slug>-summary-T1.json.',output:'RUN_ROOT/.drafts/<slug>-evidence-T1.jsonl',outputMode:'file-only',toolBudget:{soft:8,hard:12,block:['web_search','fetch_content','get_search_content']}}]);","async":true,"globalConcurrencyLimit":4}
```

Keep tool-call JSON small. Do not embed briefs, page bodies, or child output in it. As each lane completes, call `feynman_deepresearch_handoff` with `kind: "researcher"`, its full evidence path, and summary path. This validates the summary against the full artifact without loading that artifact into lead context. For standard/deep, immediately call `deepresearch-claim-verifier` with fresh context and only that lane's summary path; output `<slug>-verified-Tn.json` in file-only mode. Call the handoff validator again with the verified path. A rejected or missing summary is blocked, never silently passed to writer. For simple, the lead performs the same per-claim checks from the summary and records outcomes in `<slug>-verification.md`. Deduplicate by normalized URL/source ID when merging the full JSONL for audit and metrics. Continue with partial coverage if a lane fails, marking its claims blocked.

Retrieval guard: maximum 2 search rounds; maximum 4 queries per round; triage no more than 10 candidate results; at most 4 selected full-source fetches per worker by default; approximately 6–8 accepted sources maximum per worker. Stop after two consecutive search attempts add no materially new claim, contradiction, or independent evidence. Avoid PDF parsing unless explicitly requested.

## 3. Claim map and synthesis

Before drafting, write `<slug>-claims.json` as a compact array derived only from validated lane summaries, mapping every important claim to supporting and contradicting source IDs, confidence, limitations, and status (`supported`, `conflicted`, `unsupported`, `inferred`, or `blocked`). Preserve `evidence_line`, URL/DOI, and source location in the source registry. For standard/deep, use verified summaries. The full evidence ledger is an audit artifact and is never a routine downstream input.

For every route, call the `writer` subagent exactly once after the claim map and summaries exist. Give it only the plan, claim map, and validated summary paths (verified summaries for standard/deep), use `context: "fresh"`, `outputMode: "file-only"`, and a hard child `toolBudget` of 2. The writer must not search, fetch, reread raw pages or evidence JSONL, create auxiliary files, or write anything except `<slug>-draft.md`. Do not embed claims or evidence in the tool-call JSON.

Example writer call:

```json
{"agent":"writer","context":"fresh","task":"Read only RUN_ROOT/.plans/<slug>.md, RUN_ROOT/.drafts/<slug>-claims.json, and the validated summary-Tn.json or verified-Tn.json paths listed in the plan. Write the draft to RUN_ROOT/.drafts/<slug>-draft.md. Do not read evidence JSONL or raw pages, search, fetch, create extra files, or add citations.","output":"RUN_ROOT/.drafts/<slug>-draft.md","outputMode":"file-only","toolBudget":{"soft":1,"hard":2,"block":["web_search","fetch_content","get_search_content","alpha_search","alpha_fetch"]}}
```

This is the only writer launch in a Deep Research run. The child model request is routed through the configured subagent key pool, so its usage should show `Subagent key N`; an individual lead `write` tool event cannot switch keys because it is part of the lead model request. If the writer fails or the file is missing, write the draft once from the compact files as a degraded fallback. Include an executive summary, findings by question/theme, caveats/disagreements, and open questions. Every important factual, quantitative, or code-backed statement must have an evidence home.

## 4. Citation and review

For `simple` runs, the lead adds citations from the inline-checked claim map and writes `<slug>-cited.md` and `<slug>-verification.md`. Record every claim ID, source ID, excerpt/location checked, outcome, and unresolved gap. Remove or soften claims whose stored evidence is insufficient. This is inline verification, not a full verifier pass.

For `standard` and `deep` runs, the claim-verifier has already checked every lane's summary before drafting. The lead adds citations from the verified claim map, removes or softens unsupported claims, and writes `<slug>-cited.md` and `<slug>-verification.md`. Record claim IDs, source IDs, summary excerpt/location, outcomes, any targeted refetch, and unresolved gaps. Do not launch a redundant full-report verifier pass. A cited statement must match the verified claim, and every citation must resolve to a URL/DOI and an evidence line in the full audit artifact.

For deep runs, call `deepresearch-reviewer` only after the cited draft exists. Give it only the cited draft and verified summaries. It writes full `<slug>-review.md` and `<slug>-review-summary.json`; the lead reads only the review summary in routine handoff. Call `feynman_deepresearch_handoff` with `kind: "reviewer"`, both review paths, and `citedPath` before applying fixes. The routine pass is medium-thinking; launch a deeper pass only for a specific MAJOR/FATAL issue. Fix FATAL issues before delivery and record unresolved MAJOR issues as open questions.

For 1–3 simple corrections use small edits. For larger rewrites write `RUN_ROOT/.drafts/<slug>-revised.md`. After any fix, verify on disk that unsupported wording is gone and corrected wording exists. Never claim a failed edit landed. The final candidate is the revised file if it exists, otherwise the cited file.

## 5. Metrics and delivery

After all children finish, call `feynman_deepresearch_metrics` once with the merged evidence path and a workspace-relative metrics output path. Distinguish provider-reported uncached input tokens, output tokens, cache reads/writes, prompt totals, cumulative tokens, peak per-turn context, searches, fetches, stored-content reuse, researcher count, verifier refetches, and accepted sources. Never call cache reads an HTTP cache hit or peak context cumulative usage.

Use the revised/cited candidate as the final artifact, copy it to `RUN_ROOT/<slug>.md` or `RUN_ROOT/.papers/<slug>.md`, and write adjacent provenance containing date, accepted/rejected sources, verification status, plan/evidence/claims/review/metrics paths, failures, and unresolved checks. Before replying, verify every required artifact and verify that any claimed fix is present on disk. Reply briefly with the final and provenance paths.
