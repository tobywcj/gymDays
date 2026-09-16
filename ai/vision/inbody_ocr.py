"""InBody / BIA result-sheet OCR via Claude vision.

A trainer photographs the printout (or scale screen) at intake; this extracts
every legible body-composition parameter. Two buckets come back:

  * ``mapped``  — the handful of readings that have typed columns on
    ``client_health_metrics`` (weight, BMI, body-fat %, FFM, BMR, WHR, TBW, and
    BP/RHR if the sheet happens to show them). Numeric or ``None``.
  * ``extra``   — everything else the device printed (segmental lean/fat mass,
    visceral fat level, skeletal muscle mass, protein, minerals, phase angle,
    InBody score, obesity degree, target/control figures, …). Each entry is
    ``{key, label, value, unit}``. This is where "extract as many params as
    possible, machines differ" lives — we never hard-code a device layout.

The trainer reviews/edits both buckets in the UI before anything is saved, so
this is best-effort extraction, not a source of truth.
"""
from __future__ import annotations

import base64
import json
import re

from ai.config import ANTHROPIC_API_KEY, INBODY_OCR_MODEL

# Readings that have dedicated typed columns — keep these out of `extra`.
MAPPED_KEYS: tuple[str, ...] = (
    "bp_systolic",
    "bp_diastolic",
    "resting_hr",
    "weight_kg",
    "bmi",
    "body_fat_pct",
    "fat_free_mass_kg",
    "bmr_kcal",
    "waist_hip_ratio",
    "total_body_water_pct",
)

SUPPORTED_MEDIA_TYPES: frozenset[str] = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif"}
)

_SYSTEM = (
    "You are a meticulous OCR engine for body-composition analyser printouts "
    "(InBody 270/370/570/770/970, Tanita, and generic BIA scales). You read the "
    "numbers exactly as printed and never invent, estimate, or compute a value "
    "you cannot clearly see. You always reply with a single JSON object and no "
    "other text."
)

_USER_PROMPT = f"""\
Read this body-composition result sheet and extract EVERY legible numeric \
parameter. Different machines print different panels — capture whatever is on \
THIS sheet; do not assume a fixed layout and do not skip anything readable.

Return a single JSON object with exactly these keys:

- "machine": the device model printed on the sheet (e.g. "InBody 570"), or null.
- "mapped": an object with ONLY these keys, each a number or null (null if not \
clearly printed). Strip units; convert to the unit named:
    bp_systolic (mmHg, int), bp_diastolic (mmHg, int), resting_hr (bpm, int),
    weight_kg (kg), bmi, body_fat_pct (%), fat_free_mass_kg (kg — a.k.a. lean \
body mass / fat-free mass), bmr_kcal (kcal, int — basal metabolic rate),
    waist_hip_ratio (WHR), total_body_water_pct (% — if the sheet shows TBW in \
litres only, leave null).
- "extra": an array of every OTHER parameter on the sheet that is NOT one of the \
mapped keys above. Each item is an object:
    {{"key": snake_case_identifier, "label": "Human Readable Name", \
"value": <number>, "unit": "kg" | "%" | "L" | "" | ...}}
  Include (when present): skeletal muscle mass, soft lean mass, dry lean mass, \
protein, minerals, bone mineral content, body fat mass, visceral fat level/area, \
segmental lean mass (right arm/left arm/trunk/right leg/left leg), segmental fat \
mass, ECW/TBW ratio, phase angle, InBody score / fitness score, obesity degree, \
target weight, weight control, fat control, muscle control, basal metabolic rate \
if you prefer it here too is fine to omit (it is already mapped), SMI, cell mass, \
and any other printed metric. Keep the value purely numeric; put the unit in \
"unit". Omit any parameter you cannot read; never guess.

Keys must be lowercase snake_case and unique. Reply with ONLY the JSON object."""


class OcrConfigError(EnvironmentError):
    """Raised when the OCR path is called without an Anthropic key configured."""


def _b64(image_bytes: bytes) -> str:
    return base64.standard_b64encode(image_bytes).decode("ascii")


