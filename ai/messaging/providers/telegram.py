"""TelegramBotProvider — real delivery via the Telegram Bot API.

Free + official + ToS-clean. Create a bot with @BotFather to get a token.

Recipients are Telegram chat ids (numeric), stored on clients.telegram_chat_id
after the client links via the bot's deep link (t.me/<bot>?start=<client_id>).

Config:
  TELEGRAM_BOT_TOKEN   (or creds["bot_token"])
"""
from __future__ import annotations
import os
from typing import Optional
import httpx
from ai.messaging.provider import MessagingProvider, Channel, NotConfigured


class TelegramBotProvider(MessagingProvider):
    channel: Channel = "telegram"
    API = "https://api.telegram.org/bot{token}/sendMessage"

    def __init__(self, creds: dict | None = None) -> None:
        c = creds or {}
        self.token = (c.get("bot_token") or os.environ.get("TELEGRAM_BOT_TOKEN", "")).strip()
        if not self.token:
            raise NotConfigured("TelegramBotProvider missing credentials: bot_token")

    def _deliver(self, *, to: str, body: str, subject: str | None = None) -> Optional[str]:
        # Telegram has no subject line — fold it into the message if one is given.
        if subject:
            body = f"{subject}\n\n{body}"
        if not to:
            raise ValueError("recipient chat_id required (link the client via the bot first)")
        r = httpx.post(
            self.API.format(token=self.token),
            json={"chat_id": to, "text": body},
            timeout=15,
        )
        if not r.is_success:
            raise RuntimeError(f"Telegram API {r.status_code}: {r.text}")
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"Telegram API error: {data}")
        return str(data["result"]["message_id"])
