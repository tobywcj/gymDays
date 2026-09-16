"""send_message — provider-agnostic outbound messaging tool for agents.

Picks a MessagingProvider via the factory (env-default = ConsoleProvider).
Resolves the client's preferred channel for routing; falls back to console.
Enforces run_client_id scoping like every other client-scoped tool.
"""
from __future__ import annotations
from typing import Type
from pydantic import BaseModel, Field
from crewai.tools import BaseTool
from ai.db import get_db
from ai.messaging.factory import get_provider


def _check_scope(tool: str, run_id: str, requested: str) -> None:
    if run_id != requested:
        raise PermissionError(
            f"[{tool}] cross-client access blocked: run={run_id!r} requested={requested!r}"
        )


class SendMessageInput(BaseModel):
    client_id: str = Field(description="UUID of the client to message.")
    body:      str = Field(description="The message body. Plain text.")
    provider:  str | None = Field(
        default=None,
        description="Override the env-default provider. One of: console, twilio-whatsapp, meta-whatsapp, telegram, email.",
    )


class SendMessage(BaseTool):
    name: str = "send_message"
    description: str = (
        "Send a message to the client through the configured messaging provider. "
        "By default the env's MESSAGING_PROVIDER is used (console in dev). "
        "Records the outbound row in `messages` with the resulting status."
    )
    args_schema: Type[BaseModel] = SendMessageInput
    run_client_id: str
    # Provider used when the agent doesn't pass an explicit `provider`. Lets a
    # flow pin a channel (e.g. "telegram") instead of falling back to the env
    # default ("console" in dev). None → env-default resolution.
    default_provider: str | None = None

    def _run(self, client_id: str, body: str, provider: str | None = None) -> str:
        _check_scope(self.name, self.run_client_id, client_id)
        db = get_db()
        client = db.table("clients") \
            .select("trainer_id, telegram_chat_id, email, preferred_channel") \
            .eq("id", client_id).single().execute().data

        prov = get_provider(provider or self.default_provider, trainer_id=client["trainer_id"])

        # Pick a recipient handle based on the provider's channel.
        to: str | None = None
        if prov.channel == "telegram":
            to = client.get("telegram_chat_id")
        elif prov.channel == "email":
            to = client.get("email")
        # console: no handle needed

        result = prov.send(
            trainer_id=client["trainer_id"],
            client_id=client_id,
            body=body,
            to=to,
        )
        return (
            f"Sent via {prov.channel} (provider={type(prov).__name__}): "
            f"status={result.status}, message_id={result.message_id}"
        )


def make_messaging_tools(run_client_id: str) -> list[BaseTool]:
    return [SendMessage(run_client_id=run_client_id)]


def make_messaging_agent_tools(
    run_client_id: str, default_provider: str | None = None,
) -> list[BaseTool]:
    """All tools the Messaging Agent needs: context readers + send_message.

    `default_provider` pins the channel send_message uses when the agent
    doesn't pass one explicitly (e.g. "telegram" for the reminder flows)."""
    from ai.crew.tools.client import GetClientProfile, SearchClientMemory
    from ai.crew.tools.planner import GetRecentActivities
    from ai.crew.tools.nutrition import GetActiveProgram
    from ai.crew.tools.progress import GetLatestProgressReport
    from ai.crew.tools.search import WebSearchTool
    return [
        GetClientProfile(run_client_id=run_client_id),
        GetActiveProgram(run_client_id=run_client_id),
        GetRecentActivities(run_client_id=run_client_id),
        GetLatestProgressReport(run_client_id=run_client_id),
        SearchClientMemory(run_client_id=run_client_id),
        WebSearchTool(),
        SendMessage(run_client_id=run_client_id, default_provider=default_provider),
    ]
