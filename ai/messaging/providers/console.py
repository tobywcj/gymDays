"""ConsoleProvider — the default. Prints to stdout, records the row.

Always succeeds. Useful for dev + tests where we don't want to spend money
on real providers. Status is always 'sent'.
"""
from __future__ import annotations
import sys
from typing import Optional
from ai.messaging.provider import MessagingProvider, Channel


class ConsoleProvider(MessagingProvider):
    channel: Channel = "console"

    def __init__(self, creds: dict | None = None) -> None:
        # Accepts a creds arg to keep the constructor signature uniform across providers.
        del creds  # unused

    def _deliver(self, *, to: str, body: str, subject: str | None = None) -> Optional[str]:
        prefix = f"[{subject}] " if subject else ""
        print(f"[messaging:console] → {to or '(no recipient)'}: {prefix}{body}", file=sys.stderr)
        return None  # no external id
