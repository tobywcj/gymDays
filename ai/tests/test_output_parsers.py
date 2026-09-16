"""LLM output parsers in ai/crew/flows.py — no LLM calls.

  1. _parse_aft_output: brace-matched JSON (nested signals) inside fences →
     level/signals; markdown stripped from the rationale; invalid level → green.
  2. _parse_verdict: same shape for screening readiness; fails SAFE to "alert".
  3. _extract_json_object: fenced / prose-wrapped / non-object replies.
"""
from __future__ import annotations

from ai.crew.flows import _extract_json_object, _parse_aft_output, _parse_verdict

AFT_RAW = """## 分類理由
- **Consistent** 3x/week training for 8 weeks
* Good HR recovery

```json
{"level": "Yellow", "signals": [{"kind": "volume", "detail": {"sessions": 24}}, "junk"]}
```
"""


def test_aft_parses_level_signals_and_cleans_rationale():
    level, signals, rationale = _parse_aft_output(AFT_RAW)
    assert level == "yellow"
    assert signals == [{"kind": "volume", "detail": {"sessions": 24}}]
    assert rationale == "• Consistent 3x/week training for 8 weeks\n• Good HR recovery"


def test_aft_unknown_level_defaults_green():
    level, _, _ = _parse_aft_output('{"level": "purple", "signals": []}')
    assert level == "green"


def test_aft_no_json_keeps_text():
    level, signals, rationale = _parse_aft_output("- just prose")
    assert (level, signals, rationale) == ("green", [], "• just prose")


def test_verdict_ready():
    verdict, flags, rationale = _parse_verdict(
        'Cleared.\n```json\n{"verdict": "READY", "flags": [{"kind": "bp"}]}\n```')
    assert verdict == "ready"
    assert flags == [{"kind": "bp"}]
    assert rationale == "Cleared."


def test_verdict_fails_safe_to_alert():
    assert _parse_verdict("model rambled, no json")[0] == "alert"
    assert _parse_verdict('{"verdict": "maybe"}')[0] == "alert"
    assert _parse_verdict('{"verdict": "ready"')[0] == "alert"   # truncated JSON


def test_extract_json_object_variants():
    assert _extract_json_object('```json\n{"insight": "x", "children": []}\n```') == {"insight": "x", "children": []}
    assert _extract_json_object('Sure! {"a": 1} done') == {"a": 1}
    assert _extract_json_object("[1, 2]") is None
    assert _extract_json_object("") is None
    assert _extract_json_object("{not json}") is None
