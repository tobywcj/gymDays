"""Planner-Agent-specific tools.

Each tool is bound to a single run_client_id at construction. Cross-client
access raises PermissionError. Exercise + program writes are unrestricted by
client (exercise_db is global reference data; programs are scoped server-side
via the client_id).
"""
from __future__ import annotations
import json
from datetime import date, datetime, timedelta, timezone
from typing import Any, Type
from pydantic import BaseModel, Field
from crewai.tools import BaseTool
from ai.db import get_db


def _check_scope(tool: str, run_id: str, requested: str) -> None:
    if run_id != requested:
        raise PermissionError(
            f"[{tool}] cross-client access blocked: run={run_id!r} requested={requested!r}"
        )


# ── Schemas ──────────────────────────────────────────────────────────────────

class GetActivitiesInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")
    days:      int = Field(default=14, description="Lookback window in days. Ignored if period_start+period_end are set.")
    period_start: str | None = Field(default=None, description="ISO date (YYYY-MM-DD). Together with period_end defines an absolute window.")
    period_end:   str | None = Field(default=None, description="ISO date (YYYY-MM-DD). Together with period_start defines an absolute window.")

class SearchExerciseInput(BaseModel):
    muscle_group: str | None = Field(default=None, description="e.g. legs, chest, back, core")
    equipment:    str | None = Field(default=None, description="e.g. barbell, dumbbell, bodyweight, machine, cable, kettlebell")
    level:        str | None = Field(default=None, description="Optional: beginner | intermediate | advanced")
    include_details: bool    = Field(default=False, description="Include rich AASFP fields (key_points, progression, regression, variations, primary_muscles).")
    include_flagged: bool    = Field(default=False, description="Include exercises the trainer marked 'not recommended' (excluded by default).")
    limit:        int        = Field(default=20, description="Max rows to return.")

class WriteProgramInput(BaseModel):
    client_id: str  = Field(description="UUID of the client.")
    plan:      dict = Field(description="Weekly plan: {days: [{day: 'Mon', focus: '...', exercises: [{exercise_id, sets, reps, notes}]}]}")


# ── Tool implementations ─────────────────────────────────────────────────────

class GetRecentActivities(BaseTool):
    name: str = "get_recent_activities"
    description: str = (
        "Return the client's logged activities. Defaults to last N days; if "
        "period_start AND period_end are both provided (ISO YYYY-MM-DD), uses that "
        "absolute window instead. Each row carries the full metrics jsonb (avg/max "
        "HR, hr_zones, watts, suffer_score, elevation, speed) so the caller can "
        "analyse the whole health picture, not just duration/distance."
    )
    args_schema: Type[BaseModel] = GetActivitiesInput
    run_client_id: str
    # When set by the flow, these bound the query to the user-selected timeframe
    # even if the agent forgets to pass period_start/period_end on the call.
    default_period_start: str | None = None
    default_period_end: str | None = None

    def _run(
        self,
        client_id: str,
        days: int = 14,
        period_start: str | None = None,
        period_end: str | None = None,
    ) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        period_start = period_start or self.default_period_start
        period_end = period_end or self.default_period_end
        db = get_db()
        q = db.table("activities") \
            .select("started_at, type, distance_m, duration_s, metrics") \
            .eq("client_id", client_id)
        if period_start and period_end:
            start_iso = datetime.fromisoformat(period_start).replace(tzinfo=timezone.utc).isoformat()
            end_iso   = (datetime.fromisoformat(period_end).replace(tzinfo=timezone.utc) + timedelta(days=1)).isoformat()
            q = q.gte("started_at", start_iso).lt("started_at", end_iso)
        else:
            since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            q = q.gte("started_at", since)
        resp = q.order("started_at", desc=True).execute()
        return json.dumps(resp.data, default=str)


