"""Live smoke tests against real LLM providers.

These call out to OpenAI and Anthropic — they cost a few cents and need
internet + valid keys. Run with: pytest -m live (skipped otherwise).
"""
from __future__ import annotations
import json
import pytest
from ai.config import OPENAI_API_KEY, ANTHROPIC_API_KEY
from ai.llm import make_llm
from ai.crew.flows import onboarding_flow
from ai.tests.conftest import FIXTURE_TRANSCRIPT


pytestmark = pytest.mark.live


@pytest.mark.skipif(not OPENAI_API_KEY, reason="OPENAI_API_KEY not set")
def test_live_openai_simple_call():
    """Smallest possible OpenAI call — confirms the key + plumbing work."""
    llm = make_llm("openai/gpt-4o-mini")
    reply = llm.call([
        {"role": "user", "content": "Reply with exactly the word: pong"}
    ])
    assert "pong" in reply.lower()


@pytest.mark.skipif(not ANTHROPIC_API_KEY, reason="ANTHROPIC_API_KEY not set")
def test_live_anthropic_simple_call():
    """Smallest possible Claude call — confirms the key + plumbing work."""
    llm = make_llm("anthropic/claude-haiku-4-5-20251001")
    reply = llm.call([
        {"role": "user", "content": "Reply with exactly the word: pong"}
    ])
    assert "pong" in reply.lower()


@pytest.mark.skipif(not ANTHROPIC_API_KEY, reason="ANTHROPIC_API_KEY not set")
def test_live_onboarding_with_claude(test_client_id, db):
    """End-to-end: real Claude run → tools → DB writes."""
    summary = onboarding_flow(
        client_id=test_client_id,
        transcript=FIXTURE_TRANSCRIPT,
    )
    # The agent might return a dict, a string, or something CrewAI-wrapped — be tolerant.
    assert summary is not None

    client_row = db.table("clients").select("goal, profile") \
        .eq("id", test_client_id).single().execute().data
    assert client_row["goal"], "Onboarding agent should have written a goal"

    memories = db.table("client_memory").select("kind, content") \
        .eq("client_id", test_client_id).execute().data
    assert len(memories) >= 3, f"Expected ≥3 memories, got {len(memories)}: {memories}"
