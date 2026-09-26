"""Conservative Computer Science literature mapping over SynthScholar's OA clients.

Every exported claim is an exact span in a saved source text. Missing evidence
remains visible; this module never upgrades a candidate gap to verified by absence.
"""
from __future__ import annotations

import json
import os
import re
import html
from html.parser import HTMLParser
from urllib.parse import quote
from urllib.parse import unquote
from difflib import SequenceMatcher
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

PROVIDERS = ("arxiv", "semantic_scholar", "openalex", "crossref", "core")
TYPES = {
    "task": ("we address", "we study", "we investigate", "we consider", "we tackle"),
    "method": ("we propose", "we introduce", "our method", "algorithm", "architecture"),
    "finding": ("results show", "experiments show", "we find", "outperform", "improve"),
    "dataset": ("dataset", "benchmark", "corpus"),
    "evaluation": ("evaluate", "evaluation", "experiment", "test set"),
    "metric": ("accuracy", "f1", "mrr", "hits@", "auc", "precision", "recall"),
    "baseline": ("baseline", "compared with", "compare against"),
    "limitation": ("limitation", "limited by", "fails to", "cannot", "however"),
    "failure_mode": ("failure mode", "fails when", "degrades", "breaks down"),
    "future_work": ("future work", "future research", "remains open"),
    "reproducibility": ("code is available", "open source", "random seed", "multiple seeds"),
    "efficiency": ("runtime", "computational cost", "memory usage", "latency", "complexity"),
}
ABSTRACT_TYPES = {"task", "method", "finding", "limitation", "future_work"}
ABSTRACT_MARKERS = {
    "task": ("we address", "we study", "we investigate", "we consider", "we tackle", "we focus on"),
    "method": ("we propose", "we introduce", "we present", "our method", "our model", "our approach"),
    "finding": ("results show", "experiments show", "we find", "we demonstrate", "outperform", "improve"),
    "limitation": ("limitation", "limited by", "fails to", "cannot"),
    "future_work": ("future work", "future research", "remains open", "future directions"),
}
DIMENSIONS = ("zero-shot", "few-shot", "out-of-distribution", "cross-domain", "unseen entities", "unseen relations", "temporal extrapolation", "ablation", "multiple seeds", "statistical significance", "code available")
METHOD_FAMILIES = {
    "rule-based": ("rule-based", "logical rule", "rule learning"),
    "path-based": ("path-based", "path reasoning"),
    "graph neural network": ("graph neural network", "gnn", "graph convolution"),
    "transformer": ("transformer", "self-attention"),
    "meta-learning": ("meta-learning", "meta learning"),
    "foundation or language model": ("large language model", "foundation model", "llm"),
}
COUNTER_TERMS = {"zero-shot": ("zero-shot", "cold start", "no historical observations"),
                 "few-shot": ("few-shot", "low resource", "few examples"),
                 "unseen entities": ("unseen entities", "new entities", "inductive entities"),
                 "cross-domain": ("cross-domain", "domain transfer", "domain adaptation"),
                 "out-of-distribution": ("out-of-distribution", "distribution shift", "OOD")}


def words(text):
    stop = {"the", "and", "for", "with", "from", "what", "how", "does", "are", "can", "into", "using", "review", "research", "study"}
    return set(re.findall(r"[\w-]{3,}", text.casefold())) - stop


def concepts_from_input(protocol):
    topic = (protocol.get("objective") or protocol.get("title") or "").strip()
    explicit = [part.strip() for part in re.split(r"[,;\n]", protocol.get("core_concepts", "")) if part.strip()]
    if explicit:
        core = explicit
    else:
        lowered = topic.casefold()
        # Keep a useful deterministic profile when the optional model call is absent.
        core = []
        if any(term in lowered for term in ("knowledge graph", "knowledge-graph", "kg ")):
            if any(term in lowered for term in ("temporal", "dynamic", "time-evolving")):
                core.append("temporal knowledge graph")
            else:
                core.append("knowledge graph")
        if any(term in lowered for term in ("inductive", "generaliz", "unseen", "few-shot", "zero-shot")):
            core.append("inductive reasoning")
        if not core:
            core = [topic]
    related = [part.strip() for part in re.split(r"[,;\n]", protocol.get("related_concepts", "")) if part.strip()]
    if not related and "temporal knowledge graph" in core and "inductive reasoning" in core:
        related = ["unseen entities", "generalization", "few-shot", "zero-shot", "extrapolation"]
    return {"domain": "computer_science", "topic": topic, "core_concepts": core, "related_concepts": related,
            "date_range_start": protocol.get("date_range_start", ""), "date_range_end": protocol.get("date_range_end", "")}


def search_strategy(concepts):
    core = concepts["core_concepts"]
    related = concepts["related_concepts"]
    base = " ".join(core)
    expanded = [f"{base} {term}" for term in related]
    expanded.extend(f"{left} {right}" for left in core for right in related)
    expanded.extend(f"{left} {right}" for left in core for right in core if left != right)
    queries = list(dict.fromkeys([base, *core, *expanded]))[:12]
    return {
        "arxiv": queries,
        "semantic_scholar": queries,
        "openalex": queries,
        "crossref": queries,
        "core": queries,
    }


def article_key(publication):
    doi = normalize_doi(getattr(publication, "doi", ""))
    ids = getattr(publication, "external_ids", {}) or {}
    arxiv = normalize_arxiv(ids.get("arXiv", ""))
    title = normalize_title(publication.title)
    return "doi:" + doi if doi else "arxiv:" + arxiv if arxiv else "title:" + title


def normalize_doi(value):
    return re.sub(r"^doi:\s*", "", unquote(str(value or "").strip().lower().removeprefix("https://doi.org/").removeprefix("http://doi.org/"))).rstrip(" .,;")


