"""Messaging abstraction tests (Telegram-based).

  1. ConsoleProvider.send() writes a `messages` row with status='sent'.
  2. Stub providers raise NotConfigured until their creds are set.
  3. The send_message agent tool refuses cross-client access.
  4. Telegram delivery (mocked HTTP): success + failure paths.
"""
from __future__ import annotations
import os
import pytest
from unittest.mock import patch, MagicMock
from ai.messaging.provider import NotConfigured
from ai.messaging.providers.console import ConsoleProvider
from ai.messaging.providers.telegram import TelegramBotProvider
from ai.messaging.providers.email import EmailProvider
from ai.messaging.factory import get_provider, list_providers
from ai.crew.tools.messaging import SendMessage


# ── ConsoleProvider ──────────────────────────────────────────────────────────

class TestConsoleProvider:
    def test_send_writes_messages_row_with_status_sent(self, test_client_id, db):
        trainer_id = db.table("clients").select("trainer_id") \
            .eq("id", test_client_id).single().execute().data["trainer_id"]

        provider = ConsoleProvider()
        result = provider.send(
            trainer_id=trainer_id,
            client_id=test_client_id,
            body="Hello from ConsoleProvider — test message.",
        )
        assert result.status == "sent"
        assert result.message_id

        row = db.table("messages").select("body, status, channel, direction") \
            .eq("id", result.message_id).single().execute().data
        assert row["status"]    == "sent"
        assert row["channel"]   == "console"
        assert row["direction"] == "outbound"


# ── Stubs require config ─────────────────────────────────────────────────────

class TestStubProvidersRequireConfig:
    @pytest.fixture(autouse=True)
    def _strip_env(self):
        keys = ["TELEGRAM_BOT_TOKEN", "EMAIL_API_KEY", "EMAIL_FROM"]
        saved = {k: os.environ.pop(k, None) for k in keys}
        yield
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v

    def test_telegram_raises_without_token(self):
        with pytest.raises(NotConfigured, match="bot_token"):
            TelegramBotProvider()

    def test_email_raises_without_env(self):
        with pytest.raises(NotConfigured, match="api_key"):
            EmailProvider()

    def test_telegram_constructs_with_token(self):
        prov = TelegramBotProvider(creds={"bot_token": "123:abc"})
        assert prov.channel == "telegram"
        assert prov.token == "123:abc"


# ── Factory + catalog ────────────────────────────────────────────────────────

class TestFactory:
    def test_registry_is_telegram_console_email_only(self):
        from ai.messaging.factory import REGISTRY
        assert set(REGISTRY) == {"console", "telegram", "email"}

    def test_get_provider_default_is_console(self):
        os.environ.pop("MESSAGING_PROVIDER", None)
        assert isinstance(get_provider(), ConsoleProvider)

    def test_list_providers_reports_console_available(self):
        catalog = list_providers()
        assert catalog["console"]["available"] is True
        assert "telegram" in catalog and "email" in catalog


# ── Telegram delivery (mocked HTTP) ──────────────────────────────────────────

class TestTelegramDelivery:
    def test_send_success_writes_row_sent(self, test_client_id, db):
        trainer_id = db.table("clients").select("trainer_id") \
            .eq("id", test_client_id).single().execute().data["trainer_id"]

        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.json.return_value = {"ok": True, "result": {"message_id": 4242}}
        with patch("ai.messaging.providers.telegram.httpx.post", return_value=mock_resp) as mock_post:
            prov = TelegramBotProvider(creds={"bot_token": "123:abc"})
            result = prov.send(
                trainer_id=trainer_id, client_id=test_client_id,
                body="Hi from Telegram test", to="987654321",
            )

        kw = mock_post.call_args.kwargs
        assert kw["json"]["chat_id"] == "987654321"
        assert kw["json"]["text"] == "Hi from Telegram test"
        assert "/bot123:abc/sendMessage" in mock_post.call_args.args[0]

        assert result.status == "sent"
        assert result.external_id == "4242"
        row = db.table("messages").select("status, channel") \
            .eq("id", result.message_id).single().execute().data
        assert row["status"] == "sent"
        assert row["channel"] == "telegram"

    def test_api_failure_marks_row_failed(self, test_client_id, db):
        trainer_id = db.table("clients").select("trainer_id") \
            .eq("id", test_client_id).single().execute().data["trainer_id"]

        mock_resp = MagicMock()
        mock_resp.is_success = False
        mock_resp.status_code = 401
        mock_resp.text = '{"ok":false,"description":"Unauthorized"}'
        with patch("ai.messaging.providers.telegram.httpx.post", return_value=mock_resp):
            prov = TelegramBotProvider(creds={"bot_token": "bad"})
            result = prov.send(
                trainer_id=trainer_id, client_id=test_client_id,
                body="will fail", to="987654321",
            )

        assert result.status == "failed"
        row = db.table("messages").select("status, body") \
            .eq("id", result.message_id).single().execute().data
        assert row["status"] == "failed"
        assert "Telegram API 401" in row["body"]


# ── Agent tool scoping ───────────────────────────────────────────────────────

class TestSendMessageTool:
    def test_writes_row_through_console_provider(self, test_client_id, db):
        tool = SendMessage(run_client_id=test_client_id)
        msg = tool._run(client_id=test_client_id, body="Test via tool", provider="console")
        assert "status=sent" in msg

        rows = db.table("messages").select("body, status") \
            .eq("client_id", test_client_id) \
            .order("sent_at", desc=True) \
            .limit(1).execute().data
        assert rows[0]["status"] == "sent"

    def test_refuses_cross_client_access(self, test_client_id):
        tool = SendMessage(run_client_id=test_client_id)
        with pytest.raises(PermissionError, match="cross-client"):
            tool._run(client_id="00000000-0000-0000-0000-000000000000", body="x")
