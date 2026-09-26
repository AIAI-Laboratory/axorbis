# Axorbis Literature Intelligence

A desktop literature mapping tool for Computer Science topics. It uses the pinned [SynthScholar 0.0.11](https://github.com/sensein/synthscholar) public search and full text clients, then applies a conservative local evidence pipeline. The app does not run SynthScholar's biomedical PRISMA, RoB or GRADE stages.

## Setup

Requirements: Node.js 22+, Python 3.11+, Rust, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
python3 integration/setup.py
npm run desktop:dev
```

The desktop app uses this checkout's `.venv/bin/python` in development. For an installed build, set `SYNTHSCHOLAR_PYTHON` to a Python interpreter with `integration/requirements.txt` installed. A Gemini key is optional. Select one key or automatic rotation in the start form to use AI for concept profiling; the monitor records per-key requests and reported input/output tokens. Without a key, the deterministic pipeline still runs and model usage remains unavailable. An optional OpenAlex key can be set as `OPENALEX_API_KEY` in the desktop process environment or `~/.axorbis/agent/.env`; it goes to Python through stdin and is never written to a review folder. CORE and Semantic Scholar keys can be supplied through their respective `CORE_API_KEY` and `SEMANTIC_SCHOLAR_API_KEY` environment variables.

## Workflow and limits

Enter a CS topic or research question, optional core concepts and related terms, a publication date range, and a maximum result count per query. Query understanding derives or profiles concepts, then combines them into multiple searches across arXiv, Semantic Scholar, OpenAlex, Crossref and CORE, subject to provider availability. Each provider and exact query is recorded. Records are merged by canonical DOI, arXiv ID, normalized exact title, then fuzzy title with matching author and year. Screening requires all four checks to pass: knowledge graph study, temporal/dynamic graph centrality, inductive/generalization setting, and a reasoning/completion task. The publication date range is checked deterministically during screening; a missing or out-of-range year is excluded. Full text is resolved for included papers, with arXiv PDF retrieval when available.

Selected Gemini keys are paced at least five seconds apart across the run and passed to Python only through stdin; they are never saved in the review folder. The extractor keeps exact sentences from saved full text or abstracts and records source-relative character offsets. The basic evidence gate requires at least three studies with evidence, 50% basic coverage and six grounded spans before it emits atomic single-source claims. Matrix evaluation settings use full-text evidence only and show unassessed values when no matching full-text passage was extracted. A missing phrase in an abstract never creates a gap. Gap verification requires at least three full-text-evidenced studies, 50% deep coverage, six full-text spans and successful counter-searches across the configured sources; explicit abstract future-work passages remain `abstract_supported` until then. Runs failing the basic gate are marked `insufficient_evidence`; a passed corpus currently reaches `mapping_complete`. The scoped counter-search never proves that no prior work exists. Cross-study narrative synthesis is not implemented, so the app never labels a synthesis complete.

Abstracts are enriched, when missing, from Semantic Scholar, OpenAlex, Crossref and publisher landing-page metadata before evidence availability is assessed. Full-text passages are strong evidence and can support detailed experimental claims and gap verification. Abstract passages are limited evidence for the stated task, method, contribution, high-level findings, and explicit limitations or future work. Metadata-only records remain available for screening follow-up and bibliographic exports, but they do not support scientific claims. Papers are not excluded just because full text is unavailable; records without enough abstract evidence remain in manual review. Evidence spans record `source_level` and offsets into either the saved full text or abstract. The evidence gate reports basic coverage (abstract or full text) separately from deep coverage (full text only); a gap can only become verified with sufficient deep coverage and successful counter-search validation.

The selected workspace receives a unique `<slug>-<timestamp>` folder containing `protocol.json`, `status.json`, `review.json`, `review.md`, `references.bib`, `runner.log`, and `source-text/*.txt` for retrieved full texts. `review.json` contains the corpus, query provenance, criterion decisions, evidence spans, study profiles, evidence matrix, atomic claims, taxonomy, and quality metrics. Source passages can be checked using the saved file path or abstract offsets. Existing review folders remain readable. Stopping a run preserves whatever files have already been written. Rerunning starts a new folder and searches again.

## Checks

```sh
npm run build
npm test
npm run desktop:check
```

Desktop code is MIT licensed. SynthScholar is an external Apache-2.0 dependency; see its [source and license](https://github.com/sensein/synthscholar).
