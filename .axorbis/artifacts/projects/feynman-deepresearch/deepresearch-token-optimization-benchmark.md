# Deep Research token-optimization benchmark

Status: **contract-only; token delta unmeasured**

The benchmark uses the same four representative task shapes in `scripts/benchmark-deepresearch-policy.mjs`: narrow explainer, direct comparison, broad survey, and complex multi-domain research. It compares deterministic orchestration bounds from the old workflow contract with the new contract.

| Task shape | Old researchers | New researchers | Researcher-count change | New retrieval bound |
| --- | ---: | ---: | ---: | --- |
| Narrow explainer | 0 | 0 | 0% | 2 search rounds × 4 queries; 4 fetched sources; ~8 accepted sources per worker |
| Direct comparison | 2 | 2 | 0% | same bound, with fresh child context and file-only output |
| Broad survey | 4 | 3 | 25% | same bound |
| Complex multi-domain | 6 | 4 | 33% | same bound |

The old prompt did not provide hard per-worker limits for search rounds, full fetches, accepted sources, or verifier re-fetches. The new prompt caps those dimensions and stops after two no-gain searches. Therefore the strongest deterministic result is removal of unbounded work, not a claimed token percentage.

## Token measurement

No clean old/new provider A/B pair was available. The retained historical run from 2026-09-19 mixed retries and quota failures, and its child run IDs were not linked to the final session segment. The new metrics collector measured the retained lead segment as follows, but this is an observational baseline rather than a representative benchmark:

| Stage | Input | Output | Cache read | Prompt total | Cumulative | Peak context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Historical lead segment | 234,736 | 4,936 | 308,811 | 543,547 | 548,483 | 54,585 |

The benchmark intentionally does not infer a post-change token number. To complete the token A/B, run each exact task prompt once against the old prompt snapshot and once against the new prompt, then compare the `feynman_deepresearch_metrics` fields `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `promptTokens`, `cumulativeTokens`, and `peakContextTokens`. The report must also include researcher count, fetch calls, stored-content reuse, verifier re-fetches, accepted sources, and verification outcome.

## Quality guards held constant

- Evidence is persisted as claim-level JSONL before synthesis; metadata-only discovery cannot support a content claim.
- The claim map preserves support, contradiction, limitations, confidence, and blocked/unsupported states.
- Verification consumes stored evidence first and re-fetches only central, quantitative, insufficient, conflicting, unfetched, or provenance-uncertain claims.
- Review consumes the cited draft and claim map first; a high-reasoning pass is reserved for a genuine MAJOR/FATAL issue.
- Fresh child context and disabled inheritance prevent unrelated parent transcript or project context from entering routine workers.

The contract benchmark passed; the 40–60% token target remains **unverified** until a clean provider A/B run is possible.
