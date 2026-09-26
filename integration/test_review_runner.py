import sys
import unittest
import tempfile
import json
import re
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).parent))
from cs_engine import SCREEN_RESPONSE_FORMAT, OpenReviewProvider, build_outputs, concepts_from_input, evidence_candidates, jev_screen_articles, llm_refine_studies, llm_screen_articles, search_strategy, run
from review_runner import GeminiKeyRouter, JevClassifier, author_names, build_citation_metadata, crossref_references


class IntelligenceTests(unittest.TestCase):
    def test_jev_classifies_every_paper_and_keeps_unknown_in_background(self):
        import httpx
        observed = []
        def respond(request):
            observed.append(json.loads(request.content))
            self.assertEqual(request.url.path, "/v1/systemone")
            self.assertEqual(request.headers["Authorization"], "Bearer test-key")
            return httpx.Response(200, json={"answers": {
                "temporal_kg": {"type": "choice", "choice": "YES"},
                "inductive_generalization": {"type": "choice", "choice": "UNKNOWN"},
                "relevant_task": {"type": "choice", "choice": "YES"}}})
        classifier = JevClassifier("test-key", transport=httpx.MockTransport(respond))
        articles = [{"id": "A-1", "title": "A", "abstract": "Temporal graph study"},
                    {"id": "A-2", "title": "B", "abstract": "Temporal graph study"}]
        try:
            decisions = jev_screen_articles(articles, {"topic": "Inductive TKG"}, classifier)
        finally:
            classifier.close()
        self.assertEqual(len(observed), 2)
        self.assertEqual(observed[0]["model"], "jev-latest")
        self.assertEqual(set(observed[0]["questions"]), {"temporal_kg", "inductive_generalization", "relevant_task"})
        self.assertEqual([row["scope"] for row in decisions], ["background", "background"])
        self.assertTrue(all(row["screening_method"] == "jev" for row in decisions))
        self.assertNotIn("test-key", str(decisions))

    def test_gemini_evidence_cannot_override_jev_scope(self):
        article = {"id": "A-1", "title": "A", "abstract": "Temporal graph study", "scope": "background",
                   "screening_decision": "manual_review", "workflow_status": "manual_review",
                   "llm_scope_assessment": {"temporal_kg": "YES", "inductive_generalization": "UNKNOWN", "relevant_task": "YES"}}
        candidate = {"id": "E-1", "article_id": "A-1", "exact_text": "We study temporal knowledge graph completion using a sequence encoder without an inductive evaluation.",
                     "text": "We study temporal knowledge graph completion using a sequence encoder without an inductive evaluation.", "source_level": "abstract"}
        llm_refine_studies([article], [candidate], {"topic": "Inductive TKG"},
                           lambda _: {"temporal_kg": "YES", "inductive_generalization": "YES", "relevant_task": "YES", "evidence": []},
                           preserve_scope=True)
        self.assertEqual(article["scope"], "background")
        self.assertEqual(article["llm_scope_assessment"]["inductive_generalization"], "UNKNOWN")

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

    def test_gemini_screening_schema_and_full_io_audit_survive_bad_json(self):
        import httpx
        requests = []
        def respond(request):
            body = json.loads(request.content)
            requests.append(body)
            content = '{bad json}' if len(requests) == 1 else '{"studies":[]}'
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}],
                                             "usage": {"prompt_tokens": 3, "completion_tokens": 2}})
        with tempfile.TemporaryDirectory() as temporary:
            audit_path = Path(temporary) / "gemini-calls.jsonl"
            router = GeminiKeyRouter(["secret-key"], interval_seconds=0, transport=httpx.MockTransport(respond),
                                     audit_path=audit_path, redact=lambda text: text.replace("secret-key", "[REDACTED]"))
            try:
                self.assertEqual(router.complete("Score papers", "test-model", SCREEN_RESPONSE_FORMAT), {"studies": []})
            finally:
                router.close()
            self.assertEqual(router.usage["requests"], 2)
            self.assertEqual(requests[0]["response_format"], SCREEN_RESPONSE_FORMAT)
            audit_text = audit_path.read_text(encoding="utf-8")
            entries = [json.loads(line) for line in audit_text.splitlines()]
            self.assertEqual(len(entries), 2)
            self.assertEqual(entries[0]["request"]["body"]["messages"][1]["content"], "Score papers")
            self.assertIn("{bad json}", entries[0]["responseBody"])
            self.assertNotIn("Authorization", audit_text)
            self.assertNotIn("secret-key", audit_text)

    def test_review_requires_gemini_and_has_no_regex_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(RuntimeError, "Gemini API key is required"):
                run({"title": "Inductive temporal knowledge graphs"}, 3, Path(temporary), lambda *_: None)

    def test_gemini_screening_includes_only_when_all_required_criteria_are_met(self):
        concepts = concepts_from_input({"title": "Temporal knowledge graph", "core_concepts": "temporal knowledge graph, inductive reasoning"})
        article = {"id": "A-1", "title": "Temporal knowledge graph completion", "abstract": "We study inductive learning for new entities."}
        decisions = llm_screen_articles([article], concepts, lambda _prompt: {"studies": [{"article_id": "A-1", "temporal_kg_score": 100,
            "inductive_generalization_score": 100, "relevant_task_score": 100}]})
        decision = decisions[0]
        self.assertEqual(decision["decision"], "include")
        self.assertEqual([item["decision"] for item in decision["criteria"]], ["yes"] * 3)
        self.assertEqual(decision["scope"], "core")
        self.assertEqual(decision["screening_method"], "gemini")

    def test_query_planner_anchors_ambiguous_expansions(self):
        concepts = concepts_from_input({"title": "Inductive Reasoning in Temporal Knowledge Graphs"})
        self.assertIn("temporal knowledge graph", concepts["required_concepts"])
        self.assertIn("zero-shot", concepts["generalization_concepts"])
        strategy = search_strategy(concepts)
        for queries in strategy.values():
            self.assertFalse(any(query.casefold() in {"generalization", "inductive reasoning", "emerging entities"} for query in queries))

    def test_gemini_contextual_tkg_is_background_and_abstract_silence_is_unknown(self):
        concepts = concepts_from_input({"title": "Inductive Reasoning in Temporal Knowledge Graphs"})
        article_b = {"id": "A-B", "title": "Temporal knowledge graph completion", "abstract": "We evaluate a temporal graph model for link prediction."}
        decision = llm_screen_articles([article_b], concepts, lambda _prompt: {"studies": [{"article_id": "A-B", "temporal_kg_score": 100,
            "inductive_generalization_score": 50, "relevant_task_score": 100}]})[0]
        self.assertEqual(decision["scope"], "background")
        article = {"id": "A-1", "title": "Core", "year": "2025", "venue": "V", "source": "arxiv", "doi": "", "source_url": "",
                   "screening_decision": "include", "scope": "core", "text_status": "abstract_only"}
        span = {"id": "E-1", "article_id": "A-1", "exact_text": "We study inductive temporal knowledge graph completion for new entities.",
                "text": "We study inductive temporal knowledge graph completion for new entities.", "section": "abstract", "source_level": "abstract",
                "evidence_type": "task", "grounded": True, "confidence": "medium"}
        output = build_outputs([article], [{"article_id": "A-1", "decision": "include", "scope": "core"}], [span], {}, [], 0, "2026")
        profile = output["study_profiles"][0]
        self.assertEqual(profile["unseen_entity"], "YES")
        self.assertEqual(profile["cross_domain"], "UNKNOWN")

    def test_cross_paper_claim_requires_two_core_studies(self):
        articles, decisions, spans = [], [], []
        for index in range(2):
            article_id = f"A-{index + 1}"
            articles.append({"id": article_id, "title": article_id, "year": "2025", "venue": "V", "source": "arxiv", "doi": "", "source_url": "",
                             "screening_decision": "include", "scope": "core", "text_status": "full_text"})
            decisions.append({"article_id": article_id, "decision": "include", "scope": "core"})
            spans.append({"id": f"E-{index + 1}", "article_id": article_id, "exact_text": "We propose a zero-shot method for unseen entities and evaluate its performance.",
                          "text": "We propose a zero-shot method for unseen entities and evaluate its performance.", "section": "full_text", "source_level": "full_text",
                          "evidence_type": "method", "grounded": True, "confidence": "high"})
        output = build_outputs(articles, decisions, spans, {}, [], 0, "2026")
        zero_shot = next(claim for claim in output["cross_paper_claims"] if "zero-shot" in claim["statement"])
        self.assertEqual(len(zero_shot["supporting_article_ids"]), 2)
        self.assertTrue(zero_shot["supporting_evidence_ids"])

    def test_gemini_rejects_generic_generalization_as_core(self):
        concepts = concepts_from_input({"title": "Inductive Reasoning in Temporal Knowledge Graphs"})
        article = {"id": "A-1", "title": "Temporal knowledge graph completion",
                   "abstract": "We improve generalization performance for link prediction on standard temporal benchmarks."}
        decision = llm_screen_articles([article], concepts, lambda _prompt: {"studies": [{"article_id": "A-1", "temporal_kg_score": 100,
            "inductive_generalization_score": 50, "relevant_task_score": 100}]})[0]
        self.assertEqual(decision["scope"], "background")

    def test_fragment_and_unsupported_promotion_are_not_claims(self):
        article = {"id": "A-1", "title": "Paper", "year": "2025", "venue": "V", "source": "arxiv", "doi": "", "source_url": "",
                   "screening_decision": "include", "scope": "core", "text_status": "full_text"}
        spans = [
            {"id": "E-1", "article_id": "A-1", "exact_text": "Our model outperforms all baselines in every setting without any reported metric or benchmark context.",
             "text": "", "section": "full_text", "source_level": "full_text", "evidence_type": "result", "grounded": True},
            {"id": "E-2", "article_id": "A-1", "exact_text": "The method improves the reported result, achieving at least 8.",
             "text": "", "section": "full_text", "source_level": "full_text", "evidence_type": "result", "grounded": True},
        ]
        output = build_outputs([article], [{"article_id": "A-1", "decision": "include", "scope": "core"}], spans, {}, [], 0, "2026")
        self.assertEqual(output["paper_claims"], [])

    def test_openreview_public_discovery_maps_to_canonical_publication(self):
        import httpx
        def respond(request):
            self.assertEqual(request.url.path, "/notes/search")
            return httpx.Response(200, json={"notes": [{"id": "note-1", "cdate": 1735689600000, "content": {
                "title": {"value": "Inductive graph learning"}, "abstract": {"value": "We propose a graph method."},
                "authors": {"value": [{"fullname": "Ada Lovelace", "username": "https://orcid.org/0000"}]}, "pdf": {"value": "/pdf/note-1.pdf"}, "venue": {"value": "ICLR"}}}]})
        results = OpenReviewProvider(transport=httpx.MockTransport(respond)).search("graph learning", 5)
        self.assertEqual(results[0].source, "openreview")
        self.assertEqual(results[0].external_ids["OpenReview"], "note-1")
        self.assertEqual(results[0].year, 2025)
        self.assertEqual(results[0].authors, ["Ada Lovelace"])

    def test_author_objects_and_stringified_profiles_are_normalized(self):
        raw = "[{'fullname': 'Zepeng Li', 'username': 'https://orcid.org/0000'}, {'fullname': 'Xiao Li'}]"
        self.assertEqual(author_names(raw), ["Zepeng Li", "Xiao Li"])
        self.assertEqual(author_names([{"given": "Ada", "family": "Lovelace"}]), ["Ada Lovelace"])

    def test_exact_spans_have_source_offsets(self):
        source = "Introduction\nWe propose a temporal model for unseen entities and evaluate it on two public datasets.\nThe results show higher accuracy than the baseline in this experiment."
        spans = evidence_candidates("A-1", source)
        self.assertGreaterEqual(len(spans), 2)
        for span in spans:
            self.assertEqual(source[span["start_position"]:span["end_position"]], span["exact_text"])
            self.assertTrue(span["grounded"])

    def test_llm_may_only_select_supplied_exact_evidence(self):
        source = "We study inductive temporal knowledge graph completion for unseen entities. Our method is evaluated on two public datasets."
        candidates = evidence_candidates("A-1", source)
        article = {"id": "A-1", "title": "Inductive TKG", "scope": "core", "screening_decision": "include"}
        def model(_prompt):
            return {"temporal_kg": "YES", "inductive_generalization": "YES", "relevant_task": "YES",
                    "task": "inductive temporal KG completion", "method_family": "graph neural network",
                    "main_contribution": "Grounded method", "evidence": [
                        {"id": candidates[0]["id"], "type": "task", "dimensions": ["unseen_entity"], "claim_worthy": True},
                        {"id": "invented-id", "type": "result", "dimensions": ["zero_shot"], "claim_worthy": True}]}
        selected = llm_refine_studies([article], candidates, {"topic": "Inductive TKG"}, model)
        self.assertEqual([row["id"] for row in selected], [candidates[0]["id"]])
        self.assertEqual(selected[0]["llm_dimensions"], ["unseen_entity"])
        self.assertEqual(source[selected[0]["start_position"]:selected[0]["end_position"]], selected[0]["exact_text"])

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
        resolver.resolve.return_value = "We propose a temporal knowledge graph model for zero-history unseen entities and unseen relations, and evaluate it on two public datasets. Results show that our method improves accuracy compared with a baseline on the evaluation set."
        def model(prompt):
            if "identify concise search concepts" in prompt:
                return {"core_concepts": ["temporal knowledge graph", "inductive reasoning"], "related_concepts": []}
            if "Articles:" in prompt:
                ids = list(dict.fromkeys(re.findall(r'"article_id":\s*"([^"]+)"', prompt)))
                return {"studies": [{"article_id": article_id, "temporal_kg_score": 100, "inductive_generalization_score": 100,
                                     "relevant_task_score": 100} for article_id in ids]}
            evidence_ids = list(dict.fromkeys(re.findall(r'"id":\s*"(E-[^"]+)"', prompt)))
            return {"temporal_kg": "YES", "inductive_generalization": "YES", "relevant_task": "YES", "task": "TKG completion",
                    "method_family": "graph model", "main_contribution": "method", "evidence": [
                        {"id": evidence_id, "type": "task", "dimensions": ["unseen_entity", "unseen_relation", "zero_history"], "claim_worthy": True}
                        for evidence_id in evidence_ids]}
        with tempfile.TemporaryDirectory() as temporary:
            events = []
            article_updates = []
            data = run({"title": "Inductive Reasoning in Temporal Knowledge Graphs"}, 3, Path(temporary), lambda stage, message: events.append(stage), fetcher=fetcher, resolver=resolver, model_assist=model,
                       publish_articles=lambda articles: article_updates.append([(article["id"], article["screening_decision"]) for article in articles]))
            self.assertTrue(any(len(update) == 3 and all(state == "pending" for _, state in update) for update in article_updates))
            self.assertTrue(any(len(update) == 3 and all(state == "include" for _, state in update) for update in article_updates))
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
        resolver.resolve.return_value = "We propose an inductive temporal knowledge graph method for unseen entities and evaluate it on two datasets for reasoning tasks. Results show that our method improves accuracy compared with baseline systems on these datasets."
        def model(prompt):
            if "identify concise search concepts" in prompt:
                return {"core_concepts": ["temporal knowledge graph"], "related_concepts": ["zero-shot"]}
            if "Articles:" in prompt:
                ids = list(dict.fromkeys(re.findall(r'"article_id":\s*"([^"]+)"', prompt)))
                return {"studies": [{"article_id": article_id, "temporal_kg_score": 100, "inductive_generalization_score": 100,
                                     "relevant_task_score": 100} for article_id in ids]}
            evidence_ids = list(dict.fromkeys(re.findall(r'"id":\s*"(E-[^"]+)"', prompt)))
            return {"temporal_kg": "YES", "inductive_generalization": "YES", "relevant_task": "YES", "task": "TKG completion",
                    "method_family": "graph model", "main_contribution": "method", "evidence": [
                        {"id": evidence_id, "type": "task", "dimensions": ["unseen_entity"], "claim_worthy": True}
                        for evidence_id in evidence_ids]}
        with tempfile.TemporaryDirectory() as temporary:
            data = run({"title": "temporal knowledge graph", "related_concepts": "zero-shot"}, 3, Path(temporary), lambda *_: None, fetcher=fetcher, resolver=resolver, model_assist=model)
            gap = data["research_gaps"][0]
            self.assertEqual(gap["verification_status"], "verified")
            self.assertIn("UNKNOWN", gap["statement"])
            self.assertGreaterEqual(len(gap["supporting_claim_ids"]), 1)
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
