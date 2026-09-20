---
title: Deep Research
description: Run a bounded, evidence-led investigation that produces a cited research brief.
section: Workflows
order: 1
---

Deep research is the flagship Feynman workflow. It searches broadly enough to answer the question, then persists compact claim-level evidence so synthesis, citation, and review reuse the same inspected sources. Narrow explainers stay lead-owned; parallel researchers are reserved for comparisons, broad surveys, and multi-domain questions.

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

The deep research workflow proceeds through five phases. First, Feynman creates a plan with key questions, source strategy, scale decision, task ledger, and verification log, then asks for confirmation before executing.

Second, after approval, Feynman chooses the smallest useful scale. Work expected to fit roughly 15 tool calls stays with the lead. Comparisons use no more than two researchers, broad surveys use two or three, and complex multi-domain work uses three or four. More than four requires an explicit request for exhaustive coverage.

Parallel evidence gathering uses fresh child context and one async `workflowScript` with `runs.all` and a concurrency limit of four. Each child reads a non-overlapping task brief, has at most two search rounds, triages at most ten candidates, fetches at most four selected sources by default, and returns a file reference instead of copying evidence into the lead transcript. Feynman checks the completion results and files before synthesis.

Third, Feynman discovers with snippets and metadata before fetching. A selected source is normally fetched once, then reduced immediately to a JSONL evidence record with claim and source IDs, a short supporting excerpt, location, confidence, provenance, and verification status. The merged evidence ledger feeds a compact claim map that preserves support, contradiction, limitations, and uncertainty. PDF extraction is avoided unless explicitly requested.

Fourth, synthesis reads the claim map and evidence ledger instead of reopening every source. Research stops when core claims are supported, necessary corroboration exists, important contradictions are resolved or explicit, and two consecutive searches add no material information.

Finally, the verifier checks stored evidence first and only re-fetches sources for central, quantitative, conflicting, insufficient, or provenance-uncertain claims. The reviewer concentrates on high-impact weaknesses rather than rereading all raw sources. A metrics artifact separates uncached input, output, cache reads/writes, cumulative usage, peak context, retrieval counts, and stage attribution. The report and provenance remain under the active project.

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
