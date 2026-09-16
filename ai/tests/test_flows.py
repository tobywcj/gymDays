"""M11 — Messaging Agent flows.

Verifies:
  1. daily_reminder_flow writes an agent_runs row AND a messages row via ConsoleProvider.
  2. weekly_checkin_flow + post_session_nudge_flow do the same.
  3. A failure inside a flow still logs an agent_runs row with status='failed'.
  4. pg_cron entries for the scheduled flows exist (via direct SQL).
"""
from __future__ import annotations
import json
import os
import pytest
from unittest.mock import patch
from ai.crew.flows import (
    daily_reminder_flow, weekly_checkin_flow, post_session_nudge_flow,
)
from ai.crew.tools.messaging import SendMessage


def _scripted_send(client_id: str, body: str) -> str:
    """Stand-in for the agent's tool calls: just send a message via console."""
    SendMessage(run_client_id=client_id)._run(
        client_id=client_id, body=body, provider="console",
    )
    return json.dumps({"sent": True, "channel": "console", "body": body})


# ── Flow tests ───────────────────────────────────────────────────────────────

class TestMessagingFlowsLogToAgentRuns:
    @pytest.mark.parametrize("flow_fn,flow_name,body", [
        (daily_reminder_flow,    "daily_reminder_flow",    "Reminder: Bench session tomorrow 7am."),
        (weekly_checkin_flow,    "weekly_checkin_flow",    "How did this week feel? Nice 5km on Tuesday."),
        (post_session_nudge_flow,"post_session_nudge_flow","Great run today — keep that pace next week."),
    ])
    def test_flow_writes_messages_and_agent_runs(self, test_client_id, db, flow_fn, flow_name, body):
        # Clean prior runs of this same flow so we can assert exactly one.
        db.table("agent_runs").delete() \
            .eq("client_id", test_client_id).eq("flow", flow_name).execute()

        with patch("ai.crew.agents.make_llm", return_value="openai/gpt-4o-mini"), \
             patch("ai.crew.flows.Crew") as MockCrew:
            instance = MockCrew.return_value
            instance.kickoff.side_effect = lambda: _scripted_send(test_client_id, body)

            result = flow_fn(test_client_id)

        # Returned summary parses as the dict our scripted send produced.
        assert result.get("sent") is True

        # agent_runs row exists for this flow, status=completed.
        runs = db.table("agent_runs").select("agent, flow, status, output, latency_ms") \
            .eq("client_id", test_client_id).eq("flow", flow_name).execute().data
        assert len(runs) == 1, f"expected exactly one agent_runs row for {flow_name}, got {len(runs)}"
        assert runs[0]["agent"]  == "Messaging"
        assert runs[0]["status"] == "completed"
        assert runs[0]["latency_ms"] is not None

        # messages row exists via ConsoleProvider.
        msgs = db.table("messages").select("body, channel, status") \
            .eq("client_id", test_client_id) \
            .order("sent_at", desc=True).limit(1).execute().data
        assert msgs, "ConsoleProvider should have written a messages row"
        assert msgs[0]["channel"] == "console"
        assert msgs[0]["status"]  == "sent"
        assert body in msgs[0]["body"]


class TestFlowFailureStillLogs:
    def test_failed_flow_writes_agent_runs_with_status_failed(self, test_client_id, db):
        # Clean any prior daily_reminder runs.
        db.table("agent_runs").delete() \
            .eq("client_id", test_client_id).eq("flow", "daily_reminder_flow").execute()

        def boom():
            raise RuntimeError("simulated agent crash")

        with patch("ai.crew.agents.make_llm", return_value="openai/gpt-4o-mini"), \
             patch("ai.crew.flows.Crew") as MockCrew:
            instance = MockCrew.return_value
            instance.kickoff.side_effect = boom

            with pytest.raises(RuntimeError, match="simulated agent crash"):
                daily_reminder_flow(test_client_id)

        runs = db.table("agent_runs").select("status, output") \
            .eq("client_id", test_client_id).eq("flow", "daily_reminder_flow").execute().data
        assert len(runs) == 1
        assert runs[0]["status"] == "failed"
        assert "simulated agent crash" in (runs[0]["output"] or {}).get("error", "")


# ── pg_cron entries ──────────────────────────────────────────────────────────

class TestPgCronJobsRegistered:
    """Hits cloud DB directly to verify cron.job has our scheduled flow jobs."""

    def test_scheduled_gymdays_cron_jobs_exist(self):
        import psycopg
        url = os.environ.get("SUPABASE_DB_URL")
        if not url:
            pytest.skip("SUPABASE_DB_URL not set")
        # supabase-py doesn't expose cron.job; use a raw connection.
        # psycopg falls back to libpq, which handles the connection-pooler URL.
        with psycopg.connect(url) as conn, conn.cursor() as cur:
            cur.execute(
                "select jobname, schedule from cron.job "
                "where jobname like 'gymdays-%' order by jobname"
            )
            rows = cur.fetchall()
        names = [r[0] for r in rows]
        # The two time-scheduled messaging flows. post_session_nudge is
        # event-driven (fired on workout log), so it has no cron entry — see
        # migration 0044 which dropped the old no-op sentinel.
        assert "gymdays-daily-reminder" in names
        assert "gymdays-weekly-checkin" in names
