# Deep Research token optimization

Slug: `deepresearch-token-optimization`

## Objective

Reduce repeated context ingestion and typical `/deepresearch` token use by 40–60% without weakening claim traceability, citation verification, contradiction handling, or adversarial review.

## Implementation plan

- [done] Audit the workflow prompt, bundled research agents, Pi 0.85.1 context/compaction behavior, pi-subagents 0.65.1 configuration, telemetry, and saved run artifacts.
- [done] Bound fan-out, search rounds, triage, full fetches, accepted sources, and stopping behavior.
- [done] Replace narrative handoffs with a shared JSONL evidence ledger and compact claim-evidence map.
- [done] Make verifier and reviewer consume stored evidence first and re-fetch selectively.
- [done] Set routine worker reasoning/context inheritance to economical defaults supported by pi-subagents.
- [done] Expose per-stage research-run metrics without recording prompts, source bodies, or file paths in telemetry.
- [done] Add regression tests and a deterministic old/new contract benchmark over representative task shapes; a clean provider A/B remains unavailable.
- [done] Update public documentation where the `/deepresearch` contract or observable artifacts changed.

## Verification log

- `verified` — `npm run typecheck` passed.
- `verified` — metrics/settings/native subagent tests passed; metrics fixture covers token classes, retrieval counts, child-stage attribution, verifier re-fetches, accepted sources, and sanitized output.
- `verified` — contract benchmark ran for narrow, comparison, broad, and complex task shapes.
- `unverified` — the 40–60% provider-token target needs a clean old/new A/B run; retained historical telemetry mixed retries/quota failures and had incomplete child linkage.

## Decision log

- The repository has renamed `.feynman` to `.axorbis`; tracked agent definitions live in `.axorbis/agents/`.
- Preserve all unrelated dirty-worktree changes; only touch files required by this optimization.
- Prefer runtime-supported fresh child context and per-agent inheritance controls over custom context shims.

## Next step

Run the same four task prompts against an old prompt snapshot and this revision when provider capacity permits; compare the metrics artifact and quality outcomes before claiming a token percentage.
