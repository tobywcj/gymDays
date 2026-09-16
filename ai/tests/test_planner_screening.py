"""M18 — Screening-aware Planner tests.

Pure unit tests on `design_battery` — no DB, no LLM. Covers the four safety
invariants the planner agent must honor:

  1. PAR-Q chest-pain "Yes" → excludes 1.5-mile run + 3RM lifts.
  2. BP 220/120              → blocked=True, no battery.
  3. Beta-blockers           → cardio rationale anchors on RPE, not HR.
  4. CVD risk factors ≥ 2    → max-effort cardio excluded.
"""
from __future__ import annotations
from ai.crew.tools.assessment import design_battery


def _bundle(
    *,
    parq_yes: bool = False,
    bp_sys: int | None = None,
    bp_dia: int | None = None,
    cvd_count: int = 0,
    beta_blockers: bool = False,
    training_blocked: bool = False,
    training_blocked_reason: str | None = None,
) -> dict:
    return {
        "screening": {
            "medical_clearance_required": parq_yes,
            "cvd_risk_factor_count": cvd_count,
            "medical_history": {"beta_blockers": beta_blockers},
        },
        "latest_health": {"bp_systolic": bp_sys, "bp_diastolic": bp_dia},
        "latest_postural": None,
        "client": {
            "training_blocked": training_blocked,
            "training_blocked_reason": training_blocked_reason,
        },
    }


class TestDesignBattery:
    def test_clean_client_keeps_full_battery(self):
        out = design_battery(_bundle())
        names = [b["test"] for b in out["battery"]]
        assert "Bench Press 3RM" in names
        assert "1.5-mile Run Test (max cardio)" in names
        assert out["skipped"] == []
        assert not out.get("blocked")

    def test_parq_yes_drops_max_effort_tests(self):
        """Invariant 1: PAR-Q clearance pending → no max-effort lifts/runs."""
        out = design_battery(_bundle(parq_yes=True))
        names = [b["test"] for b in out["battery"]]
        assert "Bench Press 3RM" not in names
        assert "Squat 3RM" not in names
        assert "1.5-mile Run Test (max cardio)" not in names
        skipped_names = [s["test"] for s in out["skipped"]]
        assert "Bench Press 3RM" in skipped_names
        # Sub-max alternatives remain.
        assert "Handgrip Test (static strength)" in names
        assert "Chester Step Test (sub-max cardio)" in names

    def test_high_bp_blocks_training_entirely(self):
        """Invariant 2: BP 220/120 → blocked=True, no battery."""
        out = design_battery(_bundle(
            training_blocked=True,
            training_blocked_reason="BP 220/120 mmHg recorded 2026-06-02",
        ))
        assert out["blocked"] is True
        assert "220" in out["reason"]
        assert out["battery"] == []

    def test_resting_hypertension_drops_max_effort(self):
        """Resting BP ≥ 140/90 (but < 200/110) → sub-max only."""
        out = design_battery(_bundle(bp_sys=148, bp_dia=92))
        names = [b["test"] for b in out["battery"]]
        assert "1.5-mile Run Test (max cardio)" not in names
        assert "Bench Press 3RM" not in names
        assert "Chester Step Test (sub-max cardio)" in names

    def test_beta_blockers_anchor_cardio_on_rpe(self):
        """Invariant 3: cardio rationale must reference RPE when beta-blockers present."""
        out = design_battery(_bundle(beta_blockers=True))
        chester = next(b for b in out["battery"] if "Chester" in b["test"])
        assert "RPE" in chester["rationale"]
        assert "beta-blocker" in chester["rationale"].lower()

    def test_cvd_two_plus_drops_max_cardio(self):
        """Invariant 4: ≥ 2 CVD factors → no 1.5-mile run."""
        out = design_battery(_bundle(cvd_count=3))
        names = [b["test"] for b in out["battery"]]
        assert "1.5-mile Run Test (max cardio)" not in names
        skipped_reasons = " ".join(s["reason"] for s in out["skipped"])
        assert "3 CVD" in skipped_reasons or "CVD risk" in skipped_reasons

    def test_every_kept_test_carries_contraindication_check(self):
        """Every prescribed test must expose its contraindication context for audit."""
        out = design_battery(_bundle(parq_yes=True, beta_blockers=True))
        for b in out["battery"]:
            assert "contraindication_check" in b
            assert "parq_clearance=True" in b["contraindication_check"]
            assert "beta_blockers=True" in b["contraindication_check"]
