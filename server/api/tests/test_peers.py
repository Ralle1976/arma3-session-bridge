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
import pathlib

_DB_PATH = "/tmp/arma3-test-peers.db"
# Remove stale DB so tests start clean each run
pathlib.Path(_DB_PATH).unlink(missing_ok=True)

os.environ.setdefault("ADMIN_PASSWORD", "test-password-peers")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-at-least-32-chars-long-peers")
os.environ.setdefault("DB_PATH", _DB_PATH)

from main import app  # noqa: E402
from database import init_db  # noqa: E402

# ── Helpers ────────────────────────────────────────────────────────────────────

BASE_URL = "http://test"

import uuid

_keypair_counter = 0


def _mock_keypair():
    """Fake wg keypair subprocess calls — generates unique keys each invocation."""
    global _keypair_counter
    _keypair_counter += 1
    uid = f"{_keypair_counter:04d}{uuid.uuid4().hex[:8]}"
    # generate_keypair calls subprocess.run twice: genkey, then pubkey
    genkey_result = MagicMock()
    genkey_result.stdout = f"fakePrivKey{uid}ABCDEFGH="
    genkey_result.returncode = 0

    pubkey_result = MagicMock()
    pubkey_result.stdout = f"fakePubKey{uid}ABCDEFGHIJ="
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
    """Log in and return admin Bearer token.

    Uses the ADMIN_PASSWORD from the main module (not os.environ) to avoid
    issues when other test modules overwrite os.environ['ADMIN_PASSWORD'].
    """
    import main as _main
    resp = await client.post(
        "/auth/login",
        json={"password": _main.ADMIN_PASSWORD},
    )
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["access_token"]

# ── Fixtures ───────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module", autouse=True)
async def setup_db():
    """Initialize DB tables before any test in this module runs."""
    await init_db()


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


# ── Required named tests (task spec) ─────────────────────────────────────────

@pytest.mark.anyio
async def test_create_peer_returns_201(client: AsyncClient, admin_headers: dict):
    """POST /peers → 201 with {id, tunnel_ip, public_key}."""
    keypair_results = _mock_keypair()
    with (
        patch("services.wireguard.subprocess.run") as mock_run,
        patch("routers.peers.sync_wireguard"),
    ):
        mock_run.side_effect = keypair_results
        resp = await client.post(
            "/peers",
            json={"name": "spec-peer-201", "allowed_ips": "10.8.0.0/24"},
            headers=admin_headers,
        )
    assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert "id" in data
    assert "tunnel_ip" in data
    assert "public_key" in data


@pytest.mark.anyio
async def test_peer_config_has_interface_and_peer(client: AsyncClient, admin_headers: dict):
    """GET /peers/{id}/config contains [Interface] and [Peer] sections."""
    list_resp = await client.get("/peers", headers=admin_headers)
    assert list_resp.status_code == 200
    peers = list_resp.json()
    assert len(peers) >= 1
    peer_id = peers[0]["id"]
    resp = await client.get(f"/peers/{peer_id}/config", headers=admin_headers)
    assert resp.status_code == 200
    config_text = resp.text
    assert "[Interface]" in config_text, "Config must contain [Interface]"
    assert "[Peer]" in config_text, "Config must contain [Peer]"


@pytest.mark.anyio
async def test_delete_peer_returns_204(client: AsyncClient, admin_headers: dict):
    """DELETE /peers/{id} → 204."""
    keypair_results = _mock_keypair()
    with (
        patch("services.wireguard.subprocess.run") as mock_run,
        patch("routers.peers.sync_wireguard"),
    ):
        mock_run.side_effect = keypair_results
        create_resp = await client.post(
            "/peers",
            json={"name": "spec-peer-delete-204", "allowed_ips": "10.8.0.0/24"},
            headers=admin_headers,
        )
    assert create_resp.status_code == 201
    peer_id = create_resp.json()["id"]
    with patch("routers.peers.sync_wireguard"):
        del_resp = await client.delete(f"/peers/{peer_id}", headers=admin_headers)
    assert del_resp.status_code == 204, f"Expected 204, got {del_resp.status_code}: {del_resp.text}"


@pytest.mark.anyio
async def test_tunnel_ip_in_range(client: AsyncClient, admin_headers: dict):
    """Tunnel IP assigned to new peer is in range 10.8.0.2–10.8.0.20."""
    keypair_results = _mock_keypair()
    with (
        patch("services.wireguard.subprocess.run") as mock_run,
        patch("routers.peers.sync_wireguard"),
    ):
        mock_run.side_effect = keypair_results
        resp = await client.post(
            "/peers",
            json={"name": "spec-peer-ip-range", "allowed_ips": "10.8.0.0/24"},
            headers=admin_headers,
        )
    assert resp.status_code == 201
    tunnel_ip = resp.json()["tunnel_ip"]
    assert tunnel_ip.startswith("10.8.0."), f"Expected 10.8.0.x but got {tunnel_ip}"
    last_octet = int(tunnel_ip.split(".")[-1])
    assert 2 <= last_octet <= 20, f"Tunnel IP octet {last_octet} not in range 2-20"


# ── Task 1: Connection Quality Policy Tests ───────────────────────────────────


def test_connection_quality_policies_apply_expected_boundaries():
    """Verify PLAYER and ADMIN quality policies produce deterministic labels at boundary values.

    Boundary handshake ages tested: 59, 60, 179, 180, 599, 600 seconds.
    PLAYER policy: good<=180, warning<=600, offline>600
    ADMIN policy:  good<=60,  warning<=180, offline>180
    """
    from services.connection_quality import QualityPolicy, classify_quality

    handshake_ages = [59, 60, 179, 180, 599, 600]

    peers_route_labels = [
        classify_quality(age, False, QualityPolicy.PLAYER)
        for age in handshake_ages
    ]
    admin_route_labels = [
        classify_quality(age, False, QualityPolicy.ADMIN)
        for age in handshake_ages
    ]

    assert peers_route_labels == ["good", "good", "good", "good", "warning", "warning"], (
        f"PLAYER policy produced unexpected labels: {peers_route_labels}"
    )
    assert admin_route_labels == ["good", "good", "warning", "warning", "offline", "offline"], (
        f"ADMIN policy produced unexpected labels: {admin_route_labels}"
    )


def test_classify_quality_explicit_disconnect_always_offline():
    """explicitly_disconnected=True must always return 'offline', regardless of handshake age."""
    from services.connection_quality import QualityPolicy, classify_quality

    for policy in (QualityPolicy.PLAYER, QualityPolicy.ADMIN):
        assert classify_quality(0, True, policy) == "offline"
        assert classify_quality(10, True, policy) == "offline"
        assert classify_quality(None, True, policy) == "offline"


def test_classify_quality_none_handshake_is_offline():
    """last_handshake_ago=None (never connected) must return 'offline'."""
    from services.connection_quality import QualityPolicy, classify_quality

    for policy in (QualityPolicy.PLAYER, QualityPolicy.ADMIN):
        assert classify_quality(None, False, policy) == "offline"
