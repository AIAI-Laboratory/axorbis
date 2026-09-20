---
title: Researcher
description: The researcher agent searches, reads, and extracts findings from papers and web sources.
section: Agents
order: 1
---

The researcher is the primary information-gathering agent in Feynman. It searches academic databases and the web, reads papers and articles, extracts key findings, and organizes source material for other agents to synthesize. Most workflows start with the researcher.

## What it does

The researcher agent handles bounded source discovery and extraction. By default it uses at most two search rounds, four queries per round, ten triaged candidates, and four selected full-source fetches. It stops early when repeated searches add no material claim, contradiction, or independent evidence.

For broad Deep Research tasks, workflow prompts can spawn multiple researcher agents in parallel through one bounded async `workflowScript`. The lead performs cheap landscape discovery first, deduplicates candidate URLs, and assigns non-overlapping claim IDs and sources. Children use fresh context and return file-only evidence references.

## Search strategy

The researcher uses a multi-source search strategy. For academic topics, it queries AlphaXiv for papers and uses citation chains to discover related work. For applied topics, it searches the web for documentation, blog posts, and code repositories. For ML implementation tasks, it can inspect Hugging Face dataset metadata and repo files directly. For most topics, it uses multiple channels and cross-references findings.

Initial searches use snippets, metadata, titles, and abstracts rather than full page content. Full content is fetched only for a selected source tied to an unresolved claim. Stored content is queried for compact passages instead of downloading the same URL again.

## Source evaluation

Not every search result is worth reading in full. The researcher evaluates results by scanning abstracts and summaries first, then selects the most relevant and authoritative sources for deep reading. It considers publication venue, citation count, recency, and topical relevance when prioritizing sources.

## Extraction

For Deep Research, each inspected source becomes one or more compact JSONL records containing stable claim/source IDs, the supported or contradicted claim, the shortest sufficient excerpt, source location, source type, confidence, fetch time, and verification status. Metadata-only discoveries are not treated as evidence.

For ML recipe and replication work, the researcher switches to recipe-shaped extraction. It links reported results to the dataset, split/schema, method, hyperparameters, compute assumptions, metric, implementation code path, and verification status. A dataset is not described as usable unless the researcher checked availability and format, or explicitly marks that check as `unverified` or `blocked`.

## Used by

The researcher agent is used by the `/deepresearch`, `/lit`, `/review`, `/audit`, `/replicate`, `/recipe`, `/compare`, and `/draft` workflows. The workflow prompts call it through Pi's `subagent` tool when delegation improves coverage or context management; narrow tasks stay lead-owned.
