"""Screening + first-lesson assessment tools (M18).

These tools give the Planner agent access to the client's PAR-Q screening,
medical history, postural findings, and historical health metrics so that:

  1. Programs honor the same safety invariants enforced at the DB layer:
       - Any PAR-Q "Yes"        → medical_clearance_required → no max-effort tests
       - BP ≥ 200/110           → training_blocked → no program at all
       - Beta-blockers          → RPE-anchored cardio (not HR-anchored)
       - ≥ 2 CVD risk factors   → sub-max cardio only
  2. The first-lesson fitness battery is auto-selected from the safest subset
     of the Fitness Assessment List (3RM, Plank, Push-up, Sit-and-Reach,
     Rockport / 1.5-mile / Chester step / Lactate threshold, BESS).

All tools are bound to a single run_client_id at construction. Cross-client
access raises PermissionError.
"""
from __future__ import annotations
import json
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

class GetScreeningInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")


class DesignFitnessTestsInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")


class WriteFitnessAssessmentInput(BaseModel):
    client_id: str = Field(description="UUID of the client.")
    battery: dict = Field(description="The designed battery (output of design_fitness_tests).")
    results: dict = Field(description="Test results — keys match the fitness_assessments.results schema.")


# ── Pure helpers (also used by the FastAPI route in main.py) ─────────────────

def _load_screening_bundle(client_id: str) -> dict[str, Any]:
    """Load the latest screening + latest health metric + latest postural
    assessment + the client's training_blocked flag. Returns a dict suitable
    for downstream contraindication checks."""
    db = get_db()

    screening_resp = (
        db.table("client_screenings")
        .select("id, parq, medical_history, cvd_risk, parq_yes_count, "
                "medical_clearance_required, cvd_risk_factor_count, submitted_at")
        .eq("client_id", client_id)
        .order("submitted_at", desc=True)
        .limit(1)
        .execute()
    )
    health_resp = (
        db.table("client_health_metrics")
        .select("bp_systolic, bp_diastolic, resting_hr, recorded_at")
        .eq("client_id", client_id)
        .order("recorded_at", desc=True)
        .limit(1)
        .execute()
    )
    postural_resp = (
        db.table("postural_assessments")
        .select("upper_crossed, lower_crossed, pronation_distortion, scoliosis, summary, assessed_at")
        .eq("client_id", client_id)
        .order("assessed_at", desc=True)
        .limit(1)
        .execute()
    )
    client_resp = (
        db.table("clients")
        .select("training_blocked, training_blocked_reason, "
                "clearance_received_at, clearance_note")
        .eq("id", client_id)
        .single()
        .execute()
    )

    return {
        "screening": (screening_resp.data or [None])[0],
        "latest_health": (health_resp.data or [None])[0],
        "latest_postural": (postural_resp.data or [None])[0],
        "client": client_resp.data or {},
    }


