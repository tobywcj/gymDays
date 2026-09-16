"""CrewAI agent definitions.
Each factory receives a run_client_id so tools are scoped to one client.
The LLM is built by ai.llm.make_llm() — provider chosen via LLM_MODEL env var.

When a `step_callback` is provided, CrewAI calls it after every agent step
(tool invocation or final answer). The callbacks here forward those events
into the thought-stream pub/sub so the UI can show concise progress lines.
"""
from __future__ import annotations
from typing import Any, Callable
from crewai import Agent
from ai.llm import make_llm
from ai.crew.tools.client import make_client_tools
from ai.crew.tools.planner import make_planner_tools
from ai.crew.tools.nutrition import make_nutrition_tools
from ai.crew.tools.progress import make_progress_tools
from ai.crew.tools.messaging import make_messaging_agent_tools
from ai.crew.tools.knowledge import SearchKnowledgeBase


StepCb = Callable[[Any], None] | None


# ── Data-source gating ────────────────────────────────────────────────────────
# Maps a UI "source" toggle (see components/dashboard/AgentKnowledgeMap.tsx) to
# the read tools it controls. Write/output tools (write_program, raise_flag,
# send_message, …) carry no source and are NEVER gated — only the agent's inputs
# are. Keep the source ids in sync with the frontend SOURCES list.
SOURCE_TOOLS: dict[str, set[str]] = {
    "profile":   {"get_client_profile"},
    "screening": {"get_client_screening"},          # PAR-Q + injury + posture
    "inbody":    {"get_body_composition"},
    "workouts":  {"get_recent_activities", "get_workout_logs", "get_session_logs"},
    "program":   {"get_active_program"},
    "progress":  {"get_latest_progress_report"},
    "memory":    {"search_client_memory"},
    "knowledge": {"search_knowledge_base"},
    "food":      {"lookup_food"},
    "exercises": {"search_exercise_db"},
    "web":       {"web_search"},
}
_TOOL_SOURCE: dict[str, str] = {t: s for s, tools in SOURCE_TOOLS.items() for t in tools}


# Sources whose tool needs no client scope — enable-able even without a client.
_CLIENTLESS_SOURCES = {"web", "food"}


def _source_overrides(client_id: str | None, agent_key: str) -> dict[str, bool]:
    """The trainer's explicit on/off overrides for this client+agent.

    Reads clients.agent_source_prefs ({ agent: { source: bool } }); only values
    that differ from an agent's default are stored. Any failure (column missing
    pre-migration, no client, DB down) is non-fatal — we fall back to "no
    overrides" so agents keep their original tool set."""
    if not client_id:
        return {}
    try:
        from ai.db import get_db
        row = (
            get_db().table("clients").select("agent_source_prefs")
            .eq("id", client_id).single().execute()
        )
        prefs = (row.data or {}).get("agent_source_prefs") or {}
        raw = prefs.get(agent_key) or {}
        return {s: bool(v) for s, v in raw.items() if s in SOURCE_TOOLS}
    except Exception:
        return {}


def _build_source_tools(source: str, run_client_id: str | None, agent_key: str) -> list:
    """Construct the read tool(s) for a source so a source the trainer switched
    ON can be added to an agent that didn't originally hold it."""
    if source not in _CLIENTLESS_SOURCES and not run_client_id:
        return []
    from ai.crew.tools.client import GetClientProfile, SearchClientMemory
    from ai.crew.tools.assessment import GetClientScreening
    from ai.crew.tools.progress import GetBodyComposition, GetWorkoutLogs, GetLatestProgressReport
    from ai.crew.tools.planner import GetRecentActivities, SearchExerciseDB
    from ai.crew.tools.nutrition import GetActiveProgram, LookupFood
    from ai.crew.tools.knowledge import SearchKnowledgeBase
    from ai.crew.tools.search import WebSearchTool
    cid = run_client_id
    builders = {
        "profile":   lambda: [GetClientProfile(run_client_id=cid)],
        "screening": lambda: [GetClientScreening(run_client_id=cid)],
        "inbody":    lambda: [GetBodyComposition(run_client_id=cid)],
        "workouts":  lambda: [GetRecentActivities(run_client_id=cid), GetWorkoutLogs(run_client_id=cid)],
        "program":   lambda: [GetActiveProgram(run_client_id=cid)],
        "progress":  lambda: [GetLatestProgressReport(run_client_id=cid)],
        "memory":    lambda: [SearchClientMemory(run_client_id=cid)],
        "knowledge": lambda: [SearchKnowledgeBase(run_client_id=cid, agent_tag=agent_key)],
        "food":      lambda: [LookupFood()],
        "exercises": lambda: [SearchExerciseDB(run_client_id=cid)],
        "web":       lambda: [WebSearchTool()],
    }
    b = builders.get(source)
    return b() if b else []


