"""Provider-aware LLM factory.

Lets you switch the agent brain between OpenAI and Anthropic by changing the
LLM_MODEL env var (or passing model= when calling make_llm()).

Examples:
    LLM_MODEL=openai/gpt-4o-mini
    LLM_MODEL=anthropic/claude-opus-5
"""
from __future__ import annotations
from crewai.llm import LLM
from ai.config import LLM_MODEL, SUPPORTED_LLMS
from ai.secrets import resolve_provider_key


class UnknownProvider(Exception):
    """Raised when LLM_MODEL doesn't match a known provider prefix."""


# Where each provider's key can be entered / how to fix a missing one.
_KEY_HINT: dict[str, str] = {
    "openai":    "Add OPENAI_API_KEY on the API Keys page (or .env), or pick another model.",
    "anthropic": "Add ANTHROPIC_API_KEY on the API Keys page (or .env), or pick another model.",
    "gemini":    "Add GEMINI_API_KEY on the API Keys page (free key at https://aistudio.google.com/apikey).",
}


def _provider_of(model: str) -> str:
    if "/" not in model:
        raise UnknownProvider(
            f"LLM_MODEL must be in '<provider>/<model>' format. Got: {model!r}"
        )
    return model.split("/", 1)[0].lower()


def _key_for(provider: str, client_id: str | None, trainer_id: str | None) -> str:
    key = resolve_provider_key(provider, client_id=client_id, trainer_id=trainer_id)
    if key:
        return key
    hint = _KEY_HINT.get(provider)
    if hint:
        raise EnvironmentError(f"No API key for {provider!r} models. {hint}")
    raise UnknownProvider(f"Unsupported provider: {provider!r}")


def make_llm(
    model: str | None = None,
    *,
    client_id: str | None = None,
    trainer_id: str | None = None,
) -> LLM:
    """Build a CrewAI LLM bound to the right provider/key.

    The key is resolved per-run: the trainer's UI-entered key (looked up from
    client_id or trainer_id) takes precedence over the global .env fallback.
    """
    chosen = model or LLM_MODEL
    provider = _provider_of(chosen)
    return LLM(model=chosen, api_key=_key_for(provider, client_id, trainer_id))


def list_supported() -> dict[str, str]:
    """Return the supported model catalog (for UI / CLI display)."""
    return dict(SUPPORTED_LLMS)
