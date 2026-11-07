"""Central config — reads .env at repo root then web/.env.local as fallback."""
from __future__ import annotations
import os
from pathlib import Path
from dotenv import load_dotenv

_root = Path(__file__).parent.parent

# Load root .env first, then web/.env.local as supplement.
load_dotenv(_root / ".env", override=False)
load_dotenv(_root / "web" / ".env.local", override=False)


def _get(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


# ── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL:              str = _get("SUPABASE_URL") or _get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY: str = _get("SUPABASE_SERVICE_ROLE_KEY")

# ── LLM provider keys (set whichever providers you want to use) ──────────────
OPENAI_API_KEY:    str = _get("OPENAI_API_KEY")
ANTHROPIC_API_KEY: str = _get("ANTHROPIC_API_KEY")
# Google AI Studio — powers the free default (Gemma). Get a free key at
# https://aistudio.google.com/apikey (no card). Accepts GOOGLE_API_KEY too.
GEMINI_API_KEY:    str = _get("GEMINI_API_KEY") or _get("GOOGLE_API_KEY")


# ── Model selection ──────────────────────────────────────────────────────────
# Supported model IDs (litellm format: <provider>/<model>).
SUPPORTED_LLMS: dict[str, str] = {
    # Google AI Studio — free tier (the default; needs only a free GEMINI_API_KEY).
    # Gemma 4 supports tool/function calling, which the agents rely on.
    "gemini/gemma-4-31b-it": "Google · Gemma 4 (free — default)",
    # OpenAI — bring your own key (enabled on demand once a key is set)
    "openai/gpt-4o-mini":  "OpenAI · GPT-4o mini (fast, cheap)",
    "openai/gpt-4o":       "OpenAI · GPT-4o",
    "openai/gpt-4.1-mini": "OpenAI · GPT-4.1 mini",
    # Anthropic — bring your own key (enabled on demand once a key is set)
    "anthropic/claude-haiku-4-5-20251001": "Anthropic · Claude Haiku 4.5 (fast, cheap)",
    "anthropic/claude-sonnet-5":           "Anthropic · Claude Sonnet 5 (balanced)",
    "anthropic/claude-opus-5":             "Anthropic · Claude Opus 5 (recommended)",
    "anthropic/claude-fable-5":            "Anthropic · Claude Fable 5 (most capable)",
}


def _default_llm_model() -> str:
    """Pick a sensible default based on which provider key is configured."""
    env_pick = _get("LLM_MODEL")
    if env_pick:
        return env_pick
    if GEMINI_API_KEY:
        return "gemini/gemma-4-31b-it"  # free default
    if ANTHROPIC_API_KEY:
        return "anthropic/claude-haiku-4-5-20251001"
    if OPENAI_API_KEY:
        return "openai/gpt-4o-mini"
    return "gemini/gemma-4-31b-it"  # placeholder; real call needs GEMINI_API_KEY


LLM_MODEL: str = _default_llm_model()

# Vision model for InBody / body-composition photo OCR. Bare Anthropic model id
# (no provider prefix) — the OCR path calls the Anthropic SDK directly, not the
# CrewAI/litellm wrapper. Haiku 4.5 is vision-capable and cheap; the trainer
# reviews every autofilled value before saving, so a light model is fine. Bump
# to claude-sonnet-5 via env if a device's printout reads poorly.
INBODY_OCR_MODEL: str = _get("INBODY_OCR_MODEL", "claude-haiku-4-5-20251001")

# Embeddings stay on OpenAI (no first-party Anthropic embedding model).
EMBED_MODEL:     str = _get("EMBED_MODEL",     "text-embedding-3-small")
EMBED_DIMENSION: int = int(_get("EMBED_DIMENSION", "1536"))

# ── Strava ───────────────────────────────────────────────────────────────────
STRAVA_CLIENT_ID:     str = _get("STRAVA_CLIENT_ID")
STRAVA_CLIENT_SECRET: str = _get("STRAVA_CLIENT_SECRET")
STRAVA_VERIFY_TOKEN:  str = _get("STRAVA_VERIFY_TOKEN")
