"""M8 — Nutrition Agent tests.

Strategy: mock httpx.get for Open Food Facts; let everything else hit the real
cloud DB. Verify caching (no second HTTP call) + the agent's markdown advice is
persisted to meal_plans as {type: "advice"} (one row per week, replaced on re-run).
"""
from __future__ import annotations
import json
import pytest
from unittest.mock import patch, MagicMock
from ai.integrations.nutrition import lookup_food
from ai.crew.tools.nutrition import LookupFood, WriteNutritionAdvice, GetActiveProgram
from ai.crew.flows import weekly_nutrition_flow
from ai.db import get_db


def _off_response_for(query: str, *, kcal: float, protein: float, carbs: float, fat: float) -> dict:
    """Build an Open Food Facts search response shape that our wrapper accepts."""
    return {
        "products": [{
            "code": f"fake-{query}",
            "product_name": query.title(),
            "brands": "Test Brand",
            "nutriments": {
                "energy-kcal_100g": kcal,
                "proteins_100g":    protein,
                "carbohydrates_100g": carbs,
                "fat_100g":         fat,
            },
        }],
    }


@pytest.fixture(autouse=True)
def _clear_food_cache():
    """Each test starts with a clean cache for the queries it uses."""
    db = get_db()
    db.table("food_cache").delete().like("external_id", "test-%").execute()
    yield
    db.table("food_cache").delete().like("external_id", "test-%").execute()


# ── Unit: Open Food Facts wrapper + cache ────────────────────────────────────

class TestLookupFoodCaching:
    def test_first_call_hits_off_then_cache_serves_second(self):
        query = "test-rolled-oats"
        with patch("ai.integrations.nutrition.httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json.return_value = _off_response_for(query, kcal=379, protein=13, carbs=68, fat=7)
            mock_get.return_value = mock_resp

            first  = lookup_food(query)
            second = lookup_food(query)

            assert first  is not None
            assert second is not None
            assert first["source"]  == "openfoodfacts"
            assert second["source"] == "cache"
            assert first["per_100g"]["kcal"] == 379
            # ONE outbound HTTP call total — the second was served from cache.
            assert mock_get.call_count == 1


# ── Unit: WriteNutritionAdvice ───────────────────────────────────────────────

ADVICE = """## Goal Alignment
- 🎯 Fuel fat loss while keeping protein high

## What to Eat
- 🥣 Rolled oats (379 kcal / 100g)
"""


class TestWriteNutritionAdvice:
    def test_writes_advice_row_replacing_same_week(self, test_client_id, db):
        tool = WriteNutritionAdvice(run_client_id=test_client_id)
        tool._run(client_id=test_client_id, advice="old advice")
        msg = tool._run(client_id=test_client_id, advice=ADVICE)
        assert "saved" in msg.lower()

        rows = db.table("meal_plans").select("plan").eq("client_id", test_client_id).execute().data
        assert len(rows) == 1, "re-running in the same week must replace, not append"
        assert rows[0]["plan"]["type"] == "advice"
        assert rows[0]["plan"]["advice"] == ADVICE

    def test_refuses_cross_client_access(self, test_client_id):
        tool = WriteNutritionAdvice(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(client_id="00000000-0000-0000-0000-000000000000", advice="x")


class TestGetActiveProgram:
    def test_refuses_cross_client_access(self, test_client_id):
        tool = GetActiveProgram(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(client_id="00000000-0000-0000-0000-000000000000")


# ── Integration: full nutrition flow (LLM mocked, OFF mocked) ────────────────

_FIXTURE_FOODS = {
    "test-rolled-oats":     {"kcal": 379, "protein": 13, "carbs": 68, "fat": 7},
    "test-chicken-breast":  {"kcal": 165, "protein": 31, "carbs": 0,  "fat": 4},
    "test-brown-rice":      {"kcal": 124, "protein": 3,  "carbs": 26, "fat": 1},
}


def _simulate_agent(client_id: str) -> str:
    """Stand-in for crew.kickoff(): look up each fixture food, then write advice
    citing them — the same tool calls the real agent's workflow makes."""
    look = LookupFood()
    lines = ["## What to Eat"]
    for q in _FIXTURE_FOODS:
        food = json.loads(look._run(query=q))
        lines.append(f"- {q}: {food['per_100g']['kcal']} kcal / 100g")
    WriteNutritionAdvice(run_client_id=client_id)._run(client_id=client_id, advice="\n".join(lines))
    return "Nutrition advice saved."


class TestNutritionFlow:
    def test_advice_persisted_and_cache_avoids_second_off_call(self, test_client_id, db):
        with patch("ai.integrations.nutrition.httpx.get") as mock_get, \
             patch("ai.crew.agents.make_llm", return_value="openai/gpt-4o-mini"), \
             patch("ai.crew.flows.Crew") as MockCrew:

            def stub_off(url, params=None, **kwargs):
                query = (params or {}).get("search_terms", "")
                food = _FIXTURE_FOODS.get(query)
                assert food, f"unexpected OFF query in test: {query!r}"
                m = MagicMock()
                m.raise_for_status = MagicMock()
                m.json.return_value = _off_response_for(
                    query, kcal=food["kcal"], protein=food["protein"],
                    carbs=food["carbs"], fat=food["fat"],
                )
                return m
            mock_get.side_effect = stub_off
            MockCrew.return_value.kickoff.side_effect = lambda: _simulate_agent(test_client_id)

            weekly_nutrition_flow(client_id=test_client_id)
            first_call_count = mock_get.call_count
            assert first_call_count == len(_FIXTURE_FOODS)

            # Re-run — every lookup_food is now served from food_cache.
            weekly_nutrition_flow(client_id=test_client_id)
            assert mock_get.call_count == first_call_count, "cache should have prevented further HTTP calls"

        rows = db.table("meal_plans").select("plan").eq("client_id", test_client_id).execute().data
        assert len(rows) == 1
        advice = rows[0]["plan"]["advice"]
        for food, info in _FIXTURE_FOODS.items():
            assert f"{food}: {info['kcal']}" in advice
