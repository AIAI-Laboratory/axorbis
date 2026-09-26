# Axorbis Literature Intelligence

A desktop literature mapping tool for Computer Science topics. It uses the pinned [SynthScholar 0.0.11](https://github.com/sensein/synthscholar) public search and full text clients, then applies a conservative local evidence pipeline. The app does not run SynthScholar's biomedical PRISMA, RoB or GRADE stages.

## Setup

Requirements: Node.js 22+, Python 3.11+, Rust, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
python3 integration/setup.py
npm run desktop:dev
```

The desktop app uses this checkout's `.venv/bin/python` in development. For an installed build, set `SYNTHSCHOLAR_PYTHON` to a Python interpreter with `integration/requirements.txt` installed. At least one Gemini key is required for concept planning and grounded evidence analysis; Gemini is also the default scope classifier. An optional [Typesafe Jev AI](https://docs.typesafe.ai/introduction/quickstart) mode classifies every paper's scope via `jev-latest` when enabled for a run. Configure `TYPESAFE_API_KEY` in Settings or the process environment to enable it. Gemini remains required in Jev mode for evidence analysis. There is no regex classification fallback. The monitor records per-Gemini-key requests and reported input/output tokens. The model may only select saved, ID-addressed source sentences and cannot invent evidence. An optional OpenAlex key can be set as `OPENALEX_API_KEY` in the desktop process environment or `~/.axorbis/agent/.env`; it goes to Python through stdin and is never written to a review folder. CORE and Semantic Scholar keys can be supplied through their respective `CORE_API_KEY` and `SEMANTIC_SCHOLAR_API_KEY` environment variables.

## Workflow and limits

Gemini scope screening requests a strict JSON schema containing only three numeric scores per paper: `100` for explicit support, `50` for unknown/insufficient evidence, and `0` for explicit contradiction. The app maps these to `YES`, `UNKNOWN`, and `NO`; only three `100` scores qualify a paper for core. Every Gemini request body and raw response body (including failed JSON attempts) is recorded in `gemini-calls.jsonl` inside that review folder, without credentials or Authorization headers. This file can contain paper text and should be treated as sensitive research data.

Enter a CS topic or research question, optional required and related concepts, a publication date range, and a maximum result count per query. Query planning produces required, task, generalization, related, and synonym concepts, then creates anchored provider-specific searches across Semantic Scholar, OpenAlex, arXiv, OpenReview, Crossref, and CORE when those providers are available. Each provider and exact query is recorded. Records are merged by canonical DOI, arXiv ID, normalized exact title, then fuzzy title with matching author and year; conflicting canonical identifiers are never fuzzy-merged. Gemini by default, or Jev AI when selected, reads every paper's title/abstract to assess temporal/dynamic KG relevance, explicit inductive/generalization relevance, and task relevance before assigning `core`, `background`, or `exclude`. Jev reassesses papers with retrieved full text and classifies new counter-search papers. A paper is `core` only when all three are `YES`; a TKG paper with missing inductive/generalization evidence remains `background`. Publication date, language, and publication-type constraints remain mechanical protocol checks, not scientific regex classification.

Selected Gemini keys are paced at least five seconds apart across the run and passed to Python only through stdin; they are never saved in the review folder. The extractor keeps exact sentences from saved full text or abstracts and records source-relative character offsets. Gemini selects relevant IDs, classifies their evidence type and dimensions, and rejects fragments or unsupported promotional claims; every accepted paper claim still points to an exact saved span. Cross-paper claims compare relationships between settings such as unseen entities versus unseen relations, few-shot versus zero-history, and zero-shot/cross-domain/OOD coverage. The evidence matrix uses `YES`, `NO`, `UNKNOWN`, and `NOT_APPLICABLE`; only explicit full-text negation can produce `NO`, so silence remains `UNKNOWN`. Candidate gaps come from sparse combinations in that matrix, report gap-specific basic/deep coverage, and trigger targeted counter-search. A run may safely stop at `mapping_complete` only when no candidate gap was found.

Abstracts are enriched, when missing, from Semantic Scholar, OpenAlex, Crossref and publisher landing-page metadata before evidence availability is assessed. Full-text passages are strong evidence and can support detailed experimental claims and gap verification. Abstract passages are limited evidence for the stated task, method, contribution, high-level findings, and explicit limitations or future work. Metadata-only records remain available for screening follow-up and bibliographic exports, but they do not support scientific claims. Papers are not excluded just because full text is unavailable; records without enough abstract evidence remain in manual review. Evidence spans record `source_level` and offsets into either the saved full text or abstract. The evidence gate reports basic coverage (abstract or full text) separately from deep coverage (full text only); a gap can only become verified with sufficient deep coverage and successful counter-search validation.

The selected workspace receives a unique `<slug>-<timestamp>` folder containing `protocol.json`, `status.json`, `review.json`, `review.md`, `references.bib`, `runner.log`, and `source-text/*.txt` for retrieved full texts. `review.json` is canonical and contains search strategy/provenance, normalized articles, screening results, evidence spans, study profiles, evidence matrix, paper claims, cross-paper claims, candidate/verified gaps, quality metrics, and pipeline status. Compatibility aliases (`screening_decisions`, `atomic_claims`, `research_gaps`, and `quality_gate`) keep existing review folders and desktop views readable during migration. Markdown is generated from this structured result. Stopping a run preserves whatever has already been written; rerunning creates a new unique folder.

## Checks

```sh
npm run build
npm test
npm run desktop:check
```

Desktop code is MIT licensed. SynthScholar is an external Apache-2.0 dependency; see its [source and license](https://github.com/sensein/synthscholar).
