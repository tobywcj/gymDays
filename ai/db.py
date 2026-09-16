"""Shared Supabase client (service-role — bypasses RLS, trusted server side)."""
from __future__ import annotations
from functools import lru_cache
from supabase import create_client, Client
from ai.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY


@lru_cache(maxsize=1)
def get_db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise EnvironmentError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
