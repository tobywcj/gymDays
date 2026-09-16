"""MessagingProvider — provider-agnostic interface.

Every provider:
  - declares its channel ("whatsapp" | "telegram" | "email" | "console")
  - validates env config at construction (raises NotConfigured if missing)
  - sends a message and writes a `messages` row in Supabase

Channel selection happens at the tool layer. Providers are stateless and
constructed once per use. To swap providers, change MESSAGING_PROVIDER env var.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Literal, Optional
from ai.db import get_db

Channel = Literal["whatsapp", "telegram", "email", "console"]


class NotConfigured(Exception):
    """Raised when a provider's required env vars are absent."""


@dataclass
class SendResult:
    message_id: str        # uuid of the inserted `messages` row
    status: str            # "sent" | "failed"
    external_id: str | None = None  # provider's id (Twilio sid, etc.) if any


class MessagingProvider(ABC):
    """Base provider — subclasses must set `channel` and implement _deliver.

    Every subclass accepts an optional `creds` dict so the factory can pass
    DB-loaded credentials in. Subclasses fall back to env vars when creds
    are absent. The signature is uniform to keep get_provider() generic.
    """
    channel: Channel

    def __init__(self, creds: dict | None = None) -> None:
        # Default no-op; concrete subclasses override to consume creds.
        del creds

    @abstractmethod
    def _deliver(self, *, to: str, body: str, subject: str | None = None) -> Optional[str]:
        """Actually push the message via the provider's API.

        `subject` is only meaningful for channels that have one (email); chat
        channels (telegram/console) ignore it.

        Return the provider's external message id, or None.
        Raises on delivery failure — the wrapper catches and records status='failed'.
        """
        ...

    def send(
        self,
        *,
        trainer_id: str,
        client_id: str,
        body: str,
        thread_id: str | None = None,
        to: str | None = None,
        subject: str | None = None,
    ) -> SendResult:
        """Send + persist. Subclasses generally don't override this."""
        db = get_db()
        status = "sent"
        external_id: str | None = None
        try:
            external_id = self._deliver(to=to or "", body=body, subject=subject)
        except Exception as e:
            status = "failed"
            body = f"{body}\n\n[delivery error: {e}]"

        # Ensure a thread exists for (client, channel) — useful for inbox views.
        if thread_id is None:
            existing = db.table("messaging_threads") \
                .select("id") \
                .eq("client_id", client_id) \
                .eq("channel", self.channel) \
                .limit(1).execute()
            if existing.data:
                thread_id = existing.data[0]["id"]
            else:
                ins = db.table("messaging_threads").insert({
                    "trainer_id": trainer_id,
                    "client_id":  client_id,
                    "channel":    self.channel,
                    "external_handle": to,
                }).execute()
                thread_id = ins.data[0]["id"]

        row = db.table("messages").insert({
            "trainer_id": trainer_id,
            "client_id":  client_id,
            "thread_id":  thread_id,
            "direction":  "outbound",
            "channel":    self.channel,
            "body":       body,
            "status":     status,
            "to_address": to,
        }).execute().data[0]

        return SendResult(message_id=row["id"], status=status, external_id=external_id)