def normalize_arxiv(value):
    normalized = str(value or "").strip().lower().removeprefix("https://arxiv.org/abs/").removeprefix("arxiv:")
    return re.sub(r"v\d+$", "", normalized)


def normalize_title(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").casefold())


def find_duplicate(corpus, publication):
    doi = normalize_doi(getattr(publication, "doi", ""))
    arxiv = normalize_arxiv((getattr(publication, "external_ids", {}) or {}).get("arXiv", ""))
    if doi:
        match = next((key for key, item in corpus.items() if normalize_doi(item.get("doi")) == doi), None)
        if match:
            return match
    if arxiv:
        match = next((key for key, item in corpus.items() if normalize_arxiv(item.get("arxiv_id")) == arxiv), None)
        if match:
            return match
    title = normalize_title(getattr(publication, "title", ""))
    if title:
        match = next((key for key, item in corpus.items() if normalize_title(item.get("title")) == title), None)
        if match:
            return match
    year = str(getattr(publication, "year", "") or "")[:4]
    authors = {re.sub(r"[^a-z]", "", str(a).split()[-1].casefold()) for a in (getattr(publication, "authors", []) or []) if str(a).strip()}
    if title and year and authors:
        return next((key for key, item in corpus.items()
                     if year == str(item.get("year", "") or "")[:4]
                     and bool(authors & {re.sub(r"[^a-z]", "", str(a).split()[-1].casefold()) for a in (item.get("authors", []) or []) if str(a).strip()})
                     and SequenceMatcher(None, title, normalize_title(item.get("title"))).ratio() >= 0.94), None)
    return None


def _plain_abstract(value):
    if not isinstance(value, str):
        return ""
    value = re.sub(r"<[^>]+>", " ", html.unescape(value))
    return re.sub(r"\s+", " ", value).strip()


def _publisher_abstract(markup):
    class MetadataParser(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.candidates = []

        def handle_starttag(self, tag, attrs):
            if tag.casefold() != "meta":
                return
            fields = {str(key).casefold(): str(value or "") for key, value in attrs}
            name = (fields.get("name") or fields.get("property") or fields.get("itemprop") or "").casefold()
            if name in {"citation_abstract", "dc.description", "description", "og:description", "abstract"}:
                self.candidates.append(fields.get("content", ""))

    parser = MetadataParser()
    try:
        parser.feed(markup)
    except Exception:
        return ""
    return max((_plain_abstract(value) for value in parser.candidates), key=len, default="")


def _openalex_abstract(index):
    if not isinstance(index, dict):
        return ""
    tokens = {}
    for token, positions in index.items():
        if isinstance(positions, list):
            for position in positions:
                if isinstance(position, int) and position >= 0:
                    tokens[position] = token
    return " ".join(tokens[position] for position in sorted(tokens))


def _metadata_match(record, article):
    if not isinstance(record, dict):
        return False
    expected = normalize_title(article.get("title"))
    title = record.get("title")
    if isinstance(title, list):
        title = title[0] if title else ""
    actual = normalize_title(title)
    if not expected or not actual:
        return False
    if expected == actual:
        return True
    return SequenceMatcher(None, expected, actual).ratio() >= 0.92


def enrich_abstract(article, transport=None, timeout=6, semantic_scholar_api_key=""):
    """Try public scholarly metadata sources before treating an abstract as absent."""
    import httpx

    doi = normalize_doi(article.get("doi"))
    title = str(article.get("title") or "").strip()
    headers = {"User-Agent": "AxorbisLiteratureReview/0.1", "Accept": "application/json"}
    if semantic_scholar_api_key:
        headers["x-api-key"] = semantic_scholar_api_key
    email = os.environ.get("SYNTHSCHOLAR_EMAIL", "").strip()
    attempts = []
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers, transport=transport) as client:
        # Prefer provider APIs with DOI or exact-title lookup. Stop once an
        # abstract is recovered so public services are not queried needlessly.
        try:
            params = {"fields": "title,abstract,year,externalIds"}
            if doi:
                url = f"https://api.semanticscholar.org/graph/v1/paper/DOI:{quote(doi, safe='')}"
                response = client.get(url, params=params)
                record = response.json() if response.status_code == 200 else {}
            else:
                response = client.get("https://api.semanticscholar.org/graph/v1/paper/search", params={**params, "query": title, "limit": 5})
                records = response.json().get("data", []) if response.status_code == 200 else []
                record = next((item for item in records if _metadata_match(item, article)), {})
            response.raise_for_status()
            candidate = _plain_abstract(record.get("abstract")) if _metadata_match(record, article) else ""
            attempts.append({"source": "semantic_scholar", "status": "found" if candidate else "no_match"})
            if candidate:
                return {"abstract": candidate, "source": "semantic_scholar", "attempts": attempts}
        except Exception as error:
            attempts.append({"source": "semantic_scholar", "status": type(error).__name__})

        try:
            params = {"mailto": email} if email else {}
            if doi:
                response = client.get(f"https://api.openalex.org/works/https://doi.org/{quote(doi, safe='')}", params=params)
                record = response.json() if response.status_code == 200 else {}
            else:
                response = client.get("https://api.openalex.org/works", params={**params, "search": title, "per-page": 5})
                records = response.json().get("results", []) if response.status_code == 200 else []
                record = next((item for item in records if _metadata_match(item, article)), {})
            response.raise_for_status()
            candidate = _openalex_abstract(record.get("abstract_inverted_index")) if _metadata_match(record, article) else ""
            attempts.append({"source": "openalex", "status": "found" if candidate else "no_match"})
            if candidate:
                return {"abstract": candidate, "source": "openalex", "attempts": attempts}
        except Exception as error:
            attempts.append({"source": "openalex", "status": type(error).__name__})

        try:
            params = {"mailto": email} if email else {}
            if doi:
                response = client.get(f"https://api.crossref.org/works/{quote(doi, safe='')}", params=params)
                record = response.json().get("message", {}) if response.status_code == 200 else {}
            else:
                response = client.get("https://api.crossref.org/works", params={**params, "query.title": title, "rows": 5})
                records = response.json().get("message", {}).get("items", []) if response.status_code == 200 else []
                record = next((item for item in records if _metadata_match(item, article)), {})
            response.raise_for_status()
            candidate = _plain_abstract(record.get("abstract")) if _metadata_match(record, article) else ""
            attempts.append({"source": "crossref", "status": "found" if candidate else "no_match"})
            if candidate:
                return {"abstract": candidate, "source": "crossref", "attempts": attempts}
        except Exception as error:
            attempts.append({"source": "crossref", "status": type(error).__name__})

        # Publisher landing pages commonly expose citation_abstract/DC metadata
        # even when their full text is paywalled. Only resolve validated DOIs.
        if doi:
            try:
                response = client.get(f"https://doi.org/{quote(doi, safe='/')}", headers={"Accept": "text/html"})
                response.raise_for_status()
                candidate = _publisher_abstract(response.text)
                attempts.append({"source": "publisher_metadata", "status": "found" if candidate else "no_match", "url": str(response.url)})
                if candidate:
                    return {"abstract": candidate, "source": "publisher_metadata", "attempts": attempts}
            except Exception as error:
                attempts.append({"source": "publisher_metadata", "status": type(error).__name__})
    return {"abstract": "", "source": "", "attempts": attempts}


def enrich_missing_abstracts(articles, enricher=enrich_abstract, update=lambda *_: None):
    missing = [article for article in articles if not str(article.get("abstract") or "").strip()]
    if not missing:
        return
    update("abstract_enrichment", f"Checking scholarly metadata for abstracts: {len(missing)} records")
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(enricher, article): article for article in missing}
        for future in as_completed(futures):
            article = futures[future]
            try:
                result = future.result() or {}
            except Exception as error:
                result = {"abstract": "", "source": "", "attempts": [{"source": "enrichment", "status": type(error).__name__}]}
            abstract = _plain_abstract(result.get("abstract"))
            if abstract:
                article["abstract"] = abstract
                article["abstract_source"] = str(result.get("source") or "metadata")
            article["abstract_enrichment"] = {
                "status": "found" if abstract else "not_found",
                "attempts": result.get("attempts", []),
            }
            update("abstract_enrichment", f'Abstract {"enriched" if abstract else "not found"}: {article["id"]}')


