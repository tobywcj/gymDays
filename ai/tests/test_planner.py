"""M7 — Planner Agent tests.

Strategy mirrors M5: mock the LLM via Crew patch, let tools write to the real
cloud DB, then verify program rows reference valid exercise_db ids.
"""
from __future__ import annotations
import json
import pytest
from unittest.mock import patch
from ai.crew.tools.planner import (
    SearchExerciseDB, WriteProgram, GetRecentActivities,
)
from ai.crew.flows import weekly_planning_flow


# ── Unit: SearchExerciseDB ────────────────────────────────────────────────────

class TestSearchExerciseDB:
    def test_returns_results_filtered_by_muscle_group(self):
        tool = SearchExerciseDB()
        raw = tool._run(muscle_group="legs", limit=5)
        rows = json.loads(raw)
        assert len(rows) >= 1
        for r in rows:
            assert r["muscle_group"] == "legs"
            assert "id" in r and "name" in r

    def test_filter_by_equipment_returns_only_matching(self):
        tool = SearchExerciseDB()
        rows = json.loads(tool._run(equipment="bodyweight", limit=10))
        assert len(rows) >= 1
        assert all(r["equipment"] == "bodyweight" for r in rows)


# ── Unit: GetRecentActivities ────────────────────────────────────────────────

class TestGetRecentActivities:
    def test_refuses_cross_client_access(self, test_client_id):
        tool = GetRecentActivities(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(client_id="00000000-0000-0000-0000-000000000000", days=14)


# ── Unit: WriteProgram ───────────────────────────────────────────────────────

class TestWriteProgram:
    def test_writes_a_program_row(self, test_client_id, db):
        # Grab a real exercise id to reference.
        ex_resp = db.table("exercise_db").select("id").limit(1).execute()
        ex_id = ex_resp.data[0]["id"]

        tool = WriteProgram(run_client_id=test_client_id)
        plan = {
            "days": [
                {"day": "Mon", "focus": "Lower body", "exercises": [
                    {"exercise_id": ex_id, "sets": 4, "reps": "6-8", "notes": "warm up first"}
                ]},
                {"day": "Wed", "focus": "Upper push", "exercises": [
                    {"exercise_id": ex_id, "sets": 3, "reps": "8-10", "notes": ""}
                ]},
                {"day": "Fri", "focus": "Full body", "exercises": [
                    {"exercise_id": ex_id, "sets": 3, "reps": "10-12", "notes": ""}
                ]},
            ]
        }
        result = tool._run(client_id=test_client_id, plan=plan)
        assert "written" in result.lower()

        prog_resp = db.table("programs").select("plan, week_start") \
            .eq("client_id", test_client_id).execute()
        assert len(prog_resp.data) == 1
        assert len(prog_resp.data[0]["plan"]["days"]) == 3

    def test_refuses_cross_client_access(self, test_client_id):
        tool = WriteProgram(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(client_id="00000000-0000-0000-0000-000000000000", plan={})


# ── Integration: full planning flow with mocked LLM ──────────────────────────

def _make_planner_crew_result(client_id: str, db) -> str:
    """Simulate the agent: pick 5 real exercises, write a 4-day plan."""
    def first_in_group(group: str) -> str:
        rows = db.table("exercise_db").select("id") \
            .eq("muscle_group", group).limit(1).execute().data
        assert rows, f"exercise_db missing rows for muscle_group={group!r}"
        return rows[0]["id"]

    def pick(group: str) -> str:
        return first_in_group(group)

    plan = {
        "days": [
            {"day": "Mon", "focus": "Lower body", "exercises": [
                {"exercise_id": pick("legs"),      "sets": 4, "reps": "6-8",  "notes": ""},
                {"exercise_id": pick("posterior"), "sets": 3, "reps": "8-10", "notes": ""},
            ]},
            {"day": "Wed", "focus": "Upper push", "exercises": [
                {"exercise_id": pick("chest"), "sets": 4, "reps": "6-8", "notes": ""},
            ]},
            {"day": "Fri", "focus": "Upper pull", "exercises": [
                {"exercise_id": pick("back"), "sets": 4, "reps": "6-8", "notes": ""},
            ]},
            {"day": "Sat", "focus": "Conditioning + core", "exercises": [
                {"exercise_id": pick("core"), "sets": 3, "reps": "12-15", "notes": ""},
            ]},
        ]
    }

    # Actually invoke the write tool so the DB has the row.
    WriteProgram(run_client_id=client_id)._run(client_id=client_id, plan=plan)
    return json.dumps(plan)


class TestPlanningFlow:
    def test_generates_program_with_valid_exercise_ids(self, test_client_id, db):
        """End-to-end (mocked LLM): plan written + every exercise_id resolves."""
        with patch("ai.crew.agents.make_llm", return_value="openai/gpt-4o-mini"), \
             patch("ai.crew.flows.Crew") as MockCrew:
            instance = MockCrew.return_value
            instance.kickoff.side_effect = lambda: _make_planner_crew_result(test_client_id, db)

            weekly_planning_flow(client_id=test_client_id)

        prog_resp = db.table("programs").select("plan") \
            .eq("client_id", test_client_id).execute()
        assert len(prog_resp.data) == 1

        plan = prog_resp.data[0]["plan"]
        assert len(plan["days"]) >= 3, "agent should produce at least 3 training days"

        # Every exercise_id in the plan must exist in exercise_db.
        all_ids = [
            ex["exercise_id"]
            for day in plan["days"]
            for ex in day["exercises"]
        ]
        assert len(all_ids) >= 4

        rows = db.table("exercise_db").select("id").in_("id", all_ids).execute().data
        found_ids = {r["id"] for r in rows}
        for ex_id in all_ids:
            assert ex_id in found_ids, f"exercise_id {ex_id} not in exercise_db"