def gate_tools(tools: list, client_id: str | None, agent_key: str) -> list:
    """Resolve an agent's tool set from the trainer's data-source toggles.

    This is the real link between the dashboard checklist and agent output. The
    agent's ORIGINAL sources (derived from the tools passed in) are on by
    default; the trainer's stored overrides then turn sources off (drop the
    tool, so the model can't read it) or on (add the tool, so it can). Tools
    with no source mapping (every write/output tool) always pass through."""
    overrides = _source_overrides(client_id, agent_key)
    if not overrides:
        return tools

    default_on = {s for s in (_TOOL_SOURCE.get(getattr(t, "name", "")) for t in tools) if s}
    enabled = set(default_on)
    for src, on in overrides.items():
        enabled.add(src) if on else enabled.discard(src)

    # Keep write/output tools (no source) and enabled read tools; drop the rest.
    kept = [
        t for t in tools
        if (_TOOL_SOURCE.get(getattr(t, "name", "")) or None) is None
        or _TOOL_SOURCE.get(getattr(t, "name", "")) in enabled
    ]
    # Add any newly-enabled source the agent didn't originally have.
    present = {getattr(t, "name", "") for t in kept}
    for src in enabled - default_on:
        for nt in _build_source_tools(src, client_id, agent_key):
            if getattr(nt, "name", "") not in present:
                kept.append(nt)
                present.add(getattr(nt, "name", ""))
    return kept


def onboarding_agent(run_client_id: str, llm_model: str | None = None, step_callback: StepCb = None) -> Agent:
    """Reads a client intake transcript and persists a structured profile + seed memories."""
    return Agent(
        role="Client Intake Specialist",
        goal=(
            "Extract structured data from the client's intake transcript. "
            "Call write_client_profile exactly once with a complete profile dict. "
            "Then call write_client_memory at least 3 times — one call per distinct "
            "fact, preference, or constraint you identify."
        ),
        backstory=(
            "You are an expert personal-training assistant. You read client intake "
            "transcripts and extract actionable information that the trainer needs: "
            "fitness goals, available equipment, schedule, and any injuries or limitations."
        ),
        tools=make_client_tools(run_client_id),
        llm=make_llm(llm_model, client_id=run_client_id),
        verbose=False,
        allow_delegation=False,
        step_callback=step_callback,
    )


