"""InBody / BIA OCR (ai/vision/inbody_ocr.py) — no network.

  1. _num coerces printed values ("1,234.5 kcal", "72kg") and rejects junk.
  2. _normalize types the mapped columns, rounds integer vitals, and cleans
     `extra` (snake_case keys, de-dupe, drop mapped keys + non-numeric values).
  3. _extract_json tolerates ```json fences and surrounding prose.
  4. extract_inbody validates config/media type and prefers the tool_use block,
     falling back to text JSON (Anthropic client mocked).
"""
from __future__ import annotations
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from ai.vision import inbody_ocr as ocr


class TestNum:
    @pytest.mark.parametrize("raw, want", [
        (72, 72), (72.5, 72.5), ("72kg", 72), ("1,234.5 kcal", 1234.5),
        ("-3.0", -3), ("BMI 23.4", 23.4),
    ])
    def test_parses_printed_numbers(self, raw, want):
        assert ocr._num(raw) == want

    @pytest.mark.parametrize("raw", [None, True, False, "", "n/a", {}, []])
    def test_rejects_non_numbers(self, raw):
        assert ocr._num(raw) is None


class TestNormalize:
    def test_mapped_keys_typed_and_rounded(self):
        out = ocr._normalize({
            "machine": "InBody 570",
            "mapped": {"weight_kg": "71.8 kg", "bmr_kcal": "1523.6", "resting_hr": 61.4,
                       "body_fat_pct": "18.2%", "unknown_col": 5},
        })
        assert out["machine"] == "InBody 570"
        assert set(out["mapped"]) == set(ocr.MAPPED_KEYS)   # every column present, extras dropped
        assert out["mapped"]["weight_kg"] == 71.8
        assert out["mapped"]["bmr_kcal"] == 1524              # integer vitals rounded
        assert out["mapped"]["resting_hr"] == 61
        assert out["mapped"]["body_fat_pct"] == 18.2
        assert out["mapped"]["bmi"] is None                   # missing → None, not dropped

    def test_extra_cleaned_and_deduped(self):
        out = ocr._normalize({"extra": [
            {"key": "Skeletal Muscle Mass", "label": "SMM", "value": "33.1", "unit": "kg"},
            {"key": "skeletal-muscle-mass", "value": 99},     # duplicate after snake_casing
            {"key": "Visceral Fat Level", "value": 7},        # label defaulted from key
            {"key": "weight_kg", "value": 70},                # mapped key → never duplicated in extra
            {"key": "phase_angle", "value": "—"},             # non-numeric → dropped
            {"key": "", "value": 1},                          # no key → dropped
            "garbage",                                        # non-dict → dropped
        ]})
        assert out["machine"] is None
        assert out["extra"] == [
            {"key": "skeletal_muscle_mass", "label": "SMM", "value": 33.1, "unit": "kg"},
            {"key": "visceral_fat_level", "label": "Visceral Fat Level", "value": 7, "unit": ""},
        ]


class TestExtractJson:
    def test_fenced(self):
        assert ocr._extract_json('```json\n{"a": 1}\n```') == {"a": 1}

    def test_prose_wrapped(self):
        assert ocr._extract_json('Here you go: {"a": {"b": 2}} hope that helps') == {"a": {"b": 2}}

    def test_unparseable_raises(self):
        with pytest.raises(ValueError):
            ocr._extract_json("no json here")


def _fake_anthropic(content):
    client = MagicMock()
    client.messages.create.return_value = SimpleNamespace(content=content)
    return MagicMock(Anthropic=MagicMock(return_value=client)), client


class TestExtractInbody:
    def test_requires_api_key(self):
        with patch.object(ocr, "ANTHROPIC_API_KEY", ""):
            with pytest.raises(ocr.OcrConfigError):
                ocr.extract_inbody(b"img", "image/png")

    def test_rejects_unsupported_media_type(self):
        with patch.object(ocr, "ANTHROPIC_API_KEY", "sk-test"):
            with pytest.raises(ValueError, match="Unsupported image type"):
                ocr.extract_inbody(b"%PDF", "application/pdf")

    def test_uses_forced_tool_result(self):
        tool_block = SimpleNamespace(type="tool_use", input={"mapped": {"weight_kg": 70}, "extra": []})
        module, client = _fake_anthropic([tool_block])
        with patch.object(ocr, "ANTHROPIC_API_KEY", "sk-test"), patch.dict("sys.modules", {"anthropic": module}):
            out = ocr.extract_inbody(b"img", "image/jpeg")
        assert out["mapped"]["weight_kg"] == 70
        kwargs = client.messages.create.call_args.kwargs
        assert kwargs["tool_choice"] == {"type": "tool", "name": kwargs["tools"][0]["name"]}
        assert kwargs["messages"][0]["content"][0]["source"]["media_type"] == "image/jpeg"

    def test_falls_back_to_text_json(self):
        text_block = SimpleNamespace(type="text", text='```json\n{"mapped": {"bmi": "22.1"}}\n```')
        module, _ = _fake_anthropic([text_block])
        with patch.object(ocr, "ANTHROPIC_API_KEY", "sk-test"), patch.dict("sys.modules", {"anthropic": module}):
            out = ocr.extract_inbody(b"img", "image/png")
        assert out["mapped"]["bmi"] == 22.1

    def test_empty_reply_raises(self):
        module, _ = _fake_anthropic([])
        with patch.object(ocr, "ANTHROPIC_API_KEY", "sk-test"), patch.dict("sys.modules", {"anthropic": module}):
            with pytest.raises(ValueError, match="no structured result"):
                ocr.extract_inbody(b"img", "image/png")
