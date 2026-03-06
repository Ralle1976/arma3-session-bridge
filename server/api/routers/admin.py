"""
admin.py — Admin Router for arma3-session-bridge.

Endpoints:
  GET /admin/stats   — System statistics (AdminBearer JWT required)
  GET /admin/events  — SSE stream of live admin events (AdminBearer JWT required)

Admin events (SSE): peer_connected, peer_disconnected, session_created, session_ended
"""

import asyncio
import json
import logging
import os
import subprocess
import time
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from pydantic import BaseModel

from database import get_connection
from services.event_bus import subscribe, unsubscribe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
WG_CONTAINER = os.getenv("WG_CONTAINER", "arma3-wireguard")

_security = HTTPBearer()

# Track server start time for uptime calculation
_server_start_time: float = time.time()


def set_server_start_time(t: float) -> None:
    """Called from lifespan to record accurate startup time."""
    global _server_start_time
    _server_start_time = t


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


async def _require_admin(
    credentials: HTTPAuthorizationCredentials = Depends(_security),
) -> str:
    """Validate AdminBearer JWT and return the subject string."""
    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
        )

    if payload.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin token required (role=admin)",
        )

    return payload.get("sub", "admin")


# ---------------------------------------------------------------------------
# WireGuard stats parsing
# ---------------------------------------------------------------------------


def _parse_wg_transfer(output: str) -> tuple[int, int]:
    """Parse total rx/tx bytes from `wg show wg0` output.

    Returns:
        (total_rx_bytes, total_tx_bytes) — zero if WireGuard unavailable.
    """
    total_rx = 0
    total_tx = 0
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("transfer:"):
            # Example: "transfer: 1.50 MiB received, 2.30 MiB sent"
            transfer_str = stripped.split("transfer:", 1)[1].strip()
            parts = transfer_str.split(",")
            for part in parts:
                part = part.strip()
                if "received" in part:
                    total_rx += _parse_bytes(part.replace("received", "").strip())
                elif "sent" in part:
                    total_tx += _parse_bytes(part.replace("sent", "").strip())
    return total_rx, total_tx


def _parse_bytes(value: str) -> int:
    """Convert human-readable byte string (e.g. '1.50 MiB') to bytes integer."""
    units = {
        "B": 1,
        "KiB": 1024,
        "MiB": 1024 ** 2,
        "GiB": 1024 ** 3,
        "TiB": 1024 ** 4,
        "KB": 1000,
        "MB": 1000 ** 2,
        "GB": 1000 ** 3,
    }
    parts = value.strip().split()
    if len(parts) != 2:
        return 0
    try:
        amount = float(parts[0])
        unit = parts[1]
        return int(amount * units.get(unit, 1))
    except (ValueError, KeyError):
        return 0