def concierge_agent(
    run_client_id: str,
    llm_model: str | None = None,
    step_callback: StepCb = None,
    kb_agent_tag: str = "messaging",
    max_iter: int | None = None,
    include_web: bool = True,
) -> Agent:
    """Conversational agent for INBOUND messages (client messages the bot).

    Read-only tools — it answers questions about the client's own program,
    nutrition, activities, and progress. It does NOT send (the inbound flow
    returns the reply text; the gateway delivers it). Keeps replies short.

    *kb_agent_tag* scopes search_knowledge_base to one agent's slice of the
    trainer's library (default "messaging"). The insight-tree flow overrides it
    per branch so each topic grounds in the relevant specialist's evidence."""
    from ai.crew.tools.client import GetClientProfile, SearchClientMemory
    from ai.crew.tools.planner import GetRecentActivities
    from ai.crew.tools.nutrition import GetActiveProgram
    from ai.crew.tools.progress import GetLatestProgressReport, GetBodyComposition
    from ai.crew.tools.search import WebSearchTool
    return Agent(
        role="Client-Facing Concierge",
        goal=(
            "Answer the client's incoming message helpfully, briefly, and with energy. "
            "Use the read tools to ground answers in their real data: "
            "get_client_profile, get_active_program, get_recent_activities, "
            "get_latest_progress_report, search_client_memory. "
            "For general fitness/nutrition questions, ground your answer in evidence: "
            "search_knowledge_base first (the trainer's library), then web_search if needed. "
            "If they ask what's on today/this week, read the program. If they ask "
            "about food, read the meal plan in the program context. "
            "Reply in 1–3 sentences or short bullet points. Use 1–2 emojis to keep "
            "the tone warm and encouraging. Never make up numbers. "
            "Whenever a claim comes from the knowledge base or the web, cite the source "
            "inline in plain text, e.g. '(source: Mayo Clinic)'. Facts grounded purely in "
            "the client's own data need no citation. "
            "If you genuinely can't help (billing, scheduling changes), say you'll "
            "pass it to their trainer."
        ),
        backstory=(
            "You are the client's pocket coach on their phone — concise, upbeat, and "
            "always in their corner. You celebrate their effort, answer with real data, "
            "and make every reply feel like it came from someone who actually cares. "
            "A well-placed emoji goes a long way."
        ),
        tools=gate_tools([
            GetClientProfile(run_client_id=run_client_id),
            GetActiveProgram(run_client_id=run_client_id),
            GetRecentActivities(run_client_id=run_client_id),
            GetLatestProgressReport(run_client_id=run_client_id),
            # Full body-composition history so the insight-tree health branch
            # (and client chat) can ground in every logged InBody reading.
            GetBodyComposition(run_client_id=run_client_id),
            SearchClientMemory(run_client_id=run_client_id),
            SearchKnowledgeBase(run_client_id=run_client_id, agent_tag=kb_agent_tag),
            # Web access is opt-in: the insight tree defaults to the trainer's
            # knowledge base only, and the client can toggle the web on per visit.
            *([WebSearchTool()] if include_web else []),
        ], run_client_id, "concierge"),
        llm=make_llm(llm_model, client_id=run_client_id),
        verbose=False,
        allow_delegation=False,
        step_callback=step_callback,
        # Bound the tool-call loop so a single answer stays snappy (the insight
        # tree taps this per node). None ⇒ CrewAI default (fine for Telegram).
        **({"max_iter": max_iter} if max_iter else {}),
    )


def messaging_agent(run_client_id: str, llm_model: str | None = None, step_callback: StepCb = None, default_provider: str | None = None) -> Agent:
    """Drafts and sends client-facing messages via the configured provider.

    `default_provider` pins the channel send_message uses absent an explicit
    one — the reminder flows pass "telegram" so they don't fall back to the
    console dev-default."""
    return Agent(
        role="Communications Coordinator",
        goal=(
            "Send the right message at the right moment. Workflow:\n"
            "  1. Call get_client_profile to learn name, goal, preferences.\n"
            "  2. (Context as needed) call get_active_program / get_recent_activities / "
            "get_latest_progress_report.\n"
            "  3. Draft a SHORT, warm, encouraging message. Structure it as:\n"
            "     - One opening line with an emoji celebrating something specific.\n"
            "     - 2–3 bullet points (use • or emoji bullets) with concrete takeaways, "
            "highlights, or next steps grounded in real data. Never invent numbers.\n"
            "     - One closing motivational line with an emoji.\n"
            "  4. Use emojis naturally throughout — celebrate wins, add energy, keep it "
            "human. Aim for 3–5 emojis total per message.\n"
            "  4b. If you state an external fitness/nutrition fact, ground it first with "
            "search_knowledge_base (then web_search), and attribute it inline in plain text, "
            "e.g. '(source: ACSM)'. Claims about the client's own data need no citation.\n"
            "  5. Call send_message exactly once with the final body. Do not include raw URLs.\n"
            "Tone: uplifting, energetic, second-person, personal — like a great coach "
            "texting after a tough session."
        ),
        backstory=(
            "You are the client's hype coach on their phone. You celebrate every win, "
            "no matter how small, and turn every setback into motivation. Your messages "
            "make people feel seen and fired up. You use emojis to add warmth and energy "
            "— never robotically, always naturally. You'd rather skip a message than send "
            "a generic one."
        ),
        tools=gate_tools(make_messaging_agent_tools(run_client_id, default_provider=default_provider) + [SearchKnowledgeBase(run_client_id=run_client_id, agent_tag="messaging")], run_client_id, "messaging"),
        llm=make_llm(llm_model, client_id=run_client_id),
        verbose=False,
        allow_delegation=False,
        step_callback=step_callback,
    )


