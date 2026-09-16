"""Progress-Agent-specific tools.
Reads recent activities + workouts, writes progress reports, raises flags on
plateau / overtraining / under-recovery patterns.
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


def _flatten_extra_metrics(row: dict) -> None:
    """Rewrite a health-metrics row's raw ``extra_metrics`` bag in place into a
    compact, agent-friendly ``extra`` map ("Label" -> "value unit") plus a
    ``machine`` field. Keeps the machine-specific InBody params (skeletal muscle
    mass, visceral fat, segmental analysis, phase angle, …) legible to the LLM
    without the nested {label,value,unit} noise."""
    raw = row.pop("extra_metrics", None)
    if not isinstance(raw, dict):
        return
    machine = raw.get("_machine")
    extra: dict[str, str] = {}
    for key, v in raw.items():
        if key.startswith("_") or not isinstance(v, dict) or v.get("value") is None:
            continue
        label = v.get("label") or key.replace("_", " ")
        unit = v.get("unit") or ""
        extra[str(label)] = f"{v['value']} {unit}".strip()
    if machine:
        row["machine"] = machine
    if extra:
        row["extra"] = extra


# ── Schemas ──────────────────────────────────────────────────────────────────

class GetWorkoutLogsInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")
    days:      int = Field(default=28, description="Lookback window in days. Ignored if period_start+period_end are set.")
    period_start: str | None = Field(default=None, description="ISO date (YYYY-MM-DD). Together with period_end defines an absolute window.")
    period_end:   str | None = Field(default=None, description="ISO date (YYYY-MM-DD). Together with period_start defines an absolute window.")

class WriteProgressReportInput(BaseModel):
    client_id:    str = Field(description="UUID of the client.")
    period_start: str = Field(description="ISO date (YYYY-MM-DD).")
    period_end:   str = Field(description="ISO date (YYYY-MM-DD).")
    summary:      str = Field(description="Plain-English summary of the trend.")

class RaiseFlagInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")
    kind:      str = Field(description="One of: overtraining, plateau, under_recovery, injury_risk, missed_sessions.")
    severity:  str = Field(description="low | medium | high.")
    rationale: str = Field(description="Short, evidence-based explanation citing specific data points.")


# ── Tools ────────────────────────────────────────────────────────────────────

class GetWorkoutLogs(BaseTool):
    name: str = "get_workout_logs"
    description: str = (
        "Return the client's logged workouts (RPE, notes, data jsonb). Defaults to "
        "last N days; if period_start AND period_end are both provided (ISO "
        "YYYY-MM-DD), uses that absolute window instead. Use alongside "
        "get_recent_activities for a complete view of training load."
    )
    args_schema: Type[BaseModel] = GetWorkoutLogsInput
    run_client_id: str
    # When set by the flow, these bound the query to the user-selected timeframe
    # even if the agent forgets to pass period_start/period_end on the call.
    default_period_start: str | None = None
    default_period_end: str | None = None

    def _run(
        self,
        client_id: str,
        days: int = 28,
        period_start: str | None = None,
        period_end: str | None = None,
    ) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        period_start = period_start or self.default_period_start
        period_end = period_end or self.default_period_end
        db = get_db()
        q = db.table("workouts") \
            .select("performed_at, rpe, notes, data") \
            .eq("client_id", client_id)
        if period_start and period_end:
            start_iso = datetime.fromisoformat(period_start).replace(tzinfo=timezone.utc).isoformat()
            end_iso   = (datetime.fromisoformat(period_end).replace(tzinfo=timezone.utc) + timedelta(days=1)).isoformat()
            q = q.gte("performed_at", start_iso).lt("performed_at", end_iso)
        else:
            since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            q = q.gte("performed_at", since)
        resp = q.order("performed_at", desc=True).execute()
        return json.dumps(resp.data, default=str)


class WriteProgressReport(BaseTool):
    name: str = "write_progress_report"
    description: str = (
        "Persist a progress_report row. Call this AFTER analyzing activities + workouts. "
        "Period dates must be ISO YYYY-MM-DD. Summary is what the trainer reads on the dashboard."
    )
    args_schema: Type[BaseModel] = WriteProgressReportInput
    run_client_id: str

    def _run(self, client_id: str, period_start: str, period_end: str, summary: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        trainer_id = db.table("clients").select("trainer_id").eq("id", client_id) \
            .single().execute().data["trainer_id"]
        # Replace any prior report for the same period — keep the table tidy.
        db.table("progress_reports") \
            .delete() \
            .eq("client_id", client_id) \
            .eq("period_start", period_start) \
            .eq("period_end", period_end) \
            .execute()
        db.table("progress_reports").insert({
            "trainer_id":   trainer_id,
            "client_id":    client_id,
            "period_start": period_start,
            "period_end":   period_end,
            "summary":      summary,
            "flags":        [],
        }).execute()
        return f"Progress report for {period_start}…{period_end} written."


class RaiseFlag(BaseTool):
    name: str = "raise_flag"
    description: str = (
        "Append a flag to the client's most recent progress_report. ALSO updates "
        "clients.status to 'Flagged' so the trainer sees it on the dashboard. "
        "Use sparingly — only for evidence-backed concerns. kind must be one of: "
        "overtraining, plateau, under_recovery, injury_risk, missed_sessions."
    )
    args_schema: Type[BaseModel] = RaiseFlagInput
    run_client_id: str

    def _run(self, client_id: str, kind: str, severity: str, rationale: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        report = db.table("progress_reports") \
            .select("id, flags") \
            .eq("client_id", client_id) \
            .order("period_end", desc=True) \
            .limit(1).execute()
        if not report.data:
            # No report yet — create a thin one so we have somewhere to attach the flag.
            today = date.today().isoformat()
            trainer_id = db.table("clients").select("trainer_id").eq("id", client_id) \
                .single().execute().data["trainer_id"]
            ins = db.table("progress_reports").insert({
                "trainer_id":   trainer_id,
                "client_id":    client_id,
                "period_start": today,
                "period_end":   today,
                "summary":      f"Flag raised: {kind}",
                "flags":        [],
            }).execute()
            report_id = ins.data[0]["id"]
            existing_flags = []
        else:
            report_id = report.data[0]["id"]
            existing_flags = report.data[0]["flags"] or []

        flag = {
            "kind":       kind,
            "severity":   severity,
            "rationale":  rationale,
            "raised_at":  datetime.now(timezone.utc).isoformat(),
        }
        existing_flags.append(flag)

        db.table("progress_reports").update({"flags": existing_flags}).eq("id", report_id).execute()
        db.table("clients").update({"status": "Flagged"}).eq("id", client_id).execute()
        return f"Flag '{kind}' ({severity}) attached to report {report_id}."


class GetBodyCompositionInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")


class GetBodyComposition(BaseTool):
    name: str = "get_body_composition"
    description: str = (
        "Return the client's FULL body-composition history — every InBody/BIA "
        "reading ever logged, including the first-lesson intake reading — as a "
        "chronological 'history' array (oldest → newest), plus 'latest' and "
        "'previous' for convenience and 'count'. Each reading has weight_kg, bmi, "
        "body_fat_pct, fat_free_mass_kg, bmr_kcal, waist_hip_ratio, "
        "total_body_water_pct, resting_hr, blood pressure, a 'source' "
        "(intake/session/self-report), and an 'extra' map of machine-specific "
        "InBody/BIA parameters that vary by device — e.g. skeletal muscle mass, "
        "visceral fat level, segmental lean/fat analysis, phase angle, ECW/TBW "
        "ratio, InBody score. ALWAYS read the whole history to judge the trajectory "
        "(gaining/leaning/stable, rate of change) and ALWAYS factor 'extra' in when "
        "present. The indicators that best track a fitness journey — PRIORITISE "
        "these — are: skeletal muscle mass (SMM; fall back to fat-free mass), "
        "percent body fat, and body-fat mass (recomposition = SMM up while fat "
        "down, even if weight is flat); visceral fat level/area (health risk); "
        "phase angle (cellular health / muscle quality, should trend up); ECW/TBW "
        "ratio (recovery / inflammation); and segmental lean mass (left/right "
        "balance). Treat BMI and weight-in-isolation as weak signals. Use all of "
        "it to tailor volume, intensity, and calorie/macro guidance. Returns null "
        "if no metrics have been recorded yet."
    )
    args_schema: Type[BaseModel] = GetBodyCompositionInput
    run_client_id: str

    def _run(self, client_id: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        resp = db.table("client_health_metrics") \
            .select("recorded_at, source, weight_kg, bmi, body_fat_pct, "
                    "fat_free_mass_kg, bmr_kcal, waist_hip_ratio, "
                    "total_body_water_pct, resting_hr, bp_systolic, bp_diastolic, "
                    "extra_metrics") \
            .eq("client_id", client_id) \
            .order("recorded_at", desc=True) \
            .execute()
        rows = resp.data or []
        if not rows:
            return json.dumps(None)
        for r in rows:
            _flatten_extra_metrics(r)
        return json.dumps({
            "count": len(rows),
            "latest": rows[0],
            "previous": rows[1] if len(rows) > 1 else None,
            # Oldest → newest so the trajectory (incl. the intake reading) reads in order.
            "history": list(reversed(rows)),
        }, default=str)


class GetLatestProgressReportInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")


class GetLatestProgressReport(BaseTool):
    name: str = "get_latest_progress_report"
    description: str = (
        "Return the client's most recent progress_report (summary + flags). "
        "Use this when drafting messages so you can reference real, recent context."
    )
    args_schema: Type[BaseModel] = GetLatestProgressReportInput
    run_client_id: str

    def _run(self, client_id: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        resp = db.table("progress_reports") \
            .select("period_start, period_end, summary, flags") \
            .eq("client_id", client_id) \
            .order("period_end", desc=True) \
            .limit(1).execute()
        if not resp.data:
            return json.dumps(None)
        return json.dumps(resp.data[0], default=str)


def make_progress_tools(
    run_client_id: str,
    *,
    period_start: str | None = None,
    period_end: str | None = None,
) -> list[BaseTool]:
    from ai.crew.tools.client import GetClientProfile, SearchClientMemory
    from ai.crew.tools.planner import GetRecentActivities
    from ai.crew.tools.search import WebSearchTool
    # Bind the selected timeframe so the data tools default to it even if the
    # agent omits the dates — every report is then based on that exact window.
    return [
        GetClientProfile(run_client_id=run_client_id),
        GetRecentActivities(run_client_id=run_client_id, default_period_start=period_start, default_period_end=period_end),
        GetWorkoutLogs(run_client_id=run_client_id, default_period_start=period_start, default_period_end=period_end),
        # Progress/session-analysis prompts already tell the agent to call
        # get_body_composition — give it the tool so it has the full history.
        GetBodyComposition(run_client_id=run_client_id),
        SearchClientMemory(run_client_id=run_client_id),
        WebSearchTool(),
        WriteProgressReport(run_client_id=run_client_id),
        RaiseFlag(run_client_id=run_client_id),
    ]