def _get_wg_stats() -> tuple[int, int]:
    """Get WireGuard rx/tx bytes via docker exec. Returns (0, 0) if unavailable."""
    try:
        result = subprocess.run(
            ["docker", "exec", WG_CONTAINER, "wg", "show", "wg0"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            return 0, 0
        return _parse_wg_transfer(result.stdout)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return 0, 0


# ---------------------------------------------------------------------------
# WireGuard per-peer stats
# ---------------------------------------------------------------------------


def _parse_wg_dump(output: str) -> list[dict]:
    """Parse `wg show wg0 dump` tab-separated output into per-peer dicts.

    Dump format (tab-separated):
      Interface line: private_key  public_key  listen_port  fwmark
      Peer lines:     public_key  preshared_key  endpoint  allowed_ips
                      last_handshake  rx_bytes  tx_bytes  persistent_keepalive
    """
    peers = []
    lines = output.strip().splitlines()
    if not lines:
        return peers
    # Skip interface line (first line)
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) < 8:
            continue
        pub_key = parts[0]
        endpoint = parts[2] if parts[2] != "(none)" else None
        allowed_ips = parts[3]
        last_handshake_ts = int(parts[4]) if parts[4].isdigit() else 0
        rx_bytes = int(parts[5]) if parts[5].isdigit() else 0
        tx_bytes = int(parts[6]) if parts[6].isdigit() else 0
        keepalive = int(parts[7]) if parts[7].isdigit() else 0

        import time as _time
        now = int(_time.time())
        last_handshake_ago = (now - last_handshake_ts) if last_handshake_ts > 0 else None

        if last_handshake_ago is None or last_handshake_ago > 600:
            quality = "offline"
        elif last_handshake_ago > 180:
            quality = "warning"
        else:
            quality = "good"

        peers.append({
            "public_key": pub_key,
            "endpoint": endpoint,
            "allowed_ips": allowed_ips,
            "last_handshake_ago": last_handshake_ago,
            "transfer_rx_bytes": rx_bytes,
            "transfer_tx_bytes": tx_bytes,
            "persistent_keepalive": keepalive,
            "connection_quality": quality,
        })
    return peers


def _get_wg_peer_stats() -> list[dict]:
    """Get per-peer WireGuard stats via `wg show wg0 dump`. Returns [] if unavailable."""
    try:
        result = subprocess.run(
            ["docker", "exec", WG_CONTAINER, "wg", "show", "wg0", "dump"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return []
        return _parse_wg_dump(result.stdout)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return []


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class PeerStat(BaseModel):
    public_key: str
    endpoint: str | None
    allowed_ips: str
    last_handshake_ago: int | None  # seconds since last handshake, None if never
    transfer_rx_bytes: int
    transfer_tx_bytes: int
    persistent_keepalive: int
    connection_quality: str  # 'good' | 'warning' | 'offline'


class WgStats(BaseModel):
    peers: list[PeerStat]
    optimizations: dict  # MTU, keepalive, server_tuning flags


class AdminStats(BaseModel):

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/stats",
    response_model=AdminStats,
    summary="System statistics (AdminBearer required)",
)
async def admin_stats(_admin: str = Depends(_require_admin)) -> AdminStats:
    """Return current system statistics including WireGuard traffic counters."""
    async with get_connection() as conn:
        cur_peers = await conn.execute(
            "SELECT COUNT(*) as cnt FROM peers WHERE revoked = 0"
        )
        row_peers = await cur_peers.fetchone()

        cur_sessions = await conn.execute(
            "SELECT COUNT(*) as cnt FROM sessions WHERE active = 1"
        )
        row_sessions = await cur_sessions.fetchone()

    uptime = time.time() - _server_start_time
    rx, tx = _get_wg_stats()

    return AdminStats(
        connected_peers=row_peers["cnt"],
        active_sessions=row_sessions["cnt"],
        server_uptime=round(uptime, 2),
        wg_rx_bytes=rx,
        wg_tx_bytes=tx,
    )


@router.get(
    "/wg-stats",
    response_model=WgStats,
    summary="Per-peer WireGuard stats with connection quality (AdminBearer required)",
)
async def admin_wg_stats(_admin: str = Depends(_require_admin)) -> WgStats:
    """Return real-time WireGuard peer stats parsed from `wg show wg0 dump`.

    Connection quality thresholds:
      good    = last handshake < 180s (PersistentKeepalive=25s keeps it alive)
      warning = 180s – 600s (peer briefly offline)
      offline = > 600s or never connected
    """
    raw_peers = _get_wg_peer_stats()
    peers = [PeerStat(**p) for p in raw_peers]
    return WgStats(
        peers=peers,
        optimizations={
            "mtu": 1420,
            "keepalive_seconds": 25,
            "server_tuning": False,  # sysctl tuning not yet applied
        },
    )

@router.get(
    "/events",
    summary="SSE stream of admin events (AdminBearer required)",
    response_class=StreamingResponse,
)
async def admin_events(
    request: Request,
    token: str | None = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(HTTPBearer(auto_error=False)),
) -> StreamingResponse:
    """Stream Server-Sent Events for live admin monitoring.
    Accepts token via Authorization: Bearer header OR ?token= query param (for EventSource).
    """
    # Resolve token: query param first (EventSource cannot set custom headers)
    raw_token = token or (credentials.credentials if credentials else None)
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token required")
    try:
        payload = jwt.decode(raw_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {exc}")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    async def event_generator() -> AsyncGenerator[str, None]:
        q = subscribe()
        try:
            # Send initial keepalive
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    data = json.dumps(event.get("data", {}))
                    event_type = event.get("event", "message")
                    yield f"event: {event_type}\ndata: {data}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive ping every 15s
                    yield ": keepalive\n\n"
        finally:
            unsubscribe(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