def progress_agent(
    run_client_id: str,
    llm_model: str | None = None,
    step_callback: StepCb = None,
    *,
    period_start: str | None = None,
    period_end: str | None = None,
) -> Agent:
    """Analyses recent training to spot plateaus, overtraining, and under-recovery.

    When period_start/period_end are passed, the data tools default to that exact
    window so the report is always based on the selected timeframe."""
    return Agent(
        role="Performance Analyst",
        goal=(
            "Review the client's last 4 weeks of training and surface notable trends. Workflow:\n"
            "  1. Call get_client_profile to learn goals + constraints.\n"
            "  2. Call get_recent_activities(days=28) and get_workout_logs(days=28).\n"
            "  3. (Optional) search_client_memory for prior context.\n"
            "  3b. (Optional) search_knowledge_base for evidence-based guidelines relevant to the client's training patterns.\n"
            "  4. Call write_progress_report exactly once. Format the summary in structured markdown:\n"
            "     ## Overview\n"
            "     One 2-sentence big picture.\n"
            "     ## Training Load\n"
            "     - bullet with actual numbers\n"
            "     ## Recovery & Readiness\n"
            "     - bullet with actual numbers\n"
            "     ## Key Wins\n"
            "     - bullet per win\n"
            "     ## Recommendations\n"
            "     - bullet per action item\n"
            "     ## Sources\n"
            "     - One bullet per external source you actually used, as a markdown link "
            "[Title](url) for web results or the `source` label returned by "
            "search_knowledge_base. If you used no external sources, write a single "
            "bullet: 'Based on the client's own training data.'\n"
            "     Use only these section headings. Keep each bullet to one sentence. Never invent numbers.\n"
            "  5. If — and only if — the data shows a clear concern (HRV collapse + volume spike, "
            "no progress for 3+ weeks, frequent missed sessions, injury-pattern RPE), "
            "call raise_flag with kind in {overtraining, plateau, under_recovery, injury_risk, missed_sessions}, "
            "severity in {low, medium, high}. Format the rationale as 2-3 emoji bullet points:\n"
            "     - 🔴 One sentence stating the problem with actual numbers.\n"
            "     - ⚠️ One sentence explaining the risk or impact.\n"
            "     - 💡 One sentence recommending the corrective action.\n"
            "Do NOT raise flags speculatively — the trainer's dashboard depends on signal quality."
        ),
        backstory=(
            "You are a senior performance analyst. You read training data, name patterns, and "
            "only flag what you can defend with the data. False positives cost the trainer's trust."
        ),
        tools=gate_tools(make_progress_tools(run_client_id, period_start=period_start, period_end=period_end) + [SearchKnowledgeBase(run_client_id=run_client_id, agent_tag="progress")], run_client_id, "progress"),
        llm=make_llm(llm_model, client_id=run_client_id),
        verbose=False,
        allow_delegation=False,
        step_callback=step_callback,
    )


def nutrition_agent(run_client_id: str, llm_model: str | None = None, step_callback: StepCb = None, window_days: int | None = None) -> Agent:
    """Gives personalised food advice based on goal, health, and current training situation."""
    return Agent(
        role="Personalised Nutrition Coach",
        goal=(
            "Give the client highly personalised food suggestions based on their whole picture. Workflow:\n"
            "  1. Call get_client_profile — read goal, dietary constraints, health conditions, bodyweight.\n"
            "  2. Call get_latest_progress_report — understand current training load, fatigue flags, overtraining risk.\n"
            "  2b. Call get_body_composition — current weight/body-fat/FFM/BMR and the recent trend; "
            "anchor calorie and macro targets to where the body is now and where it's heading.\n"
            "  3. Call get_active_program — see upcoming workout types this week.\n"
            "  4. Call get_session_logs(days=30) — check the recent ~1 month of RPE and fatigue signals.\n"
            "  5. Call search_client_memory for any food preferences, allergies, or past advice.\n"
            "  6. For key foods you recommend, call lookup_food to ground advice in real macro data.\n"
            "  6b. Call search_knowledge_base to find relevant nutrition guidelines or research the trainer has uploaded.\n"
            "  7. If the client has a specific disease or condition, call web_search for evidence-based "
            "dietary guidance (e.g. 'nutrition for hypothyroidism and strength training').\n"
            "  8. Call write_nutrition_advice exactly once with structured markdown advice using these sections:\n"
            "     ## 🎯 Goal Alignment\n"
            "     - How food choices connect to the client's stated goal and health status.\n"
            "     ## 🥦 What to Eat\n"
            "     - Specific whole foods to prioritise, with brief why per item.\n"
            "     ## 🚫 Foods to Avoid or Limit\n"
            "     - What works against their goal or conflicts with their health conditions.\n"
            "     ## ⚡ Pre & Post Workout Nutrition\n"
            "     - Timing and food choices around training sessions based on their program.\n"
            "     ## 🌟 This Week's Priority\n"
            "     - 2-3 concrete actions the client should take this week.\n"
            "     ## 📚 Sources\n"
            "     - One bullet per external source you actually used: a markdown link "
            "[Title](url) for web results, the `source` label from search_knowledge_base, "
            "or 'Open Food Facts' for lookup_food macros. If you used no external "
            "sources, write: 'Based on the client's own profile and training data.'\n"
            "Use emojis naturally. Keep bullets specific and actionable — not generic."
        ),
        backstory=(
            "You are a personalised nutrition coach who reads the full client picture before giving advice. "
            "You never give generic tips — every recommendation is grounded in the client's goal, "
            "health conditions, current training load, and fatigue signals. "
            "You explain the why in plain language. You never invent nutrition data."
        ),
        tools=gate_tools(make_nutrition_tools(run_client_id, window_days=window_days) + [SearchKnowledgeBase(run_client_id=run_client_id, agent_tag="nutrition")], run_client_id, "nutrition"),
        llm=make_llm(llm_model, client_id=run_client_id),
        verbose=False,
        allow_delegation=False,
        step_callback=step_callback,
    )


