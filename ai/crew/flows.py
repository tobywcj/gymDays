"""CrewAI Flows — orchestrate multi-agent sequences.
Implemented: onboarding_flow (M5), weekly_planning_flow (M7).
Later milestones extend the rest.
"""
from __future__ import annotations
import json
import functools
import inspect
from datetime import date, timedelta
from crewai import Crew, Task
import time
from typing import Any
from ai.db import get_db
from ai.crew.agents import (
    onboarding_agent, planner_agent, nutrition_agent, progress_agent, messaging_agent,
    concierge_agent,
)
from ai.crew.thoughts import make_step_callback, publish, run_context


# ── Output-style directive ───────────────────────────────────────────────────
# Every flow prepends this so all client-facing or persisted LLM output is
# concise, persuasive, emoji-driven, bullet-structured, and in the client's
# chosen language. Defaults to Traditional Chinese when the column is missing/null.

_LANG_INSTRUCTIONS = {
    "en": "Write ALL output text in English.",
    "zh": "用繁體中文（台灣／香港用字）輸出所有文字，包含標題、項目符號、所有回覆內容。嚴禁使用簡體字。",
}


def _client_language(client_id: str) -> str:
    try:
        resp = get_db().table("clients").select("language").eq("id", client_id).single().execute()
        return (resp.data or {}).get("language") or "zh"
    except Exception:
        return "zh"


def style_directive(client_id: str | None) -> str:
    """Prepended to every CrewAI task description so the model's prose obeys
    the global style contract + the per-client language setting. This is the
    single source of truth for the app-wide rule: ALL human-readable LLM output
    is `## Heading` sections of `- emoji bullet` lines — never prose paragraphs.
    Safe with client_id=None (defaults language to Traditional Chinese)."""
    lang = _client_language(client_id) if client_id else "zh"
    lang_line = _LANG_INSTRUCTIONS.get(lang, _LANG_INSTRUCTIONS["zh"])
    return (
        "OUTPUT STYLE — STRICT. Applies to every word of human-readable text "
        "you write (tool inputs like exercise_id / JSON plan shapes are exempt):\n"
        f"  • {lang_line}\n"
        "  • NO plain paragraphs. NO walls of prose. Every block of human-readable "
        "output MUST be either a `## Heading` or a `- emoji bullet`.\n"
        "  • Bullets only — use `- ` or `• ` for any list of 1+ items. Group "
        "related bullets under a `## Heading` (translate headings to the output language).\n"
        "  • Every bullet starts with a relevant emoji and stays ≤2 short sentences.\n"
        "  • Tone: concise, persuasive, energising — like a coach in the client's corner. "
        "No filler, no preamble, no 'In conclusion'.\n"
        "  • Emojis: 1 per bullet, used to emphasise meaning (🔥 effort, 💪 strength, "
        "🥗 food, 🛌 recovery, 🚀 progress, ⚠️ warning, 🎯 goal, 💡 tip). Never decorative-only.\n"
        "  • For short replies (e.g. concierge chat answers ≤3 lines): bullets are still "
        "required if there's >1 point; a single point can be one emoji-led line — but "
        "never a multi-sentence prose paragraph.\n"
        "  • Never invent numbers, foods, exercises, or facts.\n"
        "──────────────────────────────────────────────────────────────────\n"
    )


def inbound_telegram_flow(chat_id: str, body: str, username: str | None = None) -> dict:
    """Handle an INBOUND Telegram message (OpenClaw-style).

    1. Match the sender's telegram_chat_id to a client.
    2. Record the inbound `messages` row.
    3. Run the concierge agent to compose a reply.
    4. Record the outbound `messages` row (the bridge does the actual send).
    Returns {reply, client_id?, matched: bool}.
    """
    db = get_db()
    resp = db.table("clients") \
        .select("id, trainer_id, name") \
        .eq("telegram_chat_id", str(chat_id)) \
        .limit(1).execute()
    match = resp.data[0] if resp.data else None

    if match is None:
        return {
            "matched": False,
            "reply": (
                "Hi! This chat isn't linked yet. Open the link your trainer sent you "
                "(it starts the bot with /start) and I'll be able to help with your plan."
            ),
        }

    client_id = match["id"]
    trainer_id = match["trainer_id"]

    db.table("messages").insert({
        "trainer_id": trainer_id,
        "client_id":  client_id,
        "direction":  "inbound",
        "channel":    "telegram",
        "body":       body,
        "status":     "received",
    }).execute()

    def _fn() -> dict:
        agent = concierge_agent(client_id)
        task = Task(
            description=(
                style_directive(client_id) +
                f"The client (id={client_id}, name={match.get('name')}) sent this "
                f"Telegram message:\n\n\"{body}\"\n\n"
                "Reply helpfully and briefly using the read tools for grounding. "
                "Return ONLY the reply text the client should receive — no preamble."
            ),
            expected_output="The plain-text reply to send back to the client.",
            agent=agent,
        )
        crew = Crew(agents=[agent], tasks=[task], verbose=False)
        result = crew.kickoff()
        return {"reply": str(result).strip()}

    out = _run_flow_with_logging(
        client_id=client_id,
        agent_name="Concierge",
        flow_name="inbound_telegram_flow",
        flow_input={"chat_id": chat_id, "body": body, "username": username},
        fn=_fn,
    )
    reply = out.get("reply") or "Got it — I'll get back to you shortly."

    db.table("messages").insert({
        "trainer_id": trainer_id,
        "client_id":  client_id,
        "direction":  "outbound",
        "channel":    "telegram",
        "body":       reply,
        "status":     "sent",
    }).execute()

    return {"matched": True, "client_id": client_id, "reply": reply}


# ── Draft generation (trainer composes, then edits & sends) ──────────────────

def _channel_style(channel: str, lang_line: str) -> str:
    """Channel-appropriate formatting rules for trainer-composed drafts.

    Telegram cannot render Markdown headings, so chat drafts must be plain
    conversational text. Email may use a subject + short paragraphs.
    """
    if channel == "email":
        return (
            "OUTPUT STYLE — EMAIL. " + lang_line + " Write a warm, encouraging email from "
            "the coach to the client. Structure: a short greeting line, then the key points "
            "as bullet points (use '• '), then a brief sign-off. EVERY bullet MUST start with "
            "a relevant emoji (🔥 effort, 💪 strength, 🥗 food, 🛌 recovery, 🚀 progress, "
            "⚠️ warning, 🎯 goal, 💡 tip) and stay to 1-2 short sentences. Do NOT use Markdown "
            "headings (`#`/`##`) or `**bold**` — they don't render in email."
        )
    # telegram / console — conversational chat, no Markdown headings.
    return (
        "OUTPUT STYLE — TELEGRAM CHAT. " + lang_line + " Write a short, friendly chat message "
        "from the coach: a 1-line opener, then the points as emoji-led bullet points (use '• '). "
        "EVERY bullet MUST start with a relevant emoji (🔥 💪 🥗 🛌 🚀 ⚠️ 🎯 💡) and stay to "
        "1-2 short sentences. NEVER use Markdown headings (`#`/`##`) or `**bold**`; they show as "
        "literal characters in Telegram. Keep it tight."
    )


