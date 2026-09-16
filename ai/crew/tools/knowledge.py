"""SearchKnowledgeBase — hybrid vector + full-text search over trainer's knowledge library."""
from __future__ import annotations

import json
from typing import Type

from pydantic import BaseModel, Field
from crewai.tools import BaseTool

from ai.db import get_db
from ai.embeddings import embed
from ai.knowledge import UNASSIGNED_TAG


class SearchKnowledgeInput(BaseModel):
    query: str = Field(description="What to look up in the trainer's knowledge library. Be specific.")
    limit: int = Field(default=5, description="Number of passages to return (1-10).")


class SearchKnowledgeBase(BaseTool):
    name: str = "search_knowledge_base"
    description: str = (
        "Hybrid semantic + keyword search over the trainer's knowledge library "
        "(uploaded articles, PDFs, research guidelines). "
        "Call this to ground recommendations in evidence BEFORE giving advice. "
        "Returns the most relevant passages, each with a `source` label (document "
        "title, and url when available). You MUST cite that `source` in your output "
        "for any claim you take from a passage."
    )
    args_schema: Type[BaseModel] = SearchKnowledgeInput
    run_client_id: str
    agent_tag: str  # e.g. "nutrition"; '' = no filter (all chunks)

    def _run(self, query: str, limit: int = 5) -> str:
        db = get_db()

        # Resolve trainer_id from the scoped client
        resp = db.table("clients").select("trainer_id").eq("id", self.run_client_id).single().execute()
        trainer_id = resp.data["trainer_id"]

        limit = max(1, min(limit, 10))
        vec = embed(query)

        if vec is not None:
            # Hybrid search: vector + full-text via RRF
            raw = db.rpc("match_knowledge_hybrid", {
                "p_trainer_id": trainer_id,
                "p_query":      query,
                "p_query_vec":  vec,
                "p_agent_tag":  self.agent_tag,
                "p_limit":      limit * 2,  # over-fetch for reranker
            }).execute()
            results: list[dict] = raw.data or []

            # Rerank with FlashRank when we have more than one result
            if len(results) > 1:
                try:
                    from flashrank import Ranker, RerankRequest  # type: ignore
                    ranker = Ranker()
                    reranked = ranker.rerank(
                        RerankRequest(
                            query=query,
                            passages=[{"text": r["content"], "id": idx} for idx, r in enumerate(results)],
                        )
                    )
                    results = [results[r["id"]] for r in reranked.results[:limit]]
                except Exception:
                    results = results[:limit]
            else:
                results = results[:limit]
        else:
            # Fallback: most recent chunks (no embeddings available). Apply the same
            # agent-tag scoping as match_knowledge_hybrid so this degraded path can't
            # leak another agent's chunks or shelved (unassigned) content. We over-fetch
            # and filter in Python to avoid brittle array filters on the query builder.
            raw = db.table("knowledge_chunks") \
                .select("id, doc_id, content, agent_tags, knowledge_docs(title, source_url)") \
                .eq("trainer_id", trainer_id) \
                .order("created_at", desc=True) \
                .limit(max(limit * 5, 25)) \
                .execute()
            rows: list[dict] = []
            for r in (raw.data or []):
                tags = r.get("agent_tags") or []
                # Mirror the RPC visibility rule: empty tags = shared with all; an
                # explicit agent_tag must be present; '' = no filter but still hide
                # unassigned. A specific agent never sees the unassigned sentinel.
                if tags:
                    visible = self.agent_tag in tags if self.agent_tag else UNASSIGNED_TAG not in tags
                else:
                    visible = True
                if not visible:
                    continue
                doc = r.pop("knowledge_docs", None) or {}
                r["title"] = doc.get("title")
                r["source_url"] = doc.get("source_url")
                r.pop("agent_tags", None)
                rows.append(r)
                if len(rows) >= limit:
                    break
            results = rows

        if not results:
            return "No relevant passages found in the knowledge library."

        # Attach a ready-to-use citation label for each passage so the agent can
        # cite the document it pulled a claim from.
        for r in results:
            title = (r.get("title") or "Knowledge library").strip()
            url = (r.get("source_url") or "").strip()
            r["source"] = f"{title} ({url})" if url else title

        return json.dumps(results, default=str)
