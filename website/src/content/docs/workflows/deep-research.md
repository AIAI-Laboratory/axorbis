---
title: Deep Research
description: Run a bounded, evidence-led investigation that produces a cited research brief.
section: Workflows
order: 1
---

Deep research classifies the question before gathering evidence, then persists compact claim-level records so synthesis, citation, and review reuse the same inspected sources. The route and its reason are saved in the plan.

## Usage

From the REPL:

```
/deepresearch What are the current approaches to mechanistic interpretability in LLMs?
```

From the CLI:

```bash
feynman deepresearch "What are the current approaches to mechanistic interpretability in LLMs?"
```

Both forms are equivalent. The workflow first writes a plan to the active project's `.axorbis/artifacts/projects/<project-id>/.plans/<slug>.md`, summarizes it, and waits for you to confirm or request changes. After you approve the plan, it streams progress as Feynman discovers and analyzes sources.

## How it works

The deep research workflow proceeds through five phases. First, a tool-free router reads only the question and selects `simple`, `standard`, or `deep` from observable cues: the number of subquestions, compared entities, specialist domains, and whether exhaustive coverage was requested. Feynman writes that decision, its reason, key questions, source strategy, task ledger, and verification log to the plan, then asks for confirmation before executing.

Second, after approval, `simple` uses one researcher and a writer with inline claim checks by the lead; `standard` uses one or two researchers, a writer, and a verifier; `deep` uses three researchers, a writer, a verifier, and a reviewer. The policy also caps query, fetch, accepted-source, and verifier-refetch budgets. Exhaustive coverage does not remove the hard ceiling; it is recorded as a bounded, potentially partial run.

Parallel evidence gathering uses fresh child context and one async `workflowScript` with `runs.all` and a concurrency limit of three. Each child reads a non-overlapping task brief, has at most two search rounds, triages at most ten candidates, fetches only selected sources, and returns a file reference instead of copying evidence into the lead transcript. The runtime compacts older retrieval tool results before later model calls, while the full evidence remains available through stored-content lookup and the on-disk ledger.

Third, Feynman discovers with snippets and metadata before fetching. A selected source is normally fetched once, then reduced immediately to a JSONL evidence record with claim and source IDs, a short supporting excerpt, location, confidence, provenance, and verification status. The merged evidence ledger feeds a compact claim map that preserves support, contradiction, limitations, and uncertainty. PDF extraction is avoided unless explicitly requested.

Fourth, synthesis reads the claim map and evidence ledger instead of reopening every source. Research stops when core claims are supported, necessary corroboration exists, important contradictions are resolved or explicit, and two consecutive searches add no material information.

Finally, simple runs cite claims checked inline against the stored evidence. Standard and deep runs use a verifier that checks stored evidence first and only re-fetches sources for central, quantitative, conflicting, insufficient, or provenance-uncertain claims. Deep runs also use a reviewer for high-impact weaknesses. Every route uses one bounded writer child over the compact claim/evidence files. A metrics artifact separates uncached input, output, cache reads/writes, cumulative usage, peak context, retrieval counts, and stage attribution. The report and provenance remain under the active project.

## Output format

The research brief follows a consistent structure:

- **Summary** -- A concise overview of the topic and key takeaways
- **Background** -- Context and motivation for the research area
- **Key Findings** -- The main results organized by theme, with inline citations
- **Open Questions** -- Unresolved issues and promising research directions
- **References** -- Full citation list with links to source papers and articles

Supporting artifacts include `<slug>-evidence.jsonl`, `<slug>-claims.json`, `<slug>-verification.md`, and `<slug>-metrics.json` when the metrics tool is available.

## Customization

You can steer the research by being specific in your prompt. Narrow topics produce more focused briefs. Broad topics produce survey-style overviews. You can also specify constraints like "focus on papers from 2024" or "only consider empirical results" to guide the agents.