def screen(article, concepts):
    title = str(article.get("title") or "").casefold()
    abstract = str(article.get("abstract") or "").casefold()
    source = f"{title} {abstract}"
    graph = bool(re.search(r"\bknowledge[- ]graph(s)?\b|\bkgc?\b", source))
    temporal = bool(re.search(r"\b(temporal|temporalized|time[- ]evolving|dynamic)\b", source))
    temporal_central = temporal and graph and bool(re.search(r"\b(temporal|dynamic|time[- ]evolving)\b.{0,80}\b(graph|kg)\b|\b(graph|kg)\b.{0,80}\b(temporal|dynamic|time[- ]evolving)\b", source))
    inductive = bool(re.search(r"\b(induct\w*|generaliz\w*|unseen entities|new entities|out[- ]of[- ]distribution|few[- ]shot|zero[- ]shot)\b", source))
    task = bool(re.search(r"\b(reason\w*|complet\w*|link predict\w*|inference|query answer\w*)\b", source))
    checks = [
        ("Knowledge graph study", graph, "Knowledge graph terminology in title/abstract"),
        ("Temporal/dynamic knowledge graph is central", temporal_central, "Temporal/dynamic KG framing in title/abstract/full text"),
        ("Inductive/generalization setting", inductive, "Inductive or generalization terminology in title/abstract"),
        ("Relevant reasoning/completion task", task, "Reasoning/completion task in title/abstract"),
    ]
    criteria = []
    for name, passed, evidence in checks:
        # Missing a statement in an abstract is not evidence that the study
        # failed the criterion. Keep it unresolved until full text or review.
        decision = "yes" if passed else "unknown"
        criteria.append({"criterion": name, "decision": decision,
                         "evidence": evidence if passed else "Insufficient title/abstract evidence" if decision == "unknown" else "Required evidence absent from title/abstract"})
    date_start = str(concepts.get("date_range_start") or "").strip()
    date_end = str(concepts.get("date_range_end") or "").strip()
    year_match = re.search(r"\d{4}", str(article.get("year") or ""))
    if date_start or date_end:
        year = int(year_match.group()) if year_match else None
        start = int(date_start[:4]) if date_start[:4].isdigit() else None
        end = int(date_end[:4]) if date_end[:4].isdigit() else None
        in_range = year is not None and (start is None or year >= start) and (end is None or year <= end)
        criteria.append({"criterion": "Publication date range", "decision": "yes" if in_range else "no", "evidence": str(year) if in_range else "Year missing or outside protocol date range"})
    if all(item["decision"] == "yes" for item in criteria):
        final, reason = "include", "All required criteria met"
    elif not any(item["decision"] == "no" for item in criteria):
        final, reason = "manual_review", "Required evidence is incomplete; record retained for full-text screening or review"
    else:
        final, reason = "exclude", "One or more required criteria not met"
    return {"article_id": article["id"], "criteria": criteria, "decision": final, "reason": reason}


