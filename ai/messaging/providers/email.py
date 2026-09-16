"""EmailProvider — transactional email via Resend (https://resend.com).

Each trainer brings their own Resend account. Credentials (per-trainer, stored
in messaging_credentials) or env vars:
  api_key   EMAIL_API_KEY    (Resend secret, starts with "re_")
  from      EMAIL_FROM       (verified sender, e.g. "Coach <coach@gymdays.app>")
"""
from __future__ import annotations
import os
from html import escape
from typing import Optional
import httpx
from ai.messaging.provider import MessagingProvider, Channel, NotConfigured

RESEND_API = "https://api.resend.com/emails"


class EmailProvider(MessagingProvider):
    channel: Channel = "email"

    def __init__(self, creds: dict | None = None) -> None:
        c = creds or {}
        self.api_key = (c.get("api_key") or os.environ.get("EMAIL_API_KEY", "")).strip()
        self.from_   = (c.get("from")    or os.environ.get("EMAIL_FROM", "")).strip()
        missing = [k for k, v in {
            "api_key": self.api_key,
            "from":    self.from_,
        }.items() if not v]
        if missing:
            raise NotConfigured(
                f"EmailProvider missing credentials: {', '.join(missing)}"
            )

    def _deliver(self, *, to: str, body: str, subject: str | None = None) -> Optional[str]:
        if not to:
            raise ValueError("recipient email required (client has no email on file)")
        # Plain-text body, plus a minimal HTML version so line breaks survive.
        html = "<br>".join(escape(line) for line in body.split("\n"))
        r = httpx.post(
            RESEND_API,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from":    self.from_,
                "to":      [to],
                "subject": (subject or "Message from your coach").strip(),
                "text":    body,
                "html":    f"<div>{html}</div>",
            },
            timeout=15,
        )
        if not r.is_success:
            raise RuntimeError(f"Resend API {r.status_code}: {r.text}")
        data = r.json()
        msg_id = data.get("id")
        if not msg_id:
            raise RuntimeError(f"Resend API error: {data}")
        return str(msg_id)
