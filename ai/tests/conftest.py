"""Shared fixtures for AI service tests."""
import pytest
from ai.db import get_db

FIXTURE_TRANSCRIPT = """
Hi! I'm Alex Rivera, 32, and I want to work with a trainer to lose about 8kg
before my sister's wedding in 4 months. I have a pair of adjustable dumbbells
(up to 24kg each) and a pull-up bar at home. I can train Monday, Wednesday,
and Friday evenings — around 6pm. I had a lower-back injury two years ago from
a deadlift; it's mostly healed but I should avoid heavy loaded flexion for now.
I'm also lactose intolerant, so any nutrition suggestions should be dairy-free.
"""


@pytest.fixture(scope="session")
def db():
    return get_db()


@pytest.fixture
def test_client_id(db):
    """Create a throwaway client row, yield its id, then clean up."""
    # Seed a trainer if none exist.
    trainer_resp = db.table("trainers") \
        .select("id").limit(1).execute()
    if not trainer_resp.data:
        pytest.skip("No trainers in DB — run web/scripts/seed-test-users.mjs first")
    trainer_id = trainer_resp.data[0]["id"]

    client_resp = db.table("clients").insert({
        "trainer_id": trainer_id,
        "name": "AI Test Client",
        "goal": "Initial",
    }).execute()
    client_id = client_resp.data[0]["id"]

    yield client_id

    # Teardown — cascades to client_memory.
    db.table("clients").delete().eq("id", client_id).execute()