def extract_spans(article_id, source, source_level="full_text"):
    spans = []
    for match in re.finditer(r"[^.!?\n]+(?:[.!?]|$)", source):
        exact = match.group().strip()
        if len(exact) < 60 or len(words(exact)) < 8:
            continue
        lowered = exact.casefold()
        markers_by_type = ABSTRACT_MARKERS if source_level == "abstract" else TYPES
        kind = next((kind for kind, markers in markers_by_type.items() if any(marker in lowered for marker in markers)), None)
        if not kind:
            continue
        if source_level == "abstract" and kind not in ABSTRACT_TYPES:
            continue
        offset = source.find(exact, match.start(), match.end() + 1)
        if offset < 0:
            continue
        spans.append({"id": f"E-{article_id}-{len(spans)+1}", "article_id": article_id, "section": source_level, "source_level": source_level,
                      "evidence_strength": "strong" if source_level == "full_text" else "limited" if source_level == "abstract" else "bibliographic",
                      "exact_text": exact, "start_position": offset, "end_position": offset + len(exact), "evidence_type": kind, "grounded": True})
        if len(spans) >= 30:
            break
    return spans


def build_outputs(corpus, screening, spans, strategy, records, failures, searched_at):
    included = [a for a in corpus if a["screening_decision"] == "include"]
    with_full = [a for a in included if a["text_status"] == "full_text"]
    basic_spans = [span for span in spans if span.get("source_level") in ("abstract", "full_text")]
    deep_spans = [span for span in spans if span.get("source_level") == "full_text"]
    basic_ids = {span["article_id"] for span in basic_spans}
    deep_ids = {span["article_id"] for span in deep_spans}
    basic_coverage = len(basic_ids) / len(included) if included else 0
    deep_coverage = len(deep_ids) / len(included) if included else 0
    deep_sufficient = len(deep_ids) >= 3 and deep_coverage >= 0.5 and len(deep_spans) >= 6
    quality = {"included_papers": len(included), "full_text_available": len(with_full),
               "studies_with_grounded_evidence": len(basic_ids), "studies_with_basic_evidence": len(basic_ids),
               "studies_with_deep_evidence": len(deep_ids), "basic_evidence_coverage": round(basic_coverage, 3),
               "deep_evidence_coverage": round(deep_coverage, 3), "evidence_coverage": round(basic_coverage, 3),
               "grounded_evidence_spans": len(basic_spans), "deep_evidence_spans": len(deep_spans),
               "deep_evidence_sufficient": deep_sufficient, "search_failures": failures,
               "passed": len(basic_ids) >= 3 and basic_coverage >= 0.5 and len(basic_spans) >= 6}
    stages = {"search": "search_complete" if corpus else "search_failed",
              "screening": "screening_complete" if screening else "not_started",
              "fulltext": "fulltext_resolution_complete" if included and all(a["text_status"] != "unavailable" for a in included) else "insufficient_fulltext",
              "evidence": "evidence_extraction_complete" if spans else "insufficient_evidence",
              "mapping": "mapping_complete" if quality["passed"] else "not_started",
              "gap_analysis": "not_started", "gap_verification": "not_started", "synthesis": "not_started"}
    profiles = []
    matrix = []
    for article in included:
        own = [e for e in spans if e["article_id"] == article["id"]]
        profile = {"article_id": article["id"], "task": "", "problem_setting": "", "method_family": "", "main_contribution": "",
                   "datasets": [], "baselines": [], "evaluation_metrics": [], "generalization_setting": [], "reported_limitations": [], "future_work": [],
                   "train_validation_test_split": "not_assessed", "ablation_available": "not_assessed", "multiple_seeds": "not_assessed",
                   "statistical_testing": "not_assessed", "robustness_testing": "not_assessed", "computational_cost": "not_assessed",
                   "code_available": "not_assessed", "dataset_available": "not_assessed",
                   "evidence_ids": [e["id"] for e in own]}
        for e in own:
            field = {"task": "task", "method": "main_contribution", "limitation": "reported_limitations", "future_work": "future_work", "dataset": "datasets", "baseline": "baselines", "metric": "evaluation_metrics"}.get(e["evidence_type"])
            if field:
                if isinstance(profile[field], list): profile[field].append({"text": e["exact_text"], "evidence_id": e["id"]})
                elif not profile[field]: profile[field] = e["exact_text"]
            if e["evidence_type"] == "method" and not profile["method_family"]:
                lowered = e["exact_text"].casefold()
                profile["method_family"] = next((family for family, markers in METHOD_FAMILIES.items() if any(marker in lowered for marker in markers)), "")
        profiles.append(profile)
        row = {"article_id": article["id"], "dimensions": {}}
        for dimension in DIMENSIONS:
            hits = [e["id"] for e in own if e.get("source_level") == "full_text" and dimension in e["exact_text"].casefold()]
            row["dimensions"][dimension] = {"value": "reported" if hits else "not_assessed", "evidence_ids": hits}
        matrix.append(row)
    claims = []
    if quality["passed"]:
        for span in spans:
            if span["evidence_type"] in ("finding", "limitation", "failure_mode", "method"):
                claims.append({"id": f"C-{len(claims)+1}", "statement": span["exact_text"], "claim_type": span["evidence_type"],
                               "supporting_evidence_ids": [span["id"]], "contradicting_evidence_ids": [], "supporting_studies": [span["article_id"]],
                               "confidence": "single_source", "evidence_strength": span.get("evidence_strength", "strong")})
    taxonomy = {"by_venue": {}, "by_method_family": {}}
    for article in included:
        taxonomy["by_venue"].setdefault(article["venue"] or "Unknown", []).append(article["id"])
    for profile in profiles:
        taxonomy["by_method_family"].setdefault(profile["method_family"] or "Unclassified", []).append(profile["article_id"])
    return {"schema": "cs_literature_intelligence_v2", "searched_at": searched_at, "search_strategy": strategy,
            "search_provenance": records, "articles": corpus, "screening_decisions": screening, "evidence_spans": spans,
            "quality_gate": quality, "study_profiles": profiles, "evidence_matrix": matrix, "atomic_claims": claims,
            "stage_statuses": stages,
            "research_taxonomy": taxonomy, "research_gaps": [], "citation_expansion_history": [],
            "gap_verification": {"status": "not_run", "reason": "No grounded cross-study gap candidate was established."},
            "pipeline_status": "insufficient_evidence" if not quality["passed"] else "mapping_complete"}


