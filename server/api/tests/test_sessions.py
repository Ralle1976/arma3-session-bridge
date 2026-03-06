"""
test_sessions.py — pytest tests for Session Registry + Admin Stats endpoints.

Tests:
  - test_create_session        → POST /sessions → 201
  - test_list_sessions         → GET  /sessions → 200
  - test_session_heartbeat     → PUT  /sessions/{id}/heartbeat → 200
  - test_session_cleanup       → sessions > 2min without heartbeat → status='ended'
  - test_admin_stats           → GET  /admin/stats → 200 with all 5 fields
"""

import os
import pytest
from datetime import datetime, timedelta, timezone
from httpx import AsyncClient, ASGITransport
from jose import jwt

# ---------------------------------------------------------------------------
# Environment setup — MUST happen before importing the app
# ---------------------------------------------------------------------------

os.environ["ADMIN_PASSWORD"] = "test-admin-password"
os.environ["JWT_SECRET"] = "test-jwt-secret-at-least-32-chars-long"
os.environ["DB_PATH"] = "/tmp/arma3-sessions-test.db"

# ---------------------------------------------------------------------------
# App import (after env setup)
# ---------------------------------------------------------------------------

from main import app  # noqa: E402
from database import get_connection, init_db  # noqa: E402
from services.session_cleanup import cleanup_expired_sessions  # noqa: E402

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_peer_token(peer_id: int) -> str:
    """Generate a valid PeerBearer JWT for testing."""
    payload = {
        "sub": str(peer_id),
        "role": "peer",
        "exp": datetime.now(tz=timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _make_admin_token() -> str:
    """Generate a valid AdminBearer JWT for testing."""
    payload = {
        "sub": "admin",
        "role": "admin",
        "exp": datetime.now(tz=timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
async def test_peer_id() -> int:
    """Insert a test peer into the DB and return its id."""
    await init_db()
    async with get_connection() as conn:
        # Remove stale test data
        await conn.execute("DELETE FROM sessions WHERE peer_id IN (SELECT id FROM peers WHERE name = 'test-peer')")
        await conn.execute("DELETE FROM peers WHERE name = 'test-peer'")
        await conn.commit()

        cursor = await conn.execute(
            """
            INSERT INTO peers (name, public_key, tunnel_ip, allowed_ips, revoked)
            VALUES ('test-peer', 'dGVzdC1wdWJrZXk=', '10.8.0.99', '10.8.0.0/24', 0)
            """,
        )
        await conn.commit()
        return cursor.lastrowid


@pytest.fixture(scope="module")
async def created_session_id(test_peer_id: int) -> int:
    """Create a session via POST /sessions and return the session id."""
    token = _make_peer_token(test_peer_id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/sessions",
            json={"mission_name": "King_of_the_Hill", "max_players": 32, "current_players": 0},
            headers=_auth_header(token),
        )
    assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
    return response.json()["id"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_session(test_peer_id: int):
    """POST /sessions must return 201 with correct session fields."""
    token = _make_peer_token(test_peer_id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/sessions",
            json={"mission_name": "Test_Mission", "max_players": 16, "current_players": 1},
            headers=_auth_header(token),
        )

    assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
    data = response.json()

    assert data["id"] > 0
    assert data["host_peer_id"] == test_peer_id
    assert data["host_tunnel_ip"] == "10.8.0.99"
    assert data["mission_name"] == "Test_Mission"
    assert data["max_players"] == 16
    assert data["current_players"] == 1
    assert data["status"] == "waiting"
    assert "created_at" in data
    assert "last_seen" in data


@pytest.mark.anyio
async def test_list_sessions(created_session_id: int):
    """GET /sessions must return 200 with a list of active sessions (no auth needed)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/sessions")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()

    assert isinstance(data, list), "Response must be a list"
    ids = [s["id"] for s in data]
    assert created_session_id in ids, f"Session {created_session_id} must appear in active list"

    # Verify structure of a returned session
    session = next(s for s in data if s["id"] == created_session_id)
    required_fields = {"id", "host_peer_id", "host_tunnel_ip", "mission_name",
                       "max_players", "current_players", "status", "created_at", "last_seen"}
    assert required_fields.issubset(session.keys()), f"Missing fields: {required_fields - session.keys()}"


@pytest.mark.anyio
async def test_session_heartbeat(test_peer_id: int, created_session_id: int):
    """PUT /sessions/{id}/heartbeat must return 200 with updated last_seen."""
    token = _make_peer_token(test_peer_id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.put(
            f"/sessions/{created_session_id}/heartbeat",
            headers=_auth_header(token),
        )

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()

    assert data["id"] == created_session_id
    assert "last_seen" in data
    assert data["status"] in ("waiting", "active"), f"Unexpected status: {data['status']}"


@pytest.mark.anyio
async def test_session_cleanup(test_peer_id: int):
    """Sessions with last_seen older than 2 minutes must be marked as 'ended' by cleanup."""
    # Create a new session for this test
    token = _make_peer_token(test_peer_id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/sessions",
            json={"mission_name": "Cleanup_Test_Mission", "max_players": 10, "current_players": 0},
            headers=_auth_header(token),
        )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # Manually set last_seen to 3 minutes ago to simulate timeout
    old_time = (
        datetime.now(tz=timezone.utc) - timedelta(minutes=3)
    ).strftime("%Y-%m-%dT%H:%M:%S")

    async with get_connection() as conn:
        await conn.execute(
            "UPDATE sessions SET last_seen = ? WHERE id = ?",
            (old_time, session_id),
        )
        await conn.commit()

    # Run cleanup
    ended_count = await cleanup_expired_sessions()

    # The session must be ended now
    assert ended_count >= 1, f"Expected at least 1 session cleaned up, got {ended_count}"

    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT status, active FROM sessions WHERE id = ?",
            (session_id,),
        )
        row = await cursor.fetchone()

    assert row is not None, "Session should still exist in DB"
    assert row["active"] == 0, "Session active flag must be 0"
    assert row["status"] == "ended", f"Session status must be 'ended', got {row['status']}"


@pytest.mark.anyio
async def test_admin_stats():
    """GET /admin/stats must return 200 with all 5 required fields."""
    admin_token = _make_admin_token()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/admin/stats",
            headers=_auth_header(admin_token),
        )

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()

    required_fields = {"connected_peers", "active_sessions", "server_uptime", "wg_rx_bytes", "wg_tx_bytes"}
    assert required_fields.issubset(data.keys()), f"Missing fields: {required_fields - data.keys()}"

    assert isinstance(data["connected_peers"], int), "connected_peers must be int"
    assert isinstance(data["active_sessions"], int), "active_sessions must be int"
    assert isinstance(data["server_uptime"], (int, float)), "server_uptime must be numeric"
    assert isinstance(data["wg_rx_bytes"], int), "wg_rx_bytes must be int"
    assert isinstance(data["wg_tx_bytes"], int), "wg_tx_bytes must be int"

    assert data["connected_peers"] >= 0
    assert data["active_sessions"] >= 0
    assert data["server_uptime"] >= 0
