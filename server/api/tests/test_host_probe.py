import os
import socket
import threading
import time

import pytest
from httpx import ASGITransport, AsyncClient
import jwt

from database import get_connection, init_db
from main import app

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"


class MockArmaHost:
    def __init__(self, port: int):
        self.port = port
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as wake:
                wake.sendto(b"stop", ("127.0.0.1", self.port))
        except OSError:
            pass
        self._thread.join(timeout=1.0)

    def _run(self) -> None:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.bind(("127.0.0.1", self.port))
            sock.settimeout(0.2)
            while not self._stop.is_set():
                try:
                    payload, addr = sock.recvfrom(4096)
                except socket.timeout:
                    continue
                if payload.startswith(b"\xFF\xFF\xFF\xFFTSource Engine Query\x00"):
                    sock.sendto(b"\xFF\xFF\xFF\xFFImock-arma3-host", addr)


def _peer_token(peer_id: int) -> str:
    payload = {
        "sub": str(peer_id),
        "role": "peer",
        "exp": int(time.time()) + 3600,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _free_udp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
async def probe_session_id() -> int:
    await init_db()
    async with get_connection() as conn:
        await conn.execute("DELETE FROM sessions WHERE peer_id IN (SELECT id FROM peers WHERE name = 'probe-peer')")
        await conn.execute("DELETE FROM peers WHERE name = 'probe-peer'")
        await conn.commit()

        cursor = await conn.execute(
            """
            INSERT INTO peers (name, public_key, tunnel_ip, allowed_ips, revoked)
            VALUES ('probe-peer', 'probe-public-key', '127.0.0.1', '10.8.0.0/24', 0)
            """,
        )
        await conn.commit()
        peer_id = cursor.lastrowid

    token = _peer_token(peer_id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/sessions",
            json={"mission_name": "ProbeMission", "max_players": 8, "current_players": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.mark.anyio
async def test_probe_session_host_success(probe_session_id: int):
    query_port = _free_udp_port()
    game_port = query_port + 1
    host = MockArmaHost(query_port)
    host.start()

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                f"/sessions/{probe_session_id}/probe?game_port={game_port}&query_port={query_port}&timeout_seconds=1.0"
            )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["session_id"] == probe_session_id
        assert data["host_tunnel_ip"] == "127.0.0.1"
        assert data["reachable"] is True
        assert data["probed_port"] == query_port
        assert isinstance(data["latency_ms"], int)
    finally:
        host.stop()


@pytest.mark.anyio
async def test_probe_session_host_timeout(probe_session_id: int):
    query_port = _free_udp_port()
    game_port = query_port + 1

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            f"/sessions/{probe_session_id}/probe?game_port={game_port}&query_port={query_port}&timeout_seconds=0.2"
        )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["reachable"] is False
    assert data["latency_ms"] is None
    assert data["probed_port"] is None
    assert isinstance(data["error"], str)
