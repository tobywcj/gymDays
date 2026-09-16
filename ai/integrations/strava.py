"""Strava integration.

Handles OAuth token exchange/refresh, activity fetch, and webhook payload
normalization into the `activities` table shape.

Docs: https://developers.strava.com/docs/reference/
"""
from __future__ import annotations
import time
from typing import Any, Optional
import httpx
from ai.db import get_db
from ai.config import STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET

AUTH_URL    = "https://www.strava.com/oauth/authorize"
TOKEN_URL   = "https://www.strava.com/oauth/token"
ACTIVITY_URL = "https://www.strava.com/api/v3/activities/{id}"


# ── OAuth ────────────────────────────────────────────────────────────────────

def authorize_url(redirect_uri: str, state: str) -> str:
    """Strava OAuth authorize URL — direct the client's browser here."""
    from urllib.parse import urlencode
    params = {
        "client_id": STRAVA_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "approval_prompt": "auto",
        "scope": "read,activity:read_all",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str) -> dict[str, Any]:
    """Exchange a one-time code for access+refresh tokens + athlete data."""
    r = httpx.post(TOKEN_URL, data={
        "client_id":     STRAVA_CLIENT_ID,
        "client_secret": STRAVA_CLIENT_SECRET,
        "grant_type":    "authorization_code",
        "code":          code,
    }, timeout=15)
    r.raise_for_status()
    return r.json()


def refresh_token(refresh_token: str, client_secret: str | None = None) -> dict[str, Any]:
    """Refresh an access token. `client_secret` overrides the .env secret — pass
    the trainer's UI-managed STRAVA_CLIENT_SECRET (trainer_secrets) so an in-app
    rotation works here too, matching web/lib/strava-access.ts."""
    r = httpx.post(TOKEN_URL, data={
        "client_id":     STRAVA_CLIENT_ID,
        "client_secret": client_secret or STRAVA_CLIENT_SECRET,
        "grant_type":    "refresh_token",
        "refresh_token": refresh_token,
    }, timeout=15)
    r.raise_for_status()
    return r.json()


def _ts(expires_at: Any) -> int:
    """`expires_at` may be a timestamp (int) or ISO string depending on insert path."""
    if isinstance(expires_at, str):
        from datetime import datetime
        return int(datetime.fromisoformat(expires_at.replace("Z", "+00:00")).timestamp())
    return int(expires_at or 0)


def ensure_fresh_token(token_row: dict[str, Any]) -> str:
    """Return a non-expired access_token, refreshing in the DB if needed."""
    exp_ts = _ts(token_row.get("expires_at"))
    if exp_ts and exp_ts > time.time() + 60:
        return token_row["access_token"]

    from ai.secrets import get_trainer_secrets

    db = get_db()
    secret = get_trainer_secrets(token_row.get("trainer_id")).get("STRAVA_CLIENT_SECRET")
    try:
        refreshed = refresh_token(token_row["refresh_token"], secret)
    except httpx.HTTPStatusError:
        # Strava invalidates a refresh token once rotated. If the web app (sync,
        # webhook) refreshed concurrently and persisted the new pair, adopt it
        # rather than failing; otherwise the token is genuinely dead.
        latest = db.table("integration_tokens") \
            .select("access_token, refresh_token, expires_at") \
            .eq("id", token_row["id"]).limit(1).execute().data
        if latest and latest[0]["refresh_token"] != token_row["refresh_token"] \
                and _ts(latest[0].get("expires_at")) > time.time() + 60:
            return latest[0]["access_token"]
        raise
    db.table("integration_tokens").update({
        "access_token":  refreshed["access_token"],
        "refresh_token": refreshed["refresh_token"],
        "expires_at":    _iso_from_ts(refreshed["expires_at"]),
    }).eq("id", token_row["id"]).execute()
    return refreshed["access_token"]


# ── Activity ingest ──────────────────────────────────────────────────────────

def fetch_activity(activity_id: int | str, access_token: str) -> dict[str, Any]:
    r = httpx.get(
        ACTIVITY_URL.format(id=activity_id),
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def normalize_activity(raw: dict[str, Any], *, trainer_id: str, client_id: str) -> dict[str, Any]:
    """Map a Strava /activities/{id} payload to our `activities` row schema."""
    return {
        "trainer_id":  trainer_id,
        "client_id":   client_id,
        "source":      "strava",
        "external_id": str(raw["id"]),
        "started_at":  raw.get("start_date") or raw.get("start_date_local"),
        "type":        raw.get("type") or raw.get("sport_type"),
        "distance_m":  raw.get("distance"),
        "duration_s":  raw.get("moving_time"),
        "metrics": {
            k: raw.get(k) for k in [
                "average_heartrate", "max_heartrate",
                "average_speed", "max_speed",
                "total_elevation_gain",
                "average_watts", "max_watts", "kilojoules",
                "suffer_score",
                "name",
            ] if raw.get(k) is not None
        },
    }


def upsert_activity(raw: dict[str, Any], *, trainer_id: str, client_id: str) -> dict[str, Any]:
    db = get_db()
    row = normalize_activity(raw, trainer_id=trainer_id, client_id=client_id)
    db.table("activities").upsert(row, on_conflict="source,external_id").execute()
    return row


def find_client_by_athlete_id(athlete_id: int | str) -> Optional[dict[str, Any]]:
    db = get_db()
    resp = db.table("clients") \
        .select("id, trainer_id") \
        .eq("strava_athlete_id", str(athlete_id)) \
        .limit(1).execute()
    return resp.data[0] if resp.data else None


def find_token_for_client(client_id: str) -> Optional[dict[str, Any]]:
    db = get_db()
    resp = db.table("integration_tokens") \
        .select("id, trainer_id, access_token, refresh_token, expires_at") \
        .eq("client_id", client_id) \
        .eq("provider", "strava") \
        .limit(1).execute()
    return resp.data[0] if resp.data else None


def ingest_webhook_event(event: dict[str, Any]) -> dict[str, Any]:
    """Process a Strava aspect-type=create|update event for object_type=activity.

    Returns a small status dict — exceptions bubble up to the caller.
    """
    if event.get("object_type") != "activity":
        return {"status": "ignored", "reason": f"object_type={event.get('object_type')}"}
    if event.get("aspect_type") == "delete":
        # Soft-delete: drop the row.
        db = get_db()
        db.table("activities").delete() \
            .eq("source", "strava") \
            .eq("external_id", str(event["object_id"])) \
            .execute()
        return {"status": "deleted", "external_id": event["object_id"]}

    owner = find_client_by_athlete_id(event["owner_id"])
    if owner is None:
        return {"status": "ignored", "reason": f"no client linked to athlete {event['owner_id']}"}

    token_row = find_token_for_client(owner["id"])
    if token_row is None:
        return {"status": "ignored", "reason": "no token stored"}

    access = ensure_fresh_token(token_row)
    raw = fetch_activity(event["object_id"], access)
    row = upsert_activity(raw, trainer_id=owner["trainer_id"], client_id=owner["id"])
    return {"status": "ingested", "external_id": row["external_id"], "client_id": owner["id"]}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _iso_from_ts(ts: int) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
