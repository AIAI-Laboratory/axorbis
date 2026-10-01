![Axorbis — literature intelligence](docs/axorbis-banner.svg)

# Axorbis Literature Intelligence

**Axorbis** is a desktop application for conducting traceable, evidence-grounded systematic literature reviews in Computer Science.

It helps you:

- define a research question and review protocol;
- generate and execute reproducible literature searches;
- inspect screening decisions;
- retrieve and trace evidence back to the exact source passages;
- compare findings across studies;
- identify and verify candidate research gaps;
- export structured and human-readable review artifacts.

Axorbis uses the pinned [SynthScholar 0.0.11](https://github.com/sensein/synthscholar) public search and full-text clients.

Axorbis does **not** run SynthScholar's biomedical PRISMA, Risk of Bias, or GRADE stages.

---

## Quick start

### Requirements

Install:

- Node.js 22+
- Python 3.11+
- Rust
- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)

Then run:

```sh
npm install
python3 integration/setup.py
npm run desktop:dev
```

To create the macOS drag-to-install image, run:

```sh
npm run desktop:build:dmg
```

The release artifact is written to `app/src-tauri/target/release/bundle/dmg/`. The build is accepted only when the DMG contains both `Axorbis.app` and the `/Applications` shortcut and the app signature verifies. Local builds use an ad-hoc signature unless `APPLE_SIGNING_IDENTITY` is set; public distribution still requires an Apple Developer ID signature and notarization. Files named `rw.*.dmg` under `bundle/macos/` are temporary images and must not be distributed.

