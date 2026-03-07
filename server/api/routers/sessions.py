"""
sessions.py — FastAPI Session Registry Router for arma3-session-bridge.

Endpoints:
  POST   /sessions                 — create session (PeerBearer JWT required)
  GET    /sessions                 — list active sessions (public, no auth)
  DELETE /sessions/{id}            — end session (PeerBearer JWT required)
  PUT    /sessions/{id}/heartbeat  — update last_seen (PeerBearer JWT required)

Session lifecycle: waiting → active → ended
"""

import os
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from pydantic import BaseModel, Field

from database import get_connection
from services.event_bus import broadcast

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"

_security = HTTPBearer()


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


async def _require_peer(
    credentials: HTTPAuthorizationCredentials = Depends(_security),
) -> int:
    """Validate PeerBearer JWT and return the peer_id (int).

    Raises 401 if the token is invalid, 403 if the role is not 'peer'.
    """
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

    if payload.get("role") != "peer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Peer token required (role=peer)",
        )

    try:
        return int(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Malformed token payload: {exc}",
        )


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class SessionCreate(BaseModel):
    mission_name: Optional[str] = Field(None, max_length=128, description="Mission file name")
    max_players: int = Field(default=10, ge=1, le=256, description="Maximum player slots")
    current_players: int = Field(default=0, ge=0, le=256, description="Current player count")


class SessionResponse(BaseModel):
    id: int
    host_peer_id: int
    host_tunnel_ip: str
    mission_name: Optional[str]
    max_players: int
    current_players: int
    status: str  # waiting | active | ended
    created_at: str
    last_seen: str


class HeartbeatResponse(BaseModel):
    id: int
    last_seen: str
    status: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_utc() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


async def _get_peer_tunnel_ip(peer_id: int) -> str:
    """Look up the tunnel IP for a peer. Raises 404 if not found or revoked."""
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT tunnel_ip FROM peers WHERE id = ? AND revoked = 0",
            (peer_id,),
        )
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peer {peer_id} not found or revoked",
        )
    return row["tunnel_ip"]


async def _fetch_session(session_id: int) -> dict:
    """Fetch a session row (joined with peer tunnel_ip). Raises 404 if absent."""
    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            SELECT s.id, s.peer_id, p.tunnel_ip, s.mission, s.player_count,
                   s.max_players, s.current_players, s.status,
                   s.started_at, s.last_seen, s.active, s.ended_at
            FROM sessions s
            JOIN peers p ON p.id = s.peer_id
            WHERE s.id = ?
            """,
            (session_id,),
        )
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )
    return dict(row)


def _row_to_response(row: dict) -> SessionResponse:
    return SessionResponse(
        id=row["id"],
        host_peer_id=row["peer_id"],
        host_tunnel_ip=row.get("tunnel_ip", ""),
        mission_name=row.get("mission") or row.get("mission_name"),
        max_players=row.get("max_players", 10),
        current_players=row.get("current_players", 0),
        status=row.get("status", "waiting"),
        created_at=row.get("started_at", ""),
        last_seen=row.get("last_seen", row.get("started_at", "")),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=SessionResponse,
    summary="Create a new game session (PeerBearer required)",
)
async def create_session(
    body: SessionCreate,
    peer_id: int = Depends(_require_peer),
) -> SessionResponse:
    """Open a new Arma 3 session. Only authenticated peers may create sessions."""
    tunnel_ip = await _get_peer_tunnel_ip(peer_id)
    now = _now_utc()

    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            INSERT INTO sessions
                (peer_id, mission, player_count, max_players, current_players,
                 status, started_at, last_seen, active)
            VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, 1)
            """,
            (
                peer_id,
                body.mission_name,
                body.current_players,
                body.max_players,
                body.current_players,
                now,
                now,
            ),
        )
        await conn.commit()
        session_id = cursor.lastrowid

    broadcast("session_created", {"session_id": session_id, "peer_id": peer_id})
    logger.info("Session %s created by peer %s", session_id, peer_id)

    return SessionResponse(
        id=session_id,
        host_peer_id=peer_id,
        host_tunnel_ip=tunnel_ip,
        mission_name=body.mission_name,
        max_players=body.max_players,
        current_players=body.current_players,
        status="waiting",
        created_at=now,
        last_seen=now,
    )


@router.get(
    "",
    response_model=list[SessionResponse],
    summary="List all active sessions (public)",
)
async def list_sessions() -> list[SessionResponse]:
    """Return all currently active sessions. No authentication required."""
    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            SELECT s.id, s.peer_id, p.tunnel_ip, s.mission, s.player_count,
                   s.max_players, s.current_players, s.status,
                   s.started_at, s.last_seen
            FROM sessions s
            JOIN peers p ON p.id = s.peer_id
            WHERE s.active = 1
            ORDER BY s.started_at DESC
            """,
        )
        rows = await cursor.fetchall()

    return [_row_to_response(dict(r)) for r in rows]


@router.get(
    "/{session_id}",
    response_model=SessionResponse,
    summary="Get a single active session by ID (public)",
)
async def get_session(session_id: int) -> SessionResponse:
    """Return one active session. Used by clients to resolve host tunnel IP."""
    row = await _fetch_session(session_id)
    return _row_to_response(row)


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="End a session (PeerBearer required)",
)
async def delete_session(
    session_id: int,
    peer_id: int = Depends(_require_peer),
) -> None:
    """Terminate a game session. Only the session owner may delete it."""
    row = await _fetch_session(session_id)

    if row["peer_id"] != peer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only end sessions you created",
        )
    if not row["active"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session is already ended",
        )

    now = _now_utc()
    async with get_connection() as conn:
        await conn.execute(
            "UPDATE sessions SET active = 0, status = 'ended', ended_at = ? WHERE id = ?",
            (now, session_id),
        )
        await conn.commit()

    broadcast("session_ended", {"session_id": session_id, "peer_id": peer_id})
    logger.info("Session %s ended by peer %s", session_id, peer_id)


@router.put(
    "/{session_id}/heartbeat",
    response_model=HeartbeatResponse,
    summary="Update session heartbeat (PeerBearer required)",
)
async def session_heartbeat(
    session_id: int,
    peer_id: int = Depends(_require_peer),
) -> HeartbeatResponse:
    """Update the last_seen timestamp to keep the session alive."""
    row = await _fetch_session(session_id)

    if row["peer_id"] != peer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only heartbeat sessions you created",
        )
    if not row["active"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session is already ended",
        )

    now = _now_utc()
    # Transition from 'waiting' → 'active' on first heartbeat
    new_status = "active" if row.get("status") == "waiting" else row.get("status", "active")

    async with get_connection() as conn:
        await conn.execute(
            "UPDATE sessions SET last_seen = ?, status = ? WHERE id = ?",
            (now, new_status, session_id),
        )
        await conn.commit()

    return HeartbeatResponse(id=session_id, last_seen=now, status=new_status)
