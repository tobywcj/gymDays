"""Nutrition-Agent-specific tools — food advice, not meal plans."""
from __future__ import annotations
import json
from datetime import date, timedelta
from typing import Type
from pydantic import BaseModel, Field
from crewai.tools import BaseTool
from ai.db import get_db
from ai.integrations.nutrition import lookup_food


def _check_scope(tool: str, run_id: str, requested: str) -> None:
    if run_id != requested:
        raise PermissionError(
            f"[{tool}] cross-client access blocked: run={run_id!r} requested={requested!r}"
        )


class LookupFoodInput(BaseModel):
    query: str = Field(description="Plain-language food query, e.g. 'rolled oats' or 'greek yogurt 0% fat'.")

class GetActiveProgramInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")

class GetSessionLogsInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")
    days: int = Field(default=30, description="How many days of session history to fetch (default 30 — the recent ~1 month picture).")

class GetLatestProgressReportInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")

class WriteNutritionAdviceInput(BaseModel):
    client_id: str   = Field(description="UUID of the client.")
    advice:    str   = Field(description="Markdown-formatted nutrition advice (sections + bullet points).")


class LookupFood(BaseTool):
    name: str = "lookup_food"
    description: str = (
        "Look up a food and get its per-100g macros (kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g). "
        "Backed by Open Food Facts with a persistent cache. "
        "Returns null if no nutrition data was found."
    )
    args_schema: Type[BaseModel] = LookupFoodInput

    def _run(self, query: str) -> str:
        result = lookup_food(query)
        return json.dumps(result if result else None)


class GetSessionLogs(BaseTool):
    name: str = "get_session_logs"
    description: str = (
        "Return recent manual session logs for the client (RPE, notes, date). "
        "High RPE signals fatigue — use this to adjust carb/recovery suggestions."
    )
    args_schema: Type[BaseModel] = GetSessionLogsInput
    run_client_id: str
    # When set by the flow, this pins the lookback to the user-selected window
    # even if the agent passes its own `days`.
    default_days: int | None = None

    def _run(self, client_id: str, days: int = 30) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        days = self.default_days or days
        db = get_db()
        since = (date.today() - timedelta(days=days)).isoformat()
        resp = db.table("workouts") \
            .select("logged_at, rpe, notes, data") \
            .eq("client_id", client_id) \
            .gte("logged_at", since) \
            .order("logged_at", desc=True) \
            .limit(20).execute()
        return json.dumps(resp.data or [], default=str)


class GetActiveProgram(BaseTool):
    name: str = "get_active_program"
    description: str = (
        "Return the client's most recent weekly program. "
        "Use it to understand upcoming workout types and tailor pre/post-workout food advice."
    )
    args_schema: Type[BaseModel] = GetActiveProgramInput
    run_client_id: str

    def _run(self, client_id: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        resp = db.table("programs") \
            .select("week_start, plan") \
            .eq("client_id", client_id) \
            .order("week_start", desc=True) \
            .limit(1).execute()
        return json.dumps(resp.data[0] if resp.data else None, default=str)


class GetLatestProgressReport(BaseTool):
    name: str = "get_latest_progress_report"
    description: str = (
        "Return the most recent progress report for the client. "
        "Use it to understand current training load, fatigue flags, and recovery status."
    )
    args_schema: Type[BaseModel] = GetLatestProgressReportInput
    run_client_id: str

    def _run(self, client_id: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        resp = db.table("progress_reports") \
            .select("summary, flags, period_start, period_end") \
            .eq("client_id", client_id) \
            .order("period_end", desc=True) \
            .limit(1).execute()
        return json.dumps(resp.data[0] if resp.data else None, default=str)


class WriteNutritionAdvice(BaseTool):
    name: str = "write_nutrition_advice"
    description: str = (
        "Save personalised nutrition advice for the client. "
        "The 'advice' field must be markdown with these sections:\n"
        "## Goal Alignment\n"
        "## What to Eat\n"
        "## Foods to Avoid or Limit\n"
        "## Pre & Post Workout Nutrition\n"
        "## This Week's Priority\n"
        "Use bullet points under each section. Include emojis. Cite actual foods from lookup_food results."
    )
    args_schema: Type[BaseModel] = WriteNutritionAdviceInput
    run_client_id: str

    def _run(self, client_id: str, advice: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        client_resp = db.table("clients").select("trainer_id").eq("id", client_id).single().execute()
        trainer_id = client_resp.data["trainer_id"]

        today = date.today()
        week_start = today - timedelta(days=today.weekday())

        db.table("meal_plans") \
            .delete() \
            .eq("client_id", client_id) \
            .eq("week_start", week_start.isoformat()) \
            .execute()

        db.table("meal_plans").insert({
            "trainer_id": trainer_id,
            "client_id":  client_id,
            "program_id": None,
            "week_start": week_start.isoformat(),
            "plan": {"type": "advice", "advice": advice, "generated_at": today.isoformat()},
        }).execute()
        return f"Nutrition advice saved for week of {week_start.isoformat()}."


def make_nutrition_tools(run_client_id: str, window_days: int | None = None) -> list[BaseTool]:
    from ai.crew.tools.client import GetClientProfile, SearchClientMemory
    from ai.crew.tools.search import WebSearchTool
    from ai.crew.tools.progress import GetBodyComposition
    return [
        GetClientProfile(run_client_id=run_client_id),
        GetActiveProgram(run_client_id=run_client_id),
        GetSessionLogs(run_client_id=run_client_id, default_days=window_days),
        GetLatestProgressReport(run_client_id=run_client_id),
        GetBodyComposition(run_client_id=run_client_id),
        SearchClientMemory(run_client_id=run_client_id),
        LookupFood(),
        WebSearchTool(),
        WriteNutritionAdvice(run_client_id=run_client_id),
    ]
