---
description: Run a source-grounded investigation with reusable evidence, selective verification, and adversarial review.
args: <topic>
section: Research Workflows
topLevelCli: true
---
## Tool Discipline (Read First)

Tool names are literal. Use only tools visible in the current tool set.

- Call `web_search` for search; do not call `search_web`, `google_search`, `google:search`, `search_google`, or `WebSearch`.
- Fetch URLs with `fetch_content`; do not call bare `fetch`, `WebFetch`, `read_url_content`, or pass an array as `url`. Use `urls` for multiple URLs when the tool supports it. Inspect stored search/fetch content with `get_search_content` when visible.
- Use visible Feynman alpha tools such as `alpha_search` when present. For shell access, call `feynman alpha ...`; do not call the user's bare global `alpha` binary.
- To ask the user a question, write plain chat text and wait for the next user message. Do not call `ask_user_question`, `ask_user`, `ask_followup_question`, or `user_choice`.
- Do not use `Task` as an agent dispatcher. Use only the visible `subagent` tool when it exists.
- If a tool returns `Tool not found` or `Invalid URL`, do not retry the same invalid call. Map to a canonical visible tool and valid arguments, or record the capability as blocked.

Run deep research for: $@

This is an execution request, not a request to explain or implement the workflow instructions.
Execute the workflow. Do not answer by describing the protocol, do not explain these instructions, and do not restate the protocol. Your first actions should be tool calls that create directories and write the plan artifact.

## Run paths and required artifacts

Derive a lowercase hyphenated slug of at most five words. Let `RUN_ROOT` be the active workbench project artifact directory supplied with the request, otherwise `.axorbis/artifacts`.

Before approval, create only:

- `RUN_ROOT/.plans/<slug>.md`

After approval, every run must leave:

- `RUN_ROOT/.plans/<slug>.md`
- `RUN_ROOT/.drafts/<slug>-evidence.jsonl`
- `RUN_ROOT/.drafts/<slug>-claims.json`
- `RUN_ROOT/.drafts/<slug>-draft.md`
- `RUN_ROOT/.drafts/<slug>-cited.md`
- `RUN_ROOT/.drafts/<slug>-verification.md`
- `RUN_ROOT/.drafts/<slug>-metrics.json` when `feynman_deepresearch_metrics` is visible
- `RUN_ROOT/<slug>.md` or `RUN_ROOT/.papers/<slug>.md`
- the adjacent `<slug>.provenance.md`

After plan approval, continue in degraded mode if a capability fails. Still write partial/blocked artifacts and use `Verification: BLOCKED`; never end with chat-only output. Never end with only an explanation in chat after plan approval.

## 1. Plan and approval

Write `RUN_ROOT/.plans/<slug>.md` with:

- key questions and stable claim IDs (`C1`, `C2`, ...);
- evidence needed and which claims need independent corroboration;
- scale decision and estimated tool-call budget;
- task ledger;
- verification log;
- decision log.

Make the scale decision before assigning owners. Save the plan through `memory_remember` as `deepresearch.<slug>.plan` only when that tool is visible.

Then stop and ask for explicit confirmation before gathering evidence:

`Proceed with this deep research plan? Reply "yes" to continue, or tell me what to change.`

Do not search, fetch, spawn subagents, draft, cite, review, or create placeholders before approval. If the user requests changes, update `RUN_ROOT/.plans/<slug>.md` first and ask again.

## 2. Scale conservatively

Prefer lead-owned direct research when the task can reasonably be completed in approximately 15 tool calls or fewer.

- Narrow question, single fact, or simple explainer: no researchers.
- Direct comparison: at most 2 researchers.
- Broad survey: 2–3 researchers.
- Complex multi-domain research: 3–4 researchers.
- More than 4 researchers: only when the user explicitly requests exhaustive coverage.

Do not spawn researchers by default. Source count is not a quality metric.

## 3. Discover, select, then fetch

Use this lifecycle:

`search → snippet/metadata triage → targeted fetch → evidence extraction → persist → continue from evidence`

Never use `fetch everything → retain page bodies → compact later`.

### Retrieval budget

