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

Development uses:

```text
.venv/bin/python
```

For an installed build, set `SYNTHSCHOLAR_PYTHON` to a Python interpreter where `integration/requirements.txt` has been installed.

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
- a publication-date range;
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

Records are merged in the following order:

1. canonical DOI;
2. arXiv ID;
3. normalized exact title;
4. fuzzy title matching with compatible author and publication year.

Records with conflicting canonical identifiers are **never** fuzzy-merged.

### 3. Screen papers

Retrieved records are screened for relevance to the review protocol.

Papers can be classified as:

```text
core
background
exclude
```

Axorbis then enriches relevant records with abstracts and full text where available.

### 4. Map evidence

The pipeline extracts grounded source passages, builds study profiles, and maps evidence across papers.

Evidence remains traceable to the exact text from which it was derived.

### 5. Compare studies

Axorbis constructs:

- paper-level claims;
- cross-paper claims;
- study profiles;
- an evidence matrix;
- coverage metrics.

This supports comparisons across experimental and evaluation settings.

### 6. Detect and verify research gaps

Sparse or unsupported combinations in the evidence matrix can become **candidate gaps**.

Each candidate gap triggers a targeted counter-search.

A candidate gap is promoted to a verified gap only when the evidence and counter-search requirements are satisfied.

If no candidate gap is found, the pipeline may safely finish at:

```text
mapping_complete
```

Otherwise, gap verification is required.

---

## Screening rules

### Gemini screening

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

A paper qualifies as `core` only when **all three screening dimensions are `YES`**.

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

- publication date;
- language;
- publication type.

These are protocol checks, not regex-based scientific screening.

Axorbis has **no regex paper-classification fallback**.

---

## Evidence model

Axorbis separates source retrieval from model interpretation.

### Exact source spans

The extractor preserves exact sentences from the saved:

- full text or
- abstracts.

Each evidence span stores source-relative character offsets.

This allows accepted claims to be traced back to the exact source text.

### Model-assisted evidence classification

Gemini selects relevant extracted spans and classifies:

- evidence type;
- supported dimensions;
- relevance to the review.

Fragments and unsupported promotional claims are rejected.

Every accepted paper claim must still point to an exact saved source span.

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

---

## Research-gap verification

Candidate gaps are derived from sparse combinations in the evidence matrix.

For every gap, Axorbis reports separate coverage metrics.

### Basic coverage

Evidence from either:

- abstracts or
- full text.

### Deep coverage

Evidence from:

- full text only.

A candidate gap can become verified only when:

1. sufficient deep coverage is available; and
2. targeted counter-search validation succeeds.

This prevents a gap from being declared solely because relevant evidence was unavailable or missing from abstracts.

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
review.json
review.md
references.bib
runner.log
gemini-calls.jsonl
source-text/
```

Retrieved full texts are stored under:

```text
source-text/*.txt
```

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
- candidate gaps;
- verified gaps;
- quality metrics;
- pipeline status.

The Markdown report is generated from this structured result.

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

Starting the review again creates a **new, unique run folder** rather than overwriting the previous one.

---

## Privacy and sensitive data

API credentials are not written to:

- review folders;
- browser storage;
- logs;
- process arguments.

Gemini keys are transferred to Python only through stdin.

### `gemini-calls.jsonl`

For debugging and auditability, Axorbis records Gemini request and raw response bodies in:

```text
gemini-calls.jsonl
```

This includes failed JSON-generation attempts.

Credentials and Authorization headers are not recorded.

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
