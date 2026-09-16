"""M8 — Nutrition Agent tests.

Strategy: mock httpx.get for Open Food Facts; let everything else hit the real
cloud DB. Verify caching (no second HTTP call) + the written plan respects
its own daily_targets within ±10%.
"""
from __future__ import annotations
import json
import pytest
from unittest.mock import patch, MagicMock
from ai.integrations.nutrition import lookup_food
from ai.crew.tools.nutrition import LookupFood, WriteMealPlan, GetActiveProgram
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


# ── Unit: WriteMealPlan ──────────────────────────────────────────────────────

class TestWriteMealPlan:
    def test_writes_meal_plan_row(self, test_client_id, db):
        tool = WriteMealPlan(run_client_id=test_client_id)
        plan = {
            "daily_targets": {"kcal": 2200, "protein_g": 150, "carbs_g": 250, "fat_g": 70},
            "days": [
                {"day": "Mon", "meals": [
                    {"name": "Breakfast", "items": [
                        {"food": "oats", "grams": 80, "kcal": 304, "protein_g": 11, "carbs_g": 56, "fat_g": 5},
                    ], "kcal_total": 304}
                ], "day_total": {"kcal": 2200, "protein_g": 150, "carbs_g": 250, "fat_g": 70}},
            ],
        }
        msg = tool._run(client_id=test_client_id, plan=plan)
        assert "written" in msg.lower()

        rows = db.table("meal_plans").select("plan").eq("client_id", test_client_id).execute().data
        assert len(rows) == 1
        assert rows[0]["plan"]["daily_targets"]["kcal"] == 2200

    def test_refuses_cross_client_access(self, test_client_id):
        tool = WriteMealPlan(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(client_id="00000000-0000-0000-0000-000000000000", plan={})


class TestGetActiveProgram:
    def test_refuses_cross_client_access(self, test_client_id):
        tool = GetActiveProgram(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(client_id="00000000-0000-0000-0000-000000000000")


# ── Integration: full nutrition flow (LLM mocked, OFF mocked) ────────────────

# Fixture foods + their per_100g values — used by both the agent script and the assertions.
_FIXTURE_FOODS = {
    "test-rolled-oats":     {"kcal": 379, "protein": 13, "carbs": 68, "fat": 7},
    "test-chicken-breast":  {"kcal": 165, "protein": 31, "carbs": 0,  "fat": 4},
    "test-brown-rice":      {"kcal": 124, "protein": 3,  "carbs": 26, "fat": 1},
    "test-olive-oil":       {"kcal": 884, "protein": 0,  "carbs": 0,  "fat": 100},
}


def _build_meal(food_key: str, grams: float) -> dict:
    """Compute scaled macros for a given food + portion using fixture data."""
    info = _FIXTURE_FOODS[food_key]
    return {
        "food":      food_key,
        "grams":     grams,
        "kcal":      round(info["kcal"]    * grams / 100, 1),
        "protein_g": round(info["protein"] * grams / 100, 1),
        "carbs_g":   round(info["carbs"]   * grams / 100, 1),
        "fat_g":     round(info["fat"]     * grams / 100, 1),
    }


def _sum(items: list[dict], k: str) -> float:
    return round(sum(i[k] for i in items), 1)


def _make_nutrition_crew_result(client_id: str, targets: dict) -> str:
    """Simulate an agent that calls lookup_food per item then writes a 7-day plan
    where each day's totals match the daily targets within ±10%."""
    from ai.crew.tools.nutrition import LookupFood
    look = LookupFood()
    for q in _FIXTURE_FOODS:
        look._run(query=q)  # populates the cache (each item makes one HTTP call)

    # Build a deterministic 1-meal-per-day plan that hits the target.
    # We solve for breakfast: oats + chicken + rice + olive oil → land near target.
    # Hand-computed numbers below sum to ~target.
    items = [
        _build_meal("test-rolled-oats",    100),    # 379 kcal
        _build_meal("test-chicken-breast", 200),    # 330
        _build_meal("test-brown-rice",     400),    # 496
        _build_meal("test-olive-oil",      100),    # 884
    ]
    # Day total: ~2089 kcal. We'll set targets to 2200 → within 10%.
    day_total = {
        "kcal":      _sum(items, "kcal"),
        "protein_g": _sum(items, "protein_g"),
        "carbs_g":   _sum(items, "carbs_g"),
        "fat_g":     _sum(items, "fat_g"),
    }
    meal = {"name": "All meals", "items": items, "kcal_total": day_total["kcal"]}
    days = [{"day": d, "meals": [meal], "day_total": day_total}
            for d in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]]

    plan = {"daily_targets": targets, "days": days}
    WriteMealPlan(run_client_id=client_id)._run(client_id=client_id, plan=plan)
    return json.dumps(plan)


class TestNutritionFlow:
    def test_meal_plan_within_10pct_of_daily_target_and_cache_avoids_second_call(self, test_client_id, db):
        targets = {"kcal": 2200, "protein_g": 150, "carbs_g": 250, "fat_g": 70}

        with patch("ai.integrations.nutrition.httpx.get") as mock_get, \
             patch("ai.crew.agents.make_llm", return_value="openai/gpt-4o-mini"), \
             patch("ai.crew.flows.Crew") as MockCrew:

            # OFF stub — returns the right fixture for whichever query is asked.
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

            instance = MockCrew.return_value
            instance.kickoff.side_effect = lambda: _make_nutrition_crew_result(test_client_id, targets)

            # First run — populates food_cache for 4 items (4 HTTP calls).
            weekly_nutrition_flow(client_id=test_client_id, targets=targets)
            first_call_count = mock_get.call_count
            assert first_call_count == len(_FIXTURE_FOODS), \
                f"expected {len(_FIXTURE_FOODS)} OFF calls, got {first_call_count}"

            # Re-run — every lookup_food now hits the cache; no new HTTP calls.
            weekly_nutrition_flow(client_id=test_client_id, targets=targets)
            assert mock_get.call_count == first_call_count, "cache should have prevented further HTTP calls"

        # Latest meal plan persisted; every day_total within ±10% of daily_targets.
        meal_plans = db.table("meal_plans").select("plan") \
            .eq("client_id", test_client_id).execute().data
        assert len(meal_plans) >= 1
        plan = meal_plans[-1]["plan"]
        assert "daily_targets" in plan and len(plan["days"]) == 7

        kcal_target = plan["daily_targets"]["kcal"]
        for day in plan["days"]:
            assert abs(day["day_total"]["kcal"] - kcal_target) / kcal_target <= 0.10, \
                f"day {day['day']} kcal {day['day_total']['kcal']} not within 10% of target {kcal_target}"

        # Every food cited must have a food_cache row.
        cited = {item["food"] for day in plan["days"] for meal in day["meals"] for item in meal["items"]}
        cached = {r["external_id"] for r in db.table("food_cache").select("external_id")
                  .in_("external_id", list(cited)).execute().data}
        missing = cited - cached
        assert not missing, f"foods not cached: {missing}"
