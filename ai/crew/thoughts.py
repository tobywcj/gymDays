"""In-memory pub/sub for agent "thought" lines streamed to the UI.

Each agent step (tool invocation or final answer) is translated by
`describe_step()` into a short, human-readable line and pushed onto the
queue for the active run_id. The FastAPI SSE endpoints consume the queue
and forward each line to the browser.

The store is intentionally process-local: the AI service is a single
uvicorn process and thoughts only need to live for the duration of one
flow run (seconds → ~1 minute).
"""
from __future__ import annotations
import contextvars
import queue
import threading
import uuid
from contextlib import contextmanager
from typing import Any


# run_id → queue of thought events
_QUEUES: dict[str, "queue.Queue[dict]"] = {}
_LOCK = threading.Lock()

# Sentinel pushed to mark "stream done — close SSE".
_DONE = {"type": "done"}


def new_run_id() -> str:
    return uuid.uuid4().hex


def _ensure_queue(run_id: str) -> "queue.Queue[dict]":
    with _LOCK:
        q = _QUEUES.get(run_id)
        if q is None:
            q = queue.Queue()
            _QUEUES[run_id] = q
        return q


def publish(run_id: str | None, line: str) -> None:
    if not run_id or not line:
        return
    _ensure_queue(run_id).put({"type": "thought", "line": line})


def publish_result(run_id: str | None, payload: dict) -> None:
    if not run_id:
        return
    _ensure_queue(run_id).put({"type": "result", "payload": payload})


def publish_source(run_id: str | None, title: str | None, url: str | None) -> None:
    """Surface a data source (web result) to the UI in real time, while the
    agent is still running. The browser renders these as live citation links
    under the loading spinner."""
    if not run_id or not url:
        return
    _ensure_queue(run_id).put({"type": "source", "title": (title or url).strip(), "url": url.strip()})


def publish_error(run_id: str | None, message: str, code: str | None = None) -> None:
    if not run_id:
        return
    ev: dict = {"type": "error", "message": message}
    if code:
        ev["code"] = code  # e.g. "quota_exhausted" → UI offers one-click paid retry
    _ensure_queue(run_id).put(ev)


def finish(run_id: str | None) -> None:
    if not run_id:
        return
    _ensure_queue(run_id).put(_DONE)


def drain(run_id: str, timeout: float = 0.5) -> dict | None:
    """Blocking get with timeout — used by the SSE generator."""
    q = _ensure_queue(run_id)
    try:
        ev = q.get(timeout=timeout)
    except queue.Empty:
        return None
    if ev is _DONE or ev.get("type") == "done":
        with _LOCK:
            _QUEUES.pop(run_id, None)
        return _DONE
    return ev


# ── Step → human-readable line ────────────────────────────────────────────

# Agent role → short, friendly label (emoji + name) shown in the UI so the
# user can see *which* agent is currently thinking. Keyed by Agent.role.
_AGENT_LABELS: dict[str, str] = {
    "Client Intake Specialist":                         "📝 Intake",
    "Client-Facing Concierge":                          "🎩 Concierge",
    "Communications Coordinator":                       "📨 Messaging",
    "Performance Analyst":                              "📊 Progress",
    "Personalised Nutrition Coach":                     "🥗 Nutrition",
    "Strength & Conditioning Programmer":               "🏋️ Planner",
    "Strength & Conditioning Coach (Exercise Advisor)": "🏋️ Coach",
}

# Separator between the agent label and the rest of the line. The UI splits on
# this to render the agent as a distinct pill — see web ThoughtLine.tsx.
_AGENT_SEP = "  ⟫  "


def agent_label(role: str | None) -> str:
    """Short friendly label for an agent role; falls back to the raw role."""
    if not role:
        return ""
    return _AGENT_LABELS.get(role.strip(), role.strip())


_TOOL_LABELS: dict[str, str] = {
    # Client / memory
    "get_client_profile":      "📇 Reading client profile",
    "write_client_profile":    "💾 Saving client profile",
    "write_client_memory":     "🧠 Storing a memory",
    "search_client_memory":    "🧠 Recalling prior context",
    # Planner
    "get_recent_activities":   "🏃 Pulling recent activities",
    "search_exercise_db":      "🏋️ Searching exercise library",
    "write_program":           "📋 Writing this week's program",
    # Nutrition
    "lookup_food":             "🥗 Looking up food macros",
    "get_session_logs":        "📒 Reading session logs",
    "get_active_program":      "📋 Reading active program",
    "get_latest_progress_report": "📊 Reading latest progress report",
    "write_nutrition_advice":  "🥗 Writing nutrition advice",
    # Progress
    "get_workout_logs":        "💪 Reading workout logs",
    "write_progress_report":   "📊 Writing progress report",
    "raise_flag":              "⚠️ Raising a concern flag",
    # Messaging
    "send_message":            "📨 Sending the message",
    # Cross-cutting
    "search_knowledge_base":   "📚 Searching knowledge base",
    "web_search":              "🌐 Searching the web",
}