def _extract_json(text: str) -> dict:
    """Pull the JSON object out of the model reply, tolerant of stray prose."""
    text = text.strip()
    # Strip ```json fences if present.
    fence = re.match(r"^```(?:json)?\s*(.+?)\s*```$", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _num(v) -> float | int | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        m = re.search(r"-?\d+(?:\.\d+)?", v.replace(",", ""))
        if m:
            f = float(m.group())
            return int(f) if f.is_integer() else f
    return None


def _normalize(data: dict) -> dict:
    raw_mapped = data.get("mapped") or {}
    mapped: dict[str, float | int | None] = {}
    for k in MAPPED_KEYS:
        n = _num(raw_mapped.get(k))
        if n is not None and k in ("bp_systolic", "bp_diastolic", "resting_hr", "bmr_kcal"):
            n = int(round(n))
        mapped[k] = n

    extra: list[dict] = []
    seen: set[str] = set()
    for item in data.get("extra") or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip().lower()
        key = re.sub(r"[^a-z0-9]+", "_", key).strip("_")
        if not key or key in seen or key in MAPPED_KEYS:
            continue
        value = _num(item.get("value"))
        if value is None:
            continue
        seen.add(key)
        extra.append(
            {
                "key": key,
                "label": str(item.get("label") or key.replace("_", " ").title()),
                "value": value,
                "unit": str(item.get("unit") or ""),
            }
        )

    machine = data.get("machine")
    return {
        "machine": str(machine) if machine else None,
        "mapped": mapped,
        "extra": extra,
    }


def _extraction_tool() -> dict:
    """A tool whose input schema mirrors our return shape. Forcing the model to
    call it means the Anthropic SDK hands back an already-parsed dict — we never
    hand-parse model-authored JSON, so malformed output (inline units like
    ``263 Ω``, truncation, stray prose) can't break extraction."""
    return {
        "name": "record_body_composition",
        "description": "Record every body-composition parameter read from the sheet.",
        "input_schema": {
            "type": "object",
            "properties": {
                "machine": {
                    "type": ["string", "null"],
                    "description": "Device model printed on the sheet (e.g. 'InBody 570'), or null.",
                },
                "mapped": {
                    "type": "object",
                    "description": "Standard readings — a number or null each, units stripped.",
                    "properties": {k: {"type": ["number", "null"]} for k in MAPPED_KEYS},
                },
                "extra": {
                    "type": "array",
                    "description": "Every OTHER parameter on the sheet (not in mapped).",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": {"type": "string", "description": "snake_case identifier"},
                            "label": {"type": "string", "description": "human-readable name"},
                            "value": {"type": "number", "description": "numeric value only, no unit"},
                            "unit": {"type": "string"},
                        },
                        "required": ["key", "value"],
                    },
                },
            },
            "required": ["mapped", "extra"],
        },
    }


def extract_inbody(image_bytes: bytes, media_type: str) -> dict:
    """OCR an InBody/BIA sheet into ``{machine, mapped, extra}``.

    Raises ``OcrConfigError`` if no Anthropic key is set, ``ValueError`` for an
    unsupported media type, and propagates SDK/parse errors otherwise.
    """
    if not ANTHROPIC_API_KEY:
        raise OcrConfigError(
            "ANTHROPIC_API_KEY not set — required for InBody photo OCR."
        )
    if media_type not in SUPPORTED_MEDIA_TYPES:
        raise ValueError(
            f"Unsupported image type {media_type!r}. "
            f"Use one of: {', '.join(sorted(SUPPORTED_MEDIA_TYPES))}."
        )

    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    tool = _extraction_tool()
    resp = client.messages.create(
        model=INBODY_OCR_MODEL,
        max_tokens=4096,  # dense sheets (segmental + impedance tables) run long
        system=_SYSTEM,
        tools=[tool],
        tool_choice={"type": "tool", "name": tool["name"]},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": _b64(image_bytes),
                        },
                    },
                    {"type": "text", "text": _USER_PROMPT},
                ],
            }
        ],
    )

    for block in resp.content:
        if block.type == "tool_use" and isinstance(block.input, dict):
            return _normalize(dict(block.input))

    # Fallback: if no tool_use came back, salvage any text JSON with the tolerant parser.
    text = "".join(block.text for block in resp.content if block.type == "text")
    if text.strip():
        return _normalize(_extract_json(text))
    raise ValueError("OCR returned no structured result.")
