import sys
import unittest
import tempfile
import subprocess
import json
import re
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))
from cs_engine import SCREEN_RESPONSE_FORMAT, OpenReviewProvider, build_outputs, concepts_from_input, evidence_candidates, jev_screen_articles, llm_refine_studies, llm_screen_articles, report, search_strategy, run
from review_runner import GeminiKeyRouter, JevClassifier, author_names, build_citation_metadata, crossref_references, openreview_metadata, openalex_references, semantic_scholar_references


class IntelligenceTests(unittest.TestCase):
    def test_general_protocol_screening_uses_question_not_temporal_kg(self):
        article = {"id": "A-1", "title": "Compiler optimization", "abstract": "A compiler optimization study", "year": "2024"}
        concepts = concepts_from_input({"title": "Compiler optimization", "screening_template": "general",
                                        "inclusion_criteria": "Compiler studies"})
        rows = llm_screen_articles([article], concepts, lambda prompt: {
            "studies": [{"article_id": "A-1", "topic_relevance_score": 100}]})
        self.assertEqual(rows[0]["scope"], "core")
        self.assertEqual(rows[0]["criteria"][0]["criterion"], "topic_relevance")

    def test_general_synthesis_avoids_temporal_kg_dimensions(self):
        article = {"id": "A-1", "title": "Compiler optimization", "year": "2024", "venue": "V", "source": "arxiv",
                   "doi": "", "source_url": "", "screening_decision": "include", "scope": "core", "text_status": "abstract_only"}
        result = build_outputs([article], [{"article_id": "A-1", "decision": "include", "scope": "core"}], [],
                               {}, [], 0, "2026", {"screening_template": "general"})
        self.assertIn("method", result["evidence_matrix"][0]["dimensions"])
        self.assertNotIn("unseen_entity", result["evidence_matrix"][0]["dimensions"])

    def test_custom_extraction_dimension_enters_general_matrix(self):
        concepts = concepts_from_input({"title": "Compiler optimization", "screening_template": "general",
                                        "extraction_dimensions": "Deployment cost"})
        article = {"id": "A-1", "title": "Compiler optimization", "year": "2024", "venue": "V", "source": "arxiv",
                   "doi": "", "source_url": "", "screening_decision": "include", "scope": "core", "text_status": "abstract_only"}
        candidate = {"id": "E-1", "article_id": "A-1", "exact_text": "This compiler optimization method reduces deployment cost while preserving accuracy on a public benchmark.",
                     "text": "This compiler optimization method reduces deployment cost while preserving accuracy on a public benchmark.",
                     "source_level": "abstract", "grounded": True}
        spans = llm_refine_studies([article], [candidate], concepts,
            lambda _: {"evidence": [{"id": "E-1", "type": "result", "dimensions": ["deployment_cost"], "claim_worthy": True}]},
            preserve_scope=True)
        result = build_outputs([article], [], spans, {}, [], 0, "2026", concepts)
        self.assertEqual(result["evidence_matrix"][0]["dimensions"]["deployment_cost"]["value"], "YES")

    def test_malformed_screening_is_unresolved_after_batch_split(self):
        articles = [{"id": "A-1", "title": "One", "abstract": "One"},
                    {"id": "A-2", "title": "Two", "abstract": "Two"}]
        calls = []
        def assist(prompt):
            calls.append(prompt)
            if '"article_id": "A-1"' in prompt and '"article_id": "A-2"' not in prompt:
                return {"studies": [{"article_id": "A-1", "topic_relevance_score": 100}]}
            return {"invalid": True}
        rows = llm_screen_articles(articles, {"topic": "One", "screening_template": "general"}, assist)
        self.assertEqual([row["scope"] for row in rows], ["core", "background"])
        self.assertIn("unresolved", rows[1]["reason"])
        self.assertGreaterEqual(len(calls), 4)

    def test_evidence_candidates_cover_late_source_passages_with_context(self):
        source = "\n".join(f"This study reports a complete evaluated observation number {index} using a clear method and benchmark."
                           for index in range(75))
        candidates = evidence_candidates("A-1", source)
        self.assertEqual(len(candidates), 75)
        self.assertIn("number 74", candidates[-1]["exact_text"])
        self.assertEqual(source[candidates[-1]["start_position"]:candidates[-1]["end_position"]], candidates[-1]["exact_text"])
        self.assertIn("number 73", candidates[-1]["context_before"])

    def test_adjudication_rebuilds_strict_corpus_without_new_model_call(self):
        article = {"id": "A-1", "title": "Uncertain study", "year": "2024", "venue": "V", "source": "arxiv",
                   "doi": "", "source_url": "", "screening_decision": "manual_review", "scope": "background",
                   "text_status": "abstract_only", "authors": "Author"}
        span = {"id": "E-1", "article_id": "A-1", "exact_text": "This study evaluates a complete compiler optimization method on a public benchmark with explicit measured results.",
                "text": "This study evaluates a complete compiler optimization method on a public benchmark with explicit measured results.",
                "source_level": "abstract", "evidence_type": "method", "grounded": True, "confidence": "medium",
                "claim_worthy": True}
        protocol = {"title": "Compiler optimization", "screening_template": "general"}
        original = build_outputs([article], [{"article_id": "A-1", "scope": "background", "decision": "manual_review"}],
                                 [span], {}, [], 0, "2026", concepts_from_input(protocol))
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / "protocol.json").write_text(json.dumps(protocol), encoding="utf-8")
            (folder / "review.json").write_text(json.dumps(original), encoding="utf-8")
            (folder / "status.json").write_text(json.dumps({"id": "test", "state": "mapping_complete"}), encoding="utf-8")
            result = subprocess.run([sys.executable, str(Path(__file__).parent / "review_runner.py"), "--adjudicate", str(folder)],
                                    input=json.dumps({"articleId": "A-1", "decision": "include"}), text=True,
                                    capture_output=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            rebuilt = json.loads((folder / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(rebuilt["articles"][0]["scope"], "core")
            self.assertEqual(len(rebuilt["study_profiles"]), 1)
            self.assertEqual(rebuilt["adjudication_history"][0]["decision"], "include")

    def test_search_failure_and_unresolved_screening_are_visible_in_quality(self):
        core = {"id": "A-1", "title": "A", "year": "2024", "venue": "V", "source": "arxiv", "doi": "",
                "source_url": "", "screening_decision": "include", "scope": "core", "text_status": "abstract_only"}
        uncertain = {**core, "id": "A-2", "title": "B", "screening_decision": "manual_review", "scope": "background"}
        result = build_outputs([core, uncertain], [], [], {}, [
            {"provider": "arxiv", "query": "q1", "records": 2, "error": ""},
            {"provider": "openalex", "query": "q2", "records": 0, "error": "TimeoutError"}], 1, "2026")
        self.assertEqual(result["review_quality"]["search_completeness"], "degraded")
        self.assertEqual(result["review_quality"]["screening_completeness"], "needs_adjudication")
        self.assertEqual(result["screening_sensitivity"]["expanded_corpus_ids"], ["A-1", "A-2"])

    def test_identical_protocol_reuses_completed_search_queries(self):
        from synthscholar.clients import Publication
        publication = Publication(source="arxiv", title="Compiler optimization", abstract="A study of compiler optimization.",
                                  authors=["Author"], year=2024, doi="10.1000/compiler", url="https://example.test/paper")
        provider = Mock(search=Mock(return_value=[publication]))
        fetcher = Mock(providers={"arxiv": provider})
        resolver = Mock(resolve=Mock(return_value="This compiler study evaluates a complete optimization method on a public benchmark dataset."))
        protocol = {"title": "Compiler optimization", "screening_template": "general", "sources": ["arxiv"]}
        model_calls = []
        def model(prompt):
            model_calls.append(prompt)
            if "Return JSON with core_concepts" in prompt:
                return {"core_concepts": ["compiler optimization"], "related_concepts": []}
            if "topic_relevance_score" in prompt:
                return {"studies": [{"article_id": "A-1", "topic_relevance_score": 100}]}
            if "Return JSON with evidence" in prompt:
                evidence_ids = re.findall(r'"id": "(E-[^"]+)"', prompt)
                return {"evidence": [{"id": evidence_ids[0], "type": "method", "dimensions": [],
                                      "claim_worthy": True}]} if evidence_ids else {"evidence": []}
            return {"evidence": []}
        with tempfile.TemporaryDirectory() as temporary:
            first, second, third = (Path(temporary) / name for name in ("first", "second", "third"))
            first.mkdir(); second.mkdir(); third.mkdir()
            (first / "protocol.json").write_text(json.dumps(protocol), encoding="utf-8")
            run(protocol, 2, first, lambda *_: None, fetcher=fetcher, resolver=resolver,
                abstract_enricher=lambda _: {}, model_assist=model)
            searched = provider.search.call_count
            resolved = resolver.resolve.call_count
            called = len(model_calls)
            self.assertGreater(searched, 0)
            run(protocol, 2, second, lambda *_: None, fetcher=fetcher, resolver=resolver,
                abstract_enricher=lambda _: {}, model_assist=model, resume_from=first)
            self.assertEqual(provider.search.call_count, searched)
            self.assertEqual(resolver.resolve.call_count, resolved)
            self.assertEqual(len(model_calls), called)
            self.assertTrue((second / "search-checkpoint.json").is_file())
            (first / "runtime-manifest.json").write_text(json.dumps({"engineSha256": "older-engine"}), encoding="utf-8")
            run(protocol, 2, third, lambda *_: None, fetcher=fetcher, resolver=resolver,
                abstract_enricher=lambda _: {}, model_assist=model, resume_from=first)
            self.assertEqual(provider.search.call_count, searched)
            self.assertGreater(len(model_calls), called)

    def test_citation_expansion_enters_screened_corpus(self):
        from synthscholar.clients import Publication
        seed = Publication(source="arxiv", title="Compiler optimization", abstract="A compiler study.",
                           year=2024, doi="10.1000/seed")
        cited = Publication(source="citation_snowballing", title="Earlier compiler study",
                            abstract="An earlier compiler study.", year=2023, doi="10.1000/cited")
        provider = Mock(search=Mock(return_value=[seed]))
        fetcher = Mock(providers={"arxiv": provider})
        resolver = Mock(resolve=Mock(return_value=""))
        def model(prompt):
            if "Return JSON with core_concepts" in prompt:
                return {"core_concepts": ["compiler optimization"]}
            if "topic_relevance_score" in prompt:
                ids = re.findall(r'"article_id": "(A-\d+)"', prompt)
                return {"studies": [{"article_id": article_id, "topic_relevance_score": 100} for article_id in ids]}
            return {"evidence": []}
        with tempfile.TemporaryDirectory() as temporary:
            result = run({"title": "Compiler optimization", "screening_template": "general",
                          "sources": ["arxiv"], "citation_snowballing": True}, 2, Path(temporary),
                         lambda *_: None, fetcher=fetcher, resolver=resolver, abstract_enricher=lambda _: {},
                         model_assist=model, citation_fetcher=lambda *_: ([('backward', cited)], {"status": "complete"}))
        self.assertEqual(len(result["articles"]), 2)
        self.assertEqual(result["articles"][1]["screening_decision"], "include")
        self.assertEqual(result["citation_expansion_history"][0]["new_article_ids"], ["A-2"])

    def test_source_retention_can_delete_full_text_after_report(self):
        from synthscholar.clients import Publication
        publication = Publication(source="arxiv", title="Compiler optimization", abstract="A compiler study.",
                                  year=2024, doi="10.1000/retention")
        fetcher = Mock(providers={"arxiv": Mock(search=Mock(return_value=[publication]))})
        resolver = Mock(resolve=Mock(return_value="This compiler study evaluates a complete optimization method on a public benchmark dataset."))
        def model(prompt):
            if "Return JSON with core_concepts" in prompt:
                return {"core_concepts": ["compiler optimization"]}
            if "topic_relevance_score" in prompt:
                return {"studies": [{"article_id": "A-1", "topic_relevance_score": 100}]}
            return {"evidence": []}
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            result = run({"title": "Compiler optimization", "screening_template": "general", "sources": ["arxiv"],
                          "source_text_retention": "delete_after_review"}, 2, folder, lambda *_: None,
                         fetcher=fetcher, resolver=resolver, abstract_enricher=lambda _: {}, model_assist=model)
            self.assertFalse((folder / "source-text").exists())
            self.assertEqual(result["review_quality"]["source_text_retention"], "deleted_after_review")
            self.assertEqual(result["articles"][0]["source_text_file"], "")

    def test_gemini_router_enforces_per_key_interval(self):
        import httpx
        import time
        router = GeminiKeyRouter(["secret"], interval_seconds=5,
                                 transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})))
        try:
            router.last_request_at[0] = time.monotonic()
            with patch("review_runner.time.sleep") as sleeper:
                router.complete("topic", "model")
            self.assertGreater(sleeper.call_args.args[0], 4.9)
        finally:
            router.close()

    def test_redacted_audit_keeps_hashes_without_paper_text(self):
        import httpx
        with tempfile.TemporaryDirectory() as temporary:
            log = Path(temporary) / "gemini-calls.jsonl"
            router = GeminiKeyRouter(["secret"], interval_seconds=0, audit_path=log, audit_mode="redacted",
                transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})))
            try:
                router.complete("confidential paper passage", "model")
            finally:
                router.close()
            entry = json.loads(log.read_text(encoding="utf-8"))
            self.assertIn("requestBodySha256", entry)
            self.assertNotIn("request", entry)
            self.assertNotIn("responseBody", entry)
            self.assertNotIn("confidential paper passage", str(entry))

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

    def test_malformed_evidence_rows_do_not_abort_review(self):
        article = {"id": "A-1", "title": "A", "scope": "core", "screening_decision": "include"}
        candidate = {"id": "E-1", "article_id": "A-1", "exact_text": "A complete grounded result sentence.",
                     "text": "A complete grounded result sentence.", "source_level": "abstract"}
        response = {"evidence": [
            {"id": "E-1", "type": ["result"], "dimensions": []},
            {"id": ["E-1"], "type": "result", "dimensions": []},
            {"id": "E-1", "type": "result", "dimensions": [["unseen_entity"], "unseen_entity"], "claim_worthy": True},
        ]}
        spans = llm_refine_studies([article], [candidate], {"topic": "Inductive TKG"},
                                   lambda _: response, preserve_scope=True)
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0]["llm_dimensions"], ["unseen_entity"])

    def test_gemini_evidence_analysis_runs_four_studies_in_parallel(self):
        from threading import Barrier

        started = Barrier(4)
        articles = [{"id": f"A-{index}", "title": f"Paper {index}", "scope": "core"}
                    for index in range(1, 5)]
        candidates = [{"id": f"E-{index}", "article_id": f"A-{index}",
                       "exact_text": f"This complete evidence sentence describes the evaluated method for paper {index} with sufficient grounded detail.",
                       "text": f"Evidence {index}", "source_level": "full_text"}
                      for index in range(1, 5)]

        def assist(prompt):
            started.wait(timeout=3)
            evidence_id = re.search(r'"id": "(E-\d+)"', prompt).group(1)
            return {"evidence": [{"id": evidence_id, "type": "task", "dimensions": [], "claim_worthy": True}],
                    "task": "evaluation", "method_family": "transformer", "main_contribution": "result"}

        selected = llm_refine_studies(articles, candidates, {"topic": "Parallel evidence"}, assist,
                                      preserve_scope=True, max_workers=4)

        self.assertEqual([row["id"] for row in selected], ["E-1", "E-2", "E-3", "E-4"])

    def test_gemini_assigns_one_concurrent_agent_per_key(self):
        import httpx
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier

        started = Barrier(2)
        observed = []

        def respond(request):
            observed.append(request.headers["Authorization"])
            started.wait(timeout=3)
            return httpx.Response(200, json={"choices": [{"message": {"content": '{}'}}]})

        router = GeminiKeyRouter(["secret-one", "secret-two"], interval_seconds=0,
                                 transport=httpx.MockTransport(respond))
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda _: router.complete("topic", "test-model"), range(2)))
        finally:
            router.close()

        self.assertEqual(results, [{}, {}])
        self.assertEqual(set(observed), {"Bearer secret-one", "Bearer secret-two"})

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

    def test_gemini_retries_read_timeout_and_succeeds(self):
        import httpx
        requests = []
        def respond(request):
            requests.append(request)
            if len(requests) < 3:
                raise httpx.ReadTimeout("The read operation timed out", request=request)
            return httpx.Response(200, json={"choices": [{"message": {"content": '{"studies":[]}'}}]})
        router = GeminiKeyRouter(["secret-key"], interval_seconds=0, transport=httpx.MockTransport(respond))
        try:
            with patch("review_runner.time.sleep"):
                self.assertEqual(router.complete("Score papers", "test-model"), {"studies": []})
        finally:
            router.close()
        self.assertEqual(len(requests), 3)
        self.assertEqual(router.usage["requests"], 3)

    def test_jev_retries_read_timeout_and_succeeds(self):
        import httpx
        requests = []
        def respond(request):
            requests.append(request)
            if len(requests) == 1:
                raise httpx.ReadTimeout("The read operation timed out", request=request)
            return httpx.Response(200, json={"answers": {
                "temporal_kg": {"choice": "YES"},
                "inductive_generalization": {"choice": "UNKNOWN"},
                "relevant_task": {"choice": "YES"}}})
        classifier = JevClassifier("test-key", transport=httpx.MockTransport(respond))
        try:
            with patch("review_runner.time.sleep"):
                result = classifier.classify({"title": "A", "abstract": "B"}, "Topic")
        finally:
            classifier.close()
        self.assertEqual(result["temporal_kg"], "YES")
        self.assertEqual(len(requests), 2)

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

    def test_direction_coverage_is_topic_relative_even_for_one_study(self):
        article = {"id": "A-1", "title": "Emerging direction", "year": "2025", "venue": "V", "source": "arxiv",
                   "doi": "", "source_url": "", "screening_decision": "include", "scope": "core", "text_status": "full_text"}
        span = {"id": "E-1", "article_id": "A-1",
                "exact_text": "We evaluate inductive temporal knowledge graph completion for unseen entities using a public benchmark dataset.",
                "text": "We evaluate inductive temporal knowledge graph completion for unseen entities using a public benchmark dataset.",
                "section": "full_text", "source_level": "full_text", "evidence_type": "task", "grounded": True, "confidence": "high"}
        output = build_outputs([article], [{"article_id": "A-1", "decision": "include", "scope": "core"}], [span], {}, [], 0, "2026")
        direction = next(row for row in output["research_directions"] if row["dimension"] == "unseen_entity")
        self.assertEqual(direction["identified_study_count"], 1)
        self.assertEqual(direction["deep_reviewed_study_count"], 1)
        self.assertEqual(direction["coverage"], 1.0)
        self.assertIn(direction["maturity"], ("emerging", "sparse"))
        self.assertTrue(output["quality_gate"]["deep_evidence_sufficient"])

    def test_report_separates_sparse_areas_candidates_and_verified_gaps(self):
        article = {"id": "A-1", "title": "One supported study", "year": "2025", "venue": "V", "source": "arxiv",
                   "doi": "", "source_url": "", "screening_decision": "include", "scope": "core", "text_status": "full_text"}
        span = {"id": "E-1", "article_id": "A-1",
                "exact_text": "We propose an inductive temporal knowledge graph method for unseen entities and evaluate it on a public benchmark.",
                "text": "We propose an inductive temporal knowledge graph method for unseen entities and evaluate it on a public benchmark.",
                "section": "full_text", "source_level": "full_text", "evidence_type": "method", "grounded": True, "confidence": "high"}
        output = build_outputs([article], [{"article_id": "A-1", "decision": "include", "scope": "core"}], [span], {}, [], 0, "2026")
        markdown = report(output)
        for heading in ("## Literature Landscape", "## Research Directions", "## Cross-paper Findings",
                        "## Emerging / Sparse Areas", "## Underexplored Intersections",
                        "## Candidate Research Gaps", "## Counter-search findings"):
            self.assertIn(heading, markdown)
        self.assertIn("[single-study observation]", markdown)
        self.assertIn("No candidate had a completed counter-search", markdown)

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
            self.assertEqual(gap["verification_status"], "no_counterevidence_found")
            self.assertEqual(gap["status"], "no_counterevidence_found")
            self.assertIn("UNKNOWN", gap["statement"])
            self.assertGreaterEqual(len(gap["supporting_claim_ids"]), 1)
            self.assertEqual(len(gap["counter_queries"]), 3)
            self.assertTrue(all(row["query_kind"] == "gap_counter_search" for row in gap["counter_queries"]))
            self.assertEqual(len({row["alternative_term"] for row in gap["counter_queries"]}), 3)
            self.assertEqual(data["bounded_gap_findings"][0]["id"], gap["id"])

    def test_crossref_graph_metadata_keeps_and_deduplicates_references(self):
        import httpx
        requested = []
        def respond(request):
            requested.append(str(request.url))
            return httpx.Response(200, json={"message": {"reference": [
                {"DOI": "https://doi.org/10.1000/SHARED", "article-title": "Shared paper"},
                {"DOI": "10.1000/shared", "article-title": "Shared paper", "author": "Nguyen T", "year": "2022", "journal-title": "Journal of Examples"},
                {"article-title": "Another paper"},
                {"unstructured": "Another paper"},
                {"unstructured": "A cited work. doi:10.1000/UNSTRUCTURED."},
            ]}})
        references, complete = crossref_references("10.1000/example", transport=httpx.MockTransport(respond))
        self.assertTrue(complete)
        self.assertEqual(references, [
            {"doi": "10.1000/shared", "title": "Shared paper", "authors": "Nguyen T", "year": "2022", "journal": "Journal of Examples"},
            {"doi": "", "title": "Another paper", "authors": "", "year": "", "journal": ""},
            {"doi": "10.1000/unstructured", "title": "A cited work. doi:10.1000/UNSTRUCTURED.", "authors": "", "year": "", "journal": ""},
        ])
        self.assertEqual(requested, ["https://api.crossref.org/works/10.1000%2Fexample"])
        looked_up = []
        def fetch(doi, email, title=""):
            looked_up.append(doi)
            return [{"doi": "10.1000/shared"}], True
        metadata = build_citation_metadata([
            {"doi": "10.1000/EXAMPLE"}, {"doi": "https://doi.org/10.1000/example"},
            {"doi": ""}, {"doi": "10.1000/other"},
        ], fetcher=fetch, metadata_fetcher=lambda _title, _url: {}, reference_fetcher=lambda *_: ([], "not_found"),
           openalex_fetcher=lambda *_: ([], "not_found"))
        self.assertEqual(set(looked_up), {"10.1000/example", "10.1000/other"})
        self.assertEqual(metadata["queried"], 2)
        self.assertEqual(metadata["failed"], 0)

    def test_crossref_graph_matches_title_when_doi_is_missing(self):
        import httpx
        def respond(request):
            self.assertEqual(request.url.path, "/works")
            return httpx.Response(200, json={"message": {"items": [
                {"title": ["Different paper"], "reference": [{"DOI": "10.1000/wrong"}]},
                {"title": ["Paper Without DOI"], "reference": [{"article-title": "Cited work"}]},
            ]}})
        references, complete = crossref_references("", title="Paper Without DOI", transport=httpx.MockTransport(respond))
        self.assertTrue(complete)
        self.assertEqual(references, [{"doi": "", "title": "Cited work", "authors": "", "year": "", "journal": ""}])
        unmatched, complete = crossref_references("", title="Unrelated topic", transport=httpx.MockTransport(respond))
        self.assertTrue(complete)
        self.assertEqual(unmatched, [])
        lookups = []
        def fetch(doi, email, title=""):
            lookups.append((doi, title))
            return references, True
        metadata = build_citation_metadata([
            {"title": "Paper Without DOI"}, {"title": "Paper Without DOI"},
            {"doi": "10.1000/known", "title": "Known work"},
        ], fetcher=fetch, metadata_fetcher=lambda _title, _url: {}, reference_fetcher=lambda *_: ([], "not_found"),
           openalex_fetcher=lambda *_: ([], "not_found"))
        self.assertEqual(set(lookups), {("", "Paper Without DOI"), ("10.1000/known", "Known work")})
        self.assertEqual(metadata["queried"], 2)
        self.assertEqual(metadata["papers"][0]["title"], "Paper Without DOI")

    def test_crossref_graph_retries_by_title_when_doi_is_not_in_crossref(self):
        import httpx
        requested = []
        def respond(request):
            requested.append(request.url.path)
            if request.url.path.startswith("/works/"):
                return httpx.Response(404)
            return httpx.Response(200, json={"message": {"items": [
                {"title": ["OpenReview paper"], "reference": [{"DOI": "10.1000/cited"}]},
            ]}})
        references, complete = crossref_references("10.1000/not-crossref", title="OpenReview paper", transport=httpx.MockTransport(respond))
        self.assertTrue(complete)
        self.assertEqual(requested, ["/works/10.1000/not-crossref", "/works"])
        self.assertEqual(references[0]["doi"], "10.1000/cited")

    def test_openreview_graph_enriches_only_exact_public_note(self):
        import httpx
        observed = []
        def respond(request):
            observed.append((request.url.path, dict(request.url.params)))
            return httpx.Response(200, json={"notes": [
                {"id": "other", "content": {"title": {"value": "Another paper"}}},
                {"id": "note-123", "pdate": 1735689600000, "content": {
                    "title": {"value": "OpenReview paper"}, "authors": {"value": ["Ada Lovelace"]},
                    "abstract": {"value": "Abstract text"}, "venue": {"value": "ICLR"},
                    "pdf": {"value": "/pdf/note-123.pdf"}}},
            ]})
        transport = httpx.MockTransport(respond)
        found = openreview_metadata("OpenReview paper", transport=transport)
        self.assertEqual(found["authors"], "Ada Lovelace")
        self.assertEqual(found["year"], "2025")
        self.assertEqual(found["pdf_url"], "https://openreview.net/pdf/note-123.pdf")
        self.assertEqual(observed[0][0], "/notes/search")
        by_id = openreview_metadata("Old title", "https://openreview.net/forum?id=note-123", transport=transport)
        self.assertEqual(by_id["url"], "https://openreview.net/forum?id=note-123")
        self.assertEqual(observed[1][0], "/notes")
        self.assertEqual(openreview_metadata("Unrelated title", transport=transport), {})

        metadata = build_citation_metadata([{"doi": "10.1000/example", "title": "OpenReview paper",
                                            "source_url": "https://openreview.net/forum?id=note-123"}],
                                           fetcher=lambda _doi, _email, title="": ([], True),
                                           metadata_fetcher=lambda title, url: openreview_metadata(title, url, transport=transport),
                                           reference_fetcher=lambda *_: ([], "not_found"),
                                           openalex_fetcher=lambda *_: ([], "not_found"))
        self.assertEqual(metadata["version"], 9)
        self.assertEqual(metadata["papers"][0]["openreview"]["abstract"], "Abstract text")

    def test_semantic_scholar_fills_missing_crossref_references_with_all_pages(self):
        import httpx
        requests = []
        def respond(request):
            requests.append((request.url.path, dict(request.url.params)))
            if request.url.path.endswith("/references"):
                offset = int(request.url.params.get("offset", "0"))
                item = {"citedPaper": {"title": "Shared cited paper" if offset == 0 else "Second cited paper",
                                        "year": 2024, "authors": [{"name": "Ada Lovelace"}],
                                        "externalIds": {"DOI": "10.1000/shared" if offset == 0 else "10.1000/second"}}}
                return httpx.Response(200, json={"data": [item], "next": 1 if offset == 0 else None})
            return httpx.Response(404)
        refs, status = semantic_scholar_references("10.1000/source", title="Source paper", transport=httpx.MockTransport(respond))
        self.assertEqual(status, "found")
        self.assertEqual([ref["doi"] for ref in refs], ["10.1000/shared", "10.1000/second"])
        self.assertEqual(refs[0]["authors"], "Ada Lovelace")
        self.assertEqual([params.get("offset") for path, params in requests if path.endswith("/references")], ["0", "1"])

        metadata = build_citation_metadata([{"doi": "10.1000/source", "title": "Source paper"}],
                                           fetcher=lambda _doi, _email, title="": ([], True),
                                           metadata_fetcher=lambda _title, _url: {},
                                           reference_fetcher=lambda *_: (refs, "found"),
                                           openalex_fetcher=lambda *_: ([], "not_found"))
        self.assertEqual(metadata["papers"][0]["lookup_status"], "found")
        self.assertEqual(metadata["papers"][0]["semantic_scholar_count"], 2)

    def test_semantic_scholar_rejects_nonexact_title_match(self):
        import httpx
        def respond(request):
            if request.url.path == "/graph/v1/paper/search/match":
                return httpx.Response(200, json={"data": [{"paperId": "wrong", "title": "Another paper"}]})
            self.fail("A non-exact title must not fetch references")
        refs, status = semantic_scholar_references(title="Target paper", transport=httpx.MockTransport(respond))
        self.assertEqual((refs, status), ([], "not_found"))

    def test_openalex_fills_missing_references_and_preserves_cited_ids(self):
        import httpx
        paths = []
        def respond(request):
            paths.append(request.url.path)
            if request.url.path.startswith("/works/"):
                return httpx.Response(200, json={"id": "https://openalex.org/W1", "title": "Source paper",
                                                 "referenced_works": ["https://openalex.org/W2", "https://openalex.org/W3"]})
            return httpx.Response(200, json={"results": [{"id": "https://openalex.org/W2", "title": "Cited paper",
                                                         "doi": "https://doi.org/10.1000/cited", "publication_year": 2022,
                                                         "authorships": [{"author": {"display_name": "Ada Lovelace"}}],
                                                         "primary_location": {"source": {"display_name": "Test Journal"}}}]})
        refs, status = openalex_references("10.1000/source", "Source paper", transport=httpx.MockTransport(respond))
        self.assertEqual(status, "found")
        self.assertEqual([ref["id"] for ref in refs], ["W2", "W3"])
        self.assertEqual(refs[0]["authors"], "Ada Lovelace")
        self.assertEqual(refs[0]["doi"], "10.1000/cited")
        self.assertEqual(refs[1]["title"], "OpenAlex W3")
        self.assertEqual(paths, ["/works/https://doi.org/10.1000/source", "/works"])

        metadata = build_citation_metadata([{"doi": "10.1000/source", "title": "Source paper"}],
                                           fetcher=lambda _doi, _email, title="": ([], True),
                                           metadata_fetcher=lambda _title, _url: {},
                                           openalex_fetcher=lambda *_: (refs, "found"),
                                           reference_fetcher=lambda *_: self.fail("Semantic Scholar should not run when OpenAlex has references"))
        self.assertEqual(metadata["papers"][0]["openalex_count"], 2)
        self.assertEqual(metadata["failed"], 0)

        union = build_citation_metadata([{"doi": "10.1000/source", "title": "Source paper"}],
                                        fetcher=lambda _doi, _email, title="": ([{"doi": "10.1000/cited", "title": "Cited paper"}], True),
                                        metadata_fetcher=lambda _title, _url: {},
                                        openalex_fetcher=lambda *_: (refs, "found"),
                                        reference_fetcher=lambda *_: self.fail("Semantic Scholar should not run when references exist"))
        self.assertEqual(len(union["papers"][0]["references"]), 2)
        self.assertEqual(union["papers"][0]["reference_source"], "Crossref + OpenAlex")

    def test_graph_looks_up_every_paper_even_without_doi(self):
        attempted = []
        def openalex(doi, title, key):
            attempted.append((doi, title))
            return [], "not_found"
        metadata = build_citation_metadata([
            {"doi": "10.1000/one", "title": "Paper one"},
            {"doi": "", "title": "Paper two"},
            {"doi": "", "title": "", "arxiv_id": "2501.12345"},
        ], fetcher=lambda _doi, _email, title="": ([], True),
            metadata_fetcher=lambda _title, _url: {},
            openalex_fetcher=openalex,
            reference_fetcher=lambda *_: ([], "not_found"))
        self.assertEqual(metadata["queried"], 3)
        self.assertEqual(len(attempted), 3)
        self.assertEqual([paper["lookup_status"] for paper in metadata["papers"]], ["no_refs_found"] * 3)

    def test_graph_looks_up_papers_concurrently_and_preserves_order(self):
        from threading import Barrier

        started = Barrier(3)
        def openalex(doi, _title, _key):
            started.wait(timeout=3)
            suffix = doi.rsplit("/", 1)[-1]
            return [{"doi": f"10.2000/{suffix}", "title": f"Cited {suffix}"}], "found"

        metadata = build_citation_metadata(
            [{"doi": f"10.1000/{index}", "title": f"Paper {index}"} for index in range(3)],
            fetcher=lambda _doi, _email, title="": ([], True),
            metadata_fetcher=lambda _title, _url: {},
            openalex_fetcher=openalex,
            reference_fetcher=lambda *_: self.fail("Semantic Scholar should not run"),
        )
        self.assertEqual([paper["doi"] for paper in metadata["papers"]], [f"10.1000/{index}" for index in range(3)])
        self.assertEqual([paper["references"][0]["doi"] for paper in metadata["papers"]], [f"10.2000/{index}" for index in range(3)])
        self.assertEqual(metadata["failed"], 0)


if __name__ == "__main__":
    unittest.main()