For each researcher and for a lead-owned branch:

- maximum 2 search rounds;
- maximum 4 queries per round;
- triage no more than 10 candidate results;
- no full-content fetches during initial landscape discovery;
- at most 4 selected full-source fetches by default;
- approximately 6–8 accepted sources maximum;
- stop after two consecutive search attempts add no materially new claim, contradiction, or independent evidence.

Prefer metadata, titles, snippets, abstracts, and search summaries for discovery. Fetch full content only after selecting a source for a named unresolved claim. Avoid PDF parsing unless explicitly requested; prefer HTML, official docs, paper metadata, abstracts, and source-specific text. If only a PDF exists, record that limitation honestly.

### Fetch once and persist compact evidence

Normalize URLs and maintain a source registry in the plan. The same source should normally be fetched once per run. Before any fetch, check the merged ledger and all active task ledgers for the normalized URL.

Immediately after a fetch, write the smallest sufficient evidence record. Use one JSON object per line:

```json
{"claim_id":"C1","source_id":"T1-S1","url":"https://example.org/source","title":"Source title","claim":"Claim supported or contradicted","support_excerpt":"Shortest sufficient excerpt","location":"section, page, or paragraph","source_type":"primary","confidence":"high","fetched_at":"2026-01-01T00:00:00Z","verification_status":"fetched"}
```

Preserve quantitative values, contradicting evidence, limitations, assumptions, and unresolved uncertainty. A metadata-only discovery is not evidence and must use `verification_status: "metadata-only"` without claiming source content.

### Direct mode

The lead performs discovery and targeted fetches itself, writes `RUN_ROOT/.drafts/<slug>-evidence-direct.jsonl`, then merges/deduplicates it into `<slug>-evidence.jsonl`. Do not spawn verifier or reviewer subagents for a simple direct-mode run; perform the evidence check and adversarial review yourself.

### Delegated mode

The lead first performs a cheap snippet/metadata landscape pass, deduplicates candidate URLs, and assigns non-overlapping claim IDs and sources to 2–4 researchers. Write a short brief per researcher at `RUN_ROOT/.plans/<slug>-T1.md`, etc. Each brief must include claim IDs, unresolved questions, already-fetched URLs, output path, and the hard budget.

Use fresh child context so workers receive only their agent prompt, task brief, and explicitly named files. Use file-only output so evidence is not copied back into the lead transcript.

```json
{
  "workflowScript": "return await runs.all([{key:'T1',agent:'researcher',context:'fresh',task:'Read RUN_ROOT/.plans/<slug>-T1.md. Write only JSONL evidence to the configured output.',output:'RUN_ROOT/.drafts/<slug>-evidence-T1.jsonl',outputMode:'file-only',toolBudget:{soft:12,hard:18,block:['web_search','fetch_content','get_search_content']}},{key:'T2',agent:'researcher',context:'fresh',task:'Read RUN_ROOT/.plans/<slug>-T2.md. Write only JSONL evidence to the configured output.',output:'RUN_ROOT/.drafts/<slug>-evidence-T2.jsonl',outputMode:'file-only',toolBudget:{soft:12,hard:18,block:['web_search','fetch_content','get_search_content']}}]);",
  "async": true,
  "globalConcurrencyLimit": 4
}
```

Keep tool-call JSON small. Do not embed the briefs in it or add unsupported keys. Wait for completion results, record failures, verify files on disk, validate every JSONL line, then merge all task ledgers by normalized URL and source ID into `RUN_ROOT/.drafts/<slug>-evidence.jsonl`. Do not paste their contents into chat.

Once evidence is durable, continue from the ledger rather than rereading page bodies. If an explicit compaction action is available, compact old retrieval transcript before synthesis; otherwise do not spend calls trying to force compaction.

## 4. Build the claim-evidence map

Before drafting, write `RUN_ROOT/.drafts/<slug>-claims.json` as a compact array:

```json
[
  {
    "claim_id": "C1",
    "claim": "Proposed report claim",
    "supporting_source_ids": ["T1-S1"],
    "contradicting_source_ids": [],
    "confidence": "high",
    "limitations": [],
    "status": "supported"
  }
]
```