To create the Windows x64 NSIS installer, run `npm run desktop:build:exe`. On Windows this uses the native MSVC toolchain. Cross-building on macOS requires Homebrew `nsis`, `llvm`, and `lld`, the `x86_64-pc-windows-msvc` Rust target, and `cargo-xwin`. The resulting `*-setup.exe` is written under `app/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

Development uses:

```text
.venv/bin/python
```

The desktop checks this environment at startup and runs the bundled setup automatically when SynthScholar is missing. An installed macOS build creates its private runtime at `~/.axorbis/runtime/.venv`. If the machine has no compatible interpreter, Axorbis downloads a pinned Python 3.11 standalone runtime, verifies its SHA-256 digest, and keeps it under `~/.axorbis/runtime/python`; users do not need to install Python or Homebrew manually. The first launch requires network access. Set `SYNTHSCHOLAR_PYTHON` only when you want to override the managed interpreter with one where `integration/requirements.txt` is already installed.

---

## API configuration

At least one **Gemini API key** must be configured in the app before starting a review.

Gemini is required for:

- concept and query planning;
- default paper screening;
- evidence analysis;
- evidence classification;
- research-gap analysis.

### Optional Jev AI screening

Axorbis also supports the optional [Typesafe Jev AI](https://docs.typesafe.ai/introduction/quickstart) screening mode.

To enable it, configure:

```text
TYPESAFE_API_KEY
```

Either in **Settings** or in the process environment.

Jev AI replaces Gemini for supported screening operations, but Gemini is still required for the rest of the review pipeline.

### Optional literature-source keys

Additional provider credentials can be configured through:

```text
OPENALEX_API_KEY
CORE_API_KEY
SEMANTIC_SCHOLAR_API_KEY
```

OpenAlex also accepts a key stored in:

```text
~/.axorbis/agent/.env
```

---

## Review workflow

A typical review proceeds through the following stages.

### 1. Define the protocol

Enter:

- a Computer Science topic or research question;
- optional required concepts;
- optional related concepts;
- a publication-date range, typed or selected from a calendar;
- optional language, publication type, inclusion and exclusion criteria;
- search sources, screening template, Gemini audit mode, and source-text retention;
- optional extraction dimensions and a synthesis objective;
- a maximum result count per query.

### 2. Search and deduplicate

Axorbis plans search queries and executes them against available providers.

Supported sources include:

- Semantic Scholar
- OpenAlex
- arXiv
- OpenReview
- Crossref
- CORE

Every provider and exact query is recorded for provenance.

The desktop reference graph looks up references for every selected paper in Crossref by DOI or matched title and OpenAlex by DOI or exact title, merges their cited works by DOI or normalized title, then tries Semantic Scholar Academic Graph for papers still missing references. Up to four papers are looked up concurrently, with each paper's source failures handled independently and results returned in review order. OpenAlex expands `referenced_works`; Semantic Scholar resolves papers by DOI, arXiv ID, or exact title and paginates through their cited works. Public OpenReview v2 submission metadata fills missing author, year, abstract, and venue fields and offers OpenReview/PDF links where available; OpenReview profile references are never treated as paper citations. The graph links cited works to their citing paper. Its default overview spaces papers into two rings and shows up to eight prominent references shared by multiple papers, with subdued links. A single click selects a paper and opens its details without changing the graph; the detail panel previews five cited works and opens the complete, scrollable bibliography in a modal. Double-clicking a review paper opens an isolated subgraph centered on it and all the works it cites. Unrelated review papers are hidden from that subgraph, while the sidebar remains available to switch papers. Closing its detail returns to the overview, while “Xem tất cả” reveals the complete graph. Paper and reference nodes show author and year when available; references without authors show a shortened title. Labels that would overlap are hidden until hover or selection. The graph shows reference coverage and per-paper lookup failures. Sources may still lack a bibliography, so the graph never invents connections. Results are cached as `citation-graph.json` in the review folder and can be refreshed from the graph view; incomplete lookups are not cached.

The protocol also offers optional one-hop citation snowballing during the scientific run. It looks backward and forward from up to five seed papers through Semantic Scholar, with up to four neighbors in each direction per seed. New records enter the normal screening and evidence pipeline; `citation_expansion_history` records the stopping rule and lookup results. The post-review reference graph remains an exploratory view and does not alter the finished corpus.


Records are merged in the following order:

1. canonical DOI;
2. arXiv ID;
3. normalized exact title;
4. fuzzy title matching with compatible author and publication year.

Records with conflicting canonical identifiers are **never** fuzzy-merged.

### 3. Screen papers

Retrieved records are screened for relevance to the review protocol.

New reviews use protocol-based relevance screening. The optional temporal knowledge-graph template retains the earlier three specialized dimensions for that research area. Papers can be classified as:

```text
core
background
exclude
```

`background` records need adjudication. The report distinguishes the strict core corpus from an expanded sensitivity analysis that includes uncertain records. Axorbis then enriches relevant records with abstracts and full text where available.

In the result's Methodology tab, a reviewer can mark a background record Include or Exclude. Axorbis rebuilds the structured result from saved evidence, records the decision in `adjudication_history`, and leaves any newly generated gap candidate awaiting a separate counter-search.

### 4. Map evidence

The pipeline extracts grounded source passages, builds study profiles, and maps evidence across papers.

Evidence remains traceable to the exact text from which it was derived.

### 5. Compare studies

Axorbis constructs:

- paper-level claims;
- cross-paper claims;
- study profiles;
- an evidence matrix;
- research directions with maturity and confidence;
- topic-relative coverage metrics.

This supports comparisons across experimental and evaluation settings.

Direction coverage is calculated as deep-reviewed relevant studies divided by identified relevant studies for that direction. It is independent of raw paper count, so a small direction can still have high coverage. Directions are classified as `established`, `developing`, `emerging`, `sparse`, or `uncertain`.

### 6. Detect and verify research gaps

Sparse combinations are first reported as emerging areas, sparse areas, or underexplored intersections. They are not automatically treated as research gaps. A scoped combination with direct supporting evidence can become a **candidate gap**.

Each candidate gap triggers a targeted counter-search.

A candidate with a completed counter-search may be labeled `no_counterevidence_found` within the recorded providers, queries and search date. This is not a claim that no study exists anywhere. Up to three candidates are checked per run.

If no candidate gap is found, the pipeline may safely finish at:

```text
mapping_complete
```

Otherwise, gap verification is required.

---

## Screening rules

### Gemini screening

General reviews score relevance against the review question and user-defined inclusion/exclusion criteria (`100` explicit yes, `50` uncertain, `0` explicit no). The specialized temporal knowledge-graph template keeps the three-dimension schema below for older and deliberately specialized reviews.

Gemini scope screening uses a strict JSON schema.

For each paper, it returns exactly three numeric relevance scores:

```text
100 = explicit support
50  = unknown or insufficient evidence
0   = explicit contradiction
```

Axorbis maps these values to:

| Score | Decision  |
| ----: | --------- |
| `100` | `YES`     |
|  `50` | `UNKNOWN` |
|   `0` | `NO`      |

In the specialized template, a paper qualifies as `core` only when **all three screening dimensions are `YES`**.

The dimensions are:

1. temporal or dynamic knowledge-graph relevance;
2. explicit inductive or generalization relevance;
3. task relevance.

For example, a temporal knowledge-graph paper that does not provide explicit evidence of inductive or generalization relevance remains `background`.

### Jev AI screening

When Jev AI mode is enabled, Jev reads each paper's title and abstract and assesses the same screening dimensions.

Jev also:

- reassesses papers after full text is retrieved;
- screens new papers discovered during gap counter-search.

### Mechanical protocol checks

The following constraints are applied separately from scientific relevance classification:

- publication year from the requested date range (the current search clients supply year-level metadata);
- language;
- publication type.

These are protocol checks, not regex-based scientific screening.

Axorbis has **no regex paper-classification fallback**. Malformed Gemini screening batches are retried and split; an unresolved single paper remains in `background` for adjudication.

---

## Evidence model

Axorbis separates source retrieval from model interpretation.

### Exact source spans

The extractor preserves exact sentences with neighboring context from the saved:

- full text or
- abstracts.

Each evidence span stores source-relative character offsets.

Candidates across the available source text are assessed in windows of up to 40 sentences. This allows accepted claims to be traced back to the exact source text while reducing the earlier fixed 60-sentence sampling limit. The full-text resolver currently caps parsed text at 100,000 characters per paper.

### Model-assisted evidence classification

Gemini selects relevant extracted spans and classifies:

- evidence type;
- supported dimensions;
- relevance to the review.

Fragments and unsupported promotional claims are rejected.

Every accepted paper claim points to an exact extracted span. Keeping source text lets a reviewer verify its offsets against the local original; choosing deletion retains the selected span and context in `review.json` but removes that local verification path.

### Source levels

Evidence spans the record `source_level`.

Supported levels include:

```text
full_text
abstract
```

The offsets refer to the corresponding saved source.

---

## Evidence strength

Not all source material is treated equally.

### Full text

Full-text passages are considered strong evidence.

They may support:

- detailed experimental claims;
- implementation details;
- evaluation settings;
- comparative findings;
- limitations;
- gap verification.

### Abstracts

Abstract passages provide limited evidence.

They may support explicitly stated:

- tasks;
- methods;
- contributions;
- high-level findings;
- limitations;
- future-work statements.

Abstract-only evidence should not be treated as support for experimental detail that is not explicitly present.

### Metadata-only records

Metadata-only papers remain available for:

- follow-up screening;
- search provenance;
- bibliographic exports.

They do **not** support scientific claims.

A paper is not excluded simply because the full text is unavailable.

If neither the full text nor the abstract provides enough evidence, the record remains available for manual review rather than being automatically excluded.

---

## Evidence matrix

The evidence matrix uses four states:

```text
YES
NO
UNKNOWN
NOT_APPLICABLE
```

Their interpretation is deliberately asymmetric.

### `YES`

Explicit evidence supports the property.

### `NO`

Explicit **full-text** evidence negates the property.

Only explicit full-text negation can produce `NO`.

### `UNKNOWN`

Available evidence is insufficient to determine the property.

Absence of evidence is therefore not treated as negative evidence.

### `NOT_APPLICABLE`

The dimension does not apply to the study or evaluation setting.

This distinction prevents paper silence from being incorrectly interpreted as contradiction.

---

## Cross-paper analysis

Axorbis can compare findings across study settings such as:

- unseen entities vs. unseen relations;
- few-shot vs. zero-history evaluation;
- zero-shot settings;
- cross-domain evaluation;
- out-of-distribution evaluation.

Cross-paper claims describe relationships between grounded paper-level evidence rather than introducing unsupported conclusions.

Evidence requirements depend on claim type: one directly supporting paper is enough for a paper-level observation, repeated findings require multiple studies, and trend or dominance claims require broad corpus evidence. A low paper count does not by itself establish a gap.

---

## Research-gap verification

Candidate gaps are derived from scoped, evidence-supported combinations in the evidence matrix. Every promoted candidate records its claim, supporting evidence, counterevidence, alternative terminology, counter-search provenance, verification status, and confidence.

For every direction or gap, Axorbis reports separate coverage metrics.

### Basic coverage

Evidence from either:

- abstracts or
- full text.

### Deep coverage

Evidence from:

- full text only.

A candidate can receive `no_counterevidence_found` only when:

1. topic-relative deep coverage is sufficient for that candidate;
2. alternative terminology is searched;
3. three alternative-term counter-searches complete across the available arXiv, Semantic Scholar and OpenAlex sources; and
4. no screened counter-paper directly addresses the candidate in the retrieved evidence.

The engine records whether related-work metadata is available, but the post-review citation graph is not a scientific corpus expansion step.

This prevents a gap from being declared solely because relevant evidence was unavailable or missing from abstracts.

Possible outcomes include `already_addressed`, `partially_addressed`, `candidate_gap`, `no_counterevidence_found`, and `inconclusive`. The latter counter-search finding is bounded by the saved search protocol. Emerging and sparse directions remain visible regardless.

---

## Abstract and full-text enrichment

When an abstract is missing, Axorbis attempts enrichment through:

- Semantic Scholar;
- OpenAlex;
- Crossref;
- publisher landing-page metadata.

Evidence availability is assessed only after this enrichment step.

Full texts retrieved during the review are stored locally and used for deeper evidence analysis where available.

---

## Gemini request handling

Selected Gemini API keys are rate-limited throughout a review.

Requests using the selected keys are spaced by at least:

```text
5 seconds
```

API keys are passed from the desktop application to Python through **stdin**.

They are not passed through command-line arguments.

The app monitor reports request counts and reported token usage for each Gemini key.

---

## Review outputs

Every run creates a unique workspace directory:

```text
<slug>-<timestamp>/
```

A review folder contains:

```text
protocol.json
status.json
execution-state.json
review.json
review.md
references.bib
runner.log
gemini-calls.jsonl
run-manifest.json
runtime-manifest.json
search-checkpoint.json
source-text/
```

When source-text retention is set to `keep`, retrieved full texts are stored under:

```text
source-text/*.txt
```

The start form can instead delete `source-text/` after the final report. The selected evidence spans remain in `review.json`, but their offsets cannot subsequently be checked against the retrieved text. A failed run with this setting also removes any downloaded source text; continuing it must fetch that text again.

### `review.json`

`review.json` is the canonical structured result.

It contains:

- search strategy and provenance;
- normalized article records;
- screening results;
- evidence spans;
- study profiles;
- the evidence matrix;
- paper claims;
- cross-paper claims;
- literature landscape and research directions;
- emerging or sparse areas;
- underexplored intersections;
- candidate-gap assessments;
- candidate gaps;
- verified gaps;
- quality metrics;
- pipeline status.

The Markdown report is generated from this structured result. `review_quality` separately reports search completeness, unresolved screening, full-text coverage, evidence coverage and gap-search completeness; `quality_gate.passed` only describes the evidence-production threshold.

### Compatibility aliases

During schema migration, Axorbis maintains compatibility aliases so older review folders and desktop views remain readable.

Current aliases include:

```text
screening_decisions
atomic_claims
research_gaps
quality_gate
```

---

## Run lifecycle

Stopping a review does not discard completed work.

Everything already written to the review folder is preserved.

Starting the review again creates a **new, unique run folder** rather than overwriting the previous one. “Continue” on an interrupted or failed review reuses an identical-protocol checkpoint: completed queries, matching full text, completed screening decisions and saved evidence spans can be reused, while missing or failed work is retried. Synthesis and gap verification are rebuilt. “Run again” on a completed review starts fresh. Editing a question saves a separate next-run draft and does not mutate the historical protocol. `run-manifest.json` and `protocol.json` are immutable snapshots; `execution-state.json` is mutable, while `status.json` remains a compatibility view for the current desktop reader.

---

## Privacy and sensitive data

API credentials are not written to:

- review folders;
- browser storage;
- logs;
- process arguments.

Gemini keys are transferred to Python only through stdin.

### `gemini-calls.jsonl`

The start form offers `full`, `redacted`, and `off` Gemini audit modes. `full` records request and raw response bodies in:

```text
gemini-calls.jsonl
```

This includes failed JSON-generation attempts.

`redacted` keeps call metadata and content hashes; `off` creates no audit entries. Credentials and Authorization headers are not recorded in any mode.

However, request and response bodies may contain paper text or other review content.

**Treat the entire review folder as potentially sensitive research data.**

---

## Development checks

Run the following commands before submitting changes:

```sh
npm run build
npm test
npm run desktop:check
```

---

## License

Axorbis desktop code is released under the **MIT License**.

[SynthScholar](https://github.com/sensein/synthscholar) is an external dependency distributed under the **Apache-2.0 License**.

Refer to the SynthScholar repository for its source code and license terms.
