import sys
import unittest
import tempfile
import json
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).parent))
from cs_engine import build_outputs, concepts_from_input, extract_spans, screen, run
from review_runner import GeminiKeyRouter, build_citation_metadata, crossref_references


class IntelligenceTests(unittest.TestCase):
    def test_gemini_key_rotation_and_reported_tokens(self):
        import httpx
        observed = []
        snapshots = []
        def respond(request):
            observed.append(request.headers["Authorization"])
            return httpx.Response(200, json={"choices": [{"message": {"content": '{"core_concepts":["graph learning"]}'}}],
                                             "usage": {"prompt_tokens": 11, "completion_tokens": 4, "total_tokens": 15}})
        router = GeminiKeyRouter(["secret-one", "secret-two"], ["Key 1", "Key 2"], interval_seconds=0,
                                 on_metrics=lambda metrics, usage: snapshots.append((metrics, usage)), transport=httpx.MockTransport(respond))
        try:
            self.assertEqual(router.complete("topic", "test-model")["core_concepts"], ["graph learning"])
            router.complete("topic", "test-model")
        finally:
            router.close()
        self.assertEqual(observed, ["Bearer secret-one", "Bearer secret-two"])
        self.assertEqual(snapshots[-1][1], {"input": 22, "output": 8, "total": 30, "requests": 2})
        self.assertEqual([(row["requests"], row["tokens"], row["active"]) for row in snapshots[-1][0]],
                         [(1, 15, False), (1, 15, False)])
        self.assertNotIn("secret-one", str(snapshots))

    def test_screening_includes_only_when_all_required_criteria_are_met(self):
        concepts = concepts_from_input({"title": "Temporal knowledge graph", "core_concepts": "temporal knowledge graph, inductive reasoning"})
        article = {"id": "A-1", "title": "Temporal knowledge graph completion", "abstract": "We study inductive learning for new entities."}
        decision = screen(article, concepts)
        self.assertEqual(decision["decision"], "include")
        self.assertEqual([item["decision"] for item in decision["criteria"]], ["yes"] * 4)

    def test_exact_spans_have_source_offsets(self):
        source = "Introduction\nWe propose a temporal model for unseen entities and evaluate it on two public datasets.\nThe results show higher accuracy than the baseline in this experiment."
        spans = extract_spans("A-1", source)
        self.assertGreaterEqual(len(spans), 2)
        for span in spans:
            self.assertEqual(source[span["start_position"]:span["end_position"]], span["exact_text"])
            self.assertTrue(span["grounded"])

    def test_quality_gate_prevents_unsupported_claims_and_gaps(self):
        article = {"id": "A-1", "title": "Paper", "year": "2025", "venue": "Venue", "source": "arxiv", "doi": "", "source_url": "", "screening_decision": "include", "text_status": "abstract_only"}
        output = build_outputs([article], [], [], {}, [], 0, "2026-09-26")
        self.assertEqual(output["pipeline_status"], "insufficient_evidence")
        self.assertEqual(output["atomic_claims"], [])
        self.assertEqual(output["research_gaps"], [])

    def test_end_to_end_exports_only_grounded_claims(self):
        from synthscholar.clients import Publication
        from synthscholar.models import Article
        publications = [Publication(source="arxiv", title=f"Temporal knowledge graph model {i}", abstract="We study inductive temporal knowledge graph completion for unseen entities.", authors=["Author"], year=2025, doi=f"10.1000/example{i}", url=f"https://example.test/{i}", external_ids={"arXiv": f"2501.0000{i}"}) for i in range(3)]
        provider = Mock()
        provider.search.side_effect = lambda query, limit: publications if query == "temporal knowledge graph" else []
        fetcher = Mock(providers={"arxiv": provider})
        resolver = Mock()
        resolver.resolve.return_value = "We propose a temporal knowledge graph model and evaluate it on two public datasets. Results show that our method improves accuracy compared with a baseline on the evaluation set."
        with tempfile.TemporaryDirectory() as temporary:
            events = []
            data = run({"title": "Inductive Reasoning in Temporal Knowledge Graphs"}, 3, Path(temporary), lambda stage, message: events.append(stage), fetcher=fetcher, resolver=resolver)
            self.assertEqual(data["pipeline_status"], "mapping_complete")
            self.assertEqual(data["quality_gate"]["studies_with_grounded_evidence"], 3)
            self.assertTrue(data["atomic_claims"])
            for claim in data["atomic_claims"]:
                span = next(item for item in data["evidence_spans"] if item["id"] == claim["supporting_evidence_ids"][0])
                source = (Path(temporary) / f'source-text/{span["article_id"]}.txt').read_text()
                self.assertEqual(source[span["start_position"]:span["end_position"]], claim["statement"])
            self.assertTrue((Path(temporary) / "review.json").is_file())
            self.assertTrue((Path(temporary) / "references.bib").is_file())
            self.assertNotIn("api_key", (Path(temporary) / "review.json").read_text())
            self.assertIn("search_complete", events)

    def test_gap_counter_search_is_scoped_and_traceable(self):
        from synthscholar.clients import Publication
        publications = [Publication(source="arxiv", title=f"Temporal knowledge graph method {i}", abstract="Inductive reasoning for temporal knowledge graph completion and method evaluation.", year=2025, doi=f"10.1000/gap{i}", url=f"https://example.test/{i}") for i in range(3)]
        arxiv = Mock()
        arxiv.search.side_effect = lambda query, limit: publications if query == "temporal knowledge graph" else []
        empty = Mock()
        empty.search.return_value = []
        fetcher = Mock(providers={"arxiv": arxiv, "semantic_scholar": empty, "openalex": empty})
        resolver = Mock()
        resolver.resolve.return_value = "We propose a temporal knowledge graph method and evaluate it on two datasets for reasoning tasks. Results show that our method improves accuracy compared with baseline systems on these datasets."
        with tempfile.TemporaryDirectory() as temporary:
            data = run({"title": "temporal knowledge graph", "related_concepts": "zero-shot"}, 3, Path(temporary), lambda *_: None, fetcher=fetcher, resolver=resolver)
            gap = data["research_gaps"][0]
            self.assertEqual(gap["verification_status"], "verified")
            self.assertIn("within this run", gap["statement"])
            self.assertGreaterEqual(len(gap["supporting_claim_ids"]), 2)
            self.assertEqual(len(gap["counter_queries"]), 3)
            self.assertTrue(all(row["query_kind"] == "gap_counter_search" for row in gap["counter_queries"]))

    def test_crossref_graph_metadata_uses_doi_references(self):
        import httpx
        requested = []
        def respond(request):
            requested.append(str(request.url))
            return httpx.Response(200, json={"message": {"reference": [
                {"DOI": "https://doi.org/10.1000/SHARED", "article-title": "Shared paper"},
                {"unstructured": "No DOI"},
            ]}})
        references, complete = crossref_references("10.1000/example", transport=httpx.MockTransport(respond))
        self.assertTrue(complete)
        self.assertEqual(references, [{"doi": "10.1000/shared", "title": "Shared paper"}])
        self.assertEqual(requested, ["https://api.crossref.org/works/10.1000%2Fexample"])
        looked_up = []
        def fetch(doi, email):
            looked_up.append(doi)
            return [{"doi": "10.1000/shared"}], True
        metadata = build_citation_metadata([
            {"doi": "10.1000/EXAMPLE"}, {"doi": "https://doi.org/10.1000/example"},
            {"doi": ""}, {"doi": "10.1000/other"},
        ], fetcher=fetch)
        self.assertEqual(set(looked_up), {"10.1000/example", "10.1000/other"})
        self.assertEqual(metadata["queried"], 2)
        self.assertEqual(metadata["failed"], 0)


if __name__ == "__main__":
    unittest.main()
