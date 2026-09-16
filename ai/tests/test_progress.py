"""M9 — Progress Agent tests.

Synthetic overtraining pattern (HRV drop + volume rise) should yield a flag of
kind='overtraining' and the client's status should flip to 'Flagged'.
"""
from __future__ import annotations
import json
from datetime import date, datetime, timedelta, timezone
import pytest
from unittest.mock import patch
from ai.crew.tools.progress import (
    GetWorkoutLogs, WriteProgressReport, RaiseFlag,
)
from ai.crew.flows import weekly_review_flow


# ── Unit tests ───────────────────────────────────────────────────────────────

class TestGetWorkoutLogs:
    def test_refuses_cross_client_access(self, test_client_id):
        tool = GetWorkoutLogs(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(client_id="00000000-0000-0000-0000-000000000000", days=28)


class TestRaiseFlagDirect:
    def test_creates_report_and_flags_client_when_no_prior_report(self, test_client_id, db):
        tool = RaiseFlag(run_client_id=test_client_id)
        msg = tool._run(
            client_id=test_client_id,
            kind="overtraining",
            severity="high",
            rationale="HRV dropped 22% while weekly volume rose 35% over 3 weeks.",
        )
        assert "flag" in msg.lower()

        # Client status should now be Flagged.
        c = db.table("clients").select("status").eq("id", test_client_id).single().execute().data
        assert c["status"] == "Flagged"

        # And the report row exists with our flag.
        r = db.table("progress_reports").select("flags") \
            .eq("client_id", test_client_id).single().execute().data
        assert len(r["flags"]) == 1
        assert r["flags"][0]["kind"] == "overtraining"
        assert r["flags"][0]["severity"] == "high"

    def test_refuses_cross_client_access(self, test_client_id):
        tool = RaiseFlag(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(
                client_id="00000000-0000-0000-0000-000000000000",
                kind="plateau", severity="low", rationale="x",
            )


class TestWriteProgressReport:
    def test_refuses_cross_client_access(self, test_client_id):
        tool = WriteProgressReport(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(
                client_id="00000000-0000-0000-0000-000000000000",
                period_start="2026-01-01", period_end="2026-01-28", summary="x",
            )


# ── Integration: weekly_review_flow with synthetic overtraining data ─────────

def _seed_overtraining_pattern(client_id: str, trainer_id: str, db) -> None:
    """Insert 4 weeks of activities where volume rises while HRV collapses."""
    now = datetime.now(timezone.utc)
    rows = []
    for week in range(4):  # 0 = oldest, 3 = most recent
        volume_km = 25 + week * 10           # 25 → 55 km/week — escalating
        hrv      = 65 - week * 8             # 65 → 41 ms — falling fast
        for day_offset in range(3):          # 3 sessions/week
            started = now - timedelta(days=(3 - week) * 7 + day_offset * 2)
            rows.append({
                "trainer_id":  trainer_id,
                "client_id":   client_id,
                "source":      "test-synthetic",
                "external_id": f"ot-{client_id}-{week}-{day_offset}",
                "started_at":  started.isoformat(),
                "type":        "Run",
                "distance_m":  int(volume_km * 1000 / 3),
                "duration_s":  3600,
                "metrics":     {"average_heartrate": 160 + week * 3, "hrv_ms": hrv},
            })
    db.table("activities").upsert(rows, on_conflict="source,external_id").execute()


def _make_progress_crew_result(client_id: str) -> str:
    """Simulate the agent: write a report citing the data + raise an overtraining flag."""
    today = date.today()
    period_end = today.isoformat()
    period_start = (today - timedelta(days=28)).isoformat()

    WriteProgressReport(run_client_id=client_id)._run(
        client_id=client_id,
        period_start=period_start,
        period_end=period_end,
        summary=(
            "Weekly running volume escalated from 25 → 55 km/week over four weeks "
            "while reported HRV dropped from 65 → 41 ms. Acute:chronic load ratio is "
            "elevated and recovery markers are trending down."
        ),
    )
    RaiseFlag(run_client_id=client_id)._run(
        client_id=client_id,
        kind="overtraining",
        severity="high",
        rationale="Volume +120% over 4 weeks while HRV fell 37% — classic overtraining signature.",
    )
    return json.dumps({"summary": "report written", "flags_raised": 1})


class TestWeeklyReviewFlow:
    def test_synthetic_overtraining_pattern_raises_flag(self, test_client_id, db):
        # Look up trainer_id from the fixture-created client.
        trainer_id = db.table("clients").select("trainer_id") \
            .eq("id", test_client_id).single().execute().data["trainer_id"]

        _seed_overtraining_pattern(test_client_id, trainer_id, db)

        with patch("ai.crew.agents.make_llm", return_value="openai/gpt-4o-mini"), \
             patch("ai.crew.flows.Crew") as MockCrew:
            instance = MockCrew.return_value
            instance.kickoff.side_effect = lambda: _make_progress_crew_result(test_client_id)

            weekly_review_flow(client_id=test_client_id)

        # Assert: client.status == 'Flagged'
        client = db.table("clients").select("status").eq("id", test_client_id) \
            .single().execute().data
        assert client["status"] == "Flagged", f"expected status=Flagged, got {client['status']}"

        # Assert: a progress_report row with an overtraining flag exists
        report = db.table("progress_reports").select("flags, summary") \
            .eq("client_id", test_client_id) \
            .order("period_end", desc=True) \
            .limit(1).execute().data[0]

        assert len(report["flags"]) >= 1
        kinds = [f["kind"] for f in report["flags"]]
        assert "overtraining" in kinds

        # Clean up synthetic activities so they don't pollute later tests.
        db.table("activities").delete().eq("client_id", test_client_id).execute()