def draft_message_flow(
    client_id: str,
    channel: str,
    brief: str | None = None,
    *,
    llm_model: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Generate a ready-to-edit message draft for the trainer to review & send.

    Does NOT send anything — returns {channel, body, subject?}. `brief` is the
    trainer's prompt about what to say; without it, a warm personalised check-in
    is drafted. The concierge agent first pulls the client's full picture
    (profile, recent activities, latest progress report, active program, session
    logs, prior memory) so the draft is grounded in their real data. Channel-aware:
    Telegram → plain chat text; email → subject + body. When `run_id` is set, each
    data-gathering step is streamed to the UI as a thought line.
    """
    db = get_db()
    resp = db.table("clients").select("id, name").eq("id", client_id).limit(1).execute()
    name = (resp.data[0].get("name") if resp.data else None) or "the client"

    lang = _client_language(client_id)
    lang_line = _LANG_INSTRUCTIONS.get(lang, _LANG_INSTRUCTIONS["zh"])
    want_subject = channel == "email"

    brief_line = (
        f"The coach's instruction for this message: \"{brief.strip()}\"\n"
        if brief and brief.strip()
        else "No specific instruction — write a warm, personalised check-in grounded in their recent training.\n"
    )
    json_shape = (
        '{"subject": "<short email subject>", "body": "<the message>"}'
        if want_subject else '{"body": "<the message>"}'
    )

    publish(run_id, "🧠 Gathering this client's full picture…")
    cb = make_step_callback(run_id) if run_id else None

    def _fn() -> dict:
        # Generous tool budget so the agent can pull the whole client picture.
        agent = concierge_agent(client_id, llm_model=llm_model, step_callback=cb, max_iter=8)
        task = Task(
            description=(
                _channel_style(channel, lang_line) + "\n\n"
                f"You are drafting a {channel} message to {name} (client_id={client_id}).\n"
                + brief_line +
                "STRICT WORKFLOW — gather the client's data FIRST, then write:\n"
                "1. get_client_profile — name, goal, bodyweight, constraints/injuries.\n"
                "2. get_recent_activities(days=14) — what they've actually been doing.\n"
                "3. get_latest_progress_report — the latest analysis & any flags.\n"
                "4. get_active_program — what's planned next.\n"
                "5. search_client_memory — any prior context relevant to the coach's instruction.\n"
                "   (Skip a step only if a tool clearly has no data for this client.)\n"
                "6. Write the message: specific to THIS client — reference real numbers, sessions, "
                "or goals you found. Warm, encouraging, never generic. Obey any stated constraint/injury.\n"
                "Return ONLY a JSON object of the form "
                f"{json_shape} — no preamble, no code fences."
            ),
            expected_output=f"A JSON object: {json_shape}",
            agent=agent,
        )
        crew = Crew(agents=[agent], tasks=[task], verbose=False)
        with run_context(run_id, agent.role):
            raw = str(crew.kickoff()).strip()
        # Tolerate code fences / stray text around the JSON.
        if "```" in raw:
            raw = raw.split("```")[1].lstrip("json").strip()
        try:
            data = json.loads(raw)
            out = {"body": str(data.get("body", "")).strip()}
            if want_subject:
                out["subject"] = str(data.get("subject", "")).strip()
            return out
        except Exception:
            # Model returned plain text — use it as the body.
            return {"body": raw, **({"subject": ""} if want_subject else {})}

    out = _run_flow_with_logging(
        client_id=client_id,
        agent_name="Concierge",
        flow_name="draft_message_flow",
        flow_input={"channel": channel, "brief": brief},
        fn=_fn,
    )
    return {"channel": channel, **out}


# ── agent_runs logging ───────────────────────────────────────────────────────

def _log_run(
    *,
    client_id: str,
    trainer_id: str | None,
    agent: str,
    flow: str,
    input: dict | None,
    output: dict | None,
    status: str,
    latency_ms: int | None,
    cite: str | None = None,
) -> None:
    """Append a row to agent_runs. Best-effort — never raises into the flow."""
    try:
        db = get_db()
        if trainer_id is None and client_id:
            tr = db.table("clients").select("trainer_id").eq("id", client_id).limit(1).execute()
            trainer_id = tr.data[0]["trainer_id"] if tr.data else None
        db.table("agent_runs").insert({
            "trainer_id": trainer_id,
            "client_id":  client_id,
            "agent":      agent,
            "flow":       flow,
            "input":      input,
            "output":     output,
            "status":     status,
            "latency_ms": latency_ms,
            "cite":       cite,
        }).execute()
    except Exception as e:
        # Swallow — observability shouldn't kill the user-facing flow.
        print(f"[_log_run] failed to write agent_runs: {e}")


def _run_flow_with_logging(
    *,
    client_id: str,
    agent_name: str,
    flow_name: str,
    flow_input: dict,
    fn,
) -> dict:
    started = time.monotonic()
    status = "completed"
    output: dict[str, Any] = {}
    try:
        output = fn()
    except Exception as e:
        status = "failed"
        output = {"error": str(e)}
        latency_ms = int((time.monotonic() - started) * 1000)
        _log_run(
            client_id=client_id, trainer_id=None,
            agent=agent_name, flow=flow_name,
            input=flow_input, output=output, status=status,
            latency_ms=latency_ms,
        )
        raise
    latency_ms = int((time.monotonic() - started) * 1000)
    _log_run(
        client_id=client_id, trainer_id=None,
        agent=agent_name, flow=flow_name,
        input=flow_input, output=output, status=status,
        latency_ms=latency_ms,
    )
    return output


def _logged(agent_name: str, flow_name: str):
    """Decorator: record an agent_runs row for a client-scoped flow so every LLM
    generation / agent run surfaces in the trainer's Agent Activity feed.

    The client_id is resolved from the wrapped call's arguments (positional or
    keyword). Flows with no client_id (e.g. library-wide exercise research) run
    unlogged, since a feed row must be attributable to a trainer."""
    def deco(fn):
        sig = inspect.signature(fn)

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                bound = sig.bind_partial(*args, **kwargs)
                client_id = bound.arguments.get("client_id")
            except TypeError:
                client_id, bound = None, None
            if not client_id:
                return fn(*args, **kwargs)
            # Keep flow_input to small scalars — skip raw transcripts / article
            # bodies / URLs that would bloat the row.
            flow_input = {
                k: v for k, v in bound.arguments.items()
                if isinstance(v, (str, int, float, bool))
                and k not in ("client_id", "transcript", "article_text", "url")
            }
            return _run_flow_with_logging(
                client_id=client_id,
                agent_name=agent_name,
                flow_name=flow_name,
                flow_input=flow_input,
                fn=lambda: fn(*args, **kwargs),
            )

        return wrapper

    return deco


@_logged("Onboarding", "onboarding")
def onboarding_flow(client_id: str, transcript: str, llm_model: str | None = None, run_id: str | None = None) -> dict:
    """Run the Onboarding Agent against *transcript* for *client_id*.

    *llm_model* overrides the env default (LLM_MODEL) for this call.
    Returns a summary dict with profile and memory_count.
    """
    publish(run_id, "📇 Reading intake transcript…")
    cb = make_step_callback(run_id) if run_id else None
    agent = onboarding_agent(client_id, llm_model=llm_model, step_callback=cb)

    task = Task(
        description=(
            style_directive(client_id) +
            f"Process this client intake transcript for client_id={client_id}.\n\n"
            f"TRANSCRIPT:\n{transcript}\n\n"
            "1. Call write_client_profile once with a structured dict containing: "
            "goal (str), equipment (list[str]), schedule (dict with a 'notes' key), "
            "injury_history (str).\n"
            "2. Call write_client_memory at least 3 times — one call per distinct "
            "fact (use kind='onboarding_note' for all calls in this flow).\n"
            "Return a JSON summary: {\"profile\": {...}, \"memory_count\": N}"
        ),
        expected_output=(
            "A JSON string containing 'profile' (dict) and 'memory_count' (int ≥ 3)."
        ),
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task], verbose=False)
    with run_context(run_id, agent.role):
        result = crew.kickoff()

    # Parse agent output — handle CrewOutput object or plain string.
    raw = str(result) if not isinstance(result, str) else result
    try:
        summary = json.loads(raw)
    except json.JSONDecodeError:
        summary = {"raw": raw}

    return summary


# Injury keyword → muscle_groups to avoid in the deterministic fallback below.
_INJURY_AVOID = {
    "knee":     {"legs", "glutes", "hamstrings", "calves", "posterior"},
    "shoulder": {"shoulders", "rear-delts"},
    "back":     {"back", "posterior"},
    "spine":    {"back", "posterior"},
    "hip":      {"legs", "glutes", "hamstrings"},
    "ankle":    {"legs", "calves"},
    "foot":     {"legs", "calves"},
    "elbow":    {"arms"},
    "wrist":    {"arms"},
}
# Goal keyword → (sets, reps) scheme for the fallback.
_GOAL_SCHEME = [
    ("strength",    (4, "4-6")),
    ("bodybuilding",(4, "8-12")),
    ("hypertrophy", (4, "8-12")),
    ("muscle",      (4, "8-12")),
    ("endurance",   (3, "12-15")),
    ("weight",      (3, "12-15")),
    ("fat",         (3, "12-15")),
]
# Day templates: (emoji, {en, zh} focus label, ordered muscle_groups to pull from).
# Focus carries an emoji + localized text so the fallback obeys the same
# emoji-and-language contract as the LLM (cf. style_directive).
_FALLBACK_TEMPLATES = [
    ("💪", {"en": "Upper push",          "zh": "上肢推"},   ["chest", "shoulders", "arms"]),
    ("🏋️", {"en": "Upper pull",          "zh": "上肢拉"},   ["back", "rear-delts", "arms"]),
    ("🦵", {"en": "Lower body",          "zh": "下肢"},     ["legs", "glutes", "hamstrings", "posterior", "calves"]),
    ("🔥", {"en": "Core & conditioning", "zh": "核心與體能"}, ["core", "full-body"]),
]

# Muscle-group → Traditional Chinese for the localized "avoids" note.
_MG_ZH = {
    "legs": "腿部", "glutes": "臀部", "hamstrings": "膕繩肌", "calves": "小腿",
    "posterior": "後鏈", "shoulders": "肩部", "rear-delts": "後三角肌",
    "back": "背部", "arms": "手臂", "chest": "胸部", "core": "核心",
}


def _fallback_program_plan(client_id: str, num_days: int | None = None, constraints: list[str] | None = None) -> dict:
    """Build a safe, injury-aware starter program directly from the exercise DB.

    Used only when the planner agent declines to persist a real plan (small models
    sometimes return prose or over-block on an everyday injury). Honors the same
    trainer not-recommended flags as search_exercise_db and skips muscle groups
    implicated by the client's injury_history (and any trainer-curated constraints).
    *num_days* caps how many training days to build (default 4)."""
    from ai.crew.tools.client import GetClientProfile
    db = get_db()
    prof = json.loads(GetClientProfile(run_client_id=client_id)._run(client_id))
    goal = (prof.get("goal") or "").lower()
    injury = (prof.get("injury_history") or "").lower()

    # Scan both the client's injury_history and any trainer-curated constraints.
    haystack = injury + " " + " ".join(c.lower() for c in (constraints or []))
    avoid: set[str] = set()
    for kw, groups in _INJURY_AVOID.items():
        if kw in haystack:
            avoid |= groups
    sets, reps = next(((s, r) for k, (s, r) in _GOAL_SCHEME if k in goal), (3, "8-12"))

    blocked: set[str] = set()
    try:
        trainer_id = db.table("clients").select("trainer_id").eq("id", client_id).single().execute().data["trainer_id"]
        flags = db.table("trainer_exercise_flags").select("exercise_id") \
            .eq("trainer_id", trainer_id).eq("status", "not_recommended").execute().data or []
        blocked = {f["exercise_id"] for f in flags}
    except Exception:
        pass

    rows = db.table("exercise_db").select("id, name, muscle_group").execute().data or []
    by_group: dict[str, list] = {}
    for r in rows:
        g = r.get("muscle_group")
        if g and g not in avoid and r["id"] not in blocked:
            by_group.setdefault(g, []).append(r)

    lang = _client_language(client_id)
    if lang == "zh":
        note = "🧩 自動建立的起始課表（規劃代理未能完成）— 請檢視並調整。"
        if avoid:
            note += " ⚠️ 已避開受傷部位：" + "、".join(_MG_ZH.get(a, a) for a in sorted(avoid)) + "。"
    else:
        note = "🧩 Auto-built starter plan (planner agent didn't finalise one) — review & adjust."
        if avoid:
            note += f" ⚠️ Avoids injured areas: {', '.join(sorted(avoid))}."

    cap = num_days if (num_days and num_days > 0) else 4
    days, daynames, di = [], ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], 0
    for emoji, labels, groups in _FALLBACK_TEMPLATES:
        if len(days) >= cap:
            break
        focus = f"{emoji} {labels.get(lang, labels['en'])}"
        exercises: list[dict] = []
        for g in groups:
            for ex in (by_group.get(g) or [])[:2]:
                exercises.append({"exercise_id": ex["id"], "sets": sets, "reps": reps, "notes": note})
        exercises = exercises[:5]
        if exercises:
            days.append({"day": daynames[di % len(daynames)], "focus": focus, "exercises": exercises})
            di += 1
    return {"days": days, "sources": []}


@_logged("Planner", "weekly-planning")
def weekly_planning_flow(
    client_id: str,
    llm_model: str | None = None,
    window_days: int | None = None,
    num_days: int | None = None,
    special_requirements: str | None = None,
    constraints: list[str] | None = None,
    run_id: str | None = None,
) -> dict:
    """Run the Planner Agent: generate this week's workout program for *client_id*.

    Tools called by the agent (in order):
      get_client_profile → get_recent_activities → search_exercise_db (N×) → write_program
    *window_days* (trainer-selected on the UI slider) bounds the activity +
    workout-log lookback; defaults to a ~1-month (30-day) view.
    *num_days* is the number of training days the trainer asked for (default 4).
    *constraints* is the trainer-curated list of background items (injuries,
    screening considerations) to honor THIS week; *special_requirements* is a
    free-text note for the week. Both are surfaced as Step-1 planning inputs.
    Returns a summary dict with the written plan.
    """
    publish(run_id, "📋 Generating workout plan…")
    cb = make_step_callback(run_id) if run_id else None
    window = window_days or 30
    days_n = num_days if (num_days and num_days > 0) else 4
    agent = planner_agent(client_id, llm_model=llm_model, step_callback=cb, window_days=window)

    trainer_inputs = (
        "\nTRAINER INPUTS FOR THIS WEEK (highest priority — the trainer curated these):\n"
        f"  • Produce EXACTLY {days_n} training day(s).\n"
    )
    if constraints:
        trainer_inputs += (
            "  • Honor these client background constraints and program around them: "
            + "; ".join(constraints) + ". Treat this curated list as authoritative for "
            "non-safety constraints (safety invariants from the screening always apply).\n"
        )
    else:
        trainer_inputs += (
            "  • The trainer did not flag any background constraints this week beyond the "
            "screening's safety invariants.\n"
        )
    if special_requirements and special_requirements.strip():
        trainer_inputs += f"  • Special requirement this week: {special_requirements.strip()}\n"

    task = Task(
        description=(
            style_directive(client_id) +
            f"Generate this week's training program for client_id={client_id}.\n" +
            trainer_inputs + "\n"
            "STRICT WORKFLOW:\n"
            "1. Call get_client_screening({{client_id}}) first to honor safety invariants. "
            "Only the official screening 'blocked' flag (or training_blocked) skips programming; "
            "an injury note or 'rest' advice means adapt and train around it, not stop.\n"
            "2. Call get_client_profile({{client_id}}) to learn goals, equipment, schedule, injuries.\n"
            f"3. Read the recent (past {window} days) journey before programming:\n"
            f"   get_recent_activities({{{{client_id, days={window}}}}}), get_workout_logs({{{{client_id, days={window}}}}}), "
            "get_latest_progress_report({{client_id}}), and get_body_composition({{client_id}}). "
            "Progress this week relative to that trend (push when recovered, deload when fatigued).\n"
            "4. For each muscle_group / equipment slot you need, call search_exercise_db with the "
            "relevant filter. Use the returned `id` values VERBATIM in the program.\n"
            "5. Call write_program({{client_id, plan}}) exactly once. The plan MUST be:\n"
            "   {\n"
            "     \"days\": [\n"
            "       {\"day\": \"Mon\", \"focus\": \"Lower body\", \"exercises\": [\n"
            "         {\"exercise_id\": \"<uuid from search_exercise_db>\", \"sets\": 4, \"reps\": \"6-8\", \"notes\": \"...\"},\n"
            "         ...\n"
            "       ]},\n"
            f"       ... EXACTLY {days_n} day(s) total, matching the trainer input above ...\n"
            "     ]\n"
            "   }\n"
            "If the client's equipment list is empty/unknown, assume a standard commercial gym "
            "(bodyweight, dumbbells, barbell, machines, cables) — do NOT refuse over missing data.\n"
            "Skip any exercise that would conflict with the client's injury_history (substitute a "
            "safe alternative instead of dropping the session).\n"
            "MANDATORY: unless the screening blocks training, you MUST call write_program with a "
            f"non-empty days array of EXACTLY {days_n} day(s). Never end with prose or an empty "
            "plan instead of calling write_program.\n"
            "Return a JSON summary of what you wrote."
        ),
        expected_output="A JSON object with the written plan (days array of training sessions).",
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task], verbose=False)
    with run_context(run_id, agent.role):
        result = crew.kickoff()

    raw = str(result) if not isinstance(result, str) else result
    try:
        summary = json.loads(raw)
    except json.JSONDecodeError:
        summary = {"raw": raw}

    # Reliability net: small models sometimes return prose, hallucinate a "system
    # down" error, or over-block on an everyday injury instead of persisting a
    # plan — leaving the card stuck on "no days". If no program with days landed
    # for this week, build a safe injury-aware starter from the library.
    db = get_db()
    today = date.today()
    week_start = (today - timedelta(days=today.weekday())).isoformat()
    existing = db.table("programs").select("plan").eq("client_id", client_id) \
        .eq("week_start", week_start).limit(1).execute()
    has_days = bool(existing.data and (existing.data[0].get("plan") or {}).get("days"))
    if not has_days:
        plan = _fallback_program_plan(client_id, num_days=days_n, constraints=constraints)
        if plan["days"]:
            publish(run_id, "🧩 Agent didn't finalise — building a starter plan from the library")
            trainer_id = db.table("clients").select("trainer_id").eq("id", client_id).single().execute().data["trainer_id"]
            db.table("programs").delete().eq("client_id", client_id).eq("week_start", week_start).execute()
            db.table("programs").insert({
                "trainer_id": trainer_id, "client_id": client_id,
                "week_start": week_start, "plan": plan,
            }).execute()
            summary = {"fallback": True, "days": len(plan["days"]),
                       "agent_raw": summary.get("raw") if isinstance(summary, dict) else None}
    return summary


@_logged("Nutrition", "weekly-nutrition")
def weekly_nutrition_flow(
    client_id: str,
    *,
    llm_model: str | None = None,
    window_days: int | None = None,
    run_id: str | None = None,
) -> dict:
    """Run the Nutrition Agent: give personalised food advice for *client_id*.

    *window_days* (trainer-selected on the UI slider) bounds the session-log
    lookback; defaults to a ~1-month (30-day) view."""
    publish(run_id, "🥗 Building food guidance…")
    cb = make_step_callback(run_id) if run_id else None
    window = window_days or 30
    agent = nutrition_agent(client_id, llm_model=llm_model, step_callback=cb, window_days=window)

    task = Task(
        description=(
            style_directive(client_id) +
            f"Give personalised nutrition advice for client_id={client_id}.\n\n"
            "STRICT WORKFLOW:\n"
            "1. get_client_profile — goal, dietary constraints, health conditions, bodyweight.\n"
            "2. get_latest_progress_report — current training load, fatigue, overtraining flags.\n"
            "2b. get_body_composition — current weight/body-fat/FFM/BMR + recent trend; anchor "
            "calorie/macro targets to where the body is now given the goal and training journey.\n"
            "3. get_active_program — upcoming workout types this week.\n"
            f"4. get_session_logs(days={window}) — the recent {window} days of RPE and fatigue signals.\n"
            "5. search_client_memory — food preferences, allergies, past advice.\n"
            "6. lookup_food for 3-5 key foods you recommend.\n"
            "7. If the client has a health condition or disease, web_search for evidence-based guidance.\n"
            "8. write_nutrition_advice exactly once with structured markdown advice."
        ),
        expected_output="Confirmation that write_nutrition_advice was called.",
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task], verbose=False)
    with run_context(run_id, agent.role):
        result = crew.kickoff()

    raw = str(result) if not isinstance(result, str) else result
    try:
        summary = json.loads(raw)
    except json.JSONDecodeError:
        summary = {"raw": raw}
    return summary


@_logged("Progress", "weekly-review")
def weekly_review_flow(client_id: str, *, llm_model: str | None = None, days: int | None = None, period_start: str | None = None, period_end: str | None = None, run_id: str | None = None) -> dict:
    """Run the Progress Agent: analyse the last 4 weeks, write a report, flag concerns."""
    publish(run_id, "📊 Analysing training data…")
    cb = make_step_callback(run_id) if run_id else None

    today        = date.today()
    period_end   = period_end   or today.isoformat()
    review_days  = days or 28
    period_start = period_start or (today - timedelta(days=review_days)).isoformat()
    fetch_days   = (date.fromisoformat(period_end) - date.fromisoformat(period_start)).days or review_days

    # Bind the resolved window into the agent's data tools so the analysis is
    # always based on the selected timeframe, even if the LLM omits the dates.
    agent = progress_agent(
        client_id, llm_model=llm_model, step_callback=cb,
        period_start=period_start, period_end=period_end,
    )

    task = Task(
        description=(
            style_directive(client_id) +
            f"Review client_id={client_id}'s training from {period_start} to {period_end} "
            f"(inclusive, {fetch_days} days).\n\n"
            "STRICT WORKFLOW:\n"
            "1. get_client_profile to read goal + constraints.\n"
            "2. Pull EVERY data point in the exact window — use the absolute range, "
            "NOT a relative days lookback:\n"
            f"   - get_recent_activities(client_id='{client_id}', period_start='{period_start}', period_end='{period_end}')\n"
            f"   - get_workout_logs(client_id='{client_id}', period_start='{period_start}', period_end='{period_end}')\n"
            "3. Analyse the FULL `metrics` jsonb on every activity, not just duration. "
            "That includes: average_heartrate, max_heartrate, hr_zones (Z1–Z5 seconds), "
            "average_watts, max_watts, kilojoules, average_speed, max_speed, "
            "total_elevation_gain, suffer_score. Plus workouts.rpe / workouts.data for "
            "subjective load.\n"
            "4. write_progress_report exactly once with:\n"
            f"   - period_start='{period_start}', period_end='{period_end}'\n"
            "   - summary: organised under `## Heading` SECTIONS, in this order — "
            "## Overview, ## Training Load, ## Intensity, ## Recovery, ## Recommendations "
            "(translate the heading names into the client's output language). Under each "
            "heading put 1-3 emoji bullets naming concrete trends with REAL numbers from the "
            "window — volume, intensity (Z3+ time, avg/max HR), recovery (RPE, suffer_score), "
            "and any power/pace signals that exist. Every section is headings + bullets only, "
            "never a prose paragraph.\n"
            "5. IF the data shows a defensible concern, call raise_flag once with kind in "
            "{overtraining, plateau, under_recovery, injury_risk, missed_sessions} and a "
            "one-sentence rationale citing the actual numbers. Skip raise_flag if the data "
            "looks healthy — silent passes are correct outcomes.\n"
            "Return a JSON summary of what you wrote."
        ),
        expected_output="JSON {summary, flags_raised: int}.",
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task], verbose=False)
    with run_context(run_id, agent.role):
        result = crew.kickoff()
    raw = str(result) if not isinstance(result, str) else result
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}


def _run_messaging_flow(
    *,
    client_id: str,
    flow_name: str,
    task_description: str,
    llm_model: str | None,
    run_id: str | None = None,
) -> dict:
    """Shared scaffolding for the three messaging flows."""
    publish(run_id, "📨 Drafting check-in…")
    cb = make_step_callback(run_id) if run_id else None
    def _fn() -> dict:
        # Pin Telegram so the autonomous reminders don't fall back to the
        # console dev-default (which the client card no longer surfaces).
        agent = messaging_agent(client_id, llm_model=llm_model, step_callback=cb, default_provider="telegram")
        task = Task(
            description=style_directive(client_id) + task_description,
            expected_output="JSON {sent: bool, channel: str, body: str}.",
            agent=agent,
        )
        crew = Crew(agents=[agent], tasks=[task], verbose=False)
        with run_context(run_id, agent.role):
            result = crew.kickoff()
        raw = str(result) if not isinstance(result, str) else result
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}

    return _run_flow_with_logging(
        client_id=client_id,
        agent_name="Messaging",
        flow_name=flow_name,
        flow_input={"trigger": flow_name},
        fn=_fn,
    )


def daily_reminder_flow(client_id: str, *, llm_model: str | None = None, run_id: str | None = None) -> dict:
    """Reminder fired the evening before a confirmed planned session.

    Only called for clients whose program has a session scheduled for tomorrow
    (the DB function fire_daily_reminder() handles the filtering). So we can
    tell the client exactly what's coming — no need to hedge with 'if any'.
    """
    return _run_messaging_flow(
        client_id=client_id,
        flow_name="daily_reminder_flow",
        llm_model=llm_model,
        run_id=run_id,
        task_description=(
            f"Client_id={client_id} has a workout scheduled for TOMORROW. Send them a "
            "short Telegram reminder tonight to get them prepared.\n\n"
            "STRICT WORKFLOW:\n"
            "1. get_client_profile — read their name.\n"
            "2. get_active_program — find tomorrow's session: its focus (e.g. 'Lower body') "
            "and the exercises planned. The session IS confirmed — don't hedge.\n"
            "3. Draft a SHORT reminder (1 opener line + 1-2 emoji bullets max):\n"
            "   - Name the session focus and 1-2 key exercises.\n"
            "   - End with one short motivational nudge.\n"
            "   No URLs, no long lists, no preamble.\n"
            "4. send_message once with the final body.\n"
            "Return JSON {sent, channel, body}."
        ),
    )


def weekly_checkin_flow(client_id: str, *, llm_model: str | None = None, run_id: str | None = None) -> dict:
    """Weekly check-in pulling on profile + recent activities + last progress report."""
    return _run_messaging_flow(
        client_id=client_id,
        flow_name="weekly_checkin_flow",
        llm_model=llm_model,
        run_id=run_id,
        task_description=(
            f"Send the weekly check-in for client_id={client_id}. STRICT WORKFLOW:\n"
            "1. get_client_profile, get_recent_activities(days=7), get_latest_progress_report.\n"
            "2. Acknowledge one specific thing from their week (a session, a streak, a flag) "
            "and end with a forward-looking nudge about the week ahead.\n"
            "3. Keep it tight: a 1-line opener + 2-3 emoji bullets + 1 closer. No URLs.\n"
            "4. send_message once.\n"
            "Return JSON {sent, channel, body}."
        ),
    )


def post_session_nudge_flow(client_id: str, *, llm_model: str | None = None, run_id: str | None = None) -> dict:
    """Event-driven encouragement after a session is logged."""
    return _run_messaging_flow(
        client_id=client_id,
        flow_name="post_session_nudge_flow",
        llm_model=llm_model,
        run_id=run_id,
        task_description=(
            f"A session was just logged for client_id={client_id}. STRICT WORKFLOW:\n"
            "1. get_recent_activities(days=2) to see what they just did.\n"
            "2. Send a 1-sentence acknowledgement. Reference the activity type or distance "
            "if available. Warm, specific, not formulaic.\n"
            "3. send_message once.\n"
            "Return JSON {sent, channel, body}."
        ),
    )


@_logged("Progress", "post-workout-analysis")
def post_workout_analysis_flow(client_id: str, *, llm_model: str | None = None) -> dict:
    """Real-time post-workout refuel message. Triggered by the Strava webhook
    (web/app/api/strava/webhook) the moment a new activity is ingested — i.e.
    right after the client finishes and uploads their workout.

    Sends a short Telegram message that (a) analyses the workout they just did
    and (b) tells them what to eat/drink NOW, inside the recovery window.
    """
    return _run_messaging_flow(
        client_id=client_id,
        flow_name="post_workout_analysis_flow",
        llm_model=llm_model,
        task_description=(
            f"Client_id={client_id} just finished a workout (it was uploaded moments ago). "
            "Send them a real-time post-workout analysis + refuel message on Telegram.\n\n"
            "STRICT WORKFLOW:\n"
            "1. get_recent_activities(days=1) — the MOST RECENT activity is the workout they "
            "just did. Read its type, duration, distance, and the `metrics` jsonb "
            "(average_heartrate, max_heartrate, hr_zones, average_watts, suffer_score) to "
            "gauge how hard it was.\n"
            "2. get_client_profile — read their name, goal, bodyweight, and any dietary "
            "constraints / allergies / health conditions. NEVER recommend a food that "
            "conflicts with a stated constraint.\n"
            "3. (Optional) web_search for evidence-based post-workout fuelling guidance if "
            "the session type or a health condition warrants it.\n"
            "4. Compose the message with TWO short sections:\n"
            "   ## <Your Workout, translated>  — 1-2 emoji bullets naming concrete numbers "
            "from the session (duration, distance, avg HR, suffer score) and how taxing it was.\n"
            "   ## <Refuel Now, translated>  — 2-3 emoji bullets on what to eat & drink RIGHT "
            "NOW, in the recovery window: protein target (scale to bodyweight, ~0.3 g/kg this "
            "meal), fast carbs to replenish glycogen (more after long/intense sessions), "
            "hydration, and the timing window (within ~30-60 min). Suggest concrete, realistic "
            "foods. This is immediate — frame it as 'eat this now', not 'tomorrow'.\n"
            "5. Keep the whole message tight — it's a real-time Telegram nudge, not an essay. "
            "No URLs.\n"
            "6. send_message exactly once with the final body.\n"
            "Return JSON {sent, channel, body}."
        ),
    )


@_logged("Progress", "hr-health")
def hr_health_flow(
    client_id: str,
    *,
    weeks: int = 8,
    period_start: str | None = None,
    period_end:   str | None = None,
    llm_model: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Analyse HR zone + cardio-metric trends and return health insights.

    If `period_start` and `period_end` (ISO YYYY-MM-DD) are supplied, the
    analysis covers that absolute window; otherwise the last `weeks` weeks
    rolling from today are used. Buckets are weekly (Mon–Sun).

    Computes distributions programmatically (no CrewAI agent overhead) then
    feeds the aggregates to the LLM for a narrative. Beyond HR zones we now
    surface average_heartrate, max_heartrate, average_watts, suffer_score,
    average_speed and total_elevation_gain so the model can reason about the
    whole cardio picture, not just zone splits.

    Returns {weeks_data, insights, flags, period_start, period_end}.
    """
    from datetime import datetime, timezone, timedelta
    from ai.db import get_db
    from ai.llm import make_llm

    publish(run_id, "❤️ Loading HR-zone data…")
    db = get_db()

    now = datetime.now(timezone.utc)
    if period_start and period_end:
        start_dt = datetime.fromisoformat(period_start).replace(tzinfo=timezone.utc)
        end_dt   = datetime.fromisoformat(period_end).replace(tzinfo=timezone.utc) + timedelta(days=1)
    else:
        end_dt   = now
        start_dt = end_dt - timedelta(weeks=weeks)

    resp = db.table("activities") \
        .select("started_at, type, duration_s, distance_m, metrics") \
        .eq("client_id", client_id) \
        .eq("source", "strava") \
        .gte("started_at", start_dt.isoformat()) \
        .lt("started_at", end_dt.isoformat()) \
        .order("started_at", desc=False) \
        .execute()

    activities = resp.data or []
    publish(run_id, f"🏃 Found {len(activities)} activities in window")
    publish(run_id, "📊 Bucketing into weekly zones")

    # Anchor weekly buckets on the Monday of `start_dt` so partial weeks at
    # the edges of the user's range stay aligned to real calendar weeks.
    first_monday = (start_dt - timedelta(days=start_dt.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    span_days = max(1, (end_dt - first_monday).days)
    bucket_count = max(1, (span_days + 6) // 7)

    week_buckets: list[dict] = []
    for w in range(bucket_count):
        monday = first_monday + timedelta(days=w * 7)
        sunday = monday + timedelta(days=7)
        if monday >= end_dt:
            break
        week_acts = [
            a for a in activities
            if monday <= datetime.fromisoformat(
                a["started_at"].replace("Z", "+00:00")
            ) < sunday
        ]
        zones = {"z1": 0, "z2": 0, "z3": 0, "z4": 0, "z5": 0}
        total_s = 0
        distance_m = 0.0
        elev_m     = 0.0
        hr_avg_w_sum, hr_avg_w_den = 0.0, 0
        hr_max          = 0
        watts_avg_w_sum, watts_avg_w_den = 0.0, 0
        speed_avg_w_sum, speed_avg_w_den = 0.0, 0
        suffer_sum, suffer_n = 0.0, 0
        for a in week_acts:
            m = a.get("metrics") or {}
            hz = m.get("hr_zones") or {}
            for k in zones:
                zones[k] += hz.get(k, 0)
            dur = a.get("duration_s") or 0
            total_s    += dur
            distance_m += a.get("distance_m") or 0
            elev_m     += m.get("total_elevation_gain") or 0
            if m.get("average_heartrate") and dur:
                hr_avg_w_sum += float(m["average_heartrate"]) * dur
                hr_avg_w_den += dur
            if m.get("max_heartrate"):
                hr_max = max(hr_max, int(m["max_heartrate"]))
            if m.get("average_watts") and dur:
                watts_avg_w_sum += float(m["average_watts"]) * dur
                watts_avg_w_den += dur
            if m.get("average_speed") and dur:
                speed_avg_w_sum += float(m["average_speed"]) * dur
                speed_avg_w_den += dur
            if m.get("suffer_score") is not None:
                suffer_sum += float(m["suffer_score"])
                suffer_n   += 1
        week_buckets.append({
            "week":      monday.strftime("%b %-d"),
            "sessions":  len(week_acts),
            "total_s":   total_s,
            "distance_m": round(distance_m),
            "elev_m":     round(elev_m),
            "avg_hr":     round(hr_avg_w_sum / hr_avg_w_den, 1) if hr_avg_w_den else None,
            "max_hr":     hr_max or None,
            "avg_watts":  round(watts_avg_w_sum / watts_avg_w_den, 1) if watts_avg_w_den else None,
            "avg_speed":  round(speed_avg_w_sum / speed_avg_w_den, 2) if speed_avg_w_den else None,
            "suffer":     round(suffer_sum, 1) if suffer_n else None,
            **zones,
        })

    range_label = f"{start_dt.date().isoformat()} → {(end_dt - timedelta(days=1)).date().isoformat()}"
    range_payload = {
        "period_start": start_dt.date().isoformat(),
        "period_end":   (end_dt - timedelta(days=1)).date().isoformat(),
    }

    has_zone_data = any(
        b["z1"] + b["z2"] + b["z3"] + b["z4"] + b["z5"] > 0
        for b in week_buckets
    )
    has_any_metric = has_zone_data or any(
        b["avg_hr"] or b["max_hr"] or b["avg_watts"] or b["suffer"] for b in week_buckets
    )
    if not has_any_metric:
        return {
            "weeks_data": week_buckets,
            "insights":   None,
            "flags":      [],
            **range_payload,
        }

    # Summarise for the LLM prompt — include the full metric set per week.
    summary_lines = []
    for b in week_buckets:
        zone_total = b["z1"] + b["z2"] + b["z3"] + b["z4"] + b["z5"]
        parts = [f"{b['week']}: {b['sessions']} sessions"]
        if zone_total > 0:
            def pct(v: int) -> str:
                return f"{round(v / zone_total * 100)}%"
            parts.append(
                f"Z1={pct(b['z1'])} Z2={pct(b['z2'])} Z3={pct(b['z3'])} "
                f"Z4={pct(b['z4'])} Z5={pct(b['z5'])}"
            )
        if b["avg_hr"]:
            parts.append(f"avgHR={b['avg_hr']}")
        if b["max_hr"]:
            parts.append(f"maxHR={b['max_hr']}")
        if b["avg_watts"]:
            parts.append(f"avgW={b['avg_watts']}")
        if b["avg_speed"]:
            parts.append(f"avgSpd={b['avg_speed']}m/s")
        if b["elev_m"]:
            parts.append(f"elev={b['elev_m']}m")
        if b["suffer"] is not None:
            parts.append(f"sufferΣ={b['suffer']}")
        if b["total_s"]:
            parts.append(f"dur={round(b['total_s']/60)}min")
        summary_lines.append(" | ".join(parts))

    prompt = (
        style_directive(client_id) +
        f"You are a sports performance analyst reviewing cardio health data for "
        f"{range_label} ({len(week_buckets)} weekly bucket"
        f"{'s' if len(week_buckets) != 1 else ''}).\n\n"
        "Zone definitions (% of max HR):\n"
        "Z1 <60% Recovery | Z2 60-70% Endurance | Z3 70-80% Tempo | Z4 80-90% Threshold | Z5 >90% Max\n\n"
        "Weekly data (use ALL of these metrics — not just zones):\n"
        + "\n".join(summary_lines) + "\n\n"
        "STRICT OUTPUT SHAPE — use this exact markdown structure, no plain paragraphs anywhere:\n"
        "## <section heading, translated>\n"
        "- <emoji> <one tight sentence with a real number and a week label>\n"
        "- <emoji> <one tight sentence>\n"
        "\n"
        "Sections (translate the labels to the output language):\n"
        "  1. ## Aerobic Base  — 1–2 bullets on Z2 trend.\n"
        "  2. ## Intensity Balance  — 1–2 bullets on Z3/Z4/Z5 spread.\n"
        "  3. ## Cardio Load  — 1–2 bullets citing avg/max HR, suffer score, "
        "or watts/speed where present.\n"
        "  4. ## Recovery Signals  — 1–2 bullets on overtraining / under-recovery cues "
        "(rising HR at same load, climbing suffer, missed weeks).\n"
        "  5. ## Fitness Trajectory  — 1–2 bullets on cardio adaptation "
        "(same effort → lower HR or higher watts = fitness gain).\n"
        "  6. ## Recommendation  — exactly 1 bullet, action-oriented, persuasive.\n"
        "Rules:\n"
        "  • Every line must be either a `## heading` or a `- emoji bullet`. No prose paragraphs.\n"
        "  • Every bullet starts with an emoji and ends within ~2 sentences.\n"
        "  • Cite real numbers from the weekly data — never invent.\n"
        "  • Skip a section gracefully (don't print it) if no relevant metric is present.\n"
        "\nAlso return a JSON block on the final line (after the markdown): "
        '{\"flags\": []} where flags is a list of strings from '
        '["aerobic_base_low","zone5_excess","inconsistent_load","zone2_improving","good_balance"].'
    )

    publish(run_id, "🧠 Asking the LLM for cardio insights")
    llm = make_llm(llm_model)
    raw = llm.call([{"role": "user", "content": prompt}])
    text = str(raw).strip()
    publish(run_id, "✅ Composing final answer")

    # Extract optional flags JSON from last line.
    flags: list[str] = []
    lines = text.splitlines()
    for line in reversed(lines):
        line = line.strip()
        if line.startswith("{") and "flags" in line:
            try:
                flags = json.loads(line).get("flags", [])
                text = "\n".join(lines[: lines.index(line)]).strip()
            except Exception:
                pass
            break

    return {
        "weeks_data": week_buckets,
        "insights":   text,
        "flags":      flags,
        **range_payload,
    }


# ── AFT classification (APTHK10) ─────────────────────────────────────────────
# The AASFP "All-round Fitness Training" 5-level client classification. The
# Progress agent reads EVERY available signal about the client (screening,
# postural findings, body composition + trend, fitness-test results, HR-zone /
# cardio history, training frequency, the latest progress report, and open
# injuries) and decides which level the client sits at NOW, with a concise
# rationale. Persisted onto clients.aft_level for the Programme page.

AFT_LEVELS = ("blue", "green", "yellow", "orange", "red")

_AFT_DEFINITIONS = (
    "AFT Enhancement System — 5 levels (lowest → highest readiness):\n"
    "• blue — Dysfunctional / deconditioned. Weak, recently injured, pain/swelling, "
    "poor movement patterns or compensation, muscle atrophy or asymmetry, poor "
    "stability/balance, fear or low body awareness. Needs corrective, very stable, "
    "basic-quality work first.\n"
    "• green — Prepared individuals. Beginners (<~3 months) or returning after a long "
    "break, no pain/atrophy/swelling, minimal joint-alignment/mobility/stability "
    "issues, ~average balance, no movement fear. Most fitness-test items poor / below "
    "average. Low risk for general aerobic & basic resistance training.\n"
    "• yellow — Active / recreational athletes. Trained >~3 months, regular exercise "
    "(meets ACSM ~3-5×/wk, ≥150 min moderate or 75 min vigorous), decent cardio & "
    "muscular endurance, most fitness-test items above average / good. Ready for higher "
    "skill/complexity, hypertrophy & HIIT.\n"
    "• orange — Trained athletes. ≥~2 years systematic sport training, no detraining "
    ">3 months; junior/reserve/lower-league/university level or local ranking. Max "
    "strength/power, complex & unstable drills, periodisation.\n"
    "• red — Elite / pro athletes. National team, top leagues, world ranking, major-games "
    "experience. Sport-specific, highest complexity, rigorous monitoring.\n"
)


def _aft_load_signals(client_id: str) -> dict:
    """Pull every available data point about the client for AFT classification.
    Each source is defensive — a missing table/row just yields None, never a crash."""
    from datetime import datetime, timezone, timedelta as _td
    db = get_db()

    def _safe(fn):
        try:
            return fn()
        except Exception:
            return None

    profile = _safe(lambda: (db.table("clients").select(
        "name, goal, status, equipment, profile, injury_history, created_at"
    ).eq("id", client_id).single().execute()).data)

    screening = _safe(lambda: (db.table("client_screenings").select(
        "parq_yes_count, medical_clearance_required, cvd_risk_factor_count, "
        "medical_history, submitted_at"
    ).eq("client_id", client_id).order("submitted_at", desc=True).limit(1).execute()).data)
    screening = (screening or [None])[0] if isinstance(screening, list) else screening

    postural = _safe(lambda: (db.table("postural_assessments").select(
        "upper_crossed, lower_crossed, pronation_distortion, scoliosis, summary, assessed_at"
    ).eq("client_id", client_id).order("assessed_at", desc=True).limit(1).execute()).data)
    postural = (postural or [None])[0] if isinstance(postural, list) else postural

    # Full body-composition history (every InBody log incl. the intake reading),
    # newest first — the AFT classifier should weigh the whole trajectory.
    health = _safe(lambda: (db.table("client_health_metrics").select(
        "source, weight_kg, bmi, body_fat_pct, fat_free_mass_kg, bmr_kcal, "
        "waist_hip_ratio, total_body_water_pct, resting_hr, bp_systolic, "
        "bp_diastolic, extra_metrics, recorded_at"
    ).eq("client_id", client_id).order("recorded_at", desc=True).execute()).data) or []
    # Flatten the machine-specific InBody params (visceral fat, skeletal muscle
    # mass, segmental analysis, …) into a compact "extra" map the LLM can read.
    from ai.crew.tools.progress import _flatten_extra_metrics
    for _row in health:
        _flatten_extra_metrics(_row)
    body_latest = health[0] if health else None
    body_prev = health[1] if len(health) > 1 else None
    body_history = list(reversed(health))  # oldest → newest, includes intake

    fitness = _safe(lambda: (db.table("fitness_assessments").select(
        "results, assessed_at"
    ).eq("client_id", client_id).order("assessed_at", desc=True).limit(1).execute()).data)
    fitness = (fitness or [None])[0] if isinstance(fitness, list) else fitness

    report = _safe(lambda: (db.table("progress_reports").select(
        "summary, flags, period_end"
    ).eq("client_id", client_id).order("period_end", desc=True).limit(1).execute()).data)
    report = (report or [None])[0] if isinstance(report, list) else report

    # Training frequency + cardio load from the last 8 weeks of Strava activities.
    now = datetime.now(timezone.utc)
    since = (now - _td(weeks=8)).isoformat()
    acts = _safe(lambda: (db.table("activities").select(
        "started_at, type, duration_s, metrics"
    ).eq("client_id", client_id).gte("started_at", since).execute()).data) or []
    zones = {"z1": 0, "z2": 0, "z3": 0, "z4": 0, "z5": 0}
    hr_max = 0
    for a in acts:
        m = a.get("metrics") or {}
        hz = m.get("hr_zones") or {}
        for k in zones:
            zones[k] += hz.get(k, 0)
        if m.get("max_heartrate"):
            hr_max = max(hr_max, int(m["max_heartrate"]))
    workouts = _safe(lambda: (db.table("workouts").select(
        "performed_at, rpe", count="exact"
    ).eq("client_id", client_id).gte("performed_at", since).execute()))
    workout_count = getattr(workouts, "count", None) if workouts else None

    # Open (unresolved) injuries.
    injuries = _safe(lambda: (db.table("client_injury_log").select(
        "note, resolved_at"
    ).eq("client_id", client_id).is_("resolved_at", "null").execute()).data) or []

    return {
        "profile": profile,
        "screening": screening,
        "postural": postural,
        "body_latest": body_latest,
        "body_previous": body_prev,
        "body_history": body_history,
        "fitness_results": (fitness or {}).get("results") if fitness else None,
        "latest_report": report,
        "activities_8wk": len(acts),
        "sessions_8wk": workout_count,
        "hr_zone_seconds": zones,
        "hr_max_observed": hr_max or None,
        "open_injuries": [i.get("note") for i in injuries if i.get("note")],
    }


def _parse_aft_output(raw: str) -> tuple[str, list[dict], str]:
    """Split the LLM's AFT output into (level, signals, clean_rationale).

    The model often wraps the trailing JSON in a ```json fence and prefixes a
    `## heading` + bold/markdown bullets. We extract the JSON by brace-matching
    (handles nested objects in `signals`) and strip markdown so the rationale
    renders as clean bullets in the UI."""
    import re

    level = "green"
    signals: list[dict] = []
    text = raw

    # 1) Extract the trailing JSON object that carries "level" (brace-matched).
    idx = text.rfind('"level"')
    if idx != -1:
        start = text.rfind("{", 0, idx)
        if start != -1:
            depth = 0
            for i in range(start, len(text)):
                if text[i] == "{":
                    depth += 1
                elif text[i] == "}":
                    depth -= 1
                    if depth == 0:
                        blob = text[start:i + 1]
                        try:
                            obj = json.loads(blob)
                            lv = str(obj.get("level", "")).lower().strip()
                            if lv in AFT_LEVELS:
                                level = lv
                            sg = obj.get("signals")
                            if isinstance(sg, list):
                                signals = [x for x in sg if isinstance(x, dict)]
                            text = text[:start] + text[i + 1:]
                        except Exception:
                            pass
                        break

    # 2) Clean markdown noise from the rationale: code fences, headings, bold,
    #    leftover "json" labels, and normalise bullets to "• ".
    text = re.sub(r"```[a-zA-Z]*", "", text).replace("```", "")
    out: list[str] = []
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        if re.match(r"^#{1,6}\s", s):           # drop "## 分類理由" headings
            continue
        if s.lower() == "json":
            continue
        s = s.replace("**", "")                 # strip bold markers
        s = re.sub(r"^[-*•]\s*", "• ", s)       # normalise bullet glyphs
        out.append(s)
    rationale = "\n".join(out).strip()
    return level, signals, rationale


@_logged("Progress", "aft-classification")
def aft_classification_flow(
    client_id: str,
    *,
    llm_model: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Classify the client into one AFT level using ALL available data, persist it,
    and return {level, rationale, signals, classified_at}."""
    from datetime import datetime, timezone
    from ai.llm import make_llm

    publish(run_id, "🧭 Gathering all available client data…")
    sig = _aft_load_signals(client_id)

    # Narrate what the agent actually found, so the UI shows a real thought process.
    prof = sig["profile"] or {}
    if prof.get("goal"):
        publish(run_id, f"🎯 Goal: {prof.get('goal')}")
    scr = sig["screening"] or {}
    if scr:
        publish(run_id, (
            "📋 Screening: "
            + ("medical clearance required" if scr.get("medical_clearance_required") else "no clearance flag")
            + f" · PAR-Q yes={scr.get('parq_yes_count', 0)} · CVD factors={scr.get('cvd_risk_factor_count', 0)}"
        ))
    else:
        publish(run_id, "📋 No screening on file")
    post = sig["postural"]
    if post:
        flags = [k for k in ("upper_crossed", "lower_crossed", "pronation_distortion", "scoliosis") if post.get(k)]
        publish(run_id, "🧍 Posture: " + (", ".join(flags) if flags else "no major distortions"))
    body = sig["body_latest"]
    if body:
        publish(run_id, (
            "⚖️ Body: "
            + " · ".join(
                f"{label}={body[k]}"
                for k, label in (("weight_kg", "wt"), ("body_fat_pct", "bf%"), ("resting_hr", "RHR"))
                if body.get(k) is not None
            )
        ))
    if sig["fitness_results"]:
        publish(run_id, f"🏅 Fitness test results on file ({len(sig['fitness_results'])} items)")
    publish(run_id, (
        f"🏃 Last 8 wks: {sig['sessions_8wk'] or 0} logged sessions · "
        f"{sig['activities_8wk']} cardio activities"
    ))
    zone_total = sum(sig["hr_zone_seconds"].values())
    if zone_total:
        publish(run_id, "❤️ HR-zone data available")
    if sig["open_injuries"]:
        publish(run_id, f"🩹 {len(sig['open_injuries'])} open injury note(s) — weighing toward caution")
    if sig["latest_report"]:
        publish(run_id, "📈 Latest progress report found")
    publish(run_id, "🧠 Weighing signals against the 5 AFT levels…")

    zone_pct = (
        " ".join(
            f"{k.upper()}={round(v / zone_total * 100)}%"
            for k, v in sig["hr_zone_seconds"].items()
        )
        if zone_total
        else "no HR-zone data"
    )

    data_block = json.dumps(
        {
            "goal": (sig["profile"] or {}).get("goal"),
            "status": (sig["profile"] or {}).get("status"),
            "member_since": (sig["profile"] or {}).get("created_at"),
            "screening": sig["screening"],
            "postural": sig["postural"],
            "body_now": sig["body_latest"],
            "body_previous": sig["body_previous"],
            "body_composition_history": sig["body_history"],
            "fitness_test_results": sig["fitness_results"],
            "latest_progress_report": sig["latest_report"],
            "training_sessions_logged_8wk": sig["sessions_8wk"],
            "cardio_activities_8wk": sig["activities_8wk"],
            "hr_zone_distribution_8wk": zone_pct,
            "max_hr_observed": sig["hr_max_observed"],
            "open_injuries": sig["open_injuries"],
        },
        default=str,
        ensure_ascii=False,
    )

    prompt = (
        style_directive(client_id)
        + "You are a senior performance analyst applying the AASFP AFT Enhancement "
        "System to classify ONE client's CURRENT training level.\n\n"
        + _AFT_DEFINITIONS
        + "\nClassification guidance:\n"
        "• Be conservative — an open injury, failed/poor stability or balance, "
        "pain/swelling, required medical clearance, or obvious movement dysfunction "
        "pulls the client toward blue regardless of cardio fitness.\n"
        "• Absent dysfunction, judge readiness from training history, fitness-test "
        "results, training frequency and cardio load.\n"
        "• Most general clients land in blue/green/yellow; orange/red require real "
        "athletic background evidence in the data.\n"
        "• If data is sparse, default cautiously to green (or blue if any red flag) "
        "and SAY the classification is provisional.\n\n"
        "Client data (JSON; nulls mean not recorded):\n"
        + data_block
        + "\n\nReturn EXACTLY this shape, nothing else:\n"
        "First, a concise rationale as 2-4 markdown bullets (translate to the output "
        "language), each starting with an emoji and citing a REAL signal from the data "
        "(never invent numbers). Name the single biggest factor first.\n"
        "Then, on the FINAL line, a JSON object: "
        '{"level": "<blue|green|yellow|orange|red>", '
        '"signals": [{"label": "<short signal>", "value": "<value/finding>"}]} '
        "with 2-5 of the concrete signals that drove the decision."
    )

    llm = make_llm(llm_model)
    raw = str(llm.call([{"role": "user", "content": prompt}])).strip()

    level, signals, rationale = _parse_aft_output(raw)

    classified_at = datetime.now(timezone.utc).isoformat()
    try:
        get_db().table("clients").update({
            "aft_level": level,
            "aft_rationale": rationale,
            "aft_signals": signals,
            "aft_classified_at": classified_at,
        }).eq("id", client_id).execute()
    except Exception:
        pass  # classification still returns to the caller even if persistence fails

    publish(run_id, f"✅ Classified as {level}")
    return {
        "level": level,
        "rationale": rationale,
        "signals": signals,
        "classified_at": classified_at,
    }


# ── Screening readiness ("ready to train" vs "alert") ─────────────────────────

def _readiness_load(client_id: str) -> dict:
    """Pull the pre-training safety picture: active injuries, chronic conditions,
    medications, PAR-Q / CVD flags, latest BP, and the clearance/blocked gates.
    Each source is defensive — a missing table/row yields empty, never a crash."""
    db = get_db()

    def _safe(fn):
        try:
            return fn()
        except Exception:
            return None

    client = _safe(lambda: (db.table("clients").select(
        "injury_history, training_blocked, training_blocked_reason, "
        "clearance_received_at, clearance_note"
    ).eq("id", client_id).single().execute()).data) or {}

    screening = _safe(lambda: (db.table("client_screenings").select(
        "parq_yes_count, medical_clearance_required, cvd_risk_factor_count, "
        "medical_history, submitted_at"
    ).eq("client_id", client_id).order("submitted_at", desc=True).limit(1).execute()).data)
    screening = (screening or [None])[0] if isinstance(screening, list) else screening
    screening = screening or {}

    health = _safe(lambda: (db.table("client_health_metrics").select(
        "bp_systolic, bp_diastolic, resting_hr, recorded_at"
    ).eq("client_id", client_id).order("recorded_at", desc=True).limit(1).execute()).data)
    health = (health or [None])[0] if isinstance(health, list) else health

    # Active (unresolved) injuries define the CURRENT injury status — the same
    # source the trainer's Injury Status card + clients.injury_history reflect.
    injuries = _safe(lambda: (db.table("client_injury_log").select(
        "note, resolved_at"
    ).eq("client_id", client_id).is_("resolved_at", "null").execute()).data) or []
    active = [i.get("note") for i in injuries if i.get("note")]
    if not active and client.get("injury_history"):
        active = [client["injury_history"]]

    med = screening.get("medical_history") or {}
    chronic = med.get("chronic") or {}
    chronic_yes = [k for k in ("hypertension", "diabetes", "asthma", "anemia") if chronic.get(k)]

    return {
        "active_injuries": active,
        "chronic": chronic_yes,
        "medications": med.get("medications") or [],
        "beta_blockers": bool(med.get("beta_blockers")),
        "parq_yes_count": screening.get("parq_yes_count") or 0,
        "medical_clearance_required": bool(screening.get("medical_clearance_required")),
        "cleared": bool(client.get("clearance_received_at")),
        "cvd_risk_factor_count": screening.get("cvd_risk_factor_count") or 0,
        "latest_bp": (
            f"{health.get('bp_systolic')}/{health.get('bp_diastolic')}"
            if health and health.get("bp_systolic") else None
        ),
        "training_blocked": bool(client.get("training_blocked")),
        "training_blocked_reason": client.get("training_blocked_reason"),
        "has_screening": bool(screening.get("submitted_at")),
    }


def _parse_verdict(raw: str) -> tuple[str, list[dict], str]:
    """Split the readiness output into (verdict, flags, clean_rationale). Mirrors
    _parse_aft_output: brace-match the trailing JSON, then strip markdown noise."""
    import re

    verdict = "alert"  # fail safe — an unparseable verdict is treated as an alert
    flags: list[dict] = []
    text = raw

    idx = text.rfind('"verdict"')
    if idx != -1:
        start = text.rfind("{", 0, idx)
        if start != -1:
            depth = 0
            for i in range(start, len(text)):
                if text[i] == "{":
                    depth += 1
                elif text[i] == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            obj = json.loads(text[start:i + 1])
                            v = str(obj.get("verdict", "")).lower().strip()
                            if v in ("ready", "alert"):
                                verdict = v
                            fl = obj.get("flags")
                            if isinstance(fl, list):
                                flags = [x for x in fl if isinstance(x, dict)]
                            text = text[:start] + text[i + 1:]
                        except Exception:
                            pass
                        break

    text = re.sub(r"```[a-zA-Z]*", "", text).replace("```", "")
    out: list[str] = []
    for ln in text.splitlines():
        s = ln.strip()
        if not s or s.lower() == "json" or re.match(r"^#{1,6}\s", s):
            continue
        s = s.replace("**", "")
        s = re.sub(r"^[-*•]\s*", "• ", s)
        out.append(s)
    return verdict, flags, "\n".join(out).strip()


def screening_readiness_flow(
    client_id: str,
    *,
    llm_model: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Analyse the client's pre-training screening — injury status, chronic
    conditions, medications, PAR-Q / CVD flags, latest BP, and clearance gates —
    and return {verdict: "ready"|"alert", rationale, flags, checked_at}.

    Deterministic safety overrides always beat the LLM: a training_blocked client
    or a pending medical clearance is ALWAYS an alert."""
    from datetime import datetime, timezone
    from ai.llm import make_llm

    publish(run_id, "🩺 Gathering the pre-training screening picture…")
    d = _readiness_load(client_id)
    checked_at = datetime.now(timezone.utc).isoformat()

    if d["active_injuries"]:
        publish(run_id, f"🩹 {len(d['active_injuries'])} active injury note(s)")
    if d["chronic"]:
        publish(run_id, "🧬 Chronic: " + ", ".join(d["chronic"]))
    if d["medications"]:
        publish(run_id, f"💊 {len(d['medications'])} medication(s)"
                + (" · beta-blockers" if d["beta_blockers"] else ""))

    # ── Hard safety gates (deterministic, non-negotiable) ────────────────────
    if d["training_blocked"]:
        publish(run_id, "⛔ Training is blocked — alert")
        return {
            "verdict": "alert",
            "rationale": "• ⛔ Training is currently blocked: "
                         + (d["training_blocked_reason"] or "safety invariant tripped")
                         + ".\n• Resolve the blocking condition before programming any session.",
            "flags": [{"label": "Training blocked", "value": d["training_blocked_reason"] or "yes"}],
            "checked_at": checked_at,
        }

    if not d["has_screening"] and not d["active_injuries"]:
        publish(run_id, "📋 No screening on file")
        return {
            "verdict": "alert",
            "rationale": "• 📋 No pre-training screening on file yet — complete the PAR-Q "
                         "before clearing this client to train.",
            "flags": [{"label": "Screening", "value": "not submitted"}],
            "checked_at": checked_at,
        }

    clearance_pending = d["medical_clearance_required"] and not d["cleared"]

    data_block = json.dumps({
        "active_injuries": d["active_injuries"],
        "chronic_conditions": d["chronic"],
        "medications": d["medications"],
        "beta_blockers": d["beta_blockers"],
        "parq_yes_count": d["parq_yes_count"],
        "medical_clearance_required": d["medical_clearance_required"],
        "medical_clearance_received": d["cleared"],
        "cvd_risk_factor_count": d["cvd_risk_factor_count"],
        "latest_resting_bp_mmHg": d["latest_bp"],
    }, default=str, ensure_ascii=False)

    publish(run_id, "🧠 Weighing the picture against PAR-Q / ACSM readiness rules…")
    prompt = (
        style_directive(client_id)
        + "You are a certified strength & conditioning coach doing a PRE-TRAINING "
        "readiness check on ONE client before their session.\n\n"
        "Decide ONE verdict:\n"
        '• "ready"  — safe to train now (possibly with sensible modifications).\n'
        '• "alert"  — a real safety concern needs the trainer\'s attention before '
        "loading (unresolved acute injury, uncontrolled chronic condition, a "
        "medication that changes exercise response, ≥2 CVD risk factors without "
        "clearance, elevated resting BP, etc.).\n\n"
        "Rules:\n"
        "• Be conservative but not alarmist — a well-managed old condition or a "
        "recovered injury does NOT block training.\n"
        + ("• Medical clearance is REQUIRED and has NOT been received → this MUST "
           "be an alert.\n" if clearance_pending else "")
        + "• Beta-blockers blunt HR response → flag to anchor cardio by RPE, not HR.\n"
        "• Never invent findings — only cite data present below.\n\n"
        "Client screening data (JSON; empty/0/null means not present):\n"
        + data_block
        + "\n\nReturn EXACTLY this shape, nothing else:\n"
        "First, 2-4 markdown bullets (in the output language), each starting with "
        "an emoji and citing a REAL datum; name the single biggest factor first "
        "and, if 'alert', say what the trainer should do.\n"
        "Then, on the FINAL line, a JSON object: "
        '{"verdict": "<ready|alert>", "flags": [{"label": "<short>", "value": "<finding>"}]} '
        "with 1-4 concrete flags that drove the decision."
    )

    llm = make_llm(llm_model)
    raw = str(llm.call([{"role": "user", "content": prompt}])).strip()
    verdict, flags, rationale = _parse_verdict(raw)

    # Safety override: clearance pending is always an alert, whatever the LLM said.
    if clearance_pending and verdict != "alert":
        verdict = "alert"
        flags = [{"label": "Medical clearance", "value": "required, not received"}] + flags

    publish(run_id, f"✅ Verdict: {verdict}")
    return {
        "verdict": verdict,
        "rationale": rationale,
        "flags": flags,
        "checked_at": checked_at,
    }


@_logged("Coach", "exercise-coach")
def exercise_coach_flow(
    question: str,
    exercise: dict | None = None,
    client_id: str | None = None,
    mode: str = "qa",
    llm_model: str | None = None,
    run_id: str | None = None,
    trainer_id: str | None = None,
) -> dict:
    """Per-card exercise coach for the Programme library. Answers a question
    about ONE exercise (variations / regressions / gym-setup swaps) or, in
    mode='caveat', analyses whether it is suitable for the in-context client and
    suggests alternatives. Reuses the S&C persona (exercise_coach_agent)."""
    from ai.crew.agents import exercise_coach_agent

    exercise = exercise or {}
    publish(run_id, "🧠 Thinking about this exercise…")
    cb = make_step_callback(run_id) if run_id else None
    agent = exercise_coach_agent(client_id, llm_model=llm_model, step_callback=cb, trainer_id=trainer_id)

    ex_json = json.dumps(exercise, ensure_ascii=False, default=str)
    ex_name = exercise.get("name") or "the exercise"

    if mode == "caveat" and client_id:
        ask = (
            f"The trainer tapped 'Why + alternatives' on '{ex_name}' for client_id={client_id}. "
            "Call get_client_screening + get_client_profile FIRST, then answer in THREE short, "
            "clearly separated parts:\n"
            "1) 👤 **Client situation** — one line on the relevant injuries / screening flags / goal.\n"
            "2) Verdict + why — lead with ✅ suitable, ⚠️ do with modifications, or ⛔ best avoided, "
            "then ONE line tying it to their SPECIFIC injury/condition (why THIS movement loads the "
            "flagged area).\n"
            "3) 🔁 **Alternatives** — 1–2 concrete swaps (call search_exercise_db, include_details=true) "
            "that train the same muscles while sparing the flagged area; name them exactly.\n"
            "If the question text includes a parenthetical 'system flag: …', that is the exact reason "
            "the exercise was flagged — address THAT reason directly."
        )
    else:
        ask = f"Question: {question}"
        if client_id:
            ask += (f"\nThis is for client_id={client_id} — call get_client_screening + "
                    "get_client_profile and tailor the answer to them.")

    task = Task(
        description=(
            style_directive(client_id) +
            "That STYLE applies to the `answer` field: write it as `## Heading` sections of "
            "`- emoji bullet` lines (one emoji per bullet), with **bold** for key terms. Use REAL "
            "line breaks (not literal backslash-n). Keep it tight — no prose paragraphs.\n\n"
            f"Exercise context (JSON): {ex_json}\n\n"
            f"{ask}\n\n"
            "If a tutorial video is requested or helpful, call "
            f"web_search(\"site:youtube.com {ex_name} proper form tutorial\") and pick ONE "
            "good youtube.com/watch?v=… link.\n\n"
            "Return RAW JSON ONLY — no markdown code fences, no prose before or after — "
            "with this exact shape:\n"
            "{\"answer\": <markdown: `## Heading` sections + `- emoji bullet` lines, **bold** for key terms>, "
            "\"suitability\": \"ok\"|\"caution\"|\"avoid\" (omit if not a suitability question), "
            "\"alternatives\": [<exercise names>] (optional), "
            "\"video_url\": <chosen youtube watch URL, or omit>, "
            "\"sources\": [{\"title\": <str>, \"url\": <str>}] (web links used; [] if none)}."
        ),
        expected_output="A raw JSON object with answer, optional suitability/alternatives/video_url, and sources.",
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task], verbose=False)
    with run_context(run_id, agent.role):
        result = crew.kickoff()

    raw = str(result) if not isinstance(result, str) else result
    summary = _extract_json_object(raw)
    if summary is None:
        summary = {"answer": raw}
    summary.setdefault("sources", [])
    return summary


@_logged("Progress", "session-analysis")
def session_analysis_flow(
    client_id: str,
    *,
    llm_model: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Analyse the client's MOST RECENT workout session for the trainer.

    Triggered on demand from the client's program page (LastSessionCard). Unlike
    the weekly progress review (which spans weeks and persists a report), this is
    a tight, single-session read: what did they last do, how did it go, and what
    should the next session adjust. Returns inline JSON — nothing is persisted.
    """
    from ai.crew.agents import progress_agent

    publish(run_id, "🔍 Pulling up the last session…")
    cb = make_step_callback(run_id) if run_id else None

    # Surface the most recent explicit sessions (trainer-built) so the agent can
    # name what was prescribed vs. what the activity feed shows was actually done.
    # We pull the last few so the trainer's per-session feedback (left from the
    # calendar) is available — it's first-hand signal the activity feed lacks.
    last_session = None
    recent_sessions: list[dict] = []
    try:
        db = get_db()
        resp = db.table("sessions") \
            .select("scheduled_at, title, focus, exercises, status, duration_min, feedback") \
            .eq("client_id", client_id) \
            .order("scheduled_at", desc=True) \
            .limit(5).execute()
        recent_sessions = resp.data or []
        last_session = recent_sessions[0] if recent_sessions else None
    except Exception:
        last_session = None

    agent = progress_agent(client_id, llm_model=llm_model, step_callback=cb)

    # The trainer's own notes on recent sessions — weight these heavily.
    feedback_lines = [
        f"- {s.get('scheduled_at')} ({s.get('focus') or s.get('title') or 'session'}): {s.get('feedback')}"
        for s in recent_sessions if (s.get("feedback") or "").strip()
    ]
    feedback_ctx = (
        "TRAINER FEEDBACK on recent sessions (first-hand observations — weigh heavily, "
        "they override inferences from the activity feed):\n" + "\n".join(feedback_lines) + "\n\n"
        if feedback_lines else
        "The trainer left no written feedback on recent sessions.\n\n"
    )

    session_ctx = (
        f"The most recent trainer-built session row is:\n{json.dumps(last_session, ensure_ascii=False, default=str)}\n\n"
        if last_session else
        "There is no trainer-built session row — rely on the activity feed as the last workout.\n\n"
    ) + feedback_ctx

    task = Task(
        description=(
            style_directive(client_id) +
            f"Analyse the SINGLE most recent workout session for client_id={client_id}. "
            "This is a focused post-session read for the trainer — NOT a multi-week review. "
            "Do NOT call write_progress_report or raise_flag.\n\n"
            f"{session_ctx}"
            "STRICT WORKFLOW:\n"
            "0. If the trainer left feedback above, treat it as the PRIMARY signal — "
            "reflect it in the analysis and let it drive next_focus.\n"
            "1. get_client_profile — goal, injuries, constraints.\n"
            "2. get_recent_activities(days=14) — the MOST RECENT activity is the last workout. "
            "Read its type, duration, distance and the `metrics` jsonb (avg/max HR, hr_zones, "
            "watts, suffer_score) to judge how hard it was.\n"
            "3. get_workout_logs(days=14) — read the RPE / set-by-set notes for that session if present.\n"
            "4. (Optional) web_search for evidence-based guidance only if a health condition or "
            "unusual pattern warrants it; cite any link you use.\n"
            "5. Return RAW JSON ONLY (no code fences, no prose) with this exact shape:\n"
            "{\n"
            "  \"headline\": <one short sentence naming the session + how it went>,\n"
            "  \"analysis\": <markdown with `## Heading` + `- emoji bullet` sections covering: "
            "what they did (concrete numbers), how taxing it was, what went well, and what the "
            "NEXT session should adjust>,\n"
            "  \"intensity\": \"easy\"|\"moderate\"|\"hard\"|\"unknown\",\n"
            "  \"next_focus\": <one short sentence on the single most important next-session tweak>,\n"
            "  \"sources\": [{\"title\": <str>, \"url\": <str>}]  (web links used; [] if none)\n"
            "}\n"
            "Never invent numbers — if the data is thin, say so in a bullet."
        ),
        expected_output="A raw JSON object with headline, analysis, intensity, next_focus, sources.",
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task], verbose=False)
    with run_context(run_id, agent.role):
        result = crew.kickoff()

    raw = str(result) if not isinstance(result, str) else result
    summary = _extract_json_object(raw)
    if summary is None:
        summary = {"analysis": raw, "headline": "", "intensity": "unknown", "next_focus": ""}
    summary.setdefault("sources", [])
    if last_session:
        summary["last_session_at"] = last_session.get("scheduled_at")
    return summary


def exercise_research_flow(
    *,
    query: str | None = None,
    url: str | None = None,
    article_text: str | None = None,
    llm_model: str | None = None,
    run_id: str | None = None,
    trainer_id: str | None = None,
) -> dict:
    """Research one exercise from a web search, a pasted URL, or pasted text and
    return a STRUCTURED candidate row ready to add to exercise_db.

    Used by the Programme library's "Add exercise" panel. The flow never writes
    to the DB itself — it returns a JSON candidate the trainer reviews + confirms
    in the UI, which then POSTs to /api/exercises. Keeping the write server-side
    (service role) preserves the exercise_db RLS contract.
    """
    from ai.crew.agents import exercise_coach_agent

    publish(run_id, "🔎 Researching the exercise…")
    cb = make_step_callback(run_id) if run_id else None
    agent = exercise_coach_agent(None, llm_model=llm_model, step_callback=cb, trainer_id=trainer_id)

    source_lines: list[str] = []
    if url:
        source_lines.append(f"Reference URL provided by the trainer: {url}")
    if article_text:
        source_lines.append(f"Reference text provided by the trainer:\n\"\"\"\n{article_text[:6000]}\n\"\"\"")
    if query:
        source_lines.append(f"Exercise to research: {query}")
    if not source_lines:
        return {"error": "Provide a query, url, or article_text."}

    task = Task(
        description=(
            "You are building ONE new entry for the gym's exercise library from the "
            "reference(s) below. Research it thoroughly and return a single structured "
            "exercise object.\n\n"
            + "\n\n".join(source_lines) + "\n\n"
            "STRICT WORKFLOW:\n"
            "1. If a URL is given, base the entry on it. If only a name/query is given, "
            "web_search to gather correct form, target muscles and cues. Cite sources.\n"
            "2. Call search_exercise_db with the likely muscle_group to (a) match the house "
            "vocabulary and (b) AVOID proposing a near-duplicate — if a clear duplicate "
            "already exists, set \"duplicate_of\" to its name.\n"
            "3. Provide BOTH English and Traditional-Chinese (繁體) names + text fields.\n"
            "4. Return RAW JSON ONLY (no code fences, no prose) with this EXACT shape — "
            "muscle_group MUST be one of: chest, back, legs, core, shoulders, arms. "
            "Muscle regions MUST be drawn from: chest, front-delts, side-delts, rear-delts, "
            "biceps, triceps, forearms, lats, traps, rhomboids, erectors, abs, obliques, "
            "quads, hamstrings, glutes, calves. level is beginner|intermediate|advanced.\n"
            "{\n"
            "  \"name\": <str>, \"name_zh\": <str>,\n"
            "  \"muscle_group\": <one of the 6 groups>,\n"
            "  \"primary_muscles\": [<region>...], \"secondary_muscles\": [<region>...],\n"
            "  \"equipment\": <str e.g. barbell|dumbbell|bodyweight|machine|cable|kettlebell|band|suspension>,\n"
            "  \"equipment_options\": [<str>...],\n"
            "  \"level\": <beginner|intermediate|advanced>, \"difficulty\": <1-5>,\n"
            "  \"tempo\": <e.g. \"4-4\" or null>,\n"
            "  \"cues\": <one short coaching cue line>,\n"
            "  \"key_points\": {\"bodyPosition\":{\"en\":<str>,\"zh\":<str>}, \"stabilization\":{...}, "
            "\"pathOfMotion\":{...}, \"rangeOfMotion\":{...}, \"breathing\":{...}, \"rhythm\":{...}},\n"
            "  \"progression\": {\"en\":<str>,\"zh\":<str>}, \"regression\": {\"en\":<str>,\"zh\":<str>},\n"
            "  \"common_faults\": [{\"en\":<str>,\"zh\":<str>}...],\n"
            "  \"variations\": [{\"name\":{\"en\":<str>,\"zh\":<str>}, \"level\":<str>, \"equipment\":[<str>...]}...],\n"
            "  \"duplicate_of\": <existing exercise name or null>,\n"
            "  \"sources\": [{\"title\":<str>,\"url\":<str>}...]\n"
            "}\n"
            "Never invent a citation to the AASFP handouts — leave citation out. Keep text "
            "accurate and concise. If a field is genuinely unknown use null or [] — do not fabricate."
        ),
        expected_output="A raw JSON object describing one exercise_db candidate row.",
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task], verbose=False)
    with run_context(run_id, agent.role):
        result = crew.kickoff()

    raw = str(result) if not isinstance(result, str) else result
    candidate = _extract_json_object(raw)
    if candidate is None:
        return {"error": "Could not parse an exercise from the research.", "raw": raw}
    candidate.setdefault("sources", [])
    return {"exercise": candidate, "sources": candidate.get("sources", [])}


# ── Client insight tree ──────────────────────────────────────────────────────
# Powers the client portal's "Understand your body" mind-map. Each call expands
# ONE node: it returns a short, personalised insight grounded in the client's own
# data plus the next set of child nodes to explore. The tree keeps growing as the
# client drills deeper. Reuses the read-only concierge_agent (no chat, no writes).

INSIGHT_BRANCHES = {
    "health":    "the client's CURRENT HEALTH STATUS — screening flags (PAR-Q), CVD risk factors, "
                 "medical-clearance status, and key metrics like blood pressure, resting HR and BMI",
    "progress":  "the client's RECENT TRAINING PROGRESS — their latest progress report and any flags, "
                 "plus the trend in recent activities and logged workouts",
    "injuries":  "the client's INJURIES & EXERCISE CAUTIONS — past injuries and which movements to "
                 "avoid or modify, and why",
    "stamina":   "the client's CARDIO / ENDURANCE capacity — current stamina level, what is limiting "
                 "it, what their programme does about it, and how it is trending",
    "strength":  "the client's STRENGTH capacity — current strength level, what is limiting it, what "
                 "their programme does about it, and how it is trending",
    "mental":    "the client's MINDSET, MOTIVATION & ADHERENCE — consistency, stress and recovery, and "
                 "how it is shaping their training",
    "knowledge": "PERSONALISED FITNESS & HEALTH EDUCATION relevant to THIS client's goal, training "
                 "and health profile (e.g. why a training principle matters for them specifically)",
    "nutrition": "PERSONALISED NUTRITION guidance for THIS client's goal and training — what to eat, "
                 "what to prioritise, and what to adjust",
}

# Each branch grounds its knowledge-base search in the slice of the trainer's
# library owned by the most relevant specialist agent (AGENT_TAGS = progress |
# planner | nutrition | messaging). So every expansion draws on that agent's
# evidence + the web, not a single generic pool.
INSIGHT_BRANCH_KB_TAG = {
    "health":    "planner",     # screening / clearance gating lives with the planner
    "progress":  "progress",
    "injuries":  "planner",     # movement cautions & modifications
    "stamina":   "progress",    # cardio trend analysis
    "strength":  "planner",     # programme / strength design
    "mental":    "messaging",   # mindset, motivation, adherence
    "knowledge": "messaging",   # general client-facing education
    "nutrition": "nutrition",
}


# "Think deeper" slider position → agent tool-call budget (max_iter). Higher =
# more reads/searches per node, richer but slower.
_INSIGHT_DEPTH_ITER = {1: 4, 2: 6, 3: 9}


@_logged("Insight", "insight-tree")
def insight_tree_flow(
    client_id: str,
    *,
    branch: str,
    node_path: list[str] | None = None,
    node_label: str | None = None,
    web_search: bool = False,
    depth: int = 1,
    llm_model: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Expand ONE node of the client's insight tree.

    *branch* is the top-level theme (health | progress | injuries | knowledge).
    *node_path* is the trail of labels from the branch down to the node being
    expanded (so we never re-suggest an ancestor). *node_label* is the node the
    client tapped (None ⇒ expanding the branch root itself).
    *web_search* lets the client opt the open web in (default: trainer's
    knowledge base only). *depth* (1–3, the "think deeper" slider) sets how hard
    the agent works per node via max_iter.

    Returns {insight: <markdown>, children: [{label}], sources: [...]}.
    """
    from ai.crew.agents import concierge_agent

    node_path = node_path or []
    publish(run_id, "🌱 Growing your insights…")
    cb = make_step_callback(run_id) if run_id else None
    kb_tag = INSIGHT_BRANCH_KB_TAG.get(branch, "messaging")
    max_iter = _INSIGHT_DEPTH_ITER.get(int(depth) if depth else 1, 4)
    # Cap the tool-call loop so one node stays snappy; the "think deeper" slider
    # raises the budget. Web access is opt-in per the client's toggle.
    agent = concierge_agent(
        client_id, llm_model=llm_model, step_callback=cb, kb_agent_tag=kb_tag,
        max_iter=max_iter, include_web=web_search,
    )

    branch_desc = INSIGHT_BRANCHES.get(branch, branch)
    focus = node_label or branch_desc
    trail = " → ".join(node_path) if node_path else "(top of this branch)"
    avoid = ", ".join(f'"{p}"' for p in node_path) if node_path else "none yet"

    if web_search:
        evidence_line = (
            "Then ground the topic in evidence: call search_knowledge_base FIRST (the trainer's "
            "library for this topic), then web_search to fill any gap. Never expand a node on data "
            "alone — every node must be backed by the knowledge base and/or the web.\n"
            "   BE EFFICIENT: one KB search + at most one web_search per node. The moment you have a "
            "grounded answer, STOP searching and return the JSON. Do not repeat a search or loop.\n"
        )
    else:
        evidence_line = (
            "Then ground the topic in the trainer's library: call search_knowledge_base. The web is "
            "OFF for this request — do NOT attempt web_search; rely only on the knowledge base plus "
            "the client's own data. If the library is thin, keep it educational from what you know of "
            "the client and say so kindly — do not invent facts.\n"
            "   BE EFFICIENT: one KB search is plenty. Once grounded, STOP and return the JSON.\n"
        )

    task = Task(
        description=(
            style_directive(client_id) +
            f"You are building ONE node of a personalised health-insight mind-map for "
            f"client_id={client_id}. The client is exploring the branch about: {branch_desc}.\n\n"
            f"They just opened this node: \"{focus}\".\n"
            f"Path so far (root → here): {trail}.\n\n"
            "STRICT WORKFLOW:\n"
            "1. Ground yourself in THEIR real data with the read tools before writing — "
            "get_client_profile, get_latest_progress_report, get_recent_activities, "
            "search_client_memory. " + evidence_line +
            "   CITE WITH FOOTNOTES: every external fact in `insight` MUST carry a numbered "
            "footnote marker like [^1], [^2] placed right after the claim. Each marker maps "
            "1:1, in order, to an entry in the `sources` array (marker [^1] → sources[0], and so "
            "on). Do NOT use '(source: …)' inline text — use the [^n] markers only. Every source "
            "you list must be referenced by at least one marker, and every marker must have a "
            "matching source.\n"
            "2. Write a SHORT `insight` (2–4 emoji bullets, ≤2 sentences each) that explains THIS "
            "node in plain language, tied to the client's own situation. Never invent numbers — if "
            "their data is thin for this node, say so kindly in a bullet and keep it educational.\n"
            "3. Propose 3–5 `children`: the natural NEXT things to explore one level deeper from "
            f"this node. Each has a short tappable `label` (≤6 words) and a single leading `emoji` "
            f"that fits that topic. Do NOT repeat any ancestor "
            f"({avoid}) and do NOT restate this node. Go deeper / more specific, not sideways.\n"
            "   Follow the client's JOURNEY when choosing children: tie this node back to their GOAL, "
            "then toward what their current PROGRAMME / body status is doing about it, then toward "
            "their most recent PROGRESS trend — that is the path the client is walking.\n"
            "4. Return RAW JSON ONLY (no code fences, no prose) with this exact shape:\n"
            "{\n"
            "  \"insight\": <markdown string: emoji bullets with [^n] footnote markers, optionally a `## Heading`>,\n"
            "  \"children\": [{\"label\": <short string>, \"emoji\": <single emoji>}, …],\n"
            "  \"sources\": [{\"title\": <str>, \"url\": <str>}]  (ordered to match [^1],[^2],…; [] if none)\n"
            "}"
        ),
        expected_output="A raw JSON object with insight, children, and sources.",
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task], verbose=False)
    with run_context(run_id, agent.role):
        result = crew.kickoff()

    raw = str(result) if not isinstance(result, str) else result
    out = _extract_json_object(raw)
    if out is None:
        out = {"insight": raw, "children": []}
    out.setdefault("insight", "")
    out.setdefault("children", [])
    out.setdefault("sources", [])
    # Defend against the model returning children as bare strings; keep the emoji.
    norm: list[dict] = []
    for c in out.get("children", []):
        if isinstance(c, str):
            norm.append({"label": c})
        elif isinstance(c, dict) and c.get("label"):
            child = {"label": str(c["label"])}
            if c.get("emoji"):
                child["emoji"] = str(c["emoji"]).strip()
            norm.append(child)
    out["children"] = norm[:5]
    return out


def _extract_json_object(raw: str) -> dict | None:
    """Best-effort extraction of the JSON object from an LLM reply that may wrap
    it in ```json fences or surround it with prose."""
    import re
    if not raw:
        return None
    # 1) fenced ```json ... ``` block
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    candidate = m.group(1) if m else None
    # 2) otherwise the widest {...} span
    if candidate is None:
        start, end = raw.find("{"), raw.rfind("}")
        candidate = raw[start:end + 1] if start != -1 and end > start else None
    if candidate is None:
        return None
    try:
        obj = json.loads(candidate)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None
