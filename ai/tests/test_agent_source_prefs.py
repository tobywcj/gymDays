"""Per-client, per-agent data-source toggles (clients.agent_source_prefs → gate_tools).

  1. No overrides → the agent's tool list is returned untouched.
  2. A source switched OFF removes every tool backed by it (e.g. workouts →
     both activity + workout-log tools); write tools always survive.
  3. A source switched ON that the agent lacked is built and appended once.
  4. _source_overrides ignores unknown sources and never raises on DB errors.
"""
from __future__ import annotations
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from ai.crew import agents


def tool(name: str):
    return SimpleNamespace(name=name)


def names(tools):
    return [t.name for t in tools]


BASE = [
    tool("get_client_profile"),
    tool("get_recent_activities"),
    tool("get_workout_logs"),
    tool("search_knowledge_base"),
    tool("write_progress_report"),   # output tool — no source mapping
]


def test_no_overrides_returns_tools_unchanged():
    with patch.object(agents, "_source_overrides", return_value={}):
        assert agents.gate_tools(BASE, "c1", "progress") is BASE


def test_switching_source_off_drops_all_its_tools_but_keeps_write_tools():
    with patch.object(agents, "_source_overrides", return_value={"workouts": False, "knowledge": False}):
        out = agents.gate_tools(BASE, "c1", "progress")
    assert names(out) == ["get_client_profile", "write_progress_report"]


def test_switching_new_source_on_appends_its_tool_once():
    built = [tool("web_search")]
    with patch.object(agents, "_source_overrides", return_value={"web": True, "profile": True}), \
         patch.object(agents, "_build_source_tools", return_value=built) as build:
        out = agents.gate_tools(BASE, "c1", "progress")
    build.assert_called_once_with("web", "c1", "progress")   # profile was already on → not rebuilt
    assert names(out) == names(BASE) + ["web_search"]


def test_clientless_build_skips_client_scoped_sources():
    assert agents._build_source_tools("memory", None, "planner") == []


def _db_returning(prefs):
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.single.return_value \
        .execute.return_value.data = {"agent_source_prefs": prefs}
    return db


def test_source_overrides_filters_unknown_sources():
    db = _db_returning({"planner": {"web": 0, "bogus": False, "inbody": True}, "nutrition": {"food": False}})
    with patch("ai.db.get_db", return_value=db):
        assert agents._source_overrides("c1", "planner") == {"web": False, "inbody": True}


def test_source_overrides_is_non_fatal():
    with patch("ai.db.get_db", side_effect=RuntimeError("db down")):
        assert agents._source_overrides("c1", "planner") == {}
    assert agents._source_overrides(None, "planner") == {}
