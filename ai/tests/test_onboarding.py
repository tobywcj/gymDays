"""M5 — Onboarding Agent tests.

Strategy:
  - Mock the LLM to return scripted tool calls (no OpenAI key needed).
  - Let tools write to the real Supabase cloud DB.
  - Assert DB state after the run.
"""
from __future__ import annotations
import json
import pytest
from unittest.mock import patch
from ai.crew.tools.client import WriteClientProfile, WriteClientMemory
from ai.crew.flows import onboarding_flow
from tests.conftest import FIXTURE_TRANSCRIPT


# ── Unit tests: tools in isolation ───────────────────────────────────────────

class TestWriteClientProfile:
    def test_writes_profile_to_db(self, test_client_id, db):
        tool = WriteClientProfile(run_client_id=test_client_id)
        profile = {
            "goal": "Lose 8kg before wedding",
            "equipment": ["adjustable dumbbells", "pull-up bar"],
            "schedule": {"notes": "Mon/Wed/Fri evenings ~6pm"},
            "injury_history": "Lower back — avoid heavy loaded flexion",
        }
        result = tool._run(client_id=test_client_id, profile=profile)
        assert "written" in result

        row = db.table("clients").select("goal, profile") \
            .eq("id", test_client_id).single().execute().data
        assert row["goal"] == "Lose 8kg before wedding"
        assert row["profile"]["equipment"] == ["adjustable dumbbells", "pull-up bar"]

    def test_refuses_cross_client_access(self, test_client_id):
        tool = WriteClientProfile(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(client_id="00000000-0000-0000-0000-000000000000", profile={})


class TestWriteClientMemory:
    def test_inserts_memory_row(self, test_client_id, db):
        tool = WriteClientMemory(run_client_id=test_client_id)
        tool._run(
            client_id=test_client_id,
            kind="onboarding_note",
            content="Client is lactose intolerant — all meal plans must be dairy-free.",
        )
        rows = db.table("client_memory").select("kind, content") \
            .eq("client_id", test_client_id).execute().data
        assert len(rows) >= 1
        assert any("lactose" in r["content"].lower() for r in rows)

    def test_refuses_cross_client_access(self, test_client_id):
        tool = WriteClientMemory(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(
                client_id="00000000-0000-0000-0000-000000000000",
                kind="onboarding_note",
                content="Should not be written.",
            )


# ── Integration test: full onboarding flow with mocked LLM ───────────────────

def _make_mock_crew_result(client_id: str) -> str:
    """Simulate CrewAI executing: 1× write_client_profile + 3× write_client_memory."""
    from ai.crew.tools.client import WriteClientProfile, WriteClientMemory

    profile = {
        "goal": "Lose 8kg before wedding in 4 months",
        "equipment": ["adjustable dumbbells 24kg", "pull-up bar"],
        "schedule": {"notes": "Mon/Wed/Fri evenings around 6pm"},
        "injury_history": "Lower back injury from deadlift 2 years ago — avoid heavy loaded flexion",
    }
    memories = [
        ("onboarding_note", "Client goal: lose 8kg before sister's wedding in 4 months."),
        ("constraint",      "Lower back injury — avoid heavy loaded spinal flexion."),
        ("preference",      "Lactose intolerant — all meal plans must be dairy-free."),
    ]

    WriteClientProfile(run_client_id=client_id)._run(client_id=client_id, profile=profile)
    for kind, content in memories:
        WriteClientMemory(run_client_id=client_id)._run(
            client_id=client_id, kind=kind, content=content
        )

    return json.dumps({"profile": profile, "memory_count": len(memories)})


class TestOnboardingFlow:
    def test_profile_written_and_memory_seeded(self, test_client_id, db):
        """Full onboarding flow: profile + ≥3 memory rows written to cloud DB."""

        # Patch make_llm so no real provider key is required (returning a model
        # id string is enough for Agent's pydantic validation), and Crew.kickoff
        # so our scripted tool calls run instead of a real LLM round-trip.
        with patch("ai.crew.agents.make_llm", return_value="openai/gpt-4o-mini"), \
             patch("ai.crew.flows.Crew") as MockCrew:
            instance = MockCrew.return_value
            instance.kickoff.side_effect = lambda: _make_mock_crew_result(test_client_id)

            onboarding_flow(
                client_id=test_client_id,
                transcript=FIXTURE_TRANSCRIPT,
            )

        # Assert profile was persisted.
        client = db.table("clients").select("goal, profile") \
            .eq("id", test_client_id).single().execute().data
        assert client["goal"] is not None
        assert "equipment" in client["profile"]

        # Assert ≥3 memory rows of kind onboarding_note or constraint/preference.
        memories = db.table("client_memory").select("kind") \
            .eq("client_id", test_client_id).execute().data
        assert len(memories) >= 3

    def test_tool_scope_isolation(self, test_client_id):
        """Tools must refuse to operate on a different client_id."""
        other_id = "00000000-0000-0000-0000-000000000000"
        with pytest.raises(PermissionError, match="cross-client"):
            WriteClientProfile(run_client_id=test_client_id)._run(
                client_id=other_id, profile={}
            )