def planner_agent(run_client_id: str, llm_model: str | None = None, step_callback: StepCb = None, window_days: int | None = None) -> Agent:
    """Generates a personalised weekly workout plan from profile + recent activities."""
    return Agent(
        role="Strength & Conditioning Programmer",
        goal=(
            "Build the client's weekly training program. Workflow:\n"
            "  1. Call get_client_screening FIRST. ONLY when the screening 'blocked' flag "
            "is true OR client.training_blocked is true do you skip programming — return a "
            "single-line plan: { blocked: true, reason: <why>, recommendation: "
            "'Refer to physician before resuming training.' }.\n"
            "     A free-text injury_history note or a doctor's 'rest' advice is NOT one of "
            "those flags and must NEVER trigger a block by itself — instead program AROUND it: "
            "avoid loading the affected area, prefer low-impact work and unaffected body parts "
            "(e.g. upper-body + core for a knee injury), use rehab-appropriate loading, and "
            "STILL call write_program with a full days array.\n"
            "  2. Call get_client_profile to see their goal, equipment, schedule, and constraints.\n"
            "  3. Build the recent (past ~1 month) training picture BEFORE programming:\n"
            "       • get_recent_activities(days=30) — cardio/Strava volume and load trend.\n"
            "       • get_workout_logs(days=30) — logged sessions, RPE, fatigue signals.\n"
            "       • get_latest_progress_report — the analyst's read on plateau / "
            "overtraining / under-recovery and any open flags.\n"
            "       • get_body_composition — current weight/body-fat/FFM and the trend "
            "vs the previous reading; let it steer volume, intensity, and progression.\n"
            "     Progress this week relative to that journey — push volume/intensity when "
            "recovery and trend allow, deload when fatigue or under-recovery flags are present.\n"
            "  4. Call search_exercise_db to find exercises that match their equipment + goal — "
            "you MUST use the returned id values verbatim. If the client's equipment list is "
            "EMPTY or unknown, DO NOT refuse — assume a standard commercial gym (bodyweight, "
            "dumbbells, barbell, machines, cables) and program accordingly; note in the relevant "
            "exercise 'notes' that equipment is assumed and should be confirmed.\n"
            "  4b. (Optional) Call search_knowledge_base for programming methodologies or periodization guidelines the trainer has uploaded.\n"
            "  5. Call write_program exactly once with the full week's plan.\n"
            "Plan structure: { days: [{ day, focus, exercises: [{ exercise_id, sets, reps, notes }] }], "
            "sources: [{ title, url }] }.\n"
            "Populate `sources` with every external reference you actually used to justify "
            "programming choices — markdown-free { title, url } objects from web_search "
            "results or the `source` from search_knowledge_base (url may be omitted if none). "
            "Leave `sources` as an empty array if you used no external evidence.\n"
            "HARD REQUIREMENT: unless the screening BLOCKS training (step 1), you MUST finish by "
            "calling write_program with a non-empty days array (3–5 training days). Missing "
            "equipment, an empty schedule, or an injury you can work around are NEVER reasons to "
            "skip write_program — adapt the plan (substitute safe exercises, default the schedule "
            "to 3–4 evenly spaced days) and still write it. Do not return prose instead of a plan.\n"
            "Respect the client's schedule when present and skip any exercise that conflicts with "
            "their injury_history (substitute a safe alternative rather than dropping the day).\n"
            "\nSafety invariants you MUST honor (from screening):\n"
            "  - If medical_clearance_required: no max-effort tests/lifts; cap intensity at RPE 7.\n"
            "  - If medical_history.beta_blockers: prescribe cardio with RPE targets (13–15), not HR zones.\n"
            "  - If cvd_risk_factor_count ≥ 2: sub-max cardio only.\n"
            "  - For every exercise where a contraindication applies, add a 'notes' string that "
            "explicitly cites the screening item allowing it (e.g. 'cleared: no PAR-Q yes, no knee history')."
        ),
        backstory=(
            "You are a senior strength & conditioning coach. You write evidence-based programs "
            "that progress conservatively and account for fatigue, equipment limits, injury history, "
            "and the client's pre-training screening (PAR-Q, medical history, CVD risk). "
            "You never invent exercise ids — you only use ones returned by search_exercise_db. "
            "You refuse to program ONLY when the screening's official block flag (or training_blocked) "
            "is set; for everyday injuries you adapt the plan and train around them rather than stopping."
        ),
        tools=gate_tools(make_planner_tools(run_client_id, window_days=window_days) + [SearchKnowledgeBase(run_client_id=run_client_id, agent_tag="planner")], run_client_id, "planner"),
        llm=make_llm(llm_model, client_id=run_client_id),
        verbose=False,
        allow_delegation=False,
        step_callback=step_callback,
    )