class SearchExerciseDB(BaseTool):
    name: str = "search_exercise_db"
    description: str = (
        "Search the global exercise catalog (the single source of truth). Filter by "
        "muscle_group, equipment and/or level. Returns rows with {id, name, name_zh, "
        "muscle_group, equipment, difficulty, level, cues}; set include_details=true for "
        "the rich AASFP fields (key_points, progression, regression, variations, "
        "primary_muscles). Exercises the trainer marked 'not recommended' are excluded "
        "by default. USE THE id VALUES VERBATIM in your program."
    )
    args_schema: Type[BaseModel] = SearchExerciseInput
    # Optional: when set, exclude exercises this client's trainer flagged.
    run_client_id: str | None = None

    def _run(self, muscle_group: str | None = None, equipment: str | None = None,
             level: str | None = None, include_details: bool = False,
             include_flagged: bool = False, limit: int = 20) -> str:
        db = get_db()
        cols = "id, name, name_zh, muscle_group, equipment, equipment_options, difficulty, level, cues"
        if include_details:
            cols += ", primary_muscles, secondary_muscles, tempo, key_points, progression, regression, common_faults, variations, citation, source"
        q = db.table("exercise_db").select(cols)
        if muscle_group:
            q = q.eq("muscle_group", muscle_group)
        if equipment:
            q = q.eq("equipment", equipment)
        if level:
            q = q.eq("level", level)
        resp = q.limit(limit).execute()
        rows = resp.data or []

        # Exclude the trainer's not-recommended exercises (query-time personalization).
        if not include_flagged and self.run_client_id:
            try:
                cl = db.table("clients").select("trainer_id").eq("id", self.run_client_id).single().execute()
                trainer_id = cl.data["trainer_id"]
                flags = db.table("trainer_exercise_flags").select("exercise_id") \
                    .eq("trainer_id", trainer_id).eq("status", "not_recommended").execute()
                blocked = {f["exercise_id"] for f in (flags.data or [])}
                rows = [r for r in rows if r["id"] not in blocked]
            except Exception:
                pass  # never fail the search over the overlay lookup
        return json.dumps(rows, default=str)


class WriteProgram(BaseTool):
    name: str = "write_program"
    description: str = (
        "Persist this week's program. Pass a plan dict with shape:\n"
        "  {days: [{day, focus, exercises: [{exercise_id, sets, reps, notes}]}], "
        "sources: [{title, url}]}\n"
        "Every exercise_id must come from search_exercise_db results. "
        "`sources` lists external evidence used (web_search / search_knowledge_base); "
        "use an empty array if none."
    )
    args_schema: Type[BaseModel] = WriteProgramInput
    run_client_id: str

    def _run(self, client_id: str, plan: dict) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        # Get the trainer_id for this client (required column on programs).
        client_resp = db.table("clients").select("trainer_id").eq("id", client_id).single().execute()
        trainer_id = client_resp.data["trainer_id"]

        # Compute week_start as the most recent Monday (UTC).
        today = date.today()
        week_start = today - timedelta(days=today.weekday())

        # Upsert this week's program. Delete any existing for this week first.
        db.table("programs") \
            .delete() \
            .eq("client_id", client_id) \
            .eq("week_start", week_start.isoformat()) \
            .execute()

        db.table("programs").insert({
            "trainer_id": trainer_id,
            "client_id":  client_id,
            "week_start": week_start.isoformat(),
            "plan":       plan,
        }).execute()
        return f"Program for week of {week_start.isoformat()} written ({len(plan.get('days', []))} days)."


def window_bounds(window_days: int | None) -> tuple[str | None, str | None]:
    """Translate a lookback window (in days) into an absolute (start, end) pair
    of ISO dates, anchored to today. Returns (None, None) when no window is set
    so tools fall back to their own default `days` lookback."""
    if not window_days or window_days <= 0:
        return None, None
    end = date.today()
    start = end - timedelta(days=window_days)
    return start.isoformat(), end.isoformat()


def make_planner_tools(run_client_id: str, window_days: int | None = None) -> list[BaseTool]:
    """Return Planner-Agent tools scoped to *run_client_id*.

    When *window_days* is set, the activity + workout-log reads are bound to that
    user-selected lookback so the program reflects exactly the timeframe the
    trainer chose on the slider — even if the agent forgets to pass it."""
    from ai.crew.tools.client import GetClientProfile, SearchClientMemory
    from ai.crew.tools.search import WebSearchTool
    from ai.crew.tools.assessment import make_assessment_tools
    from ai.crew.tools.progress import GetWorkoutLogs, GetLatestProgressReport, GetBodyComposition
    ps, pe = window_bounds(window_days)
    return [
        GetClientProfile(run_client_id=run_client_id),
        GetRecentActivities(run_client_id=run_client_id, default_period_start=ps, default_period_end=pe),
        GetWorkoutLogs(run_client_id=run_client_id, default_period_start=ps, default_period_end=pe),
        GetLatestProgressReport(run_client_id=run_client_id),
        GetBodyComposition(run_client_id=run_client_id),
        SearchClientMemory(run_client_id=run_client_id),
        SearchExerciseDB(run_client_id=run_client_id),
        WebSearchTool(),
        WriteProgram(run_client_id=run_client_id),
        *make_assessment_tools(run_client_id),
    ]