def design_battery(bundle: dict[str, Any]) -> dict[str, Any]:
    """Pure function: pick the safest test battery from the Fitness Assessment
    List given the screening bundle. Returns:
        { battery: [...], skipped: [...], blocked?: bool, reason?: str }

    Safety invariants (M13/M18):
      • training_blocked    → blocked=True, no tests
      • clearance required  → skip max-effort tests (1.5-mile run, 3RM lifts)
      • beta-blockers       → cardio tests with RPE target, not HR
      • CVD factors ≥ 2     → exclude max-effort cardio (1.5-mile run, max Chester)
      • BP ≥ 140/90         → sub-max cardio only
    """
    client = bundle.get("client") or {}
    if client.get("training_blocked"):
        return {
            "battery": [],
            "skipped": [],
            "blocked": True,
            "reason": client.get("training_blocked_reason")
                      or "Training blocked by safety invariant.",
        }

    screening = bundle.get("screening") or {}
    health = bundle.get("latest_health") or {}

    # Clearance override: if the trainer recorded medical clearance, the
    # PAR-Q "Yes" answers no longer gate max-effort tests. The history still
    # lives on client_screenings + memory rows for audit.
    cleared = bool(client.get("clearance_received_at"))
    parq_yes = bool(screening.get("medical_clearance_required")) and not cleared
    cvd_count = int(screening.get("cvd_risk_factor_count") or 0)
    med_history = screening.get("medical_history") or {}
    beta_blockers = bool(med_history.get("beta_blockers"))
    bp_sys = health.get("bp_systolic")
    bp_dia = health.get("bp_diastolic")
    hypertensive = (
        (bp_sys is not None and bp_sys >= 140)
        or (bp_dia is not None and bp_dia >= 90)
    )

    # Candidate battery — full list, then prune.
    candidates: list[dict[str, Any]] = [
        {"test": "Handgrip Test (static strength)",
         "rationale": "Safe static strength baseline; no cardiovascular load."},
        {"test": "Plank (static endurance)",
         "rationale": "Core endurance under controlled BP; safe across PAR-Q states."},
        {"test": "Push-up (dynamic endurance)",
         "rationale": "Bodyweight, scalable, sub-max effort."},
        {"test": "Sit-and-Reach (flexibility)",
         "rationale": "Standard flexibility benchmark, no cardiac load."},
        {"test": "Wall Angel (thoracic mobility)",
         "rationale": "Postural-load screen, zero cardiovascular demand."},
        {"test": "Bench Press 3RM",
         "rationale": "Upper-body max strength benchmark."},
        {"test": "Squat 3RM",
         "rationale": "Lower-body max strength benchmark."},
        {"test": "Chester Step Test (sub-max cardio)",
         "rationale": "Stop at 85% HRmax or RPE 15 — sub-max graded protocol."},
        {"test": "Rockport 1-mile Walk Test (sub-max cardio)",
         "rationale": "Sub-max VO2 estimation; safe at moderate effort."},
        {"test": "1.5-mile Run Test (max cardio)",
         "rationale": "Max-effort cardio benchmark."},
        {"test": "BESS Balance Test",
         "rationale": "Postural-control screen, safe across screening states."},
    ]

    skipped: list[dict[str, Any]] = []

    def drop(name: str, reason: str) -> None:
        nonlocal candidates
        for c in candidates:
            if c["test"] == name:
                skipped.append({"test": name, "reason": reason})
        candidates = [c for c in candidates if c["test"] != name]

    if parq_yes:
        drop("Bench Press 3RM", "PAR-Q clearance pending — no max-effort lift.")
        drop("Squat 3RM",       "PAR-Q clearance pending — no max-effort lift.")
        drop("1.5-mile Run Test (max cardio)",
             "PAR-Q clearance pending — no max-effort cardio.")

    if cvd_count >= 2:
        drop("1.5-mile Run Test (max cardio)",
             f"{cvd_count} CVD risk factors — max-effort cardio excluded.")
        # Keep Chester (sub-max) but cap explicitly via rationale below.

    if hypertensive:
        drop("1.5-mile Run Test (max cardio)",
             f"Resting BP {bp_sys}/{bp_dia} mmHg — sub-max cardio only.")
        drop("Bench Press 3RM",
             f"Resting BP {bp_sys}/{bp_dia} mmHg — no max-effort lift.")
        drop("Squat 3RM",
             f"Resting BP {bp_sys}/{bp_dia} mmHg — no max-effort lift.")

    if beta_blockers:
        # Annotate (don't drop) cardio tests with RPE-anchor instead of HR.
        for c in candidates:
            if "cardio" in c["test"].lower():
                c["rationale"] += " Anchor effort with RPE (target 13–15), not HR — beta-blockers blunt HR response."

    # Annotate every kept item with the explicit contraindication check.
    contraindication = (
        f"parq_clearance={parq_yes}; cleared={cleared}; cvd_count={cvd_count}; "
        f"bp={bp_sys}/{bp_dia}; beta_blockers={beta_blockers}"
    )
    for c in candidates:
        c["contraindication_check"] = contraindication

    return {"battery": candidates, "skipped": skipped}


# ── Tool implementations ─────────────────────────────────────────────────────

class GetClientScreening(BaseTool):
    name: str = "get_client_screening"
    description: str = (
        "Return the client's latest screening bundle: PAR-Q answers, medical "
        "history (incl. beta-blockers + chronic conditions), CVD risk factors, "
        "latest BP/HR, latest postural findings, and the training_blocked flag. "
        "Always call this before designing tests or programs so safety invariants "
        "are honored."
    )
    args_schema: Type[BaseModel] = GetScreeningInput
    run_client_id: str

    def _run(self, client_id: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        return json.dumps(_load_screening_bundle(client_id), default=str)


class DesignFitnessTests(BaseTool):
    name: str = "design_fitness_tests"
    description: str = (
        "Design the safest fitness test battery for this client based on their "
        "screening + latest BP. Returns "
        "{ battery: [{test, rationale, contraindication_check}], skipped: "
        "[{test, reason}], blocked?: bool, reason?: str }. "
        "If 'blocked' is true, do NOT run any tests or programs — refer to physician."
    )
    args_schema: Type[BaseModel] = DesignFitnessTestsInput
    run_client_id: str

    def _run(self, client_id: str) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        bundle = _load_screening_bundle(client_id)
        return json.dumps(design_battery(bundle), default=str)


class WriteFitnessAssessment(BaseTool):
    name: str = "write_fitness_assessment"
    description: str = (
        "Persist a completed fitness assessment (designed battery + recorded "
        "results) into fitness_assessments. Call this only after results are in."
    )
    args_schema: Type[BaseModel] = WriteFitnessAssessmentInput
    run_client_id: str

    def _run(self, client_id: str, battery: dict, results: dict) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        client_resp = (
            db.table("clients").select("trainer_id").eq("id", client_id).single().execute()
        )
        trainer_id = client_resp.data["trainer_id"]
        db.table("fitness_assessments").insert({
            "trainer_id": trainer_id,
            "client_id":  client_id,
            "battery":    battery,
            "results":    results,
            "designed_by": "planner_agent",
        }).execute()
        return "Fitness assessment recorded."


def make_assessment_tools(run_client_id: str) -> list[BaseTool]:
    return [
        GetClientScreening(run_client_id=run_client_id),
        DesignFitnessTests(run_client_id=run_client_id),
        WriteFitnessAssessment(run_client_id=run_client_id),
    ]
