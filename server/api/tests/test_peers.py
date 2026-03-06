"""
test_peers.py — pytest tests for Peer CRUD endpoints.

All tests run against the FastAPI test client — no Docker or real WireGuard needed.
subprocess.run is mocked to avoid calling wg/docker commands.
"""

import os
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

# ── Env setup (MUST happen before importing app) ───────────────────────────────
os.environ.setdefault("ADMIN_PASSWORD", "test-password-peers")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-at-least-32-chars-long-peers")
os.environ.setdefault("DB_PATH", "/tmp/arma3-test-peers.db")

from main import app  # noqa: E402

# ── Helpers ────────────────────────────────────────────────────────────────────

BASE_URL = "http://test"


def _mock_keypair():
    """Fake wg keypair subprocess calls."""
    # generate_keypair calls subprocess.run twice: genkey, then pubkey
    genkey_result = MagicMock()
    genkey_result.stdout = "fakeprivatekey1234567890ABCDEFGH="
    genkey_result.returncode = 0

    pubkey_result = MagicMock()
    pubkey_result.stdout = "fakepublickey1234567890ABCDEFGHIJ="
    pubkey_result.returncode = 0

    return [genkey_result, pubkey_result]


def _mock_sync():
    """Fake docker cp + docker exec wg syncconf subprocess calls."""
    success = MagicMock()
    success.returncode = 0
    success.stdout = ""
    success.stderr = ""
    return success


async def _get_admin_token(client: AsyncClient) -> str:
    """Log in and return admin Bearer token."""
    resp = await client.post(
        "/auth/login",
        json={"password": os.environ["ADMIN_PASSWORD"]},
    )
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["access_token"]


# ── Fixtures ───────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL) as c:
        yield c


@pytest.fixture(scope="module")
async def admin_headers(client):
    token = await _get_admin_token(client)
    return {"Authorization": f"Bearer {token}"}


# ── Tests ──────────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_create_peer(client: AsyncClient, admin_headers: dict):
    """POST /peers → 201, peer created with public_key and tunnel_ip."""
    keypair_results = _mock_keypair()
    sync_result = _mock_sync()

    with (
        patch("services.wireguard.subprocess.run") as mock_run,
        patch("routers.peers.sync_wireguard") as mock_sync,
    ):
        # First call returns genkey result, second returns pubkey result
        mock_run.side_effect = keypair_results
        mock_sync.return_value = None

        resp = await client.post(
            "/peers",
            json={"name": "test-peer-create", "allowed_ips": "10.8.0.0/24"},
            headers=admin_headers,
        )

    assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert data["name"] == "test-peer-create"
    assert "public_key" in data
    assert "tunnel_ip" in data
    assert data["tunnel_ip"].startswith("10.8.0.")
    assert "peer_token" in data
    assert data["revoked"] is False


@pytest.mark.anyio
async def test_list_peers(client: AsyncClient, admin_headers: dict):
    """GET /peers → 200, returns a list."""
    resp = await client.get("/peers", headers=admin_headers)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert isinstance(data, list)
    # At least the peer created in test_create_peer should be here
    assert len(data) >= 1
    # Each item must have expected fields
    for peer in data:
        assert "id" in peer
        assert "name" in peer
        assert "public_key" in peer
        assert "tunnel_ip" in peer
        assert "revoked" in peer


@pytest.mark.anyio
async def test_get_peer_by_id(client: AsyncClient, admin_headers: dict):
    """GET /peers/{id} → 200 for existing peer."""
    # First, list peers to get a valid ID
    list_resp = await client.get("/peers", headers=admin_headers)
    assert list_resp.status_code == 200
    peers = list_resp.json()
    assert len(peers) >= 1

    peer_id = peers[0]["id"]
    resp = await client.get(f"/peers/{peer_id}", headers=admin_headers)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert data["id"] == peer_id


@pytest.mark.anyio
async def test_get_peer_not_found(client: AsyncClient, admin_headers: dict):
    """GET /peers/{id} → 404 for non-existent peer."""
    resp = await client.get("/peers/99999", headers=admin_headers)
    assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"