def report(data):
    q = data["quality_gate"]
    lines = ["# Computer Science literature map", "", f'Status: **{data["pipeline_status"]}**', "",
             f'Included studies: {q["included_papers"]}; full texts: {q["full_text_available"]}; studies with basic evidence: {q["studies_with_basic_evidence"]}; basic coverage: {q["basic_evidence_coverage"]:.1%}; deep coverage: {q["deep_evidence_coverage"]:.1%}.', "",
             "## Traceable claims", ""]
    if data["atomic_claims"]:
        for claim in data["atomic_claims"]:
            lines.append(f'- {claim["statement"]} [{claim["id"]} → {claim["supporting_evidence_ids"][0]} → {claim["supporting_studies"][0]}]')
    else:
        lines.append("No claims passed the evidence gate.")
    lines += ["", "## Research gaps", ""]
    if data["research_gaps"]:
        for gap in data["research_gaps"]:
            evidence_ids = gap.get("supporting_evidence_ids", [])
            query_sources = ", ".join(row["provider"] for row in gap.get("counter_queries", [])) or "not run"
            lines.append(f'- [{gap["verification_status"]}] {gap["statement"]} Evidence: {", ".join(evidence_ids) or "none"}. Counter-search: {query_sources}.')
    else:
        lines.append("No verified research gaps. Absence from this corpus is not evidence of an open problem.")
    lines += ["", "## Sources", ""]
    lines += [f'- {a["title"]} ({a["year"]}) — {a["source"]}; {a["doi"] or a["source_url"]} [{a["screening_decision"]}]' for a in data["articles"] if a["screening_decision"] in ("include", "manual_review")]
    return "\n".join(lines) + "\n"


def bibtex(articles):
    entries = []
    for a in articles:
        if a["screening_decision"] not in ("include", "manual_review"): continue
        key = re.sub(r"\W+", "", a["id"])[:40]
        escape = lambda value: str(value).replace("{", "").replace("}", "")
        entries.append(f'@article{{{key},\n  title = {{{escape(a["title"])}}},\n  author = {{{escape(a["authors"])}}},\n  year = {{{escape(a["year"])}}},\n  doi = {{{escape(a["doi"])}}}\n}}')
    return "\n\n".join(entries) + "\n"


