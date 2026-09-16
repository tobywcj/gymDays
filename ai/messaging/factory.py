"""Provider factory.

Lookup order for credentials:
  1. Explicit `creds` arg (used by validation flows)
  2. messaging_credentials DB row for the given trainer_id
  3. Process env vars (legacy / system-default path)

Names → provider classes (channels are an attribute on each class):
  console   → ConsoleProvider     (default; no creds)
  telegram  → TelegramBotProvider  (free + official)
  email     → EmailProvider        (stub)

Override the env default via MESSAGING_PROVIDER env var.
"""
from __future__ import annotations
import os
from typing import Optional, Type
from ai.messaging.provider import MessagingProvider, NotConfigured
from ai.messaging.providers.console import ConsoleProvider
from ai.messaging.providers.telegram import TelegramBotProvider
from ai.messaging.providers.email import EmailProvider

REGISTRY: dict[str, Type[MessagingProvider]] = {
    "console":  ConsoleProvider,
    "telegram": TelegramBotProvider,
    "email":    EmailProvider,
}


def _load_trainer_creds(trainer_id: str, provider_name: str) -> Optional[dict]:
    """Return the credentials dict for (trainer_id, provider_name) or None."""
    from ai.db import get_db
    try:
        resp = get_db().table("messaging_credentials") \
            .select("credentials") \
            .eq("trainer_id", trainer_id) \
            .eq("provider", provider_name) \
            .limit(1).execute()
        return resp.data[0]["credentials"] if resp.data else None
    except Exception:
        return None


def list_providers(trainer_id: str | None = None) -> dict[str, dict]:
    """Return availability info per provider. If trainer_id is given, prefers
    DB-stored credentials over env vars when checking availability."""
    out: dict[str, dict] = {}
    for name, cls in REGISTRY.items():
        creds = _load_trainer_creds(trainer_id, name) if trainer_id else None
        try:
            cls(creds=creds)
            available, reason = True, None
        except NotConfigured as e:
            available, reason = False, str(e)
        out[name] = {
            "channel":   cls.channel,
            "available": available,
            "reason":    reason,
            "source":    ("db" if creds else "env") if available else None,
        }
    return out


def get_provider(
    name: str | None = None,
    *,
    trainer_id: str | None = None,
    creds: dict | None = None,
) -> MessagingProvider:
    """Construct the chosen provider.

    Resolution: explicit `creds` arg > DB creds for trainer > env vars.
    Falls back to MESSAGING_PROVIDER env, then 'console'.
    """
    chosen = (name or os.environ.get("MESSAGING_PROVIDER", "console")).strip()
    if chosen not in REGISTRY:
        raise ValueError(
            f"Unknown messaging provider: {chosen!r}. "
            f"Choose one of: {sorted(REGISTRY)}"
        )
    cls = REGISTRY[chosen]
    if creds is None and trainer_id:
        creds = _load_trainer_creds(trainer_id, chosen)
    return cls(creds=creds)
