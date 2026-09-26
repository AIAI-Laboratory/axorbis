"""Desktop bridge for SynthScholar-powered CS literature mapping."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        temporary = Path(handle.name)
    temporary.replace(path)


def normalize_doi(value: object) -> str:
    if not isinstance(value, str):
        return ""
    doi = value.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "doi:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):]
            break
    return doi if doi.startswith("10.") and "/" in doi and not any(char.isspace() for char in doi) else ""


def crossref_references(doi: str, email: str = "", transport=None) -> tuple[list[dict], bool]:
    """Return DOI references for one work and whether the lookup was conclusive."""
    import httpx

    headers = {"User-Agent": "AxorbisLiteratureReview/0.1" + (f" (mailto:{email})" if email else "")}
    url = f"https://api.crossref.org/works/{quote(doi, safe='')}"
    try:
        with httpx.Client(timeout=15, headers=headers, transport=transport) as client:
            for attempt in range(3):
                response = client.get(url)
                if response.status_code == 404:
                    return [], True
                if response.status_code in (429, 502, 503, 504) and attempt < 2:
                    time.sleep(0.5 * (2 ** attempt))
                    continue
                response.raise_for_status()
                data = response.json().get("message") or {}
                references = []
                for item in data.get("reference") or []:
                    cited_doi = normalize_doi(item.get("DOI")) if isinstance(item, dict) else ""
                    if cited_doi:
                        references.append({"doi": cited_doi, "title": item.get("article-title") or cited_doi})
                return list({item["doi"]: item for item in references}.values()), True
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        pass
    return [], False


def build_citation_metadata(articles: list[dict], fetcher=crossref_references) -> dict:
    dois = list(dict.fromkeys(
        doi for article in articles if isinstance(article, dict)
        if (doi := normalize_doi(article.get("doi")))
    ))
    email = os.environ.get("SYNTHSCHOLAR_EMAIL", "").strip()
    papers = []
    failed = 0
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fetcher, doi, email): doi for doi in dois}
        for future in as_completed(futures):
            doi = futures[future]
            try:
                references, complete = future.result()
            except Exception:
                references, complete = [], False
            failed += not complete
            papers.append({"doi": doi, "references": references})
    papers.sort(key=lambda item: dois.index(item["doi"]))
    return {"source": "Crossref", "queried": len(dois), "failed": failed, "papers": papers}


def citation_graph_main() -> int:
    payload = json.load(sys.stdin)
    articles = payload.get("articles", [])
    if not isinstance(articles, list):
        raise ValueError("Citation graph articles must be a list.")
    json.dump(build_citation_metadata(articles), sys.stdout, ensure_ascii=False)
    return 0


class GeminiKeyRouter:
    """Pace and rotate optional Gemini calls; publish only nonsecret usage."""

    def __init__(self, keys, labels=None, interval_seconds=5.0, on_metrics=None, transport=None):
        import httpx

        self.keys = keys
        self.interval_seconds = interval_seconds
        self.on_metrics = on_metrics
        self.next_index = 0
        self.next_at = 0.0
        self.metrics = [{"id": labels[index] if labels and index < len(labels) else f"Key {index + 1}",
                         "state": "idle", "active": False, "requests": 0, "tokens": 0}
                        for index in range(len(keys))]
        self.usage = {"input": 0, "output": 0, "total": 0, "requests": 0}
        self.client = httpx.Client(timeout=60, transport=transport)

    def publish(self):
        if self.on_metrics:
            self.on_metrics([item.copy() for item in self.metrics], self.usage.copy())

    def complete(self, prompt: str, model: str) -> dict:
        if not self.keys:
            return {}
        index = self.next_index
        self.next_index = (index + 1) % len(self.keys)
        wait = max(0.0, self.next_at - time.monotonic())
        if wait:
            time.sleep(wait)
        self.next_at = time.monotonic() + self.interval_seconds
        metric = self.metrics[index]
        metric["active"] = True
        metric["state"] = "active"
        metric["requests"] += 1
        self.usage["requests"] += 1
        self.publish()
        try:
            response = self.client.post(
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                headers={"Authorization": f"Bearer {self.keys[index]}", "Content-Type": "application/json"},
                json={"model": model, "messages": [
                    {"role": "system", "content": "Return one valid JSON object only. Do not invent sources or evidence."},
                    {"role": "user", "content": prompt},
                ]},
            )
            metric["state"] = "rate-limited" if response.status_code == 429 else "error" if response.status_code >= 400 else "idle"
            response.raise_for_status()
            result = response.json()
            usage = result.get("usage") or {}
            input_tokens = int(usage.get("prompt_tokens") or 0)
            output_tokens = int(usage.get("completion_tokens") or 0)
            total_tokens = int(usage.get("total_tokens") or input_tokens + output_tokens)
            metric["tokens"] += total_tokens
            self.usage["input"] += input_tokens
            self.usage["output"] += output_tokens
            self.usage["total"] += total_tokens
            content = ((result.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            content = content.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            return json.loads(content) if content else {}
        finally:
            metric["active"] = False
            if metric["state"] == "active":
                metric["state"] = "error"
            self.publish()

    def close(self):
        self.client.close()


def main() -> int:
    from cs_engine import run

    run_dir = Path(sys.argv[1]).resolve()
    payload = json.load(sys.stdin)
    sys.stdin.close()
    openalex_api_key = payload.get("openalexApiKey") or ""
    provider_keys = {"semantic_scholar": payload.get("semanticScholarApiKey") or "",
                     "core": payload.get("coreApiKey") or ""}
    api_keys = [value for value in payload.get("apiKeys", []) if isinstance(value, str) and value]
    secrets = [value for value in (openalex_api_key, *provider_keys.values(), *api_keys) if value]
    status_path = run_dir / "status.json"
    status = json.loads(status_path.read_text(encoding="utf-8"))

    def scrub(value: str) -> str:
        for secret in secrets:
            value = value.replace(secret, "[REDACTED]")
        return value

    def update(stage: str, message: str) -> None:
        status["pipelineStatus"] = stage
        status["updatedAt"] = datetime.now(timezone.utc).isoformat()
        if stage in ("insufficient_evidence", "mapping_complete"):
            status["completedAt"] = int(datetime.now(timezone.utc).timestamp() * 1000)
        status.setdefault("progress", []).append(scrub(message))
        status["progress"] = status["progress"][-1000:]
        snapshot_path = run_dir / "review.json"
        if snapshot_path.is_file():
            snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
            status["articles"] = [{"pmid": a["pmid"], "title": a["title"], "abstract": a["abstract"],
                                    "year": a["year"], "source": a["source"], "doi": a["doi"],
                                    "state": a["screening_decision"], "reason": ""} for a in snapshot["articles"]]
            status["qualityGate"] = snapshot["quality_gate"]
        if stage in ("insufficient_evidence", "mapping_complete"):
            status["state"] = stage
        write_json(status_path, status)

    def on_key_metrics(metrics, usage):
        status["keyUsage"] = metrics
        status["tokenUsage"] = usage
        write_json(status_path, status)

    try:
        protocol = payload["protocol"]
        write_json(run_dir / "protocol.json", protocol)
        status["parallelLimit"] = 1
        write_json(status_path, status)
        router = GeminiKeyRouter(api_keys, payload.get("keyLabels"), on_metrics=on_key_metrics)
        try:
            data = run(protocol, int(payload.get("maxResults", 20)), run_dir, update,
                       openalex_api_key=openalex_api_key, provider_keys=provider_keys,
                       model_assist=(lambda prompt: router.complete(prompt, payload.get("model", "gemini-3.5-flash-lite"))) if api_keys else None)
        finally:
            router.close()
        status["includedArticles"] = data["quality_gate"]["included_papers"]
        status["articles"] = [{**a, "state": a["screening_decision"], "reason": "", "pmid": a["pmid"]} for a in data["articles"]]
        status["qualityGate"] = data["quality_gate"]
        write_json(status_path, status)
        return 0
    except Exception as error:
        status["state"] = "failed"
        status["pipelineStatus"] = "failed"
        status["completedAt"] = int(datetime.now(timezone.utc).timestamp() * 1000)
        status["error"] = scrub(str(error))
        write_json(status_path, status)
        print(scrub(traceback.format_exc()), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(citation_graph_main() if len(sys.argv) > 1 and sys.argv[1] == "--citation-graph" else main())