def run(protocol, max_results, run_dir: Path, update, openalex_api_key="", provider_keys=None, model_assist=None, fetcher=None, resolver=None, abstract_enricher=None):
    from synthscholar.clients import FullTextResolver, OAFetcher
    from synthscholar.models import Article
    fetcher = fetcher or OAFetcher(api_keys=provider_keys or {})
    resolver = resolver or FullTextResolver(api_keys=provider_keys or {})
    if openalex_api_key:
        for provider in (fetcher.providers.get("openalex"), resolver.openalex):
            if provider: provider._session.headers["Authorization"] = f"Bearer {openalex_api_key}"
    concepts = concepts_from_input(protocol)
    if model_assist:
        update("query_understanding", "Profiling research concepts with the selected Gemini key")
        try:
            proposed = model_assist(
                "For this Computer Science research topic, identify concise search concepts. "
                "Return JSON with core_concepts and related_concepts arrays of short strings. "
                "Topic: " + concepts["topic"][:500]
            )
            if isinstance(proposed, dict):
                def cleaned(name):
                    values = proposed.get(name)
                    return [value.strip() for value in values[:6] if isinstance(value, str) and 2 <= len(value.strip()) <= 100] if isinstance(values, list) else []
                if not str(protocol.get("core_concepts") or "").strip() and cleaned("core_concepts"):
                    concepts["core_concepts"] = cleaned("core_concepts")
                if not str(protocol.get("related_concepts") or "").strip() and cleaned("related_concepts"):
                    concepts["related_concepts"] = cleaned("related_concepts")
                concepts["model_assisted"] = True
        except Exception as error:
            update("query_understanding", f'AI concept profiling unavailable: {type(error).__name__}')
    strategy = search_strategy(concepts)
    searched_at = datetime.now(timezone.utc).isoformat()
    update("searching", "Searching Computer Science sources")
    corpus_by_key, records, failures = {}, [], 0
    for provider_name, queries in strategy.items():
        provider = fetcher.providers.get(provider_name)
        if not provider: continue
        for query in queries:
            record = {"provider": provider_name, "query": query, "searched_at": searched_at, "records": 0, "error": ""}
            try:
                publications = provider.search(query, limit=max_results)
                record["records"] = len(publications)
                for pub in publications:
                    key = article_key(pub)
                    matched_key = find_duplicate(corpus_by_key, pub)
                    if matched_key is not None:
                        key = matched_key
                        merged = corpus_by_key[key]
                        if not merged.get("doi") and getattr(pub, "doi", ""):
                            merged["doi"] = pub.doi
                        if not merged.get("arxiv_id"):
                            merged["arxiv_id"] = (pub.external_ids or {}).get("arXiv", "")
                        if not merged.get("abstract") and getattr(pub, "abstract", ""):
                            merged["abstract"] = pub.abstract
                            merged["abstract_source"] = provider_name
                            merged["abstract_enrichment"] = {"status": "available_from_search", "attempts": []}
                        if provider_name not in merged.setdefault("sources", [merged["source"]]):
                            merged["sources"].append(provider_name)
                    else:
                        article = pub.to_article()
                        corpus_by_key[key] = {"id": f"A-{len(corpus_by_key)+1}", "pmid": article.pmid, "title": article.title, "abstract": article.abstract,
                                              "authors": article.authors, "year": article.year, "venue": article.journal, "doi": article.doi,
                                              "arxiv_id": (pub.external_ids or {}).get("arXiv", ""), "source": provider_name, "source_url": pub.url or "",
                                              "pdf_url": pub.pdf_url or "", "citation_count": pub.citations, "references": [], "cited_by": [], "search_queries": [], "sources": [provider_name],
                                              "abstract_source": provider_name if article.abstract else "", "abstract_enrichment": {"status": "available_from_search" if article.abstract else "not_attempted", "attempts": []},
                                              "text_status": "metadata_only", "screening_decision": "pending"}
                    corpus_by_key[key]["search_queries"].append({"provider": provider_name, "query": query})
            except Exception as error:
                failures += 1
                record["error"] = type(error).__name__
            records.append(record)
            update("searching", f'{provider_name}: {record["records"]} records')
    corpus = list(corpus_by_key.values())
    update("search_complete", f'Search complete: {len(corpus)} unique records')
    if abstract_enricher is None:
        semantic_scholar_key = (provider_keys or {}).get("semantic_scholar", "")
        abstract_enricher = lambda article: enrich_abstract(article, semantic_scholar_api_key=semantic_scholar_key)
    enrich_missing_abstracts(corpus, enricher=abstract_enricher, update=update)
    decisions = []
    for item in corpus:
        decision = screen(item, concepts)
        item["screening_decision"] = decision["decision"]
        decisions.append(decision)
    def save_snapshot():
        snapshot = build_outputs(corpus, decisions, spans, strategy, records, failures, searched_at)
        snapshot["query_understanding"] = concepts
        (run_dir / "review.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
        (run_dir / "review.md").write_text(report(snapshot), encoding="utf-8")
        (run_dir / "references.bib").write_text(bibtex(corpus), encoding="utf-8")

    spans = []
    save_snapshot()
    update("screening_complete", f'Screened {len(corpus)} unique records')
    sources_dir = run_dir / "source-text"
    for item in [a for a in corpus if a["screening_decision"] in ("include", "manual_review")]:
        upstream = Article(pmid=item["pmid"], title=item["title"], abstract=item["abstract"], doi=item["doi"], source=item["source"])
        try:
            source = resolver.resolve(upstream) or ""
            if not source and item["source"] == "arxiv" and item["pdf_url"].startswith("https://arxiv.org/pdf/"):
                import httpx
                with httpx.Client(timeout=45, follow_redirects=True) as client:
                    response = client.get(item["pdf_url"])
                    response.raise_for_status()
                    if len(response.content) <= 25_000_000:
                        source = resolver.pdf_parser.parse_bytes(response.content) or ""
        except Exception:
            source = ""
        if source:
            item["text_status"] = "full_text"
            sources_dir.mkdir(exist_ok=True)
            filename = f'{item["id"]}.txt'
            (sources_dir / filename).write_text(source, encoding="utf-8")
            item["source_text_file"] = f"source-text/{filename}"
            if item["screening_decision"] == "manual_review":
                full_text_decision = screen({**item, "abstract": f'{item["abstract"]}\n{source}'}, concepts)
                if full_text_decision["decision"] == "include":
                    item["screening_decision"] = "include"
                    full_text_decision["reason"] = "Core concepts confirmed in full text"
                    full_text_decision["stage"] = "full_text"
                    decisions.append(full_text_decision)
            if item["screening_decision"] == "include":
                spans += extract_spans(item["id"], source, "full_text")
        else:
            item["text_status"] = "abstract_only" if item["abstract"] else "metadata_only"
        if item["screening_decision"] == "include" and item.get("abstract"):
            existing_text = {re.sub(r"\W+", "", span["exact_text"].casefold()) for span in spans if span["article_id"] == item["id"]}
            spans.extend(span for span in extract_spans(item["id"], item["abstract"], "abstract")
                         if re.sub(r"\W+", "", span["exact_text"].casefold()) not in existing_text)
        save_snapshot()
        update("fulltext_resolution_complete", f'Full text: {item["id"]} {item["text_status"]}')
    update("evidence_extraction_complete", f'Grounded spans: {len(spans)}')
    data = build_outputs(corpus, decisions, spans, strategy, records, failures, searched_at)
    data["query_understanding"] = concepts
    targets = [term for term in concepts["related_concepts"] if any(dimension in term.casefold() for dimension in DIMENSIONS)]
    if targets:
        target = targets[0]
        alternatives = next((values for name, values in COUNTER_TERMS.items() if name in target.casefold()), (target, target, target))
        deep_spans = [span for span in spans if span.get("source_level") == "full_text"]
        deep_sources = []
        for article in corpus:
            source_file = article.get("source_text_file")
            if article.get("screening_decision") == "include" and source_file:
                try:
                    deep_sources.append((run_dir / source_file).read_text(encoding="utf-8").casefold())
                except OSError:
                    continue
        observed = any(term.casefold() in source_text for term in alternatives for source_text in deep_sources)
        deep_claims = [claim for claim in data["atomic_claims"]
                       if any(span["id"] in claim["supporting_evidence_ids"] and span.get("source_level") == "full_text" for span in spans)]
        claim_studies = {study for claim in deep_claims for study in claim["supporting_studies"]}
        explicit_abstract_support = [span for span in spans
                                     if span.get("source_level") == "abstract"
                                     and span.get("evidence_type") in ("limitation", "future_work")
                                     and any(term.casefold() in span["exact_text"].casefold() for term in alternatives)]
        if not data["quality_gate"]["deep_evidence_sufficient"] or len(claim_studies) < 2:
            if explicit_abstract_support:
                data["research_gaps"] = [{"id": "G-1", "gap_type": "evaluation_gap",
                    "statement": f'An abstract explicitly identifies a limitation or future direction related to {target}; full-text evidence is insufficient to verify it.',
                    "supporting_claim_ids": [], "supporting_evidence_ids": [span["id"] for span in explicit_abstract_support],
                    "contradicting_claim_ids": [], "affected_studies": sorted({span["article_id"] for span in explicit_abstract_support}),
                    "missing_dimension": target, "proposed_research_question": f'How can {concepts["topic"]} be evaluated for {target}?',
                    "verification_status": "abstract_supported", "evidence_basis": "abstract_only", "confidence": "low",
                    "possible_counterpaper_ids": [], "counter_queries": []}]
                data["gap_verification"] = {"status": "abstract_supported", "reason": "Explicit abstract passage; full-text threshold not met."}
                data["stage_statuses"]["gap_analysis"] = "gap_analysis_complete"
                data["stage_statuses"]["gap_verification"] = "incomplete"
            else:
                data["gap_verification"] = {"status": "not_run", "reason": "Insufficient full-text evidence; abstract absence is not treated as a research gap."}
        elif not observed and len(claim_studies) >= 2:
            update("gap_analysis_complete", f'Checking candidate missing dimension: {target}')
            base_query = " ".join(concepts["core_concepts"])
            counter_records = []
            possible_counterpapers = []
            for provider_index, provider_name in enumerate(("arxiv", "semantic_scholar", "openalex")):
                provider = fetcher.providers.get(provider_name)
                if not provider:
                    continue
                counter_query = f'{base_query} {alternatives[provider_index % len(alternatives)]}'
                record = {"provider": provider_name, "query": counter_query, "query_kind": "gap_counter_search",
                          "searched_at": datetime.now(timezone.utc).isoformat(), "records": 0, "error": ""}
                try:
                    publications = provider.search(counter_query, limit=min(max_results, 10))
                    record["records"] = len(publications)
                    for pub in publications:
                        key = article_key(pub)
                        if key not in corpus_by_key:
                            upstream = pub.to_article()
                            counter_abstract = upstream.abstract or ""
                            counter_abstract_source = provider_name if counter_abstract else ""
                            counter_enrichment = {"status": "available_from_search" if counter_abstract else "not_attempted", "attempts": []}
                            if not counter_abstract:
                                metadata = {"id": f"A-{len(corpus_by_key)+1}", "title": upstream.title, "abstract": "",
                                            "year": upstream.year, "doi": upstream.doi}
                                try:
                                    enriched = abstract_enricher(metadata) or {}
                                    counter_abstract = _plain_abstract(enriched.get("abstract"))
                                    counter_abstract_source = str(enriched.get("source") or "")
                                    counter_enrichment = {"status": "found" if counter_abstract else "not_found", "attempts": enriched.get("attempts", [])}
                                except Exception as error:
                                    counter_enrichment = {"status": "not_found", "attempts": [{"source": "enrichment", "status": type(error).__name__}]}
                            upstream = Article(pmid=upstream.pmid, title=upstream.title, abstract=counter_abstract,
                                               doi=upstream.doi, source=upstream.source)
                            item = {"id": f"A-{len(corpus_by_key)+1}", "pmid": upstream.pmid, "title": upstream.title,
                                    "abstract": upstream.abstract, "authors": upstream.authors, "year": upstream.year,
                                    "venue": upstream.journal, "doi": upstream.doi, "arxiv_id": (pub.external_ids or {}).get("arXiv", ""),
                                    "source": provider_name, "source_url": pub.url or "", "pdf_url": pub.pdf_url or "",
                                    "citation_count": pub.citations, "references": [], "cited_by": [], "search_queries": [],
                                    "text_status": "metadata_only", "screening_decision": "pending",
                                    "abstract_source": counter_abstract_source, "abstract_enrichment": counter_enrichment}
                            corpus_by_key[key] = item
                            corpus.append(item)
                            decision = screen(item, concepts)
                            item["screening_decision"] = decision["decision"]
                            decision["stage"] = "gap_counter_search"
                            decisions.append(decision)
                            if item["screening_decision"] in ("include", "manual_review"):
                                try:
                                    source = resolver.resolve(upstream) or ""
                                except Exception:
                                    source = ""
                                if source:
                                    item["text_status"] = "full_text"
                                    sources_dir.mkdir(exist_ok=True)
                                    (sources_dir / f'{item["id"]}.txt').write_text(source, encoding="utf-8")
                                    item["source_text_file"] = f'source-text/{item["id"]}.txt'
                                    if item["screening_decision"] == "manual_review":
                                        full_decision = screen({**item, "abstract": f'{item["abstract"]}\n{source}'}, concepts)
                                        if full_decision["decision"] == "include":
                                            item["screening_decision"] = "include"
                                            full_decision["stage"] = "full_text"
                                            decisions.append(full_decision)
                                    if item["screening_decision"] == "include":
                                        spans += extract_spans(item["id"], source, "full_text")
                                else:
                                    item["text_status"] = "abstract_only" if item["abstract"] else "metadata_only"
                                if item["screening_decision"] == "include" and item.get("abstract"):
                                    existing_text = {re.sub(r"\W+", "", span["exact_text"].casefold()) for span in spans if span["article_id"] == item["id"]}
                                    spans.extend(span for span in extract_spans(item["id"], item["abstract"], "abstract")
                                                 if re.sub(r"\W+", "", span["exact_text"].casefold()) not in existing_text)
                        item = corpus_by_key[key]
                        item["search_queries"].append({"provider": provider_name, "query": counter_query})
                        if any(term.casefold() in f'{item["title"]} {item["abstract"]}'.casefold() for term in alternatives) and item["screening_decision"] != "exclude":
                            possible_counterpapers.append(item["id"])
                except Exception as error:
                    failures += 1
                    record["error"] = type(error).__name__
                records.append(record)
                counter_records.append(record)
                save_snapshot()
                update("gap_verification_complete", f'{provider_name} counter-search: {record["records"]} records')
            data = build_outputs(corpus, decisions, spans, strategy, records, failures, searched_at)
            data["query_understanding"] = concepts
            support = []
            seen_studies = set()
            full_text_evidence_ids = {span["id"] for span in data["evidence_spans"] if span.get("source_level") == "full_text"}
            for claim in data["atomic_claims"]:
                if not set(claim["supporting_evidence_ids"]) & full_text_evidence_ids:
                    continue
                study = claim["supporting_studies"][0]
                if study not in seen_studies:
                    support.append(claim["id"])
                    seen_studies.add(study)
                if len(support) == 3:
                    break
            verified_search = len(counter_records) == 3 and all(not row["error"] for row in counter_records)
            verification = "challenged" if possible_counterpapers else "verified" if verified_search and data["quality_gate"]["deep_evidence_sufficient"] and len(claim_studies) >= 2 else "candidate"
            data["research_gaps"] = [{"id": "G-1", "gap_type": "evaluation_gap", "statement":
                f'No included study with grounded evidence for {target} was found within this run’s searched sources and queries.',
                "supporting_claim_ids": support, "supporting_evidence_ids": [], "contradicting_claim_ids": [], "affected_studies": sorted(claim_studies),
                "missing_dimension": target, "proposed_research_question": f'How can {concepts["topic"]} be evaluated for {target}?',
                "verification_status": verification, "evidence_basis": "full_text", "confidence": "low", "possible_counterpaper_ids": sorted(set(possible_counterpapers)),
                "counter_queries": counter_records}]
            data["gap_verification"] = {"status": verification, "searched_sources": [row["provider"] for row in counter_records],
                                        "possible_counterpaper_ids": sorted(set(possible_counterpapers)),
                                        "evidence_basis": "full_text", "full_text_studies": len({span["article_id"] for span in deep_spans})}
            data["stage_statuses"]["gap_analysis"] = "gap_analysis_complete"
            data["stage_statuses"]["gap_verification"] = "gap_verification_complete" if verified_search else "incomplete"
        elif explicit_abstract_support:
            data["research_gaps"] = [{"id": "G-1", "gap_type": "evaluation_gap",
                "statement": f'An abstract explicitly identifies a limitation or future direction related to {target}.',
                "supporting_claim_ids": [], "supporting_evidence_ids": [span["id"] for span in explicit_abstract_support],
                "contradicting_claim_ids": [], "affected_studies": sorted({span["article_id"] for span in explicit_abstract_support}),
                "missing_dimension": target, "proposed_research_question": f'How can {concepts["topic"]} be evaluated for {target}?',
                "verification_status": "abstract_supported", "evidence_basis": "abstract_only", "confidence": "low",
                "possible_counterpaper_ids": [], "counter_queries": []}]
            data["gap_verification"] = {"status": "abstract_supported", "reason": "Explicit abstract passage; no absence-based claim was made."}
    data["pipeline_status"] = "insufficient_evidence" if not data["quality_gate"]["passed"] else "mapping_complete"
    if model_assist and data["quality_gate"]["passed"]:
        by_article = defaultdict(list)
        for span in data["evidence_spans"]:
            by_article[span["article_id"]].append(span)
        for profile in data["study_profiles"][:8]:
            own = by_article[profile["article_id"]][:12]
            if not own:
                continue
            prompt = "Classify this CS study using only the listed exact evidence spans. Return JSON with task, method_family, evidence_ids. "
            prompt += "Evidence: " + json.dumps([{"id": span["id"], "text": span["exact_text"][:350]} for span in own], ensure_ascii=False)
            try:
                proposed = model_assist(prompt)
                if not isinstance(proposed, dict):
                    continue
                linked = [evidence_id for evidence_id in proposed.get("evidence_ids", []) if isinstance(evidence_id, str) and evidence_id in {span["id"] for span in own}]
                if linked:
                    for field in ("task", "method_family"):
                        value = proposed.get(field)
                        if isinstance(value, str) and 1 < len(value.strip()) <= 120:
                            profile[field] = value.strip()
                    profile["model_evidence_ids"] = linked
            except Exception as error:
                update("study_profiling", f'AI study profiling unavailable: {type(error).__name__}')
        data["research_taxonomy"]["by_method_family"] = {}
        for profile in data["study_profiles"]:
            data["research_taxonomy"]["by_method_family"].setdefault(profile["method_family"] or "Unclassified", []).append(profile["article_id"])
    (run_dir / "review.md").write_text(report(data), encoding="utf-8")
    (run_dir / "review.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    (run_dir / "references.bib").write_text(bibtex(corpus), encoding="utf-8")
    update(data["pipeline_status"], "Evidence gate evaluated; structured outputs saved")
    return data