def describe_step(step: Any) -> str | None:
    """Translate a CrewAI step (AgentAction / AgentFinish / dict) into a
    short human-readable line. Returns None when no useful info is present
    (e.g. an internal planning step with no tool call).

    Each line carries two parts: the *what* (the action label + a tiny input
    hint) and the *why* (the model's own reasoning, pulled from the step's
    `.thought`). They're joined with `  ·  ` so the UI can render the reason
    inline after the action."""
    if step is None:
        return None
    why = _reason(step)
    # AgentAction-like: has .tool + .tool_input
    tool = getattr(step, "tool", None)
    if isinstance(tool, str) and tool:
        label = _TOOL_LABELS.get(tool, f"🔧 {tool.replace('_', ' ').capitalize()}")
        ti = getattr(step, "tool_input", None)
        hint = _input_hint(tool, ti)
        what = f"{label}{(' — ' + hint) if hint else ''}"
        return _join(what, why)
    # AgentFinish-like: has .return_values (or just .output / .log)
    if hasattr(step, "return_values") or hasattr(step, "output"):
        return _join("✅ Composing final answer", why)
    # Pure reasoning step (no tool, no finish): surface the thought on its own.
    if why:
        return f"💭 {why}"
    # Dict-shaped fallback
    if isinstance(step, dict):
        t = step.get("tool")
        if t:
            return _join(_TOOL_LABELS.get(t, f"🔧 {t}"), _reason(step))
    return None


def _join(what: str, why: str) -> str:
    return f"{what}  ·  {why}" if why else what


def _reason(step: Any, *, limit: int = 160) -> str:
    """Extract the model's reasoning ("why") behind a step.

    CrewAI's ReAct loop parses the LLM output into a `.thought` (the text
    between `Thought:` and `Action:`). We fall back to `.text` / `.log` and
    pull the Thought line out ourselves when `.thought` is absent. Returns a
    trimmed, single-line snippet — or "" when there's nothing useful."""
    raw = ""
    for attr in ("thought", "text", "log"):
        v = getattr(step, attr, None) if not isinstance(step, dict) else step.get(attr)
        if isinstance(v, str) and v.strip():
            raw = v
            break
    if not raw:
        return ""
    # Strip a leading "Thought:" label and drop anything from "Action:" on.
    text = raw.strip()
    low = text.lower()
    if low.startswith("thought:"):
        text = text[len("thought:"):]
    for marker in ("\nAction:", "\nAction Input:", "Action:", "Final Answer:"):
        i = text.find(marker)
        if i != -1:
            text = text[:i]
    # Collapse whitespace to a single line.
    text = " ".join(text.split())
    if not text:
        return ""
    if len(text) > limit:
        # Trim on a word boundary so we don't cut mid-word.
        text = text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return text


def _input_hint(tool: str, ti: Any) -> str:
    """Tiny inline hint about what the tool is being called with."""
    if ti is None:
        return ""
    # CrewAI passes a dict; sometimes a JSON string.
    if isinstance(ti, str):
        return ""
    if not isinstance(ti, dict):
        return ""
    if tool == "search_exercise_db":
        bits = [str(ti.get(k)) for k in ("muscle_group", "equipment") if ti.get(k)]
        return " / ".join(bits)
    if tool == "get_recent_activities":
        if ti.get("days"):
            return f"last {ti['days']}d"
        if ti.get("period_start") and ti.get("period_end"):
            return f"{ti['period_start']} → {ti['period_end']}"
    if tool == "get_session_logs" and ti.get("days"):
        return f"last {ti['days']}d"
    if tool == "lookup_food" and ti.get("name"):
        return str(ti["name"])[:24]
    if tool == "search_client_memory" and ti.get("query"):
        return f"'{str(ti['query'])[:24]}'"
    if tool == "search_knowledge_base" and ti.get("query"):
        return f"'{str(ti['query'])[:24]}'"
    if tool == "web_search" and ti.get("query"):
        return f"'{str(ti['query'])[:32]}'"
    if tool == "raise_flag" and ti.get("kind"):
        return str(ti["kind"])
    return ""


# Active run_id for the current thread / asyncio task. We use a ContextVar
# instead of closures so the CrewAI step_callback can be a module-level
# function — closures trip Pydantic's "function callbacks cannot be
# serialized" warning when stored on Agent.
_CURRENT_RUN: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "gymdays_current_run_id", default=None,
)

# Friendly label of the agent currently running, bound alongside the run_id so
# step_callback can tag each thought with which agent produced it.
_CURRENT_AGENT: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "gymdays_current_agent", default=None,
)


def current_run_id() -> str | None:
    """The active run_id for this thread/task, or None outside a run."""
    return _CURRENT_RUN.get()


def step_callback(step: Any) -> None:
    """Module-level CrewAI step callback — reads the active run_id from the
    context variable. Safe to attach to any agent; if no run is active the
    call is a no-op."""
    run_id = _CURRENT_RUN.get()
    if not run_id:
        return
    try:
        line = describe_step(step)
        if line:
            agent = _CURRENT_AGENT.get()
            if agent:
                line = f"{agent}{_AGENT_SEP}{line}"
            publish(run_id, line)
    except Exception:
        pass


@contextmanager
def run_context(run_id: str | None, agent: str | None = None):
    """Bind run_id (and optionally the active agent's role/label) for the
    duration of the block. `agent` may be a raw Agent.role — it's normalised
    to a short friendly label."""
    token = _CURRENT_RUN.set(run_id)
    atoken = _CURRENT_AGENT.set(agent_label(agent))
    try:
        yield
    finally:
        _CURRENT_AGENT.reset(atoken)
        _CURRENT_RUN.reset(token)


# Backwards-compat shim: existing call sites use make_step_callback(run_id);
# now they just get the module-level callback. The flow is responsible for
# entering `run_context(run_id)` around `crew.kickoff()`.
def make_step_callback(_run_id: str):
    return step_callback
