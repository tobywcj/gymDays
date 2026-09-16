"""Client-scoped tools for the AI crew.

Every tool checks that the operation is for the exact client_id the run was
started with — cross-client access is refused even if the DB would allow it
(which it wouldn't, service-role aside, but defence-in-depth matters).
"""
from __future__ import annotations
import json
from typing import Any, Type
from pydantic import BaseModel, Field
from crewai.tools import BaseTool
from ai.db import get_db
from ai.embeddings import embed


# ── Schema types ─────────────────────────────────────────────────────────────

class WriteProfileInput(BaseModel):
    client_id: str = Field(description="UUID of the client to update.")
    profile:   dict = Field(description="Structured profile dict (goal, equipment, schedule, injury_history, …).")

class WriteMemoryInput(BaseModel):
    client_id: str  = Field(description="UUID of the client.")
    kind:      str  = Field(description="One of: onboarding_note, preference, constraint, progress_summary, message_log, nutrition_note.")
    content:   str  = Field(description="The memory content to store and embed.")

class GetProfileInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")

class SearchMemoryInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")
    query:     str = Field(description="Natural-language query to find relevant memories.")
    limit:     int = Field(default=5, description="Max memories to return.")


# ── Tool factory — binds each tool to a specific client_id ───────────────────

def make_client_tools(run_client_id: str) -> list[BaseTool]:
    """Return tool instances scoped to *run_client_id*."""
    return [
        WriteClientProfile(run_client_id=run_client_id),
        WriteClientMemory(run_client_id=run_client_id),
        GetClientProfile(run_client_id=run_client_id),
        SearchClientMemory(run_client_id=run_client_id),
    ]


def _check_scope(tool_name: str, run_id: str, requested_id: str) -> None:
    if run_id != requested_id:
        raise PermissionError(
            f"[{tool_name}] Attempted cross-client access: "
            f"run_client_id={run_id!r}, requested={requested_id!r}"
        )


# ── Tools ─────────────────────────────────────────────────────────────────────

class WriteClientProfile(BaseTool):
    name: str = "write_client_profile"
    description: str = (
        "Persist a structured profile for the client. Call this once you have "
        "extracted goal, equipment, schedule, and injury_history from the transcript."
    )
    args_schema: Type[BaseModel] = WriteProfileInput
    run_client_id: str

    def _run(self, client_id: str, profile: dict) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        # Flatten top-level fields into columns when present.
        update: dict[str, Any] = {"profile": profile}
        if "goal" in profile:
            update["goal"] = profile["goal"]
        if "injury_history" in profile:
            update["injury_history"] = profile["injury_history"]
        if "equipment" in profile:
            update["equipment"] = profile["equipment"]
        if "schedule" in profile:
            update["schedule"] = profile["schedule"]
        db.table("clients").update(update).eq("id", client_id).execute()
        return f"Profile written for client {client_id}."


class WriteClientMemory(BaseTool):
    name: str = "write_client_memory"
    description: str = (
        "Store a single memory note for the client. Call this for every distinct "
        "fact, preference, or constraint you want to remember. "
        "kind must be one of: onboarding_note, preference, constraint, "
        "progress_summary, message_log, nutrition_note."
    )
    args_schema: Type[BaseModel] = WriteMemoryInput
    run_client_id: str

    def _run(self, client_id: str, kind: str, content: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        row: dict[str, Any] = {
            "client_id": client_id,
            "kind": kind,
            "content": content,
        }
        # Trainer_id required by schema — look it up.
        resp = db.table("clients").select("trainer_id").eq("id", client_id).single().execute()
        row["trainer_id"] = resp.data["trainer_id"]

        vec = embed(content)
        if vec is not None:
            row["embedding"] = vec
        db.table("client_memory").insert(row).execute()
        return f"Memory stored ({kind}): {content[:60]}…"


class GetClientProfile(BaseTool):
    name: str = "get_client_profile"
    description: str = "Retrieve the current profile and basic info for a client."
    args_schema: Type[BaseModel] = GetProfileInput
    run_client_id: str

    def _run(self, client_id: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        resp = db.table("clients") \
            .select("name, goal, equipment, schedule, injury_history, profile, status, language") \
            .eq("id", client_id).single().execute()
        data = resp.data or {}
        # Safety: agents must weigh the WHOLE injury trail (past/recovered injuries
        # still warrant caution), not just the current official status. Aggregate
        # every distinct note from client_injury_log into injury_history — mirrors
        # the web caveat logic so LLM output and the suitability badges agree.
        try:
            log = db.table("client_injury_log").select("note, resolved_at") \
                .eq("client_id", client_id).execute()
            rows = log.data or []
            # Skip trainer-resolved entries — a closed injury must stop flagging.
            active = [r.get("note") for r in rows if not r.get("resolved_at")]
            candidates = active if rows else [data.get("injury_history")]
            seen: set[str] = set()
            parts: list[str] = []
            for raw in candidates:
                v = (raw or "").strip()
                if v and v.lower() not in seen:
                    seen.add(v.lower())
                    parts.append(v)
            data["injury_history"] = "; ".join(parts) if parts else None
        except Exception:
            pass  # fall back to the canonical column on any trail-read issue
        return json.dumps(data, default=str)


class SearchClientMemory(BaseTool):
    name: str = "search_client_memory"
    description: str = (
        "Semantic search over this client's stored memories. "
        "Returns the most relevant past notes."
    )
    args_schema: Type[BaseModel] = SearchMemoryInput
    run_client_id: str

    def _run(self, client_id: str, query: str, limit: int = 5) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        vec = embed(query)
        if vec is not None:
            # pgvector similarity search via RPC.
            resp = db.rpc("match_client_memory", {
                "p_client_id": client_id,
                "p_query": vec,
                "p_limit": limit,
            }).execute()
        else:
            # Fallback: most recent memories.
            resp = db.table("client_memory") \
                .select("kind, content, created_at") \
                .eq("client_id", client_id) \
                .order("created_at", desc=True) \
                .limit(limit) \
                .execute()
        return json.dumps(resp.data, default=str)