@pytest.mark.anyio
async def test_peer_config_format(client: AsyncClient, admin_headers: dict):
    """GET /peers/{id}/config → 200, contains [Interface] and [Peer] sections."""
    # Get a valid peer ID
    list_resp = await client.get("/peers", headers=admin_headers)
    peers = list_resp.json()
    assert len(peers) >= 1
    peer_id = peers[0]["id"]

    resp = await client.get(f"/peers/{peer_id}/config", headers=admin_headers)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    config_text = resp.text
    assert "[Interface]" in config_text, "Config must contain [Interface] section"
    assert "[Peer]" in config_text, "Config must contain [Peer] section"
    assert "PrivateKey" in config_text
    assert "PublicKey" in config_text
    assert "AllowedIPs" in config_text
    assert "10.8.0.0/24" in config_text, "Must use split-tunnel AllowedIPs"
    # Confirm NOT full-tunnel
    assert "0.0.0.0/0" not in config_text, "Must NOT use full-tunnel AllowedIPs"


@pytest.mark.anyio
async def test_delete_peer(client: AsyncClient, admin_headers: dict):
    """DELETE /peers/{id} → 204, peer is revoked."""
    # Create a peer to delete
    keypair_results = _mock_keypair()

    with (
        patch("services.wireguard.subprocess.run") as mock_run,
        patch("routers.peers.sync_wireguard") as mock_sync,
    ):
        mock_run.side_effect = keypair_results
        mock_sync.return_value = None

        create_resp = await client.post(
            "/peers",
            json={"name": "peer-to-delete", "allowed_ips": "10.8.0.0/24"},
            headers=admin_headers,
        )

    assert create_resp.status_code == 201
    peer_id = create_resp.json()["id"]

    # Delete it
    with patch("routers.peers.sync_wireguard") as mock_sync:
        mock_sync.return_value = None
        del_resp = await client.delete(f"/peers/{peer_id}", headers=admin_headers)

    assert del_resp.status_code == 204, (
        f"Expected 204, got {del_resp.status_code}: {del_resp.text}"
    )

    # Verify it's gone from the active list
    list_resp = await client.get("/peers", headers=admin_headers)
    active_ids = [p["id"] for p in list_resp.json()]
    assert peer_id not in active_ids, "Revoked peer must not appear in active list"


@pytest.mark.anyio
async def test_delete_peer_not_found(client: AsyncClient, admin_headers: dict):
    """DELETE /peers/{id} → 404 for non-existent peer."""
    with patch("routers.peers.sync_wireguard"):
        resp = await client.delete("/peers/99999", headers=admin_headers)
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_create_peer_duplicate_name(client: AsyncClient, admin_headers: dict):
    """POST /peers with duplicate name → 400."""
    keypair_results = _mock_keypair()

    with (
        patch("services.wireguard.subprocess.run") as mock_run,
        patch("routers.peers.sync_wireguard"),
    ):
        mock_run.side_effect = keypair_results
        # First creation should succeed
        resp1 = await client.post(
            "/peers",
            json={"name": "duplicate-peer", "allowed_ips": "10.8.0.0/24"},
            headers=admin_headers,
        )

    assert resp1.status_code == 201

    # Second creation with same name should fail
    keypair_results2 = _mock_keypair()
    with (
        patch("services.wireguard.subprocess.run") as mock_run,
        patch("routers.peers.sync_wireguard"),
    ):
        mock_run.side_effect = keypair_results2
        resp2 = await client.post(
            "/peers",
            json={"name": "duplicate-peer", "allowed_ips": "10.8.0.0/24"},
            headers=admin_headers,
        )

    assert resp2.status_code == 400


@pytest.mark.anyio
async def test_unauthorized_without_token(client: AsyncClient):
    """All peer endpoints must reject requests without a Bearer token."""
    resp = await client.get("/peers")
    assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"


@pytest.mark.anyio
async def test_unauthorized_with_wrong_token(client: AsyncClient):
    """Peer endpoints must reject requests with an invalid Bearer token."""
    bad_headers = {"Authorization": "Bearer this.is.not.a.valid.jwt"}
    resp = await client.get("/peers", headers=bad_headers)
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
