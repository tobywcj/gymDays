"""Embedding helper. Returns a zero vector when OPENAI_API_KEY is unset
so the rest of the stack keeps working in test/offline mode."""
from __future__ import annotations
from typing import Optional
from ai.config import OPENAI_API_KEY, EMBED_MODEL, EMBED_DIMENSION


def embed(text: str) -> Optional[list[float]]:
    """Return an embedding for *text*, or None if the API key is missing."""
    if not OPENAI_API_KEY:
        return None
    from openai import OpenAI
    client = OpenAI(api_key=OPENAI_API_KEY)
    resp = client.embeddings.create(model=EMBED_MODEL, input=text)
    return resp.data[0].embedding