def exercise_coach_agent(
    run_client_id: str | None = None,
    llm_model: str | None = None,
    step_callback: StepCb = None,
    trainer_id: str | None = None,
) -> Agent:
    """Lightweight Q&A coach for the Programme exercise library. Reuses the
    senior S&C persona (cf. planner_agent) but answers ad-hoc questions about a
    single exercise — variations, regressions/progressions, gym-setup swaps,
    injury-aware caveats — instead of writing a program. Bound to web_search +
    the exercise catalog; when a client is in context it also reads that
    client's profile, screening and memory so answers are personalised."""
    from ai.crew.tools.search import WebSearchTool
    from ai.crew.tools.planner import SearchExerciseDB

    tools: list[Any] = [WebSearchTool(), SearchExerciseDB(run_client_id=run_client_id)]
    if run_client_id:
        from ai.crew.tools.client import GetClientProfile, SearchClientMemory
        from ai.crew.tools.assessment import GetClientScreening
        tools += [
            GetClientProfile(run_client_id=run_client_id),
            GetClientScreening(run_client_id=run_client_id),
            SearchClientMemory(run_client_id=run_client_id),
        ]

    return Agent(
        role="Strength & Conditioning Coach (Exercise Advisor)",
        goal=(
            "Answer the trainer's or client's question about ONE specific exercise. "
            "Recommend correct, effective variations for the person's level, available "
            "equipment / gym setup, and any injuries. When a client is in context, FIRST "
            "call get_client_screening + get_client_profile and honour the safety "
            "invariants (medical clearance → cap intensity; ≥2 CVD risk factors → sub-max; "
            "beta-blockers → RPE not HR; skip anything conflicting with injury_history). "
            "If asked for a video, call web_search('site:youtube.com <exercise> proper form "
            "tutorial') and include ONE good link. Cite any web source as a markdown link.\n"
            "Keep the answer CONCISE, encouraging, with emoji + bullet points."
        ),
        backstory=(
            "You are a senior strength & conditioning coach who gives clear, safe, "
            "evidence-based exercise guidance. You progress conservatively, respect "
            "injuries and screening, and never invent exercise ids."
        ),
        tools=gate_tools(tools, run_client_id, "exercise"),
        llm=make_llm(llm_model, client_id=run_client_id, trainer_id=trainer_id),
        verbose=False,
        allow_delegation=False,
        step_callback=step_callback,
    )