Every important factual or quantitative claim must map to inspected evidence. Important claims that require corroboration need independent support. Do not silently collapse conflicting sources. Use `unsupported`, `conflicted`, `inferred`, or `blocked` when accurate.

Stop research when core questions have sufficient evidence, major claims have strong sources, corroboration exists where required, no important contradiction is unresolved, and two consecutive searches produce no material information gain.

## 5. Synthesize from the map

Write `RUN_ROOT/.drafts/<slug>-draft.md` yourself. Do not delegate synthesis and do not reread raw sources by default. Use the claim map and evidence ledger.

Include an executive summary, findings by question/theme, caveats/disagreements, and open questions. Before citation, remove or weaken anything not traceable to an evidence record or raw artifact. Mark inferences as inferences. Never invent sources, results, figures, tables, or benchmarks.

## 6. Cite with evidence-first verification

For direct mode, add citations yourself and write `RUN_ROOT/.drafts/<slug>-cited.md`.

For delegated mode, run the verifier only after the draft, merged evidence ledger, and claim map exist. Use `context: "fresh"` and `outputMode: "file-only"`. Give it only those paths and the cited output path.

The verifier must use stored evidence first and must not re-fetch every URL. Re-fetch only when the excerpt is insufficient, the claim is central or quantitatively important, sources conflict, the source was not fetched, provenance is uncertain, or independent verification is materially necessary. Any new search must target one failed claim. Unsupported claims must be removed, weakened, targeted for additional evidence, or marked uncertain.

The verifier must complete before review. A launch receipt or intended filename is not completion; inspect the result and the output file.

## 7. Selective adversarial review

For direct mode, write `RUN_ROOT/.drafts/<slug>-verification.md` yourself.

For delegated mode, run the reviewer only after the cited draft exists, with fresh context and file-only output. Give it the cited draft and claim map, not raw page bodies. The first pass uses the agent's medium reasoning default and focuses on central conclusions, logical leaps, contradictions, quantitative claims, weak evidence, methodological limitations, unsupported generalization, and missing counterevidence.

If it finds a `MAJOR` or `FATAL` issue that genuinely requires deeper analysis, launch one targeted high-reasoning pass for that issue only. Fix FATAL issues before delivery. Note unresolved MAJOR issues in Open Questions; accept MINOR issues.

For 1–3 simple corrections use small edits. For larger rewrites write `RUN_ROOT/.drafts/<slug>-revised.md`. After any fix, verify on disk that unsupported wording is gone and corrected wording exists. Never claim a failed edit landed.

The final candidate is the revised file if it exists, otherwise the cited file.

## 8. Metrics and delivery

If `feynman_deepresearch_metrics` is visible, call it after all workers finish with the slug, merged evidence path, and `RUN_ROOT/.drafts/<slug>-metrics.json`. The metrics artifact must distinguish:

- provider-reported uncached input tokens;
- output tokens;
- cache-read and cache-write tokens;
- prompt tokens (`input + cache read + cache write`);
- cumulative tokens (`input + output + cache read + cache write`);
- peak per-turn context;
- searches and search queries;
- full-content fetch calls and fetched URLs;
- stored-content reuse;
- researcher count;
- verifier re-fetches;
- accepted sources.

Do not report peak context as cumulative use, cache reads as uncached input, or stored-content reuse as an HTTP cache hit. If the metrics tool is unavailable, record metrics as unavailable rather than guessing.

Copy the final candidate to `RUN_ROOT/.papers/<slug>.md` for a paper-style draft or `RUN_ROOT/<slug>.md` otherwise. Write adjacent provenance containing date, research rounds, consulted/accepted/rejected sources, verification status, plan, evidence/claim/review paths, metrics path, failures, and unresolved checks.

Before responding, verify every required artifact on disk and verify that any claimed fix is present. Read the final candidate and respond with:

- `## Research synthesis`: the answer, 3–6 material findings, and important caveats consistent with verification status.
- `## Files`: final report, provenance, plan, evidence ledger, claim map, verification, and metrics when present.

Wrap every artifact path in inline code. State plainly when output is partial or blocked.
