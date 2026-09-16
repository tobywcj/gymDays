"""Resolve LLM provider API keys from a trainer's UI-entered secrets.

Keys entered on the dashboard "API Keys" page land in the `trainer_secrets`
table (plaintext, RLS-scoped). The AI service uses a service-role client, so it
can read a trainer's key by trainer_id — or by the client the run belongs to.
Resolution order: the trainer's own key first, then the global .env fallback.
"""
from __future__ import annotations

from ai.db import get_db
from ai.config import OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY

# Global (.env) fallback per provider.
_PROVIDER_ENV: dict[str, str] = {
    "openai":    OPENAI_API_KEY,
    "anthropic": ANTHROPIC_API_KEY,
    "gemini":    GEMINI_API_KEY,
}
# trainer_secrets key name(s) that supply each provider's key.
_PROVIDER_SECRET_NAMES: dict[str, tuple[str, ...]] = {
    "openai":    ("OPENAI_API_KEY",),
    "anthropic": ("ANTHROPIC_API_KEY",),
    "gemini":    ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
}


def _trainer_id_for_client(client_id: str | None) -> str | None:
    if not client_id:
        return None
    try:
        r = get_db().table("clients").select("trainer_id").eq("id", client_id).limit(1).execute()
        return (r.data or [{}])[0].get("trainer_id")
    except Exception:
        return None


def get_trainer_secrets(trainer_id: str | None) -> dict[str, str]:
    """A trainer's stored secrets as { KEY: value }. Empty when unknown/none."""
    if not trainer_id:
        return {}
    try:
        r = get_db().table("trainer_secrets").select("key, value").eq("trainer_id", trainer_id).execute()
        return {row["key"]: row["value"] for row in (r.data or []) if row.get("key") and row.get("value")}
    except Exception:
        return {}


def resolve_provider_key(
    provider: str,
    *,
    client_id: str | None = None,
    trainer_id: str | None = None,
) -> str | None:
    """The API key to use for a provider: trainer's UI key first, then .env."""
    tid = trainer_id or _trainer_id_for_client(client_id)
    secrets = get_trainer_secrets(tid)
    for name in _PROVIDER_SECRET_NAMES.get(provider, ()):
        if secrets.get(name):
            return secrets[name]
    return _PROVIDER_ENV.get(provider) or None


def provider_available(
    provider: str,
    *,
    trainer_id: str | None = None,
    secrets: dict[str, str] | None = None,
) -> bool:
    """Whether a provider is usable — a global .env key or a trainer's UI key."""
    if _PROVIDER_ENV.get(provider):
        return True
    secrets = secrets if secrets is not None else get_trainer_secrets(trainer_id)
    return any(secrets.get(n) for n in _PROVIDER_SECRET_NAMES.get(provider, ()))
