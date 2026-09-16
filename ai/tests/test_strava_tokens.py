"""Strava token refresh in the AI service (ai/integrations/strava.py) — no network.

  1. A non-expired token is returned without calling Strava.
  2. An expired token refreshes with the trainer's UI-managed secret and
     persists the ROTATED refresh token.
  3. If refresh fails because another process already rotated the token, the
     fresher stored access token is adopted instead of failing.
  4. If refresh fails and nobody rotated it, the error propagates.
"""
from __future__ import annotations
import time
from unittest.mock import MagicMock, patch

import httpx
import pytest

from ai.integrations import strava

ROW = {"id": "tok1", "trainer_id": "t1", "access_token": "old-access",
       "refresh_token": "R1", "expires_at": int(time.time()) - 10}


def _http_error(status=400):
    req = httpx.Request("POST", strava.TOKEN_URL)
    return httpx.HTTPStatusError("bad", request=req, response=httpx.Response(status, request=req))


def _db(latest=None):
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value \
        .execute.return_value.data = latest or []
    return db


def test_fresh_token_skips_refresh():
    row = {**ROW, "expires_at": int(time.time()) + 3600}
    with patch.object(strava, "refresh_token") as refresh:
        assert strava.ensure_fresh_token(row) == "old-access"
    refresh.assert_not_called()


def test_expired_token_refreshes_with_trainer_secret_and_persists_rotation():
    db = _db()
    new = {"access_token": "new-access", "refresh_token": "R2", "expires_at": int(time.time()) + 21600}
    with patch.object(strava, "get_db", return_value=db), \
         patch("ai.secrets.get_trainer_secrets", return_value={"STRAVA_CLIENT_SECRET": "ui-secret"}), \
         patch.object(strava, "refresh_token", return_value=new) as refresh:
        assert strava.ensure_fresh_token(ROW) == "new-access"
    refresh.assert_called_once_with("R1", "ui-secret")
    update = db.table.return_value.update.call_args.args[0]
    assert update["refresh_token"] == "R2" and update["access_token"] == "new-access"


def test_concurrent_rotation_adopts_stored_token():
    db = _db(latest=[{"access_token": "rotated-access", "refresh_token": "R2",
                      "expires_at": int(time.time()) + 21600}])
    with patch.object(strava, "get_db", return_value=db), \
         patch("ai.secrets.get_trainer_secrets", return_value={}), \
         patch.object(strava, "refresh_token", side_effect=_http_error()):
        assert strava.ensure_fresh_token(ROW) == "rotated-access"
    db.table.return_value.update.assert_not_called()


def test_dead_token_raises():
    db = _db(latest=[{**ROW}])   # unchanged → nobody rotated it
    with patch.object(strava, "get_db", return_value=db), \
         patch("ai.secrets.get_trainer_secrets", return_value={}), \
         patch.object(strava, "refresh_token", side_effect=_http_error(401)):
        with pytest.raises(httpx.HTTPStatusError):
            strava.ensure_fresh_token(ROW)
