"""Gym Days AI service — FastAPI entry point."""
from __future__ import annotations
import json as _json
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from ai.crew.flows import (
    onboarding_flow, weekly_planning_flow, weekly_nutrition_flow, weekly_review_flow,
    daily_reminder_flow, weekly_checkin_flow, post_session_nudge_flow,
    post_workout_analysis_flow, inbound_telegram_flow, hr_health_flow,
    exercise_coach_flow, session_analysis_flow, exercise_research_flow,
    insight_tree_flow, aft_classification_flow, draft_message_flow,
    screening_readiness_flow,
)
from ai.crew.thoughts import (
    new_run_id, drain, finish, publish_result, publish_error,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm-up: verify DB connection on start.
    from ai.db import get_db
    from ai.config import SUPABASE_URL
    try:
        get_db()
        # Log which DB this process actually targets (host only; never the key).
        # This makes "data vanished on restart" debuggable: if the host here
        # differs from the project you expect, writes are landing elsewhere.
        from urllib.parse import urlparse
        host = urlparse(SUPABASE_URL).hostname or SUPABASE_URL or "<unset>"
        print(f"[startup] AI service connected to Supabase host: {host}", flush=True)
    except EnvironmentError as e:
        import warnings
        warnings.warn(str(e))
    yield


app = FastAPI(title="Gym Days AI Service", version="0.1.0", lifespan=lifespan)


class OnboardingRequest(BaseModel):
    transcript: str
    llm_model: str | None = None  # optional per-call override of LLM_MODEL


class OnboardingResponse(BaseModel):
    client_id: str
    summary: dict


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/llms")
def list_llms(trainer_id: str | None = None) -> dict:
    """Return the supported model catalog for UI dropdowns.

    Availability (`keys`) and the suggested `default` are resolved for the given
    trainer: a key entered on the API Keys page (trainer_secrets) counts the same
    as a global .env key, so the header dropdown enables models the trainer has
    supplied their own key for.
    """
    from ai.llm import list_supported
    from ai.config import LLM_MODEL
    from ai.secrets import get_trainer_secrets, provider_available

    secrets = get_trainer_secrets(trainer_id)
    keys = {
        "openai":    provider_available("openai",    secrets=secrets),
        "anthropic": provider_available("anthropic", secrets=secrets),
        "google":    provider_available("gemini",    secrets=secrets),
    }
    # Free-first default: Gemma when a Google key is available, else premium.
    if keys["google"]:
        default = "gemini/gemma-4-31b-it"
    elif keys["anthropic"]:
        default = "anthropic/claude-haiku-4-5-20251001"
    elif keys["openai"]:
        default = "openai/gpt-4o-mini"
    else:
        default = LLM_MODEL
    return {"default": default, "models": list_supported(), "keys": keys}


@app.post("/flows/onboarding/{client_id}", response_model=OnboardingResponse)
def run_onboarding(client_id: str, body: OnboardingRequest) -> OnboardingResponse:
    if not body.transcript.strip():
        raise HTTPException(status_code=422, detail="transcript is required")
    try:
        summary = onboarding_flow(
            client_id=client_id,
            transcript=body.transcript,
            llm_model=body.llm_model,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return OnboardingResponse(client_id=client_id, summary=summary)


class PlanningRequest(BaseModel):
    llm_model: str | None = None
    window_days: int | None = None
    num_days: int | None = None
    special_requirements: str | None = None
    constraints: list[str] | None = None


class PlanningResponse(BaseModel):
    client_id: str
    summary: dict


@app.post("/flows/planning/{client_id}", response_model=PlanningResponse)
def run_planning(client_id: str, body: PlanningRequest | None = None) -> PlanningResponse:
    try:
        summary = weekly_planning_flow(
            client_id=client_id,
            llm_model=body.llm_model if body else None,
            window_days=body.window_days if body else None,
            num_days=body.num_days if body else None,
            special_requirements=body.special_requirements if body else None,
            constraints=body.constraints if body else None,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return PlanningResponse(client_id=client_id, summary=summary)


class NutritionRequest(BaseModel):
    llm_model: str | None = None
    window_days: int | None = None


class NutritionResponse(BaseModel):
    client_id: str
    summary: dict


@app.post("/flows/nutrition/{client_id}", response_model=NutritionResponse)
def run_nutrition(client_id: str, body: NutritionRequest | None = None) -> NutritionResponse:
    llm_model = body.llm_model if body else None
    window_days = body.window_days if body else None
    try:
        summary = weekly_nutrition_flow(client_id=client_id, llm_model=llm_model, window_days=window_days)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return NutritionResponse(client_id=client_id, summary=summary)


class ProgressRequest(BaseModel):
    llm_model: str | None = None
    days: int | None = None
    period_start: str | None = None
    period_end: str | None = None


class ProgressResponse(BaseModel):
    client_id: str
    summary: dict


@app.post("/flows/progress/{client_id}", response_model=ProgressResponse)
def run_progress(client_id: str, body: ProgressRequest | None = None) -> ProgressResponse:
    llm_model = body.llm_model if body else None
    days         = body.days         if body else None
    period_start = body.period_start if body else None
    period_end   = body.period_end   if body else None
    try:
        summary = weekly_review_flow(
            client_id=client_id, llm_model=llm_model,
            days=days, period_start=period_start, period_end=period_end,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return ProgressResponse(client_id=client_id, summary=summary)


# ── SSE thought streams (per-flow) ───────────────────────────────────────────
#
# These mirror the regular POST endpoints but stream the agent's progress as
# Server-Sent Events. The UI uses these to surface a concise "thought" line
# for each step (tool call) and the final result payload at the end.

def _sse(event: dict) -> str:
    return f"data: {_json.dumps(event)}\n\n"


def _run_in_thread(target, *args, **kwargs) -> threading.Thread:
    t = threading.Thread(target=target, args=args, kwargs=kwargs, daemon=True)
    t.start()
    return t


def _is_quota_error(exc: Exception) -> bool:
    """True when a run failed because the model was rate-limited / out of quota
    (e.g. the free Gemini/Gemma tier). Walks the cause chain since CrewAI/litellm
    wrap the provider error."""
    needles = (
        "ratelimiterror", "rate limit", "rate_limit", "resource_exhausted",
        "quota", "429", "too many requests", "insufficient_quota",
    )
    text = ""
    seen: BaseException | None = exc
    for _ in range(6):
        if seen is None:
            break
        text += f" {type(seen).__name__} {seen}".lower()
        seen = seen.__cause__ or seen.__context__
    return any(n in text for n in needles)


def _stream_flow(run_id: str, runner) -> StreamingResponse:
    """runner is a zero-arg callable that executes the flow synchronously and
    returns the result dict. We run it on a thread and yield events from the
    thought queue until the runner finishes (or errors)."""
    def _worker() -> None:
        try:
            result = runner()
            publish_result(run_id, result if isinstance(result, dict) else {"raw": str(result)})
        except Exception as exc:  # noqa: BLE001
            # Free model out of quota → tag it so the UI can offer a one-click
            # retry on the trainer's paid API (never auto-spends).
            code = "quota_exhausted" if _is_quota_error(exc) else None
            publish_error(run_id, str(exc), code=code)
        finally:
            finish(run_id)

    _run_in_thread(_worker)

    def _gen():
        yield _sse({"type": "start", "run_id": run_id})
        # Heartbeat every ~15s prevents proxies from killing the connection.
        idle_ticks = 0
        while True:
            ev = drain(run_id, timeout=0.5)
            if ev is None:
                idle_ticks += 1
                if idle_ticks >= 30:
                    idle_ticks = 0
                    yield ": ping\n\n"
                continue
            if ev.get("type") == "done":
                yield _sse({"type": "done"})
                return
            yield _sse(ev)

    return StreamingResponse(_gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    })


@app.post("/flows/progress/{client_id}/stream")
def stream_progress(client_id: str, body: ProgressRequest | None = None) -> StreamingResponse:
    run_id = new_run_id()
    llm_model = body.llm_model if body else None
    days = body.days if body else None
    period_start = body.period_start if body else None
    period_end = body.period_end if body else None
    return _stream_flow(run_id, lambda: weekly_review_flow(
        client_id=client_id, llm_model=llm_model,
        days=days, period_start=period_start, period_end=period_end,
        run_id=run_id,
    ))


@app.post("/flows/planning/{client_id}/stream")
def stream_planning(client_id: str, body: PlanningRequest | None = None) -> StreamingResponse:
    run_id = new_run_id()
    return _stream_flow(run_id, lambda: weekly_planning_flow(
        client_id=client_id,
        llm_model=body.llm_model if body else None,
        window_days=body.window_days if body else None,
        num_days=body.num_days if body else None,
        special_requirements=body.special_requirements if body else None,
        constraints=body.constraints if body else None,
        run_id=run_id,
    ))


class ExerciseCoachRequest(BaseModel):
    question: str = ""
    exercise: dict = {}
    client_id: Optional[str] = None
    mode: str = "qa"          # "qa" | "caveat"
    llm_model: Optional[str] = None
    trainer_id: Optional[str] = None  # lets clientless runs resolve the trainer's key


@app.post("/flows/exercise-coach/stream")
def stream_exercise_coach(body: ExerciseCoachRequest) -> StreamingResponse:
    """Per-card Programme coach. client_id is optional (the Next route enforces
    that a trainer may only pass a client they own / a client only themselves)."""
    run_id = new_run_id()
    return _stream_flow(run_id, lambda: exercise_coach_flow(
        question=body.question, exercise=body.exercise, client_id=body.client_id,
        mode=body.mode, llm_model=body.llm_model, run_id=run_id, trainer_id=body.trainer_id,
    ))


class SessionAnalysisRequest(BaseModel):
    llm_model: Optional[str] = None


@app.post("/flows/session-analysis/{client_id}/stream")
def stream_session_analysis(client_id: str, body: SessionAnalysisRequest | None = None) -> StreamingResponse:
    """Analyse the client's single most recent workout session. Triggered from
    the program page LastSessionCard. The Next route enforces trainer ownership."""
    run_id = new_run_id()
    llm_model = body.llm_model if body else None
    return _stream_flow(run_id, lambda: session_analysis_flow(
        client_id=client_id, llm_model=llm_model, run_id=run_id,
    ))


class ExerciseResearchRequest(BaseModel):
    query: Optional[str] = None
    url: Optional[str] = None
    article_text: Optional[str] = None
    llm_model: Optional[str] = None
    trainer_id: Optional[str] = None  # clientless flow — resolves the trainer's key


@app.post("/flows/exercise-research/stream")
def stream_exercise_research(body: ExerciseResearchRequest) -> StreamingResponse:
    """Research one exercise (web search / URL / pasted text) and stream a
    structured candidate row back. The trainer confirms it in the UI; the Next
    route then writes it to exercise_db (service role)."""
    run_id = new_run_id()
    return _stream_flow(run_id, lambda: exercise_research_flow(
        query=body.query, url=body.url, article_text=body.article_text,
        llm_model=body.llm_model, run_id=run_id, trainer_id=body.trainer_id,
    ))


class InsightTreeRequest(BaseModel):
    branch: str                       # health | progress | injuries | knowledge
    node_path: list[str] = []         # ancestor labels, branch → node (exclusive)
    node_label: Optional[str] = None  # the node being expanded (None ⇒ branch root)
    web_search: bool = False          # opt the open web in (default: KB only)
    depth: int = 1                    # "think deeper" slider 1–3 → agent max_iter
    llm_model: Optional[str] = None


@app.post("/flows/insight-tree/{client_id}/stream")
def stream_insight_tree(client_id: str, body: InsightTreeRequest) -> StreamingResponse:
    """Expand one node of the client's "Understand your body" insight tree. The
    Next route locks client_id to the signed-in client (trainers may preview a
    client they own)."""
    run_id = new_run_id()
    return _stream_flow(run_id, lambda: insight_tree_flow(
        client_id=client_id, branch=body.branch, node_path=body.node_path,
        node_label=body.node_label, web_search=body.web_search, depth=body.depth,
        llm_model=body.llm_model, run_id=run_id,
    ))


@app.post("/flows/nutrition/{client_id}/stream")
def stream_nutrition(client_id: str, body: NutritionRequest | None = None) -> StreamingResponse:
    run_id = new_run_id()
    llm_model = body.llm_model if body else None
    window_days = body.window_days if body else None
    return _stream_flow(run_id, lambda: weekly_nutrition_flow(
        client_id=client_id, llm_model=llm_model, window_days=window_days, run_id=run_id,
    ))


@app.post("/flows/onboarding/{client_id}/stream")
def stream_onboarding(client_id: str, body: OnboardingRequest) -> StreamingResponse:
    run_id = new_run_id()
    return _stream_flow(run_id, lambda: onboarding_flow(
        client_id=client_id, transcript=body.transcript, llm_model=body.llm_model, run_id=run_id,
    ))


# ── Messaging flow endpoints (cron-triggered + manual) ───────────────────────

class FlowRequest(BaseModel):
    llm_model: str | None = None


class FlowResponse(BaseModel):
    client_id: str
    summary: dict


def _run_or_500(fn, client_id: str, llm_model: str | None) -> dict:
    try:
        return fn(client_id, llm_model=llm_model)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/flows/daily-reminder/{client_id}", response_model=FlowResponse)
def run_daily_reminder(client_id: str, body: FlowRequest | None = None) -> FlowResponse:
    return FlowResponse(
        client_id=client_id,
        summary=_run_or_500(daily_reminder_flow, client_id, body.llm_model if body else None),
    )


@app.post("/flows/daily-reminder/{client_id}/stream")
def stream_daily_reminder(client_id: str, body: FlowRequest | None = None) -> StreamingResponse:
    run_id = new_run_id()
    llm_model = body.llm_model if body else None
    return _stream_flow(run_id, lambda: daily_reminder_flow(
        client_id=client_id, llm_model=llm_model, run_id=run_id,
    ))


@app.post("/flows/weekly-checkin/{client_id}", response_model=FlowResponse)
def run_weekly_checkin(client_id: str, body: FlowRequest | None = None) -> FlowResponse:
    return FlowResponse(
        client_id=client_id,
        summary=_run_or_500(weekly_checkin_flow, client_id, body.llm_model if body else None),
    )


@app.post("/flows/weekly-checkin/{client_id}/stream")
def stream_weekly_checkin(client_id: str, body: FlowRequest | None = None) -> StreamingResponse:
    run_id = new_run_id()
    llm_model = body.llm_model if body else None
    return _stream_flow(run_id, lambda: weekly_checkin_flow(
        client_id=client_id, llm_model=llm_model, run_id=run_id,
    ))


@app.post("/flows/post-session-nudge/{client_id}", response_model=FlowResponse)
def run_post_session_nudge(client_id: str, body: FlowRequest | None = None) -> FlowResponse:
    return FlowResponse(
        client_id=client_id,
        summary=_run_or_500(post_session_nudge_flow, client_id, body.llm_model if body else None),
    )


@app.post("/flows/post-session-nudge/{client_id}/stream")
def stream_post_session_nudge(client_id: str, body: FlowRequest | None = None) -> StreamingResponse:
    run_id = new_run_id()
    llm_model = body.llm_model if body else None
    return _stream_flow(run_id, lambda: post_session_nudge_flow(
        client_id=client_id, llm_model=llm_model, run_id=run_id,
    ))


@app.post("/flows/post-workout-analysis/{client_id}", status_code=202)
def run_post_workout_analysis(
    client_id: str,
    background_tasks: BackgroundTasks,
    body: FlowRequest | None = None,
) -> dict:
    """Triggered by the Strava webhook the moment a new activity is ingested.

    The CrewAI flow takes many seconds (LLM calls), but the webhook caller
    (Strava → our Next.js route) needs a fast response, so we run the flow in a
    background task and return 202 immediately. Errors are logged inside the
    flow's agent_runs row, not surfaced to the caller."""
    llm_model = body.llm_model if body else None
    background_tasks.add_task(post_workout_analysis_flow, client_id, llm_model=llm_model)
    return {"client_id": client_id, "status": "accepted"}


# ── M18 — Screening-aware fitness test design ────────────────────────────────
# Pure helper, no LLM call: applies the safety invariants to the client's
# screening + latest BP and returns the safest battery + a list of skipped
# tests with reasons. The trainer-facing first-lesson page calls this to
# pre-populate the battery before recording results.

@app.post("/assessment/design/{client_id}")
def design_assessment(client_id: str) -> dict:
    from ai.crew.tools.assessment import _load_screening_bundle, design_battery
    try:
        bundle = _load_screening_bundle(client_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return design_battery(bundle)


# ── InBody / BIA photo OCR ────────────────────────────────────────────────────

@app.post("/ocr/inbody")
async def ocr_inbody(file: UploadFile = File(...)) -> dict:
    """Extract body-composition params from a photographed InBody/BIA sheet.

    Returns ``{machine, mapped, extra}`` for the web app to autofill the intake
    form. Best-effort — the trainer reviews every value before saving.
    """
    from ai.vision.inbody_ocr import (
        OcrConfigError, SUPPORTED_MEDIA_TYPES, extract_inbody,
    )

    media_type = (file.content_type or "").lower()
    if media_type not in SUPPORTED_MEDIA_TYPES:
        # Some browsers omit/garble the content-type; fall back to the extension.
        ext = (file.filename or "").rsplit(".", 1)[-1].lower()
        media_type = {
            "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "webp": "image/webp", "gif": "image/gif",
        }.get(ext, media_type)

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > 12_000_000:
        raise HTTPException(status_code=413, detail="Image too large (max ~12 MB).")

    try:
        return extract_inbody(data, media_type)
    except OcrConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"OCR failed: {exc}") from exc


# ── Telegram inbound + linking (OpenClaw-style) ───────────────────────────────

class TelegramInboundRequest(BaseModel):
    chat_id: str
    body: str
    username: str | None = None


class InboundResponse(BaseModel):
    matched: bool
    client_id: str | None = None
    reply: str


@app.post("/messaging/inbound/telegram", response_model=InboundResponse)
def inbound_telegram(body: TelegramInboundRequest) -> InboundResponse:
    """Called by the Telegram bridge for each incoming message.
    Returns a reply for the bridge to send back to the chat."""
    try:
        out = inbound_telegram_flow(chat_id=body.chat_id, body=body.body, username=body.username)
    except Exception as exc:
        return InboundResponse(matched=False, reply=f"(assistant error: {exc})")
    return InboundResponse(
        matched=out.get("matched", False),
        client_id=out.get("client_id"),
        reply=out.get("reply", ""),
    )


class TelegramLinkRequest(BaseModel):
    code: str           # the client_id encoded in the deep link's /start param
    chat_id: str
    username: str | None = None


class TelegramLinkResponse(BaseModel):
    ok: bool
    client_name: str | None = None
    detail: str | None = None


@app.post("/messaging/telegram/link", response_model=TelegramLinkResponse)
def telegram_link(body: TelegramLinkRequest) -> TelegramLinkResponse:
    """Associate a Telegram chat_id with a client (via /start <client_id>)."""
    from ai.db import get_db
    db = get_db()
    resp = db.table("clients").select("id, name").eq("id", body.code).limit(1).execute()
    if not resp.data:
        return TelegramLinkResponse(ok=False, detail="unknown link code")
    client = resp.data[0]
    db.table("clients").update({"telegram_chat_id": str(body.chat_id)}).eq("id", client["id"]).execute()
    return TelegramLinkResponse(ok=True, client_name=client.get("name"))


@app.get("/messaging/telegram/bot-info")
def telegram_bot_info(trainer_id: str | None = None) -> dict:
    """Return the bot's @username (for building deep links) if a token is set."""
    import httpx
    from ai.messaging.factory import _load_trainer_creds  # type: ignore
    from ai.config import _get  # type: ignore
    token = ""
    if trainer_id:
        creds = _load_trainer_creds(trainer_id, "telegram") or {}
        token = (creds.get("bot_token") or "").strip()
    if not token:
        token = _get("TELEGRAM_BOT_TOKEN")
    if not token:
        return {"configured": False}
    try:
        r = httpx.get(f"https://api.telegram.org/bot{token}/getMe", timeout=10)
        d = r.json()
        if r.status_code == 200 and d.get("ok"):
            return {"configured": True, "username": d["result"].get("username")}
        return {"configured": False, "detail": d}
    except Exception as exc:
        return {"configured": False, "detail": str(exc)}


# ── Messaging endpoints ──────────────────────────────────────────────────────

@app.get("/messaging/providers")
def messaging_providers(trainer_id: str | None = None) -> dict:
    """Catalog of providers + availability — used by the UI dropdown.
    If `trainer_id` is passed, DB-stored credentials are checked first."""
    from ai.messaging.factory import list_providers
    return {"providers": list_providers(trainer_id=trainer_id)}


class TestCredentialsRequest(BaseModel):
    provider: str
    credentials: dict


class TestCredentialsResponse(BaseModel):
    ok: bool
    detail: str | None = None


@app.post("/messaging/test-credentials", response_model=TestCredentialsResponse)
def test_credentials(body: TestCredentialsRequest) -> TestCredentialsResponse:
    """Validate the supplied credentials by constructing the provider + making
    a lightweight read-only API call. Returns ok=False with a detail message
    on failure — does NOT raise.
    """
    from ai.messaging.factory import REGISTRY
    cls = REGISTRY.get(body.provider)
    if cls is None:
        return TestCredentialsResponse(ok=False, detail=f"unknown provider: {body.provider}")
    try:
        prov = cls(creds=body.credentials)
    except Exception as exc:
        return TestCredentialsResponse(ok=False, detail=str(exc))

    # Best-effort live ping per provider (read-only).
    try:
        import httpx
        if body.provider == "telegram":
            r = httpx.get(f"https://api.telegram.org/bot{prov.token}/getMe", timeout=10)  # type: ignore[attr-defined]
            if r.status_code == 200 and r.json().get("ok"):
                return TestCredentialsResponse(ok=True)
            return TestCredentialsResponse(ok=False, detail=f"Telegram {r.status_code}: {r.text[:200]}")
        if body.provider == "email":
            # Validate the Resend API key by listing domains. A send-only
            # ("restricted") key authenticates fine but is forbidden from this
            # read endpoint — that 401 still proves the key is real and able to
            # send, which is all we need, so accept it.
            r = httpx.get(
                "https://api.resend.com/domains",
                headers={"Authorization": f"Bearer {prov.api_key}"},  # type: ignore[attr-defined]
                timeout=10,
            )
            if r.status_code == 200:
                return TestCredentialsResponse(ok=True)
            try:
                name = r.json().get("name")
            except Exception:
                name = None
            if r.status_code == 401 and name == "restricted_api_key":
                return TestCredentialsResponse(ok=True)
            return TestCredentialsResponse(ok=False, detail=f"Resend {r.status_code}: {r.text[:200]}")
        # console: nothing to ping — construction success is the test.
        return TestCredentialsResponse(ok=True)
    except Exception as exc:
        return TestCredentialsResponse(ok=False, detail=str(exc))


# ── HR health analysis ───────────────────────────────────────────────────────

class HrHealthRequest(BaseModel):
    llm_model: str | None = None
    weeks: int | None = None
    period_start: str | None = None
    period_end:   str | None = None


class HrHealthResponse(BaseModel):
    weeks_data: list
    insights: str | None
    flags: list
    period_start: str | None = None
    period_end:   str | None = None


@app.post("/flows/hr-health/{client_id}/stream")
def stream_hr_health(client_id: str, body: HrHealthRequest | None = None) -> StreamingResponse:
    run_id = new_run_id()
    llm_model    = body.llm_model    if body else None
    weeks        = (body.weeks       if body and body.weeks else 8)
    period_start = body.period_start if body else None
    period_end   = body.period_end   if body else None
    return _stream_flow(run_id, lambda: hr_health_flow(
        client_id=client_id, weeks=weeks,
        period_start=period_start, period_end=period_end,
        llm_model=llm_model, run_id=run_id,
    ))


@app.post("/flows/hr-health/{client_id}", response_model=HrHealthResponse)
def run_hr_health(client_id: str, body: HrHealthRequest | None = None) -> HrHealthResponse:
    llm_model    = body.llm_model    if body else None
    weeks        = (body.weeks       if body and body.weeks else 8)
    period_start = body.period_start if body else None
    period_end   = body.period_end   if body else None
    try:
        result = hr_health_flow(
            client_id=client_id,
            weeks=weeks,
            period_start=period_start,
            period_end=period_end,
            llm_model=llm_model,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return HrHealthResponse(
        weeks_data=result.get("weeks_data", []),
        insights=result.get("insights"),
        flags=result.get("flags", []),
        period_start=result.get("period_start"),
        period_end=result.get("period_end"),
    )


# ── AFT classification (APTHK10) ─────────────────────────────────────────────
class AftClassificationRequest(BaseModel):
    llm_model: str | None = None


class AftClassificationResponse(BaseModel):
    level: str
    rationale: str | None = None
    signals: list = []
    classified_at: str | None = None


@app.post("/flows/aft-classification/{client_id}/stream")
def stream_aft_classification(client_id: str, body: AftClassificationRequest | None = None) -> StreamingResponse:
    run_id = new_run_id()
    llm_model = body.llm_model if body else None
    return _stream_flow(run_id, lambda: aft_classification_flow(
        client_id=client_id, llm_model=llm_model, run_id=run_id,
    ))


@app.post("/flows/aft-classification/{client_id}", response_model=AftClassificationResponse)
def run_aft_classification(client_id: str, body: AftClassificationRequest | None = None) -> AftClassificationResponse:
    llm_model = body.llm_model if body else None
    try:
        result = aft_classification_flow(client_id=client_id, llm_model=llm_model)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return AftClassificationResponse(
        level=result.get("level", "green"),
        rationale=result.get("rationale"),
        signals=result.get("signals", []),
        classified_at=result.get("classified_at"),
    )


# ── Pre-training screening readiness ─────────────────────────────────────────

class ScreeningReadinessRequest(BaseModel):
    llm_model: str | None = None


class ScreeningReadinessResponse(BaseModel):
    verdict: str  # "ready" | "alert"
    rationale: str | None = None
    flags: list = []
    checked_at: str | None = None


@app.post("/flows/screening-readiness/{client_id}/stream")
def stream_screening_readiness(client_id: str, body: ScreeningReadinessRequest | None = None) -> StreamingResponse:
    run_id = new_run_id()
    llm_model = body.llm_model if body else None
    return _stream_flow(run_id, lambda: screening_readiness_flow(
        client_id=client_id, llm_model=llm_model, run_id=run_id,
    ))


@app.post("/flows/screening-readiness/{client_id}", response_model=ScreeningReadinessResponse)
def run_screening_readiness(client_id: str, body: ScreeningReadinessRequest | None = None) -> ScreeningReadinessResponse:
    llm_model = body.llm_model if body else None
    try:
        result = screening_readiness_flow(client_id=client_id, llm_model=llm_model)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return ScreeningReadinessResponse(
        verdict=result.get("verdict", "alert"),
        rationale=result.get("rationale"),
        flags=result.get("flags", []),
        checked_at=result.get("checked_at"),
    )


# ── Strava utilities ─────────────────────────────────────────────────────────

class BackfillSufferResponse(BaseModel):
    checked: int
    updated: int


@app.post("/strava/backfill-suffer", response_model=BackfillSufferResponse)
def backfill_suffer_scores(
    client_id: str | None = None,
    limit: int = 50,
    hours: int = 24,
) -> BackfillSufferResponse:
    """Re-fetch Strava activities missing suffer_score.

    Only touches activities created within the last `hours` window to avoid
    excessive DB reads. The cron job uses the default (24h / 50 rows).
    The manual UI button passes hours=720 (30 days) for a deeper sweep.
    """
    from datetime import datetime, timezone, timedelta
    from ai.integrations.strava import (
        fetch_activity, upsert_activity, find_token_for_client, ensure_fresh_token,
    )
    from ai.db import get_db

    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    q = db.table("activities") \
        .select("id, external_id, client_id, trainer_id, metrics") \
        .eq("source", "strava") \
        .gt("created_at", cutoff) \
        .order("created_at", desc=True) \
        .limit(limit)
    if client_id:
        q = q.eq("client_id", client_id)
    resp = q.execute()

    candidates = [r for r in (resp.data or []) if not (r.get("metrics") or {}).get("suffer_score")]

    updated = 0
    for row in candidates:
        token_row = find_token_for_client(row["client_id"])
        if not token_row:
            continue
        try:
            access = ensure_fresh_token(token_row)
            raw = fetch_activity(row["external_id"], access)
            if raw.get("suffer_score") is not None:
                upsert_activity(raw, trainer_id=row["trainer_id"], client_id=row["client_id"])
                updated += 1
        except Exception:
            continue

    return BackfillSufferResponse(checked=len(candidates), updated=updated)


class SendMessageRequest(BaseModel):
    body:     str
    provider: str | None = None
    subject:  str | None = None   # email only — ignored by chat channels
    to:       str | None = None   # explicit recipient override (email address)


class SendMessageResponse(BaseModel):
    client_id:   str
    message_id:  str
    status:      str
    channel:     str
    provider:    str


class DraftMessageRequest(BaseModel):
    channel: str = "telegram"      # "telegram" | "email"
    brief:   str | None = None     # trainer's rough note about what to say


class DraftMessageResponse(BaseModel):
    channel: str
    body:    str
    subject: str | None = None


@app.post("/messaging/draft/{client_id}", response_model=DraftMessageResponse)
def draft_message_endpoint(client_id: str, body: DraftMessageRequest) -> DraftMessageResponse:
    """Generate (but do NOT send) a channel-appropriate message draft for the
    trainer to review, edit, and send."""
    out = draft_message_flow(client_id, channel=body.channel, brief=body.brief)
    return DraftMessageResponse(
        channel=out.get("channel", body.channel),
        body=out.get("body", ""),
        subject=out.get("subject"),
    )


@app.post("/messaging/draft/{client_id}/stream")
def stream_draft_message(client_id: str, body: DraftMessageRequest) -> StreamingResponse:
    """Streaming variant — emits the agent's data-gathering thoughts live, then
    the final {channel, body, subject} as the result event."""
    run_id = new_run_id()
    return _stream_flow(run_id, lambda: draft_message_flow(
        client_id, channel=body.channel, brief=body.brief, run_id=run_id,
    ))


@app.post("/messaging/send/{client_id}", response_model=SendMessageResponse)
def send_message_endpoint(client_id: str, body: SendMessageRequest) -> SendMessageResponse:
    """Test/direct send. Used by the UI's 'Send test message' button."""
    from ai.db import get_db
    from ai.messaging.factory import get_provider

    db = get_db()
    client = db.table("clients") \
        .select("trainer_id, telegram_chat_id, email") \
        .eq("id", client_id).single().execute().data

    # Build the provider with this trainer's saved DB credentials (falling back
    # to env). Constructing env-only first would wrongly fail for channels the
    # trainer configured via the Connections card but not in the environment.
    try:
        prov = get_provider(body.provider, trainer_id=client["trainer_id"])
    except Exception as exc:  # NotConfigured / ValueError
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    to = None
    if prov.channel == "telegram":
        to = client.get("telegram_chat_id")
    elif prov.channel == "email":
        # Explicit override (trainer edited the recipient) wins; else the email on file.
        to = (body.to or "").strip() or client.get("email")

    try:
        result = prov.send(
            trainer_id=client["trainer_id"],
            client_id=client_id,
            body=body.body,
            to=to,
            subject=body.subject,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return SendMessageResponse(
        client_id=client_id,
        message_id=result.message_id,
        status=result.status,
        channel=prov.channel,
        provider=type(prov).__name__,
    )


# ── Knowledge base endpoints ─────────────────────────────────────────────────

class KnowledgeDocResponse(BaseModel):
    doc_id: str
    status: str


class KnowledgeTagsRequest(BaseModel):
    default_tags: list[str]
    propagate_to_chunks: Optional[bool] = False


@app.post("/knowledge/ingest", response_model=KnowledgeDocResponse)
async def knowledge_ingest(
    background_tasks: BackgroundTasks,
    trainer_id: Optional[str] = Query(default=None),
    title: str = Form(...),
    source_type: str = Form(...),
    default_tags: str = Form(default="[]"),
    url: Optional[str] = Form(default=None),
    article_text: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    trainer_id_form: Optional[str] = Form(default=None, alias="trainer_id"),
) -> KnowledgeDocResponse:
    """Ingest a document into the trainer's knowledge base.

    Accepts multipart/form-data with either a file upload or url/article_text.
    Processing runs as a background task; returns immediately with doc_id and status='processing'.
    """
    import json as _json
    from ai.db import get_db
    from ai.knowledge import extract_documents, ingest_doc_safe

    # Accept trainer_id from either query param (preferred — streaming uploads)
    # or the form body (legacy callers).
    resolved_trainer_id = trainer_id or trainer_id_form
    if not resolved_trainer_id:
        raise HTTPException(status_code=422, detail="trainer_id required")

    try:
        tags: list[str] = _json.loads(default_tags) if default_tags else []
    except Exception:
        tags = []

    if source_type not in ("url", "pdf", "docx", "pptx", "article"):
        raise HTTPException(status_code=422, detail=f"Invalid source_type: {source_type!r}")

    db = get_db()
    row = db.table("knowledge_docs").insert({
        "trainer_id":     resolved_trainer_id,
        "title":          title,
        "source_type":    source_type,
        "source_url":     url,
        "default_tags":   tags,
        "status":         "processing",
        "progress_stage": "queued",
    }).execute()
    doc_id: str = row.data[0]["id"]

    # Read file bytes before the request scope closes
    file_bytes = await file.read() if file else None
    filename = file.filename if file else None

    def _run() -> None:
        try:
            # Stage 1: extraction
            try:
                get_db().table("knowledge_docs").update({"progress_stage": "extracting"}).eq("id", doc_id).execute()
            except Exception:
                pass
            docs = extract_documents(
                source_type,
                file_bytes=file_bytes,
                filename=filename,
                url=url,
                article_text=article_text,
            )
            # Stages 2-4 (chunking → tagging → saving) handled inside ingest_doc
            ingest_doc_safe(resolved_trainer_id, doc_id, docs, tags)
        except Exception as exc:
            try:
                db2 = get_db()
                db2.table("knowledge_docs").update({
                    "status": "error",
                    "error_detail": str(exc)[:500],
                }).eq("id", doc_id).execute()
            except Exception:
                pass

    background_tasks.add_task(_run)
    return KnowledgeDocResponse(doc_id=doc_id, status="processing")


@app.get("/knowledge/docs/{trainer_id}")
def knowledge_list_docs(trainer_id: str) -> dict:
    """List all knowledge docs for a trainer, newest first."""
    from ai.db import get_db
    db = get_db()
    resp = db.table("knowledge_docs") \
        .select("id, title, source_type, source_url, default_tags, status, chunk_count, error_detail, progress_stage, progress_done, progress_total, created_at") \
        .eq("trainer_id", trainer_id) \
        .order("created_at", desc=True) \
        .execute()
    return {"docs": resp.data or []}


@app.get("/knowledge/docs/{doc_id}/chunks")
def knowledge_list_chunks(doc_id: str) -> dict:
    """List all chunks for a doc with their auto-tags + tag counts."""
    from ai.db import get_db
    db = get_db()
    resp = db.table("knowledge_chunks") \
        .select("id, chunk_index, title, content, agent_tags, tags_confirmed") \
        .eq("doc_id", doc_id) \
        .order("chunk_index") \
        .execute()
    from ai.knowledge import UNASSIGNED_TAG
    chunks = resp.data or []
    counts: dict[str, int] = {"progress": 0, "planner": 0, "nutrition": 0, "messaging": 0, "unassigned": 0, "untagged": 0}
    for c in chunks:
        tags = c.get("agent_tags") or []
        if not tags:
            counts["untagged"] += 1
        else:
            for t in tags:
                if t == UNASSIGNED_TAG:
                    counts["unassigned"] += 1
                elif t in counts:
                    counts[t] += 1
    return {"chunks": chunks, "counts": counts}


def _parse_embedding(raw) -> list[float] | None:
    """pgvector round-trips as a '[0.1,0.2,...]' string (sometimes already a list).
    Normalise both shapes to a float list; return None if it can't be read."""
    if raw is None:
        return None
    if isinstance(raw, list):
        return [float(x) for x in raw]
    if isinstance(raw, str):
        try:
            import json
            return [float(x) for x in json.loads(raw)]
        except Exception:
            return None
    return None


def _attach_unassigned_similarity(db, bucket: dict) -> None:
    """Score each shelved chunk against every agent's domain and attach the
    per-agent cosine similarities to its leaf (in place). Best-effort: any failure
    just leaves the scores off so the review UI degrades gracefully."""
    from ai.knowledge import agent_similarity_scores

    leaves = [c for d in bucket.get("docs", {}).values() for c in d["chunks"]] \
        if isinstance(bucket.get("docs"), dict) \
        else [c for d in bucket.get("docs", []) for c in d["chunks"]]
    if not leaves:
        return

    ids = [c["id"] for c in leaves]
    try:
        rows = db.table("knowledge_chunks") \
            .select("id, embedding") \
            .in_("id", ids) \
            .execute().data or []
    except Exception:
        return

    vec_by_id = {r["id"]: _parse_embedding(r.get("embedding")) for r in rows}
    for leaf in leaves:
        scores = agent_similarity_scores(vec_by_id.get(leaf["id"]))
        if scores:
            # Round for a stable, compact payload — display only needs 2 dp.
            leaf["agent_sims"] = {k: round(v, 3) for k, v in scores.items()}


@app.get("/knowledge/agents/{trainer_id}")
def knowledge_agent_memory(trainer_id: str, lang: str = "en") -> dict:
    """Per-agent RAG memory: the chunks each agent can actually retrieve, grouped by source doc.

    Mirrors the retrieval filter in match_knowledge_hybrid: an agent sees a chunk when the
    chunk is tagged for it OR is untagged (untagged = shared by all agents). Only ready docs
    contribute, since processing/errored docs aren't searchable.

    `lang` is the trainer's app-UI locale: the learning bullets are returned in that
    language (cached translation), falling back to the base English bullets where no
    translation exists yet.
    """
    from ai.db import get_db
    from ai.knowledge import (
        backfill_agent_summaries, backfill_agent_summary_translations,
        BASE_SUMMARY_LANG, UNASSIGNED_TAG,
    )
    db = get_db()
    AGENTS = ["progress", "planner", "nutrition", "messaging"]

    # Ensure every (doc, agent) pair has its base learning bullets (cheap once cached),
    # then ensure the requested locale's translations exist (no-op for English).
    backfill_agent_summaries(trainer_id)
    backfill_agent_summary_translations(trainer_id, lang)

    def _summaries_for(doc: dict) -> dict:
        """Pick the bullets to show: translated for `lang`, else the base English."""
        base = doc.get("agent_summaries") or {}
        if lang == BASE_SUMMARY_LANG:
            return base
        trans = (doc.get("agent_summaries_i18n") or {}).get(lang) or {}
        # Translated bullets win where present; untranslated agents fall back to base.
        return {**base, **{a: v for a, v in trans.items() if v}}

    # Ready docs only, keyed for quick lookup + stable ordering.
    docs_resp = db.table("knowledge_docs") \
        .select("id, title, source_type, agent_summaries, agent_summaries_i18n, created_at") \
        .eq("trainer_id", trainer_id) \
        .eq("status", "ready") \
        .order("created_at", desc=True) \
        .execute()
    docs = docs_resp.data or []
    doc_by_id = {d["id"]: d for d in docs}

    chunks_resp = db.table("knowledge_chunks") \
        .select("id, doc_id, chunk_index, title, content, agent_tags, unassigned_reason") \
        .eq("trainer_id", trainer_id) \
        .order("chunk_index") \
        .execute()
    chunks = chunks_resp.data or []

    # Build per-agent → per-doc chunk lists, preserving doc order from doc_by_id.
    # The UNASSIGNED_TAG bucket holds chunks no agent could be matched to — kept for
    # trainer review, invisible to every agent's retrieval.
    agents: dict[str, dict] = {}
    for a in AGENTS + [UNASSIGNED_TAG]:
        agents[a] = {"chunk_count": 0, "docs": {}}

    def _leaf(c: dict) -> dict:
        return {"id": c["id"], "chunk_index": c["chunk_index"], "title": c.get("title"), "content": c["content"]}

    for c in chunks:
        doc = doc_by_id.get(c["doc_id"])
        if not doc:
            continue  # chunk belongs to a non-ready/missing doc
        tags = c.get("agent_tags") or []
        # Untagged (empty) chunks are visible to every agent (shared memory); the
        # unassigned sentinel routes to its own review bucket only.
        targets = AGENTS if not tags else [t for t in tags if t in agents]
        doc_summaries = _summaries_for(doc)
        for a in targets:
            bucket = agents[a]["docs"].setdefault(
                c["doc_id"],
                {
                    "doc_id": c["doc_id"],
                    "title": doc["title"],
                    "source_type": doc["source_type"],
                    # Per-agent bullets: what THIS agent learns from this doc. The
                    # unassigned bucket has no agent summary, so it falls back to [].
                    "learns": doc_summaries.get(a, []),
                    "chunks": [],
                },
            )
            leaf = _leaf(c)
            if a == UNASSIGNED_TAG:
                # Short reason for the review UI (e.g. 'header' vs 'low_relevance').
                from ai.knowledge import unassigned_reason
                # Prefer the reason recorded at ingest; fall back to a content-only
                # guess for chunks shelved before the column existed.
                leaf["reason"] = c.get("unassigned_reason") or unassigned_reason(c.get("content") or "")
            bucket["chunks"].append(leaf)
            agents[a]["chunk_count"] += 1

    # Attach nearest-agent similarity scores to the shelved (unassigned) chunks so
    # the review UI can show, per agent button, how close the chunk sits to each
    # agent's domain. Scored from the stored embeddings — only the unassigned
    # bucket needs them, so we fetch those vectors separately to keep the main
    # chunk query lean.
    _attach_unassigned_similarity(db, agents[UNASSIGNED_TAG])

    # Flatten doc maps into ordered lists following newest-first doc order.
    def _flatten(bucket: dict) -> dict:
        ordered_docs = [bucket["docs"][d["id"]] for d in docs if d["id"] in bucket["docs"]]
        return {"chunk_count": bucket["chunk_count"], "docs": ordered_docs}

    out = {a: _flatten(agents[a]) for a in AGENTS}
    return {"agents": out, "unassigned": _flatten(agents[UNASSIGNED_TAG])}


@app.delete("/knowledge/docs/{doc_id}")
def knowledge_delete_doc(doc_id: str) -> dict:
    """Delete a knowledge doc and all its chunks (cascade)."""
    from ai.db import get_db
    db = get_db()
    # Delete chunks explicitly first (avoids slow cascade timeouts on big docs
    # and surfaces real errors instead of swallowing them).
    db.table("knowledge_chunks").delete().eq("doc_id", doc_id).execute()
    resp = db.table("knowledge_docs").delete().eq("id", doc_id).execute()
    deleted = len(resp.data or [])
    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"doc {doc_id} not found")
    return {"deleted": doc_id, "rows": deleted}


@app.delete("/knowledge/chunks/{chunk_id}")
def knowledge_delete_chunk(chunk_id: str) -> dict:
    """Delete a single knowledge chunk (used to prune reviewed unassigned chunks),
    keeping the parent doc's chunk_count in sync."""
    from ai.db import get_db
    db = get_db()
    found = db.table("knowledge_chunks").select("id, doc_id").eq("id", chunk_id).limit(1).execute()
    row = (found.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail=f"chunk {chunk_id} not found")
    doc_id = row["doc_id"]
    # Delete and confirm a row actually went — don't report success on a no-op
    # (returning=representation makes the deleted rows come back in .data).
    deleted = db.table("knowledge_chunks").delete().eq("id", chunk_id).execute()
    if not (deleted.data or []):
        raise HTTPException(status_code=500, detail=f"chunk {chunk_id} delete affected no rows")
    # Recompute the doc's chunk_count so the docs list stays honest (best-effort).
    try:
        cnt = db.table("knowledge_chunks").select("id", count="exact").eq("doc_id", doc_id).execute()
        remaining = cnt.count if cnt.count is not None else len(cnt.data or [])
        db.table("knowledge_docs").update({"chunk_count": remaining}).eq("id", doc_id).execute()
    except Exception:
        pass
    return {"deleted": chunk_id, "doc_id": doc_id}


class ChunkTagsRequest(BaseModel):
    agent_tags: list[str]


@app.patch("/knowledge/chunks/{chunk_id}")
def knowledge_update_chunk_tags(chunk_id: str, body: ChunkTagsRequest) -> dict:
    """Assign a single chunk to specific agents (used to triage unassigned chunks).
    Marks tags_confirmed so later propagation/backfill won't override the choice.

    The assignment shifts the affected agents' chunk signature for this doc, so the
    next memory load / card refresh regenerates exactly those summaries (and only those)
    — see backfill_agent_summaries. The existing summary stays visible until then."""
    from ai.db import get_db
    from ai.knowledge import AGENT_TAGS
    db = get_db()
    valid = [t for t in body.agent_tags if t in AGENT_TAGS]
    if not valid:
        raise HTTPException(status_code=422, detail="at least one valid agent tag required")
    resp = db.table("knowledge_chunks").update({
        "agent_tags": valid,
        "tags_confirmed": True,
    }).eq("id", chunk_id).execute()
    if not (resp.data or []):
        raise HTTPException(status_code=404, detail=f"chunk {chunk_id} not found")
    return {"chunk_id": chunk_id, "agent_tags": valid}


@app.patch("/knowledge/docs/{doc_id}/tags")
def knowledge_update_tags(doc_id: str, body: KnowledgeTagsRequest) -> dict:
    """Update default_tags on a doc; optionally propagate to all unconfirmed chunks."""
    from ai.db import get_db
    db = get_db()
    db.table("knowledge_docs").update({"default_tags": body.default_tags}).eq("id", doc_id).execute()
    if body.propagate_to_chunks:
        db.table("knowledge_chunks") \
            .update({"agent_tags": body.default_tags}) \
            .eq("doc_id", doc_id) \
            .eq("tags_confirmed", False) \
            .execute()
    return {"doc_id": doc_id, "default_tags": body.default_tags}


@app.post("/knowledge/reclassify-broadcast")
def knowledge_reclassify_broadcast(
    trainer_id: str | None = None,
    use_llm: bool = False,
) -> dict:
    """One-time backfill: re-scope legacy chunks with agent_tags = [] (broadcast to
    all agents) into per-agent tags or the unassigned bucket. Scope to one trainer
    via trainer_id, or omit to sweep all. Set use_llm=true for Haiku-precision (and
    cost); default reclassifies from embeddings only.
    """
    from ai.knowledge import reclassify_broadcast_chunks
    return reclassify_broadcast_chunks(trainer_id, use_llm=use_llm)
